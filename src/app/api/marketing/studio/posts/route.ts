import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { checkPlatformModule } from "@/lib/platform-modules-server";
import {
  deleteSalonMarketingArtwork,
  requireSalonMarketingApi,
  saveSalonMarketingArtwork,
} from "@/lib/instagram-server";
import { parseStudioFormat, parseStudioStyle } from "@/lib/marketing-studio";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function serializePost(row: {
  id: string;
  serviceId: string | null;
  packageId: string | null;
  title: string;
  headline: string;
  badgeText: string | null;
  priceText: string | null;
  promoPriceText: string | null;
  dateRangeText: string | null;
  ctaText: string | null;
  caption: string;
  format: string;
  style: string;
  imageUrl: string;
  status: string;
  publishTarget: string;
  instagramMediaId: string | null;
  instagramPermalink: string | null;
  errorMessage: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    serviceId: row.serviceId,
    packageId: row.packageId,
    title: row.title,
    headline: row.headline,
    badgeText: row.badgeText,
    priceText: row.priceText,
    promoPriceText: row.promoPriceText,
    dateRangeText: row.dateRangeText,
    ctaText: row.ctaText,
    caption: row.caption,
    format: parseStudioFormat(row.format),
    style: parseStudioStyle(row.style),
    imageUrl: row.imageUrl,
    status: row.status,
    publishTarget: row.publishTarget === "STORY" ? ("STORY" as const) : ("FEED" as const),
    instagramMediaId: row.instagramMediaId,
    instagramPermalink: row.instagramPermalink,
    errorMessage: row.errorMessage,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireSalonMarketingApi(request, "edit");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const mod = await checkPlatformModule("aiMarketingStudio");
    if (!mod.ok) return json({ error: mod.error }, 403);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: "Corpo da requisição inválido." }, 400);
    }

    const body = (rawBody ?? {}) as Record<string, unknown>;
    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
    if (!imageDataUrl) {
      return json({ error: "Arte não renderizada." }, 400);
    }

    const imageUrl = await saveSalonMarketingArtwork(auth.session.tenantId, imageDataUrl);
    const format = parseStudioFormat(body.format);
    const style = parseStudioStyle(body.style);
    const publishTarget = body.publishTarget === "STORY" || format === "story" ? "STORY" : "FEED";

    const created = await prisma.salonMarketingPost.create({
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
        caption: String(body.caption ?? "").trim().slice(0, 2200),
        format,
        style,
        imageUrl,
        status: "DRAFT",
        publishTarget,
      },
    });

    revalidatePath("/marketing");
    return json({ ok: true, post: serializePost(created) }, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erro ao salvar arte.";
    return json({ error: message }, 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireSalonMarketingApi(request, "edit");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim() || "";
    if (!id) return json({ error: "Informe o ID da arte." }, 400);

    const existing = await prisma.salonMarketingPost.findFirst({
      where: { id, tenantId: auth.session.tenantId },
    });
    if (!existing) return json({ error: "Arte não encontrada." }, 404);

    await prisma.salonMarketingPost.delete({ where: { id: existing.id } });
    await deleteSalonMarketingArtwork(auth.session.tenantId, existing.imageUrl);

    revalidatePath("/marketing");
    return json({ ok: true });
  } catch (cause) {
    console.error("delete studio post failed", cause);
    return json({ error: "Não foi possível excluir a arte." }, 500);
  }
}
