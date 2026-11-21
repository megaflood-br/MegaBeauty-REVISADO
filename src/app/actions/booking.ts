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
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const startAt = new Date(String(formData.get("startAt") ?? ""));
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return { error: "Salão não encontrado." };
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
    const [service, professional] = await Promise.all([
      prisma.service.findFirst({
        where: { id: serviceId, tenantId: tenant.id, active: true },
      }),
      prisma.professional.findFirst({
        where: { id: professionalId, tenantId: tenant.id, active: true, generateAgenda: true },
        include: { serviceLinks: { select: { serviceId: true } } },
      }),
    ]);

    if (!service) return { error: "Serviço indisponível." };
    if (!professional) return { error: "Profissional indisponível." };
    if (
      professional.serviceLinks.length > 0 &&
      !professional.serviceLinks.some((link) => link.serviceId === service.id)
    ) {
      return { error: "Esta profissional não realiza o serviço selecionado." };
    }

    const openMin = parseHHmm(professional.workStart || tenant.openTime);
    const closeMin = parseHHmm(professional.workEnd || tenant.closeTime);
    const startMin = minutesInTz(startAt);
    const endMin = startMin + service.durationMin;
    if (startMin < openMin || endMin > closeMin) {
      return { error: "Este horário não comporta a duração completa do serviço dentro do expediente." };
    }

    const endAt = addMinutes(startAt, service.durationMin);
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
      return { error: "Horário recém ocupado. Escolha outro." };
    }

    const client = await prisma.client.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone } },
      update: { name },
      create: { tenantId: tenant.id, name, phone, source: "online" },
    });
    const isNew = Date.now() - client.createdAt.getTime() < 8000;

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
          create: {
            serviceId: service.id,
            priceCents: applyCatalogPrice(
              await loadPromoRules(tenant.id),
              bookingDate,
              "SERVICE",
              service.id,
              service.priceCents,
            ).priceCents,
            durationMin: service.durationMin,
          },
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
