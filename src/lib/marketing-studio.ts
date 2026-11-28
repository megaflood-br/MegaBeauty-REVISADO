import { formatBRL } from "@/lib/money";

export const STUDIO_FORMATS = [
  { id: "feed", label: "Feed Quadrado", ratio: "1:1", width: 1080, height: 1080, igTarget: "FEED" as const },
  { id: "portrait", label: "Feed Retrato", ratio: "4:5", width: 1080, height: 1350, igTarget: "FEED" as const },
  { id: "story", label: "Stories / Reels", ratio: "9:16", width: 1080, height: 1920, igTarget: "STORY" as const },
] as const;

export type StudioFormatId = (typeof STUDIO_FORMATS)[number]["id"];

export const STUDIO_STYLES = [
  {
    id: "editorial",
    label: "Luxo Editorial",
    description: "Fundo escuro sofisticado, destaque dourado/marca e tipografia limpa.",
  },
  {
    id: "flash",
    label: "Oferta Flash",
    description: "Alto impacto promocional com destaque forte para preço e prazo.",
  },
  {
    id: "minimal",
    label: "Minimalista",
    description: "Cartão claro flutuante com foco total na foto do procedimento.",
  },
  {
    id: "glow",
    label: "Beleza & Bem-Estar",
    description: "Gradiente luminoso suave na cor do salão com visual acolhedor.",
  },
] as const;

export type StudioStyleId = (typeof STUDIO_STYLES)[number]["id"];

export type StudioCatalogItem = {
  id: string;
  kind: "SERVICE" | "PACKAGE";
  name: string;
  priceCents: number;
  durationMin: number | null;
  description: string | null;
  imageUrl: string | null;
  categoryName: string | null;
};

export type StudioSalonProfile = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  accentColor: string;
  logoUrl: string | null;
  bookingUrl: string;
};

export type StudioPostRecord = {
  id: string;
  serviceId: string | null;
  packageId: string | null;
  title: string;
  headline: string;
  badgeText: string | null;
  priceText: string | null;
  promoPriceText: string | null;
  dateRangeText: string | null;
  ctaText: string | null;
  caption: string;
  format: StudioFormatId;
  style: StudioStyleId;
  imageUrl: string;
  status: string;
  publishTarget: "FEED" | "STORY";
  instagramMediaId: string | null;
  instagramPermalink: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type StudioInstagramStatus = {
  connected: boolean;
  username: string | null;
  pageName: string | null;
  connectedAt: string | null;
  metaConfigured: boolean;
  callbackUrl: string;
};

export function parseStudioFormat(value: unknown): StudioFormatId {
  if (value === "portrait" || value === "story") return value;
  return "feed";
}

export function parseStudioStyle(value: unknown): StudioStyleId {
  if (value === "flash" || value === "minimal" || value === "glow") return value;
  return "editorial";
}

export function getStudioFormatDef(format: StudioFormatId) {
  return STUDIO_FORMATS.find((item) => item.id === format) ?? STUDIO_FORMATS[0];
}

export function parseMoneyInputToCents(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  }
  const clean = String(raw ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!clean) return null;
  const normalized =
    clean.includes(",") && clean.includes(".")
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatStudioPriceSummary(
  originalCents: number | null | undefined,
  promoCents: number | null | undefined,
): { priceText: string; promoPriceText: string; discountPct: number | null } {
  const orig = typeof originalCents === "number" && originalCents > 0 ? originalCents : null;
  const promo = typeof promoCents === "number" && promoCents > 0 ? promoCents : null;

  if (orig && promo && promo < orig) {
    const discountPct = Math.round(((orig - promo) / orig) * 100);
    return {
      priceText: formatBRL(orig),
      promoPriceText: formatBRL(promo),
      discountPct: discountPct >= 3 ? discountPct : null,
    };
  }

  if (promo) {
    return { priceText: "", promoPriceText: formatBRL(promo), discountPct: null };
  }

  if (orig) {
    return { priceText: "", promoPriceText: formatBRL(orig), discountPct: null };
  }

  return { priceText: "", promoPriceText: "", discountPct: null };
}

export function buildFallbackMarketingCopy(input: {
  salonName: string;
  itemName: string;
  itemKind?: "SERVICE" | "PACKAGE";
  description?: string | null;
  originalPriceCents?: number | null;
  promoPriceCents?: number | null;
  dateRange?: string | null;
  bookingUrl?: string | null;
  phone?: string | null;
  city?: string | null;
  tone?: string | null;
}): {
  headline: string;
  badgeText: string;
  ctaText: string;
  caption: string;
} {
  const salonName = input.salonName.trim() || "Nosso Salão";
  const itemName = input.itemName.trim() || "Atendimento Especial";
  const pricing = formatStudioPriceSummary(input.originalPriceCents, input.promoPriceCents);
  const dateRange = String(input.dateRange ?? "").trim();
  const isPackage = input.itemKind === "PACKAGE";

  const badgeText = pricing.discountPct
    ? `${pricing.discountPct}% OFF · CONDIÇÃO ESPECIAL`
    : pricing.promoPriceText && pricing.priceText
      ? "OFERTA POR TEMPO LIMITADO"
      : dateRange
        ? `AGENDA ABERTA · ${dateRange.toUpperCase()}`
        : isPackage
          ? "PACOTE EXCLUSIVO"
          : "DESTAQUE DA SEMANA";

  const headline = isPackage
    ? `${itemName} para transformar sua rotina`
    : pricing.discountPct || pricing.priceText
      ? `${itemName} com valor especial`
      : `Realce sua beleza com ${itemName}`;

  const ctaText = input.phone
    ? `Agende pelo WhatsApp ${input.phone}`
    : "Garanta seu horário pelo link na bio";

  const captionLines: string[] = [];
  captionLines.push(
    pricing.discountPct
      ? `✨ ${itemName} com ${pricing.discountPct}% OFF no ${salonName}!`
      : `✨ Chegou a hora de cuidar de você com ${itemName} no ${salonName}.`,
  );

  if (input.description?.trim()) {
    captionLines.push("");
    captionLines.push(input.description.trim().slice(0, 220));
  }

  captionLines.push("");
  if (pricing.priceText && pricing.promoPriceText) {
    captionLines.push(`💎 De ${pricing.priceText} por apenas ${pricing.promoPriceText}`);
  } else if (pricing.promoPriceText) {
    captionLines.push(`💎 Valor: ${pricing.promoPriceText}`);
  }
  if (dateRange) {
    captionLines.push(`📅 Válido: ${dateRange}`);
  }
  captionLines.push("📲 Vagas limitadas — clique no link ou chame no WhatsApp para reservar o melhor horário!");

  if (input.bookingUrl?.trim()) {
    captionLines.push(`🔗 Agendamento online: ${input.bookingUrl.trim()}`);
  }
  if (input.phone?.trim()) {
    captionLines.push(`💬 WhatsApp: ${input.phone.trim()}`);
  }

  const cityTag = input.city
    ? `#${input.city
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase()}`
    : "";

  const hashtags = [
    "#beleza",
    "#autocuidado",
    "#salaodebeleza",
    "#estetica",
    "#agendamento",
    cityTag,
  ]
    .filter(Boolean)
    .join(" ");

  captionLines.push("");
  captionLines.push(hashtags);

  return {
    headline: headline.slice(0, 80),
    badgeText: badgeText.slice(0, 42),
    ctaText: ctaText.slice(0, 56),
    caption: captionLines.join("\n"),
  };
}
