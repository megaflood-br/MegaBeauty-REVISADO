import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { ensureFinanceCatalog } from "@/lib/finance-catalog";
import { availableAt, feeCents, netAmountCents } from "@/lib/ledger-shared";

export {
  accountBalanceDelta,
  availableAt,
  feeCents,
  netAmountCents,
  settlementLabel,
  summarizeAccountBalances,
  transactionNetCents,
  type AccountBalanceInput,
  type AccountBalanceRow,
} from "@/lib/ledger-shared";

export type LedgerEntryInput = {
  tenantId: string;
  type: "INCOME" | "EXPENSE";
  category: string;
  amountCents: number;
  methodId?: string | null;
  methodCode?: string | null;
  accountId?: string | null;
  description?: string | null;
  organizational?: boolean;
  supplier?: string | null;
  professionalId?: string | null;
  recurrence?: string | null;
  appointmentId?: string | null;
  comandaId?: string | null;
  occurredAt?: Date;
  competenceAt?: Date | null;
};

export async function resolvePaymentMethod(tenantId: string, opts: { id?: string | null; code?: string | null }) {
  await ensureFinanceCatalog(tenantId);
  if (opts.id) {
    const byId = await prisma.paymentMethodConfig.findFirst({
      where: { id: opts.id, tenantId, active: true },
      include: { account: true },
    });
    if (byId) return byId;
  }
  const code = (opts.code || "").trim();
  if (code) {
    const byCode = await prisma.paymentMethodConfig.findFirst({
      where: { tenantId, active: true, code },
      include: { account: true },
      orderBy: [{ favorite: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    if (byCode) return byCode;
  }
  return prisma.paymentMethodConfig.findFirst({
    where: { tenantId, active: true },
    include: { account: true },
    orderBy: [{ favorite: "desc" }, { sortOrder: "asc" }],
  });
}

export async function resolveAccount(tenantId: string, accountId?: string | null) {
  await ensureFinanceCatalog(tenantId);
  if (accountId) {
    const found = await prisma.financeAccount.findFirst({
      where: { id: accountId, tenantId, active: true },
    });
    if (found) return found;
  }
  return (
    (await prisma.financeAccount.findFirst({
      where: { tenantId, active: true, isDefault: true },
      orderBy: { sortOrder: "asc" },
    })) ??
    prisma.financeAccount.findFirst({
      where: { tenantId, active: true },
      orderBy: { sortOrder: "asc" },
    })
  );
}

export async function resolveCategory(tenantId: string, slug: string, type: "INCOME" | "EXPENSE") {
  await ensureFinanceCatalog(tenantId);
  return prisma.financeCategory.findFirst({
    where: { tenantId, slug, type, active: true },
  });
}

async function resolveLedgerData(input: LedgerEntryInput) {
  const organizational = Boolean(input.organizational);
  const occurredAt = input.occurredAt ?? new Date();
  const method = organizational
    ? null
    : await resolvePaymentMethod(input.tenantId, { id: input.methodId, code: input.methodCode });
  const account = organizational
    ? null
    : await resolveAccount(input.tenantId, input.accountId || method?.accountId);
  const category = await resolveCategory(input.tenantId, input.category, input.type);
  const feeBps = input.type === "INCOME" ? (method?.feeBps ?? 0) : 0;
  const fee = feeCents(input.amountCents, feeBps);
  const net = netAmountCents(input.amountCents, feeBps);
  const days = method?.settlementDays ?? 0;
  const settled = organizational ? true : (method?.autoSettle ?? true);

  return {
    type: input.type,
    category: category?.slug ?? input.category,
    categoryId: category?.id ?? null,
    amountCents: input.amountCents,
    feeCents: fee,
    netCents: net,
    method: method?.code ?? input.methodCode ?? "PIX",
    paymentMethodId: method?.id ?? null,
    account: account ? slugify(account.name) || "caixa" : organizational ? "nenhuma" : "caixa",
    accountId: account?.id ?? null,
    description: input.description ?? null,
    organizational,
    supplier: input.supplier ?? null,
    professionalId: input.professionalId ?? null,
    recurrence: input.recurrence ?? null,
    appointmentId: input.appointmentId ?? null,
    comandaId: input.comandaId ?? null,
    occurredAt,
    competenceAt: input.competenceAt ?? null,
    availableAt: availableAt(occurredAt, days),
    settled,
  };
}

export async function postLedgerEntry(input: LedgerEntryInput) {
  const data = await resolveLedgerData(input);
  return prisma.transaction.create({
    data: { tenantId: input.tenantId, ...data },
  });
}

export async function updateLedgerEntry(id: string, input: LedgerEntryInput) {
  const existing = await prisma.transaction.findFirst({
    where: { id, tenantId: input.tenantId },
    select: { id: true, appointmentId: true, comandaId: true },
  });
  if (!existing) return null;
  const data = await resolveLedgerData({
    ...input,
    appointmentId: input.appointmentId ?? existing.appointmentId,
    comandaId: input.comandaId ?? existing.comandaId,
  });
  return prisma.transaction.update({ where: { id }, data });
}
