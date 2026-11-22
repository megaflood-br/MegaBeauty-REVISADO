import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractEvolutionInstance } from "@/lib/evolution";
import { applyEvolutionWebhook } from "@/lib/evolution-webhook";
import { verifyEvolutionWebhookAuth } from "@/lib/evolution-webhook-auth";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { withTenantContext } from "@/lib/tenant-context";

function extractHeaderSecret(request: NextRequest) {
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

export async function handleEvolutionWebhookRequest(request: NextRequest, eventFromPath?: string) {
  let payload: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    payload = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (eventFromPath && !payload.event && !payload.type) {
    payload = { ...payload, event: eventFromPath };
  }

  const slugParam = (request.nextUrl.searchParams.get("tenant") ?? "").trim();
  const instanceName = extractEvolutionInstance(payload);

  if (!slugParam && !instanceName) {
    return NextResponse.json({ error: "tenant query missing" }, { status: 400 });
  }

  const tenant = slugParam
    ? await prisma.tenant.findUnique({
        where: { slug: slugParam },
        select: { id: true, slug: true, evolutionApiKey: true },
      })
    : await prisma.tenant.findFirst({
        where: { evolutionInstance: instanceName },
        select: { id: true, slug: true, evolutionApiKey: true },
      });

  if (!tenant) return NextResponse.json({ error: "unknown tenant" }, { status: 404 });

  const platform = await resolvePlatformIntegrations();
  const expectedSecret = (tenant.evolutionApiKey || platform.evolutionApiKey || "").trim();
  if (!expectedSecret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const authenticated = verifyEvolutionWebhookAuth({
    expectedSecret,
    slug: tenant.slug,
    headerSecret: extractHeaderSecret(request),
    queryToken: request.nextUrl.searchParams.get("token"),
    headerToken: request.headers.get("x-webhook-token"),
  });

  if (!authenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withTenantContext(tenant.id, () => applyEvolutionWebhook(tenant.id, payload));
  return NextResponse.json(result);
}
