export type MarketingMediaKind = "IMAGE" | "VIDEO" | "PDF";

export type LogoPositionPreset =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom";

export type LogoBackdropStyle = "none" | "light" | "dark";
export type LogoVariantPreference = "auto" | "light" | "dark";

export const MAX_MARKETING_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_MARKETING_VIDEO_BYTES = 20 * 1024 * 1024;

export const DEFAULT_MARKETING_FOLDERS = [
  "Feed",
  "Stories",
  "Anúncios",
  "Vídeos",
  "Apresentações / PDF",
  "WhatsApp",
] as const;

export const LOGO_POSITION_OPTIONS: { value: LogoPositionPreset; label: string }[] = [
  { value: "top-left", label: "Topo esquerdo" },
  { value: "top-center", label: "Topo central" },
  { value: "top-right", label: "Topo direito" },
  { value: "bottom-left", label: "Rodapé esquerdo" },
  { value: "bottom-center", label: "Rodapé central" },
  { value: "bottom-right", label: "Rodapé direito" },
  { value: "custom", label: "Posição livre (clique na arte)" },
];

export const LOGO_BACKDROP_OPTIONS: { value: LogoBackdropStyle; label: string }[] = [
  { value: "none", label: "Sem fundo (logo vazado)" },
  { value: "light", label: "Placa clara translúcida" },
  { value: "dark", label: "Placa escura translúcida" },
];

export const LOGO_VARIANT_OPTIONS: { value: LogoVariantPreference; label: string }[] = [
  { value: "auto", label: "Automático" },
  { value: "light", label: "Logo padrão (fundo claro)" },
  { value: "dark", label: "Logo branco/claro (fundo escuro)" },
];

export type MarketingAssetDto = {
  id: string;
  title: string;
  description: string | null;
  folder: string;
  formatLabel: string | null;
  caption: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaKind: MarketingMediaKind;
  applyLogo: boolean;
  logoPosition: LogoPositionPreset;
  logoX: number;
  logoY: number;
  logoScale: number;
  logoOpacity: number;
  logoPadding: number;
  logoBackdrop: LogoBackdropStyle;
  logoVariant: LogoVariantPreference;
  downloadsCount: number;
  active: boolean;
  createdAt: string;
};

export type DetectedMarketingMedia = {
  mimeType: string;
  ext: ".jpg" | ".png" | ".webp" | ".pdf" | ".mp4" | ".webm";
  mediaKind: MarketingMediaKind;
};

export function detectAllowedMarketingMedia(bytes: Uint8Array): DetectedMarketingMedia | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", ext: ".jpg", mediaKind: "IMAGE" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: ".png", mediaKind: "IMAGE" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", ext: ".webp", mediaKind: "IMAGE" };
  }
  // PDF: %PDF-
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { mimeType: "application/pdf", ext: ".pdf", mediaKind: "PDF" };
  }
  // MP4 / ISO BMFF: ....ftyp
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { mimeType: "video/mp4", ext: ".mp4", mediaKind: "VIDEO" };
  }
  // WebM / EBML: 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mimeType: "video/webm", ext: ".webm", mediaKind: "VIDEO" };
  }

  return null;
}

export function normalizeLogoPosition(raw: unknown): LogoPositionPreset {
  const val = String(raw ?? "").trim();
  const allowed: LogoPositionPreset[] = [
    "top-left",
    "top-center",
    "top-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
    "custom",
  ];
  return (allowed.includes(val as LogoPositionPreset) ? val : "bottom-right") as LogoPositionPreset;
}

export function normalizeLogoBackdrop(raw: unknown): LogoBackdropStyle {
  const val = String(raw ?? "").trim();
  if (val === "light" || val === "dark") return val;
  return "none";
}

export function normalizeLogoVariant(raw: unknown): LogoVariantPreference {
  const val = String(raw ?? "").trim();
  if (val === "light" || val === "dark") return val;
  return "auto";
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

export type LogoPlacementConfig = {
  logoPosition: LogoPositionPreset;
  logoX: number; // 0..100 (center % when custom)
  logoY: number; // 0..100 (center % when custom)
  logoScale: number; // 8..50 (% of artwork width)
  logoPadding: number; // 0..12 (% of artwork min dimension)
  logoBackdrop: LogoBackdropStyle;
};

export type LogoPlacementRect = {
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoHeight: number;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  boxRadius: number;
};

export function computeLogoPlacementRect(args: {
  artworkWidth: number;
  artworkHeight: number;
  logoNaturalWidth: number;
  logoNaturalHeight: number;
  config: LogoPlacementConfig;
}): LogoPlacementRect {
  const artW = Math.max(1, args.artworkWidth);
  const artH = Math.max(1, args.artworkHeight);
  const ratio =
    args.logoNaturalWidth > 0 && args.logoNaturalHeight > 0
      ? args.logoNaturalWidth / args.logoNaturalHeight
      : 2.6;

  const scalePct = clampNumber(args.config.logoScale, 8, 50, 22);
  const paddingPct = clampNumber(args.config.logoPadding, 0, 12, 4);
  const margin = Math.round((Math.min(artW, artH) * paddingPct) / 100);

  let logoWidth = Math.round((artW * scalePct) / 100);
  let logoHeight = Math.round(logoWidth / ratio);

  // Never let tall/square logos exceed 35% of artwork height
  const maxLogoHeight = Math.round(artH * 0.35);
  if (logoHeight > maxLogoHeight) {
    logoHeight = maxLogoHeight;
    logoWidth = Math.round(logoHeight * ratio);
  }

  const hasBackdrop = args.config.logoBackdrop !== "none";
  const innerPadX = hasBackdrop ? Math.max(8, Math.round(logoWidth * 0.12)) : 0;
  const innerPadY = hasBackdrop ? Math.max(6, Math.round(logoHeight * 0.16)) : 0;

  const boxWidth = Math.min(artW, logoWidth + innerPadX * 2);
  const boxHeight = Math.min(artH, logoHeight + innerPadY * 2);
  const boxRadius = hasBackdrop ? Math.round(Math.min(boxWidth, boxHeight) * 0.22) : 0;

  let boxX = margin;
  let boxY = margin;

  switch (args.config.logoPosition) {
    case "top-left":
      boxX = margin;
      boxY = margin;
      break;
    case "top-center":
      boxX = Math.round((artW - boxWidth) / 2);
      boxY = margin;
      break;
    case "top-right":
      boxX = artW - boxWidth - margin;
      boxY = margin;
      break;
    case "bottom-left":
      boxX = margin;
      boxY = artH - boxHeight - margin;
      break;
    case "bottom-center":
      boxX = Math.round((artW - boxWidth) / 2);
      boxY = artH - boxHeight - margin;
      break;
    case "bottom-right":
      boxX = artW - boxWidth - margin;
      boxY = artH - boxHeight - margin;
      break;
    case "custom": {
      const cx = (clampNumber(args.config.logoX, 0, 100, 88) / 100) * artW;
      const cy = (clampNumber(args.config.logoY, 0, 100, 88) / 100) * artH;
      boxX = Math.round(cx - boxWidth / 2);
      boxY = Math.round(cy - boxHeight / 2);
      break;
    }
  }

  // Clamp strictly inside artwork boundaries
  boxX = Math.max(0, Math.min(artW - boxWidth, boxX));
  boxY = Math.max(0, Math.min(artH - boxHeight, boxY));

  return {
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    boxRadius,
    logoX: boxX + innerPadX,
    logoY: boxY + innerPadY,
    logoWidth,
    logoHeight,
  };
}

export function choosePartnerLogoUrl(
  variant: LogoVariantPreference,
  backdrop: LogoBackdropStyle,
  logos: { logoUrl?: string | null; logoDarkUrl?: string | null },
): string | null {
  const light = (logos.logoUrl ?? "").trim() || null;
  const dark = (logos.logoDarkUrl ?? "").trim() || null;

  if (variant === "dark") return dark || light;
  if (variant === "light") return light || dark;
  // Auto: on dark backdrop prefer dark-bg logo; on light backdrop prefer standard logo
  if (backdrop === "dark") return dark || light;
  return light || dark;
}

export function renderMarketingCaption(
  template: string | null | undefined,
  vars: { brandName: string; partnerUrl: string },
): string {
  if (!template) return "";
  return template
    .replace(/\{\{\s*marca\s*\}\}/gi, vars.brandName)
    .replace(/\{\{\s*link\s*\}\}/gi, vars.partnerUrl);
}

export function sanitizeDownloadFilename(title: string, ext: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safeExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `${base || "material-marketing"}${safeExt}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function marketingAssetFileUrl(id: string, download = false): string {
  return download ? `/api/materiais/${encodeURIComponent(id)}/arquivo?download=1` : `/api/materiais/${encodeURIComponent(id)}/arquivo`;
}
