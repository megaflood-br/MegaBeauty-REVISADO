"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Calendar, CheckCircle2, History, Package, Scissors, ShoppingBag, UserRound, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { cancelClientPackage, consumeClientPackageItemManual } from "@/app/actions/packages";
import { formatBRL } from "@/lib/money";
import { formatMediumDate, formatShortDate } from "@/lib/dates";
import { PAYMENT_LABEL, type PaymentMethod } from "@/lib/constants";
import {
  PACKAGE_STATUS_COLOR,
  PACKAGE_STATUS_LABEL,
  type ClientPackageDto,
} from "@/lib/packages-shared";

export function PackageDetailDrawer({
  pkg,
  canEdit = true,
  canRemove = true,
  onClose,
}: {
  pkg: ClientPackageDto | null;
  canEdit?: boolean;
  canRemove?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [redeemingItemId, setRedeemingItemId] = useState<string | null>(null);
  const [redeemQty, setRedeemQty] = useState("1");
  const [redeemNotes, setRedeemNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pkg) return null;

  const isActive = pkg.effectiveStatus === "ACTIVE";

  async function handleManualRedeem(itemId: string) {
    setError(null);
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("clientPackageItemId", itemId);
      formData.set("quantity", redeemQty || "1");
      formData.set("notes", redeemNotes.trim() || "Baixa manual");
      const result = await consumeClientPackageItemManual(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setRedeemingItemId(null);
      setRedeemQty("1");
      setRedeemNotes("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleCancel() {
    if (!pkg) return;
    const ok = await confirm({
      title: `Cancelar o pacote #${pkg.number}?`,
      description: "O saldo restante será zerado e o pacote não será mais reconhecido nas próximas comandas.",
      confirmLabel: "Cancelar pacote",
    });
    if (!ok) return;
    setError(null);
    setPending(true);
    try {
      const result = await cancelClientPackage(pkg.id);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">
                Pacote #{pkg.number} · {pkg.name}
              </h2>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  PACKAGE_STATUS_COLOR[pkg.effectiveStatus]
                }`}
              >
                {PACKAGE_STATUS_LABEL[pkg.effectiveStatus]}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
              <Link href={`/clientes/${pkg.clientId}?tab=pacotes`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                <UserRound size={12} />
                {pkg.clientName}
              </Link>
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} />
                Compra: {formatShortDate(new Date(pkg.purchasedAt))}
              </span>
              {pkg.expiresAt ? (
                <span>Validade: {formatShortDate(new Date(pkg.expiresAt))}</span>
              ) : (
                <span>Sem validade</span>
              )}
              {pkg.sellerName ? <span>Vendedor: {pkg.sellerName}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-line bg-slate-50/70 p-3">
              <div className="text-xs text-ink-soft">Saldo disponível</div>
              <div className="mt-0.5 text-xl font-semibold text-ink">
                {pkg.remaining} <span className="text-sm font-normal text-ink-soft">/ {pkg.totalSessions}</span>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-slate-50/70 p-3">
              <div className="text-xs text-ink-soft">Valor pago</div>
              <div className="mt-0.5 text-xl font-semibold text-ink">{formatBRL(pkg.totalCents)}</div>
            </div>
            <div className="rounded-xl border border-line bg-slate-50/70 p-3">
              <div className="text-xs text-ink-soft">Pagamento</div>
              <div className="mt-0.5 text-sm font-semibold text-ink">
                {pkg.paymentMethod === "COURTESY"
                  ? "Cortesia"
                  : PAYMENT_LABEL[pkg.paymentMethod as PaymentMethod] ?? pkg.paymentMethod ?? "—"}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Package size={15} className="text-blue-600" />
              Itens do pacote e saldos
            </h3>
            <div className="space-y-2.5">
              {pkg.items.map((item) => {
                const used = Math.max(0, item.totalQty - item.remainingQty);
                const pct = item.totalQty > 0 ? Math.round((used / item.totalQty) * 100) : 100;
                const isRedeeming = redeemingItemId === item.id;
                return (
                  <div key={item.id} className="rounded-xl border border-line p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                          {item.type === "PRODUCT" ? <ShoppingBag size={14} /> : <Scissors size={14} />}
                        </span>
                        <div>
                          <div className="font-medium text-ink">{item.description}</div>
                          <div className="text-xs text-ink-soft">
                            {item.type === "PRODUCT" ? "Produto" : "Serviço"} · Unitário {formatBRL(item.unitPriceCents)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-sm font-semibold text-blue-700">Saldo: {item.remainingQty}</div>
                          <div className="text-[11px] text-ink-soft">
                            {used} de {item.totalQty} usados
                          </div>
                        </div>
                        {isActive && canEdit && item.remainingQty > 0 ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => {
                              setRedeemingItemId(isRedeeming ? null : item.id);
                              setRedeemQty("1");
                              setRedeemNotes("");
                            }}
                          >
                            <CheckCircle2 size={13} />
                            Dar baixa
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                    </div>

                    {isRedeeming ? (
                      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
                        <label className="grid gap-1 text-xs">
                          <span className="text-ink-soft">Qtde.</span>
                          <Input
                            type="number"
                            min={1}
                            max={item.remainingQty}
                            value={redeemQty}
                            onChange={(e) => setRedeemQty(e.target.value)}
                            className="h-9 w-20 bg-white text-center"
                          />
                        </label>
                        <label className="grid min-w-44 flex-1 gap-1 text-xs">
                          <span className="text-ink-soft">Observação</span>
                          <Input
                            value={redeemNotes}
                            onChange={(e) => setRedeemNotes(e.target.value)}
                            placeholder="Ex.: Uso avulso no balcão"
                            className="h-9 bg-white"
                          />
                        </label>
                        <Button
                          type="button"
                          className="h-9 px-3 text-xs"
                          disabled={pending}
                          onClick={() => void handleManualRedeem(item.id)}
                        >
                          Confirmar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {pkg.notes ? (
            <div className="rounded-xl border border-line bg-slate-50/70 p-3.5 text-sm">
              <div className="text-xs font-semibold text-ink-soft uppercase">Observações</div>
              <p className="mt-1 whitespace-pre-line text-ink">{pkg.notes}</p>
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <History size={15} className="text-ink-soft" />
              Histórico de baixas ({pkg.usages.length})
            </h3>
            {pkg.usages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-soft">
                Nenhuma utilização registrada ainda. Quando o cliente fechar uma comanda com este serviço ou produto, a baixa aparecerá aqui automaticamente.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-ink-soft">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">Data</th>
                      <th className="font-medium">Item</th>
                      <th className="font-medium">Qtd</th>
                      <th className="px-3.5 font-medium">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.usages.map((u) => (
                      <tr key={u.id} className="border-t border-line">
                        <td className="px-3.5 py-2.5 text-xs text-ink-soft">{formatMediumDate(new Date(u.usedAt))}</td>
                        <td className="font-medium">{u.itemDescription}</td>
                        <td>-{u.quantity}</td>
                        <td className="px-3.5 text-xs">
                          {u.comandaId && u.comandaNumber ? (
                            <Link href={`/comandas/${u.comandaId}`} className="font-medium text-blue-600 hover:underline">
                              Comanda #{u.comandaNumber}
                            </Link>
                          ) : (
                            <span className="text-ink-soft">{u.notes ?? "Baixa manual"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          {isActive && canRemove ? (
            <Button type="button" variant="outline" className="text-rose-600 hover:bg-rose-50" disabled={pending} onClick={() => void handleCancel()}>
              <Ban size={15} />
              Cancelar pacote
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </aside>
    </div>
  );
}
