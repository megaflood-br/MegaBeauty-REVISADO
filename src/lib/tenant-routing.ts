import { slugify } from "@/lib/utils";

export const TENANT_ID_HEADER = "x-tenant-id";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
export const TENANT_SOURCE_HEADER = "x-tenant-source";
export const TENANT_ROLE_HEADER = "x-tenant-role";

export type TenantDetectionSource = "domain" | "path" | "session";

/**
 * Headers stamped exclusively by `src/proxy.ts`.
 * Any incoming client value on these headers is stripped before routing.
 */
export const INTERNAL_TENANT_HEADERS = [
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_SOURCE_HEADER,
  TENANT_ROLE_HEADER,
  "x-pathname",
  "x-partner-ref",
] as const;

export const RESERVED_TENANT_SLUGS = new Set([
  "www",
  "app",
  "api",
  "mail",
  "cdn",
  "static",
  "assets",
  "admin",
  "login",
  "cadastro",
  "plataforma",
  "fornecedor",
  "parceiro",
  "p",
  "t",
  "beauty",
  "megabeauty",
  "dashboard",
  "uploads",
  "apresentacao",
  "agendar",
  "anamnese",
  "pop",
  "localhost",
  "suporte",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function sanitizeTenantSlug(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const slug = slugify(raw);
  if (!slug || slug.length < 2 || !SLUG_RE.test(slug) || RESERVED_TENANT_SLUGS.has(slug)) {
    return "";
  }
  return slug;
}

export function normalizeHost(host: string | null | undefined): string {
  return String(host ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "");
}

export function resolveRootDomain(appUrl?: string | null, rootDomainEnv?: string | null): string {
  const explicit = normalizeHost(rootDomainEnv);
  if (explicit) return explicit;
  return normalizeHost(appUrl || "https://beauty.megaflood.cloud");
}

/**
 * Extracts a tenant slug from the request Host header:
 * - Production subdomain: `studio-aurora.beauty.megaflood.cloud` -> `studio-aurora`
 * - Localhost subdomain: `studio-aurora.localhost:3000` -> `studio-aurora`
 * Returns "" for the root app host, IP addresses, or reserved subdomains.
 */
export function tenantSlugFromHost(host: string | null | undefined, rootDomain?: string | null): string {
  const hostname = normalizeHost(host);
  if (!hostname || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return "";

  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    if (sub && !sub.includes(".")) return sanitizeTenantSlug(sub);
    return "";
  }

  const root = normalizeHost(rootDomain);
  if (!root || hostname === root || hostname === `www.${root}`) return "";

  if (hostname.endsWith(`.${root}`)) {
    const sub = hostname.slice(0, -(root.length + 1));
    if (sub && !sub.includes(".")) return sanitizeTenantSlug(sub);
  }

  return "";
}

export type PathTenantMatch = {
  slug: string;
  source: "path";
  /** Internal pathname to rewrite to (when using `/t/[slug]/...` prefix), or null if path already maps natively. */
  rewritePath: string | null;
  /** Whether the resolved path is publicly accessible without a session cookie. */
  isPublicPath: boolean;
};

const TENANT_PUBLIC_SUBPATHS = new Set(["", "/", "/login", "/cadastro", "/agendar"]);

/**
 * Detects tenant slug from path-based URLs:
 * - `/t/<slug>` -> rewrites to `/agendar/<slug>` (public)
 * - `/t/<slug>/agendar` -> rewrites to `/agendar/<slug>` (public)
 * - `/t/<slug>/pop/<popSlug>` -> rewrites to `/pop/<slug>/<popSlug>` (public)
 * - `/t/<slug>/login` -> rewrites to `/login` (public, tenant-bound)
 * - `/t/<slug>/cadastro` -> rewrites to `/cadastro` (public)
 * - `/t/<slug>/<panelPath>` -> rewrites to `/<panelPath>` (protected, tenant-verified)
 * - `/agendar/<slug>` or `/pop/<slug>/...` -> native public tenant route (no rewrite)
 */
export function matchTenantPath(pathname: string): PathTenantMatch | null {
  const cleanPath = String(pathname || "/").split("?")[0] || "/";

  const prefixed = cleanPath.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (prefixed) {
    const slug = sanitizeTenantSlug(decodeSafe(prefixed[1]));
    if (!slug) return null;
    const rest = prefixed[2] || "";

    if (!rest || rest === "/" || rest === "/agendar" || rest === "/agendar/") {
      return {
        slug,
        source: "path",
        rewritePath: `/agendar/${encodeURIComponent(slug)}`,
        isPublicPath: true,
      };
    }

    const popMatch = rest.match(/^\/pop\/([^/]+)\/?$/);
    if (popMatch) {
      return {
        slug,
        source: "path",
        rewritePath: `/pop/${encodeURIComponent(slug)}/${encodeURIComponent(decodeSafe(popMatch[1]))}`,
        isPublicPath: true,
      };
    }

    const normalizedRest = rest.endsWith("/") && rest.length > 1 ? rest.slice(0, -1) : rest;
    const isPublicPath =
      TENANT_PUBLIC_SUBPATHS.has(normalizedRest) ||
      normalizedRest.startsWith("/anamnese/") ||
      normalizedRest.startsWith("/apresentacao");

    return {
      slug,
      source: "path",
      rewritePath: normalizedRest,
      isPublicPath,
    };
  }

  const booking = cleanPath.match(/^\/agendar\/([^/]+)(?:\/|$)/);
  if (booking) {
    const slug = sanitizeTenantSlug(decodeSafe(booking[1]));
    if (slug) return { slug, source: "path", rewritePath: null, isPublicPath: true };
  }

  const pop = cleanPath.match(/^\/pop\/([^/]+)(?:\/|$)/);
  if (pop) {
    const slug = sanitizeTenantSlug(decodeSafe(pop[1]));
    if (slug) return { slug, source: "path", rewritePath: null, isPublicPath: true };
  }

  return null;
}

export type DetectedRequestTenant = {
  slug: string;
  source: TenantDetectionSource | "";
  rewritePath: string | null;
  effectivePathname: string;
  isPublicOverride: boolean | null;
};

/**
 * Resolves tenant context from a request's path or Host header.
 * Path-based `/t/<slug>/...` takes precedence over subdomain when both are present.
 */
export function detectTenantFromRequest(input: {
  pathname: string;
  host?: string | null;
  rootDomain?: string | null;
}): DetectedRequestTenant {
  const pathMatch = matchTenantPath(input.pathname);
  if (pathMatch) {
    return {
      slug: pathMatch.slug,
      source: "path",
      rewritePath: pathMatch.rewritePath,
      effectivePathname: pathMatch.rewritePath ?? input.pathname,
      isPublicOverride: pathMatch.rewritePath ? pathMatch.isPublicPath : null,
    };
  }

  const hostSlug = tenantSlugFromHost(input.host, input.rootDomain);
  if (hostSlug) {
    return {
      slug: hostSlug,
      source: "domain",
      rewritePath: null,
      effectivePathname: input.pathname,
      isPublicOverride: null,
    };
  }

  return {
    slug: "",
    source: "",
    rewritePath: null,
    effectivePathname: input.pathname,
    isPublicOverride: null,
  };
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
