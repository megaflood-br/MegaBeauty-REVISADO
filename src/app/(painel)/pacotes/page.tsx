import { requireTenant } from "@/lib/tenant";
import { canAccess, shouldHidePhones } from "@/lib/permissions";
import { loadPackagesWorkspace } from "@/lib/packages";
import { loadPlatformModules } from "@/lib/platform-modules-server";
import { moduleDisabledMessage } from "@/lib/platform-modules";
import { PackagesBoard } from "@/components/pacotes/packages-board";

export default async function PacotesPage({
  searchParams,
}: {
  searchParams: Promise<{ novo?: string; cliente?: string }>;
}) {
  const { session, access } = await requireTenant();
  const modules = await loadPlatformModules();
  if (!modules.packages) {
    return (
      <div className="rounded-xl border border-line bg-white p-8 text-sm text-ink-soft">
        {moduleDisabledMessage("packages")}
      </div>
    );
  }
  const hidePhones = shouldHidePhones(access);
  const [workspace, params] = await Promise.all([
    loadPackagesWorkspace(session.tenantId, hidePhones),
    searchParams,
  ]);

  return (
    <PackagesBoard
      templates={workspace.templates}
      clientPackages={workspace.clientPackages}
      clients={workspace.clients}
      balancesByClient={workspace.balancesByClient}
      professionals={workspace.professionals}
      services={workspace.services}
      products={workspace.products}
      paymentMethods={workspace.paymentMethods}
      canCreate={canAccess(access, "comandas", "create")}
      canEdit={canAccess(access, "comandas", "edit")}
      canRemove={canAccess(access, "comandas", "remove")}
      hidePhones={hidePhones}
      initialNewOpen={params.novo === "1"}
      initialClientId={params.cliente ?? ""}
    />
  );
}
