import { calendarDate, formatDayLabel, parseHHmm, rangeOfCalendarDate, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { calendarDayDiff, clampDurationMin, isValidCalendarDate } from "@/lib/receptionist-availability";

export const PUBLIC_BOOKING_MAX_DAYS = 30;

export type BookingBusyInterval = {
  professionalId: string;
  startAt: string;
  endAt: string;
};

export type BookingDayOption = {
  date: string;
  weekdayShort: string;
  dayNumber: string;
  monthShort: string;
  isToday: boolean;
  isTomorrow: boolean;
  label: string;
};

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatMinutes(total: number) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function publicBookingRange(today = calendarDate(), maxDays = PUBLIC_BOOKING_MAX_DAYS) {
  const safeDays = Math.max(1, Math.min(90, Math.round(maxDays)));
  const maxDate = shiftCalendarDate(today, safeDays);
  return {
    today,
    maxDate,
    start: rangeOfCalendarDate(today).start,
    end: rangeOfCalendarDate(maxDate).end,
  };
}

export function isDateInBookingWindow(
  dateStr: string,
  today = calendarDate(),
  maxDays = PUBLIC_BOOKING_MAX_DAYS,
) {
  if (!isValidCalendarDate(dateStr) || !isValidCalendarDate(today)) return false;
  const diff = calendarDayDiff(today, dateStr);
  return diff >= 0 && diff <= maxDays;
}

export function buildUpcomingBookingDays(
  today = calendarDate(),
  maxDays = PUBLIC_BOOKING_MAX_DAYS,
): BookingDayOption[] {
  const safeDays = Math.max(1, Math.min(90, Math.round(maxDays)));
  const days: BookingDayOption[] = [];
  for (let offset = 0; offset <= safeDays; offset++) {
    const date = shiftCalendarDate(today, offset);
    const [year, month, day] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    days.push({
      date,
      weekdayShort: WEEKDAYS_SHORT[dow] ?? "",
      dayNumber: pad(day),
      monthShort: MONTHS_SHORT[(month || 1) - 1] ?? "",
      isToday: offset === 0,
      isTomorrow: offset === 1,
      label: formatDayLabel(date),
    });
  }
  return days;
}

/**
 * Computes ALL valid start times on `date` where the full contiguous interval
 * `[start, start + durationMin]` fits inside `[openTime, closeTime]`, does not
 * start in the past when `date === today`, and has zero overlap with any busy
 * interval for `professionalId`.
 */
export function publicBookingSlotsForDate(input: {
  date: string;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  durationMin: number;
  professionalId: string;
  busy: BookingBusyInterval[];
  today?: string;
  now?: Date;
}): string[] {
  if (!input.professionalId || !isValidCalendarDate(input.date)) return [];

  const step = Math.max(5, Math.min(120, Math.round(input.slotMinutes || 15)));
  const duration = clampDurationMin(input.durationMin, step);
  const openMin = parseHHmm(input.openTime);
  const closeMin = parseHHmm(input.closeTime);
  if (closeMin <= openMin || openMin + duration > closeMin) return [];

  const now = input.now ?? new Date();
  const today = input.today && isValidCalendarDate(input.today) ? input.today : calendarDate(now);
  if (calendarDayDiff(today, input.date) < 0) return [];

  const nowMs = input.date === today ? now.getTime() : Number.NEGATIVE_INFINITY;
  const dayRange = rangeOfCalendarDate(input.date);
  const dayStartMs = dayRange.start.getTime();
  const dayEndMs = dayRange.end.getTime();

  const proBusy = input.busy
    .filter((item) => item.professionalId === input.professionalId)
    .map((item) => ({
      s: new Date(item.startAt).getTime(),
      e: new Date(item.endAt).getTime(),
    }))
    .filter((item) => Number.isFinite(item.s) && Number.isFinite(item.e) && item.e > item.s && item.s < dayEndMs && item.e > dayStartMs);

  const slots: string[] = [];
  for (let startMin = openMin; startMin + duration <= closeMin; startMin += step) {
    const hhmm = formatMinutes(startMin);
    const startMs = zonedDateTime(input.date, hhmm).getTime();
    if (startMs < nowMs) continue;
    const endMs = startMs + duration * 60_000;
    const conflict = proBusy.some((item) => startMs < item.e && endMs > item.s);
    if (!conflict) {
      slots.push(hhmm);
    }
  }
  return slots;
}
