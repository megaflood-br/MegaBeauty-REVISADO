"use client";

import { ClipboardList, Package, Settings, Tag } from "lucide-react";
import { stopImpersonation } from "@/app/actions/platform";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { SidebarLayout, type SidebarNavItem } from "@/components/sidebar-layout";
import {
  OnboardingProvider,
  SidebarTourTrigger,
  useOnboarding,
} from "@/components/onboarding/onboarding-provider";
import type { OnboardingState } from "@/lib/onboarding";

const NAV: SidebarNavItem[] = [
  { href: "/fornecedor", label: "Produtos", icon: Package, exact: true },
  { href: "/fornecedor/promocoes", label: "Promoções", icon: Tag },
  { href: "/fornecedor/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/fornecedor/empresa", label: "Empresa", icon: Settings },
];

function SupplierShellLayout({
  children,
  company,
  userName,
  impersonatorName,
}: {
  children: React.ReactNode;
  company: string;
  userName: string;
  impersonatorName?: string | null;
}) {
  const onboarding = useOnboarding();
  return (
    <SidebarLayout
      plan="Fornecedor"
      title={company}
      userName={userName}
      items={NAV}
      footerAction={<SidebarTourTrigger />}
      highlightedHref={onboarding?.highlightedHref ?? null}
      banner={
        impersonatorName ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            <span>
              Você entrou como suporte na empresa <strong>{company}</strong> ({impersonatorName}).
            </span>
            <form action={stopImpersonation}>
              <button type="submit" className="font-medium underline">
                Voltar à plataforma
              </button>
            </form>
          </div>
        ) : null
      }
    >
      {children}
    </SidebarLayout>
  );
}

export function SupplierShell({
  children,
  company,
  userName,
  impersonatorName,
  onboarding,
}: {
  children: React.ReactNode;
  company: string;
  userName: string;
  impersonatorName?: string | null;
  onboarding?: OnboardingState | null;
}) {
  const content = (
    <SupplierShellLayout company={company} userName={userName} impersonatorName={impersonatorName}>
      {children}
    </SupplierShellLayout>
  );

  return (
    <ConfirmProvider>
      {onboarding ? <OnboardingProvider state={onboarding}>{content}</OnboardingProvider> : content}
    </ConfirmProvider>
  );
}
