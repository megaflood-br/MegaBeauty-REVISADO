import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { addComandaItem, closeComanda, removeComandaItemForm } from "@/app/actions/comandas";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { emitComandaInvoice } from "@/app/actions/fiscal";
import { displayPhoneBR, formAction } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { comandaSubtotal, comandaTotal, itemLineTotal } from "@/lib/comandas";
import { COMANDA_STATUS_COLOR, COMANDA_STATUS_LABEL, type ComandaStatus } from "@/lib/constants";
import { loadFinanceCatalog } from "@/lib/finance-catalog";
import { calendarDate } from "@/lib/dates";
import { decorateCatalogItem } from "@/lib/promotions";
import { loadPromoRules } from "@/lib/promo-load";
import { financeMethodLabel } from "@/lib/finance";
import { canAccess, canReopenComandas, shouldHidePhones } from "@/lib/permissions";
import { loadClientActivePackageBalances } from "@/lib/packages";
import { ReopenComandaButton } from "@/components/comandas/reopen-comanda-button";
import { Package, Trash2 } from "lucide-react";

export default async function ComandaPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, access } = await requireTenant();
  const { id } = await params;
  const [comanda, services, products, professionals, catalog, promos] = await Promise.all([
    prisma.comanda.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        client: true,
        professional: true,
        appointment: true,
        items: {
          include: {
            professional: true,
            clientPackageItem: { include: { clientPackage: { select: { number: true, name: true } } } },
          },
        },
      },
    }),
    prisma.service.findMany({ where: { tenantId: session.tenantId, active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { tenantId: session.tenantId, active: true }, orderBy: { name: "asc" } }),
    prisma.professional.findMany({ where: { tenantId: session.tenantId, active: true }, orderBy: { name: "asc" } }),
    loadFinanceCatalog(session.tenantId),
    loadPromoRules(session.tenantId),
  ]);
  if (!comanda) notFound();
  const balancesMap = await loadClientActivePackageBalances(session.tenantId, comanda.clientId);
  const clientBalances = balancesMap[comanda.clientId] ?? [];
  const onDate = calendarDate(comanda.occurredAt);
  const pricedServices = services.map((service) => decorateCatalogItem(promos, onDate, "SERVICE", service));
  const pricedProducts = products.map((product) =>
    decorateCatalogItem(promos, onDate, "PRODUCT", { id: product.id, name: product.name, priceCents: product.saleCents }),
  );

  const open = comanda.status === "OPEN";
  const canEdit = canAccess(access, "comandas", "edit");
  const canReopen = comanda.status === "CLOSED" && canReopenComandas(access);
  const subtotal = comandaSubtotal(comanda.items);
  const total = comandaTotal({
    items: comanda.items,
    discountCents: comanda.discountCents,
    creditCents: comanda.creditCents,
    cashbackCents: comanda.cashbackCents,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">
            <Link href="/comandas" className="text-wine">
              Comandas
            </Link>
          </p>
          <h1 className="font-display text-3xl">Comanda #{comanda.number}</h1>
          <p className="text-ink-soft">
            {comanda.client.name} · {displayPhoneBR(comanda.client.phone, shouldHidePhones(access))}
            {comanda.professional ? ` · ${comanda.professional.name}` : ""}
          </p>
          {open && !canEdit ? (
            <p className="mt-1 text-sm text-ink-soft">Consulta apenas. Incluir itens e fechar a comanda ficam com quem tem permissão.</p>
          ) : null}
        </div>
        <Badge color={COMANDA_STATUS_COLOR[comanda.status as ComandaStatus]}>
          {COMANDA_STATUS_LABEL[comanda.status as ComandaStatus]}
        </Badge>
      </div>

      {open && clientBalances.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Package size={16} className="shrink-0 text-blue-600" />
          <span className="font-medium">Pacotes disponíveis deste cliente:</span>
          {clientBalances.map((b) => (
            <span key={b.id} className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-blue-700">
              {b.description} (#{b.packageNumber}) · Saldo: {b.remainingQty}
            </span>
          ))}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-sand text-left">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th>Tipo</th>
              <th>Profissional</th>
              <th>Qtd</th>
              <th>Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {comanda.items.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{item.description}</span>
                    {item.clientPackageItem ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        <Package size={12} />
                        Pacote #{item.clientPackageItem.clientPackage.number}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>{item.type === "SERVICE" ? "Serviço" : "Produto"}</td>
                <td>{item.professional?.name ?? "—"}</td>
                <td>{item.quantity}</td>
                <td>{formatBRL(itemLineTotal(item))}</td>
                <td>
                  {open && canEdit ? (
                    <ConfirmDeleteButton
                      title="Remover este item da comanda?"
                      confirmLabel="Remover"
                      ariaLabel="Remover"
                      className="p-2 text-red-600"
                      onConfirm={async () => {
                        const form = new FormData();
                        form.set("itemId", item.id);
                        await removeComandaItemForm(form);
                      }}
                    >
                      <Trash2 size={16} />
                    </ConfirmDeleteButton>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {open && canEdit ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-display text-xl">Adicionar serviço</h2>
            <form action={formAction(addComandaItem)} className="mt-3 grid gap-3">
              <input type="hidden" name="comandaId" value={comanda.id} />
              <input type="hidden" name="type" value="SERVICE" />
              <Field label="Serviço">
                <SearchSelect
                  name="serviceId"
                  required
                  placeholder="Buscar serviço..."
                  options={pricedServices.map((s) => ({
                    value: s.id,
                    label: s.name,
                    hint: s.promoPriceCents != null ? `${formatBRL(s.promoPriceCents)} na ${s.promoName}` : formatBRL(s.priceCents),
                  }))}
                />
              </Field>
              <Field label="Profissional">
                <SearchSelect
                  name="professionalId"
                  placeholder="Buscar profissional..."
                  defaultValue={comanda.professionalId ?? ""}
                  options={professionals.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Field>
              <Button>Incluir serviço</Button>
            </form>
          </Card>
          <Card>
            <h2 className="font-display text-xl">Adicionar produto</h2>
            <form action={formAction(addComandaItem)} className="mt-3 grid gap-3">
              <input type="hidden" name="comandaId" value={comanda.id} />
              <input type="hidden" name="type" value="PRODUCT" />
              <Field label="Produto">
                <SearchSelect
                  name="productId"
                  required
                  placeholder="Buscar produto..."
                  options={pricedProducts.map((p) => ({
                    value: p.id,
                    label: p.name,
                    hint: p.promoPriceCents != null ? `${formatBRL(p.promoPriceCents)} na ${p.promoName}` : formatBRL(p.priceCents),
                  }))}
                />
              </Field>
              <Field label="Quantidade">
                <Input name="quantity" type="number" min={1} defaultValue={1} />
              </Field>
              <Button>Incluir produto</Button>
            </form>
          </Card>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="text-sm">
            <div>Subtotal {formatBRL(subtotal)}</div>
            {comanda.discountCents ? <div>Desconto {formatBRL(comanda.discountCents)}</div> : null}
            {comanda.creditCents ? <div>Crédito {formatBRL(comanda.creditCents)}</div> : null}
            {comanda.cashbackCents ? <div>Cashback {formatBRL(comanda.cashbackCents)}</div> : null}
            <div className="font-display text-3xl">{formatBRL(total)}</div>
          </div>
          {open && canEdit ? (
            <form action={formAction(closeComanda)} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="comandaId" value={comanda.id} />
              {total > 0 ? (
                <>
                  <Field label="Desconto">
                    <Input name="discount" defaultValue={(comanda.discountCents / 100).toFixed(2).replace(".", ",")} />
                  </Field>
                  <Field label="Pagamento">
                    <Select
                      name="paymentMethodId"
                      defaultValue={
                        catalog.methods.find((m) => m.code === "PIX" && m.active)?.id ??
                        catalog.methods.find((m) => m.active)?.id ??
                        ""
                      }
                    >
                      {catalog.methods
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {m.accountName}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </>
              ) : (
                <input type="hidden" name="method" value="PACKAGE" />
              )}
              <Button variant="success">{total === 0 ? "Fechar e dar baixa no pacote" : "Fechar comanda"}</Button>
            </form>
          ) : null}
          {!open ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-soft">
                Paga via {financeMethodLabel(comanda.paymentMethod ?? "", catalog.methods.find((m) => m.code === comanda.paymentMethod)?.name)}
              </p>
              {canReopen ? (
                <ReopenComandaButton comandaId={comanda.id} comandaNumber={comanda.number} />
              ) : null}
              {canEdit ? (
                <form action={formAction(emitComandaInvoice)}>
                  <input type="hidden" name="comandaId" value={comanda.id} />
                  <Button type="submit" variant="outline">
                    Emitir nota
                  </Button>
                </form>
              ) : null}
              <Link href="/notas" className="text-sm font-medium text-wine">
                Ver notas
              </Link>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
