import { calendarDate, formatDayLabel, parseHHmm, rangeOfCalendarDate, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { calendarDayDiff, clampDurationMin, isValidCalendarDate } from "@/lib/receptionist-availability";

export const PUBLIC_BOOKING_MAX_DAYS = 30;

export type BookingBusyInterval = {
  professionalId: string;
  startAt: string;
  endAt: string;
};

export type BookingServiceOption = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

export type BookingProfessionalOption = {
  id: string;
  name: string;
  serviceIds: string[];
};

export type BookingSlotUnavailabilityReason = "past" | "conflict" | "exceeds_close";

export type BookingSlotOption = {
  start: string;
  end: string;
  available: boolean;
  reason?: BookingSlotUnavailabilityReason;
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
  const safe = Math.max(0, Math.round(total));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

export function formatSlotEndTime(startHHmm: string, durationMin: number) {
  const startMin = parseHHmm(startHHmm);
  const safeDuration = Math.max(0, Math.round(durationMin));
  return formatMinutes(startMin + safeDuration);
}

/**
 * Resolves the selected services (deduplicated in selection order) and calculates
 * their combined duration and base price.
 */
export function calculateSelectedServicesTotals<T extends BookingServiceOption>(
  services: T[],
  selectedIds: string[],
) {
  const byId = new Map(services.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const selectedServices: T[] = [];

  for (const rawId of selectedIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    const match = byId.get(id);
    if (!match) continue;
    seen.add(id);
    selectedServices.push(match);
  }

  const totalDurationMin = selectedServices.reduce(
    (sum, item) => sum + Math.max(0, Math.round(item.durationMin || 0)),
    0,
  );
  const totalPriceCents = selectedServices.reduce((sum, item) => sum + (item.priceCents || 0), 0);

  return {
    selectedServices,
    totalDurationMin,
    totalPriceCents,
  };
}

/**
 * Filters professionals able to execute ALL selected services.
 * Professionals with an empty `serviceIds` list are treated as unrestricted (perform all services).
 */
export function filterEligibleProfessionals<T extends BookingProfessionalOption>(
  professionals: T[],
  selectedServiceIds: string[],
): T[] {
  const uniqueIds = Array.from(new Set(selectedServiceIds.filter(Boolean)));
  if (!uniqueIds.length) return professionals;
  return professionals.filter(
    (prof) => prof.serviceIds.length === 0 || uniqueIds.every((serviceId) => prof.serviceIds.includes(serviceId)),
  );
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

export type PublicBookingSlotsInput = {
  date: string;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  durationMin: number;
  professionalId: string;
  busy: BookingBusyInterval[];
  today?: string;
  now?: Date;
};

/**
 * Evaluates every candidate start time on `date` and checks whether the full contiguous
 * interval `[start, start + durationMin]` fits within `[openTime, closeTime]`, is not
 * in the past, and has zero overlap with any busy appointment of `professionalId`.
 */
export function publicBookingSlotOptions(input: PublicBookingSlotsInput): BookingSlotOption[] {
  if (!input.professionalId || !isValidCalendarDate(input.date)) return [];
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) return [];

  const step = Math.max(5, Math.min(120, Math.round(input.slotMinutes || 15)));
  const duration = clampDurationMin(input.durationMin, step);
  const openMin = parseHHmm(input.openTime);
  const closeMin = parseHHmm(input.closeTime);
  if (closeMin <= openMin) return [];

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
    .filter(
      (item) =>
        Number.isFinite(item.s) &&
        Number.isFinite(item.e) &&
        item.e > item.s &&
        item.s < dayEndMs &&
        item.e > dayStartMs,
    );

  const options: BookingSlotOption[] = [];
  for (let startMin = openMin; startMin < closeMin; startMin += step) {
    const start = formatMinutes(startMin);
    const end = formatMinutes(startMin + duration);
    const startMs = zonedDateTime(input.date, start).getTime();

    if (startMs < nowMs) {
      options.push({ start, end, available: false, reason: "past" });
      continue;
    }

    if (startMin + duration > closeMin) {
      options.push({ start, end, available: false, reason: "exceeds_close" });
      continue;
    }

    const endMs = startMs + duration * 60_000;
    const conflict = proBusy.some((item) => startMs < item.e && endMs > item.s);
    if (conflict) {
      options.push({ start, end, available: false, reason: "conflict" });
      continue;
    }

    options.push({ start, end, available: true });
  }

  return options;
}

/**
 * Computes ALL valid start times on `date` where the full contiguous interval
 * `[start, start + durationMin]` fits inside `[openTime, closeTime]`, does not
 * start in the past when `date === today`, and has zero overlap with any busy
 * interval for `professionalId`.
 */
export function publicBookingSlotsForDate(input: PublicBookingSlotsInput): string[] {
  return publicBookingSlotOptions(input)
    .filter((option) => option.available)
    .map((option) => option.start);
}

/**
 * Validates whether a specific `startTime` ("HH:mm") can host a contiguous block
 * of `durationMin` minutes for `professionalId` on `date`.
 */
export function isContiguousBlockAvailable(
  input: PublicBookingSlotsInput & { startTime: string },
): boolean {
  if (!input.startTime) return false;
  return publicBookingSlotOptions(input).some((option) => option.start === input.startTime && option.available);
}
