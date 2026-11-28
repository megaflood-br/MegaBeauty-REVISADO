import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import {
  resolvePublicOriginForRequest,
  verifyInstagramOAuthState,
} from "@/lib/instagram-server";

export const runtime = "nodejs";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function callbackHtml(payload: { ok: true; username: string } | { ok: false; error: string }) {
  const safeJson = JSON.stringify(
    payload.ok
      ? { type: "INSTAGRAM_OAUTH_SUCCESS", username: payload.username }
      : { type: "INSTAGRAM_OAUTH_ERROR", error: payload.error },
  ).replace(/</g, "\\u003c");

  const title = payload.ok ? "Instagram conectado!" : "Não foi possível conectar";
  const detail = payload.ok
    ? `Conta @${escapeHtml(payload.username)} conectada com sucesso. Esta janela será fechada automaticamente.`
    : escapeHtml(payload.error);

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; }
    .card { max-width: 420px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 10px 30px rgba(15,23,42,0.08); }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    button { border: 0; background: #2563eb; color: #fff; padding: 10px 16px; border-radius: 10px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${detail}</p>
    <button type="button" onclick="window.close()">Fechar janela</button>
  </div>
  <script>
    (function () {
      var msg = ${safeJson};
      if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(msg, "*"); } catch (e) {}
      }
      if (msg.type === "INSTAGRAM_OAUTH_SUCCESS") {
        setTimeout(function () { window.close(); }, 900);
      }
    })();
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

type MetaPage = {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const errorDesc = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errorDesc) {
    return callbackHtml({ ok: false, error: `Autorização cancelada pela Meta: ${errorDesc}` });
  }

  const code = url.searchParams.get("code")?.trim() || "";
  const stateParam = url.searchParams.get("state")?.trim() || "";
  if (!code || !stateParam) {
    return callbackHtml({ ok: false, error: "Parâmetros de autorização inválidos ou ausentes." });
  }

  const state = verifyInstagramOAuthState(stateParam);
  if (!state) {
    return callbackHtml({
      ok: false,
      error: "Sessão de autenticação expirada ou inválida. Feche esta janela e tente conectar novamente.",
    });
  }

  try {
    const integrations = await resolvePlatformIntegrations();
    if (!integrations.metaAppId || !integrations.metaAppSecret) {
      return callbackHtml({ ok: false, error: "App ID / App Secret da Meta não configurados na plataforma." });
    }

    const version = integrations.metaGraphVersion.startsWith("v")
      ? integrations.metaGraphVersion
      : `v${integrations.metaGraphVersion}`;
    const origin = resolvePublicOriginForRequest(request, integrations.publicAppUrl);
    const redirectUri = `${origin}/api/instagram/oauth/callback`;
    const graphBase = `https://graph.facebook.com/${version}`;

    // 1. Exchange code for user access token
    const tokenParams = new URLSearchParams({
      client_id: integrations.metaAppId,
      client_secret: integrations.metaAppSecret,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(`${graphBase}/oauth/access_token?${tokenParams.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      return callbackHtml({
        ok: false,
        error: tokenJson.error?.message || "Não foi possível trocar o código OAuth com a Meta.",
      });
    }

    // 2. Exchange for long-lived token (60 days)
    let longToken = tokenJson.access_token;
    try {
      const longParams = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: integrations.metaAppId,
        client_secret: integrations.metaAppSecret,
        fb_exchange_token: tokenJson.access_token,
      });
      const longRes = await fetch(`${graphBase}/oauth/access_token?${longParams.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const longJson = (await longRes.json().catch(() => ({}))) as { access_token?: string };
      if (longRes.ok && longJson.access_token) {
        longToken = longJson.access_token;
      }
    } catch {
      // Keep short-lived token if long-lived exchange fails
    }

    // 3. Find Facebook Page linked to an Instagram Business/Creator account
    const pagesRes = await fetch(
      `${graphBase}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(longToken)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const pagesJson = (await pagesRes.json().catch(() => ({}))) as {
      data?: MetaPage[];
      error?: { message?: string };
    };
    if (!pagesRes.ok) {
      return callbackHtml({
        ok: false,
        error: pagesJson.error?.message || "Erro ao consultar suas Páginas do Facebook.",
      });
    }

    const pages = Array.isArray(pagesJson.data) ? pagesJson.data : [];
    const match = pages.find((p) => p.instagram_business_account?.id);
    if (!match || !match.instagram_business_account?.id) {
      return callbackHtml({
        ok: false,
        error:
          "Nenhuma conta Instagram Profissional/Comercial vinculada a uma Página do Facebook foi encontrada nesta conta Meta.",
      });
    }

    const igUserId = match.instagram_business_account.id;
    const igUsername = match.instagram_business_account.username || match.name || "instagram";
    const pageToken = match.access_token || longToken;

    await withoutTenantScope(() =>
      prisma.tenant.update({
        where: { id: state.tenantId },
        data: {
          instagramUserId: igUserId,
          instagramUsername: igUsername,
          instagramPageId: match.id ?? null,
          instagramPageName: match.name ?? null,
          instagramAccessToken: pageToken,
          instagramConnectedAt: new Date(),
        },
      }),
    );

    return callbackHtml({ ok: true, username: igUsername });
  } catch (cause) {
    console.error("instagram oauth callback failed", cause);
    return callbackHtml({ ok: false, error: "Erro interno ao finalizar a conexão com o Instagram." });
  }
}
