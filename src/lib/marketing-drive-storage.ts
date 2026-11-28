import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getSession, isPlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { uploadRoot } from "@/lib/product-upload";
import type { MarketingAssetDto, MarketingMediaKind } from "@/lib/marketing-drive";
import { normalizeLogoBackdrop, normalizeLogoPosition, normalizeLogoVariant } from "@/lib/marketing-drive";

const DRIVE_SUBDIR = "marketing-drive";

export type PlatformAdminApiAuth =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export type MarketingReadApiAuth =
  | { ok: true; role: "PLATFORM" | "PARTNER"; userId: string; tenantId: string }
  | { ok: false; status: number; error: string };

export function verifySameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function requirePlatformAdminApi(request: Request): Promise<PlatformAdminApiAuth> {
  if (!verifySameOrigin(request)) {
    return { ok: false, status: 403, error: "Origem da requisição não autorizada." };
  }
  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, error: "Faça login como administrador da plataforma." };
  }
  if (!isPlatformAdmin(session.role) || session.impersonatorId) {
    return { ok: false, status: 403, error: "Acesso restrito à administração da plataforma." };
  }
  const user = await withoutTenantScope(() =>
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, active: true },
    }),
  );
  if (!user || !user.active || !isPlatformAdmin(user.role)) {
    return { ok: false, status: 403, error: "Permissão administrativa revogada." };
  }
  return { ok: true, userId: user.id };
}

export async function requireMarketingReadApi(): Promise<MarketingReadApiAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, error: "Faça login para acessar os materiais." };
  }

  if (isPlatformAdmin(session.role) && !session.impersonatorId) {
    const admin = await withoutTenantScope(() =>
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, role: true, active: true },
      }),
    );
    if (!admin || !admin.active || !isPlatformAdmin(admin.role)) {
      return { ok: false, status: 403, error: "Sem permissão para acessar este material." };
    }
    return { ok: true, role: "PLATFORM", userId: admin.id, tenantId: session.tenantId };
  }

  const tenant = await withoutTenantScope(() =>
    prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, kind: true, status: true },
    }),
  );
  if (!tenant || tenant.kind !== "PARTNER") {
    return { ok: false, status: 403, error: "Acesso exclusivo para parceiros e plataforma." };
  }
  if (tenant.status === "SUSPENDED" && !session.impersonatorId) {
    return { ok: false, status: 403, error: "Conta de parceiro suspensa." };
  }
  return { ok: true, role: "PARTNER", userId: session.userId, tenantId: tenant.id };
}

function driveBaseDir(): string {
  return path.resolve(uploadRoot(), DRIVE_SUBDIR);
}

export async function saveMarketingDriveFile(buffer: Buffer, ext: string): Promise<string> {
  const dir = driveBaseDir();
  await mkdir(dir, { recursive: true });
  const safeExt = ext.replace(/[^a-z0-9.]/gi, "").toLowerCase();
  const fileName = `${randomBytes(12).toString("hex")}${safeExt}`;
  const fullPath = path.resolve(dir, fileName);
  if (!fullPath.startsWith(`${dir}${path.sep}`)) {
    throw new Error("Caminho de arquivo inválido.");
  }
  await writeFile(fullPath, buffer);
  return `${DRIVE_SUBDIR}/${fileName}`;
}

export function resolveMarketingDriveFile(relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\/+/, "");
  if (!cleaned.startsWith(`${DRIVE_SUBDIR}/`)) return null;
  const fileName = cleaned.slice(`${DRIVE_SUBDIR}/`.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return null;
  }
  const dir = driveBaseDir();
  const resolved = path.resolve(dir, fileName);
  if (!resolved.startsWith(`${dir}${path.sep}`)) return null;
  return resolved;
}

export async function readMarketingDriveFile(relativePath: string): Promise<Buffer | null> {
  const full = resolveMarketingDriveFile(relativePath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function deleteMarketingDriveFile(relativePath: string): Promise<void> {
  const full = resolveMarketingDriveFile(relativePath);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    // Already removed
  }
}

export function serializeMarketingAsset(row: {
  id: string;
  title: string;
  description: string | null;
  folder: string;
  formatLabel: string | null;
  caption: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaKind: string;
  applyLogo: boolean;
  logoPosition: string;
  logoX: number;
  logoY: number;
  logoScale: number;
  logoOpacity: number;
  logoPadding: number;
  logoBackdrop: string;
  logoVariant: string;
  downloadsCount: number;
  active: boolean;
  createdAt: Date;
}): MarketingAssetDto {
  const mediaKind: MarketingMediaKind =
    row.mediaKind === "VIDEO" || row.mediaKind === "PDF" ? row.mediaKind : "IMAGE";
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    folder: row.folder,
    formatLabel: row.formatLabel,
    caption: row.caption,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    mediaKind,
    applyLogo: row.applyLogo,
    logoPosition: normalizeLogoPosition(row.logoPosition),
    logoX: row.logoX,
    logoY: row.logoY,
    logoScale: row.logoScale,
    logoOpacity: row.logoOpacity,
    logoPadding: row.logoPadding,
    logoBackdrop: normalizeLogoBackdrop(row.logoBackdrop),
    logoVariant: normalizeLogoVariant(row.logoVariant),
    downloadsCount: row.downloadsCount,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
