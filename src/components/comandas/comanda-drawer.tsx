"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, LayoutGrid, MoreVertical, Package, Plus, Scissors, ShoppingBag, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { invoiceComanda, upsertComanda } from "@/app/actions/comandas";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { comandaSubtotal, comandaTotal, itemLineTotal } from "@/lib/comandas";
import { calendarDate } from "@/lib/dates";
import { createClientKey } from "@/lib/utils";
import { PaymentDrawer } from "@/components/comandas/payment-drawer";
import { useConfirm } from "@/components/confirm-dialog";
import { ClientPackageSidebar } from "@/components/pacotes/client-sidebar";
import {
  matchAvailablePackageItem,
  type ClientPackageBalanceItem,
  type PackageClientSummary,
} from "@/lib/packages-shared";
import type { ComandaFormValue, ComandaItemDraft, PaymentDraft, PaymentMethodOption } from "@/components/comandas/types";

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function itemDiscountCents(item: ComandaItemDraft) {
  const gross = Math.round(item.quantity * item.priceCents);
  if (item.discountType === "percent") {
    return Math.round(gross * ((Number(item.discount.replace(",", ".")) || 0) / 100));
  }
  return parseBRLToCents(item.discount);
}

function emptyItem(professionalId = ""): ComandaItemDraft {
  return {
    key: createClientKey(),
    type: "SERVICE",
    catalogId: "",
    professionalId,
    quantity: 1,
    priceCents: 0,
    discount: "0,00",
    discountType: "money",
    clientPackageItemId: null,
    packageLabel: null,
  };
}

function isNextRedirect(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function computeAllocations(rows: ComandaItemDraft[], excludeKey?: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (excludeKey && row.key === excludeKey) continue;
    if (row.clientPackageItemId) {
      map[row.clientPackageItemId] = (map[row.clientPackageItemId] ?? 0) + Math.max(1, Math.ceil(row.quantity || 1));
    }
  }
  return map;
}

export function ComandaDrawer({
  open,
  comanda,
  nextNumber,
  clients,
  clientPackagesByClient = {},
  professionals,
  services,
  products,
  paymentMethods = [],
  hidePhones = false,
  onClose,
}: {
  open: boolean;
  comanda: ComandaFormValue | null;
  nextNumber: number;
  clients: PackageClientSummary[];
  clientPackagesByClient?: Record<string, ClientPackageBalanceItem[]>;
  professionals: { id: string; name: string }[];
  services: { id: string; name: string; priceCents: number; promoPriceCents?: number | null; promoName?: string | null }[];
  products: { id: string; name: string; priceCents: number; promoPriceCents?: number | null; promoName?: string | null }[];
  paymentMethods?: PaymentMethodOption[];
  hidePhones?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const defaultPro = comanda?.professionalId ?? professionals[0]?.id ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [clientId, setClientId] = useState(comanda?.clientId ?? "");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [items, setItems] = useState<ComandaItemDraft[]>(
    comanda?.items.length ? comanda.items : [emptyItem(defaultPro)],
  );
  const [discount, setDiscount] = useState(comanda ? centsToInput(comanda.discountCents) : "0,00");
  const [credit, setCredit] = useState(comanda ? centsToInput(comanda.creditCents) : "0,00");
  const [cashback, setCashback] = useState(comanda ? centsToInput(comanda.cashbackCents) : "0,00");

  const catalog = useMemo(
    () => [
      ...services.map((s) => ({
        value: `SERVICE:${s.id}`,
        label: s.name,
        hint: s.promoPriceCents != null ? `${formatBRL(s.promoPriceCents)} na ${s.promoName}` : formatBRL(s.priceCents),
        priceCents: s.promoPriceCents ?? s.priceCents,
        type: "SERVICE" as const,
      })),
      ...products.map((p) => ({
        value: `PRODUCT:${p.id}`,
        label: p.name,
        hint:
          p.promoPriceCents != null
            ? `Produto · ${formatBRL(p.promoPriceCents)} na ${p.promoName}`
            : `Produto · ${formatBRL(p.priceCents)}`,
        priceCents: p.promoPriceCents ?? p.priceCents,
        type: "PRODUCT" as const,
      })),
    ],
    [services, products],
  );

  const selectedClient = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);
  const clientBalances = useMemo(
    () => (clientId ? clientPackagesByClient[clientId] ?? [] : []),
    [clientId, clientPackagesByClient],
  );
  const allocatedByItemId = useMemo(() => computeAllocations(items), [items]);
  const balanceById = useMemo(() => new Map(clientBalances.map((b) => [b.id, b])), [clientBalances]);

  const lineItems = items.map((item) => ({
    quantity: item.quantity,
    priceCents: item.priceCents,
    discountCents: itemDiscountCents(item),
  }));
  const subtotal = comandaSubtotal(lineItems);
  const itemDiscounts = lineItems.reduce((sum, item) => sum + item.discountCents, 0);
  const headerDiscount = parseBRLToCents(discount) + parseBRLToCents(credit) + parseBRLToCents(cashback);
  const total = comandaTotal({
    items: lineItems,
    discountCents: parseBRLToCents(discount),
    creditCents: parseBRLToCents(credit),
    cashbackCents: parseBRLToCents(cashback),
  });
  const packageItemsCount = items.filter((item) => Boolean(item.clientPackageItemId)).length;

  if (!open) return null;

  function catalogPriceFor(type: "SERVICE" | "PRODUCT", catalogId: string) {
    const found = catalog.find((c) => c.value === `${type}:${catalogId}`);
    return found?.priceCents ?? 0;
  }

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    const nextBalances = nextClientId ? clientPackagesByClient[nextClientId] ?? [] : [];
    const nextAllocated: Record<string, number> = {};
    setItems((rows) =>
      rows.map((row) => {
        if (!row.catalogId) {
          return { ...row, clientPackageItemId: null, packageLabel: null };
        }
        const matched = matchAvailablePackageItem(nextBalances, row.type, row.catalogId, row.quantity, nextAllocated);
        if (matched) {
          nextAllocated[matched.id] = (nextAllocated[matched.id] ?? 0) + Math.max(1, Math.ceil(row.quantity || 1));
          return {
            ...row,
            clientPackageItemId: matched.id,
            packageLabel: `#${matched.packageNumber}`,
            priceCents: 0,
            discount: "0,00",
          };
        }
        return {
          ...row,
          clientPackageItemId: null,
          packageLabel: null,
          priceCents: row.clientPackageItemId ? catalogPriceFor(row.type, row.catalogId) : row.priceCents,
        };
      }),
    );
  }

  function handleSelectCatalogItem(rowKey: string, value: string) {
    const option = catalog.find((c) => c.value === value);
    if (!option) {
      updateItem(rowKey, { catalogId: "", priceCents: 0, clientPackageItemId: null, packageLabel: null });
      return;
    }
    const entityId = option.value.split(":")[1] ?? "";
    setItems((rows) => {
      const targetRow = rows.find((r) => r.key === rowKey);
      const qty = targetRow?.quantity ?? 1;
      const alloc = computeAllocations(rows, rowKey);
      const matched = matchAvailablePackageItem(clientBalances, option.type, entityId, qty, alloc);
      return rows.map((row) => {
        if (row.key !== rowKey) return row;
        if (matched) {
          return {
            ...row,
            type: option.type,
            catalogId: entityId,
            priceCents: 0,
            discount: "0,00",
            clientPackageItemId: matched.id,
            packageLabel: `#${matched.packageNumber}`,
          };
        }
        return {
          ...row,
          type: option.type,
          catalogId: entityId,
          priceCents: option.priceCents,
          clientPackageItemId: null,
          packageLabel: null,
        };
      });
    });
  }

  function togglePackageOnRow(rowKey: string) {
    setItems((rows) => {
      const target = rows.find((r) => r.key === rowKey);
      if (!target || !target.catalogId) return rows;
      if (target.clientPackageItemId) {
        return rows.map((row) =>
          row.key === rowKey
            ? {
                ...row,
                clientPackageItemId: null,
                packageLabel: null,
                priceCents: catalogPriceFor(row.type, row.catalogId),
              }
            : row,
        );
      }
      const alloc = computeAllocations(rows, rowKey);
      const matched = matchAvailablePackageItem(clientBalances, target.type, target.catalogId, target.quantity, alloc);
      if (!matched) return rows;
      return rows.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              clientPackageItemId: matched.id,
              packageLabel: `#${matched.packageNumber}`,
              priceCents: 0,
              discount: "0,00",
            }
          : row,
      );
    });
  }

  function handleAddFromSidebarPackage(pkgItem: ClientPackageBalanceItem) {
    setItems((rows) => {
      const newRow: ComandaItemDraft = {
        key: createClientKey(),
        type: pkgItem.type,
        catalogId: pkgItem.catalogId,
        professionalId: defaultPro,
        quantity: 1,
        priceCents: 0,
        discount: "0,00",
        discountType: "money",
        clientPackageItemId: pkgItem.id,
        packageLabel: `#${pkgItem.packageNumber}`,
      };
      if (rows.length === 1 && !rows[0].catalogId) {
        return [newRow];
      }
      return [...rows, newRow];
    });
  }

  function handleQuantityChange(rowKey: string, nextQty: number) {
    setItems((rows) => {
      const alloc = computeAllocations(rows, rowKey);
      return rows.map((row) => {
        if (row.key !== rowKey) return row;
        if (row.clientPackageItemId) {
          const pkg = balanceById.get(row.clientPackageItemId);
          const units = Math.max(1, Math.ceil(nextQty || 1));
          const usedOthers = alloc[row.clientPackageItemId] ?? 0;
          if (!pkg || pkg.remainingQty - usedOthers < units) {
            return {
              ...row,
              quantity: nextQty,
              clientPackageItemId: null,
              packageLabel: null,
              priceCents: catalogPriceFor(row.type, row.catalogId),
            };
          }
        }
        return { ...row, quantity: nextQty };
      });
    });
  }

  function fillItems(formData: FormData) {
    formData.set("professionalId", items.find((i) => i.professionalId)?.professionalId ?? defaultPro);
    formData.delete("itemKey");
    formData.delete("itemQty");
    formData.delete("itemPrice");
    formData.delete("itemDiscount");
    formData.delete("itemDiscountType");
    formData.delete("itemProfessionalId");
    formData.delete("itemPackageItemId");
    for (const item of items) {
      if (!item.catalogId) continue;
      formData.append("itemKey", `${item.type}:${item.catalogId}`);
      formData.append("itemQty", String(item.quantity));
      formData.append("itemPrice", centsToInput(item.priceCents));
      formData.append("itemDiscount", item.discount);
      formData.append("itemDiscountType", item.discountType);
      formData.append("itemProfessionalId", item.professionalId);
      formData.append("itemPackageItemId", item.clientPackageItemId ?? "");
    }
  }

  async function handleAction(formData: FormData) {
    setError(null);
    setPending(true);
    fillItems(formData);
    try {
      const result = await upsertComanda(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setPending(false);
    }
  }

  function openPayments() {
    if (!clientId) {
      setError("Selecione um cliente.");
      return;
    }
    if (!items.some((item) => item.catalogId)) {
      setError("Inclua itens antes de faturar.");
      return;
    }
    setError(null);
    setPayOpen(true);
  }

  async function confirmInvoice(payments: PaymentDraft[]) {
    const form = formRef.current;
    if (!form) return;
    setError(null);
    setPending(true);
    const formData = new FormData(form);
    fillItems(formData);
    for (const payment of payments) {
      formData.append("payMethod", payment.method);
      formData.append("payMethodId", payment.paymentMethodId ?? "");
      formData.append("payAmount", centsToInput(payment.amountCents));
      formData.append("payInstallments", String(payment.installments));
      formData.append("payDate", payment.date);
    }
    try {
      const result = await invoiceComanda(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setPayOpen(false);
      onClose();
      router.refresh();
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      setError(err instanceof Error ? err.message : "Não foi possível faturar.");
    } finally {
      setPending(false);
    }
  }

  function updateItem(key: string, patch: Partial<ComandaItemDraft>) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function removeItem(key: string) {
    if (!(await confirm({ title: "Remover este item da comanda?", confirmLabel: "Remover" }))) return;
    setMenuKey(null);
    setItems((rows) => (rows.length === 1 ? [emptyItem(defaultPro)] : rows.filter((row) => row.key !== key)));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[1320px] bg-white shadow-2xl">
        <div className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-slate-50/40 lg:block">
          <ClientPackageSidebar
            client={selectedClient}
            packageBalances={clientBalances}
            allocatedByItemId={allocatedByItemId}
            hidePhones={hidePhones}
            mode="comanda"
            onAddPackageItemToComanda={handleAddFromSidebarPackage}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">
                {comanda ? `Visualizando comanda #${comanda.number}` : "Nova comanda"}
              </h2>
              {packageItemsCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  <Package size={12} />
                  {packageItemsCount === 1 ? "1 item de pacote" : `${packageItemsCount} itens de pacote`}
                </span>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
          <form ref={formRef} action={handleAction} className="flex min-h-0 flex-1 flex-col">
            {comanda ? <input type="hidden" name="id" value={comanda.id} /> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_0.7fr]">
                <Field label="Cliente" required>
                  <SearchSelect
                    name="clientId"
                    required
                    placeholder="Busque por um cliente"
                    value={clientId}
                    onChange={handleClientChange}
                    options={clients.map((c) => ({ value: c.id, label: c.name, hint: hidePhones ? undefined : c.phone }))}
                  />
                </Field>
                <Field label="Data">
                  <Input name="occurredAt" type="date" defaultValue={comanda?.occurredAt ?? calendarDate()} />
                </Field>
                <Field label="Número da comanda">
                  <Input name="number" defaultValue={String(comanda?.number ?? nextNumber)} />
                </Field>
              </div>

              {selectedClient && clientBalances.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs text-blue-900 lg:hidden">
                  <Package size={14} className="shrink-0 text-blue-600" />
                  <span className="font-medium">Pacotes disponíveis:</span>
                  {clientBalances.map((b) => {
                    const live = Math.max(0, b.remainingQty - (allocatedByItemId[b.id] ?? 0));
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={live <= 0}
                        onClick={() => handleAddFromSidebarPackage(b)}
                        className="rounded-md bg-white px-2 py-0.5 font-medium text-blue-700 shadow-xs hover:bg-blue-100 disabled:opacity-50"
                      >
                        {b.description} (#{b.packageNumber}) · Saldo {live}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Itens da comanda</h3>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => setItems((rows) => [...rows, emptyItem(defaultPro)])}
                  >
                    <Plus size={14} />
                    Item
                  </Button>
                </div>
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                  <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-line">
                    <div className="grid min-w-[960px] grid-cols-[36px_1.5fr_1fr_70px_120px_145px_110px_36px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-medium text-ink-soft">
                      <span />
                      <span>Descrição</span>
                      <span>Profissional</span>
                      <span>Qtde.</span>
                      <span>Valor unitário</span>
                      <span>Desconto</span>
                      <span>Total</span>
                      <span />
                    </div>
                    {items.map((item) => {
                      const line = itemLineTotal({
                        quantity: item.quantity,
                        priceCents: item.priceCents,
                        discountCents: itemDiscountCents(item),
                      });
                      const isPackageLinked = Boolean(item.clientPackageItemId);
                      const linkedPkg = item.clientPackageItemId ? balanceById.get(item.clientPackageItemId) : null;
                      const otherAlloc = computeAllocations(items, item.key);
                      const canApplyPkg =
                        !isPackageLinked &&
                        Boolean(item.catalogId) &&
                        Boolean(matchAvailablePackageItem(clientBalances, item.type, item.catalogId, item.quantity, otherAlloc));

                      return (
                        <div
                          key={item.key}
                          className="grid min-w-[960px] grid-cols-[36px_1.5fr_1fr_70px_120px_145px_110px_36px] items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                        >
                          <span
                            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                              isPackageLinked ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-500"
                            }`}
                          >
                            {isPackageLinked ? (
                              <LayoutGrid size={14} />
                            ) : item.type === "PRODUCT" ? (
                              <ShoppingBag size={14} />
                            ) : (
                              <Scissors size={14} />
                            )}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <div className="min-w-0 flex-1">
                              <SearchSelect
                                placeholder="Selecionar serviço ou produto"
                                value={item.catalogId ? `${item.type}:${item.catalogId}` : ""}
                                onChange={(value) => handleSelectCatalogItem(item.key, value)}
                                options={catalog}
                              />
                            </div>
                            {isPackageLinked ? (
                              <button
                                type="button"
                                onClick={() => togglePackageOnRow(item.key)}
                                title={`Baixa automática do pacote ${
                                  linkedPkg ? `#${linkedPkg.packageNumber}` : item.packageLabel ?? ""
                                } (R$ 0,00). Clique para cobrar valor avulso.`}
                                className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs hover:bg-blue-700"
                                aria-label="Usando pacote — clique para alternar"
                              >
                                <Package size={16} />
                              </button>
                            ) : canApplyPkg ? (
                              <button
                                type="button"
                                onClick={() => togglePackageOnRow(item.key)}
                                title="Cliente possui saldo em pacote para este item. Clique para usar o pacote (R$ 0,00)."
                                className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100"
                                aria-label="Aplicar saldo de pacote"
                              >
                                <Package size={16} />
                              </button>
                            ) : null}
                          </div>
                          <SearchSelect
                            placeholder="Profissional"
                            value={item.professionalId}
                            onChange={(professionalId) => updateItem(item.key, { professionalId })}
                            emptyOption={{ value: "", label: "Sem profissional" }}
                            options={professionals.map((p) => ({ value: p.id, label: p.name }))}
                          />
                          <Input
                            className="h-11 px-2 text-center"
                            type="number"
                            min={isPackageLinked ? 1 : 0.1}
                            step={isPackageLinked ? "1" : "0.1"}
                            value={item.quantity}
                            onChange={(e) => handleQuantityChange(item.key, Number(e.target.value) || 0)}
                          />
                          <div className="relative">
                            <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-soft">
                              R$
                            </span>
                            <Input
                              className={`pl-8 ${isPackageLinked ? "bg-slate-50 text-ink-soft" : ""}`}
                              readOnly={isPackageLinked}
                              value={centsToInput(item.priceCents)}
                              onChange={(e) => updateItem(item.key, { priceCents: parseBRLToCents(e.target.value) })}
                            />
                          </div>
                          <div className="grid grid-cols-[1fr_64px] gap-1">
                            <Input
                              disabled={isPackageLinked}
                              value={item.discount}
                              onChange={(e) => updateItem(item.key, { discount: e.target.value })}
                            />
                            <Select
                              disabled={isPackageLinked}
                              value={item.discountType}
                              onChange={(e) =>
                                updateItem(item.key, { discountType: e.target.value === "percent" ? "percent" : "money" })
                              }
                            >
                              <option value="money">R$</option>
                              <option value="percent">%</option>
                            </Select>
                          </div>
                          <div className="relative">
                            <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-soft">
                              R$
                            </span>
                            <Input className="bg-slate-50 pl-8" readOnly tabIndex={-1} value={centsToInput(line)} />
                          </div>
                          <div className="relative">
                            <button
                              type="button"
                              className="rounded-lg p-2 text-ink-soft hover:bg-sand"
                              aria-label="Ações do item"
                              onClick={() => setMenuKey((current) => (current === item.key ? null : item.key))}
                            >
                              <MoreVertical size={16} />
                            </button>
                            {menuKey === item.key ? (
                              <div className="absolute top-9 right-0 z-10 min-w-32 rounded-lg border border-line bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-sand"
                                  onClick={() => void removeItem(item.key)}
                                >
                                  Remover
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ml-auto grid w-full max-w-xs gap-2 text-sm xl:ml-0">
                    <SummaryRow label="Desconto" name="discount" value={discount} onChange={setDiscount} />
                    <SummaryRow label="Crédito" name="credit" value={credit} onChange={setCredit} />
                    <SummaryRow label="Cashback" name="cashback" value={cashback} onChange={setCashback} />
                    <div className="flex items-center justify-between border-t border-line pt-2 font-semibold">
                      <span>Total</span>
                      <span>{formatBRL(total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <Field label="Observações">
                  <Textarea name="notes" placeholder="Escreva aqui" defaultValue={comanda?.notes ?? ""} className="min-h-24" />
                </Field>
              </div>
              {error && !payOpen ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4">
              <button
                type="button"
                className="mr-auto rounded-lg p-2 text-ink-soft hover:bg-sand"
                title="Itens com ícone azul de pacote são reconhecidos automaticamente e têm baixa no saldo ao faturar."
                aria-label="Ajuda"
              >
                <HelpCircle size={18} />
              </button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && !payOpen ? "Salvando..." : "Salvar"}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={openPayments}>
                Faturar
              </Button>
            </div>
          </form>
        </div>
      </aside>
      <PaymentDrawer
        open={payOpen}
        subtotalCents={subtotal}
        totalCents={total}
        discountCents={headerDiscount + itemDiscounts}
        packageItemsCount={packageItemsCount}
        pending={pending}
        error={payOpen ? error : null}
        methods={paymentMethods}
        onClose={() => setPayOpen(false)}
        onInvoice={confirmInvoice}
      />
    </div>
  );
}

function SummaryRow({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <div className="relative w-32">
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-soft">R$</span>
        <Input className="h-9 pl-8" name={name} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}
