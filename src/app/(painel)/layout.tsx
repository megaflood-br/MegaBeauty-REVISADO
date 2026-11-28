import { headers } from "next/headers";
import { requireTenant } from "@/lib/tenant";
import { AppShell } from "@/components/app-shell";
import { listPlatformPlans, planLabel } from "@/lib/plans";
import { loadSalonNotices } from "@/lib/salon-notices";
import { loadOnboardingState } from "@/lib/onboarding-server";
import { loadPlatformModules } from "@/lib/platform-modules-server";
import { allowedNavHrefs, canAccess, moduleFromPath } from "@/lib/permissions";

const NAV_HREFS = [
  "/dashboard",
  "/ia",
  "/atendimento",
  "/recepcionista",
  "/agenda",
  "/comandas",
  "/pacotes",
  "/clientes",
  "/anamneses",
  "/documentacao",
  "/equipe",
  "/usuarios",
  "/permissoes",
  "/metas",
  "/comissoes",
  "/financeiro",
  "/notas",
  "/estoque",
  "/servicos",
  "/promocoes",
  "/fornecedores",
  "/marketing",
  "/cadastros",
  "/suporte",
  "/configuracoes",
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { session, tenant, access } = await requireTenant();
  const [catalog, notices, modules, headerList] = await Promise.all([
    listPlatformPlans(),
    loadSalonNotices(session.tenantId, tenant.city),
    loadPlatformModules(),
    headers(),
  ]);
  const onboarding = modules.onboardingTours
    ? await loadOnboardingState(session, tenant, access)
    : null;
  const pathname = headerList.get("x-pathname") || "";
  const area = moduleFromPath(pathname);
  const allowed = area ? canAccess(access, area) : true;
  const visibleNavHrefs = modules.packages
    ? NAV_HREFS
    : NAV_HREFS.filter((href) => href !== "/pacotes");
  return (
    <AppShell
      salon={tenant.name}
      userName={session.name}
      plan={planLabel(tenant.plan, catalog)}
      impersonatorName={session.impersonatorName}
      noticeCount={notices.noticeCount}
      allowedHrefs={allowedNavHrefs(access, visibleNavHrefs)}
      onboarding={onboarding}
    >
      {allowed ? (
        children
      ) : (
        <div className="rounded-xl border border-line bg-paper p-8 text-sm text-ink-soft">
          Sem permissão para abrir esta área. Peça ao proprietário para liberar o acesso em Permissões.
        </div>
      )}
    </AppShell>
  );
}
