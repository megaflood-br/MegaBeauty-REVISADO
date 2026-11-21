import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyEvolutionWebhook } from "@/lib/evolution-webhook";
import { resolvePlatformIntegrations } from "@/lib/integrations";

function secretsEqual(provided: string, expected: string) {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractWebhookSecret(request: NextRequest) {
  const direct =
    request.headers.get("apikey") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-evolution-apikey") ||
    "";
  if (direct.trim()) return direct.trim();
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

export async function POST(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant");
  if (!slug) return NextResponse.json({ error: "tenant query missing" }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, evolutionApiKey: true },
  });
  if (!tenant) return NextResponse.json({ error: "unknown tenant" }, { status: 404 });

  const platform = await resolvePlatformIntegrations();
  const expectedSecret = (tenant.evolutionApiKey || platform.evolutionApiKey || "").trim();
  if (!expectedSecret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const provided = extractWebhookSecret(request);
  if (!provided || !secretsEqual(provided, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await applyEvolutionWebhook(tenant.id, payload);
  return NextResponse.json(result);
}
