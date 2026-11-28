import { NextResponse } from "next/server";
import { checkPlatformModule } from "@/lib/platform-modules-server";
import { commitSupplierProductImport, requireSupplierApi } from "@/lib/run-supplier-import";
import type { SupplierImportMode, SupplierStockMode } from "@/lib/supplier-import";

export const runtime = "nodejs";
export const maxDuration = 120;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseMode(raw: unknown): SupplierImportMode {
  if (raw === "create_only" || raw === "update_only") return raw;
  return "upsert";
}

function parseStockMode(raw: unknown): SupplierStockMode {
  if (raw === "add" || raw === "unlimited") return raw;
  return "replace";
}

export async function POST(request: Request) {
  try {
    const auth = await requireSupplierApi(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const mod = await checkPlatformModule("supplierBulkImport");
    if (!mod.ok) return json({ error: mod.error }, 403);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Corpo da requisição inválido." }, 400);
    }

    if (!body || typeof body !== "object") {
      return json({ error: "Nenhum dado para importar." }, 400);
    }

    const payload = body as Record<string, unknown>;
    if (!Array.isArray(payload.drafts) || payload.drafts.length === 0) {
      return json({ error: "Nenhum produto válido selecionado para importação." }, 400);
    }

    const mode = parseMode(payload.mode);
    const stockMode = parseStockMode(payload.stockMode);

    const result = await commitSupplierProductImport(auth.tenantId, payload.drafts, {
      mode,
      stockMode,
    });

    return json(result, 200);
  } catch (cause) {
    console.error("commit supplier import failed", cause);
    return json({ error: "Não foi possível gravar os produtos importados. Tente novamente." }, 500);
  }
}
