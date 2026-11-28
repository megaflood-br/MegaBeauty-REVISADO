import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import {
  clampNumber,
  normalizeLogoBackdrop,
  normalizeLogoPosition,
  normalizeLogoVariant,
} from "@/lib/marketing-drive";
import {
  deleteMarketingDriveFile,
  requirePlatformAdminApi,
  serializeMarketingAsset,
} from "@/lib/marketing-drive-storage";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePlatformAdminApi(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const { id } = await params;
    const existing = await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.findUnique({ where: { id } }),
    );
    if (!existing) return json({ error: "Material não encontrado." }, 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Corpo da requisição inválido." }, 400);
    }
    if (!body || typeof body !== "object") {
      return json({ error: "Dados inválidos." }, 400);
    }

    const input = body as Record<string, unknown>;
    const title =
      typeof input.title === "string"
        ? input.title.replace(/\s+/g, " ").trim().slice(0, 120) || existing.title
        : existing.title;
    const description =
      input.description !== undefined
        ? String(input.description ?? "").trim().slice(0, 600) || null
        : existing.description;
    const folder =
      typeof input.folder === "string"
        ? input.folder.replace(/\s+/g, " ").trim().slice(0, 50) || existing.folder
        : existing.folder;
    const formatLabel =
      input.formatLabel !== undefined
        ? String(input.formatLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null
        : existing.formatLabel;
    const caption =
      input.caption !== undefined
        ? String(input.caption ?? "").trim().slice(0, 2000) || null
        : existing.caption;

    const applyLogo =
      existing.mediaKind === "IMAGE"
        ? typeof input.applyLogo === "boolean"
          ? input.applyLogo
          : existing.applyLogo
        : false;
    const logoPosition =
      input.logoPosition !== undefined ? normalizeLogoPosition(input.logoPosition) : existing.logoPosition;
    const logoX = input.logoX !== undefined ? clampNumber(input.logoX, 0, 100, existing.logoX) : existing.logoX;
    const logoY = input.logoY !== undefined ? clampNumber(input.logoY, 0, 100, existing.logoY) : existing.logoY;
    const logoScale =
      input.logoScale !== undefined ? Math.round(clampNumber(input.logoScale, 8, 50, existing.logoScale)) : existing.logoScale;
    const logoOpacity =
      input.logoOpacity !== undefined
        ? Math.round(clampNumber(input.logoOpacity, 30, 100, existing.logoOpacity))
        : existing.logoOpacity;
    const logoPadding =
      input.logoPadding !== undefined
        ? Math.round(clampNumber(input.logoPadding, 0, 12, existing.logoPadding))
        : existing.logoPadding;
    const logoBackdrop =
      input.logoBackdrop !== undefined ? normalizeLogoBackdrop(input.logoBackdrop) : existing.logoBackdrop;
    const logoVariant =
      input.logoVariant !== undefined ? normalizeLogoVariant(input.logoVariant) : existing.logoVariant;
    const active = typeof input.active === "boolean" ? input.active : existing.active;

    const updated = await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.update({
        where: { id },
        data: {
          title,
          description,
          folder,
          formatLabel,
          caption,
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

    return json({ ok: true, asset: serializeMarketingAsset(updated) }, 200);
  } catch (cause) {
    console.error("update marketing asset failed", cause);
    return json({ error: "Não foi possível atualizar o material." }, 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePlatformAdminApi(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const { id } = await params;
    const existing = await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.findUnique({ where: { id } }),
    );
    if (!existing) return json({ error: "Material não encontrado." }, 404);

    await withoutTenantScope(() => prisma.partnerMarketingAsset.delete({ where: { id } }));
    await deleteMarketingDriveFile(existing.filePath);

    try {
      revalidatePath("/plataforma/materiais");
      revalidatePath("/parceiro/materiais");
    } catch {
      // Non-fatal
    }

    return json({ ok: true }, 200);
  } catch (cause) {
    console.error("delete marketing asset failed", cause);
    return json({ error: "Não foi possível excluir o material." }, 500);
  }
}
