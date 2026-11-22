import { prisma } from "@/lib/db";
import { markMarketingReplies } from "@/lib/marketing";
import { maybeReplyAsReceptionist } from "@/lib/receptionist-runtime";
import { whatsappPhoneCandidates } from "@/lib/whatsapp-campaigns";
import { botPausedUntilFromNow } from "@/lib/whatsapp-copy";
import { normalizeWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp-meta";

export function conversationPhoneCandidates(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return [];
  const out = new Set<string>([digits, ...whatsappPhoneCandidates(digits)]);

  // Brazilian mobile 9th-digit compatibility (DDD + 8 digits <-> DDD + 9 + 8 digits)
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === "9") {
    const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
    out.add(withoutNine);
    out.add(`55${withoutNine}`);
  } else if (local.length === 10) {
    const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    out.add(withNine);
    out.add(`55${withNine}`);
  }
  return [...out];
}

async function findMatchingConversation(tenantId: string, phone: string) {
  const candidates = conversationPhoneCandidates(phone);
  if (!candidates.length) return null;
  const rows = await prisma.conversation.findMany({
    where: { tenantId, phone: { in: candidates } },
    orderBy: { lastMessageAt: "desc" },
    take: 5,
    select: { id: true, phone: true, clientId: true },
  });
  return rows.find((row) => row.phone === phone) ?? rows[0] ?? null;
}

async function findMatchingClient(tenantId: string, phone: string) {
  const candidates = conversationPhoneCandidates(phone);
  if (!candidates.length) return null;
  return prisma.client.findFirst({
    where: { tenantId, phone: { in: candidates } },
    select: { id: true },
  });
}

async function duplicateMessage(conversationId: string, waId?: string | null) {
  if (!waId) return null;
  return prisma.message.findFirst({
    where: { conversationId, waId },
    select: { id: true, direction: true, body: true },
  });
}

export async function ingestOutboundFromDevice(input: {
  tenantId: string;
  phone: string;
  body: string;
  waId?: string | null;
}) {
  const phone = input.phone.replace(/\D/g, "");
  const body = input.body.trim();
  if (!phone || !body) return { skipped: "empty" as const };

  const existingConversation = await findMatchingConversation(input.tenantId, phone);

  if (existingConversation) {
    const existing = await duplicateMessage(existingConversation.id, input.waId);
    if (existing) return { skipped: "duplicate" as const, conversationId: existingConversation.id };

    const echo = await prisma.message.findFirst({
      where: {
        conversationId: existingConversation.id,
        direction: "OUT",
        body,
        createdAt: { gte: new Date(Date.now() - 30_000) },
      },
      select: { id: true, waId: true },
    });
    if (echo) {
      if (input.waId && !echo.waId) {
        await prisma.message.update({ where: { id: echo.id }, data: { waId: input.waId } });
      }
      return { skipped: "echo" as const, conversationId: existingConversation.id };
    }
  }

  const client = await findMatchingClient(input.tenantId, phone);
  const pausedUntil = botPausedUntilFromNow();
  const targetPhone = existingConversation?.phone ?? phone;
  const conversation = existingConversation
    ? await prisma.conversation.update({
        where: { id: existingConversation.id },
        data: { lastMessageAt: new Date(), clientId: client?.id ?? existingConversation.clientId, botPausedUntil: pausedUntil },
      })
    : await prisma.conversation.upsert({
        where: { tenantId_phone: { tenantId: input.tenantId, phone: targetPhone } },
        update: { lastMessageAt: new Date(), clientId: client?.id, botPausedUntil: pausedUntil },
        create: {
          tenantId: input.tenantId,
          phone: targetPhone,
          clientId: client?.id,
          lastMessageAt: new Date(),
          botPausedUntil: pausedUntil,
        },
      });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUT",
      body,
      source: "HUMAN",
      waId: input.waId || undefined,
    },
  });
  return { skipped: null, conversationId: conversation.id };
}

export async function ingestInboundWhatsApp(input: {
  tenantId: string;
  phone: string;
  body: string;
  waId?: string | null;
  channel: WhatsAppProvider;
}) {
  const phone = input.phone.replace(/\D/g, "");
  const body = input.body.trim();
  if (!phone || !body) return { skipped: "empty" as const, botStatus: "skipped:empty" };

  const [tenant, client, existingConversation] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { whatsappProvider: true },
    }),
    findMatchingClient(input.tenantId, phone),
    findMatchingConversation(input.tenantId, phone),
  ]);

  if (existingConversation) {
    const existing = await duplicateMessage(existingConversation.id, input.waId);
    if (existing) {
      return { skipped: "duplicate" as const, conversationId: existingConversation.id, botStatus: "duplicate" };
    }
  }

  const conversation = existingConversation
    ? await prisma.conversation.update({
        where: { id: existingConversation.id },
        data: {
          lastMessageAt: new Date(),
          unread: { increment: 1 },
          clientId: client?.id ?? existingConversation.clientId,
        },
      })
    : await prisma.conversation.upsert({
        where: { tenantId_phone: { tenantId: input.tenantId, phone } },
        update: { lastMessageAt: new Date(), unread: { increment: 1 }, clientId: client?.id },
        create: { tenantId: input.tenantId, phone, clientId: client?.id, lastMessageAt: new Date(), unread: 1 },
      });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "IN",
      body,
      waId: input.waId || undefined,
    },
  });

  await markMarketingReplies({
    tenantId: input.tenantId,
    phone,
    body,
    conversationId: conversation.id,
  }).catch(() => 0);

  const active = normalizeWhatsAppProvider(tenant?.whatsappProvider);
  if (active !== input.channel) {
    return {
      skipped: "other-channel" as const,
      conversationId: conversation.id,
      botStatus: `other-channel:${active}`,
    };
  }

  const reply = await maybeReplyAsReceptionist({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    phone,
    incoming: body,
  }).catch((error) => {
    console.error("[receptionist] auto-reply failed:", error);
    return { skipped: "error" as const };
  });

  const botStatus = reply && "skipped" in reply && reply.skipped ? `bot-skipped:${reply.skipped}` : "bot-replied";
  return { skipped: null, conversationId: conversation.id, botStatus };
}
