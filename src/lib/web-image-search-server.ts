import dns from "node:dns/promises";
import {
  buildImageSearchQuery,
  detectSafeRasterImageMime,
  isPrivateOrReservedIp,
  parseSafePublicHttpsUrl,
  type SafeRasterImageMime,
  type WebImageCandidate,
  type WebImageKind,
} from "@/lib/web-image-search";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const MAX_IMAGE_BYTES = 2_500_000;
const MAX_REDIRECTS = 2;

type CacheEntry = { expiresAt: number; items: WebImageCandidate[] };
const searchCache = new Map<string, CacheEntry>();

const rateWindows = new Map<string, { resetAt: number; count: number }>();

export function checkImageRateLimit(userId: string, bucket: "search" | "fetch", limit: number): boolean {
  const now = Date.now();
  const key = `${bucket}:${userId}`;
  const existing = rateWindows.get(key);
  if (!existing || existing.resetAt <= now) {
    rateWindows.set(key, { resetAt: now + 60_000, count: 1 });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function pruneCache() {
  if (searchCache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of searchCache.entries()) {
    if (v.expiresAt <= now) searchCache.delete(k);
  }
  while (searchCache.size > MAX_CACHE_ENTRIES) {
    const first = searchCache.keys().next().value;
    if (!first) break;
    searchCache.delete(first);
  }
}

async function assertPublicHost(url: URL): Promise<boolean> {
  try {
    const records = await dns.lookup(url.hostname, { all: true });
    if (!records.length) return false;
    return records.every((record) => !isPrivateOrReservedIp(record.address));
  } catch {
    return false;
  }
}

function isLikelySvgUrl(rawUrl: string): boolean {
  return /\.svg(\?|#|$)/i.test(rawUrl);
}

async function searchDuckDuckGoImages(query: string): Promise<WebImageCandidate[]> {
  const tokenRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
      },
      signal: AbortSignal.timeout(7000),
    },
  );
  if (!tokenRes.ok) return [];
  const html = await tokenRes.text();
  const match = html.match(/vqd=["']?([\d-]+)["']?/) || html.match(/vqd=([\d-]+)&/);
  const vqd = match?.[1];
  if (!vqd) return [];

  // p=1 enforces SafeSearch strict
  const apiUrl = `https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://duckduckgo.com/",
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      image?: string;
      thumbnail?: string;
      source?: string;
      width?: number;
      height?: number;
    }>;
  };

  const items: WebImageCandidate[] = [];
  const seen = new Set<string>();

  for (const row of data.results ?? []) {
    if (items.length >= 8) break;
    const rawImg = typeof row.image === "string" ? row.image : "";
    const rawThumb = typeof row.thumbnail === "string" ? row.thumbnail : "";
    const safeImg = parseSafePublicHttpsUrl(rawImg);
    const safeThumb = parseSafePublicHttpsUrl(rawThumb);
    const chosenThumb = safeThumb?.toString() ?? safeImg?.toString() ?? "";
    const chosenImage = safeImg?.toString() ?? chosenThumb;

    if (!chosenImage || !chosenThumb) continue;
    if (isLikelySvgUrl(chosenImage)) continue;
    if (seen.has(chosenImage)) continue;
    const width = typeof row.width === "number" ? row.width : 0;
    const height = typeof row.height === "number" ? row.height : 0;
    if ((width > 0 && width < 120) || (height > 0 && height < 120)) continue;

    seen.add(chosenImage);
    items.push({
      title: String(row.title ?? query).slice(0, 120),
      image: chosenImage,
      thumbnail: chosenThumb,
      source: String(row.source ?? safeImg?.hostname ?? "Web").slice(0, 80),
      width,
      height,
    });
  }

  return items;
}

async function searchWikimediaFallback(query: string): Promise<WebImageCandidate[]> {
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=600&format=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "MegaBeautyCatalog/1.0 (https://megabeauty.app)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              mime?: string;
              width?: number;
              height?: number;
            }>;
          }
        >;
      };
    };

    const items: WebImageCandidate[] = [];
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (items.length >= 6) break;
      const info = page.imageinfo?.[0];
      if (!info?.mime || !["image/jpeg", "image/png", "image/webp"].includes(info.mime)) continue;
      const safeThumb = parseSafePublicHttpsUrl(info.thumburl ?? info.url ?? "");
      const safeImg = parseSafePublicHttpsUrl(info.url ?? info.thumburl ?? "");
      if (!safeThumb || !safeImg) continue;
      items.push({
        title: String(page.title ?? query).replace(/^File:/i, "").slice(0, 120),
        image: safeImg.toString(),
        thumbnail: safeThumb.toString(),
        source: "Wikimedia",
        width: info.width ?? 0,
        height: info.height ?? 0,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export async function searchWebImages(
  rawName: string,
  kind: WebImageKind,
  rawBrand?: string | null,
): Promise<{ query: string; items: WebImageCandidate[] }> {
  const query = buildImageSearchQuery(rawName, kind, rawBrand);
  if (query.length < 2) return { query, items: [] };

  const cacheKey = `${kind}:${query.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { query, items: cached.items };
  }

  let items: WebImageCandidate[] = [];
  try {
    items = await searchDuckDuckGoImages(query);
  } catch {
    items = [];
  }

  if (items.length === 0) {
    items = await searchWikimediaFallback(query);
  }

  if (items.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    pruneCache();
  }

  return { query, items };
}

async function fetchSingleSafeImage(
  rawUrl: string,
): Promise<{ dataUrl: string; mime: SafeRasterImageMime } | null> {
  let current = parseSafePublicHttpsUrl(rawUrl);
  if (!current) return null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostOk = await assertPublicHost(current);
    if (!hostOk) return null;

    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.5",
          Referer: `${current.origin}/`,
        },
        signal: AbortSignal.timeout(7000),
      });
    } catch {
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) return null;
      try {
        const nextUrl = new URL(location, current);
        const safeNext = parseSafePublicHttpsUrl(nextUrl.toString());
        if (!safeNext) return null;
        current = safeNext;
        continue;
      } catch {
        return null;
      }
    }

    if (!res.ok) return null;

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_IMAGE_BYTES) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }

    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const mime = detectSafeRasterImageMime(combined);
    if (!mime) return null;

    const base64 = Buffer.from(combined).toString("base64");
    return {
      dataUrl: `data:${mime};base64,${base64}`,
      mime,
    };
  }

  return null;
}

export async function downloadSafeWebImage(
  primaryUrl: string,
  fallbackUrl?: string | null,
): Promise<{ ok: true; dataUrl: string; mime: SafeRasterImageMime } | { ok: false; error: string }> {
  const candidates = [primaryUrl, fallbackUrl].filter((u): u is string => Boolean(u && u.trim()));
  if (candidates.length === 0) {
    return { ok: false, error: "URL da imagem não informada." };
  }

  for (const candidate of candidates) {
    const result = await fetchSingleSafeImage(candidate);
    if (result) {
      return { ok: true, dataUrl: result.dataUrl, mime: result.mime };
    }
  }

  return {
    ok: false,
    error: "Não foi possível baixar esta imagem (site bloqueou acesso ou formato inválido). Tente outra opção.",
  };
}
