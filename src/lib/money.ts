export function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function parseBRLToCents(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  let normalized: string;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+\.\d{1,2}$/.test(cleaned)) {
    normalized = cleaned;
  } else {
    normalized = cleaned.replace(/\./g, "");
  }
  const amount = Number.parseFloat(normalized);
  if (Number.isNaN(amount)) return 0;
  return Math.round(amount * 100);
}
