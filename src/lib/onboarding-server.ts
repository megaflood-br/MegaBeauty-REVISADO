import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canAccess, PERMISSION_MODULES, type Access, type PermissionModuleId } from "@/lib/permissions";
import { isSalonWhatsAppConnected, type SalonWhatsAppTenant } from "@/lib/whatsapp-send";
import { parseServedCities } from "@/lib/br-cities";
import { parseSupplierPayMethods } from "@/lib/supplier-market";
import {
  buildOnboardingState,
  buildPartnerOnboardingState,
  buildSupplierOnboardingState,
  canRunOnboardingTour,
  type OnboardingState,
} from "@/lib/onboarding";

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

type SupplierOnboardingTenantInput = {
  id: string;
  name: string;
  slug: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  servedCities?: string | null;
  supplierPayMethods?: string | null;
  deliveryMinCents: number;
  deliveryFeeCents: number;
};

type PartnerOnboardingInput = {
  id: string;
  slug: string;
  commissionBps: number;
  holdDays: number;
  pixKey?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  brand?: {
    name?: string | null;
    logoUrl?: string | null;
    logoDarkUrl?: string | null;
    customHost?: string | null;
    landingHeadline?: string | null;
    landingText?: string | null;
  } | null;
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

export async function loadSupplierOnboardingState(
  session: SessionUser,
  tenant: SupplierOnboardingTenantInput,
): Promise<OnboardingState> {
  const servedCitiesCount = parseServedCities(tenant.servedCities ?? "").length;
  const payMethodsCount = parseSupplierPayMethods(tenant.supplierPayMethods ?? "").length;

  if (session.impersonatorName) {
    return buildSupplierOnboardingState({
      companyName: tenant.name,
      companySlug: tenant.slug,
      phone: tenant.phone,
      city: tenant.city,
      address: tenant.address,
      servedCitiesCount,
      payMethodsCount,
      deliveryMinCents: tenant.deliveryMinCents,
      deliveryFeeCents: tenant.deliveryFeeCents,
      activeProductsCount: 0,
      activePromotionsCount: 0,
      ordersCount: 0,
      isImpersonating: true,
      tourStatus: "DISMISSED",
      savedStepIndex: 0,
    });
  }

  const [user, activeProductsCount, activePromotionsCount, ordersCount] = await Promise.all([
    prisma.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId },
      select: { onboardingTourStatus: true, onboardingTourStep: true },
    }),
    prisma.supplierProduct.count({
      where: { tenantId: session.tenantId, active: true },
    }),
    prisma.supplierPromotion.count({
      where: { tenantId: session.tenantId, active: true },
    }),
    prisma.supplierOrder.count({
      where: { supplierTenantId: session.tenantId },
    }),
  ]);

  return buildSupplierOnboardingState({
    companyName: tenant.name,
    companySlug: tenant.slug,
    phone: tenant.phone,
    city: tenant.city,
    address: tenant.address,
    servedCitiesCount,
    payMethodsCount,
    deliveryMinCents: tenant.deliveryMinCents,
    deliveryFeeCents: tenant.deliveryFeeCents,
    activeProductsCount,
    activePromotionsCount,
    ordersCount,
    isImpersonating: false,
    tourStatus: user?.onboardingTourStatus ?? "PENDING",
    savedStepIndex: user?.onboardingTourStep ?? 0,
  });
}

export async function loadPartnerOnboardingState(
  session: SessionUser,
  partner: PartnerOnboardingInput,
): Promise<OnboardingState> {
  const brandName = partner.brand?.name?.trim() || partner.slug;
  const hasLogo = Boolean(partner.brand?.logoUrl?.trim() || partner.brand?.logoDarkUrl?.trim());
  const hasCustomHost = Boolean(partner.brand?.customHost?.trim());
  const hasLandingCopy = Boolean(
    partner.brand?.landingHeadline?.trim() && partner.brand?.landingText?.trim(),
  );
  const hasPayoutInfo = Boolean(
    partner.pixKey?.trim() || (partner.bankName?.trim() && partner.bankAccount?.trim()),
  );

  if (session.impersonatorName) {
    return buildPartnerOnboardingState({
      brandName,
      slug: partner.slug,
      commissionBps: partner.commissionBps,
      holdDays: partner.holdDays,
      hasLogo,
      hasCustomHost,
      customHost: partner.brand?.customHost,
      hasLandingCopy,
      hasPayoutInfo,
      referredCount: 0,
      paidInvoicesCount: 0,
      isImpersonating: true,
      tourStatus: "DISMISSED",
      savedStepIndex: 0,
    });
  }

  const [user, referredCount, paidInvoicesCount] = await Promise.all([
    prisma.user.findFirst({
      where: { id: session.userId, tenantId: session.tenantId },
      select: { onboardingTourStatus: true, onboardingTourStep: true },
    }),
    prisma.tenant.count({
      where: { partnerId: partner.id, kind: "SALON" },
    }),
    prisma.platformInvoice.count({
      where: { partnerId: partner.id, status: "PAID" },
    }),
  ]);

  return buildPartnerOnboardingState({
    brandName,
    slug: partner.slug,
    commissionBps: partner.commissionBps,
    holdDays: partner.holdDays,
    hasLogo,
    hasCustomHost,
    customHost: partner.brand?.customHost,
    hasLandingCopy,
    hasPayoutInfo,
    referredCount,
    paidInvoicesCount,
    isImpersonating: false,
    tourStatus: user?.onboardingTourStatus ?? "PENDING",
    savedStepIndex: user?.onboardingTourStep ?? 0,
  });
}
