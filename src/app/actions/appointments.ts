"use server";

import { revalidatePath } from "next/cache";
import { addMinutes } from "date-fns";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canAccess, canBlockAgendaSlots, canViewAllAgenda } from "@/lib/permissions";
import { hasConflict, validateScheduleBlockWindow } from "@/lib/appointments";
import { calculateCommission } from "@/lib/commissions";
import { nextStock } from "@/lib/stock";
import { atTime, calendarDate, formatTime } from "@/lib/dates";
import { postLedgerEntry } from "@/lib/ledger";
import { applyCatalogPrice } from "@/lib/promotions";
import { loadPromoRules } from "@/lib/promo-load";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/constants";
import { appointmentCampaignVars, safeDispatch } from "@/lib/dispatch-whatsapp-campaign";
import { safeNotifyAppointmentRescheduled, safeNotifyAppointmentStatusChange } from "@/lib/appointment-status-notify";

export type AppointmentItemInput = {
  serviceId: string;
  professionalId: string;
  time: string;
  durationMin: number;
};

async function loadBusy(tenantId: string, professionalId: string, excludeId?: string) {
  return prisma.appointment.findMany({
    where: {
      tenantId,
      professionalId,
      status: { notIn: ["CANCELLED"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startAt: true, endAt: true },
  });
}

async function loadBlocks(tenantId: string, professionalId: string, excludeId?: string) {
  return prisma.scheduleBlock.findMany({
    where: {
      tenantId,
      professionalId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startAt: true, endAt: true, reason: true },
  });
}

function itemWindow(date: string, item: AppointmentItemInput) {
  const start = atTime(date, item.time);
  return { start, end: addMinutes(start, item.durationMin || 15) };
}

export async function createAppointment(formData: FormData) {
  const professionalId = String(formData.get("professionalId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const startAt = new Date(String(formData.get("startAt") ?? ""));
  const notes = String(formData.get("notes") ?? "") || undefined;
  const time = formatTime(startAt);
  const date = calendarDate(startAt);

  return saveAppointment({
    clientId,
    date,
    status: "PENDING",
    notes,
    items: [{ serviceId, professionalId, time, durationMin: 0 }],
  });
}

export async function saveAppointment(payload: {
  id?: string;
  clientId: string;
  date: string;
  status: string;
  notes?: string;
  items: AppointmentItemInput[];
}) {
  const { session, access } = await requireTenant();
  const items = payload.items.filter((item) => item.serviceId && item.professionalId && item.time);
  if (!payload.clientId) return { error: "Selecione um cliente." };
  if (items.length === 0) return { error: "Inclua pelo menos um serviço." };
  if (!canAccess(access, "agenda", payload.id ? "edit" : "create")) {
    return { error: "Sem permissão para alterar a agenda." };
  }
  if (!canViewAllAgenda(access) && access.professionalId) {
    if (items.some((item) => item.professionalId !== access.professionalId)) {
      return { error: "Você só pode agendar na sua própria agenda." };
    }
  }

  const services = await prisma.service.findMany({
    where: { tenantId: session.tenantId, id: { in: items.map((i) => i.serviceId) } },
  });
  const byId = new Map(services.map((s) => [s.id, s]));

  const resolved = items.map((item) => {
    const service = byId.get(item.serviceId);
    const durationMin = item.durationMin || service?.durationMin || 30;
    const { start, end } = itemWindow(payload.date, { ...item, durationMin });
    return { ...item, durationMin, start, end, service };
  });

  if (resolved.some((item) => !item.service)) return { error: "Serviço inválido." };

  for (const item of resolved) {
    const [busy, blocks] = await Promise.all([
      loadBusy(session.tenantId, item.professionalId, payload.id),
      loadBlocks(session.tenantId, item.professionalId),
    ]);
    if (hasConflict({ id: payload.id, start: item.start, end: item.end }, busy.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })))) {
      return { error: "Este horário conflita com outro agendamento do profissional." };
    }
    const matchingBlock = blocks.find((b) =>
      hasConflict({ start: item.start, end: item.end }, [{ start: b.startAt, end: b.endAt }]),
    );
    if (matchingBlock) {
      return {
        error: matchingBlock.reason
          ? `Este horário está bloqueado na agenda (${matchingBlock.reason}).`
          : "Este horário está bloqueado na agenda da profissional.",
      };
    }
  }

  const startAt = resolved.reduce((min, item) => (item.start < min ? item.start : min), resolved[0].start);
  const endAt = resolved.reduce((max, item) => (item.end > max ? item.end : max), resolved[0].end);
  const professionalId = resolved[0].professionalId;

  const data = {
    tenantId: session.tenantId,
    professionalId,
    clientId: payload.clientId,
    startAt,
    endAt,
    status: payload.status || "PENDING",
    notes: payload.notes || null,
    source: "balcao",
  };

  let id = payload.id;
  let previousStatus: string | null = null;
  let rescheduled = false;
  if (id) {
    const existing = await prisma.appointment.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!existing) return { error: "Agendamento não encontrado." };
    previousStatus = existing.status;
    rescheduled =
      existing.startAt.getTime() !== startAt.getTime() ||
      existing.professionalId !== professionalId;
    await prisma.appointment.update({ where: { id }, data: { ...data, source: existing.source } });
    await prisma.appointmentItem.deleteMany({ where: { appointmentId: id } });
  } else {
    const created = await prisma.appointment.create({ data });
    id = created.id;
  }

  const promos = await loadPromoRules(session.tenantId);
  await prisma.appointmentItem.createMany({
    data: resolved.map((item) => ({
      appointmentId: id!,
      serviceId: item.serviceId,
      professionalId: item.professionalId,
      startAt: item.start,
      durationMin: item.durationMin,
      priceCents: applyCatalogPrice(promos, payload.date, "SERVICE", item.serviceId, item.service!.priceCents).priceCents,
    })),
  });

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/atendimento");

  if (previousStatus && previousStatus !== data.status) {
    safeNotifyAppointmentStatusChange({
      tenantId: session.tenantId,
      appointmentId: id!,
      previousStatus,
      nextStatus: data.status,
    });
  } else if (previousStatus && rescheduled) {
    safeNotifyAppointmentRescheduled({
      tenantId: session.tenantId,
      appointmentId: id!,
      status: data.status,
    });
  } else if (!previousStatus) {
    const appointment = await prisma.appointment.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        professional: { select: { name: true } },
        items: { include: { service: { select: { name: true } } } },
      },
    });
    if (appointment?.client) {
      safeDispatch({
        tenantId: session.tenantId,
        trigger: "INFORMED",
        client: appointment.client,
        sentOn: appointment.id,
        vars: appointmentCampaignVars(appointment),
      });
    }
  }

  return { ok: true as const, id };
}

export async function deleteAppointment(appointmentId: string) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "agenda", "remove")) return { error: "Sem permissão para excluir agendamentos." };
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: session.tenantId },
    include: { comanda: true },
  });
  if (!appointment) return { error: "Agendamento não encontrado." };
  if (appointment.comanda?.status === "CLOSED") {
    return { error: "Não é possível excluir: a comanda já foi fechada." };
  }
  if (!canViewAllAgenda(access) && access.professionalId && appointment.professionalId !== access.professionalId) {
    return { error: "Você só pode alterar a sua própria agenda." };
  }
  if (appointment.comanda) {
    await prisma.comanda.delete({ where: { id: appointment.comanda.id } });
  }
  await prisma.appointment.delete({ where: { id: appointment.id } });
  revalidatePath("/agenda");
  revalidatePath("/comandas");
  return { ok: true };
}

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "agenda", "edit")) return { error: "Sem permissão para alterar a agenda." };
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { error: "Status inválido." };
  }
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: session.tenantId },
    include: {
      items: { include: { service: { include: { products: true } } } },
      professional: true,
      commissions: true,
      comanda: true,
    },
  });
  if (!appointment) return { error: "Agendamento não encontrado." };
  if (!canViewAllAgenda(access) && access.professionalId && appointment.professionalId !== access.professionalId) {
    return { error: "Você só pode alterar a sua própria agenda." };
  }

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status },
  });

  if (status === "COMPLETED" && appointment.commissions.length === 0 && appointment.comanda?.status !== "CLOSED") {
    const priceCents = appointment.items.reduce((sum, item) => sum + item.priceCents, 0);
    const { percent, amountCents } = calculateCommission({
      priceCents,
      professionalPct: appointment.professional.commissionPct,
      servicePct: appointment.items[0]?.service.commissionPct,
    });

    await prisma.commission.create({
      data: {
        tenantId: session.tenantId,
        professionalId: appointment.professionalId,
        appointmentId: appointment.id,
        amountCents,
        percent,
      },
    });

    await postLedgerEntry({
      tenantId: session.tenantId,
      type: "INCOME",
      category: "servico",
      amountCents: priceCents,
      methodCode: "PIX",
      description: appointment.items.map((item) => item.service.name).join(", "),
      appointmentId: appointment.id,
    });

    for (const item of appointment.items) {
      for (const usage of item.service.products) {
        const product = await prisma.product.findFirst({
          where: { id: usage.productId, tenantId: session.tenantId },
        });
        if (!product) continue;
        const stock = nextStock(product.stock, "OUT", usage.quantity);
        await prisma.product.update({ where: { id: product.id }, data: { stock } });
        await prisma.stockMovement.create({
          data: {
            tenantId: session.tenantId,
            productId: product.id,
            type: "OUT",
            quantity: usage.quantity,
            reason: `Uso em ${item.service.name}`,
            appointmentId: appointment.id,
          },
        });
      }
    }
  }

  if (appointment.status !== status) {
    safeNotifyAppointmentStatusChange({
      tenantId: session.tenantId,
      appointmentId: appointment.id,
      previousStatus: appointment.status,
      nextStatus: status,
    });
  }

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/atendimento");
  revalidatePath("/comissoes");
  revalidatePath("/estoque");
  revalidatePath("/financeiro");
  return { ok: true };
}

export async function saveScheduleBlock(payload: {
  id?: string;
  professionalId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason?: string;
}) {
  const { session, access } = await requireTenant();
  if (!canBlockAgendaSlots(access)) {
    return { error: "Sem permissão para bloquear horários na agenda." };
  }

  const professionalId = String(payload.professionalId ?? "").trim();
  if (!professionalId) return { error: "Selecione a profissional." };

  const canManageAll = canViewAllAgenda(access);
  if (!canManageAll) {
    if (!access.professionalId || professionalId !== access.professionalId) {
      return { error: "Você só pode bloquear horários na sua própria agenda." };
    }
  }

  const windowCheck = validateScheduleBlockWindow({
    date: String(payload.date ?? ""),
    startTime: String(payload.startTime ?? ""),
    endTime: String(payload.endTime ?? ""),
  });
  if (!windowCheck.ok) return { error: windowCheck.error };

  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, tenantId: session.tenantId, active: true },
    select: { id: true },
  });
  if (!professional) return { error: "Profissional não encontrada." };

  const startAt = atTime(payload.date.trim(), payload.startTime.trim());
  const endAt = atTime(payload.date.trim(), payload.endTime.trim());
  const reason = String(payload.reason ?? "").trim().slice(0, 140) || null;
  const id = payload.id?.trim() || undefined;

  if (id) {
    const existing = await prisma.scheduleBlock.findFirst({
      where: { id, tenantId: session.tenantId },
      select: { id: true, professionalId: true },
    });
    if (!existing) return { error: "Bloqueio não encontrado." };
    if (!canManageAll && existing.professionalId !== access.professionalId) {
      return { error: "Você só pode alterar bloqueios da sua própria agenda." };
    }
  }

  const [busy, existingBlocks] = await Promise.all([
    loadBusy(session.tenantId, professionalId),
    loadBlocks(session.tenantId, professionalId, id),
  ]);

  if (hasConflict({ start: startAt, end: endAt }, busy.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })))) {
    return { error: "Já existe um agendamento neste intervalo. Reagende ou cancele antes de bloquear." };
  }
  if (hasConflict({ id, start: startAt, end: endAt }, existingBlocks.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })))) {
    return { error: "Já existe um bloqueio neste intervalo para esta profissional." };
  }

  if (id) {
    await prisma.scheduleBlock.update({
      where: { id },
      data: { professionalId, startAt, endAt, reason },
    });
  } else {
    await prisma.scheduleBlock.create({
      data: {
        tenantId: session.tenantId,
        professionalId,
        startAt,
        endAt,
        reason,
        createdById: session.userId,
      },
    });
  }

  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/atendimento");
  return { ok: true as const };
}

export async function deleteScheduleBlock(blockId: string) {
  const { session, access } = await requireTenant();
  if (!canBlockAgendaSlots(access)) {
    return { error: "Sem permissão para desbloquear horários na agenda." };
  }
  const id = String(blockId ?? "").trim();
  if (!id) return { error: "Bloqueio inválido." };

  const block = await prisma.scheduleBlock.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, professionalId: true },
  });
  if (!block) return { error: "Bloqueio não encontrado." };

  if (!canViewAllAgenda(access)) {
    if (!access.professionalId || block.professionalId !== access.professionalId) {
      return { error: "Você só pode remover bloqueios da sua própria agenda." };
    }
  }

  await prisma.scheduleBlock.delete({ where: { id: block.id } });
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/atendimento");
  return { ok: true as const };
}
