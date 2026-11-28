import { NextResponse } from "next/server";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { checkPlatformModule } from "@/lib/platform-modules-server";
import {
  requireSalonMarketingApi,
  resolvePublicOriginForRequest,
  signInstagramOAuthState,
} from "@/lib/instagram-server";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  try {
    const auth = await requireSalonMarketingApi(request, "edit");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const mod = await checkPlatformModule("instagramPublish");
    if (!mod.ok) return json({ error: mod.error }, 403);

    const integrations = await resolvePlatformIntegrations();
    if (!integrations.metaAppId || !integrations.metaAppSecret) {
      return json(
        {
          error:
            "Configure o App ID e o App Secret da Meta no painel Plataforma → Integrações → Meta antes de conectar o Instagram.",
        },
        400,
      );
    }

    const origin = resolvePublicOriginForRequest(request, integrations.publicAppUrl);
    const redirectUri = `${origin}/api/instagram/oauth/callback`;
    const state = signInstagramOAuthState({
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
    });

    const version = integrations.metaGraphVersion.startsWith("v")
      ? integrations.metaGraphVersion
      : `v${integrations.metaGraphVersion}`;

    const params = new URLSearchParams({
      client_id: integrations.metaAppId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_basic,instagram_content_publish,pages_show_list",
      state,
    });

    const url = `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
    return json({ ok: true, url, redirectUri });
  } catch (cause) {
    console.error("instagram oauth url failed", cause);
    return json({ error: "Não foi possível iniciar a conexão com o Instagram." }, 500);
  }
}
