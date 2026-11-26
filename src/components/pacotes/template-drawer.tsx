"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Scissors, ShoppingBag, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { upsertPackageTemplate } from "@/app/actions/packages";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { createClientKey } from "@/lib/utils";
import {
  packageItemDiscountCents,
  packageItemLineTotalCents,
  type PackageItemDraft,
  type PackageItemType,
  type PackageTemplateDto,
} from "@/lib/packages-shared";

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
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

export function TemplateDrawer({
  open,
  template,
  services,
  products,
  onClose,
}: {
  open: boolean;
  template: PackageTemplateDto | null;
  services: { id: string; name: string; priceCents: number; promoPriceCents?: number | null }[];
  products: { id: string; name: string; priceCents: number; promoPriceCents?: number | null }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [validityDays, setValidityDays] = useState(template?.validityDays ? String(template.validityDays) : "");
  const [active, setActive] = useState(template ? template.active : true);
  const [items, setItems] = useState<PackageItemDraft[]>(() =>
    template && template.items.length > 0
      ? template.items.map((item) => ({
          key: item.id,
          type: item.type,
          catalogId: (item.type === "PRODUCT" ? item.productId : item.serviceId) ?? "",
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discount: centsToInput(item.discountCents),
          discountType: "money",
        }))
      : [emptyDraft("SERVICE")],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = useMemo(
    () => [
      ...services.map((s) => ({
        value: `SERVICE:${s.id}`,
        label: s.name,
        hint: formatBRL(s.promoPriceCents ?? s.priceCents),
        priceCents: s.promoPriceCents ?? s.priceCents,
        type: "SERVICE" as const,
      })),
      ...products.map((p) => ({
        value: `PRODUCT:${p.id}`,
        label: p.name,
        hint: `Produto · ${formatBRL(p.promoPriceCents ?? p.priceCents)}`,
        priceCents: p.promoPriceCents ?? p.priceCents,
        type: "PRODUCT" as const,
      })),
    ],
    [services, products],
  );

  const totalSessions = items.reduce((sum, item) => sum + (item.catalogId ? Math.max(1, Math.round(item.quantity || 1)) : 0), 0);
  const totalPrice = items.reduce((sum, item) => {
    if (!item.catalogId) return sum;
    return (
      sum +
      packageItemLineTotalCents({
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: packageItemDiscountCents(item),
      })
    );
  }, 0);

  if (!open) return null;

  function updateItem(key: string, patch: Partial<PackageItemDraft>) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeItem(key: string) {
    setItems((rows) => (rows.length === 1 ? [emptyDraft("SERVICE")] : rows.filter((row) => row.key !== key)));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    const validItems = items.filter((item) => item.catalogId);
    if (!name.trim()) {
      setError("Informe o nome do pacote.");
      return;
    }
    if (validItems.length === 0) {
      setError("Adicione ao menos um serviço ou produto.");
      return;
    }

    if (template) formData.set("id", template.id);
    formData.set("name", name.trim());
    formData.set("description", description.trim());
    formData.set("validityDays", validityDays.trim());
    formData.set("active", active ? "true" : "false");
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
      const result = await upsertPackageTemplate(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o modelo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold">
            {template ? `Editar modelo: ${template.name}` : "Novo pacote predefinido"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 md:grid-cols-[1.5fr_0.7fr]">
              <Field label="Nome do pacote" required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Combo Mão e Pé Mensal (4x)"
                  required
                />
              </Field>
              <Field label="Validade padrão (dias)">
                <Input
                  type="number"
                  min={1}
                  value={validityDays}
                  onChange={(e) => setValidityDays(e.target.value)}
                  placeholder="Ex.: 90 (opcional)"
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Descrição">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Regras ou detalhes deste modelo de pacote..."
                  className="min-h-16"
                />
              </Field>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Itens incluídos</h3>
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
                <div className="grid min-w-[700px] grid-cols-[36px_1.5fr_70px_120px_145px_110px_36px] gap-2 border-b border-line bg-slate-50 px-3 py-2 text-xs font-medium text-ink-soft">
                  <span />
                  <span>Descrição</span>
                  <span>Qtde.</span>
                  <span>Valor unit.</span>
                  <span>Desconto</span>
                  <span>Total</span>
                  <span />
                </div>
                {items.map((item) => {
                  const lineTotal = packageItemLineTotalCents({
                    quantity: item.quantity,
                    unitPriceCents: item.unitPriceCents,
                    discountCents: packageItemDiscountCents(item),
                  });
                  return (
                    <div
                      key={item.key}
                      className="grid min-w-[700px] grid-cols-[36px_1.5fr_70px_120px_145px_110px_36px] items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                        {item.type === "PRODUCT" ? <ShoppingBag size={14} /> : <Scissors size={14} />}
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
                        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-soft">
                          R$
                        </span>
                        <Input
                          className="pl-7"
                          value={centsToInput(item.unitPriceCents)}
                          onChange={(e) => updateItem(item.key, { unitPriceCents: parseBRLToCents(e.target.value) })}
                        />
                      </div>
                      <div className="grid grid-cols-[60px_1fr] gap-1">
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
                        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-ink-soft">
                          R$
                        </span>
                        <Input className="bg-slate-50 pl-7" readOnly tabIndex={-1} value={centsToInput(lineTotal)} />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50"
                        aria-label="Remover item"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-blue-600"
                />
                Modelo ativo para venda
              </label>
              <div className="flex items-center gap-5">
                <span className="text-ink-soft">
                  Total de sessões/itens: <strong className="text-ink">{totalSessions}</strong>
                </span>
                <span className="text-base font-semibold text-ink">{formatBRL(totalPrice)}</span>
              </div>
            </div>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar modelo"}
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}
