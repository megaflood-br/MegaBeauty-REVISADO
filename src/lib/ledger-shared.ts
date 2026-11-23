import { addDays } from "date-fns";

export function feeCents(amountCents: number, feeBps: number) {
  if (amountCents <= 0 || feeBps <= 0) return 0;
  return Math.round((amountCents * feeBps) / 10_000);
}

export function netAmountCents(amountCents: number, feeBps: number) {
  return Math.max(0, amountCents - feeCents(amountCents, feeBps));
}

export function settlementLabel(days: number) {
  if (days <= 0) return "À vista";
  if (days === 1) return "Disponível em 1 dia";
  return `Disponível em ${days} dias`;
}

export function availableAt(occurredAt: Date, settlementDays: number) {
  return addDays(occurredAt, Math.max(0, settlementDays));
}

export function transactionNetCents(tx: { netCents: number; amountCents: number; feeCents?: number }) {
  if (tx.netCents) return tx.netCents;
  if (tx.feeCents) return Math.max(0, tx.amountCents - tx.feeCents);
  return tx.amountCents;
}

export function accountBalanceDelta(tx: { type: string; netCents: number; settled: boolean }) {
  if (!tx.settled) return 0;
  return tx.type === "EXPENSE" ? -tx.netCents : tx.netCents;
}

export type AccountBalanceInput = {
  accounts: { id: string; name: string; details: string; isDefault: boolean; active: boolean; sortOrder: number }[];
  methods: { accountId: string; name: string; active: boolean }[];
  transactions: {
    accountId: string | null;
    type: string;
    settled: boolean;
    netCents: number;
    amountCents: number;
    feeCents?: number;
    organizational?: boolean;
  }[];
};

export type AccountBalanceRow = {
  accountId: string;
  name: string;
  details: string;
  isDefault: boolean;
  methodNames: string[];
  incomeCents: number;
  expenseCents: number;
  settledCents: number;
  pendingCents: number;
};

export function summarizeAccountBalances(input: AccountBalanceInput): AccountBalanceRow[] {
  const linked = new Set(input.methods.filter((m) => m.active).map((m) => m.accountId));
  const methodsByAccount = new Map<string, string[]>();
  for (const method of input.methods) {
    if (!method.active) continue;
    const list = methodsByAccount.get(method.accountId) ?? [];
    if (!list.includes(method.name)) list.push(method.name);
    methodsByAccount.set(method.accountId, list);
  }

  const totals = new Map<string, { income: number; expense: number; settled: number; pending: number }>();
  for (const tx of input.transactions) {
    if (tx.organizational || !tx.accountId) continue;
    const net = transactionNetCents(tx);
    const current = totals.get(tx.accountId) ?? { income: 0, expense: 0, settled: 0, pending: 0 };
    if (tx.type === "EXPENSE") {
      current.expense += net;
      if (tx.settled) current.settled -= net;
    } else {
      current.income += net;
      if (tx.settled) current.settled += net;
      else current.pending += net;
    }
    totals.set(tx.accountId, current);
  }

  return input.accounts
    .filter((account) => account.active && (linked.has(account.id) || totals.has(account.id)))
    .map((account) => {
      const row = totals.get(account.id) ?? { income: 0, expense: 0, settled: 0, pending: 0 };
      return {
        accountId: account.id,
        name: account.name,
        details: account.details,
        isDefault: account.isDefault,
        methodNames: methodsByAccount.get(account.id) ?? [],
        incomeCents: row.income,
        expenseCents: row.expense,
        settledCents: row.settled,
        pendingCents: row.pending,
      };
    });
}
