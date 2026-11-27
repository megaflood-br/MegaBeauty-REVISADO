"use client";

import { Handshake, Link2, Palette, LayoutDashboard, Megaphone, Users, Wallet } from "lucide-react";
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
  { href: "/parceiro", label: "Painel", icon: LayoutDashboard, exact: true },
  { href: "/parceiro/links", label: "Meus links", icon: Link2 },
  { href: "/parceiro/aparencia", label: "Marca do sistema", icon: Palette },
  { href: "/parceiro/landing", label: "Landing page", icon: Megaphone },
  { href: "/parceiro/clientes", label: "Clientes", icon: Users },
  { href: "/parceiro/financeiro", label: "Financeiro", icon: Wallet },
];

function PartnerShellLayout({
  children,
  brandName,
  userName,
  impersonatorName,
}: {
  children: React.ReactNode;
  brandName: string;
  userName: string;
  impersonatorName?: string | null;
}) {
  const onboarding = useOnboarding();
  return (
    <SidebarLayout
      plan="Parceiro"
      title={brandName}
      userName={userName}
      items={NAV}
      headerAction={<Handshake size={16} className="text-slate-400" />}
      footerAction={<SidebarTourTrigger />}
      highlightedHref={onboarding?.highlightedHref ?? null}
      banner={
        impersonatorName ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            <span>
              Você entrou como suporte no parceiro <strong>{brandName}</strong> ({impersonatorName}).
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

export function PartnerShell({
  children,
  brandName,
  userName,
  impersonatorName,
  onboarding,
}: {
  children: React.ReactNode;
  brandName: string;
  userName: string;
  impersonatorName?: string | null;
  onboarding?: OnboardingState | null;
}) {
  const content = (
    <PartnerShellLayout brandName={brandName} userName={userName} impersonatorName={impersonatorName}>
      {children}
    </PartnerShellLayout>
  );

  return (
    <ConfirmProvider>
      {onboarding ? <OnboardingProvider state={onboarding}>{content}</OnboardingProvider> : content}
    </ConfirmProvider>
  );
}
