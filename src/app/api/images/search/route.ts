import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkImageRateLimit, searchWebImages } from "@/lib/web-image-search-server";
import type { WebImageKind } from "@/lib/web-image-search";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!checkImageRateLimit(session.userId, "search", 30)) {
    return NextResponse.json(
      { error: "Muitas buscas em seguida. Aguarde alguns segundos e tente novamente." },
      { status: 429 },
    );
  }

  const { searchParams } = request.nextUrl;
  const q = String(searchParams.get("q") ?? "").trim().slice(0, 120);
  const brand = String(searchParams.get("brand") ?? "").trim().slice(0, 60);
  const kindParam = searchParams.get("kind");
  const kind: WebImageKind = kindParam === "service" ? "service" : "product";

  if (q.length < 2) {
    return NextResponse.json(
      { error: "Digite pelo menos 2 caracteres para buscar fotos." },
      { status: 400 },
    );
  }

  const { query, items } = await searchWebImages(q, kind, brand);
  return NextResponse.json({ ok: true, query, items });
}
