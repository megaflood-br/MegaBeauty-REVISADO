import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/constants";

const PUBLIC_PREFIXES = ["/login", "/cadastro", "/agendar", "/api/webhooks", "/api/health"];
const STATIC_ASSET_RE = /\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|woff2?|ttf)$/i;

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || STATIC_ASSET_RE.test(pathname)) return NextResponse.next();
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const secretValue = process.env.AUTH_SECRET;
  if (!secretValue) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  try {
    const secret = new TextEncoder().encode(secretValue);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
