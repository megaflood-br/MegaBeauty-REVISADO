import { requirePartner } from "@/lib/tenant";
import { PartnerShell } from "@/components/parceiro/partner-shell";
import { loadPartnerOnboardingState } from "@/lib/onboarding-server";
import { loadPlatformModules } from "@/lib/platform-modules-server";

export default async function ParceiroLayout({ children }: { children: React.ReactNode }) {
  const { session, partner } = await requirePartner();
  const modules = await loadPlatformModules();
  const onboarding = modules.onboardingTours ? await loadPartnerOnboardingState(session, partner) : null;
  return (
    <PartnerShell
      brandName={partner.brand?.name || partner.slug}
      userName={session.name}
      impersonatorName={session.impersonatorName}
      onboarding={onboarding}
      marketingDriveEnabled={modules.partnerMarketingDrive}
    >
      {children}
    </PartnerShell>
  );
}
