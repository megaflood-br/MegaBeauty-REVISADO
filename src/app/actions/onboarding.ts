"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canRunOnboardingTour, normalizeTourStatus, type OnboardingTourStatus } from "@/lib/onboarding";

const MAX_STEP_INDEX = 10;

export async function updateOnboardingTourState(input: {
  status: OnboardingTourStatus;
  stepIndex?: number;
}) {
  const { session, access } = await requireTenant();
  if (!canRunOnboardingTour(access) || session.impersonatorName) {
    return { ok: false as const, error: "Sem permissão para alterar o tour inicial." };
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

  revalidatePath("/dashboard");
  return { ok: true as const, status };
}
