import { requireSupplier } from "@/lib/tenant";
import { SupplierShell } from "@/components/fornecedor/supplier-shell";
import { loadSupplierOnboardingState } from "@/lib/onboarding-server";
import { loadPlatformModules } from "@/lib/platform-modules-server";

export default async function FornecedorLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant } = await requireSupplier();
  const modules = await loadPlatformModules();
  const onboarding = modules.onboardingTours ? await loadSupplierOnboardingState(session, tenant) : null;
  return (
    <SupplierShell
      company={tenant.name}
      userName={session.name}
      impersonatorName={session.impersonatorName}
      onboarding={onboarding}
    >
      {children}
    </SupplierShell>
  );
}
