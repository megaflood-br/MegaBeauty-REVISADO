import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import {
  PLAN_INTERVALS,
  PLAN_INTERVAL_LABEL,
  parsePlanFeatures,
  serializePlanFeatures,
  featuresFromText,
  formatPlanPrice,
  planLabel,
  type PlanInterval,
} from "@/lib/plan-format";

export {
  PLAN_INTERVALS,
  PLAN_INTERVAL_LABEL,
  parsePlanFeatures,
  serializePlanFeatures,
  featuresFromText,
  formatPlanPrice,
  planLabel,
  type PlanInterval,
};

export const DEFAULT_PLATFORM_PLANS = [
  {
    name: "Essencial",
    slug: "essencial",
    description: "Agenda, clientes e financeiro básico para começar.",
    priceCents: 9900,
    interval: "monthly" as const,
    trialDays: 14,
    features: ["Agenda e clientes", "Comandas e caixa", "1 unidade"],
    highlighted: false,
    isDefault: false,
    sortOrder: 0,
  },
  {
    name: "Profissional",
    slug: "profissional",
    description: "O plano padrão para salões em operação.",
    priceCents: 19900,
    interval: "monthly" as const,
    trialDays: 14,
    features: ["Tudo do Essencial", "Comissões e estoque", "WhatsApp e anamnese"],
    highlighted: true,
    isDefault: true,
    sortOrder: 1,
  },
  {
    name: "Premium",
    slug: "premium",
    description: "Operação completa para redes e revenda.",
    priceCents: 34900,
    interval: "monthly" as const,
    trialDays: 14,
    features: ["Tudo do Profissional", "Suporte prioritário", "Várias unidades"],
    highlighted: false,
    isDefault: false,
    sortOrder: 2,
  },
] as const;

export async function ensurePlatformPlans() {
  const count = await prisma.platformPlan.count();
  if (count > 0) return;
  await prisma.platformPlan.createMany({
    data: DEFAULT_PLATFORM_PLANS.map((plan) => ({
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      priceCents: plan.priceCents,
      interval: plan.interval,
      trialDays: plan.trialDays,
      features: serializePlanFeatures([...plan.features]),
      highlighted: plan.highlighted,
      isDefault: plan.isDefault,
      sortOrder: plan.sortOrder,
      active: true,
    })),
  });
}

export async function listPlatformPlans(activeOnly = false) {
  await ensurePlatformPlans();
  return prisma.platformPlan.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function resolveSignupPlan() {
  await ensurePlatformPlans();
  const preferred =
    (await prisma.platformPlan.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { sortOrder: "asc" },
    })) ??
    (await prisma.platformPlan.findFirst({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }));
  return preferred;
}

export function nextPlanSlug(name: string, existing: string[]) {
  const slug = slugify(name) || "plano";
  if (!existing.includes(slug)) return slug;
  let i = 2;
  while (existing.includes(`${slug}-${i}`)) i += 1;
  return `${slug}-${i}`;
}
