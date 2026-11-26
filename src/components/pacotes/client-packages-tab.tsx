"use client";

import { useMemo, useState } from "react";
import { Calendar, Eye, Package, Plus, Scissors, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui";
import { PackageDrawer } from "@/components/pacotes/package-drawer";
import { PackageDetailDrawer } from "@/components/pacotes/package-detail-drawer";
import { formatBRL } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import {
  PACKAGE_STATUS_COLOR,
  PACKAGE_STATUS_LABEL,
  type ClientPackageBalanceItem,
  type ClientPackageDto,
  type PackageClientSummary,
  type PackageTemplateDto,
} from "@/lib/packages-shared";
import type { PaymentMethodOption } from "@/components/comandas/types";

export function ClientPackagesTab({
  clientId,
  packages,
  templates,
  clients,
  balancesByClient,
  professionals,
  services,
  products,
  paymentMethods,
  canCreate = true,
  canEdit = true,
  canRemove = true,
  hidePhones = false,
}: {
  clientId: string;
  packages: ClientPackageDto[];
  templates: PackageTemplateDto[];
  clients: PackageClientSummary[];
  balancesByClient: Record<string, ClientPackageBalanceItem[]>;
  professionals: { id: string; name: string }[];
  services: {
    id: string;
    name: string;
    priceCents: number;
    durationMin?: number;
    promoPriceCents?: number | null;
    promoName?: string | null;
  }[];
  products: {
    id: string;
    name: string;
    priceCents: number;
    promoPriceCents?: number | null;
    promoName?: string | null;
  }[];
  paymentMethods: PaymentMethodOption[];
  canCreate?: boolean;
  canEdit?: boolean;
  canRemove?: boolean;
  hidePhones?: boolean;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedPkg = useMemo(
    () => (selectedId ? packages.find((p) => p.id === selectedId) ?? null : null),
    [packages, selectedId],
  );

  const activePackages = packages.filter((p) => p.effectiveStatus === "ACTIVE");
  const totalRemainingUnits = activePackages.reduce((sum, p) => sum + p.remaining, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Pacotes do cliente</h2>
          <p className="text-xs text-ink-soft">
            {activePackages.length === 0
              ? "Nenhum pacote ativo no momento. Itens de pacotes ativos são abatidos automaticamente nas comandas."
              : `${activePackages.length} ${activePackages.length === 1 ? "pacote ativo" : "pacotes ativos"} · ${totalRemainingUnits} ${
                  totalRemainingUnits === 1 ? "sessão/item disponível" : "sessões/itens disponíveis"
                }`}
          </p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={() => setNewOpen(true)}>
            <Plus size={15} />
            Novo pacote
          </Button>
        ) : null}
      </div>

      {packages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center">
          <Package size={26} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-ink-soft">Nenhum pacote vinculado a este cliente.</p>
          {canCreate ? (
            <Button type="button" variant="outline" className="mt-3" onClick={() => setNewOpen(true)}>
              <Plus size={14} />
              Adicionar primeiro pacote
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-blue-700">#{pkg.number}</span>
                    <span className="font-semibold text-ink">{pkg.name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        PACKAGE_STATUS_COLOR[pkg.effectiveStatus]
                      }`}
                    >
                      {PACKAGE_STATUS_LABEL[pkg.effectiveStatus]}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} />
                      Compra: {formatShortDate(new Date(pkg.purchasedAt))}
                    </span>
                    <span>
                      Validade: {pkg.expiresAt ? formatShortDate(new Date(pkg.expiresAt)) : "Sem validade"}
                    </span>
                    {pkg.sellerName ? <span>Vendedor: {pkg.sellerName}</span> : null}
                    <span>Valor: {formatBRL(pkg.totalCents)}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => setSelectedId(pkg.id)}
                >
                  <Eye size={13} />
                  Detalhes / Baixa
                </Button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {pkg.items.map((item) => {
                  const used = Math.max(0, item.totalQty - item.remainingQty);
                  const pct = item.totalQty > 0 ? Math.round((used / item.totalQty) * 100) : 100;
                  return (
                    <div key={item.id} className="rounded-lg border border-line bg-slate-50/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          {item.type === "PRODUCT" ? (
                            <ShoppingBag size={12} className="text-ink-soft" />
                          ) : (
                            <Scissors size={12} className="text-ink-soft" />
                          )}
                          {item.description}
                        </span>
                        <span className="font-semibold text-blue-700">
                          Saldo: {item.remainingQty}/{item.totalQty}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {newOpen ? (
        <PackageDrawer
          key={`client-pkg-${clientId}`}
          open
          initialClientId={clientId}
          lockClient
          clients={clients}
          balancesByClient={balancesByClient}
          templates={templates}
          professionals={professionals}
          services={services}
          products={products}
          paymentMethods={paymentMethods}
          hidePhones={hidePhones}
          onClose={() => setNewOpen(false)}
        />
      ) : null}

      <PackageDetailDrawer
        pkg={selectedPkg}
        canEdit={canEdit}
        canRemove={canRemove}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
