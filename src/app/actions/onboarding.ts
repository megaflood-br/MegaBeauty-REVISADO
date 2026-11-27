"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/tenant";
import { loadAccess } from "@/lib/access";
import { canRunOnboardingTour, normalizeTourStatus, type OnboardingTourStatus } from "@/lib/onboarding";

const MAX_STEP_INDEX = 10;

export async function updateOnboardingTourState(input: {
  status: OnboardingTourStatus;
  stepIndex?: number;
}) {
  const session = await requireSession();
  if (session.impersonatorName) {
    return { ok: false as const, error: "Sem permissão para alterar o tour inicial durante suporte." };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, kind: true, status: true },
  });
  if (!tenant || tenant.status === "SUSPENDED") {
    return { ok: false as const, error: "Conta indisponível." };
  }

  if (tenant.kind === "SALON") {
    const access = await loadAccess(session);
    if (!canRunOnboardingTour(access)) {
      return { ok: false as const, error: "Sem permissão para alterar o tour inicial." };
    }
  } else if (tenant.kind !== "SUPPLIER" && tenant.kind !== "PARTNER") {
    return { ok: false as const, error: "Portal não suportado para este tour." };
  }

  const status = normalizeTourStatus(input.status);
  const stepIndex =
    typeof input.stepIndex === "number" && Number.isFinite(input.stepIndex)
      ? Math.max(0, Math.min(MAX_STEP_INDEX, Math.floor(input.stepIndex)))
      : undefined;

  await prisma.user.updateMany({
    where: { id: session.userId, tenantId: session.tenantId },
    data: {
      onboardingTourStatus: status,
      ...(stepIndex !== undefined ? { onboardingTourStep: stepIndex } : {}),
      ...(status === "COMPLETED" ? { onboardingTourCompletedAt: new Date() } : {}),
    },
  });

  if (tenant.kind === "SUPPLIER") {
    revalidatePath("/fornecedor");
  } else if (tenant.kind === "PARTNER") {
    revalidatePath("/parceiro");
  } else {
    revalidatePath("/dashboard");
  }
  return { ok: true as const, status };
}
