"use server";

import { revalidatePath } from "next/cache";
import { addMinutes } from "date-fns";
import { prisma } from "@/lib/db";
import { assertClientInTenant, assertProfessionalsInTenant, requireTenant } from "@/lib/tenant";
import { hasConflict } from "@/lib/appointments";
import { calculateCommission } from "@/lib/commissions";
import { atTime, calendarDate, formatTime } from "@/lib/dates";
import { ensureFinanceCatalog } from "@/lib/finance-catalog";
import { postLedgerEntry } from "@/lib/ledger";

export type AppointmentItemInput = {
  serviceId: string;
  professionalId: string;
  time: string;
  durationMin: number;
};

async function loadBusy(tenantId: string, professionalId: string, excludeId?: string) {
  const [appointments, items] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        tenantId,
        professionalId,
        status: { notIn: ["CANCELLED"] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, startAt: true, endAt: true },
    }),
    prisma.appointmentItem.findMany({
      where: {
        professionalId,
        appointment: {
          tenantId,
          status: { notIn: ["CANCELLED"] },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      },
      select: { appointmentId: true, startAt: true, durationMin: true },
    }),
  ]);

  return [
    ...appointments.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt })),
    ...items
      .filter((item): item is { appointmentId: string; startAt: Date; durationMin: number } => Boolean(item.startAt))
      .map((item) => ({
        id: item.appointmentId,
        start: item.startAt,
        end: addMinutes(item.startAt, item.durationMin || 15),
      })),
  ];
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
  if (Number.isNaN(startAt.getTime())) return { error: "Data/horário inválido." };
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
  const { session } = await requireTenant();
  const items = payload.items.filter((item) => item.serviceId && item.professionalId && item.time);
  if (!payload.clientId) return { error: "Selecione um cliente." };
  if (items.length === 0) return { error: "Inclua pelo menos um serviço." };

  const [clientValid, professionalsValid, services] = await Promise.all([
    assertClientInTenant(session.tenantId, payload.clientId),
    assertProfessionalsInTenant(session.tenantId, items.map((i) => i.professionalId)),
    prisma.service.findMany({
      where: { tenantId: session.tenantId, id: { in: items.map((i) => i.serviceId) } },
    }),
  ]);
  if (!clientValid) return { error: "Cliente inválido." };
  if (!professionalsValid) return { error: "Profissional inválido." };

  const byId = new Map(services.map((s) => [s.id, s]));
  const resolved = items.map((item) => {
    const service = byId.get(item.serviceId);
    const durationMin = item.durationMin || service?.durationMin || 30;
    const { start, end } = itemWindow(payload.date, { ...item, durationMin });
    return { ...item, durationMin, start, end, service };
  });
  if (resolved.some((item) => !item.service)) return { error: "Serviço inválido." };

  for (const item of resolved) {
    const busy = await loadBusy(session.tenantId, item.professionalId, payload.id);
    if (hasConflict({ id: payload.id, start: item.start, end: item.end }, busy)) {
      return { error: "Este horário conflita com outro agendamento do profissional." };
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

  const result = await prisma.$transaction(async (tx) => {
    let id = payload.id;
    if (id) {
      const existing = await tx.appointment.findFirst({ where: { id, tenantId: session.tenantId } });
      if (!existing) return { error: "Agendamento não encontrado." };
      await tx.appointment.update({ where: { id }, data });
      await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
    } else {
      const created = await tx.appointment.create({ data });
      id = created.id;
    }

    await tx.appointmentItem.createMany({
      data: resolved.map((item) => ({
        appointmentId: id!,
        serviceId: item.serviceId,
        professionalId: item.professionalId,
        startAt: item.start,
        durationMin: item.durationMin,
        priceCents: item.service!.priceCents,
      })),
    });

    return { ok: true as const, id: id! };
  });

  if ("error" in result) return { error: result.error };
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  return { ok: true as const, id: result.id };
}

export async function deleteAppointment(appointmentId: string) {
  const { session } = await requireTenant();
  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId: session.tenantId },
      include: { comanda: true },
    });
    if (!appointment) return { error: "Agendamento não encontrado." };
    if (appointment.comanda?.status === "CLOSED") {
      return { error: "Não é possível excluir: a comanda já foi fechada." };
    }
    if (appointment.comanda) {
      await tx.comanda.delete({ where: { id: appointment.comanda.id } });
    }
    await tx.appointment.delete({ where: { id: appointment.id } });
    return { ok: true as const };
  });

  if ("error" in result) return result;
  revalidatePath("/agenda");
  revalidatePath("/comandas");
  return result;
}

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  const { session } = await requireTenant();
  if (status === "COMPLETED") {
    await ensureFinanceCatalog(session.tenantId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId: session.tenantId },
      include: {
        items: { include: { service: { include: { products: true } } } },
        professional: true,
        commissions: true,
        transactions: true,
        comanda: true,
      },
    });
    if (!appointment) return { error: "Agendamento não encontrado." };

    const previousStatus = appointment.status;
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status },
    });

    const shouldSettleDirectly =
      status === "COMPLETED" &&
      previousStatus !== "COMPLETED" &&
      appointment.commissions.length === 0 &&
      appointment.transactions.length === 0 &&
      !appointment.comanda;

    if (shouldSettleDirectly) {
      const priceCents = appointment.items.reduce((sum, item) => sum + item.priceCents, 0);
      if (appointment.professional.receivesCommission && priceCents > 0) {
        const { percent, amountCents } = calculateCommission({
          priceCents,
          professionalPct: appointment.professional.commissionPct,
          servicePct: appointment.items[0]?.service.commissionPct,
        });
        if (amountCents > 0) {
          await tx.commission.create({
            data: {
              tenantId: session.tenantId,
              professionalId: appointment.professionalId,
              appointmentId: appointment.id,
              amountCents,
              percent,
            },
          });
        }
      }

      if (priceCents > 0) {
        await postLedgerEntry(
          {
            tenantId: session.tenantId,
            type: "INCOME",
            category: "servico",
            amountCents: priceCents,
            methodCode: "PIX",
            description: appointment.items.map((item) => item.service.name).join(", "),
            appointmentId: appointment.id,
          },
          tx,
        );
      }

      for (const item of appointment.items) {
        for (const usage of item.service.products) {
          const product = await tx.product.findFirst({
            where: { id: usage.productId, tenantId: session.tenantId },
            select: { id: true },
          });
          if (!product) continue;
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { decrement: usage.quantity } },
          });
          await tx.stockMovement.create({
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

    return { ok: true as const };
  });

  if ("error" in result) return result;
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/comissoes");
  revalidatePath("/estoque");
  revalidatePath("/financeiro");
  return result;
}
