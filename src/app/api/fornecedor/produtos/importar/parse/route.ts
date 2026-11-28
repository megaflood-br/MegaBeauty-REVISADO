import { NextResponse } from "next/server";
import { parseSupplierSpreadsheetFile, requireSupplierApi } from "@/lib/run-supplier-import";
import {
  MAX_XML_FILES,
  MAX_XML_FILE_BYTES,
  MAX_XML_TOTAL_BYTES,
  mergeSupplierImportDrafts,
  parseNfeXml,
  type SupplierImportDraft,
  type SupplierImportIssue,
} from "@/lib/supplier-import";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireSupplierApi(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Não foi possível ler os arquivos enviados." }, 400);
    }

    const kind = String(form.get("kind") ?? "spreadsheet").trim();

    if (kind === "xml") {
      const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
      if (files.length === 0) {
        return json({ error: "Selecione pelo menos um arquivo XML de NF-e." }, 400);
      }
      if (files.length > MAX_XML_FILES) {
        return json({ error: `Envie no máximo ${MAX_XML_FILES} arquivos XML por vez.` }, 400);
      }

      let totalBytes = 0;
      const allDrafts: SupplierImportDraft[] = [];
      const allErrors: SupplierImportIssue[] = [];
      const parsedFiles: { name: string; invoiceNumber: string | null; issuerName: string | null; itemCount: number }[] =
        [];

      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".xml")) {
          allErrors.push({ row: 1, sourceFile: file.name, message: "Arquivo ignorado: apenas extensão .xml é aceita." });
          continue;
        }
        if (file.size === 0) {
          allErrors.push({ row: 1, sourceFile: file.name, message: "Arquivo XML vazio." });
          continue;
        }
        if (file.size > MAX_XML_FILE_BYTES) {
          allErrors.push({
            row: 1,
            sourceFile: file.name,
            message: "Arquivo XML excede o limite de 2 MB.",
          });
          continue;
        }
        totalBytes += file.size;
        if (totalBytes > MAX_XML_TOTAL_BYTES) {
          return json({ error: "O tamanho total dos arquivos XML excedeu o limite de 8 MB." }, 400);
        }

        const xmlText = await file.text();
        const parsed = parseNfeXml(xmlText, { sourceFile: file.name });
        parsedFiles.push({
          name: file.name,
          invoiceNumber: parsed.invoiceNumber,
          issuerName: parsed.issuerName,
          itemCount: parsed.drafts.length,
        });
        allDrafts.push(...parsed.drafts);
        allErrors.push(...parsed.errors);
      }

      const merged = mergeSupplierImportDrafts(allDrafts);
      return json({
        ok: true,
        kind: "xml",
        files: parsedFiles,
        drafts: merged,
        errors: allErrors.slice(0, 60),
      });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Selecione uma planilha (.xlsx, .xls ou .csv)." }, 400);
    }

    const parsed = await parseSupplierSpreadsheetFile(file);
    if ("error" in parsed) {
      return json({ error: parsed.error }, 400);
    }

    return json({
      ok: true,
      kind: "spreadsheet",
      ...parsed,
    });
  } catch (cause) {
    console.error("parse supplier import failed", cause);
    return json({ error: "Não foi possível processar o arquivo enviado." }, 500);
  }
}
