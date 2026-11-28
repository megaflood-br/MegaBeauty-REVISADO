"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatStockQty } from "@/lib/stock";
import {
  SUPPLIER_IMPORT_FIELDS,
  applyMarkupToCents,
  buildSupplierTemplateCsv,
  mapSupplierTableRows,
  normalizeSkuKey,
  supplierProductMatchKey,
  type SupplierColumnMapping,
  type SupplierImportDraft,
  type SupplierImportField,
  type SupplierImportIssue,
  type SupplierImportMode,
  type SupplierStockMode,
} from "@/lib/supplier-import";
import type { SupplierProductRow } from "@/components/fornecedor/types";
import { cn } from "@/lib/utils";

type ImportSourceKind = "spreadsheet" | "xml";

type ParsedSpreadsheetState = {
  fileName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
};

type ParsedXmlFileInfo = {
  name: string;
  invoiceNumber: string | null;
  issuerName: string | null;
  itemCount: number;
};

type CommitResultState = {
  created: number;
  updated: number;
  skipped: number;
  errors: SupplierImportIssue[];
};

export function SupplierProductImportDrawer({
  existingProducts,
  onClose,
}: {
  existingProducts: SupplierProductRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  const [sourceKind, setSourceKind] = useState<ImportSourceKind>("spreadsheet");
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parsed sources
  const [sheetData, setSheetData] = useState<ParsedSpreadsheetState | null>(null);
  const [mapping, setMapping] = useState<SupplierColumnMapping>({});
  const [xmlFilesInfo, setXmlFilesInfo] = useState<ParsedXmlFileInfo[]>([]);
  const [xmlBaseDrafts, setXmlBaseDrafts] = useState<SupplierImportDraft[]>([]);
  const [xmlParseErrors, setXmlParseErrors] = useState<SupplierImportIssue[]>([]);

  // Import rules
  const [mode, setMode] = useState<SupplierImportMode>("upsert");
  const [stockMode, setStockMode] = useState<SupplierStockMode>("replace");
  const [markupPctInput, setMarkupPctInput] = useState("0");
  const [defaultBrand, setDefaultBrand] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");

  // Result state
  const [result, setResult] = useState<CommitResultState | null>(null);

  const markupPct = useMemo(() => {
    const normalized = markupPctInput.replace(",", ".").trim();
    const num = Number(normalized);
    return Number.isFinite(num) ? Math.min(Math.max(num, -90), 1000) : 0;
  }, [markupPctInput]);

  // Index existing catalog for accurate pre-import match preview
  const existingIndex = useMemo(() => {
    const bySku = new Set<string>();
    const byNameBrand = new Set<string>();
    for (const p of existingProducts) {
      const skuKey = normalizeSkuKey(p.sku);
      if (skuKey) bySku.add(skuKey);
      byNameBrand.add(supplierProductMatchKey({ name: p.name, brand: p.brand, sku: null }));
    }
    return { bySku, byNameBrand };
  }, [existingProducts]);

  const hasRequiredSpreadsheetColumns = useMemo(() => {
    const values = Object.values(mapping);
    return values.includes("name") && values.includes("price");
  }, [mapping]);

  // Build final normalized drafts live as user tweaks mapping / markup / defaults
  const preview = useMemo(() => {
    if (sourceKind === "spreadsheet") {
      if (!sheetData) return { drafts: [] as SupplierImportDraft[], errors: [] as SupplierImportIssue[] };
      return mapSupplierTableRows(sheetData.rows, mapping, {
        markupPct,
        defaultBrand,
        defaultCategory,
        stockMode,
        sourceFile: sheetData.fileName,
      });
    }

    const trimmedBrand = defaultBrand.trim().slice(0, 80) || null;
    const trimmedCategory = defaultCategory.trim().slice(0, 80) || null;
    const adjustedDrafts = xmlBaseDrafts.map((item) => ({
      ...item,
      brand: item.brand ?? trimmedBrand,
      category: item.category ?? trimmedCategory,
      priceCents: applyMarkupToCents(item.priceCents, markupPct),
      stock: stockMode === "unlimited" ? null : item.stock,
    }));
    return { drafts: adjustedDrafts, errors: xmlParseErrors };
  }, [sourceKind, sheetData, mapping, markupPct, defaultBrand, defaultCategory, stockMode, xmlBaseDrafts, xmlParseErrors]);

  const classifiedRows = useMemo(() => {
    let createCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    const rows = preview.drafts.map((draft) => {
      const skuKey = normalizeSkuKey(draft.sku);
      const exists =
        (skuKey ? existingIndex.bySku.has(skuKey) : false) ||
        existingIndex.byNameBrand.has(supplierProductMatchKey({ name: draft.name, brand: draft.brand, sku: null }));

      let action: "create" | "update" | "skip";
      if (exists) {
        if (mode === "create_only") {
          action = "skip";
          skipCount += 1;
        } else {
          action = "update";
          updateCount += 1;
        }
      } else if (mode === "update_only") {
        action = "skip";
        skipCount += 1;
      } else {
        action = "create";
        createCount += 1;
      }

      return { draft, action };
    });

    return { rows, createCount, updateCount, skipCount, actionableCount: createCount + updateCount };
  }, [preview.drafts, existingIndex, mode]);

  const hasLoadedSource = sourceKind === "spreadsheet" ? Boolean(sheetData) : xmlFilesInfo.length > 0;

  function resetSource() {
    setError(null);
    setResult(null);
    setSheetData(null);
    setMapping({});
    setXmlFilesInfo([]);
    setXmlBaseDrafts([]);
    setXmlParseErrors([]);
  }

  function handleSwitchKind(nextKind: ImportSourceKind) {
    if (nextKind === sourceKind) return;
    setSourceKind(nextKind);
    setError(null);
    setResult(null);
    setStockMode(nextKind === "xml" ? "add" : "replace");
  }

  function handleDownloadTemplate() {
    const csv = buildSupplierTemplateCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo-produtos-fornecedor.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleUploadSpreadsheet(file: File) {
    setError(null);
    setResult(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.set("kind", "spreadsheet");
      fd.set("file", file);
      const res = await fetch("/api/fornecedor/produtos/importar/parse", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Não foi possível ler a planilha.");
        return;
      }
      setSheetData({
        fileName: data.fileName,
        headers: data.headers,
        rows: data.rows,
        totalRows: data.totalRows,
        truncated: Boolean(data.truncated),
      });
      setMapping(data.suggestedMapping ?? {});
    } catch {
      setError("Falha ao enviar a planilha. Tente novamente.");
    } finally {
      setParsing(false);
    }
  }

  async function handleUploadXmlFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.set("kind", "xml");
      for (const file of files) {
        fd.append("files", file);
      }
      const res = await fetch("/api/fornecedor/produtos/importar/parse", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Não foi possível ler os arquivos XML.");
        return;
      }
      setXmlFilesInfo(Array.isArray(data.files) ? data.files : []);
      setXmlBaseDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setXmlParseErrors(Array.isArray(data.errors) ? data.errors : []);
    } catch {
      setError("Falha ao enviar os arquivos XML. Tente novamente.");
    } finally {
      setParsing(false);
    }
  }

  async function handleCommitImport() {
    if (classifiedRows.actionableCount === 0) return;
    setError(null);
    setCommitting(true);
    try {
      const res = await fetch("/api/fornecedor/produtos/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts: preview.drafts,
          mode,
          stockMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Não foi possível concluir a importação.");
        return;
      }
      setResult({
        created: Number(data.created ?? 0),
        updated: Number(data.updated ?? 0),
        skipped: Number(data.skipped ?? 0),
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
      router.refresh();
    } catch {
      setError("Erro de comunicação ao gravar os produtos. Confira sua lista e tente novamente.");
    } finally {
      setCommitting(false);
    }
  }

  function updateColumnMapping(colIdx: number, nextField: SupplierImportField | "ignore") {
    setMapping((prev) => {
      const updated: SupplierColumnMapping = { ...prev };
      // Keep unique field assignment (except ignore)
      if (nextField !== "ignore") {
        for (const [key, val] of Object.entries(updated)) {
          if (val === nextField) {
            updated[Number(key)] = "ignore";
          }
        }
      }
      updated[colIdx] = nextField;
      return updated;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Importar produtos em massa</h2>
            <p className="text-xs text-ink-soft">
              Traga seu catálogo de qualquer ERP por planilha (Excel/CSV) ou direto por XML de NF-e.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-soft hover:bg-sand"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="mx-auto max-w-xl space-y-5 py-6">
              <div className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center">
                <CheckCircle2 size={36} className="text-emerald-600" />
                <h3 className="mt-3 text-lg font-semibold text-ink">Importação concluída</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  Seu catálogo de fornecedor já foi atualizado com os itens importados.
                </p>
                <div className="mt-5 grid w-full grid-cols-3 gap-3">
                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="text-2xl font-semibold text-emerald-700">{result.created}</div>
                    <div className="text-xs text-ink-soft">Criados</div>
                  </div>
                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="text-2xl font-semibold text-blue-700">{result.updated}</div>
                    <div className="text-xs text-ink-soft">Atualizados</div>
                  </div>
                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="text-2xl font-semibold text-slate-600">{result.skipped}</div>
                    <div className="text-xs text-ink-soft">Ignorados</div>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                    <AlertTriangle size={16} />
                    {result.errors.length} aviso(s) durante a gravação
                  </div>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-800">
                    {result.errors.map((err, i) => (
                      <li key={i}>
                        Linha {err.row}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" onClick={resetSource}>
                  <RefreshCw size={15} />
                  Importar outro arquivo
                </Button>
                <Button type="button" onClick={onClose}>
                  Concluir e ver produtos
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Source selector */}
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleSwitchKind("spreadsheet")}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition",
                    sourceKind === "spreadsheet"
                      ? "border-wine bg-cream/60 ring-1 ring-wine"
                      : "border-line bg-white hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      sourceKind === "spreadsheet" ? "bg-wine text-white" : "bg-sand text-ink-soft",
                    )}
                  >
                    <FileSpreadsheet size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">Planilha Universal (Excel / CSV)</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      Bling, Tiny, Omie, Conta Azul, Linx ou qualquer planilha própria com mapeamento de colunas.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchKind("xml")}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition",
                    sourceKind === "xml"
                      ? "border-wine bg-cream/60 ring-1 ring-wine"
                      : "border-line bg-white hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      sourceKind === "xml" ? "bg-wine text-white" : "bg-sand text-ink-soft",
                    )}
                  >
                    <FileCode2 size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">XML de NF-e (SEFAZ)</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      Suba um ou vários arquivos .xml de Nota Fiscal Eletrônica e aplique sua margem de venda em lote.
                    </span>
                  </span>
                </button>
              </div>

              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const dropped = e.dataTransfer.files;
                  if (!dropped?.length) return;
                  if (sourceKind === "spreadsheet") {
                    void handleUploadSpreadsheet(dropped[0]);
                  } else {
                    void handleUploadXmlFiles(dropped);
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-6 text-center transition",
                  dragging ? "border-wine bg-cream/80" : "border-line bg-slate-50/70",
                )}
              >
                <input
                  ref={sheetInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleUploadSpreadsheet(file);
                  }}
                />
                <input
                  ref={xmlInputRef}
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) void handleUploadXmlFiles(files);
                    e.target.value = "";
                  }}
                />

                {parsing ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Loader2 size={24} className="animate-spin text-wine" />
                    <span className="text-sm font-medium text-ink">Lendo e analisando arquivo...</span>
                  </div>
                ) : (
                  <>
                    <Upload size={22} className="text-ink-soft" />
                    <p className="mt-2 text-sm font-medium text-ink">
                      {sourceKind === "spreadsheet"
                        ? sheetData
                          ? `Planilha carregada: ${sheetData.fileName} (${sheetData.totalRows} linhas)`
                          : "Arraste sua planilha aqui ou clique para selecionar"
                        : xmlFilesInfo.length > 0
                          ? `${xmlFilesInfo.length} arquivo(s) XML carregado(s)`
                          : "Arraste um ou vários arquivos .xml de NF-e aqui"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {sourceKind === "spreadsheet"
                        ? "Aceita .xlsx, .xls ou .csv até 6 MB (máx. 2.000 produtos por envio)."
                        : "Aceita até 20 arquivos .xml de NF-e por vez (máx. 2 MB por arquivo)."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        onClick={() =>
                          sourceKind === "spreadsheet" ? sheetInputRef.current?.click() : xmlInputRef.current?.click()
                        }
                      >
                        <Upload size={15} />
                        {hasLoadedSource
                          ? sourceKind === "spreadsheet"
                            ? "Trocar planilha"
                            : "Selecionar outros XMLs"
                          : sourceKind === "spreadsheet"
                            ? "Selecionar planilha"
                            : "Selecionar arquivos XML"}
                      </Button>
                      {sourceKind === "spreadsheet" ? (
                        <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
                          <Download size={15} />
                          Baixar planilha modelo (.csv)
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {/* Loaded XML file badges */}
              {sourceKind === "xml" && xmlFilesInfo.length > 0 ? (
                <div className="rounded-xl border border-line bg-cream/40 p-3">
                  <div className="text-xs font-semibold text-ink">Notas fiscais lidas</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {xmlFilesInfo.map((f, idx) => (
                      <div
                        key={`${f.name}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">
                            {f.invoiceNumber ? `NF-e #${f.invoiceNumber}` : f.name}
                          </div>
                          <div className="truncate text-ink-soft">{f.issuerName || f.name}</div>
                        </div>
                        <span className="shrink-0 font-medium text-emerald-700">{f.itemCount} itens</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Column Mapping step for spreadsheets */}
              {sourceKind === "spreadsheet" && sheetData ? (
                <div className="rounded-xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">1. Conferir colunas da planilha</h3>
                      <p className="text-xs text-ink-soft">
                        Mapeamos automaticamente pelo nome das colunas. Ajuste se algum campo do seu sistema tiver outro nome.
                      </p>
                    </div>
                    {!hasRequiredSpreadsheetColumns ? (
                      <span className="text-xs font-medium text-amber-700">
                        Obrigatório mapear Nome do produto e Preço de venda
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sheetData.headers.map((header, colIdx) => {
                      const sample = sheetData.rows.find((r) => r[colIdx]?.trim())?.[colIdx] ?? "";
                      const selected = mapping[colIdx] ?? "ignore";
                      return (
                        <div
                          key={`${header}-${colIdx}`}
                          className={cn(
                            "rounded-lg border p-2.5",
                            selected === "ignore" ? "border-line bg-slate-50/70" : "border-blue-200 bg-blue-50/30",
                          )}
                        >
                          <div className="truncate text-xs font-semibold text-ink" title={header}>
                            {header}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-ink-soft" title={sample || "Sem exemplo"}>
                            Ex.: {sample || "—"}
                          </div>
                          <Select
                            value={selected}
                            onChange={(e) =>
                              updateColumnMapping(colIdx, e.target.value as SupplierImportField | "ignore")
                            }
                            className="mt-2 h-8 text-xs"
                          >
                            <option value="ignore">Ignorar coluna</option>
                            {SUPPLIER_IMPORT_FIELDS.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label}
                                {field.required ? " *" : ""}
                              </option>
                            ))}
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Rules & Pricing step */}
              {hasLoadedSource ? (
                <div className="rounded-xl border border-line bg-white p-4">
                  <h3 className="text-sm font-semibold text-ink">
                    {sourceKind === "spreadsheet" ? "2. Regras de atualização e preço" : "1. Regras de estoque e margem de venda"}
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Produtos já existentes">
                      <Select value={mode} onChange={(e) => setMode(e.target.value as SupplierImportMode)}>
                        <option value="upsert">Criar novos e atualizar existentes</option>
                        <option value="create_only">Somente criar novos</option>
                        <option value="update_only">Somente atualizar existentes</option>
                      </Select>
                    </Field>
                    <Field label="Regra de estoque">
                      <Select value={stockMode} onChange={(e) => setStockMode(e.target.value as SupplierStockMode)}>
                        <option value="replace">Substituir saldo pelo arquivo</option>
                        <option value="add">Somar ao estoque atual</option>
                        <option value="unlimited">Deixar estoque ilimitado</option>
                      </Select>
                    </Field>
                    <Field label="Margem sobre o preço (%)">
                      <Input
                        type="number"
                        step="1"
                        min={-90}
                        max={1000}
                        value={markupPctInput}
                        onChange={(e) => setMarkupPctInput(e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="Marca padrão (se vazio)">
                      <Input
                        value={defaultBrand}
                        onChange={(e) => setDefaultBrand(e.target.value)}
                        placeholder="Opcional"
                      />
                    </Field>
                    <Field label="Categoria padrão (se vazio)">
                      <Input
                        value={defaultCategory}
                        onChange={(e) => setDefaultCategory(e.target.value)}
                        placeholder="Ex.: Unhas, Capilar"
                      />
                    </Field>
                  </div>
                  {sourceKind === "xml" ? (
                    <p className="mt-2 text-xs text-ink-soft">
                      Dica: em XML de compra, informe uma margem (ex.: 40) para calcular o preço de revenda automaticamente na prévia abaixo.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Preview table */}
              {hasLoadedSource ? (
                <div className="rounded-xl border border-line bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <h3 className="text-sm font-semibold text-ink">
                      Prévia antes de importar ({preview.drafts.length} válido{preview.drafts.length === 1 ? "" : "s"})
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
                      <span className="text-emerald-700">{classifiedRows.createCount} novo(s)</span>
                      <span className="text-blue-700">{classifiedRows.updateCount} atualização(ões)</span>
                      {classifiedRows.skipCount > 0 ? (
                        <span className="text-slate-500">{classifiedRows.skipCount} ignorado(s)</span>
                      ) : null}
                      {preview.errors.length > 0 ? (
                        <span className="text-amber-700">{preview.errors.length} aviso(s)</span>
                      ) : null}
                    </div>
                  </div>

                  {preview.errors.length > 0 ? (
                    <div className="border-b border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-900">
                      <div className="font-medium">Linhas ignoradas por dados incompletos ({preview.errors.length}):</div>
                      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-amber-800">
                        {preview.errors.slice(0, 15).map((err, i) => (
                          <li key={i}>
                            {err.sourceFile ? `[${err.sourceFile}] ` : ""}Linha {err.row}: {err.message}
                          </li>
                        ))}
                        {preview.errors.length > 15 ? (
                          <li>... e mais {preview.errors.length - 15} aviso(s).</li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}

                  {classifiedRows.rows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-ink-soft">
                      Nenhum produto válido encontrado com o mapeamento atual. Verifique se as colunas de Nome e Preço estão selecionadas.
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 border-b border-line bg-slate-50 text-ink-soft">
                          <tr>
                            <th className="px-3 py-2 font-medium">Ação</th>
                            <th className="px-3 py-2 font-medium">Produto</th>
                            <th className="px-3 py-2 font-medium">SKU</th>
                            <th className="px-3 py-2 font-medium">Estoque</th>
                            <th className="px-3 py-2 text-right font-medium">Preço</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {classifiedRows.rows.slice(0, 50).map(({ draft, action }, idx) => (
                            <tr key={`${draft.sku ?? draft.name}-${idx}`} className="hover:bg-slate-50/70">
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span
                                  className={cn(
                                    "font-medium",
                                    action === "create"
                                      ? "text-emerald-700"
                                      : action === "update"
                                        ? "text-blue-700"
                                        : "text-slate-400",
                                  )}
                                >
                                  {action === "create" ? "Novo" : action === "update" ? "Atualizar" : "Pular"}
                                </span>
                              </td>
                              <td className="max-w-xs px-3 py-2">
                                <div className="truncate font-medium text-ink">{draft.name}</div>
                                <div className="truncate text-[11px] text-ink-soft">
                                  {[draft.brand, draft.category].filter(Boolean).join(" · ") || "Sem marca/categoria"}
                                </div>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-ink-soft">{draft.sku || "—"}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-ink-soft">
                                {draft.stock == null ? "Ilimitado" : formatStockQty(draft.stock, draft.unit)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-ink">
                                {formatBRL(draft.priceCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {classifiedRows.rows.length > 50 ? (
                        <div className="border-t border-line bg-slate-50 px-3 py-2 text-center text-xs text-ink-soft">
                          Mostrando os 50 primeiros de {classifiedRows.rows.length} produtos prontos para importação.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {!result ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5">
            <span className="text-xs text-ink-soft">
              {hasLoadedSource
                ? `${classifiedRows.actionableCount} produto(s) serão gravados no seu catálogo.`
                : "Envie uma planilha ou XML de NF-e para visualizar a prévia."}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={committing || parsing || classifiedRows.actionableCount === 0}
                onClick={() => void handleCommitImport()}
              >
                {committing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {committing
                  ? "Importando..."
                  : `Importar ${classifiedRows.actionableCount > 0 ? classifiedRows.actionableCount : ""} produto${classifiedRows.actionableCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
