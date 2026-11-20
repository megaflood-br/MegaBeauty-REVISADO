"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canManageSettings } from "@/lib/auth";
import { isEvolutionConfigured, sendTextMessage } from "@/lib/evolution";
import { draftWhatsAppMessage } from "@/lib/openai";

function isSafeWebhookUrl(raw: string) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (process.env.NODE_ENV === "production") {
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        host.startsWith("169.254.")
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function sendWhatsApp(formData: FormData) {
  const { session, tenant } = await requireTenant();
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");
  const body = String(formData.get("body") ?? "").trim();
  const conversationId = String(formData.get("conversationId") ?? "");

  if (!phone || !body) return { error: "Telefone e mensagem são obrigatórios." };

  const conversation =
    (conversationId
      ? await prisma.conversation.findFirst({
          where: { id: conversationId, tenantId: session.tenantId },
        })
      : null) ??
    (await prisma.conversation.upsert({
      where: { tenantId_phone: { tenantId: session.tenantId, phone } },
      update: { lastMessageAt: new Date() },
      create: { tenantId: session.tenantId, phone, lastMessageAt: new Date() },
    }));

  const config = {
    url: tenant.evolutionUrl ?? process.env.EVOLUTION_API_URL ?? "",
    apiKey: tenant.evolutionApiKey ?? process.env.EVOLUTION_API_KEY ?? "",
    instance: tenant.evolutionInstance ?? "",
  };

  if (isEvolutionConfigured(config)) {
    await sendTextMessage(config, phone, body);
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUT",
      body,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), unread: 0 },
  });

  revalidatePath("/whatsapp");
  return { ok: true, mocked: !isEvolutionConfigured(config) };
}

export async function generateWhatsAppDraft(goal: string, clientName: string) {
  const { tenant } = await requireTenant();
  const text = await draftWhatsAppMessage({
    apiKey: tenant.openaiApiKey,
    goal,
    clientName,
    salonName: tenant.name,
  });
  return { text };
}

export async function saveEvolutionSettings(formData: FormData) {
  const { session } = await requireTenant();
  if (!canManageSettings(session.role)) return { error: "Sem permissão." };

  const evolutionUrl = String(formData.get("evolutionUrl") ?? "").trim();
  const evolutionApiKey = String(formData.get("evolutionApiKey") ?? "").trim();
  const evolutionInstance = String(formData.get("evolutionInstance") ?? "").trim();
  const clearEvolutionKey = String(formData.get("clearEvolutionApiKey") ?? "") === "1";

  if (evolutionUrl && !isSafeWebhookUrl(evolutionUrl)) {
    return { error: "URL da Evolution API inválida." };
  }

  const data: {
    evolutionUrl: string | null;
    evolutionInstance: string | null;
    evolutionApiKey?: string | null;
  } = {
    evolutionUrl: evolutionUrl || null,
    evolutionInstance: evolutionInstance || null,
  };

  if (clearEvolutionKey) {
    data.evolutionApiKey = null;
  } else if (evolutionApiKey) {
    data.evolutionApiKey = evolutionApiKey;
  }

  await prisma.tenant.update({
    where: { id: session.tenantId },
    data,
  });

  revalidatePath("/whatsapp");
  revalidatePath("/configuracoes");
  return { ok: true };
}
