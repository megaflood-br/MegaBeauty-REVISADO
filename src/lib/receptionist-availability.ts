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

export type AvailabilityBusyInterval = {
  start: string;
  end: string;
};

export type AvailabilityProfessionalSlots = {
  name: string;
  nickname: string | null;
  specialty: string | null;
  startTimes: string[];
  summary: string;
  busy?: AvailabilityBusyInterval[];
  workStart?: string;
  workEnd?: string;
};

export type AvailabilityDayResult = {
  date: string;
  label: string;
  durationMin: number;
  serviceName: string | null;
  slotMinutes: number;
  isPast: boolean;
  outOfRange: boolean;
  requestedTime?: string | null;
  currentTimeHHmm?: string | null;
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

function isValidHourMinute(hour: number, minute: number) {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

const TIME_PREFIX_PATTERN = /(?:^|[\s,;(])(?:a\s+partir\s+das?|depois\s+das?|antes\s+das?|por\s+volta\s+das?|perto\s+das?|para\s+as?|pras?|pelas?|as|das)\s*$/;
const DURATION_PREFIX_PATTERN = /(?:^|[\s,;(])(?:dura(?:cao)?(?:\s+de)?|leva(?:ndo)?|bloco(?:\s+continuo)?\s+de|procedimento\s+de|servico\s+de|preciso\s+de|uns|umas|cerca\s+de|aproximadamente|de)\s*$/;

/**
 * Parses a specific time-of-day mentioned in Brazilian Portuguese (e.g., "14:00", "14h30",
 * "às 14h", "às 14", "2 da tarde", "meio-dia") into normalized "HH:mm".
 * Carefully avoids confusing dates ("dia 14", "14/11"), prices ("R$ 14,00"), or durations ("3 horas").
 */
export function parseRequestedTime(text: string): string | null {
  const q = fold(text);
  if (!q) return null;

  // 1. "meio-dia" / "meio dia"
  if (/\bmeio[\s-]dia\b/.test(q)) return "12:00";

  // 2. Explicit HH:mm (with optional "da tarde" / "da noite")
  const colonMatch = q.match(/(?:^|[^\d/:,])(\d{1,2}):(\d{2})(?!\d)(?:\s*(?:h|hs|hrs|horas?))?(?:\s*da\s*(manha|tarde|noite))?/);
  if (colonMatch) {
    let hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2]);
    const period = colonMatch[3];
    if ((period === "tarde" || period === "noite") && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    if (isValidHourMinute(hour, minute)) {
      return `${pad(hour)}:${pad(minute)}`;
    }
  }

  // 3. Explicit "HHh[mm]" or "HH hs" / "HH horas" with period or time-of-day cue
  const hRegex = /\b(\d{1,2})\s*(?:h(?:s|rs|oras?)?)(?:\s*e\s*|\s*)?(\d{2})?(?:\s*da\s*(manha|tarde|noite))?\b/g;
  for (const match of q.matchAll(hRegex)) {
    const rawHour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const period = match[3];
    const index = match.index ?? 0;
    const before = q.slice(Math.max(0, index - 32), index);
    const fullToken = match[0];
    const hasTimePrefix = TIME_PREFIX_PATTERN.test(before);
    const hasDurationPrefix = DURATION_PREFIX_PATTERN.test(before);
    const hasWrittenHoras = /\bhoras?\b|\bhrs?\b/.test(fullToken);

    // Avoid treating duration phrases like "preciso de 3 horas" or "bloco de 2h30" as clock times
    if (hasDurationPrefix && !hasTimePrefix && !period) continue;
    if (hasWrittenHoras && !hasTimePrefix && !period && rawHour <= 10) continue;
    // Bare "2h" or "3h30" without preposition/period is ambiguous with duration when <= 6
    if (!hasTimePrefix && !period && rawHour < 7) continue;

    let hour = rawHour;
    if ((period === "tarde" || period === "noite") && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    if (isValidHourMinute(hour, minute)) {
      return `${pad(hour)}:${pad(minute)}`;
    }
  }

  // 4. Period-qualified number without "h": e.g., "2 da tarde", "3 e meia da tarde", "7 da noite"
  const periodOnlyMatch = q.match(/\b(\d{1,2})(?:\s+e\s+meia)?\s+da\s+(manha|tarde|noite)\b/);
  if (periodOnlyMatch) {
    let hour = Number(periodOnlyMatch[1]);
    const minute = /\be\s+meia\b/.test(periodOnlyMatch[0]) ? 30 : 0;
    const period = periodOnlyMatch[2];
    if ((period === "tarde" || period === "noite") && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    if (isValidHourMinute(hour, minute)) {
      return `${pad(hour)}:${pad(minute)}`;
    }
  }

  // 5. Preposition + bare hour: e.g., "às 14", "as 15", "para as 16", "às 14 e meia"
  const prepHourMatch = q.match(
    /(?:^|[\s,;(])(?:a\s+partir\s+das?|depois\s+das?|antes\s+das?|por\s+volta\s+das?|perto\s+das?|para\s+as?|pras?|pelas?|as)\s+(\d{1,2})(?:\s+e\s+meia)?(?!\s*(?:dias?|horas?|hrs?|min|minutos?|reais|%|\/|-|\d))\b/,
  );
  if (prepHourMatch) {
    const hour = Number(prepHourMatch[1]);
    const minute = /\be\s+meia\b/.test(prepHourMatch[0]) ? 30 : 0;
    if (hour >= 7 && hour <= 22 && isValidHourMinute(hour, minute)) {
      return `${pad(hour)}:${pad(minute)}`;
    }
  }

  return null;
}

/**
 * Extracts an explicit duration hint when the client mentions time without a catalog service
 * (e.g. "3 horas", "2h30", "90 min"), ignoring clock times like "às 9h30" or "às 2 horas".
 */
export function parseExplicitDurationMin(text: string): number | null {
  const q = fold(text);
  const hhmm = q.match(/\b(\d{1,2})\s*h(?:oras?)?\s*(?:e\s*)?(\d{1,2})\s*(?:min(?:utos?)?)?\b/);
  if (hhmm) {
    const index = hhmm.index ?? 0;
    const before = q.slice(Math.max(0, index - 32), index);
    if (!TIME_PREFIX_PATTERN.test(before)) {
      const hours = Number(hhmm[1]);
      const mins = Number(hhmm[2]);
      if (hours >= 1 && hours <= 6 && mins > 0 && mins < 60) {
        return clampDurationMin(hours * 60 + mins);
      }
    }
  }
  const hoursOnly = q.match(/\b(\d{1,2})\s*(?:horas?|hrs?)\b/);
  if (hoursOnly) {
    const index = hoursOnly.index ?? 0;
    const before = q.slice(Math.max(0, index - 32), index);
    const after = q.slice(index + hoursOnly[0].length, index + hoursOnly[0].length + 18);
    if (!TIME_PREFIX_PATTERN.test(before) && !/^\s*da\s+(?:manha|tarde|noite)\b/.test(after)) {
      const hours = Number(hoursOnly[1]);
      if (hours >= 1 && hours <= 10) return clampDurationMin(hours * 60);
    }
  }
  const minsOnly = q.match(/\b(\d{2,3})\s*(?:minutos?|min)\b/);
  if (minsOnly) {
    const mins = Number(minsOnly[1]);
    if (mins >= MIN_SERVICE_DURATION_MIN && mins <= MAX_SERVICE_DURATION_MIN) return mins;
  }
  return null;
}

function explicitStartTimesForPrompt(slots: string[], slotMinutes: number): string {
  if (!slots.length) return "";
  if (slots.length <= 24) return slots.join(", ");

  // For very long open days (e.g., 40+ 15-min slots), list every 30-min/hour mark plus exact window bounds
  const groups = groupContiguousStartWindows(slots, slotMinutes);
  const endpoints = new Set<string>();
  for (const g of groups) {
    endpoints.add(g.from);
    endpoints.add(g.to);
  }
  const sampled = slots.filter((slot) => {
    if (endpoints.has(slot)) return true;
    const mins = parseHHmm(slot);
    return mins % 30 === 0;
  });
  return sampled.join(", ");
}

function nearestAvailableTimes(slots: string[], targetHHmm: string, limit = 4): string[] {
  if (!slots.length) return [];
  const targetMin = parseHHmm(targetHHmm);
  return slots
    .slice()
    .sort((a, b) => Math.abs(parseHHmm(a) - targetMin) - Math.abs(parseHHmm(b) - targetMin))
    .slice(0, limit)
    .sort((a, b) => parseHHmm(a) - parseHHmm(b));
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

  const headerLines = [`Consulta exata de agenda para ${result.label} (${result.date}) · ${servicePart}:`];
  if (result.currentTimeHHmm) {
    headerLines.push(`Horário atual agora no salão: ${result.currentTimeHHmm} (horários anteriores a este já passaram).`);
  }

  const lines = result.professionals.map((row) => {
    const busyPart =
      row.busy && row.busy.length > 0
        ? `horários ocupados: ${row.busy.map((b) => `${b.start}–${b.end}`).join(", ")}`
        : "agenda livre (nenhum agendamento neste dia)";

    let requestedPart = "";
    if (result.requestedTime) {
      if (row.startTimes.includes(result.requestedTime)) {
        requestedPart = ` | HORÁRIO PERGUNTADO ${result.requestedTime}: DISPONÍVEL (LIVRE)`;
      } else {
        const nearby = nearestAvailableTimes(row.startTimes, result.requestedTime);
        const nearbyText = nearby.length ? ` · opções próximas livres: ${nearby.join(", ")}` : "";
        requestedPart = ` | HORÁRIO PERGUNTADO ${result.requestedTime}: INDISPONÍVEL${nearbyText}`;
      }
    }

    if (!row.startTimes.length) {
      return `- ${row.name}: sem encaixe contínuo de ${durationText} neste dia (${busyPart})${requestedPart}`;
    }

    const explicitList = explicitStartTimesForPrompt(row.startTimes, result.slotMinutes);
    return `- ${row.name}: faixa livre ${row.summary} (${row.startTimes.length} horários de início a cada ${result.slotMinutes} min; exemplos/horários exatos livres: ${explicitList}; ${busyPart})${requestedPart}`;
  });

  lines.push(
    `Regra de leitura: qualquer horário dentro de uma faixa livre (ex.: 14:00 dentro de 13:30 até 18:00) ESTÁ LIVRE.`,
  );

  return [...headerLines, ...lines].join("\n");
}
