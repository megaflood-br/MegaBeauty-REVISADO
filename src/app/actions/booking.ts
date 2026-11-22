"use server";

import { addMinutes } from "date-fns";
import { prisma } from "@/lib/db";
import { hasConflict } from "@/lib/appointments";
import { calendarDate, minutesInTz, parseHHmm, rangeOfCalendarDate } from "@/lib/dates";
import { applyCatalogPrice } from "@/lib/promotions";
import { loadPromoRules } from "@/lib/promo-load";
import { appointmentCampaignVars, safeDispatch } from "@/lib/dispatch-whatsapp-campaign";
import { withTenantContext } from "@/lib/tenant-context";
import {
  PUBLIC_BOOKING_MAX_DAYS,
  isDateInBookingWindow,
  type BookingBusyInterval,
} from "@/lib/booking-availability";

export async function getPublicBookingBusySlots(input: {
  slug: string;
  date: string;
}): Promise<{ date: string; busy: BookingBusyInterval[] } | { error: string }> {
  const slug = String(input.slug ?? "").trim();
  const date = String(input.date ?? "").trim();
  const today = calendarDate();

  if (!slug) return { error: "Salão não encontrado." };
  if (!isDateInBookingWindow(date, today, PUBLIC_BOOKING_MAX_DAYS)) {
    return { error: `Escolha uma data entre hoje e os próximos ${PUBLIC_BOOKING_MAX_DAYS} dias.` };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) return { error: "Salão não encontrado." };

  const dayRange = rangeOfCalendarDate(date);
  const appointments = await withTenantContext(tenant.id, () =>
    prisma.appointment.findMany({
      where: {
        tenantId: tenant.id,
        status: { notIn: ["CANCELLED"] },
        startAt: { lt: dayRange.end },
        endAt: { gt: dayRange.start },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    }),
  );

  return {
    date,
    busy: appointments.map((row) => ({
      professionalId: row.professionalId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
    })),
  };
}

export async function publicBook(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const professionalId = String(formData.get("professionalId") ?? "").trim();
  const rawServiceIds = [
    ...formData.getAll("serviceIds").map((value) => String(value ?? "").trim()),
    String(formData.get("serviceId") ?? "").trim(),
  ].filter(Boolean);
  const serviceIds = Array.from(new Set(rawServiceIds));
  const startAt = new Date(String(formData.get("startAt") ?? ""));
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return { error: "Salão não encontrado." };
  if (!serviceIds.length) {
    return { error: "Selecione pelo menos um serviço." };
  }
  if (!name || phone.length < 10 || phone.length > 15) {
    return { error: "Informe seu nome e um WhatsApp válido com DDD." };
  }
  if (Number.isNaN(startAt.getTime())) {
    return { error: "Escolha uma data e um horário válidos." };
  }

  const today = calendarDate();
  const bookingDate = calendarDate(startAt);
  if (!isDateInBookingWindow(bookingDate, today, PUBLIC_BOOKING_MAX_DAYS)) {
    return { error: `O agendamento online aceita datas de hoje até ${PUBLIC_BOOKING_MAX_DAYS} dias à frente.` };
  }
  if (startAt.getTime() < Date.now() - 60_000) {
    return { error: "Esse horário já passou. Escolha um horário futuro." };
  }

  return withTenantContext(tenant.id, async () => {
    const [services, professional] = await Promise.all([
      prisma.service.findMany({
        where: { id: { in: serviceIds }, tenantId: tenant.id, active: true },
      }),
      prisma.professional.findFirst({
        where: { id: professionalId, tenantId: tenant.id, active: true, generateAgenda: true },
        include: { serviceLinks: { select: { serviceId: true } } },
      }),
    ]);

    const serviceById = new Map(services.map((item) => [item.id, item]));
    const orderedServices = serviceIds
      .map((id) => serviceById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (orderedServices.length !== serviceIds.length) {
      return { error: "Um ou mais serviços selecionados estão indisponíveis." };
    }
    if (!professional) return { error: "Profissional indisponível." };

    if (professional.serviceLinks.length > 0) {
      const allowedIds = new Set(professional.serviceLinks.map((link) => link.serviceId));
      const unsupported = orderedServices.find((svc) => !allowedIds.has(svc.id));
      if (unsupported) {
        return { error: `Esta profissional não realiza o serviço "${unsupported.name}".` };
      }
    }

    const totalDurationMin = orderedServices.reduce((sum, svc) => sum + Math.max(0, svc.durationMin), 0);
    if (totalDurationMin <= 0) {
      return { error: "Duração total inválida para os serviços selecionados." };
    }

    const openMin = parseHHmm(professional.workStart || tenant.openTime);
    const closeMin = parseHHmm(professional.workEnd || tenant.closeTime);
    const startMin = minutesInTz(startAt);
    const endMin = startMin + totalDurationMin;
    if (startMin < openMin || endMin > closeMin) {
      return {
        error: "Este horário não comporta a duração total contínua dos serviços selecionados dentro do expediente.",
      };
    }

    const endAt = addMinutes(startAt, totalDurationMin);
    const busy = await prisma.appointment.findMany({
      where: {
        tenantId: tenant.id,
        professionalId: professional.id,
        status: { notIn: ["CANCELLED"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, startAt: true, endAt: true },
    });
    if (hasConflict({ start: startAt, end: endAt }, busy.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })))) {
      return { error: "Não há bloco contíguo livre para toda a duração dos serviços neste horário. Escolha outro." };
    }

    const [client, promoRules] = await Promise.all([
      prisma.client.upsert({
        where: { tenantId_phone: { tenantId: tenant.id, phone } },
        update: { name },
        create: { tenantId: tenant.id, name, phone, source: "online" },
      }),
      loadPromoRules(tenant.id),
    ]);
    const isNew = Date.now() - client.createdAt.getTime() < 8000;

    let cursor = startAt;
    const itemsToCreate = orderedServices.map((svc) => {
      const itemStart = cursor;
      cursor = addMinutes(cursor, svc.durationMin);
      return {
        serviceId: svc.id,
        professionalId: professional.id,
        startAt: itemStart,
        priceCents: applyCatalogPrice(promoRules, bookingDate, "SERVICE", svc.id, svc.priceCents).priceCents,
        durationMin: svc.durationMin,
      };
    });

    const appointment = await prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        professionalId: professional.id,
        clientId: client.id,
        startAt,
        endAt,
        status: "PENDING",
        source: "online",
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        professional: { select: { name: true } },
        items: { include: { service: { select: { name: true } } } },
      },
    });

    const vars = appointmentCampaignVars(appointment);
    const clientRef = { id: client.id, name: client.name, phone: client.phone };
    if (isNew) safeDispatch({ tenantId: tenant.id, trigger: "WELCOME", client: clientRef, sentOn: client.id });
    safeDispatch({ tenantId: tenant.id, trigger: "INFORMED", client: clientRef, sentOn: appointment.id, vars });
    safeDispatch({ tenantId: tenant.id, trigger: "PIN", client: clientRef, sentOn: appointment.id, vars });

    return { ok: true };
  });
}
