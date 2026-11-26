export function itemLineTotal(item: { quantity: number; priceCents: number; discountCents?: number }) {
  const gross = Math.round(item.quantity * item.priceCents);
  return Math.max(0, gross - Math.max(0, item.discountCents ?? 0));
}

export function comandaSubtotal(items: { quantity: number; priceCents: number; discountCents?: number }[]) {
  return items.reduce((sum, item) => sum + itemLineTotal(item), 0);
}

export function comandaTotal(params: {
  items: { quantity: number; priceCents: number; discountCents?: number }[];
  discountCents?: number;
  creditCents?: number;
  cashbackCents?: number;
}) {
  const subtotal = comandaSubtotal(params.items);
  const discount = Math.max(0, params.discountCents ?? 0);
  const credit = Math.max(0, params.creditCents ?? 0);
  const cashback = Math.max(0, params.cashbackCents ?? 0);
  return Math.max(0, subtotal - discount - credit - cashback);
}

export function paymentChange(totalCents: number, paidCents: number) {
  return Math.max(0, paidCents - totalCents);
}

export function allocatePayments<T extends { amountCents: number }>(totalCents: number, payments: T[]) {
  let remaining = Math.max(0, totalCents);
  return payments.map((payment) => {
    const appliedCents = Math.min(Math.max(0, payment.amountCents), remaining);
    remaining -= appliedCents;
    return { ...payment, appliedCents };
  });
}

export function reopenComandaGuards(input: {
  status: string;
  commissions: { status: string }[];
  invoices: { status: string }[];
}): { ok: true } | { ok: false; error: string } {
  if (input.status !== "CLOSED") {
    return { ok: false, error: "Somente comandas fechadas podem ser reabertas." };
  }
  if (input.commissions.some((c) => c.status === "PAID")) {
    return { ok: false, error: "Não é possível reabrir: há comissão já paga para esta comanda." };
  }
  if (input.invoices.some((i) => i.status === "AUTHORIZED" || i.status === "PROCESSING")) {
    return { ok: false, error: "Cancele a nota fiscal emitida antes de reabrir esta comanda." };
  }
  return { ok: true };
}

export function computeReopenedBalances(input: {
  clientCreditCents: number;
  clientCashbackCents: number;
  comandaCreditCents: number;
  cashbackMovements: { amountCents: number }[];
}) {
  const netCashbackDelta = input.cashbackMovements.reduce((sum, m) => sum + m.amountCents, 0);
  return {
    creditCents: Math.max(0, input.clientCreditCents) + Math.max(0, input.comandaCreditCents),
    cashbackCents: Math.max(0, input.clientCashbackCents - netCashbackDelta),
  };
}

export function aggregateStockReversal(moves: { productId: string; type: string; quantity: number }[]) {
  const deltas = new Map<string, number>();
  for (const move of moves) {
    const current = deltas.get(move.productId) ?? 0;
    if (move.type === "OUT") {
      deltas.set(move.productId, current + move.quantity);
    } else if (move.type === "IN") {
      deltas.set(move.productId, current - move.quantity);
    }
  }
  return deltas;
}
