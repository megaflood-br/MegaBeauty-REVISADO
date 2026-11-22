import { prisma } from "@/lib/db";
import {
  extractEvolutionInstance,
  extractEvolutionMessageId,
  extractEvolutionNumber,
  extractInboundText,
  extractPhone,
  extractQrBase64,
  extractRawRemoteJid,
  extractWebhookMessagePayloads,
  isEvolutionFromMe,
  parseEvolutionState,
  resolveEvolutionLidPhone,
  evolutionWebhookKind,
} from "@/lib/evolution";
import { ingestInboundWhatsApp, ingestOutboundFromDevice } from "@/lib/whatsapp-inbound";
import { loadSalonEvolutionConfig } from "@/lib/whatsapp-send";

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
    return { ok: true as const, event: "connection" as const, state };
  }

  if (kind === "messages-update") {
    return { ok: true as const, event: "ack" as const };
  }

  const items = extractWebhookMessagePayloads(payload);
  let handled = 0;
  let lastEvent: "from-me" | "messages-upsert" | "ack" | "other" = "ack";
  let lastBotStatus: string | undefined;
  let lastPhoneSuffix: string | null = null;

  for (const item of items) {
    let phone = extractPhone(item);
    const body = extractInboundText(item);
    const waId = extractEvolutionMessageId(item) || null;
    const rawJid = extractRawRemoteJid(item);
    if (!phone) continue;
    if (!body) continue;

    // Live message traffic proves the Evolution session is open; heal stale "connecting" state so the bot can reply.
    await ensureEvolutionMarkedOpen(tenantId, instanceName);

    // If WhatsApp delivered an @lid JID without remoteJidAlt/senderPn, try resolving the real number via Evolution
    if (rawJid.includes("@lid") && phone === rawJid.split("@")[0].split(":")[0].replace(/\D/g, "")) {
      const config = await loadSalonEvolutionConfig(tenantId);
      if (config) {
        const resolved = await resolveEvolutionLidPhone(config, rawJid);
        if (resolved) phone = resolved;
      }
    }

    lastPhoneSuffix = phone.slice(-4) || null;

    if (isEvolutionFromMe(item)) {
      const outRes = await ingestOutboundFromDevice({ tenantId, phone, body, waId });
      handled += 1;
      lastEvent = "from-me";
      lastBotStatus = outRes.skipped ? `from-me:${outRes.skipped}` : "from-me:saved";
      continue;
    }

    const inRes = await ingestInboundWhatsApp({
      tenantId,
      phone,
      body,
      waId,
      channel: "evolution",
    });
    handled += 1;
    lastEvent = kind === "messages-upsert" ? "messages-upsert" : "other";
    lastBotStatus = inRes.botStatus;
  }

  if (handled === 0) {
    const phone = extractPhone(payload);
    return phone
      ? { ok: true as const, event: "ack" as const, detail: "ignored:empty-body" }
      : { ok: true as const, ignored: true as const, detail: "ignored:no-phone" };
  }
  return {
    ok: true as const,
    event: lastEvent,
    processed: handled,
    detail: lastBotStatus,
    phoneSuffix: lastPhoneSuffix,
  };
}
