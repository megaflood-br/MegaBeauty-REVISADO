import { calendarDate, formatDayLabel, minutesToLabel, parseHHmm, shiftCalendarDate } from "@/lib/dates";

export const MAX_LOOKAHEAD_DAYS = 60;
export const MIN_SERVICE_DURATION_MIN = 5;
export const MAX_SERVICE_DURATION_MIN = 600;

export type RequestedDateMatch = {
  date: string;
  label: string;
  isPast: boolean;
  outOfRange: boolean;
  isWeekReference?: boolean;
};

export type AvailabilityProfessionalSlots = {
  name: string;
  nickname: string | null;
  specialty: string | null;
  startTimes: string[];
  summary: string;
};

export type AvailabilityDayResult = {
  date: string;
  label: string;
  durationMin: number;
  serviceName: string | null;
  slotMinutes: number;
  isPast: boolean;
  outOfRange: boolean;
  professionals: AvailabilityProfessionalSlots[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatMinutes(total: number) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function clampDurationMin(durationMin: number | null | undefined, fallback = 30) {
  const numeric = typeof durationMin === "number" && Number.isFinite(durationMin) ? Math.round(durationMin) : fallback;
  return Math.max(MIN_SERVICE_DURATION_MIN, Math.min(MAX_SERVICE_DURATION_MIN, numeric));
}

function isValidYMD(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function isValidCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return isValidYMD(year, month, day);
}

export function calendarDayDiff(fromDateStr: string, toDateStr: string) {
  const [fy, fm, fd] = fromDateStr.split("-").map(Number);
  const [ty, tm, td] = toDateStr.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function formatDurationPt(minutes: number) {
  return minutesToLabel(clampDurationMin(minutes));
}

/**
 * Computes ALL exact valid start times (stepping by `slotMinutes`) where a contiguous
 * block of `durationMin` fits within `[openTime, closeTime]` without overlapping any
 * busy interval `[start, end)` and without starting before `nowHHmm` (when provided).
 */
export function contiguousSlotsForDuration(input: {
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  durationMin: number;
  busy: { start: string; end: string }[];
  nowHHmm?: string;
}): string[] {
  const step = Math.max(5, Math.min(120, Math.round(input.slotMinutes || 15)));
  const duration = clampDurationMin(input.durationMin, step);
  const openMin = parseHHmm(input.openTime);
  const closeMin = parseHHmm(input.closeTime);
  if (closeMin <= openMin || openMin + duration > closeMin) return [];

  const nowMin = input.nowHHmm ? parseHHmm(input.nowHHmm) : -1;
  const intervals = input.busy
    .map((item) => ({ s: parseHHmm(item.start), e: parseHHmm(item.end) }))
    .filter((item) => Number.isFinite(item.s) && Number.isFinite(item.e) && item.e > item.s);

  const slots: string[] = [];
  for (let start = openMin; start + duration <= closeMin; start += step) {
    if (nowMin >= 0 && start < nowMin) continue;
    const end = start + duration;
    const conflict = intervals.some((item) => start < item.e && item.s < end);
    if (!conflict) {
      slots.push(formatMinutes(start));
    }
  }
  return slots;
}

export function groupContiguousStartWindows(slots: string[], slotMinutes: number) {
  const step = Math.max(5, Math.min(120, Math.round(slotMinutes || 15)));
  if (!slots.length) return [];

  const groups: { from: string; to: string; count: number }[] = [];
  let start = slots[0];
  let prev = slots[0];
  let prevMin = parseHHmm(slots[0]);
  let count = 1;

  for (let i = 1; i < slots.length; i++) {
    const current = slots[i];
    const currentMin = parseHHmm(current);
    if (currentMin - prevMin === step) {
      prev = current;
      prevMin = currentMin;
      count += 1;
    } else {
      groups.push({ from: start, to: prev, count });
      start = current;
      prev = current;
      prevMin = currentMin;
      count = 1;
    }
  }
  groups.push({ from: start, to: prev, count });
  return groups;
}

/**
 * Formats valid start times cleanly without silently dropping afternoon availability
 * or odd-indexed boundary slots.
 */
export function formatAvailabilitySlots(slots: string[], slotMinutes: number): string {
  if (!slots.length) return "";
  if (slots.length <= 6) return slots.join(", ");

  const groups = groupContiguousStartWindows(slots, slotMinutes);
  return groups
    .slice(0, 6)
    .map((group) => {
      if (group.count === 1) return group.from;
      if (group.count === 2) return `${group.from}, ${group.to}`;
      return `${group.from} até ${group.to}`;
    })
    .join(", ");
}

const MONTHS_PT: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

const WEEKDAYS_PT: { pattern: RegExp; isoDow: number }[] = [
  { pattern: /\bsegunda(?:-feira|\s+feira)?\b/, isoDow: 1 },
  { pattern: /\bterca(?:-feira|\s+feira)?\b/, isoDow: 2 },
  { pattern: /\bquarta(?:-feira|\s+feira)?\b/, isoDow: 3 },
  { pattern: /\bquinta(?:-feira|\s+feira)?\b/, isoDow: 4 },
  { pattern: /\bsexta(?:-feira|\s+feira)?\b/, isoDow: 5 },
  { pattern: /\bsabado\b/, isoDow: 6 },
  { pattern: /\bdomingo\b/, isoDow: 7 },
];

function buildMatch(dateStr: string, referenceDateStr: string, extra?: { isWeekReference?: boolean }): RequestedDateMatch {
  const diff = calendarDayDiff(referenceDateStr, dateStr);
  return {
    date: dateStr,
    label: formatDayLabel(dateStr),
    isPast: diff < 0,
    outOfRange: diff > MAX_LOOKAHEAD_DAYS,
    ...(extra?.isWeekReference ? { isWeekReference: true } : {}),
  };
}

function resolveDayMonthWithoutYear(day: number, month: number, referenceDateStr: string): RequestedDateMatch | null {
  const refYear = Number(referenceDateStr.slice(0, 4));
  const currentValid = isValidYMD(refYear, month, day);
  const nextValid = isValidYMD(refYear + 1, month, day);
  if (!currentValid && !nextValid) return null;

  if (currentValid) {
    const candidate = `${refYear}-${pad(month)}-${pad(day)}`;
    const diff = calendarDayDiff(referenceDateStr, candidate);
    if (diff >= 0) return buildMatch(candidate, referenceDateStr);
    if (nextValid) {
      const nextYearCandidate = `${refYear + 1}-${pad(month)}-${pad(day)}`;
      const nextDiff = calendarDayDiff(referenceDateStr, nextYearCandidate);
      if (nextDiff >= 0 && nextDiff <= MAX_LOOKAHEAD_DAYS) {
        return buildMatch(nextYearCandidate, referenceDateStr);
      }
    }
    return buildMatch(candidate, referenceDateStr);
  }

  const nextYearCandidate = `${refYear + 1}-${pad(month)}-${pad(day)}`;
  return buildMatch(nextYearCandidate, referenceDateStr);
}

/**
 * Parses natural Brazilian Portuguese date expressions relative to `referenceDateStr` (YYYY-MM-DD).
 * Supports: hoje, amanhã, depois de amanhã, daqui a N dias, YYYY-MM-DD, DD/MM[/YYYY],
 * DD de <mês> [de YYYY], dia DD, weekdays (with "que vem" / "próxima" / "semana que vem"),
 * and standalone "semana que vem".
 */
export function parseRequestedDate(text: string, referenceDateStr = calendarDate()): RequestedDateMatch | null {
  if (!isValidCalendarDate(referenceDateStr)) return null;
  const q = fold(text);
  if (!q) return null;

  // 1. ISO date YYYY-MM-DD
  const isoMatch = q.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidYMD(year, month, day)) return null;
    return buildMatch(`${year}-${pad(month)}-${pad(day)}`, referenceDateStr);
  }

  // 2. Explicit DD/MM/YYYY or DD/MM
  const slashMatch = q.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const rawYear = slashMatch[3];
    if (rawYear) {
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
      if (!isValidYMD(year, month, day)) return null;
      return buildMatch(`${year}-${pad(month)}-${pad(day)}`, referenceDateStr);
    }
    return resolveDayMonthWithoutYear(day, month, referenceDateStr);
  }

  // 3. Explicit "DD de <mês> [de YYYY]"
  const monthNamesPattern = Object.keys(MONTHS_PT).join("|");
  const writtenMonthMatch = q.match(
    new RegExp(`\\b(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${monthNamesPattern})(?:\\s+de\\s+(20\\d{2}))?\\b`),
  );
  if (writtenMonthMatch) {
    const day = Number(writtenMonthMatch[1]);
    const month = MONTHS_PT[writtenMonthMatch[2]];
    const rawYear = writtenMonthMatch[3];
    if (rawYear) {
      const year = Number(rawYear);
      if (!isValidYMD(year, month, day)) return null;
      return buildMatch(`${year}-${pad(month)}-${pad(day)}`, referenceDateStr);
    }
    return resolveDayMonthWithoutYear(day, month, referenceDateStr);
  }

  // 4. Relative day offsets: "depois de amanhã", "amanhã", "hoje", "daqui a N dias"
  if (/\bdepois\s+de\s+amanha\b/.test(q)) {
    return buildMatch(shiftCalendarDate(referenceDateStr, 2), referenceDateStr);
  }
  if (/\bamanha\b/.test(q)) {
    return buildMatch(shiftCalendarDate(referenceDateStr, 1), referenceDateStr);
  }
  if (/\bhoje\b/.test(q)) {
    return buildMatch(referenceDateStr, referenceDateStr);
  }
  const inDaysMatch = q.match(/\b(?:daqui(?:\s+a)?|em)\s+(\d{1,3})\s+dias?\b/);
  if (inDaysMatch) {
    const offset = Number(inDaysMatch[1]);
    if (Number.isInteger(offset) && offset >= 0 && offset <= 365) {
      return buildMatch(shiftCalendarDate(referenceDateStr, offset), referenceDateStr);
    }
  }

  // 5. Explicit "dia DD" (without month)
  const dayOnlyMatch = q.match(/\b(?:no\s+|pro\s+|para\s+o\s+|para\s+)?dia\s+(\d{1,2})\b/);
  if (dayOnlyMatch) {
    const day = Number(dayOnlyMatch[1]);
    if (day < 1 || day > 31) return null;
    const [refYear, refMonth, refDay] = referenceDateStr.split("-").map(Number);

    if (day >= refDay && isValidYMD(refYear, refMonth, day)) {
      return buildMatch(`${refYear}-${pad(refMonth)}-${pad(day)}`, referenceDateStr);
    }
    // Look ahead up to 2 months (handles e.g. "dia 5" when today is 21, or "dia 31" during a 30-day month)
    for (let monthOffset = 1; monthOffset <= 2; monthOffset++) {
      const shifted = new Date(Date.UTC(refYear, refMonth - 1 + monthOffset, 1));
      const y = shifted.getUTCFullYear();
      const m = shifted.getUTCMonth() + 1;
      if (isValidYMD(y, m, day)) {
        return buildMatch(`${y}-${pad(m)}-${pad(day)}`, referenceDateStr);
      }
    }
    return null;
  }

  // 6. Weekdays in Portuguese
  const [ry, rm, rd] = referenceDateStr.split("-").map(Number);
  const jsDow = new Date(Date.UTC(ry, rm - 1, rd)).getUTCDay(); // 0=Sun..6=Sat
  const todayIsoDow = jsDow === 0 ? 7 : jsDow; // 1=Mon..7=Sun

  for (const weekday of WEEKDAYS_PT) {
    if (weekday.pattern.test(q)) {
      const isNextWeek = /\b(que\s+vem|semana\s+que\s+vem|proxima\s+semana|da\s+outra\s+semana)\b/.test(q);
      const isProxima = /\bproxim[ao]\b/.test(q);
      let delta: number;
      if (isNextWeek) {
        const daysUntilNextMonday = 8 - todayIsoDow;
        delta = daysUntilNextMonday + (weekday.isoDow - 1);
      } else {
        delta = (weekday.isoDow - todayIsoDow + 7) % 7;
        if (delta === 0 && isProxima) delta = 7;
      }
      return buildMatch(shiftCalendarDate(referenceDateStr, delta), referenceDateStr);
    }
  }

  // 7. Standalone "semana que vem" / "próxima semana"
  if (/\b(semana\s+que\s+vem|proxima\s+semana)\b/.test(q)) {
    const daysUntilNextMonday = 8 - todayIsoDow;
    return buildMatch(shiftCalendarDate(referenceDateStr, daysUntilNextMonday), referenceDateStr, {
      isWeekReference: true,
    });
  }

  return null;
}

/**
 * Extracts an explicit duration hint when the client mentions time without a catalog service
 * (e.g. "3 horas", "2h30", "90 min").
 */
export function parseExplicitDurationMin(text: string): number | null {
  const q = fold(text);
  const hhmm = q.match(/\b(\d{1,2})\s*h(?:oras?)?\s*(?:e\s*)?(\d{1,2})\s*(?:min(?:utos?)?)?\b/);
  if (hhmm) {
    const hours = Number(hhmm[1]);
    const mins = Number(hhmm[2]);
    if (hours >= 1 && hours <= 10 && mins > 0 && mins < 60) {
      return clampDurationMin(hours * 60 + mins);
    }
  }
  const hoursOnly = q.match(/\b(\d{1,2})\s*(?:horas?|hrs?)\b/);
  if (hoursOnly) {
    const hours = Number(hoursOnly[1]);
    if (hours >= 1 && hours <= 10) return clampDurationMin(hours * 60);
  }
  const minsOnly = q.match(/\b(\d{2,3})\s*(?:minutos?|min)\b/);
  if (minsOnly) {
    const mins = Number(minsOnly[1]);
    if (mins >= MIN_SERVICE_DURATION_MIN && mins <= MAX_SERVICE_DURATION_MIN) return mins;
  }
  return null;
}

export function formatAvailabilityForPrompt(result: AvailabilityDayResult): string {
  if (result.isPast) {
    return `Consulta de agenda (${result.label} · ${result.date}): data já passou.`;
  }
  if (result.outOfRange) {
    return `Consulta de agenda (${result.label} · ${result.date}): fora do limite de consulta (${MAX_LOOKAHEAD_DAYS} dias à frente).`;
  }
  const durationText = formatDurationPt(result.durationMin);
  const servicePart = result.serviceName ? `${result.serviceName} (${durationText})` : `bloco contínuo de ${durationText}`;
  if (!result.professionals.length) {
    return `Consulta exata de agenda para ${result.label} (${result.date}) · ${servicePart}: nenhuma profissional elegível ativa.`;
  }
  const lines = result.professionals.map((row) =>
    row.startTimes.length
      ? `- ${row.name}: horários de início livres ${row.summary} (${row.startTimes.length} opção(ões) contíguas de ${durationText})`
      : `- ${row.name}: sem encaixe contínuo de ${durationText} neste dia`,
  );
  return [`Consulta exata de agenda para ${result.label} (${result.date}) · ${servicePart}:`, ...lines].join("\n");
}
