import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractInboundText, extractPhone } from "@/lib/evolution";

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant");
  if (!slug) return NextResponse.json({ error: "tenant query missing" }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return NextResponse.json({ error: "unknown tenant" }, { status: 404 });

  const expectedSecret = tenant.evolutionApiKey ?? process.env.EVOLUTION_API_KEY ?? "";
  const providedSecret =
    request.headers.get("apikey") ??
    request.headers.get("x-webhook-secret") ??
    "";

  if (!expectedSecret || !safeEqual(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const phone = extractPhone(payload);
  const body = extractInboundText(payload);
  if (!phone || !body) return NextResponse.json({ ok: true, ignored: true });

  const client = await prisma.client.findFirst({
    where: { tenantId: tenant.id, phone },
  });

  const conversation = await prisma.conversation.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
    update: { lastMessageAt: new Date(), unread: { increment: 1 }, clientId: client?.id },
    create: { tenantId: tenant.id, phone, clientId: client?.id, lastMessageAt: new Date(), unread: 1 },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "IN",
      body,
    },
  });

  return NextResponse.json({ ok: true });
}
