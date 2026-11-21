import { formatBRL } from "@/lib/money";

export const PLAN_INTERVALS = ["monthly", "yearly"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const PLAN_INTERVAL_LABEL: Record<PlanInterval, string> = {
  monthly: "Mensal",
  yearly: "Anual",
};

export function parsePlanFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // fallback: one feature per line
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

export function serializePlanFeatures(features: string[]) {
  return JSON.stringify(features.map((item) => item.trim()).filter(Boolean));
}

export function featuresFromText(value: string) {
  return serializePlanFeatures(parsePlanFeatures(value));
}

export function formatPlanPrice(priceCents: number, interval: string = "monthly") {
  if (priceCents <= 0) return "Grátis";
  const period = PLAN_INTERVAL_LABEL[interval as PlanInterval] ?? interval;
  return `${formatBRL(priceCents)}/${period.toLowerCase()}`;
}

export function planLabel(slug: string, plans: { slug: string; name: string }[]) {
  return plans.find((plan) => plan.slug === slug)?.name ?? slug;
}
