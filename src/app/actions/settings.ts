"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canManageSettings } from "@/lib/auth";

export async function saveSettings(formData: FormData) {
  const { session } = await requireTenant();
  if (!canManageSettings(session.role)) return { error: "Sem permissão." };

  const openaiApiKeyInput = String(formData.get("openaiApiKey") ?? "").trim();
  const clearOpenaiKey = String(formData.get("clearOpenaiApiKey") ?? "") === "1";
  const reminderRaw = Number(formData.get("reminderHours") ?? 24);
  const reminderHours = Number.isFinite(reminderRaw) ? Math.min(168, Math.max(1, Math.round(reminderRaw))) : 24;

  const data: {
    name?: string;
    tradeName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    openTime: string;
    closeTime: string;
    reminderHours: number;
    openaiApiKey?: string | null;
  } = {
    name: String(formData.get("name") ?? "").trim() || undefined,
    tradeName: String(formData.get("tradeName") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    city: String(formData.get("city") ?? "").trim() || null,
    openTime: String(formData.get("openTime") ?? "08:00"),
    closeTime: String(formData.get("closeTime") ?? "20:00"),
    reminderHours,
  };

  if (clearOpenaiKey) {
    data.openaiApiKey = null;
  } else if (openaiApiKeyInput) {
    data.openaiApiKey = openaiApiKeyInput;
  }

  await prisma.tenant.update({
    where: { id: session.tenantId },
    data,
  });

  revalidatePath("/configuracoes");
  revalidatePath("/agenda");
  return { ok: true };
}
