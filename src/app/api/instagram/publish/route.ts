import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { checkPlatformModule } from "@/lib/platform-modules-server";
import {
  publishInstagramMedia,
  requireSalonMarketingApi,
  resolvePublicOriginForRequest,
  saveSalonMarketingArtwork,
} from "@/lib/instagram-server";
import { parseStudioFormat, parseStudioStyle } from "@/lib/marketing-studio";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireSalonMarketingApi(request, "edit");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const studioMod = await checkPlatformModule("aiMarketingStudio");
    if (!studioMod.ok) return json({ error: studioMod.error }, 403);
    const igMod = await checkPlatformModule("instagramPublish");
    if (!igMod.ok) return json({ error: igMod.error }, 403);

    if (!auth.tenant.instagramUserId || !auth.tenant.instagramAccessToken) {
      return json(
        { error: "Conecte sua conta Instagram Business antes de publicar diretamente." },
        400,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: "Corpo da requisição inválido." }, 400);
    }

    const body = (rawBody ?? {}) as Record<string, unknown>;
    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
    if (!imageDataUrl) {
      return json({ error: "Arte não renderizada. Gere a visualização antes de publicar." }, 400);
    }

    const integrations = await resolvePlatformIntegrations();
    const origin = resolvePublicOriginForRequest(request, integrations.publicAppUrl);
    if (!origin.startsWith("https://")) {
      return json(
        {
          error:
            "A publicação direta na API do Instagram exige uma URL pública HTTPS configurada no sistema.",
        },
        400,
      );
    }

    const format = parseStudioFormat(body.format);
    const style = parseStudioStyle(body.style);
    const publishTarget: "FEED" | "STORY" = body.publishTarget === "STORY" ? "STORY" : "FEED";
    const caption = String(body.caption ?? "").trim().slice(0, 2200);

    const relativeUrl = await saveSalonMarketingArtwork(auth.session.tenantId, imageDataUrl);
    const publicImageUrl = `${origin}${relativeUrl}`;

    const post = await prisma.salonMarketingPost.create({
      data: {
        tenantId: auth.session.tenantId,
        serviceId: typeof body.serviceId === "string" && body.serviceId.trim() ? body.serviceId.trim() : null,
        packageId: typeof body.packageId === "string" && body.packageId.trim() ? body.packageId.trim() : null,
        title: String(body.title ?? "Arte promocional").trim().slice(0, 120) || "Arte promocional",
        headline: String(body.headline ?? "").trim().slice(0, 140),
        badgeText: String(body.badgeText ?? "").trim().slice(0, 80) || null,
        priceText: String(body.priceText ?? "").trim().slice(0, 40) || null,
        promoPriceText: String(body.promoPriceText ?? "").trim().slice(0, 40) || null,
        dateRangeText: String(body.dateRangeText ?? "").trim().slice(0, 80) || null,
        ctaText: String(body.ctaText ?? "").trim().slice(0, 100) || null,
        caption,
        format,
        style,
        imageUrl: relativeUrl,
        status: "DRAFT",
        publishTarget,
      },
    });

    const published = await publishInstagramMedia({
      graphVersion: integrations.metaGraphVersion,
      igUserId: auth.tenant.instagramUserId,
      accessToken: auth.tenant.instagramAccessToken,
      imageUrl: publicImageUrl,
      caption,
      publishTarget,
    });

    const updated = await prisma.salonMarketingPost.update({
      where: { id: post.id },
      data: published.ok
        ? {
            status: "PUBLISHED",
            instagramMediaId: published.mediaId,
            instagramPermalink: published.permalink,
            publishedAt: new Date(),
            errorMessage: null,
          }
        : {
            status: "FAILED",
            errorMessage: published.error.slice(0, 400),
          },
    });

    revalidatePath("/marketing");

    const serialized = {
      id: updated.id,
      serviceId: updated.serviceId,
      packageId: updated.packageId,
      title: updated.title,
      headline: updated.headline,
      badgeText: updated.badgeText,
      priceText: updated.priceText,
      promoPriceText: updated.promoPriceText,
      dateRangeText: updated.dateRangeText,
      ctaText: updated.ctaText,
      caption: updated.caption,
      format: parseStudioFormat(updated.format),
      style: parseStudioStyle(updated.style),
      imageUrl: updated.imageUrl,
      status: updated.status,
      publishTarget: updated.publishTarget === "STORY" ? ("STORY" as const) : ("FEED" as const),
      instagramMediaId: updated.instagramMediaId,
      instagramPermalink: updated.instagramPermalink,
      errorMessage: updated.errorMessage,
      publishedAt: updated.publishedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    };

    if (!published.ok) {
      return json({ ok: false, error: published.error, post: serialized }, 422);
    }

    return json({ ok: true, post: serialized });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erro ao publicar no Instagram.";
    return json({ error: message }, 500);
  }
}
