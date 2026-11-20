"use server";

import { addMinutes } from "date-fns";
import { prisma } from "@/lib/db";
import { hasConflict } from "@/lib/appointments";
import { minutesInTz, parseHHmm } from "@/lib/dates";

export async function publicBook(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim();
  const professionalId = String(formData.get("professionalId") ?? "").trim();
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const startAt = new Date(String(formData.get("startAt") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return { error: "Salão não encontrado." };
  if (!name || !phone) return { error: "Informe nome e WhatsApp." };
  if (Number.isNaN(startAt.getTime())) return { error: "Horário inválido." };
  if (startAt.getTime() < Date.now() - 60_000) {
    return { error: "Escolha um horário futuro." };
  }

  const [service, professional] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, tenantId: tenant.id, active: true, onlineBooking: true },
    }),
    prisma.professional.findFirst({
      where: { id: professionalId, tenantId: tenant.id, active: true, onlineBooking: true },
      include: { serviceLinks: { select: { serviceId: true } } },
    }),
  ]);

  if (!service) return { error: "Serviço indisponível." };
  if (!professional) return { error: "Profissional indisponível." };
  if (
    professional.serviceLinks.length > 0 &&
    !professional.serviceLinks.some((link) => link.serviceId === service.id)
  ) {
    return { error: "Este profissional não realiza o serviço selecionado." };
  }

  const endAt = addMinutes(startAt, service.durationMin);
  const startMin = minutesInTz(startAt, tenant.timezone);
  const endMin = startMin + service.durationMin;
  const openMin = Math.max(parseHHmm(tenant.openTime), parseHHmm(professional.workStart));
  const closeMin = Math.min(parseHHmm(tenant.closeTime), parseHHmm(professional.workEnd));
  if (startMin < openMin || endMin > closeMin) {
    return { error: "Horário fora do expediente disponível." };
  }

  const [busyAppointments, busyItems] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId: tenant.id, professionalId: professional.id, status: { notIn: ["CANCELLED"] } },
      select: { id: true, startAt: true, endAt: true },
    }),
    prisma.appointmentItem.findMany({
      where: {
        professionalId: professional.id,
        appointment: { tenantId: tenant.id, status: { notIn: ["CANCELLED"] } },
      },
      select: { appointmentId: true, startAt: true, durationMin: true },
    }),
  ]);

  const busyIntervals = [
    ...busyAppointments.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })),
    ...busyItems
      .filter((item): item is { appointmentId: string; startAt: Date; durationMin: number } => Boolean(item.startAt))
      .map((item) => ({
        id: item.appointmentId,
        start: item.startAt,
        end: addMinutes(item.startAt, item.durationMin || 15),
      })),
  ];

  if (hasConflict({ start: startAt, end: endAt }, busyIntervals)) {
    return { error: "Horário recém ocupado. Escolha outro." };
  }

  const client = await prisma.client.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
    update: { name },
    create: { tenantId: tenant.id, name, phone, source: "online" },
  });

  await prisma.appointment.create({
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
          professionalId: professional.id,
          startAt,
          priceCents: service.priceCents,
          durationMin: service.durationMin,
        },
      },
    },
  });

  return { ok: true };
}
