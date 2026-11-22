import { addMinutes } from "date-fns";
import { revalidatePath } from "next/cache";
import type OpenAI from "openai";
import { STATUS_LABEL, type AppointmentStatus } from "@/lib/constants";
import { hasConflict } from "@/lib/appointments";
import { prisma } from "@/lib/db";
import {
  calendarDate,
  formatDayLabel,
  formatTime,
  minutesInTz,
  parseHHmm,
  rangeOfCalendarDate,
  shiftCalendarDate,
  zonedDateTime,
} from "@/lib/dates";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { formatBRL } from "@/lib/money";
import { applyCatalogPrice } from "@/lib/promotions";
import { loadPromoRules } from "@/lib/promo-load";
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
  formatDurationPt,
  isValidCalendarDate,
  parseRequestedDate,
  parseRequestedTime,
  type AvailabilityDayResult,
} from "@/lib/receptionist-availability";
import {
  DEFAULT_RECEPTIONIST,
  asksOwnAppointments,
  buildReceptionistSystemPrompt,
  findActiveRequestedProfessional,
  formatClientAppointmentsForPrompt,
  formatServicePrice,
  hasClientConfirmedServiceInTurn,
  localReceptionistReply,
  looksLikeBookingConfirmationClaim,
  matchCatalogProfessional,
  matchCatalogService,
  normalizeReceptionist,
  resolveAvailabilityIntentFromMessages,
  wantsCancelOrReschedule,
  wantsHumanHandover,
  type ClientUpcomingAppointment,
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
    canBook: row.canBook,
    canCheckAvailability: row.canCheckAvailability,
    canInformPrices: row.canInformPrices,
    canCheckOwnAppointments: row.canCheckOwnAppointments,
    canHandover: row.canHandover,
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
      select: {
        id: true,
        name: true,
        nickname: true,
        specialty: true,
        workStart: true,
        workEnd: true,
        serviceLinks: { select: { service: { select: { name: true, active: true } } } },
      },
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
      const allowedServices = row.serviceLinks
        .filter((link) => link.service.active)
        .map((link) => link.service.name);
      return {
        name: row.name,
        nickname: row.nickname,
        specialty: row.specialty,
        services: allowedServices,
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
        id: true,
        name: true,
        durationMin: true,
        priceCents: true,
        professionals: { select: { professional: { select: { id: true, name: true, active: true } } } },
      },
    }),
    prisma.professional.findMany({
      where: { tenantId: input.tenantId, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        nickname: true,
        specialty: true,
        workStart: true,
        workEnd: true,
        serviceLinks: { select: { serviceId: true } },
      },
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
    id: service.id,
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
  if (matchedServiceFull) {
    eligible = eligible.filter((prof) => {
      if (prof.serviceLinks.length === 0) return true;
      return prof.serviceLinks.some((link) => link.serviceId === matchedServiceFull.id);
    });
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

const CREATE_APPOINTMENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_appointment",
    description:
      "Cria um NOVO agendamento na agenda do salão com status 'Agendado pela IA' para conferência da equipe. Use APENAS quando a cliente tiver informado ou confirmado explicitamente NESTE pedido qual(is) serviço(s), data e horário deseja, e somente para serviço(s) que a profissional escolhida realmente realiza. Se faltar o serviço, PERGUNTE antes de chamar esta ferramenta — nunca adivinhe nem reutilize serviço de agendamento anterior. NUNCA use para cancelar, trocar ou remarcar agendamentos existentes.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Data exata no formato YYYY-MM-DD (ex.: 2026-11-28) ou expressão em português (ex.: hoje, amanhã, sexta).",
        },
        time: {
          type: "string",
          description: "Horário exato de início no formato HH:mm (ex.: 14:00).",
        },
        serviceNames: {
          type: "array",
          items: { type: "string" },
          description: "Lista com 1 ou mais nomes de serviços do catálogo escolhidos pela cliente.",
        },
        professionalName: {
          type: "string",
          description: "Nome ou apelido da profissional escolhida (opcional se a cliente não tiver preferência).",
        },
        clientName: {
          type: "string",
          description: "Nome da cliente (obrigatório apenas se ela ainda não tiver nome cadastrado).",
        },
        notes: {
          type: "string",
          description: "Observação breve opcional da cliente.",
        },
      },
      required: ["date", "time", "serviceNames"],
    },
  },
};

const GET_MY_APPOINTMENTS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_my_appointments",
    description:
      "Consulta os agendamentos futuros DESTA cliente (somente da cliente desta conversa). Use sempre que a cliente perguntar qual é o horário dela, quando é o agendamento dela, ou se tem algum horário marcado.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Opcional: filtrar por uma data específica (YYYY-MM-DD ou 'hoje'/'amanhã'). Deixe vazio para listar todos os próximos agendamentos.",
        },
      },
      required: [],
    },
  },
};

function phoneVariants(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    variants.add(digits.slice(2));
  } else if (digits.length === 10 || digits.length === 11) {
    variants.add(`55${digits}`);
  }
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === "9") {
    const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
    variants.add(withoutNine);
    variants.add(`55${withoutNine}`);
  } else if (local.length === 10) {
    const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    variants.add(withNine);
    variants.add(`55${withNine}`);
  }
  return Array.from(variants);
}

function safeRevalidateAgenda() {
  try {
    revalidatePath("/agenda");
    revalidatePath("/dashboard");
  } catch {
    // Ignore outside Next.js request lifecycle (e.g., unit tests or CLI scripts)
  }
}

/**
 * Loads upcoming non-cancelled appointments strictly scoped to the current client
 * (by verified `clientId` or `phoneVariants(phone)` inside the same `tenantId`).
 */
export async function loadClientUpcomingAppointments(input: {
  tenantId: string;
  clientId?: string | null;
  phone?: string | null;
  dateFilter?: string | null;
  now?: Date;
  limit?: number;
}): Promise<ClientUpcomingAppointment[]> {
  const now = input.now ?? new Date();
  let resolvedClientId = input.clientId ?? null;
  if (!resolvedClientId && input.phone) {
    const variants = phoneVariants(input.phone);
    if (variants.length) {
      const client = await prisma.client.findFirst({
        where: { tenantId: input.tenantId, phone: { in: variants } },
        select: { id: true },
      });
      resolvedClientId = client?.id ?? null;
    }
  }
  if (!resolvedClientId) return [];

  let dateClause: { gte: Date; lt: Date } | undefined;
  if (input.dateFilter?.trim()) {
    const today = calendarDate(now);
    const raw = input.dateFilter.trim();
    const resolvedDate = isValidCalendarDate(raw) ? raw : parseRequestedDate(raw, today)?.date ?? null;
    if (resolvedDate) {
      const range = rangeOfCalendarDate(resolvedDate);
      dateClause = { gte: range.start, lt: range.end };
    }
  }

  const rows = await prisma.appointment.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: resolvedClientId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      ...(dateClause ? { startAt: dateClause } : { endAt: { gt: now } }),
    },
    include: {
      professional: { select: { name: true } },
      items: { include: { service: { select: { name: true } } } },
    },
    orderBy: { startAt: "asc" },
    take: input.limit ?? 8,
  });

  return rows.map((row) => {
    const apptDate = calendarDate(row.startAt);
    const statusKey = row.status as AppointmentStatus;
    return {
      id: row.id,
      date: apptDate,
      dateLabel: formatDayLabel(apptDate),
      startTime: formatTime(row.startAt),
      endTime: formatTime(row.endAt),
      professionalName: row.professional.name,
      serviceNames: row.items.map((item) => item.service.name),
      status: row.status,
      statusLabel: STATUS_LABEL[statusKey] ?? row.status,
    };
  });
}

export type ReceptionistBookingResult =
  | {
      ok: true;
      simulated: boolean;
      appointmentId: string | null;
      status: "AI_BOOKED";
      date: string;
      dateLabel: string;
      startTime: string;
      endTime: string;
      professionalName: string;
      serviceNames: string[];
      totalDurationMin: number;
      totalPriceCents: number;
      clientName: string;
      message: string;
    }
  | {
      ok: false;
      needsClientName?: boolean;
      error: string;
    };

export async function createReceptionistAppointment(input: {
  tenantId: string;
  date: string;
  time: string;
  serviceNames: string[];
  professionalName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  phone?: string | null;
  conversationId?: string | null;
  notes?: string | null;
  referenceDate?: string;
  now?: Date;
  dryRun?: boolean;
}): Promise<ReceptionistBookingResult> {
  const now = input.now ?? new Date();
  const today = input.referenceDate && isValidCalendarDate(input.referenceDate) ? input.referenceDate : calendarDate(now);
  const parsedDate = isValidCalendarDate(input.date)
    ? {
        date: input.date,
        label: formatDayLabel(input.date),
        isPast: calendarDayDiff(today, input.date) < 0,
        outOfRange: calendarDayDiff(today, input.date) > MAX_LOOKAHEAD_DAYS,
      }
    : parseRequestedDate(input.date, today);

  if (!parsedDate) {
    return { ok: false, error: "Data inválida. Peça uma data válida (ex.: hoje, amanhã ou 28/11)." };
  }
  if (parsedDate.isPast) {
    return { ok: false, error: `A data ${parsedDate.label} já passou. Peça uma data a partir de hoje.` };
  }
  if (parsedDate.outOfRange) {
    return {
      ok: false,
      error: `A data ${parsedDate.label} está além do limite de ${MAX_LOOKAHEAD_DAYS} dias à frente.`,
    };
  }

  const normalizedTime = parseRequestedTime(input.time);
  if (!normalizedTime) {
    return { ok: false, error: "Horário inválido. Informe um horário no formato HH:mm (ex.: 14:00)." };
  }

  const startAt = zonedDateTime(parsedDate.date, normalizedTime);
  if (startAt.getTime() < now.getTime() - 60_000) {
    return { ok: false, error: `O horário ${normalizedTime} em ${parsedDate.label} já passou. Escolha um horário futuro.` };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, openTime: true, closeTime: true, slotMinutes: true },
  });
  if (!tenant) return { ok: false, error: "Salão não encontrado." };

  const requestedServiceNames = input.serviceNames.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!requestedServiceNames.length) {
    return { ok: false, error: "Nenhum serviço informado. Pergunte qual serviço a cliente deseja agendar." };
  }

  const dayRange = rangeOfCalendarDate(parsedDate.date);
  const [services, professionals, dayAppointments] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId: input.tenantId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        durationMin: true,
        priceCents: true,
        professionals: { select: { professional: { select: { id: true, name: true, active: true } } } },
      },
    }),
    prisma.professional.findMany({
      where: { tenantId: input.tenantId, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        nickname: true,
        specialty: true,
        workStart: true,
        workEnd: true,
        serviceLinks: {
          select: {
            serviceId: true,
            service: { select: { name: true, active: true } },
          },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId: input.tenantId,
        status: { notIn: ["CANCELLED"] },
        startAt: { lt: dayRange.end },
        endAt: { gt: dayRange.start },
      },
      select: { id: true, professionalId: true, startAt: true, endAt: true },
    }),
  ]);

  const catalogServices = services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMin: service.durationMin,
    priceCents: service.priceCents,
    price: formatServicePrice(service.priceCents),
    professionals: service.professionals.filter((p) => p.professional.active).map((p) => p.professional.name),
  }));

  const matchedServices: typeof catalogServices = [];
  const seenServiceIds = new Set<string>();
  const missingServices: string[] = [];

  for (const rawName of requestedServiceNames) {
    const match = matchCatalogService(rawName, catalogServices);
    if (!match) {
      missingServices.push(rawName);
      continue;
    }
    const full = catalogServices.find((item) => item.name === match.name);
    if (full && !seenServiceIds.has(full.id)) {
      seenServiceIds.add(full.id);
      matchedServices.push(full);
    }
  }

  if (missingServices.length || !matchedServices.length) {
    const foldText = (v: string) =>
      v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const suggestions = missingServices
      .flatMap((raw) => {
        const q = foldText(raw);
        return q.length >= 3 ? catalogServices.filter((s) => foldText(s.name).includes(q)).map((s) => s.name) : [];
      })
      .filter((v, i, arr) => arr.indexOf(v) === i);
    const suggestionHint = suggestions.length
      ? ` Opções semelhantes no catálogo: ${suggestions.join(", ")}.`
      : ` Serviços ativos: ${catalogServices.slice(0, 12).map((s) => s.name).join(", ")}.`;
    return {
      ok: false,
      error: `Serviço não encontrado ou ambíguo no catálogo ativo: ${missingServices.join(", ") || "nenhum"}.${suggestionHint} Confirme o nome exato do serviço com a cliente.`,
    };
  }

  const totalDurationMin = matchedServices.reduce((sum, svc) => sum + Math.max(0, svc.durationMin), 0);
  if (totalDurationMin <= 0) {
    return { ok: false, error: "Duração total inválida para os serviços informados." };
  }

  const requiredServiceIds = matchedServices.map((s) => s.id);
  const eligibleProfessionals = professionals.filter((prof) => {
    if (prof.serviceLinks.length === 0) return true;
    const allowed = new Set(prof.serviceLinks.map((link) => link.serviceId));
    return requiredServiceIds.every((id) => allowed.has(id));
  });

  if (!eligibleProfessionals.length) {
    return {
      ok: false,
      error: "Nenhuma profissional ativa realiza todos os serviços selecionados em conjunto. Ofereça dividir ou pergunte qual serviço priorizar.",
    };
  }

  let candidateProfessionals = eligibleProfessionals;
  if (input.professionalName?.trim()) {
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
    if (!matchedProf) {
      return {
        ok: false,
        error: `Profissional "${input.professionalName}" não encontrada. Profissionais elegíveis: ${eligibleProfessionals.map((p) => p.name).join(", ")}.`,
      };
    }
    const inEligible = eligibleProfessionals.find((row) => row.name === matchedProf.name);
    if (!inEligible) {
      const fullProf = professionals.find((row) => row.name === matchedProf.name);
      const profServices = (fullProf?.serviceLinks ?? [])
        .filter((link) => link.service.active)
        .map((link) => link.service.name);
      const requestedLabel = matchedServices.map((s) => s.name).join(" + ");
      const profServicesHint = profServices.length
        ? ` Serviços que ${matchedProf.name} realiza: ${profServices.join(", ")}.`
        : "";
      return {
        ok: false,
        error: `${matchedProf.name} não realiza ${requestedLabel}.${profServicesHint} NÃO troque de profissional nem adivinhe o serviço sem confirmar com a cliente: avise quais serviços ${matchedProf.name} realiza e pergunte qual ela deseja (ou se prefere ${requestedLabel} com ${eligibleProfessionals.map((p) => p.name).join(", ")}).`,
      };
    }
    candidateProfessionals = [inEligible];
  }

  const endAt = addMinutes(startAt, totalDurationMin);
  const startMin = minutesInTz(startAt);
  const endMin = startMin + totalDurationMin;

  let chosenProfessional: (typeof candidateProfessionals)[number] | null = null;
  let lastFailureReason = "";

  for (const prof of candidateProfessionals) {
    const openTime = prof.workStart || tenant.openTime;
    const closeTime = prof.workEnd || tenant.closeTime;
    const openMin = parseHHmm(openTime);
    const closeMin = parseHHmm(closeTime);

    if (startMin < openMin || endMin > closeMin) {
      lastFailureReason = `${prof.name} atende das ${openTime} às ${closeTime}, e o bloco de ${formatDurationPt(totalDurationMin)} começando às ${normalizedTime} ultrapassa o expediente.`;
      continue;
    }

    const profBusy = dayAppointments.filter((appt) => appt.professionalId === prof.id);
    if (
      hasConflict(
        { start: startAt, end: endAt },
        profBusy.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })),
      )
    ) {
      const busyIntervals = busyForDayRange(dayAppointments, prof.id, dayRange);
      const effectiveNow = parsedDate.date === today ? formatTime(now) : undefined;
      const altSlots = contiguousSlotsForDuration({
        openTime,
        closeTime,
        slotMinutes: tenant.slotMinutes,
        durationMin: totalDurationMin,
        busy: busyIntervals,
        nowHHmm: effectiveNow,
      });
      const altSummary = altSlots.length
        ? `Horários livres para ${formatDurationPt(totalDurationMin)} com ${prof.name} nesse dia: ${formatAvailabilitySlots(altSlots, tenant.slotMinutes)}.`
        : `${prof.name} não tem outro bloco contínuo de ${formatDurationPt(totalDurationMin)} nesse dia.`;
      lastFailureReason = `Conflito na agenda de ${prof.name} às ${normalizedTime}. ${altSummary}`;
      continue;
    }

    chosenProfessional = prof;
    break;
  }

  if (!chosenProfessional) {
    return {
      ok: false,
      error: lastFailureReason || `Não há bloco contíguo livre às ${normalizedTime} em ${parsedDate.label}.`,
    };
  }

  const endTimeLabel = formatTime(endAt);
  const promoRules = await loadPromoRules(input.tenantId);
  let cursor = startAt;
  const resolvedItems = matchedServices.map((svc) => {
    const itemStart = cursor;
    cursor = addMinutes(cursor, svc.durationMin);
    const priceCents = applyCatalogPrice(promoRules, parsedDate.date, "SERVICE", svc.id, svc.priceCents).priceCents;
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      professionalId: chosenProfessional!.id,
      startAt: itemStart,
      priceCents,
      durationMin: svc.durationMin,
    };
  });
  const totalPriceCents = resolvedItems.reduce((sum, item) => sum + item.priceCents, 0);

  if (input.dryRun) {
    const simClient = input.clientName?.trim() || "Cliente Teste";
    const serviceList = matchedServices.map((s) => s.name).join(" + ");
    return {
      ok: true,
      simulated: true,
      appointmentId: null,
      status: "AI_BOOKED",
      date: parsedDate.date,
      dateLabel: parsedDate.label,
      startTime: normalizedTime,
      endTime: endTimeLabel,
      professionalName: chosenProfessional.name,
      serviceNames: matchedServices.map((s) => s.name),
      totalDurationMin,
      totalPriceCents,
      clientName: simClient,
      message: `SIMULAÇÃO (teste, não gravado na agenda real): seria criado agendamento com status 'Agendado pela IA' para ${simClient} · ${serviceList} (${formatDurationPt(totalDurationMin)}, ${formatBRL(totalPriceCents)}) com ${chosenProfessional.name} em ${parsedDate.label} das ${normalizedTime} às ${endTimeLabel}.`,
    };
  }

  // Resolve or create real Client record for the WhatsApp conversation
  const cleanPhone = String(input.phone ?? "").replace(/\D/g, "");
  const variants = phoneVariants(cleanPhone);

  let client = input.clientId
    ? await prisma.client.findFirst({ where: { id: input.clientId, tenantId: input.tenantId } })
    : null;

  if (!client && variants.length) {
    client = await prisma.client.findFirst({
      where: { tenantId: input.tenantId, phone: { in: variants } },
    });
  }

  const providedName = String(input.clientName ?? "").trim().slice(0, 120);
  if (!client) {
    if (!cleanPhone) {
      return { ok: false, error: "Não foi possível identificar o telefone da cliente para gravar o agendamento." };
    }
    if (!providedName) {
      return {
        ok: false,
        needsClientName: true,
        error: "Cliente ainda não tem cadastro. Pergunte o nome da cliente antes de concluir o agendamento.",
      };
    }
    client = await prisma.client.create({
      data: {
        tenantId: input.tenantId,
        name: providedName,
        phone: cleanPhone,
        source: "whatsapp_ia",
      },
    });
  } else if (providedName && /^\d{8,}$/.test(client.name.replace(/\D/g, "")) && client.name.replace(/\D/g, "").length >= 8) {
    client = await prisma.client.update({
      where: { id: client.id },
      data: { name: providedName },
    });
  }

  const noteParts = ["Agendado pela recepcionista IA (aguardando conferência)"];
  const extraNote = String(input.notes ?? "").trim().slice(0, 240);
  if (extraNote) noteParts.push(extraNote);

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: input.tenantId,
      professionalId: chosenProfessional.id,
      clientId: client.id,
      startAt,
      endAt,
      status: "AI_BOOKED",
      source: "ai_receptionist",
      notes: noteParts.join(" · "),
      items: {
        create: resolvedItems.map((item) => ({
          serviceId: item.serviceId,
          professionalId: item.professionalId,
          startAt: item.startAt,
          priceCents: item.priceCents,
          durationMin: item.durationMin,
        })),
      },
    },
    select: { id: true },
  });

  if (input.conversationId && !input.clientId) {
    await prisma.conversation
      .update({
        where: { id: input.conversationId },
        data: { clientId: client.id },
      })
      .catch(() => null);
  }

  safeRevalidateAgenda();

  const serviceList = matchedServices.map((s) => s.name).join(" + ");
  return {
    ok: true,
    simulated: false,
    appointmentId: appointment.id,
    status: "AI_BOOKED",
    date: parsedDate.date,
    dateLabel: parsedDate.label,
    startTime: normalizedTime,
    endTime: endTimeLabel,
    professionalName: chosenProfessional.name,
    serviceNames: matchedServices.map((s) => s.name),
    totalDurationMin,
    totalPriceCents,
    clientName: client.name,
    message: `AGENDAMENTO CRIADO COM SUCESSO (status: Agendado pela IA — aguardando conferência da equipe). Cliente: ${client.name} · Serviço(s): ${serviceList} (${formatDurationPt(totalDurationMin)}, ${formatBRL(totalPriceCents)}) · Profissional: ${chosenProfessional.name} · Data: ${parsedDate.label} (${parsedDate.date}) das ${normalizedTime} às ${endTimeLabel}.`,
  };
}

export async function generateReceptionistReply(input: {
  tenantId?: string;
  config: ReceptionistConfig;
  catalog: ReceptionistCatalog;
  incoming: string;
  history?: ReceptionistHistoryItem[];
  apiKey?: string | null;
  bookingMode?: "live" | "simulate" | "off";
  phone?: string | null;
  clientId?: string | null;
  conversationId?: string | null;
  knownClientName?: string | null;
}) {
  const cancelOrReschedule = wantsCancelOrReschedule(input.incoming);
  const handoverRequested = wantsHumanHandover(input.incoming) || cancelOrReschedule;
  if (handoverRequested) {
    const local = localReceptionistReply({
      config: input.config,
      catalog: input.catalog,
      incoming: input.incoming,
    });
    return {
      text: local.text,
      handover: input.config.canHandover,
      source: "local" as const,
      bookedAppointmentId: null as string | null,
    };
  }

  const isCheckingOwnAppointments = asksOwnAppointments(input.incoming);
  const canLookupOwnAppointments = Boolean(
    input.config.canCheckOwnAppointments && input.tenantId && (input.clientId || input.phone),
  );
  const canCheckAvail = input.config.canCheckAvailability;

  const clientAppointments = canLookupOwnAppointments
    ? await loadClientUpcomingAppointments({
        tenantId: input.tenantId!,
        clientId: input.clientId,
        phone: input.phone,
      })
    : null;

  let precomputedAvailability: AvailabilityDayResult | null = null;
  if (input.tenantId && canCheckAvail && !isCheckingOwnAppointments) {
    const intent = resolveAvailabilityIntentFromMessages({
      incoming: input.incoming,
      history: input.history,
      catalog: input.catalog,
      referenceDate: input.catalog.todayDate,
    });

    const shouldQueryAvailability =
      !intent.asksOwnAppointments &&
      (Boolean(intent.dateMatch) ||
        Boolean(intent.requestedTime) ||
        (intent.asksForSlots && Boolean(intent.service || intent.professional || intent.explicitDurationMin)));

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
    clientAppointments,
  });

  const requestedBookingMode = input.bookingMode ?? (input.tenantId && input.phone ? "live" : "off");
  const bookingMode = input.config.canBook ? requestedBookingMode : "off";
  const enabledTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  if (input.tenantId) {
    if (canCheckAvail) enabledTools.push(CHECK_AVAILABILITY_TOOL);
    if (bookingMode !== "off") enabledTools.push(CREATE_APPOINTMENT_TOOL);
    if (canLookupOwnAppointments) enabledTools.push(GET_MY_APPOINTMENTS_TOOL);
  }
  const tools = enabledTools.length ? enabledTools : undefined;

  let bookedAppointmentId: string | null = null;
  let createAppointmentSucceeded = false;
  let lastBookingError: string | null = null;
  let lastBookingNeedsClientName = false;

  try {
    const openai = await chatAsReceptionist({
      apiKey: input.apiKey,
      system: buildReceptionistSystemPrompt(input.config, input.catalog, precomputedAvailability, {
        bookingMode,
        knownClientName: input.knownClientName,
        clientAppointments,
      }),
      incoming: input.incoming,
      history: input.history,
      tools,
      validateResponse:
        input.tenantId && !isCheckingOwnAppointments
          ? (text) => {
              if (bookingMode === "off" && looksLikeBookingConfirmationClaim(text)) {
                return "ERRO INTERNO: A função de agendamento automático está DESATIVADA. Você NÃO agendou nem pode agendar horários. Corrija a resposta informando educadamente que a equipe da recepção confirmará e registrará o agendamento.";
              }
              if (bookingMode !== "off" && !createAppointmentSucceeded && looksLikeBookingConfirmationClaim(text)) {
                return "ERRO INTERNO: Você respondeu como se tivesse agendado ou fosse registrar o horário, mas NÃO executou create_appointment com sucesso! Chame a ferramenta create_appointment AGORA com date, time, serviceNames, professionalName (e clientName se conhecido/informado) antes de responder à cliente. Se faltar algum dado (por exemplo, o nome da cliente sem cadastro ou qual variação do serviço), pergunte esse dado à cliente em vez de dizer que agendou ou que vai registrar.";
              }
              return null;
            }
          : undefined,
      onToolCall: input.tenantId
        ? async (name, args) => {
            if (name === "get_my_appointments" && canLookupOwnAppointments) {
              const dateFilter = typeof args.date === "string" ? args.date.trim() : null;
              const fresh = await loadClientUpcomingAppointments({
                tenantId: input.tenantId!,
                clientId: input.clientId,
                phone: input.phone,
                dateFilter,
              });
              return formatClientAppointmentsForPrompt(fresh, input.catalog.todayDate);
            }

            if (name === "check_availability" && canCheckAvail) {
              const rawDate = typeof args.date === "string" ? args.date.trim() : "";
              const refDate = input.catalog.todayDate ?? calendarDate();
              const resolvedDate = isValidCalendarDate(rawDate) ? rawDate : parseRequestedDate(rawDate, refDate)?.date ?? "";
              if (!resolvedDate) return "Data inválida. Peça à cliente uma data válida (ex.: 28/11 ou sexta que vem).";
              const toolServiceName = typeof args.serviceName === "string" ? args.serviceName.trim() : null;
              const toolProfName = typeof args.professionalName === "string" ? args.professionalName.trim() : null;
              const result = await queryReceptionistAvailability({
                tenantId: input.tenantId!,
                date: resolvedDate,
                requestedTime: typeof args.requestedTime === "string" ? args.requestedTime.trim() : null,
                serviceName: toolServiceName,
                professionalName: toolProfName,
                durationMin: typeof args.durationMin === "number" ? args.durationMin : null,
                referenceDate: refDate,
                nowHHmm: input.catalog.nowHHmm,
              });
              let promptText = formatAvailabilityForPrompt(result);
              if (!result.professionals.length && toolProfName) {
                const catalogProf = matchCatalogProfessional(toolProfName, input.catalog.professionals);
                if (catalogProf?.services?.length) {
                  promptText += `\nObservação importante: ${catalogProf.name} realiza apenas: ${catalogProf.services.join(", ")}.`;
                }
              }
              return promptText;
            }

            if (name === "create_appointment" && bookingMode !== "off") {
              const rawDate = typeof args.date === "string" ? args.date.trim() : "";
              const rawTime = typeof args.time === "string" ? args.time.trim() : "";
              const rawProfName = typeof args.professionalName === "string" ? args.professionalName.trim() : "";
              const serviceNames = Array.isArray(args.serviceNames)
                ? args.serviceNames.map((v) => String(v ?? "").trim()).filter(Boolean)
                : typeof args.serviceName === "string" && args.serviceName.trim()
                  ? [args.serviceName.trim()]
                  : [];

              // Guard 1: Never silently omit or swap a professional explicitly requested by the client in the active turn
              const activeRequestedProf = findActiveRequestedProfessional({
                incoming: input.incoming,
                history: input.history,
                professionals: input.catalog.professionals,
              });
              const requestedToolProf = rawProfName
                ? matchCatalogProfessional(rawProfName, input.catalog.professionals)
                : null;
              if (activeRequestedProf && (!requestedToolProf || requestedToolProf.name !== activeRequestedProf.name)) {
                const allowedList = activeRequestedProf.services?.length
                  ? ` Serviços que ${activeRequestedProf.name} realiza: ${activeRequestedProf.services.join(", ")}.`
                  : "";
                const err = `A cliente pediu explicitamente atendimento com ${activeRequestedProf.name}. NÃO troque nem omita a profissional sem confirmação da cliente.${allowedList} Pergunte à cliente como ela prefere prosseguir.`;
                lastBookingError = err;
                return `NÃO FOI POSSÍVEL AGENDAR: ${err}`;
              }

              // Guard 2: Every service passed to create_appointment MUST have been mentioned or affirmatively confirmed
              // by the client in the active turn window (never guessed or leaked from a previous completed booking).
              const targetProf = requestedToolProf ?? activeRequestedProf;
              const unconfirmedServices = serviceNames.filter(
                (svcName) =>
                  !hasClientConfirmedServiceInTurn({
                    serviceName: svcName,
                    incoming: input.incoming,
                    history: input.history,
                    catalogServices: input.catalog.services,
                    professionals: input.catalog.professionals,
                    activeProfessionalName: targetProf?.name ?? null,
                  }),
              );
              if (!serviceNames.length || unconfirmedServices.length > 0) {
                const profServicesHint = targetProf?.services?.length
                  ? `${targetProf.name} realiza apenas: ${targetProf.services.join(", ")}.`
                  : `Serviços ativos: ${input.catalog.services.slice(0, 10).map((s) => s.name).join(", ")}.`;
                const err = `A cliente ainda não informou nem confirmou qual serviço deseja agendar neste pedido (${unconfirmedServices.join(", ") || "serviço não informado"} não foi pedido pela cliente agora). NÃO adivinhe nem reutilize serviço de agendamentos anteriores. ${profServicesHint} Pergunte à cliente qual serviço ela deseja agendar.`;
                lastBookingError = err;
                return `NÃO FOI POSSÍVEL AGENDAR: ${err}`;
              }

              const bookingResult = await createReceptionistAppointment({
                tenantId: input.tenantId!,
                date: rawDate,
                time: rawTime,
                serviceNames,
                professionalName: rawProfName || null,
                clientId: input.clientId,
                clientName: typeof args.clientName === "string" ? args.clientName.trim() : input.knownClientName,
                phone: input.phone,
                conversationId: input.conversationId,
                notes: typeof args.notes === "string" ? args.notes.trim() : null,
                referenceDate: input.catalog.todayDate,
                dryRun: bookingMode === "simulate",
              });
              if (bookingResult.ok) {
                createAppointmentSucceeded = true;
                lastBookingError = null;
                lastBookingNeedsClientName = false;
                if (bookingResult.appointmentId) {
                  bookedAppointmentId = bookingResult.appointmentId;
                }
                return bookingResult.message;
              }
              lastBookingError = bookingResult.error;
              lastBookingNeedsClientName = Boolean(bookingResult.needsClientName);
              return `NÃO FOI POSSÍVEL AGENDAR: ${bookingResult.error}`;
            }

            return "Ferramenta desativada ou não permitida.";
          }
        : undefined,
    });
    if (openai) {
      // Hard safety net: never send a false booking confirmation if booking is disabled or create_appointment did not succeed
      if (
        input.tenantId &&
        !isCheckingOwnAppointments &&
        (bookingMode === "off" || !createAppointmentSucceeded) &&
        looksLikeBookingConfirmationClaim(openai)
      ) {
        const safeFallback =
          bookingMode === "off"
            ? "Anotei o seu pedido! Como o agendamento automático está desativado, alguém da equipe da recepção vai confirmar e finalizar o seu horário por aqui."
            : lastBookingNeedsClientName
              ? "Para eu concluir o seu agendamento na agenda, qual é o seu nome completo?"
              : lastBookingError
                ? `Ainda não consegui registrar o horário: ${lastBookingError}`
                : "Para eu registrar o seu agendamento agora na agenda, me confirme por favor o serviço, o dia, o horário e o seu nome.";
        return { text: safeFallback.slice(0, 700), handover: false, source: "openai" as const, bookedAppointmentId };
      }
      return { text: openai.slice(0, 700), handover: false, source: "openai" as const, bookedAppointmentId };
    }
  } catch (err) {
    console.error("[receptionist] openai error:", err);
  }
  return { text: local.text, handover: false, source: "local" as const, bookedAppointmentId };
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
      include: {
        client: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 12 },
      },
    }),
  ]);
  if (!config.enabled) return { skipped: "off" as const };
  if (!conversation || isConversationBotPaused(conversation)) return { skipped: "paused" as const };
  if (!conversation.messages.some((row) => row.direction === "IN")) return { skipped: "receptive" as const };

  const lastOut = conversation.messages.find((row) => row.direction === "OUT");
  if (isConfirmReply(input.incoming) && lastOut && lastOut.source !== "BOT" && looksLikeReminderPrompt(lastOut.body)) {
    const confirmed = await confirmNextAppointment(input.tenantId, conversation.clientId, conversation.phone);
    if (confirmed) {
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
    bookingMode: "live",
    phone: input.phone,
    clientId: conversation.clientId,
    conversationId: conversation.id,
    knownClientName: conversation.client?.name ?? null,
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
  return {
    skipped: null,
    handover: reply.handover,
    source: reply.source,
    bookedAppointmentId: reply.bookedAppointmentId,
  };
}

async function confirmNextAppointment(tenantId: string, clientId: string | null, phone: string): Promise<boolean> {
  let id = clientId;
  if (!id) {
    const variants = phoneVariants(phone);
    if (!variants.length) return false;
    const client = await prisma.client.findFirst({
      where: { tenantId, phone: { in: variants } },
      select: { id: true },
    });
    id = client?.id ?? null;
  }
  if (!id) return false;
  const next = await prisma.appointment.findFirst({
    where: {
      tenantId,
      clientId: id,
      status: { in: ["PENDING", "AI_BOOKED"] },
      startAt: { gte: new Date() },
    },
    orderBy: { startAt: "asc" },
    select: { id: true },
  });
  if (!next) return false;
  await prisma.appointment.update({
    where: { id: next.id },
    data: { status: "CONFIRMED" },
  });
  return true;
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
