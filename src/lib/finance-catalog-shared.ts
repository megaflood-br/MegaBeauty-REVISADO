export type CatalogAccount = {
  id: string;
  name: string;
  details: string;
  adminOnly: boolean;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
};

export type CatalogMethod = {
  id: string;
  name: string;
  code: string;
  group: "CASH" | "CARD" | "OTHER" | string;
  feeBps: number;
  accountId: string;
  accountName: string;
  settlementDays: number;
  autoSettle: boolean;
  favorite: boolean;
  active: boolean;
  sortOrder: number;
};

export type CatalogCategory = {
  id: string;
  name: string;
  type: string;
  slug: string;
  active: boolean;
  sortOrder: number;
};

export function accountDetailsLabel(account: { details: string; adminOnly: boolean; name: string }) {
  if (account.adminOnly) return account.details || "Somente para administrador";
  return account.details || account.name;
}

export function feePercentLabel(feeBps: number) {
  return `${(feeBps / 100).toFixed(2).replace(".", ",")}%`;
}
