import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { parseDateParam, rangeOfCalendarDate } from "@/lib/dates";
import { AgendaBoard } from "@/components/agenda/board";
import type { AgendaAppointment, AgendaClient, AgendaScheduleBlock } from "@/components/agenda/types";
import type { AppointmentStatus } from "@/lib/constants";
import { canAccess, canBlockAgendaSlots, canViewAllAgenda, shouldHidePhones } from "@/lib/permissions";
import { redactPhone } from "@/lib/utils";
import { isClientPackageExpired } from "@/lib/packages-shared";
import { loadPlatformModules } from "@/lib/platform-modules-server";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { session, tenant, access } = await requireTenant();
  const params = await searchParams;
  const date = parseDateParam(typeof params.date === "string" ? params.date : null);
  const { start, end } = rangeOfCalendarDate(date);
  const hidePhones = shouldHidePhones(access);
  const ownOnly = !canViewAllAgenda(access);
  const scopedProfessionalId = ownOnly ? access.professionalId ?? "__none__" : null;
  const professionalFilter = scopedProfessionalId ? { professionalId: scopedProfessionalId } : {};

  const [modules, professionals, appointments, scheduleBlocks, clients, services] = await Promise.all([
    loadPlatformModules(),
    prisma.professional.findMany({
      where: {
        tenantId: session.tenantId,
        active: true,
        generateAgenda: true,
        ...(scopedProfessionalId ? { id: scopedProfessionalId } : {}),
      },
      orderBy: { name: "asc" },
    }),
    prisma.appointment.findMany({
      where: { tenantId: session.tenantId, startAt: { gte: start, lt: end }, ...professionalFilter },
      include: { client: true, items: { include: { service: true } }, comanda: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.scheduleBlock.findMany({
      where: { tenantId: session.tenantId, startAt: { lt: end }, endAt: { gt: start }, ...professionalFilter },
      orderBy: { startAt: "asc" },
    }),
    prisma.client.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      include: {
        packages: {
          where: { status: "ACTIVE", remaining: { gt: 0 } },
          include: {
            package: true,
            items: { where: { remainingQty: { gt: 0 } } },
          },
        },
        comandas: { where: { status: "OPEN" }, select: { id: true } },
      },
    }),
    prisma.service.findMany({
      where: { tenantId: session.tenantId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const mappedClients: AgendaClient[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    phone: redactPhone(c.phone, hidePhones),
    birthDate: c.birthDate?.toISOString() ?? null,
    creditCents: c.creditCents,
    cashbackCents: c.cashbackCents,
    openComandas: c.comandas.length,
    packages: c.packages
      .filter((p) => !isClientPackageExpired(p.expiresAt))
      .flatMap((p) => {
        if (p.items.length > 0) {
          return p.items.map((item) => ({
            name: `${item.description}${p.number ? ` (#${p.number})` : ""}`,
            remaining: item.remainingQty,
            priceCents: item.unitPriceCents,
          }));
        }
        return [
          {
            name: p.name || p.package?.name || `Pacote${p.number ? ` #${p.number}` : ""}`,
            remaining: p.remaining,
            priceCents: p.totalCents || p.package?.priceCents || 0,
          },
        ];
      }),
  }));

  const mapped: AgendaAppointment[] = appointments.map((a) => ({
    id: a.id,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    status: a.status as AppointmentStatus,
    notes: a.notes,
    professionalId: a.professionalId,
    comandaId: a.comanda?.id ?? null,
    client: { id: a.client.id, name: a.client.name, phone: redactPhone(a.client.phone, hidePhones) },
    items: a.items.map((item) => ({
      serviceId: item.serviceId,
      professionalId: item.professionalId,
      startAt: item.startAt?.toISOString() ?? null,
      durationMin: item.durationMin,
      priceCents: item.priceCents,
      service: { name: item.service.name, color: item.service.color },
    })),
  }));

  const mappedBlocks: AgendaScheduleBlock[] = scheduleBlocks.map((b) => ({
    id: b.id,
    professionalId: b.professionalId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    reason: b.reason,
  }));

  return (
    <AgendaBoard
      date={date}
      openTime={tenant.openTime}
      closeTime={tenant.closeTime}
      slotMinutes={tenant.slotMinutes}
      professionals={professionals}
      appointments={mapped}
      blocks={modules.agendaBlocks ? mappedBlocks : []}
      clients={mappedClients}
      services={services}
      canCreate={canAccess(access, "agenda", "create")}
      canEdit={canAccess(access, "agenda", "edit")}
      canRemove={canAccess(access, "agenda", "remove")}
      canBlockSlots={canBlockAgendaSlots(access) && modules.agendaBlocks}
      canViewAll={canViewAllAgenda(access)}
      canCreateComanda={canAccess(access, "comandas", "create")}
      canViewComanda={canAccess(access, "comandas")}
      hidePhones={hidePhones}
    />
  );
}
