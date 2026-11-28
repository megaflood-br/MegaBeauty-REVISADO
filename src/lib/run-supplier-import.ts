import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { getSession, isPlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  MAX_SPREADSHEET_FILE_BYTES,
  MAX_SUPPLIER_IMPORT_COLS,
  MAX_SUPPLIER_IMPORT_ROWS,
  detectSupplierColumnMapping,
  mergeSupplierImportDrafts,
  normalizeSkuKey,
  normalizeSupplierUnit,
  sanitizeImportedImageUrl,
  supplierProductMatchKey,
  type SupplierColumnMapping,
  type SupplierImportDraft,
  type SupplierImportIssue,
  type SupplierImportMode,
  type SupplierStockMode,
} from "@/lib/supplier-import";

export type SupplierApiAuthResult =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; status: number; error: string };

export async function requireSupplierApi(request: Request): Promise<SupplierApiAuthResult> {
  // Same-origin check on state-changing POST requests authenticated by session cookie
  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) {
        return { ok: false, status: 403, error: "Origem da requisição não autorizada." };
      }
    } catch {
      return { ok: false, status: 403, error: "Origem da requisição inválida." };
    }
  }

  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, error: "Faça login para importar produtos." };
  }
  if (isPlatformAdmin(session.role) && !session.impersonatorId) {
    return { ok: false, status: 403, error: "Acesso exclusivo do portal de fornecedores." };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, kind: true, status: true },
  });
  if (!tenant || tenant.kind !== "SUPPLIER") {
    return { ok: false, status: 403, error: "Apenas contas de fornecedor podem importar catálogo." };
  }
  if (tenant.status === "SUSPENDED" && !session.impersonatorId) {
    return { ok: false, status: 403, error: "Esta conta de fornecedor está suspensa." };
  }

  return { ok: true, tenantId: tenant.id, userId: session.userId };
}

export type ParsedSpreadsheetPreview = {
  fileName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
  suggestedMapping: SupplierColumnMapping;
};

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value).replace(/\s+/g, " ").trim();
}

export async function parseSupplierSpreadsheetFile(file: File): Promise<ParsedSpreadsheetPreview | { error: string }> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
    return { error: "Envie um arquivo .xlsx, .xls ou .csv." };
  }
  if (file.size === 0) {
    return { error: "O arquivo enviado está vazio." };
  }
  if (file.size > MAX_SPREADSHEET_FILE_BYTES) {
    return { error: "Arquivo muito grande. O limite para planilhas é 6 MB." };
  }

  let workbook: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", raw: true, cellDates: false });
  } catch {
    return { error: "Não foi possível ler a planilha. Verifique se o arquivo não está corrompido." };
  }

  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    return Boolean(sheet && sheet["!ref"]);
  });
  if (!sheetName) {
    return { error: "A planilha não contém abas com dados." };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawTable = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const nonEmptyRows = rawTable.filter((row) => Array.isArray(row) && row.some((cell) => cellToString(cell) !== ""));

  if (nonEmptyRows.length < 2) {
    return { error: "A planilha precisa ter pelo menos uma linha de cabeçalho e um produto." };
  }

  // Pick the first row with at least 2 non-empty cells as header row (handles ERPs that put a report title on row 1)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(nonEmptyRows.length - 1, 5); i++) {
    const filled = nonEmptyRows[i].filter((cell) => cellToString(cell) !== "").length;
    if (filled >= 2) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = nonEmptyRows[headerRowIdx];
  const bodyRows = nonEmptyRows.slice(headerRowIdx + 1);

  const maxColCount = Math.min(
    Math.max(headerRow.length, ...bodyRows.slice(0, 50).map((r) => r.length)),
    MAX_SUPPLIER_IMPORT_COLS,
  );

  // Keep only columns that have a header or at least one value in the first 50 rows
  const activeColIndexes: number[] = [];
  for (let c = 0; c < maxColCount; c++) {
    const hasHeader = cellToString(headerRow[c]) !== "";
    const hasSample = bodyRows.slice(0, 50).some((r) => cellToString(r[c]) !== "");
    if (hasHeader || hasSample) activeColIndexes.push(c);
  }

  const headers = activeColIndexes.map((c, idx) => cellToString(headerRow[c]) || `Coluna ${idx + 1}`);
  const truncated = bodyRows.length > MAX_SUPPLIER_IMPORT_ROWS;
  const rows = bodyRows
    .slice(0, MAX_SUPPLIER_IMPORT_ROWS)
    .map((r) => activeColIndexes.map((c) => cellToString(r[c])));

  const suggestedMapping = detectSupplierColumnMapping(headers);

  return {
    fileName: file.name,
    headers,
    rows,
    totalRows: bodyRows.length,
    truncated,
    suggestedMapping,
  };
}

export type SupplierImportCommitResult = {
  ok: true;
  created: number;
  updated: number;
  skipped: number;
  errors: SupplierImportIssue[];
};

function sanitizeIncomingDraft(raw: unknown, index: number): { draft?: SupplierImportDraft; error?: SupplierImportIssue } {
  if (!raw || typeof raw !== "object") {
    return { error: { row: index + 1, message: "Item inválido." } };
  }
  const obj = raw as Record<string, unknown>;
  const row = typeof obj.row === "number" && Number.isFinite(obj.row) ? Math.max(1, Math.round(obj.row)) : index + 1;
  const name = String(obj.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const priceCents = Math.round(Number(obj.priceCents ?? 0));

  if (!name) return { error: { row, message: "Nome do produto obrigatório." } };
  if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents > 100_000_000) {
    return { error: { row, message: `Preço inválido para "${name.slice(0, 40)}".` } };
  }

  const brand =
    String(obj.brand ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || null;
  const sku =
    String(obj.sku ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64) || null;
  const category =
    String(obj.category ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || null;
  const unit = normalizeSupplierUnit(obj.unit);
  const minQtyNum = Number(obj.minQty ?? 1);
  const minQty = Number.isFinite(minQtyNum) ? Math.min(Math.max(minQtyNum, 0.01), 10_000) : 1;

  let stock: number | null = null;
  if (obj.stock !== null && obj.stock !== undefined && obj.stock !== "") {
    const s = Number(obj.stock);
    if (Number.isFinite(s) && s >= 0) {
      stock = Math.min(Math.round(s * 1000) / 1000, 1_000_000);
    }
  }

  const description =
    String(obj.description ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000) || null;
  const active = obj.active === false ? false : true;
  const imageUrl = sanitizeImportedImageUrl(obj.imageUrl);

  return {
    draft: {
      row,
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
    },
  };
}

export async function commitSupplierProductImport(
  tenantId: string,
  rawDrafts: unknown[],
  options: {
    mode: SupplierImportMode;
    stockMode: SupplierStockMode;
  },
): Promise<SupplierImportCommitResult> {
  const validDrafts: SupplierImportDraft[] = [];
  const errors: SupplierImportIssue[] = [];

  const capped = rawDrafts.slice(0, MAX_SUPPLIER_IMPORT_ROWS);
  capped.forEach((raw, idx) => {
    const parsed = sanitizeIncomingDraft(raw, idx);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.draft) validDrafts.push(parsed.draft);
  });

  const mergedDrafts = mergeSupplierImportDrafts(validDrafts);
  if (mergedDrafts.length === 0) {
    return { ok: true, created: 0, updated: 0, skipped: 0, errors };
  }

  const existingRows = await prisma.supplierProduct.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      brand: true,
      sku: true,
      category: true,
      unit: true,
      priceCents: true,
      minQty: true,
      stock: true,
      description: true,
      imageUrl: true,
      active: true,
    },
  });

  const bySku = new Map<string, (typeof existingRows)[number]>();
  const byNameBrand = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const skuKey = normalizeSkuKey(row.sku);
    if (skuKey) bySku.set(skuKey, row);
    byNameBrand.set(supplierProductMatchKey({ name: row.name, brand: row.brand, sku: null }), row);
  }

  const toCreate: {
    tenantId: string;
    name: string;
    brand: string | null;
    sku: string | null;
    category: string | null;
    unit: string;
    priceCents: number;
    minQty: number;
    stock: number | null;
    description: string | null;
    imageUrl: string | null;
    active: boolean;
  }[] = [];

  const toUpdate: {
    id: string;
    data: {
      name: string;
      brand: string | null;
      sku: string | null;
      category: string | null;
      unit: string;
      priceCents: number;
      minQty: number;
      stock: number | null;
      description: string | null;
      imageUrl: string | null;
      active: boolean;
    };
  }[] = [];

  let skipped = 0;

  for (const draft of mergedDrafts) {
    const skuKey = normalizeSkuKey(draft.sku);
    const matched =
      (skuKey ? bySku.get(skuKey) : undefined) ??
      byNameBrand.get(supplierProductMatchKey({ name: draft.name, brand: draft.brand, sku: null }));

    if (matched) {
      if (options.mode === "create_only") {
        skipped += 1;
        continue;
      }

      let nextStock: number | null;
      if (options.stockMode === "unlimited") {
        nextStock = null;
      } else if (options.stockMode === "add") {
        if (draft.stock == null) {
          nextStock = matched.stock;
        } else {
          nextStock = Math.min(Math.round(((matched.stock ?? 0) + draft.stock) * 1000) / 1000, 1_000_000);
        }
      } else {
        nextStock = draft.stock !== null ? draft.stock : matched.stock;
      }

      toUpdate.push({
        id: matched.id,
        data: {
          name: draft.name,
          brand: draft.brand ?? matched.brand,
          sku: draft.sku ?? matched.sku,
          category: draft.category ?? matched.category,
          unit: draft.unit || matched.unit,
          priceCents: draft.priceCents,
          minQty: draft.minQty || matched.minQty,
          stock: nextStock,
          description: draft.description ?? matched.description,
          imageUrl: matched.imageUrl || draft.imageUrl || null,
          active: draft.active,
        },
      });
    } else {
      if (options.mode === "update_only") {
        skipped += 1;
        continue;
      }
      toCreate.push({
        tenantId,
        name: draft.name,
        brand: draft.brand,
        sku: draft.sku,
        category: draft.category,
        unit: draft.unit,
        priceCents: draft.priceCents,
        minQty: draft.minQty,
        stock: options.stockMode === "unlimited" ? null : draft.stock,
        description: draft.description,
        imageUrl: draft.imageUrl,
        active: draft.active,
      });
    }
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const chunk = toCreate.slice(i, i + BATCH_SIZE);
    await prisma.supplierProduct.createMany({ data: chunk });
  }

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((item) =>
        prisma.supplierProduct.update({
          where: { id: item.id, tenantId },
          data: item.data,
        }),
      ),
    );
  }

  try {
    revalidatePath("/fornecedor");
    revalidatePath("/fornecedor/produtos");
    revalidatePath("/fornecedores");
  } catch {
    // Non-fatal outside request context
  }

  return {
    ok: true,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped,
    errors: errors.slice(0, 50),
  };
}
