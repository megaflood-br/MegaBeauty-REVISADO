import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { calendarDate, shiftCalendarDate } from "@/lib/dates";
import {
  averageTicket,
  buildDashboardMetrics,
  buildLast7DaysRevenue,
  buildProfessionalOfTheDay,
  buildTodayOverview,
  defaultDashboardRange,
  movementEventParts,
  previousPeriod,
  rangeBounds,
} from "@/lib/dashboard";
import { DashboardBoard } from "@/components/painel/dashboard-board";
import { LowStockAlert, SalonCityHint, SupplierDealStrip } from "@/components/avisos/salon-alerts";
import { loadSalonNotices } from "@/lib/salon-notices";

function parseRange(fromRaw?: string, toRaw?: string) {
  const fallback = defaultDashboardRange();
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : fallback.from;
  const to = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { session, tenant } = await requireTenant();
  const params = await searchParams;
  const { from, to } = parseRange(params.from, params.to);
  const now = new Date();
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const today = calendarDate(now);
  const current = rangeBounds(from, to);
  const previous = previousPeriod(from, to);
  const prevRange = rangeBounds(previous.from, previous.to);
  const todayRange = rangeBounds(today, today);
  const last7Range = rangeBounds(shiftCalendarDate(today, -6), today);
  const prev7Range = rangeBounds(shiftCalendarDate(today, -13), shiftCalendarDate(today, -7));

  const [
    income,
    prevIncome,
    todayIncome,
    last7Income,
    prev7Income,
    appointments,
    prevAppointments,
    comandas,
    prevComandas,
    todayAppointments,
    todayOpenComandas,
    last24hAppointments,
    last24hCommissions,
    notices,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: { tenantId: session.tenantId, type: "INCOME", occurredAt: { gte: current.start, lt: current.end } },
      select: { amountCents: true, occurredAt: true },
    }),
    prisma.transaction.aggregate({
      where: { tenantId: session.tenantId, type: "INCOME", occurredAt: { gte: prevRange.start, lt: prevRange.end } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { tenantId: session.tenantId, type: "INCOME", occurredAt: { gte: todayRange.start, lt: todayRange.end } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: { tenantId: session.tenantId, type: "INCOME", occurredAt: { gte: last7Range.start, lt: last7Range.end } },
      select: { amountCents: true, occurredAt: true },
    }),
    prisma.transaction.aggregate({
      where: { tenantId: session.tenantId, type: "INCOME", occurredAt: { gte: prev7Range.start, lt: prev7Range.end } },
      _sum: { amountCents: true },
    }),
    prisma.appointment.findMany({
      where: { tenantId: session.tenantId, startAt: { gte: current.start, lt: current.end } },
      include: { professional: true, items: true },
    }),
    prisma.appointment.count({
      where: { tenantId: session.tenantId, startAt: { gte: prevRange.start, lt: prevRange.end } },
    }),
    prisma.comanda.findMany({
      where: { tenantId: session.tenantId, occurredAt: { gte: current.start, lt: current.end } },
      select: { status: true, occurredAt: true, appointmentId: true },
    }),
    prisma.comanda.findMany({
      where: { tenantId: session.tenantId, occurredAt: { gte: prevRange.start, lt: prevRange.end } },
      select: { status: true },
    }),
    prisma.appointment.findMany({
      where: { tenantId: session.tenantId, startAt: { gte: todayRange.start, lt: todayRange.end } },
      select: {
        status: true,
        comanda: { select: { id: true } },
        items: { select: { priceCents: true } },
      },
    }),
    prisma.comanda.findMany({
      where: {
        tenantId: session.tenantId,
        status: "OPEN",
        occurredAt: { gte: todayRange.start, lt: todayRange.end },
      },
      select: {
        discountCents: true,
        creditCents: true,
        cashbackCents: true,
        items: { select: { quantity: true, priceCents: true, discountCents: true } },
      },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId: session.tenantId,
        startAt: { gte: last24hStart, lte: now },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: {
        professional: { select: { id: true, name: true, specialty: true, color: true } },
        items: {
          select: {
            priceCents: true,
            professional: { select: { id: true, name: true, specialty: true, color: true } },
          },
        },
      },
    }),
    prisma.commission.findMany({
      where: {
        tenantId: session.tenantId,
        createdAt: { gte: last24hStart, lte: now },
      },
      select: {
        amountCents: true,
        professional: { select: { id: true, name: true, specialty: true, color: true } },
      },
    }),
    loadSalonNotices(session.tenantId, tenant.city),
  ]);

  const worked = (status: string) => !["CANCELLED", "NO_SHOW", "PENDING"].includes(status);
  const attendances = appointments.filter((a) => worked(a.status)).flatMap((a) =>
    a.items.map((item) => ({
      date: calendarDate(a.startAt),
      professionalId: a.professionalId,
      professionalName: a.professional.name,
      priceCents: item.priceCents,
    })),
  );
  const prevWorked = await prisma.appointment.findMany({
    where: {
      tenantId: session.tenantId,
      startAt: { gte: prevRange.start, lt: prevRange.end },
      status: { notIn: ["CANCELLED", "NO_SHOW", "PENDING"] },
    },
    include: { items: true },
  });
  const prevAttendances = prevWorked.flatMap((a) => a.items);
  const prevIncomeCents = prevIncome._sum.amountCents ?? 0;
  const prevClosed = prevComandas.filter((c) => c.status === "CLOSED").length;
  const todayIncomeCents = todayIncome._sum.amountCents ?? 0;

  const movement = [
    ...appointments
      .filter((row) => !["CANCELLED", "NO_SHOW"].includes(row.status))
      .map((row) => movementEventParts(row.startAt)),
    ...comandas
      .filter((row) => row.status !== "CANCELLED" && !row.appointmentId)
      .map((row) => movementEventParts(row.occurredAt)),
  ];

  const metrics = buildDashboardMetrics({
    from,
    to,
    today,
    income: income.map((row) => ({ date: calendarDate(row.occurredAt), amountCents: row.amountCents })),
    prevIncomeCents,
    todayIncomeCents,
    appointments: appointments.map((row) => ({ date: calendarDate(row.startAt), status: row.status })),
    prevAppointmentCount: prevAppointments,
    comandas: comandas.map((row) => ({ date: calendarDate(row.occurredAt), status: row.status })),
    prevComandaCount: prevComandas.length,
    attendances,
    prevAttendanceCount: prevAttendances.length,
    prevTicketCents: averageTicket(prevIncomeCents, prevClosed || prevAttendances.length),
    movement,
    openTime: tenant.openTime,
    closeTime: tenant.closeTime,
  });

  const todayOverview = buildTodayOverview({
    today,
    todayIncomeCents,
    appointments: todayAppointments.map((appt) => ({
      status: appt.status,
      hasComanda: Boolean(appt.comanda),
      items: appt.items,
    })),
    openComandas: todayOpenComandas,
  });

  const last7DaysRevenue = buildLast7DaysRevenue({
    today,
    income: last7Income.map((row) => ({ date: calendarDate(row.occurredAt), amountCents: row.amountCents })),
    prevTotalCents: prev7Income._sum.amountCents ?? 0,
  });

  const last24hAttendanceRows = last24hAppointments.flatMap((appt) => {
    if (appt.items.length === 0) {
      return [
        {
          professionalId: appt.professional.id,
          name: appt.professional.name,
          specialty: appt.professional.specialty,
          color: appt.professional.color,
          priceCents: 0,
        },
      ];
    }
    return appt.items.map((item) => {
      const prof = item.professional ?? appt.professional;
      return {
        professionalId: prof.id,
        name: prof.name,
        specialty: prof.specialty,
        color: prof.color,
        priceCents: item.priceCents,
      };
    });
  });

  const professionalOfTheDay = buildProfessionalOfTheDay({
    attendances: last24hAttendanceRows,
    commissions: last24hCommissions.map((row) => ({
      professionalId: row.professional.id,
      name: row.professional.name,
      specialty: row.professional.specialty,
      color: row.professional.color,
      amountCents: row.amountCents,
    })),
  });

  return (
    <DashboardBoard
      userName={session.name}
      metrics={metrics}
      todayOverview={todayOverview}
      last7DaysRevenue={last7DaysRevenue}
      professionalOfTheDay={professionalOfTheDay}
      alerts={
        <div className="space-y-4">
          <SalonCityHint city={notices.city} />
          <LowStockAlert items={notices.restock} always />
          <SupplierDealStrip deals={notices.deals} always salonCity={notices.city} />
        </div>
      }
    />
  );
}
