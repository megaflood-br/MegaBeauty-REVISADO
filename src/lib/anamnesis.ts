import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { canViewAllAnamnesis, type Access } from "@/lib/permissions";
import {
  DEFAULT_ANAMNESIS_FORMS,
  professionalAnamnesisAreas,
  serializeQuestions,
  type AnamnesisArea,
} from "@/lib/anamnesis-shared";

export * from "@/lib/anamnesis-shared";

const seeding = new Map<string, Promise<void>>();

export async function ensureAnamnesisForms(tenantId: string) {
  const existing = seeding.get(tenantId);
  if (existing) {
    await existing;
    return;
  }
  const task = seedIfEmpty(tenantId).finally(() => seeding.delete(tenantId));
  seeding.set(tenantId, task);
  await task;
}

async function seedIfEmpty(tenantId: string) {
  const count = await prisma.anamnesisForm.count({ where: { tenantId } });
  if (count > 0) return;
  for (const [index, form] of DEFAULT_ANAMNESIS_FORMS.entries()) {
    await prisma.anamnesisForm.create({
      data: {
        tenantId,
        name: form.name,
        slug: form.slug,
        area: form.area,
        description: form.description,
        questions: serializeQuestions(form.questions),
        sortOrder: index,
      },
    });
  }
}

export async function anamnesisAreasForAccess(
  tenantId: string,
  access: Pick<Access, "isAdmin" | "professionalId" | "grants">,
): Promise<AnamnesisArea[] | null> {
  if (canViewAllAnamnesis(access)) return null;
  return loadProfessionalAnamnesisScope(tenantId, access.professionalId);
}

export async function loadProfessionalAnamnesisScope(
  tenantId: string,
  professionalId: string | null | undefined,
): Promise<AnamnesisArea[]> {
  if (!professionalId) return ["geral"];
  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, tenantId },
    select: {
      specialty: true,
      serviceLinks: {
        select: {
          service: { select: { name: true, category: { select: { name: true } } } },
        },
      },
    },
  });
  if (!professional) return ["geral"];
  return professionalAnamnesisAreas({
    specialty: professional.specialty,
    services: professional.serviceLinks.map((link) => ({
      name: link.service.name,
      categoryName: link.service.category?.name ?? null,
    })),
  });
}

export function createAnamnesisInviteToken() {
  return randomBytes(24).toString("base64url");
}
