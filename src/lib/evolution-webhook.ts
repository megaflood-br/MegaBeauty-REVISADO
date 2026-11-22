import { prisma } from "@/lib/db";
import {
  extractEvolutionInstance,
  extractEvolutionMessageId,
  extractEvolutionNumber,
  extractInboundText,
  extractPhone,
  extractQrBase64,
  extractWebhookMessagePayloads,
  isEvolutionFromMe,
  parseEvolutionState,
  evolutionWebhookKind,
} from "@/lib/evolution";
import { ingestInboundWhatsApp, ingestOutboundFromDevice } from "@/lib/whatsapp-inbound";

async function ensureEvolutionMarkedOpen(tenantId: string, instanceName?: string) {
  await prisma.tenant.updateMany({
    where: { id: tenantId, evolutionStatus: { not: "open" } },
    data: { evolutionStatus: "open", evolutionQr: null },
  });
  if (instanceName) {
    await prisma.tenant.updateMany({
      where: { id: tenantId, evolutionInstance: null },
      data: { evolutionInstance: instanceName },
    });
  }
}

export async function applyEvolutionWebhook(tenantId: string, payload: Record<string, unknown>) {
  const kind = evolutionWebhookKind(payload);
  const instanceName = extractEvolutionInstance(payload);
  if (kind === "qrcode") {
    const qr = extractQrBase64(payload.data ?? payload) ?? extractQrBase64(payload);
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        evolutionStatus: "connecting",
        ...(qr ? { evolutionQr: qr } : {}),
        ...(instanceName ? { evolutionInstance: instanceName } : {}),
      },
    });
    return { ok: true as const, event: "qrcode" as const };
  }

  if (kind === "connection") {
    const state = parseEvolutionState(payload.data ?? payload);
    const number = extractEvolutionNumber(payload.data ?? payload) ?? extractEvolutionNumber(payload);
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        evolutionStatus: state,
        ...(instanceName ? { evolutionInstance: instanceName } : {}),
        ...(number ? { evolutionNumber: number } : {}),
        ...(state === "open" ? { evolutionQr: null } : {}),
      },
    });
    return { ok: true as const, event: "connection" as const };
  }

  if (kind === "messages-update") {
    return { ok: true as const, event: "ack" as const };
  }

  const items = extractWebhookMessagePayloads(payload);
  let handled = 0;
  let lastEvent: "from-me" | "messages-upsert" | "ack" | "other" = "ack";

  for (const item of items) {
    const phone = extractPhone(item);
    const body = extractInboundText(item);
    const waId = extractEvolutionMessageId(item) || null;
    if (!phone) continue;
    if (!body) continue;

    // Live message traffic proves the Evolution session is open; heal stale "connecting" state so the bot can reply.
    await ensureEvolutionMarkedOpen(tenantId, instanceName);

    if (isEvolutionFromMe(item)) {
      await ingestOutboundFromDevice({ tenantId, phone, body, waId });
      handled += 1;
      lastEvent = "from-me";
      continue;
    }

    await ingestInboundWhatsApp({
      tenantId,
      phone,
      body,
      waId,
      channel: "evolution",
    });
    handled += 1;
    lastEvent = kind === "messages-upsert" ? "messages-upsert" : "other";
  }

  if (handled === 0) {
    const phone = extractPhone(payload);
    return phone ? { ok: true as const, event: "ack" as const } : { ok: true as const, ignored: true as const };
  }
  return { ok: true as const, event: lastEvent, processed: handled };
}
