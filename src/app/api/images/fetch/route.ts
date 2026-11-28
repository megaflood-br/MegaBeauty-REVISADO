import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkImageRateLimit, downloadSafeWebImage } from "@/lib/web-image-search-server";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!checkImageRateLimit(session.userId, "fetch", 40)) {
    return NextResponse.json(
      { error: "Muitas requisições em seguida. Aguarde alguns segundos." },
      { status: 429 },
    );
  }

  let body: { url?: unknown; fallbackUrl?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; fallbackUrl?: unknown };
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const fallbackUrl = typeof body.fallbackUrl === "string" ? body.fallbackUrl.trim() : "";

  if (!url && !fallbackUrl) {
    return NextResponse.json({ error: "Informe a URL da imagem." }, { status: 400 });
  }

  const result = await downloadSafeWebImage(url, fallbackUrl || undefined);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, dataUrl: result.dataUrl, mime: result.mime });
}
