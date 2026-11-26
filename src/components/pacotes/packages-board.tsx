"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CircleDollarSign,
  Layers,
  Package,
  Pencil,
  Plus,
  Scissors,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { deletePackageTemplate, togglePackageTemplate } from "@/app/actions/packages";
import { PackageDrawer } from "@/components/pacotes/package-drawer";
import { TemplateDrawer } from "@/components/pacotes/template-drawer";
import { PackageDetailDrawer } from "@/components/pacotes/package-detail-drawer";
import { formatBRL } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import {
  PACKAGE_STATUS_COLOR,
  PACKAGE_STATUS_LABEL,
  type ClientPackageBalanceItem,
  type ClientPackageDto,
  type ClientPackageStatus,
  type PackageClientSummary,
  type PackageTemplateDto,
} from "@/lib/packages-shared";
import type { PaymentMethodOption } from "@/components/comandas/types";

export function PackagesBoard({
  templates,
  clientPackages,
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
  initialNewOpen = false,
  initialClientId = "",
}: {
  templates: PackageTemplateDto[];
  clientPackages: ClientPackageDto[];
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
  initialNewOpen?: boolean;
  initialClientId?: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"clientes" | "modelos">("clientes");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ClientPackageStatus>("ALL");
  const [newPackageOpen, setNewPackageOpen] = useState(initialNewOpen && canCreate);
  const [newPackageClientId, setNewPackageClientId] = useState(initialClientId);
  const [editingTemplate, setEditingTemplate] = useState<PackageTemplateDto | null | undefined>(undefined);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);

  const selectedPkg = useMemo(
    () => (selectedPkgId ? clientPackages.find((p) => p.id === selectedPkgId) ?? null : null),
    [clientPackages, selectedPkgId],
  );

  const stats = useMemo(() => {
    const active = clientPackages.filter((p) => p.effectiveStatus === "ACTIVE");
    const availableUnits = active.reduce((sum, p) => sum + p.remaining, 0);
    const totalRevenueCents = clientPackages
      .filter((p) => p.effectiveStatus !== "CANCELLED")
      .reduce((sum, p) => sum + p.totalCents, 0);
    const activeTemplates = templates.filter((t) => t.active).length;
    return {
      activeCount: active.length,
      availableUnits,
      totalRevenueCents,
      activeTemplates,
    };
  }, [clientPackages, templates]);

  const filteredPackages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clientPackages.filter((pkg) => {
      if (statusFilter !== "ALL" && pkg.effectiveStatus !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        `#${pkg.number}`,
        pkg.name,
        pkg.clientName,
        pkg.sellerName ?? "",
        ...pkg.items.map((i) => i.description),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [clientPackages, statusFilter, query]);

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((tpl) => {
      const hay = [tpl.name, tpl.description ?? "", ...tpl.items.map((i) => i.description)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [templates, query]);

  async function handleToggleTemplate(tpl: PackageTemplateDto) {
    await togglePackageTemplate(tpl.id, !tpl.active);
    router.refresh();
  }

  async function handleDeleteTemplate(tpl: PackageTemplateDto) {
    const ok = await confirm({
      title: `Excluir o modelo "${tpl.name}"?`,
      description: "Os pacotes já vendidos para clientes continuarão ativos com seus respectivos saldos.",
      confirmLabel: "Excluir modelo",
    });
    if (!ok) return;
    await deletePackageTemplate(tpl.id);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Pacotes</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Venda pacotes de serviços e produtos anexados ao perfil do cliente com baixa automática nas comandas.
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingTemplate(null)}>
              <Plus size={16} />
              Pacote predefinido
            </Button>
            <Button
              type="button"
              onClick={() => {
                setNewPackageClientId("");
                setNewPackageOpen(true);
              }}
            >
              <Plus size={16} />
              Novo pacote
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Package size={18} className="text-blue-600" />} label="Pacotes ativos" value={String(stats.activeCount)} />
        <KpiCard
          icon={<Layers size={18} className="text-emerald-600" />}
          label="Sessões / itens em saldo"
          value={String(stats.availableUnits)}
        />
        <KpiCard
          icon={<CircleDollarSign size={18} className="text-violet-600" />}
          label="Total vendido em pacotes"
          value={formatBRL(stats.totalRevenueCents)}
        />
        <KpiCard
          icon={<Scissors size={18} className="text-amber-600" />}
          label="Modelos predefinidos"
          value={String(stats.activeTemplates)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab("clientes")}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "clientes" ? "bg-white text-ink shadow-xs" : "text-ink-soft hover:text-ink"
            }`}
          >
            Pacotes de clientes ({clientPackages.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("modelos")}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              tab === "modelos" ? "bg-white text-ink shadow-xs" : "text-ink-soft hover:text-ink"
            }`}
          >
            Pacotes predefinidos ({templates.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "clientes" ? "Buscar cliente, pacote ou item..." : "Buscar modelo ou item..."}
              className="h-9 pl-9 text-sm"
            />
          </div>
          {tab === "clientes" ? (
            <div className="flex items-center gap-1">
              {(["ALL", "ACTIVE", "CONSUMED", "EXPIRED", "CANCELLED"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    statusFilter === st
                      ? "bg-blue-600 text-white"
                      : "border border-line bg-white text-ink-soft hover:bg-slate-50"
                  }`}
                >
                  {st === "ALL" ? "Todos" : PACKAGE_STATUS_LABEL[st]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {tab === "clientes" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          {filteredPackages.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm text-ink-soft">Nenhum pacote encontrado com este filtro.</p>
              {canCreate ? (
                <Button
                  type="button"
                  className="mt-4"
                  onClick={() => {
                    setNewPackageClientId("");
                    setNewPackageOpen(true);
                  }}
                >
                  <Plus size={16} />
                  Vender primeiro pacote
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="border-b border-line bg-slate-50 text-left text-xs font-medium text-ink-soft">
                  <tr>
                    <th className="px-4 py-3">Pacote</th>
                    <th>Cliente</th>
                    <th>Itens e saldos</th>
                    <th>Validade</th>
                    <th className="text-right">Valor</th>
                    <th className="px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPackages.map((pkg) => (
                    <tr
                      key={pkg.id}
                      onClick={() => setSelectedPkgId(pkg.id)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/80"
                    >
                      <td className="px-4 py-3.5 align-top">
                        <div className="font-semibold text-blue-700">#{pkg.number}</div>
                        <div className="font-medium text-ink">{pkg.name}</div>
                        <div className="text-xs text-ink-soft">{formatShortDate(new Date(pkg.purchasedAt))}</div>
                      </td>
                      <td className="py-3.5 align-top">
                        <Link
                          href={`/clientes/${pkg.clientId}?tab=pacotes`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-ink hover:text-blue-600 hover:underline"
                        >
                          {pkg.clientName}
                        </Link>
                        {pkg.sellerName ? (
                          <div className="text-xs text-ink-soft">Vend.: {pkg.sellerName}</div>
                        ) : null}
                      </td>
                      <td className="py-3.5 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {pkg.items.map((item) => (
                            <span
                              key={item.id}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                                item.remainingQty > 0
                                  ? "border-blue-200 bg-blue-50 text-blue-800"
                                  : "border-line bg-slate-50 text-ink-soft line-through"
                              }`}
                            >
                              {item.type === "PRODUCT" ? <ShoppingBag size={11} /> : <Scissors size={11} />}
                              {item.description} ·{" "}
                              <strong>
                                {item.remainingQty}/{item.totalQty}
                              </strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 align-top text-xs text-ink-soft">
                        {pkg.expiresAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={12} />
                            {formatShortDate(new Date(pkg.expiresAt))}
                          </span>
                        ) : (
                          "Sem validade"
                        )}
                      </td>
                      <td className="py-3.5 text-right align-top font-medium">{formatBRL(pkg.totalCents)}</td>
                      <td className="px-4 py-3.5 text-right align-top">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            PACKAGE_STATUS_COLOR[pkg.effectiveStatus]
                          }`}
                        >
                          {PACKAGE_STATUS_LABEL[pkg.effectiveStatus]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-line bg-white px-6 py-14 text-center">
              <p className="text-sm text-ink-soft">Nenhum pacote predefinido cadastrado.</p>
              {canCreate ? (
                <Button type="button" className="mt-4" onClick={() => setEditingTemplate(null)}>
                  <Plus size={16} />
                  Criar pacote predefinido
                </Button>
              ) : null}
            </div>
          ) : (
            filteredTemplates.map((tpl) => (
              <div key={tpl.id} className="flex flex-col justify-between rounded-2xl border border-line bg-white p-5">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-ink">{tpl.name}</h3>
                      {tpl.description ? <p className="mt-0.5 text-xs text-ink-soft">{tpl.description}</p> : null}
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        tpl.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-line bg-slate-100 text-ink-soft"
                      }`}
                    >
                      {tpl.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {tpl.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 text-ink">
                          {item.type === "PRODUCT" ? (
                            <ShoppingBag size={12} className="text-ink-soft" />
                          ) : (
                            <Scissors size={12} className="text-ink-soft" />
                          )}
                          {item.quantity}x {item.description}
                        </span>
                        <span className="text-ink-soft">{formatBRL(item.unitPriceCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  <div className="flex items-center justify-between text-xs text-ink-soft">
                    <span>
                      {tpl.validityDays ? `Validade: ${tpl.validityDays} dias` : "Sem validade padrão"} ·{" "}
                      {tpl.salesCount} {tpl.salesCount === 1 ? "venda" : "vendas"}
                    </span>
                    <span className="text-base font-semibold text-ink">{formatBRL(tpl.priceCents)}</span>
                  </div>

                  {canEdit || canRemove ? (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleToggleTemplate(tpl)}
                            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-slate-50"
                          >
                            {tpl.active ? "Desativar" : "Ativar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTemplate(tpl)}
                            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-slate-50"
                          >
                            <Pencil size={12} />
                            Editar
                          </button>
                        </>
                      ) : null}
                      {canRemove ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteTemplate(tpl)}
                          className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                          aria-label="Excluir modelo"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {newPackageOpen ? (
        <PackageDrawer
          key={`new-${newPackageClientId}`}
          open
          initialClientId={newPackageClientId}
          clients={clients}
          balancesByClient={balancesByClient}
          templates={templates}
          professionals={professionals}
          services={services}
          products={products}
          paymentMethods={paymentMethods}
          hidePhones={hidePhones}
          onClose={() => setNewPackageOpen(false)}
        />
      ) : null}

      {editingTemplate !== undefined ? (
        <TemplateDrawer
          key={editingTemplate?.id ?? "new-tpl"}
          open
          template={editingTemplate}
          services={services}
          products={products}
          onClose={() => setEditingTemplate(undefined)}
        />
      ) : null}

      <PackageDetailDrawer
        pkg={selectedPkg}
        canEdit={canEdit}
        canRemove={canRemove}
        onClose={() => setSelectedPkgId(null)}
      />
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold text-ink">{value}</div>
        <div className="text-xs text-ink-soft">{label}</div>
      </div>
    </div>
  );
}
