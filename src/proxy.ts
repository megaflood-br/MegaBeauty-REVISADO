import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/constants";
import { hostSlugFromHost, PARTNER_REF_COOKIE, partnerSlugFromPath, sanitizePartnerSlug } from "@/lib/partners";
import {
  detectTenantFromRequest,
  INTERNAL_TENANT_HEADERS,
  resolveRootDomain,
  TENANT_ID_HEADER,
  TENANT_ROLE_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_SOURCE_HEADER,
  type DetectedRequestTenant,
} from "@/lib/tenant-routing";

const PUBLIC_PREFIXES = [
  "/login",
  "/cadastro",
  "/agendar",
  "/anamnese",
  "/p",
  "/pop",
  "/apresentacao",
  "/api/webhooks",
  "/api/health",
  "/uploads",
];

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function requestHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
}

function appRootDomain() {
  return resolveRootDomain(process.env.APP_URL, process.env.ROOT_DOMAIN);
}

function partnerSlugFromRequest(request: NextRequest) {
  const fromQuery = sanitizePartnerSlug(request.nextUrl.searchParams.get("ref"));
  const host = requestHost(request);
  const appHost = appRootDomain();
  return fromQuery || partnerSlugFromPath(request.nextUrl.pathname) || hostSlugFromHost(host, appHost);
}

function stampPartnerRef(request: NextRequest, response: NextResponse) {
  const slug = partnerSlugFromRequest(request);
  if (!slug) return response;
  response.cookies.set(PARTNER_REF_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

type VerifiedSessionClaims = {
  tenantId: string;
  role: string;
  impersonatorId?: string;
};

function buildForwardHeaders(
  request: NextRequest,
  detected: DetectedRequestTenant,
  session: VerifiedSessionClaims | null,
) {
  const headers = new Headers(request.headers);

  // Strip any untrusted client-supplied internal headers before stamping verified values.
  for (const headerName of INTERNAL_TENANT_HEADERS) {
    headers.delete(headerName);
  }

  headers.set("x-pathname", detected.effectivePathname);

  const partnerSlug = partnerSlugFromRequest(request);
  if (partnerSlug) headers.set("x-partner-ref", partnerSlug);

  if (detected.slug && detected.source) {
    headers.set(TENANT_SLUG_HEADER, detected.slug);
    headers.set(TENANT_SOURCE_HEADER, detected.source);
  }

  if (session) {
    headers.set(TENANT_ROLE_HEADER, session.role);
    const isPlatformScope = session.role === "SUPER_ADMIN" && !session.impersonatorId;
    if (!isPlatformScope && session.tenantId) {
      headers.set(TENANT_ID_HEADER, session.tenantId);
      if (!detected.source) {
        headers.set(TENANT_SOURCE_HEADER, "session");
      }
    }
  }

  return headers;
}

function forwardRequest(
  request: NextRequest,
  detected: DetectedRequestTenant,
  session: VerifiedSessionClaims | null,
) {
  const headers = buildForwardHeaders(request, detected, session);

  if (detected.rewritePath) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = detected.rewritePath;
    return stampPartnerRef(request, NextResponse.rewrite(rewriteUrl, { request: { headers } }));
  }

  return stampPartnerRef(request, NextResponse.next({ request: { headers } }));
}

const STATIC_ASSET_RE =
  /\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|woff2?|ttf|webmanifest|json|txt|xml)$/i;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || STATIC_ASSET_RE.test(pathname)) return NextResponse.next();

  const detected = detectTenantFromRequest({
    pathname,
    host: requestHost(request),
    rootDomain: appRootDomain(),
  });

  const publicRoute =
    detected.isPublicOverride !== null ? detected.isPublicOverride : isPublic(detected.effectivePathname);

  if (publicRoute) {
    // Public routes do not bind Prisma isolation to a session cookie; they rely on domain/path tenant detection.
    return forwardRequest(request, detected, null);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = detected.rewritePath && detected.slug ? `/t/${detected.slug}/login` : "/login";
    url.searchParams.set("next", pathname);
    return stampPartnerRef(request, NextResponse.redirect(url));
  }

  const secretValue = process.env.AUTH_SECRET;
  if (!secretValue) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return stampPartnerRef(request, NextResponse.redirect(url));
  }

  try {
    const secret = new TextEncoder().encode(secretValue);
    const { payload } = await jwtVerify(token, secret);
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
    const role = typeof payload.role === "string" ? payload.role : "";
    const impersonatorId =
      typeof payload.impersonatorId === "string" ? payload.impersonatorId : undefined;

    if (!tenantId || !role) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return stampPartnerRef(request, NextResponse.redirect(url));
    }

    return forwardRequest(request, detected, { tenantId, role, impersonatorId });
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = detected.rewritePath && detected.slug ? `/t/${detected.slug}/login` : "/login";
    return stampPartnerRef(request, NextResponse.redirect(url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
