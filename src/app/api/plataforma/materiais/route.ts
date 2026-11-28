import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import {
  MAX_MARKETING_IMAGE_OR_PDF_BYTES,
  MAX_MARKETING_VIDEO_BYTES,
  clampNumber,
  detectAllowedMarketingMedia,
  normalizeLogoBackdrop,
  normalizeLogoPosition,
  normalizeLogoVariant,
} from "@/lib/marketing-drive";
import {
  requirePlatformAdminApi,
  saveMarketingDriveFile,
  serializeMarketingAsset,
} from "@/lib/marketing-drive-storage";

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
    const auth = await requirePlatformAdminApi(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Não foi possível receber o arquivo enviado." }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: "Selecione um arquivo (PNG, JPG, WebP, MP4, WebM ou PDF)." }, 400);
    }
    if (file.size > MAX_MARKETING_VIDEO_BYTES) {
      return json({ error: "Arquivo excede o limite máximo de 20 MB." }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const detected = detectAllowedMarketingMedia(bytes);
    if (!detected) {
      return json(
        { error: "Formato não suportado. Envie imagens (PNG, JPG, WebP), vídeos (MP4, WebM) ou PDF." },
        400,
      );
    }
    if (detected.mediaKind !== "VIDEO" && file.size > MAX_MARKETING_IMAGE_OR_PDF_BYTES) {
      return json({ error: "Imagens e PDFs devem ter no máximo 10 MB." }, 400);
    }

    const rawTitle = String(form.get("title") ?? "").replace(/\s+/g, " ").trim();
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    const title = (rawTitle || fallbackTitle || "Material de marketing").slice(0, 120);
    const description = String(form.get("description") ?? "").trim().slice(0, 600) || null;
    const folder = String(form.get("folder") ?? "Feed").replace(/\s+/g, " ").trim().slice(0, 50) || "Feed";
    const formatLabel = String(form.get("formatLabel") ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
    const caption = String(form.get("caption") ?? "").trim().slice(0, 2000) || null;

    const applyLogo = detected.mediaKind === "IMAGE" && String(form.get("applyLogo") ?? "1") !== "0";
    const logoPosition = normalizeLogoPosition(form.get("logoPosition"));
    const logoX = clampNumber(form.get("logoX"), 0, 100, 88);
    const logoY = clampNumber(form.get("logoY"), 0, 100, 88);
    const logoScale = Math.round(clampNumber(form.get("logoScale"), 8, 50, 22));
    const logoOpacity = Math.round(clampNumber(form.get("logoOpacity"), 30, 100, 100));
    const logoPadding = Math.round(clampNumber(form.get("logoPadding"), 0, 12, 4));
    const logoBackdrop = normalizeLogoBackdrop(form.get("logoBackdrop"));
    const logoVariant = normalizeLogoVariant(form.get("logoVariant"));
    const active = String(form.get("active") ?? "1") !== "0";

    const storedPath = await saveMarketingDriveFile(Buffer.from(arrayBuffer), detected.ext);

    const created = await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.create({
        data: {
          title,
          description,
          folder,
          formatLabel,
          caption,
          filePath: storedPath,
          fileName: file.name.slice(0, 160),
          mimeType: detected.mimeType,
          fileSize: file.size,
          mediaKind: detected.mediaKind,
          applyLogo,
          logoPosition,
          logoX,
          logoY,
          logoScale,
          logoOpacity,
          logoPadding,
          logoBackdrop,
          logoVariant,
          active,
        },
      }),
    );

    try {
      revalidatePath("/plataforma/materiais");
      revalidatePath("/parceiro/materiais");
    } catch {
      // Non-fatal
    }

    return json({ ok: true, asset: serializeMarketingAsset(created) }, 201);
  } catch (cause) {
    console.error("upload marketing asset failed", cause);
    return json({ error: "Não foi possível salvar o material no Drive." }, 500);
  }
}
