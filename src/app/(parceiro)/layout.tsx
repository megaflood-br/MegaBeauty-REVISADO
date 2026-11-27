import { requirePartner } from "@/lib/tenant";
import { PartnerShell } from "@/components/parceiro/partner-shell";
import { loadPartnerOnboardingState } from "@/lib/onboarding-server";

export default async function ParceiroLayout({ children }: { children: React.ReactNode }) {
  const { session, partner } = await requirePartner();
  const onboarding = await loadPartnerOnboardingState(session, partner);
  return (
    <PartnerShell
      brandName={partner.brand?.name || partner.slug}
      userName={session.name}
      impersonatorName={session.impersonatorName}
      onboarding={onboarding}
    >
      {children}
    </PartnerShell>
  );
}
