import { parseBRLToCents } from "@/lib/money";
import { parseSafePublicHttpsUrl } from "@/lib/web-image-search";

export const MAX_SUPPLIER_IMPORT_ROWS = 2000;
export const MAX_SUPPLIER_IMPORT_COLS = 60;
export const MAX_SPREADSHEET_FILE_BYTES = 6 * 1024 * 1024;
export const MAX_XML_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_XML_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_XML_FILES = 20;

export type SupplierImportField =
  | "name"
  | "brand"
  | "sku"
  | "category"
  | "unit"
  | "price"
  | "minQty"
  | "stock"
  | "description"
  | "active"
  | "imageUrl";

export type SupplierColumnMapping = Record<number, SupplierImportField | "ignore">;
export type SupplierImportMode = "upsert" | "create_only" | "update_only";
export type SupplierStockMode = "replace" | "add" | "unlimited";

export type SupplierImportDraft = {
  row: number;
  sourceFile?: string;
  name: string;
  brand: string | null;
  sku: string | null;
  category: string | null;
  unit: "un" | "ml" | "g";
  priceCents: number;
  minQty: number;
  stock: number | null;
  description: string | null;
  active: boolean;
  imageUrl: string | null;
};

export type SupplierImportIssue = {
  row: number;
  sourceFile?: string;
  message: string;
};

export type NfeXmlParseResult = {
  issuerName: string | null;
  invoiceNumber: string | null;
  drafts: SupplierImportDraft[];
  errors: SupplierImportIssue[];
};

export const SUPPLIER_IMPORT_FIELDS: {
  key: SupplierImportField;
  label: string;
  required?: boolean;
}[] = [
  { key: "name", label: "Nome do produto", required: true },
  { key: "price", label: "Preço de venda", required: true },
  { key: "sku", label: "SKU / Código / EAN" },
  { key: "brand", label: "Marca / Fabricante" },
  { key: "category", label: "Categoria / Grupo" },
  { key: "unit", label: "Unidade (un, ml, g)" },
  { key: "stock", label: "Estoque / Saldo" },
  { key: "minQty", label: "Qtd. mínima" },
  { key: "description", label: "Descrição" },
  { key: "active", label: "Status (Ativo)" },
  { key: "imageUrl", label: "URL da foto (HTTPS)" },
];

export const SUPPLIER_TEMPLATE_HEADERS = [
  "Nome",
  "Marca",
  "SKU",
  "Categoria",
  "Unidade",
  "Preço",
  "Qtd Mínima",
  "Estoque",
  "Descrição",
  "Ativo",
] as const;

export function buildSupplierTemplateCsv(): string {
  const rows = [
    [...SUPPLIER_TEMPLATE_HEADERS],
    [
      "Esmalte Branco Puríssimo 8ml",
      "Risqué",
      "RSQ-BR-001",
      "Unhas",
      "un",
      "6,90",
      "6",
      "120",
      "Esmalte cremoso alta cobertura",
      "Sim",
    ],
    [
      "Máscara Hidratação Intensa 500g",
      "Salon Pro",
      "SLN-HID-500",
      "Tratamento Capilar",
      "un",
      "48,50",
      "1",
      "35",
      "Uso profissional para salões",
      "Sim",
    ],
  ];
  const escapeCell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `\uFEFF${rows.map((row) => row.map(escapeCell).join(";")).join("\r\n")}\r\n`;
}

function normalizeTextKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADER_SYNONYMS: Record<SupplierImportField, string[]> = {
  name: [
    "nome",
    "produto",
    "nome do produto",
    "descricao",
    "descricao do produto",
    "titulo",
    "item",
    "mercadoria",
    "xprod",
  ],
  brand: ["marca", "fabricante", "laboratorio", "fornecedor", "linha", "brand"],
  sku: [
    "sku",
    "codigo",
    "cod",
    "codigo interno",
    "codigo do produto",
    "referencia",
    "ref",
    "ean",
    "gtin",
    "codigo de barras",
    "cod barras",
    "cprod",
    "cean",
  ],
  category: ["categoria", "grupo", "departamento", "secao", "familia", "tipo", "classe"],
  unit: ["unidade", "un", "unid", "medida", "unidade de medida", "ucom", "embalagem"],
  price: [
    "preco",
    "preco de venda",
    "preco venda",
    "preco unitario",
    "valor",
    "valor unitario",
    "valor venda",
    "vlr unit",
    "vlr unitario",
    "vlr venda",
    "vuncom",
    "pvenda",
    "price",
  ],
  minQty: ["qtd minima", "quantidade minima", "minimo", "pedido minimo", "lote minimo", "minqty"],
  stock: [
    "estoque",
    "saldo",
    "saldo estoque",
    "estoque atual",
    "qtd",
    "qtde",
    "quantidade",
    "disponivel",
    "qcom",
    "stock",
  ],
  description: ["detalhes", "observacao", "observacoes", "obs", "descricao longa", "especificacao", "infadprod"],
  active: ["ativo", "status", "situacao", "visivel", "disponivel venda", "active"],
  imageUrl: ["imagem", "foto", "url imagem", "url foto", "link imagem", "link foto", "image", "imageurl"],
};

export function detectSupplierColumnMapping(headers: string[]): SupplierColumnMapping {
  const mapping: SupplierColumnMapping = {};
  const assigned = new Set<SupplierImportField>();

  // First pass: exact normalized synonym matches
  headers.forEach((raw, index) => {
    const key = normalizeTextKey(raw);
    if (!key) {
      mapping[index] = "ignore";
      return;
    }
    for (const field of SUPPLIER_IMPORT_FIELDS.map((f) => f.key)) {
      if (assigned.has(field)) continue;
      if (HEADER_SYNONYMS[field].includes(key)) {
        mapping[index] = field;
        assigned.add(field);
        return;
      }
    }
  });

  // Second pass: partial contains matches for remaining columns
  headers.forEach((raw, index) => {
    if (mapping[index]) return;
    const key = normalizeTextKey(raw);
    if (!key) {
      mapping[index] = "ignore";
      return;
    }
    for (const field of SUPPLIER_IMPORT_FIELDS.map((f) => f.key)) {
      if (assigned.has(field)) continue;
      const synonyms = HEADER_SYNONYMS[field];
      if (synonyms.some((syn) => syn.length >= 4 && (key.includes(syn) || syn.includes(key)))) {
        mapping[index] = field;
        assigned.add(field);
        return;
      }
    }
    mapping[index] = "ignore";
  });

  // Ensure if "descricao" got matched as name and another explicit "nome" exists, name already won by order;
  // if "descricao" exists alongside "nome", map the second one to description.
  if (assigned.has("name") && !assigned.has("description")) {
    headers.forEach((raw, index) => {
      if (mapping[index] !== "ignore") return;
      const key = normalizeTextKey(raw);
      if (key === "descricao" || key === "descricao completa" || key === "descricao detalhada") {
        mapping[index] = "description";
        assigned.add("description");
      }
    });
  }

  return mapping;
}

export function normalizeSupplierUnit(raw: unknown): "un" | "ml" | "g" {
  const key = normalizeTextKey(String(raw ?? ""));
  if (key === "ml" || key === "mililitro" || key === "mililitros" || key === "l" || key === "lt" || key === "litro") {
    return "ml";
  }
  if (key === "g" || key === "gr" || key === "grama" || key === "gramas" || key === "kg" || key === "kilo") {
    return "g";
  }
  return "un";
}

export function parseSupplierPriceCents(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 100);
  }
  const raw = String(value).trim();
  if (!raw) return 0;

  // Strip currency symbol and spaces
  const cleaned = raw.replace(/R\$/gi, "").replace(/\s+/g, "").replace(/[^\d.,-]/g, "");
  if (!cleaned || cleaned.startsWith("-")) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    // Decide which is decimal separator by last position:
    // "1.234,50" -> comma is decimal; "1,234.50" -> dot is decimal
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastDot > lastComma) {
      const normalized = cleaned.replace(/,/g, "");
      const num = Number(normalized);
      return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0;
    }
    return Math.max(parseBRLToCents(cleaned), 0);
  }

  if (hasDot && !hasComma) {
    // Dot decimal like "29.90", "18.5000", "12.5" vs thousand separator "1.200"
    const parts = cleaned.split(".");
    if (parts.length === 2) {
      const decimals = parts[1];
      // XML / US decimals have 1, 2, or >=4 digits after dot; 3 digits could be thousands ("1.200")
      // Treat 1, 2, or >=4 digits after single dot as decimal; treat "0.125" (leading 0) as decimal too
      if (decimals.length !== 3 || parts[0] === "0") {
        const num = Number(cleaned);
        return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0;
      }
      // "1.200" -> 1200 reais
      const thousands = Number(cleaned.replace(/\./g, ""));
      return Number.isFinite(thousands) && thousands > 0 ? Math.round(thousands * 100) : 0;
    }
    // Multiple dots like "1.200.000"
    const num = Number(cleaned.replace(/\./g, ""));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0;
  }

  return Math.max(parseBRLToCents(cleaned), 0);
}

export function applyMarkupToCents(priceCents: number, markupPct: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  if (!Number.isFinite(markupPct) || markupPct === 0) return Math.round(priceCents);
  const clampedPct = Math.min(Math.max(markupPct, -90), 1000);
  const adjusted = Math.round(priceCents * (1 + clampedPct / 100));
  return Math.max(adjusted, 1);
}

export function parseSupplierQty(value: unknown, fallback: number | null): number | null {
  if (value == null) return fallback;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return fallback;
    return Math.round(value * 1000) / 1000;
  }
  const raw = String(value).trim();
  if (!raw) return fallback;
  const lower = normalizeTextKey(raw);
  if (lower === "ilimitado" || lower === "sem limite" || lower === "infinito" || lower === "-") {
    return null;
  }
  const cleaned = raw.replace(/\s+/g, "").replace(/[^\d.,-]/g, "");
  if (!cleaned || cleaned.startsWith("-")) return fallback;

  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized =
      cleaned.lastIndexOf(".") > cleaned.lastIndexOf(",")
        ? cleaned.replace(/,/g, "")
        : cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.round(num * 1000) / 1000;
}

export function parseSupplierActive(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "boolean") return value;
  const key = normalizeTextKey(String(value));
  if (!key) return true;
  if (["0", "nao", "n", "false", "inativo", "inativa", "oculto", "oculta", "desativado", "excluido"].includes(key)) {
    return false;
  }
  return true;
}

export function sanitizeImportedImageUrl(raw: unknown): string | null {
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const parsed = parseSafePublicHttpsUrl(str);
  return parsed ? parsed.toString() : null;
}

export function normalizeSkuKey(sku?: string | null): string {
  return (sku ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function supplierProductMatchKey(item: {
  sku?: string | null;
  name: string;
  brand?: string | null;
}): string {
  const skuKey = normalizeSkuKey(item.sku);
  if (skuKey) return `sku:${skuKey}`;
  const nameKey = normalizeTextKey(item.name);
  const brandKey = normalizeTextKey(item.brand ?? "");
  return `name:${nameKey}|${brandKey}`;
}

function cleanText(raw: unknown, maxLen: number): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function mapSupplierTableRows(
  rows: unknown[][],
  mapping: SupplierColumnMapping,
  options?: {
    markupPct?: number;
    defaultBrand?: string;
    defaultCategory?: string;
    stockMode?: SupplierStockMode;
    sourceFile?: string;
  },
): { drafts: SupplierImportDraft[]; errors: SupplierImportIssue[] } {
  const drafts: SupplierImportDraft[] = [];
  const errors: SupplierImportIssue[] = [];
  const markupPct = options?.markupPct ?? 0;
  const defaultBrand = cleanText(options?.defaultBrand ?? "", 80) || null;
  const defaultCategory = cleanText(options?.defaultCategory ?? "", 80) || null;
  const stockMode = options?.stockMode ?? "replace";

  const limit = Math.min(rows.length, MAX_SUPPLIER_IMPORT_ROWS);
  if (rows.length > MAX_SUPPLIER_IMPORT_ROWS) {
    errors.push({
      row: MAX_SUPPLIER_IMPORT_ROWS + 1,
      sourceFile: options?.sourceFile,
      message: `A planilha excedeu ${MAX_SUPPLIER_IMPORT_ROWS} linhas; apenas as primeiras ${MAX_SUPPLIER_IMPORT_ROWS} serão consideradas.`,
    });
  }

  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const lineNumber = i + 2;
    const raw: Partial<Record<SupplierImportField, unknown>> = {};
    let hasAnyValue = false;

    for (const [colIdxStr, field] of Object.entries(mapping)) {
      if (!field || field === "ignore") continue;
      const cell = row[Number(colIdxStr)];
      if (cell != null && String(cell).trim() !== "") {
        hasAnyValue = true;
      }
      if (raw[field] === undefined || String(raw[field] ?? "").trim() === "") {
        raw[field] = cell;
      }
    }

    if (!hasAnyValue) continue;

    const name = cleanText(raw.name, 160);
    const rawPriceCents = parseSupplierPriceCents(raw.price);
    const priceCents = applyMarkupToCents(rawPriceCents, markupPct);

    if (!name) {
      errors.push({ row: lineNumber, sourceFile: options?.sourceFile, message: "Nome do produto obrigatório." });
      continue;
    }
    if (priceCents <= 0 || priceCents > 100_000_000) {
      errors.push({
        row: lineNumber,
        sourceFile: options?.sourceFile,
        message: `Preço inválido para "${name.slice(0, 40)}".`,
      });
      continue;
    }

    const brand = cleanText(raw.brand, 80) || defaultBrand;
    const skuRaw = cleanText(raw.sku, 64);
    const sku = skuRaw && skuRaw.toUpperCase() !== "SEM GTIN" ? skuRaw : null;
    const category = cleanText(raw.category, 80) || defaultCategory;
    const unit = normalizeSupplierUnit(raw.unit);
    const minQtyParsed = parseSupplierQty(raw.minQty, 1);
    const minQty = Math.min(Math.max(minQtyParsed ?? 1, 0.01), 10_000);
    const stock =
      stockMode === "unlimited"
        ? null
        : (() => {
            const parsed = parseSupplierQty(raw.stock, null);
            return parsed == null ? null : Math.min(parsed, 1_000_000);
          })();
    const description = cleanText(raw.description, 1000) || null;
    const active = parseSupplierActive(raw.active);
    const imageUrl = sanitizeImportedImageUrl(raw.imageUrl);

    drafts.push({
      row: lineNumber,
      sourceFile: options?.sourceFile,
      name,
      brand,
      sku,
      category,
      unit,
      priceCents,
      minQty,
      stock,
      description,
      active,
      imageUrl,
    });
  }

  return { drafts: mergeSupplierImportDrafts(drafts), errors };
}

export function mergeSupplierImportDrafts(drafts: SupplierImportDraft[]): SupplierImportDraft[] {
  const byKey = new Map<string, SupplierImportDraft>();
  for (const draft of drafts) {
    const key = supplierProductMatchKey(draft);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...draft });
      continue;
    }
    const mergedStock =
      existing.stock != null && draft.stock != null
        ? Math.min(Math.round((existing.stock + draft.stock) * 1000) / 1000, 1_000_000)
        : draft.stock ?? existing.stock;

    byKey.set(key, {
      ...existing,
      name: draft.name || existing.name,
      brand: draft.brand ?? existing.brand,
      sku: draft.sku ?? existing.sku,
      category: draft.category ?? existing.category,
      unit: draft.unit || existing.unit,
      priceCents: draft.priceCents > 0 ? draft.priceCents : existing.priceCents,
      minQty: draft.minQty || existing.minQty,
      stock: mergedStock,
      description: draft.description ?? existing.description,
      active: draft.active,
      imageUrl: draft.imageUrl ?? existing.imageUrl,
    });
  }
  return [...byKey.values()];
}

function decodeXmlEntitiesOnce(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (full, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const code = parseInt(entity.slice(2), 16);
          return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
        }
        if (entity.startsWith("#")) {
          const code = parseInt(entity.slice(1), 10);
          return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
        }
        return full;
      }
    }
  });
}

function extractXmlTag(block: string, tagName: string): string | null {
  // Matches optional namespace prefix like <nfe:xProd>...</nfe:xProd> or <xProd>...</xProd>
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, "i");
  const match = block.match(re);
  if (!match) return null;
  const raw = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
  return decodeXmlEntitiesOnce(raw).replace(/\s+/g, " ").trim();
}

export function parseNfeXml(
  xmlText: string,
  options?: {
    sourceFile?: string;
    markupPct?: number;
    defaultBrand?: string;
    defaultCategory?: string;
  },
): NfeXmlParseResult {
  const sourceFile = options?.sourceFile;
  const markupPct = options?.markupPct ?? 0;
  const defaultBrand = cleanText(options?.defaultBrand ?? "", 80) || null;
  const defaultCategory = cleanText(options?.defaultCategory ?? "", 80) || null;

  if (!xmlText || !xmlText.trim()) {
    return {
      issuerName: null,
      invoiceNumber: null,
      drafts: [],
      errors: [{ row: 1, sourceFile, message: "Arquivo XML vazio." }],
    };
  }

  // Strict XXE / entity-expansion guard: NF-e SEFAZ XMLs never contain DOCTYPE or ENTITY declarations
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xmlText)) {
    return {
      issuerName: null,
      invoiceNumber: null,
      drafts: [],
      errors: [{ row: 1, sourceFile, message: "XML rejeitado por conter declarações DOCTYPE/ENTITY não permitidas." }],
    };
  }

  const ideBlock = extractXmlTag(xmlText, "ide") ?? "";
  const emitBlock = extractXmlTag(xmlText, "emit") ?? "";
  const invoiceNumber = extractXmlTag(ideBlock, "nNF") || null;
  const issuerName = extractXmlTag(emitBlock, "xFant") || extractXmlTag(emitBlock, "xNome") || null;

  const detRegex = /<(?:[a-zA-Z0-9_-]+:)?det(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?det>/gi;
  const drafts: SupplierImportDraft[] = [];
  const errors: SupplierImportIssue[] = [];

  let match: RegExpExecArray | null;
  let itemIndex = 0;

  while ((match = detRegex.exec(xmlText)) !== null) {
    itemIndex += 1;
    if (itemIndex > MAX_SUPPLIER_IMPORT_ROWS) {
      errors.push({
        row: itemIndex,
        sourceFile,
        message: `Limite de ${MAX_SUPPLIER_IMPORT_ROWS} itens por importação atingido.`,
      });
      break;
    }

    const detContent = match[1];
    const prodBlock = extractXmlTag(detContent, "prod");
    if (!prodBlock) continue;

    const name = cleanText(extractXmlTag(prodBlock, "xProd") ?? "", 160);
    const cProd = cleanText(extractXmlTag(prodBlock, "cProd") ?? "", 64);
    const cEanRaw = cleanText(extractXmlTag(prodBlock, "cEAN") ?? "", 64);
    const cEan = cEanRaw && cEanRaw.toUpperCase() !== "SEM GTIN" ? cEanRaw : "";
    const sku = cProd || cEan || null;
    const ncm = cleanText(extractXmlTag(prodBlock, "NCM") ?? "", 16);
    const unit = normalizeSupplierUnit(extractXmlTag(prodBlock, "uCom"));
    const qCom = parseSupplierQty(extractXmlTag(prodBlock, "qCom"), null);
    const vUnComRaw = extractXmlTag(prodBlock, "vUnCom");
    const vProdRaw = extractXmlTag(prodBlock, "vProd");
    const infAdProd = cleanText(extractXmlTag(detContent, "infAdProd") ?? "", 400);

    let basePriceCents = parseSupplierPriceCents(vUnComRaw);
    if (basePriceCents <= 0 && vProdRaw && qCom && qCom > 0) {
      const totalCents = parseSupplierPriceCents(vProdRaw);
      if (totalCents > 0) basePriceCents = Math.round(totalCents / qCom);
    }

    const priceCents = applyMarkupToCents(basePriceCents, markupPct);

    if (!name) {
      errors.push({ row: itemIndex, sourceFile, message: `Item #${itemIndex} sem nome (<xProd>).` });
      continue;
    }
    if (priceCents <= 0 || priceCents > 100_000_000) {
      errors.push({
        row: itemIndex,
        sourceFile,
        message: `Item #${itemIndex} ("${name.slice(0, 40)}") sem valor unitário válido (<vUnCom>).`,
      });
      continue;
    }

    const descParts: string[] = [];
    if (infAdProd) descParts.push(infAdProd);
    if (cEan && cEan !== sku) descParts.push(`EAN: ${cEan}`);
    if (ncm) descParts.push(`NCM: ${ncm}`);
    if (invoiceNumber) descParts.push(`NF-e ${invoiceNumber}`);

    drafts.push({
      row: itemIndex,
      sourceFile,
      name,
      brand: defaultBrand,
      sku,
      category: defaultCategory,
      unit,
      priceCents,
      minQty: 1,
      stock: qCom == null ? null : Math.min(qCom, 1_000_000),
      description: descParts.length ? descParts.join(" · ").slice(0, 1000) : null,
      active: true,
      imageUrl: null,
    });
  }

  if (itemIndex === 0) {
    errors.push({
      row: 1,
      sourceFile,
      message: "Nenhum item de NF-e (<det><prod>) encontrado neste arquivo XML.",
    });
  }

  return {
    issuerName,
    invoiceNumber,
    drafts: mergeSupplierImportDrafts(drafts),
    errors,
  };
}
