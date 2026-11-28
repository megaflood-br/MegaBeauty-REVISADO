export type WebImageKind = "product" | "service";

export type WebImageCandidate = {
  title: string;
  image: string;
  thumbnail: string;
  source: string;
  width: number;
  height: number;
};

const BEAUTY_SERVICE_HINT_RE =
  /\b(sal[aã]o|beleza|est[eé]tica|cabelo|capilar|unha|manicure|pedicure|c[ií]lios|sobrancelha|barba|barbearia|depila[cç][aã]o|massagem|maquiagem|make|penteado|escova|progressiva|colora[cç][aã]o|mechas|luzes|spa|facial|pele|peeling|botox|drenagem|micropigmenta[cç][aã]o|podologia|esmalta[cç][aã]o|alongamento)\b/i;

export function buildImageSearchQuery(
  rawName: string,
  kind: WebImageKind,
  rawBrand?: string | null,
): string {
  const name = rawName.trim().replace(/\s+/g, " ");
  const brand = (rawBrand ?? "").trim().replace(/\s+/g, " ");
  if (!name && !brand) return "";

  let query = name;
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
    query = query ? `${query} ${brand}` : brand;
  }

  if (kind === "service" && query && !BEAUTY_SERVICE_HINT_RE.test(query)) {
    query = `${query} salão de beleza`;
  }

  return query.slice(0, 120).trim();
}

export function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.trim().toLowerCase();
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateOrReservedIp(mapped);
    const hexParts = mapped.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        return isPrivateOrReservedIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
      }
    }
    return true;
  }

  // IPv4 check
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a >= 224) return true; // multicast & reserved
    return false;
  }

  // IPv6 check
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (ip.startsWith("ff")) return true; // multicast ff00::/8
  if (ip.startsWith("2001:db8:")) return true; // documentation

  return false;
}

const IPV4_LITERAL_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function parseSafePublicHttpsUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;

  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes(".")) return null;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".arpa")
  ) {
    return null;
  }

  // Reject raw IP literals (IPv4 or IPv6 in brackets)
  if (IPV4_LITERAL_RE.test(host) || host.startsWith("[") || host.includes(":")) {
    return null;
  }

  return parsed;
}

export type SafeRasterImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export function detectSafeRasterImageMime(bytes: Uint8Array): SafeRasterImageMime | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: GIF87a or GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
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
    return "image/webp";
  }

  return null;
}
