import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdminApi } from "@/lib/marketing-drive-storage";
import {
  isPlatformModuleKey,
  type PlatformModuleKey,
} from "@/lib/platform-modules";
import { loadPlatformModules, updatePlatformModules } from "@/lib/platform-modules-server";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function revalidateAllPortals() {
  revalidatePath("/plataforma");
  revalidatePath("/plataforma/modulos");
  revalidatePath("/plataforma/materiais");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  revalidatePath("/comandas");
  revalidatePath("/pacotes");
  revalidatePath("/servicos");
  revalidatePath("/estoque");
  revalidatePath("/marketing");
  revalidatePath("/fornecedor");
  revalidatePath("/parceiro");
  revalidatePath("/parceiro/materiais");
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdminApi(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const modules = await loadPlatformModules();
  return json({ ok: true, modules });
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformAdminApi(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Informe os módulos a atualizar." }, 400);
  }

  const raw = (body as { modules?: unknown }).modules ?? body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "Formato inválido para atualização de módulos." }, 400);
  }

  const patch: Partial<Record<PlatformModuleKey, boolean>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isPlatformModuleKey(key) && typeof value === "boolean") {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: "Nenhum módulo válido informado." }, 400);
  }

  try {
    const modules = await updatePlatformModules(patch);
    revalidateAllPortals();
    return json({ ok: true, modules });
  } catch (cause) {
    console.error("update platform modules failed", cause);
    return json({ error: "Não foi possível salvar a configuração dos módulos." }, 500);
  }
}
