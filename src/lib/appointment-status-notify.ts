import { prisma } from "@/lib/db";
import { APPOINTMENT_STATUSES, STATUS_LABEL, type AppointmentStatus } from "@/lib/constants";
import { calendarDate, formatDayLabel, formatTime } from "@/lib/dates";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-campaigns";
import { conversationPhoneCandidates } from "@/lib/whatsapp-inbound";
import { sendSalonWhatsApp } from "@/lib/whatsapp-send";

export type FormatAppointmentStatusMessageInput = {
  clientName: string;
  salonName: string;
  status: AppointmentStatus;
  previousStatus?: string | null;
  dateLabel: string;
  time: string;
  professionalName?: string | null;
  serviceNames?: string[];
};

export function formatAppointmentStatusMessage(input: FormatAppointmentStatusMessageInput): string {
  const firstName = input.clientName.trim().split(/\s+/)[0] || "cliente";
  const services = (input.serviceNames ?? []).map((s) => s.trim()).filter(Boolean);
  const servicePart = services.length ? services.join(" + ") : "Atendimento";
  const profPart = input.professionalName?.trim() ? ` com ${input.professionalName.trim()}` : "";
  const details = `${servicePart}${profPart} em ${input.dateLabel} às ${input.time}`;
  const salon = input.salonName.trim() || "salão";

  switch (input.status) {
    case "CONFIRMED":
      return `Oi ${firstName}! Seu agendamento no ${salon} (${details}) foi confirmado. Te esperamos!`;
    case "IN_PROGRESS":
      return `Oi ${firstName}! Seu atendimento no ${salon} (${details}) foi iniciado. Bom atendimento!`;
    case "COMPLETED":
      return `Oi ${firstName}! Seu atendimento no ${salon} (${details}) foi concluído. Obrigado pela visita e até a próxima!`;
    case "CANCELLED":
      return `Oi ${firstName}! Informamos que o seu agendamento no ${salon} (${details}) foi cancelado. Se quiser remarcar um novo horário, é só responder esta mensagem.`;
    case "NO_SHOW":
      return `Oi ${firstName}! Registramos que você não pôde comparecer ao agendamento no ${salon} (${details}). Se quiser remarcar para outro dia, é só responder por aqui.`;
    case "AI_BOOKED":
      return `Oi ${firstName}! Seu agendamento no ${salon} (${details}) está registrado como ${STATUS_LABEL.AI_BOOKED} e aguarda conferência da equipe.`;
    case "PENDING":
    default:
      return `Oi ${firstName}! O status do seu agendamento no ${salon} (${details}) foi atualizado para ${STATUS_LABEL[input.status] ?? input.status}.`;
  }
}

export async function notifyAppointmentStatusChange(input: {
  tenantId: string;
  appointmentId: string;
  previousStatus?: string | null;
  nextStatus: string;
}) {
  if (!APPOINTMENT_STATUSES.includes(input.nextStatus as AppointmentStatus)) {
    return { skipped: "invalid_status" as const };
  }
  if (input.previousStatus && input.previousStatus === input.nextStatus) {
    return { skipped: "unchanged" as const };
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, tenantId: input.tenantId },
    include: {
      tenant: { select: { name: true } },
      client: { select: { id: true, name: true, phone: true } },
      professional: { select: { name: true } },
      items: { include: { service: { select: { name: true } } }, orderBy: { startAt: "asc" } },
    },
  });

  if (!appointment?.client) {
    return { skipped: "not_found" as const };
  }

  const normalizedPhone = normalizeWhatsAppPhone(appointment.client.phone ?? "");
  if (normalizedPhone.length < 10) {
    return { skipped: "no_phone" as const };
  }

  const dateStr = calendarDate(appointment.startAt);
  const dateLabel = formatDayLabel(dateStr);
  const time = formatTime(appointment.startAt);
  const serviceNames = appointment.items.map((item) => item.service.name).filter(Boolean);

  const body = formatAppointmentStatusMessage({
    clientName: appointment.client.name,
    salonName: appointment.tenant.name,
    status: input.nextStatus as AppointmentStatus,
    previousStatus: input.previousStatus,
    dateLabel,
    time,
    professionalName: appointment.professional?.name ?? null,
    serviceNames,
  });

  const candidates = conversationPhoneCandidates(normalizedPhone);
  const existingConv = candidates.length
    ? await prisma.conversation.findFirst({
        where: { tenantId: input.tenantId, phone: { in: candidates } },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, phone: true, clientId: true },
      })
    : null;

  const targetPhone = existingConv?.phone ?? normalizedPhone;
  const conversation = existingConv
    ? await prisma.conversation.update({
        where: { id: existingConv.id },
        data: { lastMessageAt: new Date(), clientId: existingConv.clientId ?? appointment.client.id },
        select: { id: true, phone: true },
      })
    : await prisma.conversation.upsert({
        where: { tenantId_phone: { tenantId: input.tenantId, phone: targetPhone } },
        update: { lastMessageAt: new Date(), clientId: appointment.client.id },
        create: {
          tenantId: input.tenantId,
          phone: targetPhone,
          clientId: appointment.client.id,
          lastMessageAt: new Date(),
        },
        select: { id: true, phone: true },
      });

  const sent = await sendSalonWhatsApp({
    tenantId: input.tenantId,
    phone: conversation.phone,
    text: body,
    presence: true,
  });

  if (!sent.sent && sent.error && !/Conecte/.test(sent.error)) {
    return { skipped: "send_failed" as const, error: sent.error };
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUT",
      body,
      source: "BOT",
    },
  });

  return {
    ok: true as const,
    mocked: !sent.sent,
    conversationId: conversation.id,
    body,
  };
}

export function safeNotifyAppointmentStatusChange(input: Parameters<typeof notifyAppointmentStatusChange>[0]) {
  void notifyAppointmentStatusChange(input).catch((error) => {
    console.error("[appointment-status-notify] failed:", error);
  });
}
