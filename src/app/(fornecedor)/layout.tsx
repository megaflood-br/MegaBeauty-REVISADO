import { requireSupplier } from "@/lib/tenant";
import { SupplierShell } from "@/components/fornecedor/supplier-shell";
import { loadSupplierOnboardingState } from "@/lib/onboarding-server";

export default async function FornecedorLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant } = await requireSupplier();
  const onboarding = await loadSupplierOnboardingState(session, tenant);
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
