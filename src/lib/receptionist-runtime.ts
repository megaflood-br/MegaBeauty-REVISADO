import type OpenAI from "openai";
import { prisma } from "@/lib/db";
import { calendarDate, formatDayLabel, formatTime, rangeOfCalendarDate, shiftCalendarDate } from "@/lib/dates";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { sendSalonWhatsApp } from "@/lib/whatsapp-send";
import { isConfirmReply, isConversationBotPaused, looksLikeReminderPrompt, spin } from "@/lib/whatsapp-copy";
import { chatAsReceptionist } from "@/lib/openai";
import {
  MAX_LOOKAHEAD_DAYS,
  calendarDayDiff,
  clampDurationMin,
  contiguousSlotsForDuration,
  formatAvailabilityForPrompt,
  formatAvailabilitySlots,
  isValidCalendarDate,
  parseRequestedDate,
  parseRequestedTime,
  type AvailabilityDayResult,
} from "@/lib/receptionist-availability";
import {
  DEFAULT_RECEPTIONIST,
  buildReceptionistSystemPrompt,
  formatServicePrice,
  localReceptionistReply,
  matchCatalogProfessional,
  matchCatalogService,
  normalizeReceptionist,
  resolveAvailabilityIntentFromMessages,
  wantsHumanHandover,
  type ReceptionistCatalog,
  type ReceptionistConfig,
  type ReceptionistHistoryItem,
} from "@/lib/receptionist";

export async function loadReceptionistConfig(tenantId: string): Promise<ReceptionistConfig> {
  const row = await prisma.receptionist.findUnique({ where: { tenantId } });
  if (!row) return DEFAULT_RECEPTIONIST;
  return normalizeReceptionist({
    enabled: row.enabled,
    name: row.name,
    avatarUrl: row.avatarUrl,
    style: row.style,
    personality: row.personality,
    emoji: row.emoji,
    instructions: row.instructions,
  });
}

export async function ensureReceptionist(tenantId: string) {
  const existing = await prisma.receptionist.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.receptionist.create({
    data: {
      tenantId,
      name: DEFAULT_RECEPTIONIST.name,
      avatarUrl: DEFAULT_RECEPTIONIST.avatarUrl,
      style: DEFAULT_RECEPTIONIST.style,
      personality: DEFAULT_RECEPTIONIST.personality,
      emoji: DEFAULT_RECEPTIONIST.emoji,
    },
  });
}

function busyForDayRange(
  appointments: { professionalId: string; startAt: Date; endAt: Date }[],
  professionalId: string,
  dayRange: { start: Date; end: Date },
) {
  return appointments
    .filter((item) => item.professionalId === professionalId && item.startAt < dayRange.end && item.endAt > dayRange.start)
    .map((item) => ({
      start: item.startAt <= dayRange.start ? "00:00" : formatTime(item.startAt),
      end: item.endAt >= dayRange.end ? "24:00" : formatTime(item.endAt),
    }));
}

export async function loadReceptionistCatalog(tenantId: string): Promise<ReceptionistCatalog> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, city: true, openTime: true, closeTime: true, slotMinutes: true },
  });
  if (!tenant) {
    return { salon: "Salão", city: null, hours: "—", services: [], professionals: [] };
  }

  const today = calendarDate();
  const tomorrow = shiftCalendarDate(today, 1);
  const todayRange = rangeOfCalendarDate(today);
  const tomorrowRange = rangeOfCalendarDate(tomorrow);
  const nowHHmm = formatTime(new Date());

  const [services, professionals, appointments] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId, active: true },
      orderBy: { name: "asc" },
      select: {
        name: true,
        durationMin: true,
        priceCents: true,
        professionals: { select: { professional: { select: { name: true, active: true } } } },
      },
    }),
    prisma.professional.findMany({
      where: { tenantId, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, nickname: true, specialty: true, workStart: true, workEnd: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        status: { not: "CANCELLED" },
        startAt: { lt: tomorrowRange.end },
        endAt: { gt: todayRange.start },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    }),
  ]);

  return {
    salon: tenant.name,
    city: tenant.city,
    hours: `${tenant.openTime} às ${tenant.closeTime}`,
    todayDate: today,
    todayLabel: formatDayLabel(today),
    nowHHmm,
    slotMinutes: tenant.slotMinutes,
    services: services.map((service) => ({
      name: service.name,
      durationMin: service.durationMin,
      price: formatServicePrice(service.priceCents),
      professionals: service.professionals
        .filter((row) => row.professional.active)
        .map((row) => row.professional.name),
    })),
    professionals: professionals.map((row) => {
      const openTime = row.workStart || tenant.openTime;
      const closeTime = row.workEnd || tenant.closeTime;
      const todayBusy = busyForDayRange(appointments, row.id, todayRange);
      const tomorrowBusy = busyForDayRange(appointments, row.id, tomorrowRange);
      return {
        name: row.name,
        nickname: row.nickname,
        specialty: row.specialty,
        today: contiguousSlotsForDuration({
          openTime,
          closeTime,
          slotMinutes: tenant.slotMinutes,
          durationMin: tenant.slotMinutes,
          nowHHmm,
          busy: todayBusy,
        }),
        tomorrow: contiguousSlotsForDuration({
          openTime,
          closeTime,
          slotMinutes: tenant.slotMinutes,
          durationMin: tenant.slotMinutes,
          busy: tomorrowBusy,
        }),
      };
    }),
  };
}

export async function queryReceptionistAvailability(input: {
  tenantId: string;
  date: string;
  serviceName?: string | null;
  professionalName?: string | null;
  durationMin?: number | null;
  requestedTime?: string | null;
  referenceDate?: string;
  nowHHmm?: string;
}): Promise<AvailabilityDayResult> {
  const today = input.referenceDate && isValidCalendarDate(input.referenceDate) ? input.referenceDate : calendarDate();
  const parsed = isValidCalendarDate(input.date)
    ? {
        date: input.date,
        label: formatDayLabel(input.date),
        isPast: calendarDayDiff(today, input.date) < 0,
        outOfRange: calendarDayDiff(today, input.date) > MAX_LOOKAHEAD_DAYS,
      }
    : parseRequestedDate(input.date, today);

  const targetDate = parsed?.date ?? today;
  const targetLabel = parsed?.label ?? formatDayLabel(targetDate);
  const diff = calendarDayDiff(today, targetDate);
  const isPast = diff < 0;
  const outOfRange = diff > MAX_LOOKAHEAD_DAYS;
  const normalizedRequestedTime = input.requestedTime ? parseRequestedTime(input.requestedTime) : null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { openTime: true, closeTime: true, slotMinutes: true },
  });
  const slotMinutes = tenant?.slotMinutes ?? 15;
  const fallbackDuration = clampDurationMin(input.durationMin, slotMinutes);

  if (!tenant || isPast || outOfRange) {
    return {
      date: targetDate,
      label: targetLabel,
      durationMin: fallbackDuration,
      serviceName: input.serviceName ?? null,
      slotMinutes,
      isPast,
      outOfRange,
      requestedTime: normalizedRequestedTime,
      currentTimeHHmm: targetDate === today ? (input.nowHHmm ?? formatTime(new Date())) : null,
      professionals: [],
    };
  }

  const dayRange = rangeOfCalendarDate(targetDate);
  const [services, professionals, appointments] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId: input.tenantId, active: true },
      orderBy: { name: "asc" },
      select: {
        name: true,
        durationMin: true,
        priceCents: true,
        professionals: { select: { professional: { select: { id: true, name: true, active: true } } } },
      },
    }),
    prisma.professional.findMany({
      where: { tenantId: input.tenantId, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, nickname: true, specialty: true, workStart: true, workEnd: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId: input.tenantId,
        status: { not: "CANCELLED" },
        startAt: { lt: dayRange.end },
        endAt: { gt: dayRange.start },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    }),
  ]);

  const catalogServices = services.map((service) => ({
    name: service.name,
    durationMin: service.durationMin,
    price: formatServicePrice(service.priceCents),
    professionals: service.professionals.filter((p) => p.professional.active).map((p) => p.professional.name),
    professionalIds: service.professionals.filter((p) => p.professional.active).map((p) => p.professional.id),
  }));

  const matchedService = input.serviceName
    ? matchCatalogService(input.serviceName, catalogServices)
    : null;
  const matchedServiceFull = matchedService
    ? catalogServices.find((item) => item.name === matchedService.name) ?? null
    : null;

  const durationMin = matchedServiceFull
    ? clampDurationMin(matchedServiceFull.durationMin, slotMinutes)
    : clampDurationMin(input.durationMin, slotMinutes);

  let eligible = professionals;
  if (matchedServiceFull && matchedServiceFull.professionalIds.length > 0) {
    const allowedIds = new Set(matchedServiceFull.professionalIds);
    eligible = eligible.filter((prof) => allowedIds.has(prof.id));
  }

  if (input.professionalName) {
    const matchedProf = matchCatalogProfessional(
      input.professionalName,
      professionals.map((row) => ({
        name: row.name,
        nickname: row.nickname,
        specialty: row.specialty,
        today: [],
        tomorrow: [],
      })),
    );
    eligible = matchedProf ? eligible.filter((row) => row.name === matchedProf.name) : [];
  }

  const effectiveNow = targetDate === today ? (input.nowHHmm ?? formatTime(new Date())) : undefined;

  return {
    date: targetDate,
    label: targetLabel,
    durationMin,
    serviceName: matchedServiceFull?.name ?? null,
    slotMinutes,
    isPast: false,
    outOfRange: false,
    requestedTime: normalizedRequestedTime,
    currentTimeHHmm: effectiveNow ?? null,
    professionals: eligible.map((row) => {
      const openTime = row.workStart || tenant.openTime;
      const closeTime = row.workEnd || tenant.closeTime;
      const busy = busyForDayRange(appointments, row.id, dayRange);
      const startTimes = contiguousSlotsForDuration({
        openTime,
        closeTime,
        slotMinutes,
        durationMin,
        busy,
        nowHHmm: effectiveNow,
      });
      return {
        name: row.name,
        nickname: row.nickname,
        specialty: row.specialty,
        startTimes,
        summary: formatAvailabilitySlots(startTimes, slotMinutes),
        busy,
        workStart: openTime,
        workEnd: closeTime,
      };
    }),
  };
}

const CHECK_AVAILABILITY_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "check_availability",
    description:
      "Consulta a agenda real do salão para uma data (hoje até 60 dias à frente) calculando horários de início exatos em bloco contínuo para a duração completa do serviço e validando um horário específico se a cliente perguntou.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Data desejada no formato YYYY-MM-DD (ex.: 2026-11-28) ou expressão em português (ex.: hoje, sexta que vem, dia 28).",
        },
        requestedTime: {
          type: "string",
          description: "Horário específico perguntado pela cliente no formato HH:mm (ex.: 14:00), se houver.",
        },
        serviceName: {
          type: "string",
          description: "Nome do serviço do catálogo (usado para filtrar profissionais habilitadas e duração exata).",
        },
        professionalName: {
          type: "string",
          description: "Nome ou apelido da profissional, se a cliente pediu alguém específico.",
        },
        durationMin: {
          type: "integer",
          description: "Duração em minutos (5 a 600), caso a cliente não tenha informado um serviço do catálogo.",
        },
      },
      required: ["date"],
    },
  },
};

export async function generateReceptionistReply(input: {
  tenantId?: string;
  config: ReceptionistConfig;
  catalog: ReceptionistCatalog;
  incoming: string;
  history?: ReceptionistHistoryItem[];
  apiKey?: string | null;
}) {
  const handover = wantsHumanHandover(input.incoming);
  if (handover) {
    const local = localReceptionistReply({
      config: input.config,
      catalog: input.catalog,
      incoming: input.incoming,
    });
    return { text: local.text, handover: true, source: "local" as const };
  }

  let precomputedAvailability: AvailabilityDayResult | null = null;
  if (input.tenantId) {
    const intent = resolveAvailabilityIntentFromMessages({
      incoming: input.incoming,
      history: input.history,
      catalog: input.catalog,
      referenceDate: input.catalog.todayDate,
    });

    const shouldQueryAvailability =
      Boolean(intent.dateMatch) ||
      Boolean(intent.requestedTime) ||
      (intent.asksForSlots && Boolean(intent.service || intent.professional || intent.explicitDurationMin));

    if (shouldQueryAvailability) {
      const today = input.catalog.todayDate ?? calendarDate();
      const requestedDate = intent.dateMatch?.date ?? today;
      let result = await queryReceptionistAvailability({
        tenantId: input.tenantId,
        date: requestedDate,
        serviceName: intent.service?.name ?? null,
        professionalName: intent.professional?.name ?? null,
        durationMin: intent.service?.durationMin ?? intent.explicitDurationMin ?? null,
        requestedTime: intent.requestedTime,
        referenceDate: today,
        nowHHmm: input.catalog.nowHHmm,
      });

      // If client asked generally ("tem vaga para luzes?") without naming a date and today has no contiguous block, check tomorrow automatically
      const hasAnySlot = result.professionals.some((row) => row.startTimes.length > 0);
      if (!intent.dateMatch && !hasAnySlot) {
        const tomorrowResult = await queryReceptionistAvailability({
          tenantId: input.tenantId,
          date: shiftCalendarDate(today, 1),
          serviceName: intent.service?.name ?? null,
          professionalName: intent.professional?.name ?? null,
          durationMin: intent.service?.durationMin ?? intent.explicitDurationMin ?? null,
          requestedTime: intent.requestedTime,
          referenceDate: today,
        });
        if (tomorrowResult.professionals.some((row) => row.startTimes.length > 0)) {
          result = tomorrowResult;
        }
      }
      precomputedAvailability = result;
    }
  }

  const local = localReceptionistReply({
    config: input.config,
    catalog: input.catalog,
    incoming: input.incoming,
    availability: precomputedAvailability,
  });

  try {
    const openai = await chatAsReceptionist({
      apiKey: input.apiKey,
      system: buildReceptionistSystemPrompt(input.config, input.catalog, precomputedAvailability),
      incoming: input.incoming,
      history: input.history,
      tools: input.tenantId ? [CHECK_AVAILABILITY_TOOL] : undefined,
      onToolCall: input.tenantId
        ? async (name, args) => {
            if (name !== "check_availability") return "Ferramenta desconhecida.";
            const rawDate = typeof args.date === "string" ? args.date.trim() : "";
            const refDate = input.catalog.todayDate ?? calendarDate();
            const resolvedDate = isValidCalendarDate(rawDate) ? rawDate : parseRequestedDate(rawDate, refDate)?.date ?? "";
            if (!resolvedDate) return "Data inválida. Peça à cliente uma data válida (ex.: 28/11 ou sexta que vem).";
            const result = await queryReceptionistAvailability({
              tenantId: input.tenantId!,
              date: resolvedDate,
              requestedTime: typeof args.requestedTime === "string" ? args.requestedTime.trim() : null,
              serviceName: typeof args.serviceName === "string" ? args.serviceName.trim() : null,
              professionalName: typeof args.professionalName === "string" ? args.professionalName.trim() : null,
              durationMin: typeof args.durationMin === "number" ? args.durationMin : null,
              referenceDate: refDate,
              nowHHmm: input.catalog.nowHHmm,
            });
            return formatAvailabilityForPrompt(result);
          }
        : undefined,
    });
    if (openai) return { text: openai.slice(0, 700), handover: false, source: "openai" as const };
  } catch {
    // fallback local
  }
  return { text: local.text, handover: false, source: "local" as const };
}

export async function maybeReplyAsReceptionist(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  incoming: string;
}) {
  const [config, conversation] = await Promise.all([
    loadReceptionistConfig(input.tenantId),
    prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 12 } },
    }),
  ]);
  if (!config.enabled) return { skipped: "off" as const };
  if (!conversation || isConversationBotPaused(conversation)) return { skipped: "paused" as const };
  if (!conversation.messages.some((row) => row.direction === "IN")) return { skipped: "receptive" as const };

  const lastOut = conversation.messages.find((row) => row.direction === "OUT");
  if (isConfirmReply(input.incoming) && lastOut && looksLikeReminderPrompt(lastOut.body)) {
    await confirmNextAppointment(input.tenantId, conversation.clientId, conversation.phone);
    const text = spin("{Recebi|Combinado|Fechado}! Horário confirmado, te esperamos.");
    await sendSalonWhatsApp({ tenantId: input.tenantId, phone: input.phone, text, presence: true }).catch(() => null);
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "OUT", body: text, source: "BOT" },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    return { skipped: null, handover: false, source: "local" as const };
  }

  const catalog = await loadReceptionistCatalog(input.tenantId);
  const integrations = await resolvePlatformIntegrations();
  const history = buildReceptionistHistory(conversation.messages, input.incoming);
  const reply = await generateReceptionistReply({
    tenantId: input.tenantId,
    config,
    catalog,
    incoming: input.incoming,
    history,
    apiKey: integrations.openaiApiKey,
  });

  if (reply.handover) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { botPaused: true },
    });
  }

  await sendSalonWhatsApp({
    tenantId: input.tenantId,
    phone: input.phone,
    text: reply.text,
    presence: true,
  }).catch(() => null);

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUT",
      body: reply.text,
      source: "BOT",
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  return { skipped: null, handover: reply.handover, source: reply.source };
}

async function confirmNextAppointment(tenantId: string, clientId: string | null, phone: string) {
  let id = clientId;
  if (!id) {
    const client = await prisma.client.findFirst({
      where: { tenantId, phone: phone.replace(/\D/g, "") },
      select: { id: true },
    });
    id = client?.id ?? null;
  }
  if (!id) return;
  const next = await prisma.appointment.findFirst({
    where: {
      tenantId,
      clientId: id,
      status: "PENDING",
      startAt: { gte: new Date() },
    },
    orderBy: { startAt: "asc" },
    select: { id: true },
  });
  if (!next) return;
  await prisma.appointment.update({
    where: { id: next.id },
    data: { status: "CONFIRMED" },
  });
}

/**
 * Builds chronological conversation history for OpenAI while dropping the trailing
 * inbound message if it was already persisted to the DB (avoids sending `incoming` twice).
 */
export function buildReceptionistHistory(
  descMessages: { direction: string; body: string }[],
  incoming: string,
): ReceptionistHistoryItem[] {
  const chronological: ReceptionistHistoryItem[] = descMessages
    .slice()
    .reverse()
    .map((row) => ({
      role: row.direction === "OUT" ? "assistant" : "user",
      text: row.body,
    }));

  const trimmedIncoming = incoming.trim();
  const last = chronological[chronological.length - 1];
  if (last && last.role === "user" && last.text.trim() === trimmedIncoming) {
    chronological.pop();
  }

  return chronological.slice(-8);
}
