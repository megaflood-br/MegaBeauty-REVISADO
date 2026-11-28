import crypto from "node:crypto";
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccess, resolveAccess } from "@/lib/permissions";
import { uploadRoot } from "@/lib/product-upload";
import { publicAppOrigin } from "@/lib/public-url";

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const OAUTH_STATE_VERSION = "ig1";

function stateSecret(): string {
  const raw = process.env.AUTH_SECRET?.trim();
  if (!raw) {
    throw new Error("AUTH_SECRET não configurado no servidor.");
  }
  return raw;
}

export type InstagramOAuthStatePayload = {
  v: string;
  tenantId: string;
  userId: string;
  exp: number;
  nonce: string;
};

export function signInstagramOAuthState(input: {
  tenantId: string;
  userId: string;
  secret?: string;
  now?: number;
}): string {
  const secret = input.secret ?? stateSecret();
  const payload: InstagramOAuthStatePayload = {
    v: OAUTH_STATE_VERSION,
    tenantId: input.tenantId,
    userId: input.userId,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyInstagramOAuthState(
  token: string,
  options?: { secret?: string; now?: number },
): InstagramOAuthStatePayload | null {
  const raw = String(token ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const secret = options?.secret ?? stateSecret();
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<InstagramOAuthStatePayload>;
    if (
      parsed.v !== OAUTH_STATE_VERSION ||
      typeof parsed.tenantId !== "string" ||
      !parsed.tenantId ||
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    const now = options?.now ?? Date.now();
    if (parsed.exp < now) return null;
    return {
      v: parsed.v,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      exp: parsed.exp,
      nonce: typeof parsed.nonce === "string" ? parsed.nonce : "",
    };
  } catch {
    return null;
  }
}

export function checkSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (!host) return true;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function resolvePublicOriginForRequest(request: Request, configuredPublicUrl?: string | null): string {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost && !forwardedHost.startsWith("localhost") && !forwardedHost.startsWith("127.0.0.1")) {
    return publicAppOrigin(`${forwardedProto}://${forwardedHost}`, false) || publicAppOrigin(configuredPublicUrl);
  }
  const fromEnv = publicAppOrigin(process.env.APP_URL, false);
  if (fromEnv) return fromEnv;
  const fromConfig = publicAppOrigin(configuredPublicUrl, false);
  if (fromConfig) return fromConfig;
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return "http://localhost:3000";
}

export async function requireSalonMarketingApi(
  request: Request,
  action: "create" | "edit" | "remove" | undefined = "edit",
) {
  if (request.method !== "GET" && request.method !== "HEAD" && !checkSameOriginRequest(request)) {
    return { ok: false as const, status: 403, error: "Origem da requisição não permitida." };
  }
  const session = await getSession();
  if (!session) {
    return { ok: false as const, status: 401, error: "Faça login para continuar." };
  }
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: session.tenantId } }),
    prisma.user.findUnique({
      where: { id: session.userId },
      include: { permissionProfile: true },
    }),
  ]);
  if (!tenant || tenant.isPlatform || tenant.kind !== "SALON") {
    return { ok: false as const, status: 403, error: "Disponível apenas para contas de salão." };
  }
  if (!user || !user.active || user.tenantId !== session.tenantId) {
    return { ok: false as const, status: 401, error: "Sessão inválida." };
  }
  const access = resolveAccess({
    role: user.role,
    professionalId: user.professionalId,
    profile: user.permissionProfile,
    accessJson: user.accessJson,
  });
  if (!canAccess(access, "marketing", action)) {
    return { ok: false as const, status: 403, error: "Sem permissão para editar Marketing." };
  }
  return { ok: true as const, session, tenant, user, access };
}

function detectImageExt(bytes: Uint8Array): ".jpg" | ".png" | ".webp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return ".webp";
  }
  return null;
}

export async function saveSalonMarketingArtwork(tenantId: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Imagem da arte inválida. Gere novamente a arte antes de salvar.");
  }
  const buffer = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ARTWORK_BYTES) {
    throw new Error("A imagem da arte excede o limite máximo de 8 MB.");
  }
  const ext = detectImageExt(new Uint8Array(buffer));
  if (!ext) {
    throw new Error("Formato de imagem não reconhecido.");
  }

  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeTenant) throw new Error("Tenant inválido.");

  const root = path.resolve(uploadRoot());
  const folder = path.resolve(root, "salon-marketing", safeTenant);
  if (!folder.startsWith(`${root}${path.sep}`)) {
    throw new Error("Caminho de upload inválido.");
  }
  await mkdir(folder, { recursive: true });

  const fileName = `${crypto.randomBytes(12).toString("hex")}${ext}`;
  const fullPath = path.resolve(folder, fileName);
  if (!fullPath.startsWith(`${folder}${path.sep}`)) {
    throw new Error("Arquivo de destino inválido.");
  }
  await writeFile(fullPath, buffer);
  return `/uploads/salon-marketing/${safeTenant}/${fileName}`;
}

export async function deleteSalonMarketingArtwork(tenantId: string, imageUrl: string): Promise<void> {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = `/uploads/salon-marketing/${safeTenant}/`;
  if (!safeTenant || !imageUrl.startsWith(prefix)) return;
  const fileName = imageUrl.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return;
  const root = path.resolve(uploadRoot());
  const target = path.resolve(root, "salon-marketing", safeTenant, fileName);
  if (!target.startsWith(`${root}${path.sep}`)) return;
  await unlink(target).catch(() => null);
}

type MetaErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

export async function publishInstagramMedia(input: {
  graphVersion: string;
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  publishTarget: "FEED" | "STORY";
}): Promise<{ ok: true; mediaId: string; permalink: string | null } | { ok: false; error: string }> {
  const version = input.graphVersion.startsWith("v") ? input.graphVersion : `v${input.graphVersion}`;
  const base = `https://graph.facebook.com/${version}`;

  const createParams = new URLSearchParams();
  createParams.set("image_url", input.imageUrl);
  createParams.set("access_token", input.accessToken);
  if (input.publishTarget === "STORY") {
    createParams.set("media_type", "STORIES");
  } else if (input.caption.trim()) {
    createParams.set("caption", input.caption.trim().slice(0, 2200));
  }

  const createRes = await fetch(`${base}/${encodeURIComponent(input.igUserId)}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: createParams.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const createJson = (await createRes.json().catch(() => ({}))) as { id?: string } & MetaErrorBody;
  if (!createRes.ok || !createJson.id) {
    return {
      ok: false,
      error:
        createJson.error?.message ||
        "A Meta rejeitou a imagem. Verifique se a URL pública do sistema está acessível via HTTPS.",
    };
  }

  const creationId = createJson.id;

  // Poll container status briefly (Meta recommends waiting until status_code === FINISHED)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 1800));
    const statusRes = await fetch(
      `${base}/${encodeURIComponent(creationId)}?fields=status_code&access_token=${encodeURIComponent(input.accessToken)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const statusJson = (await statusRes.json().catch(() => ({}))) as { status_code?: string };
    if (statusJson.status_code === "FINISHED" || !statusJson.status_code) break;
    if (statusJson.status_code === "ERROR") {
      return { ok: false, error: "A Meta não conseguiu processar esta arte para publicação." };
    }
  }

  const pubParams = new URLSearchParams();
  pubParams.set("creation_id", creationId);
  pubParams.set("access_token", input.accessToken);

  const pubRes = await fetch(`${base}/${encodeURIComponent(input.igUserId)}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: pubParams.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const pubJson = (await pubRes.json().catch(() => ({}))) as { id?: string } & MetaErrorBody;
  if (!pubRes.ok || !pubJson.id) {
    return {
      ok: false,
      error: pubJson.error?.message || "Não foi possível concluir a publicação no Instagram.",
    };
  }

  let permalink: string | null = null;
  try {
    const metaRes = await fetch(
      `${base}/${encodeURIComponent(pubJson.id)}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const metaJson = (await metaRes.json().catch(() => ({}))) as { permalink?: string };
    if (typeof metaJson.permalink === "string" && metaJson.permalink.startsWith("https://")) {
      permalink = metaJson.permalink;
    }
  } catch {
    permalink = null;
  }

  return { ok: true, mediaId: pubJson.id, permalink };
}
