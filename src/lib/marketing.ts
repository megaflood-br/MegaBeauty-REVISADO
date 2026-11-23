import { prisma } from "@/lib/db";
import { calendarDate, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-campaigns";
import {
  MARKETING_CAP,
  isMarketingReply,
  marketingPhoneKeys,
  parseInactiveDays,
  phonesMatch,
  pickMarketingAudience,
  type MarketingAudience,
} from "@/lib/marketing-shared";

export * from "@/lib/marketing-shared";

export async function resolveMarketingAudience(input: {
  tenantId: string;
  audience: MarketingAudience;
  tag?: string;
  serviceId?: string;
  inactiveDays?: number;
  cap?: number;
}) {
  const cap = Math.min(MARKETING_CAP, Math.max(1, input.cap ?? MARKETING_CAP));
  const tag = String(input.tag ?? "").trim();
  const serviceId = String(input.serviceId ?? "").trim();
  const days = parseInactiveDays(input.inactiveDays);
  const cutoff = zonedDateTime(shiftCalendarDate(calendarDate(), -days), "00:00");

  if (input.audience === "SERVICE" && !serviceId) return [];

  const where = {
    tenantId: input.tenantId,
    active: true,
    notifications: true,
    phone: { not: "" },
    ...(input.audience === "INACTIVE"
      ? {
          appointments: {
            none: { startAt: { gte: cutoff }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          },
        }
      : {}),
    ...(input.audience === "TAG" && tag ? { tags: { contains: tag } } : {}),
    ...(input.audience === "SERVICE"
      ? {
          OR: [
            {
              appointments: {
                some: {
                  status: { notIn: ["CANCELLED", "NO_SHOW"] },
                  items: { some: { serviceId } },
                },
              },
            },
            {
              comandas: {
                some: {
                  status: { not: "CANCELLED" },
                  items: { some: { serviceId } },
                },
              },
            },
          ],
        }
      : {}),
  };

  const rows = await prisma.client.findMany({
    where,
    select: { id: true, name: true, phone: true, tags: true, active: true, notifications: true },
    orderBy: { name: "asc" },
    take: input.audience === "TAG" || input.audience === "SERVICE" ? cap * 4 : cap + 50,
  });

  return pickMarketingAudience(
    input.audience === "SERVICE" ? rows.map((row) => ({ ...row, serviceIds: [serviceId] })) : rows,
    {
      audience: input.audience,
      tag,
      serviceId,
      inactiveDays: days,
      cap,
    },
  ).map((client) => ({
    id: client.id,
    name: client.name,
    phone: normalizeWhatsAppPhone(client.phone),
  }));
}

export async function markMarketingReplies(input: {
  tenantId: string;
  phone: string;
  body: string;
  at?: Date;
  conversationId?: string | null;
}) {
  if (typeof prisma.marketingRecipient?.findMany !== "function") return 0;
  const keys = marketingPhoneKeys(input.phone);
  if (!keys.length) return 0;
  const at = input.at ?? new Date();
  const rows = await prisma.marketingRecipient.findMany({
    where: { tenantId: input.tenantId, status: "SENT", phone: { in: keys } },
    select: { id: true, sentAt: true, conversationId: true },
  });
  const hits = rows.filter((row) => isMarketingReply(row.sentAt, at));
  if (!hits.length) return 0;
  const preview = String(input.body ?? "").trim().slice(0, 140);
  await Promise.all(
    hits.map((row) =>
      prisma.marketingRecipient.update({
        where: { id: row.id },
        data: {
          status: "REPLIED",
          repliedAt: at,
          replyPreview: preview,
          conversationId: row.conversationId || input.conversationId,
        },
      }),
    ),
  );
  return hits.length;
}

export async function syncMarketingReplies(tenantId: string, campaignId?: string) {
  if (typeof prisma.marketingRecipient?.findMany !== "function") return 0;
  const sent = await prisma.marketingRecipient.findMany({
    where: { tenantId, status: "SENT", ...(campaignId ? { campaignId } : {}) },
    select: { id: true, phone: true, sentAt: true },
  });
  if (!sent.length) return 0;

  const keys = [...new Set(sent.flatMap((row) => marketingPhoneKeys(row.phone)))];
  const conversations = await prisma.conversation.findMany({
    where: { tenantId, phone: { in: keys } },
    select: {
      id: true,
      phone: true,
      messages: {
        where: { direction: "IN" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });

  let updated = 0;
  for (const row of sent) {
    const conversation = conversations.find((item) => phonesMatch(item.phone, row.phone));
    const inbound = conversation?.messages[0];
    if (!inbound || !isMarketingReply(row.sentAt, inbound.createdAt)) continue;
    await prisma.marketingRecipient.update({
      where: { id: row.id },
      data: {
        status: "REPLIED",
        repliedAt: inbound.createdAt,
        replyPreview: inbound.body.slice(0, 140),
        conversationId: conversation?.id,
      },
    });
    updated += 1;
  }
  return updated;
}
