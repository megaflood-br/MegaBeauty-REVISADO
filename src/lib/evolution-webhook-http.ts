import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractEvolutionInstance } from "@/lib/evolution";
import { applyEvolutionWebhook } from "@/lib/evolution-webhook";
import { verifyEvolutionWebhookAuth } from "@/lib/evolution-webhook-auth";
import { recordEvolutionWebhookTrace } from "@/lib/evolution-webhook-log";
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

/**
 * When Evolution has `WEBHOOK_BY_EVENTS=true` on a URL with query parameters,
 * it appends `/<event-slug>` directly onto the last query parameter value
 * (e.g. `?tenant=renove&token=abc123/messages-upsert`). Split cleanly so both
 * the parameter value and the appended event slug are recovered.
 */
function splitQueryWithEventSuffix(raw: string | null) {
  const value = (raw ?? "").trim();
  const slashIdx = value.indexOf("/");
  if (slashIdx === -1) return { value, suffixEvent: "" };
  return {
    value: value.slice(0, slashIdx).trim(),
    suffixEvent: value.slice(slashIdx + 1).trim(),
  };
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

  const parsedTenant = splitQueryWithEventSuffix(request.nextUrl.searchParams.get("tenant"));
  const parsedToken = splitQueryWithEventSuffix(request.nextUrl.searchParams.get("token"));
  const resolvedEventHint = eventFromPath || parsedToken.suffixEvent || parsedTenant.suffixEvent;

  if (resolvedEventHint && !payload.event && !payload.type) {
    payload = { ...payload, event: resolvedEventHint };
  }

  const eventLabel = String(payload.event ?? payload.type ?? resolvedEventHint ?? "unknown");
  const slugParam = parsedTenant.value;
  const instanceName = extractEvolutionInstance(payload);

  if (!slugParam && !instanceName) {
    recordEvolutionWebhookTrace({
      tenantId: null,
      slug: null,
      instance: null,
      event: eventLabel,
      httpStatus: 400,
      outcome: "missing-tenant-and-instance",
      phoneSuffix: null,
    });
    return NextResponse.json({ error: "tenant query missing" }, { status: 400 });
  }

  let tenant = slugParam
    ? await prisma.tenant.findUnique({
        where: { slug: slugParam },
        select: { id: true, slug: true, evolutionApiKey: true },
      })
    : null;

  if (!tenant && instanceName) {
    tenant = await prisma.tenant.findFirst({
      where: { evolutionInstance: instanceName },
      select: { id: true, slug: true, evolutionApiKey: true },
    });
  }

  if (!tenant) {
    recordEvolutionWebhookTrace({
      tenantId: null,
      slug: slugParam || null,
      instance: instanceName || null,
      event: eventLabel,
      httpStatus: 404,
      outcome: "unknown-tenant",
      phoneSuffix: null,
    });
    return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
  }

  const platform = await resolvePlatformIntegrations();
  const expectedSecret = (tenant.evolutionApiKey || platform.evolutionApiKey || "").trim();
  if (!expectedSecret) {
    recordEvolutionWebhookTrace({
      tenantId: tenant.id,
      slug: tenant.slug,
      instance: instanceName || null,
      event: eventLabel,
      httpStatus: 503,
      outcome: "secret-not-configured",
      phoneSuffix: null,
    });
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const bodySecret = typeof payload.apikey === "string" ? payload.apikey : null;
  const authenticated = verifyEvolutionWebhookAuth({
    expectedSecret,
    slug: tenant.slug,
    headerSecret: extractHeaderSecret(request),
    bodySecret,
    queryToken: parsedToken.value,
    headerToken: request.headers.get("x-webhook-token"),
  });

  if (!authenticated) {
    recordEvolutionWebhookTrace({
      tenantId: tenant.id,
      slug: tenant.slug,
      instance: instanceName || null,
      event: eventLabel,
      httpStatus: 401,
      outcome: "unauthorized",
      phoneSuffix: null,
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withTenantContext(tenant.id, () => applyEvolutionWebhook(tenant.id, payload));
  const outcome =
    ("detail" in result && typeof result.detail === "string" && result.detail) ||
    ("event" in result && typeof result.event === "string" && result.event) ||
    ("ignored" in result && result.ignored ? "ignored" : "ok");
  const phoneSuffix = "phoneSuffix" in result && typeof result.phoneSuffix === "string" ? result.phoneSuffix : null;

  recordEvolutionWebhookTrace({
    tenantId: tenant.id,
    slug: tenant.slug,
    instance: instanceName || null,
    event: eventLabel,
    httpStatus: 200,
    outcome,
    phoneSuffix,
  });

  return NextResponse.json(result);
}
