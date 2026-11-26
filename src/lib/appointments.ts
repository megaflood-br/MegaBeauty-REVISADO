export type Interval = { start: Date; end: Date; id?: string };

export function overlaps(a: Interval, b: Interval) {
  return a.start < b.end && a.end > b.start;
}

export function hasConflict(candidate: Interval, existing: Interval[]) {
  return existing.some((item) => {
    if (candidate.id && item.id === candidate.id) return false;
    return overlaps(candidate, item);
  });
}

export function occupancyPercent(busyMinutes: number, workMinutes: number) {
  if (workMinutes <= 0) return 0;
  return Math.min(100, Math.round((busyMinutes / workMinutes) * 100));
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateScheduleBlockWindow(input: {
  date: string;
  startTime: string;
  endTime: string;
}): { ok: true; startMin: number; endMin: number; durationMin: number } | { ok: false; error: string } {
  const date = input.date.trim();
  const startTime = input.startTime.trim();
  const endTime = input.endTime.trim();
  if (!DATE_RE.test(date)) {
    return { ok: false, error: "Informe uma data válida." };
  }
  const startMatch = startTime.match(HHMM_RE);
  const endMatch = endTime.match(HHMM_RE);
  if (!startMatch || !endMatch) {
    return { ok: false, error: "Informe horários de início e fim válidos." };
  }
  const startMin = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const endMin = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  if (endMin <= startMin) {
    return { ok: false, error: "O horário de término precisa ser maior que o de início." };
  }
  if (endMin - startMin < 5) {
    return { ok: false, error: "O bloqueio precisa ter pelo menos 5 minutos." };
  }
  return { ok: true, startMin, endMin, durationMin: endMin - startMin };
}
