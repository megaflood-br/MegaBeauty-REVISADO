import { parseBRLToCents } from "@/lib/money";

export type PackageItemType = "SERVICE" | "PRODUCT";

export type PackageItemDraft = {
  key: string;
  type: PackageItemType;
  catalogId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discount: string;
  discountType: "money" | "percent";
};

export type PackageTemplateItemDto = {
  id: string;
  type: PackageItemType;
  serviceId: string | null;
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
};

export type PackageTemplateDto = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  sessions: number;
  validityDays: number | null;
  active: boolean;
  items: PackageTemplateItemDto[];
  salesCount: number;
};

export type ClientPackageItemDto = {
  id: string;
  clientPackageId: string;
  type: PackageItemType;
  serviceId: string | null;
  productId: string | null;
  description: string;
  totalQty: number;
  remainingQty: number;
  unitPriceCents: number;
  discountCents: number;
};

export type ClientPackageUsageDto = {
  id: string;
  clientPackageItemId: string;
  itemDescription: string;
  comandaId: string | null;
  comandaNumber: number | null;
  quantity: number;
  usedAt: string;
  notes: string | null;
};

export type ClientPackageStatus = "ACTIVE" | "CONSUMED" | "EXPIRED" | "CANCELLED";

export type ClientPackageDto = {
  id: string;
  number: number;
  name: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  packageId: string | null;
  templateName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  remaining: number;
  totalSessions: number;
  status: string;
  effectiveStatus: ClientPackageStatus;
  discountCents: number;
  creditCents: number;
  cashbackCents: number;
  totalCents: number;
  paymentMethod: string | null;
  notes: string | null;
  purchasedAt: string;
  expiresAt: string | null;
  items: ClientPackageItemDto[];
  usages: ClientPackageUsageDto[];
};

export type ClientPackageBalanceItem = {
  id: string;
  clientPackageId: string;
  packageNumber: number;
  packageName: string;
  type: PackageItemType;
  catalogId: string;
  description: string;
  totalQty: number;
  remainingQty: number;
  unitPriceCents: number;
  purchasedAt: string;
  expiresAt: string | null;
};

export type PackageClientSummary = {
  id: string;
  name: string;
  phone: string;
  imageUrl?: string | null;
  birthDate: string | null;
  creditCents: number;
  cashbackCents: number;
  openComandasCount: number;
  notes: string | null;
};

export const PACKAGE_STATUS_LABEL: Record<ClientPackageStatus, string> = {
  ACTIVE: "Ativo",
  CONSUMED: "Consumido",
  EXPIRED: "Vencido",
  CANCELLED: "Cancelado",
};

export const PACKAGE_STATUS_COLOR: Record<ClientPackageStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CONSUMED: "bg-blue-50 text-blue-700 border-blue-200",
  EXPIRED: "bg-amber-50 text-amber-800 border-amber-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
};

export function packageItemDiscountCents(item: {
  quantity: number;
  unitPriceCents: number;
  discount: string;
  discountType: "money" | "percent";
}) {
  const qty = Math.max(0, Math.round(item.quantity));
  const gross = qty * Math.max(0, item.unitPriceCents);
  if (item.discountType === "percent") {
    const pct = Math.max(0, Math.min(100, Number(item.discount.replace(",", ".")) || 0));
    return Math.min(gross, Math.round(gross * (pct / 100)));
  }
  return Math.min(gross, Math.max(0, parseBRLToCents(item.discount)));
}

export function packageItemLineTotalCents(item: {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}) {
  const gross = Math.max(0, Math.round(item.quantity)) * Math.max(0, item.unitPriceCents);
  return Math.max(0, gross - Math.max(0, item.discountCents));
}

export function packageTotalCents(input: {
  items: { quantity: number; unitPriceCents: number; discountCents: number }[];
  discountCents?: number;
  creditCents?: number;
  cashbackCents?: number;
}) {
  const subtotal = input.items.reduce((sum, item) => sum + packageItemLineTotalCents(item), 0);
  const deductions =
    Math.max(0, input.discountCents ?? 0) +
    Math.max(0, input.creditCents ?? 0) +
    Math.max(0, input.cashbackCents ?? 0);
  return Math.max(0, subtotal - deductions);
}

export function isClientPackageExpired(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const date = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

export function effectiveClientPackageStatus(
  pkg: {
    status: string;
    remaining: number;
    expiresAt: Date | string | null | undefined;
  },
  now = new Date(),
): ClientPackageStatus {
  if (pkg.status === "CANCELLED") return "CANCELLED";
  if (pkg.remaining <= 0 || pkg.status === "CONSUMED") return "CONSUMED";
  if (isClientPackageExpired(pkg.expiresAt, now)) return "EXPIRED";
  return "ACTIVE";
}

export function matchAvailablePackageItem(
  balances: ClientPackageBalanceItem[],
  type: PackageItemType,
  catalogId: string,
  neededQty: number,
  allocatedByItemId: Record<string, number> = {},
  now = new Date(),
): ClientPackageBalanceItem | null {
  if (!catalogId) return null;
  const unitsNeeded = Math.max(1, Math.ceil(neededQty || 1));
  const candidates = balances.filter((item) => {
    if (item.type !== type || item.catalogId !== catalogId) return false;
    if (isClientPackageExpired(item.expiresAt, now)) return false;
    const usedHere = allocatedByItemId[item.id] ?? 0;
    return item.remainingQty - usedHere >= unitsNeeded;
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.expiresAt && b.expiresAt) {
      const diff = new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      if (diff !== 0) return diff;
    } else if (a.expiresAt) {
      return -1;
    } else if (b.expiresAt) {
      return 1;
    }
    return new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime();
  });

  return candidates[0];
}

export function formatBirthdayLabel(birthDate: string | null | undefined): string {
  if (!birthDate) return "Aniversário não definido";
  const parts = birthDate.split("-");
  if (parts.length !== 3) return "Aniversário não definido";
  const day = Number(parts[2]);
  const monthIdx = Number(parts[1]) - 1;
  const months = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  if (!day || monthIdx < 0 || monthIdx > 11) return "Aniversário não definido";
  return `Aniversário em ${day}, ${months[monthIdx]}`;
}
