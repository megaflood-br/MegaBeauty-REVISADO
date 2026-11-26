"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Plus, Scissors, ShoppingBag, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { createClientPackage } from "@/app/actions/packages";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { calendarDate, shiftCalendarDate } from "@/lib/dates";
import { createClientKey } from "@/lib/utils";
import { ClientPackageSidebar } from "@/components/pacotes/client-sidebar";
import {
  packageItemDiscountCents,
  packageItemLineTotalCents,
  packageTotalCents,
  type ClientPackageBalanceItem,
  type PackageClientSummary,
  type PackageItemDraft,
  type PackageItemType,
  type PackageTemplateDto,
} from "@/lib/packages-shared";
import type { PaymentMethodOption } from "@/components/comandas/types";

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} h`;
}

function emptyDraft(type: PackageItemType = "SERVICE"): PackageItemDraft {
  return {
    key: createClientKey(),
    type,
    catalogId: "",
    description: "",
    quantity: 1,
    unitPriceCents: 0,
    discount: "0,00",
    discountType: "money",
  };
}

export function PackageDrawer({
  open,
  initialClientId = "",
  lockClient = false,
  clients,
  balancesByClient = {},
  templates,
  professionals,
  services,
  products,
  paymentMethods = [],
  hidePhones = false,
  onClose,
}: {
  open: boolean;
  initialClientId?: string;
  lockClient?: boolean;
  clients: PackageClientSummary[];
  balancesByClient?: Record<string, ClientPackageBalanceItem[]>;
  templates: PackageTemplateDto[];
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
  paymentMethods?: PaymentMethodOption[];
  hidePhones?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const today = useMemo(() => calendarDate(), []);

  const [clientId, setClientId] = useState(initialClientId);
  const [purchasedAt, setPurchasedAt] = useState(today);
  const [expiresAt, setExpiresAt] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sellerId, setSellerId] = useState(professionals[0]?.id ?? "");
  const [customName, setCustomName] = useState("");
  const [items, setItems] = useState<PackageItemDraft[]>([emptyDraft("SERVICE")]);
  const [discount, setDiscount] = useState("0,00");
  const [discountType, setDiscountType] = useState<"money" | "percent">("money");
  const [credit, setCredit] = useState("0,00");
  const [cashback, setCashback] = useState("0,00");
  const [paymentMethodId, setPaymentMethodId] = useState(
    () => paymentMethods.find((m) => m.code === "PIX")?.id ?? paymentMethods[0]?.id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = useMemo(
    () => [
      ...services.map((s) => {
        const price = s.promoPriceCents ?? s.priceCents;
        const dur = s.durationMin ? ` · ${formatDuration(s.durationMin)}` : "";
        return {
          value: `SERVICE:${s.id}`,
          label: s.name,
          hint: `${formatBRL(price)}${dur}`,
          priceCents: price,
          type: "SERVICE" as const,
        };
      }),
      ...products.map((p) => {
        const price = p.promoPriceCents ?? p.priceCents;
        return {
          value: `PRODUCT:${p.id}`,
          label: p.name,
          hint: `Produto · ${formatBRL(price)}`,
          priceCents: price,
          type: "PRODUCT" as const,
        };
      }),
    ],
    [services, products],
  );

  const selectedClient = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);
  const clientBalances = useMemo(
    () => (clientId ? balancesByClient[clientId] ?? [] : []),
    [clientId, balancesByClient],
  );

  const computedItems = items.map((item) => ({
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    discountCents: packageItemDiscountCents(item),
  }));
  const itemsSubtotal = computedItems.reduce((sum, row) => sum + packageItemLineTotalCents(row), 0);
  const headerDiscountCents =
    discountType === "percent"
      ? Math.min(itemsSubtotal, Math.round(itemsSubtotal * ((Number(discount.replace(",", ".")) || 0) / 100)))
      : Math.min(itemsSubtotal, Math.max(0, parseBRLToCents(discount)));
  const total = packageTotalCents({
    items: computedItems,
    discountCents: headerDiscountCents,
    creditCents: parseBRLToCents(credit),
    cashbackCents: parseBRLToCents(cashback),
  });

  if (!open) return null;

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    const tpl = templates.find((t) => t.id === nextTemplateId);
    if (!tpl) return;
    setCustomName(tpl.name);
    if (tpl.validityDays && tpl.validityDays > 0) {
      setExpiresAt(shiftCalendarDate(purchasedAt || today, tpl.validityDays));
    }
    if (tpl.items.length > 0) {
      setItems(
        tpl.items.map((item) => ({
          key: createClientKey(),
          type: item.type,
          catalogId: (item.type === "PRODUCT" ? item.productId : item.serviceId) ?? "",
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discount: centsToInput(item.discountCents),
          discountType: "money",
        })),
      );
    }
  }

  function updateItem(key: string, patch: Partial<PackageItemDraft>) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeItem(key: string) {
    setItems((rows) => (rows.length === 1 ? [emptyDraft("SERVICE")] : rows.filter((row) => row.key !== key)));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    if (!clientId) {
      setError("Selecione um cliente.");
      return;
    }
    const validItems = items.filter((item) => item.catalogId);
    if (validItems.length === 0) {
      setError("Adicione ao menos um serviço ou produto ao pacote.");
      return;
    }

    formData.set("clientId", clientId);
    formData.set("packageId", templateId);
    formData.set("sellerId", sellerId);
    formData.set("name", customName);
    formData.set("purchasedAt", purchasedAt);
    formData.set("expiresAt", expiresAt);
    formData.set("discount", discount);
    formData.set("discountType", discountType);
    formData.set("credit", credit);
    formData.set("cashback", cashback);
    formData.set("notes", notes);
    if (paymentMethodId === "__COURTESY__") {
      formData.set("paymentMethodId", "");
      formData.set("paymentMethod", "COURTESY");
    } else {
      const selectedPm = paymentMethods.find((m) => m.id === paymentMethodId);
      formData.set("paymentMethodId", paymentMethodId);
      formData.set("paymentMethod", selectedPm?.code ?? "PIX");
    }

    formData.delete("itemKey");
    formData.delete("itemQty");
    formData.delete("itemPrice");
    formData.delete("itemDiscount");
    formData.delete("itemDiscountType");
    for (const item of validItems) {
      formData.append("itemKey", `${item.type}:${item.catalogId}`);
      formData.append("itemQty", String(Math.max(1, Math.round(item.quantity || 1))));
      formData.append("itemPrice", centsToInput(item.unitPriceCents));
      formData.append("itemDiscount", item.discount);
      formData.append("itemDiscountType", item.discountType);
    }

    setPending(true);
    try {
      const result = await createClientPackage(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o pacote.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[1260px] bg-white shadow-2xl">
        <div className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-slate-50/40 lg:block">
          <ClientPackageSidebar
            client={selectedClient}
            packageBalances={clientBalances}
            hidePhones={hidePhones}
            mode="package"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="text-lg font-semibold">Novo pacote</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>

          <form ref={formRef} action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-3 md:grid-cols-[1.5fr_0.75fr_0.75fr]">
                <Field label="Cliente" required>
                  {lockClient && selectedClient ? (
                    <Input value={selectedClient.name} readOnly className="bg-slate-50" />
                  ) : (
                    <SearchSelect
                      name="clientId"
                      required
                      placeholder="Selecione um cliente"
                      value={clientId}
                      onChange={setClientId}
                      options={clients.map((c) => ({
                        value: c.id,
                        label: c.name,
                        hint: hidePhones ? undefined : c.phone,
                      }))}
                    />
                  )}
                </Field>
                <Field label="Data">
                  <Input type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
                </Field>
                <Field label="Validade">
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    placeholder="Selecionar data"
                  />
                </Field>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Pacote Predefinido">
                  <SearchSelect
                    placeholder="Selecione um pacote predefinido"
                    value={templateId}
                    onChange={applyTemplate}
                    emptyOption={{ value: "", label: "Pacote personalizado" }}
                    options={templates
                      .filter((t) => t.active)
                      .map((t) => ({
                        value: t.id,
                        label: t.name,
                        hint: `${t.sessions} ${t.sessions === 1 ? "item" : "itens"} · ${formatBRL(t.priceCents)}`,
                      }))}
                  />
                </Field>
                <Field label="Vendedor">
                  <SearchSelect
                    placeholder="Selecione um vendedor"
                    value={sellerId}
                    onChange={setSellerId}
                    emptyOption={{ value: "", label: "Sem vendedor" }}
                    options={professionals.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Nome do pacote (opcional)">
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Ex.: Combo Manicure + Pedicure 4 sessões"
                  />
                </Field>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Itens do pacote</h3>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => setItems((rows) => [...rows, emptyDraft("SERVICE")])}
                    >
                      <Plus size={14} />
                      Serviço
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => setItems((rows) => [...rows, emptyDraft("PRODUCT")])}
                    >
                      <Plus size={14} />
                      Produto
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-line">
                  <div className="grid min-w-[760px] grid-cols-[38px_1.6fr_72px_125px_150px_115px_38px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-medium text-ink-soft">
                    <span />
                    <span>Descrição</span>
                    <span>Qtde.</span>
                    <span>Valor unitário</span>
                    <span>Desconto</span>
                    <span>Total</span>
                    <span />
                  </div>
                  {items.map((item) => {
                    const disc = packageItemDiscountCents(item);
                    const lineTotal = packageItemLineTotalCents({
                      quantity: item.quantity,
                      unitPriceCents: item.unitPriceCents,
                      discountCents: disc,
                    });
                    return (
                      <div
                        key={item.key}
                        className="grid min-w-[760px] grid-cols-[38px_1.6fr_72px_125px_150px_115px_38px] items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-slate-50 text-slate-600">
                          {item.type === "PRODUCT" ? <ShoppingBag size={15} /> : <Scissors size={15} />}
                        </span>
                        <SearchSelect
                          placeholder={item.type === "PRODUCT" ? "Selecionar produto" : "Selecionar serviço"}
                          value={item.catalogId ? `${item.type}:${item.catalogId}` : ""}
                          onChange={(value) => {
                            const option = catalog.find((c) => c.value === value);
                            if (!option) {
                              updateItem(item.key, { catalogId: "", description: "", unitPriceCents: 0 });
                              return;
                            }
                            updateItem(item.key, {
                              type: option.type,
                              catalogId: option.value.split(":")[1] ?? "",
                              description: option.label,
                              unitPriceCents: option.priceCents,
                            });
                          }}
                          options={catalog}
                        />
                        <Input
                          className="h-11 px-2 text-center"
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.key, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })
                          }
                        />
                        <div className="relative">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-soft">
                            R$
                          </span>
                          <Input
                            className="pl-8"
                            value={centsToInput(item.unitPriceCents)}
                            onChange={(e) => updateItem(item.key, { unitPriceCents: parseBRLToCents(e.target.value) })}
                          />
                        </div>
                        <div className="grid grid-cols-[62px_1fr] gap-1">
                          <Select
                            value={item.discountType}
                            onChange={(e) =>
                              updateItem(item.key, { discountType: e.target.value === "percent" ? "percent" : "money" })
                            }
                          >
                            <option value="money">R$</option>
                            <option value="percent">%</option>
                          </Select>
                          <Input value={item.discount} onChange={(e) => updateItem(item.key, { discount: e.target.value })} />
                        </div>
                        <div className="relative">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-soft">
                            R$
                          </span>
                          <Input className="bg-slate-50 pl-8" readOnly tabIndex={-1} value={centsToInput(lineTotal)} />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500 text-white hover:bg-rose-600"
                          aria-label="Remover item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 grid gap-6 md:grid-cols-[1fr_290px]">
                  <div className="space-y-3">
                    {total > 0 ? (
                      <Field label="Forma de pagamento">
                        <Select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                          {paymentMethods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {m.accountName}
                            </option>
                          ))}
                          <option value="__COURTESY__">Cortesia / sem lançamento financeiro</option>
                        </Select>
                      </Field>
                    ) : null}
                    <Field label="Observações">
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Condições de uso, validade combinada ou observações..."
                        className="min-h-20"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-2.5 self-start text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-soft">Desconto</span>
                      <div className="grid w-44 grid-cols-[62px_1fr] gap-1">
                        <Select
                          className="h-9"
                          value={discountType}
                          onChange={(e) => setDiscountType(e.target.value === "percent" ? "percent" : "money")}
                        >
                          <option value="money">R$</option>
                          <option value="percent">%</option>
                        </Select>
                        <Input className="h-9" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-ink-soft">
                        Crédito
                        {selectedClient && selectedClient.creditCents > 0 ? (
                          <span className="block text-[11px] text-blue-600">
                            Disp.: {formatBRL(selectedClient.creditCents)}
                          </span>
                        ) : null}
                      </span>
                      <div className="relative w-44">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-soft">
                          R$
                        </span>
                        <Input className="h-9 pl-8" value={credit} onChange={(e) => setCredit(e.target.value)} />
                      </div>
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-ink-soft">
                        Cashback
                        {selectedClient && selectedClient.cashbackCents > 0 ? (
                          <span className="block text-[11px] text-blue-600">
                            Disp.: {formatBRL(selectedClient.cashbackCents)}
                          </span>
                        ) : null}
                      </span>
                      <div className="relative w-44">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-soft">
                          R$
                        </span>
                        <Input className="h-9 pl-8" value={cashback} onChange={(e) => setCashback(e.target.value)} />
                      </div>
                    </label>
                    <div className="flex items-center justify-between border-t border-line pt-2.5 text-base font-semibold">
                      <span>Total</span>
                      <span className="rounded-lg bg-slate-100 px-3 py-1">{formatBRL(total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
              <button
                type="button"
                className="mr-auto rounded-lg p-2 text-ink-soft hover:bg-sand"
                title="Os itens do pacote ficam anexados ao perfil do cliente e são reconhecidos automaticamente ao fechar comandas."
                aria-label="Ajuda"
              >
                <HelpCircle size={18} />
              </button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : "Salvar pacote"}
              </Button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}
