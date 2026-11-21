import { calendarDate, eachCalendarDate, parseHHmm, shiftCalendarDate, tzParts, zonedDateTime } from "@/lib/dates";
import { comandaTotal } from "@/lib/comandas";

export const HEAT_WEEKDAYS = [
  { id: 0, label: "Dom" },
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
] as const;

export function weekdayInSalon(date: Date) {
  return zonedDateTime(calendarDate(date), "12:00").getDay();
}

export function hourInSalon(date: Date) {
  return tzParts(date).hour;
}

export function heatHours(openTime: string, closeTime: string) {
  const start = Math.floor(parseHHmm(openTime) / 60);
  const close = parseHHmm(closeTime);
  const end = Math.max(start + 1, Math.ceil(close / 60));
  return Array.from({ length: end - start }, (_, index) => start + index);
}

export function movementEventParts(date: Date) {
  return { weekday: weekdayInSalon(date), hour: hourInSalon(date) };
}

export function buildMovementHeat(
  events: { weekday: number; hour: number }[],
  hours: number[],
) {
  const cols = hours.length ? hours : heatHours("08:00", "20:00");
  const counts = HEAT_WEEKDAYS.map(() => cols.map(() => 0));
  for (const event of events) {
    const column = cols.indexOf(event.hour);
    if (column < 0 || event.weekday < 0 || event.weekday > 6) continue;
    counts[event.weekday][column] += 1;
  }
  const max = Math.max(0, ...counts.flat());
  const days = HEAT_WEEKDAYS.map((day, index) => ({
    ...day,
    total: counts[index].reduce((sum, value) => sum + value, 0),
    hours: cols.map((hour, column) => ({
      hour,
      count: counts[index][column],
      intensity: max ? counts[index][column] / max : 0,
    })),
  }));
  let peak: { weekday: number; hour: number; count: number; label: string } | null = null;
  for (const day of days) {
    for (const cell of day.hours) {
      if (!cell.count) continue;
      if (!peak || cell.count > peak.count) {
        peak = {
          weekday: day.id,
          hour: cell.hour,
          count: cell.count,
          label: `${day.label} ${String(cell.hour).padStart(2, "0")}h`,
        };
      }
    }
  }
  return { hours: cols, days, max, peak, total: events.length };
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function defaultDashboardRange(today = calendarDate()) {
  return { from: shiftCalendarDate(today, -14), to: today };
}

export function previousPeriod(from: string, to: string) {
  const dates = eachCalendarDate(from, to);
  const len = Math.max(1, dates.length);
  const prevTo = shiftCalendarDate(from, -1);
  const prevFrom = shiftCalendarDate(from, -len);
  return { from: prevFrom, to: prevTo };
}

export function rangeBounds(from: string, to: string) {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  return {
    start: zonedDateTime(start, "00:00"),
    end: zonedDateTime(shiftCalendarDate(end, 1), "00:00"),
  };
}

export function percentDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export function conversionRate(comandas: number, appointments: number) {
  if (appointments <= 0) return 0;
  return Math.min(100, Math.round((comandas / appointments) * 100));
}

export function averageTicket(revenueCents: number, count: number) {
  if (count <= 0) return 0;
  return Math.round(revenueCents / count);
}

export function bucketAppointmentStatus(status: string): "confirmed" | "cancelled" | "unconfirmed" {
  if (status === "CANCELLED" || status === "NO_SHOW") return "cancelled";
  if (status === "PENDING") return "unconfirmed";
  return "confirmed";
}

export function countByDate(dates: string[], items: { date: string }[]) {
  const map = new Map(dates.map((date) => [date, 0]));
  for (const item of items) {
    map.set(item.date, (map.get(item.date) ?? 0) + 1);
  }
  return dates.map((date) => map.get(date) ?? 0);
}

export function rankProfessionals(
  rows: { professionalId: string; name: string; priceCents: number }[],
) {
  const map = new Map<string, { professionalId: string; name: string; services: number; revenueCents: number }>();
  for (const row of rows) {
    const current = map.get(row.professionalId) ?? {
      professionalId: row.professionalId,
      name: row.name,
      services: 0,
      revenueCents: 0,
    };
    current.services += 1;
    current.revenueCents += row.priceCents;
    map.set(row.professionalId, current);
  }
  return [...map.values()]
    .sort((a, b) => b.services - a.services || b.revenueCents - a.revenueCents)
    .map((row, index) => ({
      ...row,
      avgCents: averageTicket(row.revenueCents, row.services),
      place: index + 1,
    }));
}

export type StatusSlice = { key: string; label: string; value: number; color: string };

export function appointmentStatusSlices(appointments: { status: string }[]): StatusSlice[] {
  const counts = { confirmed: 0, cancelled: 0, unconfirmed: 0 };
  for (const item of appointments) counts[bucketAppointmentStatus(item.status)] += 1;
  return [
    { key: "confirmed", label: "Confirmado", value: counts.confirmed, color: "#10B981" },
    { key: "cancelled", label: "Cancelado", value: counts.cancelled, color: "#EF4444" },
    { key: "unconfirmed", label: "Não confirmado", value: counts.unconfirmed, color: "#3B82F6" },
  ];
}

export function comandaStatusSlices(comandas: { status: string }[]): StatusSlice[] {
  const counts = { OPEN: 0, CLOSED: 0, CANCELLED: 0 };
  for (const item of comandas) {
    if (item.status === "CLOSED") counts.CLOSED += 1;
    else if (item.status === "CANCELLED") counts.CANCELLED += 1;
    else counts.OPEN += 1;
  }
  return [
    { key: "closed", label: "Fechada", value: counts.CLOSED, color: "#10B981" },
    { key: "open", label: "Em aberto", value: counts.OPEN, color: "#8B5CF6" },
    { key: "cancelled", label: "Cancelada", value: counts.CANCELLED, color: "#EF4444" },
  ];
}

export function buildDashboardMetrics(input: {
  from: string;
  to: string;
  today: string;
  income: { date: string; amountCents: number }[];
  prevIncomeCents: number;
  todayIncomeCents: number;
  appointments: { date: string; status: string }[];
  prevAppointmentCount: number;
  comandas: { date: string; status: string }[];
  prevComandaCount: number;
  attendances: { date: string; professionalId: string; professionalName: string; priceCents: number }[];
  prevAttendanceCount: number;
  prevTicketCents: number;
  movement?: { weekday: number; hour: number }[];
  openTime?: string;
  closeTime?: string;
}) {
  const dates = eachCalendarDate(input.from, input.to);
  const salesCents = input.income.reduce((sum, row) => sum + row.amountCents, 0);
  const closedComandas = input.comandas.filter((c) => c.status === "CLOSED").length;
  const ticketCount = closedComandas || input.attendances.length;
  const ticketCurrent = averageTicket(salesCents, ticketCount);
  const appointmentSeries = countByDate(dates, input.appointments);
  const comandaSeries = countByDate(dates, input.comandas);
  const attendanceSeries = countByDate(dates, input.attendances);

  return {
    from: input.from,
    to: input.to,
    today: input.today,
    dates,
    salesCents,
    salesTodayCents: input.todayIncomeCents,
    salesDelta: percentDelta(salesCents, input.prevIncomeCents),
    appointments: input.appointments.length,
    appointmentsDelta: percentDelta(input.appointments.length, input.prevAppointmentCount),
    appointmentSeries,
    comandas: input.comandas.length,
    comandasDelta: percentDelta(input.comandas.length, input.prevComandaCount),
    comandaSeries,
    conversionPct: conversionRate(input.comandas.length, input.appointments.length),
    appointmentStatus: appointmentStatusSlices(input.appointments),
    comandaStatus: comandaStatusSlices(input.comandas),
    ticketCurrent,
    ticketPrevious: input.prevTicketCents,
    ticketDelta: percentDelta(ticketCurrent, input.prevTicketCents),
    attendances: input.attendances.length,
    attendancesDelta: percentDelta(input.attendances.length, input.prevAttendanceCount),
    attendanceSeries,
    ranking: rankProfessionals(
      input.attendances.map((row) => ({
        professionalId: row.professionalId,
        name: row.professionalName,
        priceCents: row.priceCents,
      })),
    ),
    movement: buildMovementHeat(input.movement ?? [], heatHours(input.openTime ?? "08:00", input.closeTime ?? "20:00")),
  };
}

export type DashboardMetrics = ReturnType<typeof buildDashboardMetrics>;

export type TodayOverviewMetrics = {
  today: string;
  appointmentsTotal: number;
  appointmentsConfirmed: number;
  appointmentsPending: number;
  appointmentsCompleted: number;
  appointmentsCancelled: number;
  openComandasCount: number;
  openComandasCents: number;
  realizedRevenueCents: number;
  scheduledRemainingCents: number;
  expectedRevenueCents: number;
  realizedPct: number;
};

export function buildTodayOverview(input: {
  today: string;
  todayIncomeCents: number;
  appointments: {
    status: string;
    hasComanda: boolean;
    items: { priceCents: number }[];
  }[];
  openComandas: {
    discountCents: number;
    creditCents: number;
    cashbackCents: number;
    items: { quantity: number; priceCents: number; discountCents?: number }[];
  }[];
}): TodayOverviewMetrics {
  let appointmentsConfirmed = 0;
  let appointmentsPending = 0;
  let appointmentsCompleted = 0;
  let appointmentsCancelled = 0;
  let scheduledRemainingCents = 0;

  for (const appt of input.appointments) {
    if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
      appointmentsCancelled += 1;
      continue;
    }
    if (appt.status === "PENDING") {
      appointmentsPending += 1;
    } else if (appt.status === "COMPLETED") {
      appointmentsCompleted += 1;
    } else {
      appointmentsConfirmed += 1;
    }

    if (!appt.hasComanda && appt.status !== "COMPLETED") {
      scheduledRemainingCents += appt.items.reduce((sum, item) => sum + Math.max(0, item.priceCents), 0);
    }
  }

  const appointmentsTotal = appointmentsConfirmed + appointmentsPending + appointmentsCompleted;
  const openComandasCents = input.openComandas.reduce(
    (sum, comanda) =>
      sum +
      comandaTotal({
        items: comanda.items,
        discountCents: comanda.discountCents,
        creditCents: comanda.creditCents,
        cashbackCents: comanda.cashbackCents,
      }),
    0,
  );

  const realizedRevenueCents = Math.max(0, input.todayIncomeCents);
  const expectedRevenueCents = realizedRevenueCents + openComandasCents + scheduledRemainingCents;
  const realizedPct =
    expectedRevenueCents > 0 ? Math.min(100, Math.round((realizedRevenueCents / expectedRevenueCents) * 100)) : 0;

  return {
    today: input.today,
    appointmentsTotal,
    appointmentsConfirmed,
    appointmentsPending,
    appointmentsCompleted,
    appointmentsCancelled,
    openComandasCount: input.openComandas.length,
    openComandasCents,
    realizedRevenueCents,
    scheduledRemainingCents,
    expectedRevenueCents,
    realizedPct,
  };
}

export type DailyRevenuePoint = {
  date: string;
  shortDate: string;
  weekday: string;
  axisLabel: string;
  revenueCents: number;
  revenueBRL: number;
  transactionsCount: number;
  isToday: boolean;
  isPeak: boolean;
};

export type Last7DaysRevenueMetrics = {
  from: string;
  to: string;
  days: DailyRevenuePoint[];
  totalCents: number;
  averageCents: number;
  prevTotalCents: number;
  deltaPct: number;
  peakDay: DailyRevenuePoint | null;
};

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export function buildLast7DaysRevenue(input: {
  today: string;
  income: { date: string; amountCents: number }[];
  prevTotalCents?: number;
}): Last7DaysRevenueMetrics {
  const from = shiftCalendarDate(input.today, -6);
  const to = input.today;
  const dates = eachCalendarDate(from, to);

  const totals = new Map<string, { cents: number; count: number }>(
    dates.map((date) => [date, { cents: 0, count: 0 }]),
  );

  for (const row of input.income) {
    const bucket = totals.get(row.date);
    if (!bucket) continue;
    const cents = Math.max(0, row.amountCents);
    bucket.cents += cents;
    if (cents > 0) bucket.count += 1;
  }

  let maxCents = 0;
  for (const bucket of totals.values()) {
    if (bucket.cents > maxCents) maxCents = bucket.cents;
  }

  let peakMarked = false;
  const days: DailyRevenuePoint[] = dates.map((date) => {
    const bucket = totals.get(date) ?? { cents: 0, count: 0 };
    const [, month, day] = date.split("-");
    const shortDate = `${day}/${month}`;
    const weekdayIdx = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekday = WEEKDAYS_PT[weekdayIdx] ?? "";
    const isPeak = maxCents > 0 && bucket.cents === maxCents && !peakMarked;
    if (isPeak) peakMarked = true;

    return {
      date,
      shortDate,
      weekday,
      axisLabel: `${weekday} ${shortDate}`,
      revenueCents: bucket.cents,
      revenueBRL: Number((bucket.cents / 100).toFixed(2)),
      transactionsCount: bucket.count,
      isToday: date === input.today,
      isPeak,
    };
  });

  const totalCents = days.reduce((sum, day) => sum + day.revenueCents, 0);
  const averageCents = Math.round(totalCents / Math.max(1, days.length));
  const prevTotalCents = Math.max(0, input.prevTotalCents ?? 0);
  const deltaPct = percentDelta(totalCents, prevTotalCents);
  const peakDay = days.find((day) => day.isPeak) ?? null;

  return {
    from,
    to,
    days,
    totalCents,
    averageCents,
    prevTotalCents,
    deltaPct,
    peakDay,
  };
}

export type ProfessionalOfTheDayMetric = "attendances" | "commissions";

export type ProfessionalDayLeader = {
  professionalId: string;
  name: string;
  specialty: string | null;
  color: string;
  attendances: number;
  commissionCents: number;
  revenueCents: number;
};

export type ProfessionalOfTheDayMetrics = {
  byAttendances: ProfessionalDayLeader | null;
  byCommissions: ProfessionalDayLeader | null;
  defaultCriterion: ProfessionalOfTheDayMetric;
  activeProfessionalsCount: number;
};

export function buildProfessionalOfTheDay(input: {
  attendances: {
    professionalId: string;
    name: string;
    specialty?: string | null;
    color?: string | null;
    priceCents: number;
  }[];
  commissions: {
    professionalId: string;
    name: string;
    specialty?: string | null;
    color?: string | null;
    amountCents: number;
  }[];
}): ProfessionalOfTheDayMetrics {
  const map = new Map<string, ProfessionalDayLeader>();

  const ensure = (row: {
    professionalId: string;
    name: string;
    specialty?: string | null;
    color?: string | null;
  }) => {
    const existing = map.get(row.professionalId);
    if (existing) return existing;
    const created: ProfessionalDayLeader = {
      professionalId: row.professionalId,
      name: row.name,
      specialty: row.specialty ?? null,
      color: row.color || "#2563EB",
      attendances: 0,
      commissionCents: 0,
      revenueCents: 0,
    };
    map.set(row.professionalId, created);
    return created;
  };

  for (const row of input.attendances) {
    const entry = ensure(row);
    entry.attendances += 1;
    entry.revenueCents += Math.max(0, row.priceCents);
  }

  for (const row of input.commissions) {
    const entry = ensure(row);
    entry.commissionCents += Math.max(0, row.amountCents);
  }

  const all = [...map.values()];

  const byAttendances =
    all
      .filter((item) => item.attendances > 0)
      .sort(
        (a, b) =>
          b.attendances - a.attendances ||
          b.commissionCents - a.commissionCents ||
          b.revenueCents - a.revenueCents ||
          a.name.localeCompare(b.name, "pt-BR"),
      )[0] ?? null;

  const byCommissions =
    all
      .filter((item) => item.commissionCents > 0)
      .sort(
        (a, b) =>
          b.commissionCents - a.commissionCents ||
          b.attendances - a.attendances ||
          b.revenueCents - a.revenueCents ||
          a.name.localeCompare(b.name, "pt-BR"),
      )[0] ?? null;

  const defaultCriterion: ProfessionalOfTheDayMetric =
    byAttendances || !byCommissions ? "attendances" : "commissions";

  return {
    byAttendances,
    byCommissions,
    defaultCriterion,
    activeProfessionalsCount: all.filter((item) => item.attendances > 0 || item.commissionCents > 0).length,
  };
}
