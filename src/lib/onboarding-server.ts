import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canAccess, PERMISSION_MODULES, type Access, type PermissionModuleId } from "@/lib/permissions";
import { isSalonWhatsAppConnected, type SalonWhatsAppTenant } from "@/lib/whatsapp-send";
import { buildOnboardingState, canRunOnboardingTour, type OnboardingState } from "@/lib/onboarding";

type OnboardingTenantInput = SalonWhatsAppTenant & {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
};

export async function loadOnboardingState(
  session: SessionUser,
  tenant: OnboardingTenantInput,
  access: Access,
): Promise<OnboardingState> {
  const canRun = canRunOnboardingTour(access);
  const allowedModules: PermissionModuleId[] = PERMISSION_MODULES.map((m) => m.id).filter((id) =>
    canAccess(access, id),
  );

  if (!canRun || session.impersonatorName) {
    return buildOnboardingState({
      salonName: tenant.name,
      salonSlug: tenant.slug,
      phone: tenant.phone,
      city: tenant.city,
      address: tenant.address,
      openTime: tenant.openTime,
      closeTime: tenant.closeTime,
      activeServicesCount: 0,
      activeProfessionalsCount: 0,
      linkedProfessionalsCount: 0,
      clientsCount: 0,
      appointmentsCount: 0,
      whatsappConnected: false,
      canRunTour: false,
      isImpersonating: Boolean(session.impersonatorName),
      tourStatus: "DISMISSED",
      savedStepIndex: 0,
      allowedModules,
    });
  }

  const [
    user,
    activeServicesCount,
    activeProfessionalsCount,
    linkedProfessionalsCount,
    clientsCount,
    appointmentsCount,
  ] = await Promise.all([
    prisma.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId },
      select: { onboardingTourStatus: true, onboardingTourStep: true },
    }),
    prisma.service.count({
      where: { tenantId: session.tenantId, active: true },
    }),
    prisma.professional.count({
      where: { tenantId: session.tenantId, active: true },
    }),
    prisma.professional.count({
      where: {
        tenantId: session.tenantId,
        active: true,
        serviceLinks: { some: { service: { active: true } } },
      },
    }),
    prisma.client.count({
      where: { tenantId: session.tenantId },
    }),
    prisma.appointment.count({
      where: { tenantId: session.tenantId, status: { not: "CANCELLED" } },
    }),
  ]);

  return buildOnboardingState({
    salonName: tenant.name,
    salonSlug: tenant.slug,
    phone: tenant.phone,
    city: tenant.city,
    address: tenant.address,
    openTime: tenant.openTime,
    closeTime: tenant.closeTime,
    activeServicesCount,
    activeProfessionalsCount,
    linkedProfessionalsCount,
    clientsCount,
    appointmentsCount,
    whatsappConnected: isSalonWhatsAppConnected(tenant),
    canRunTour: canRun,
    isImpersonating: Boolean(session.impersonatorName),
    tourStatus: user?.onboardingTourStatus ?? "PENDING",
    savedStepIndex: user?.onboardingTourStep ?? 0,
    allowedModules,
  });
}
