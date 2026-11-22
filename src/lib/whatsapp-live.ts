import { prisma } from "@/lib/db";
import { evolutionWebhookUrl, instanceNameForTenant, maskSecret, metaWebhookUrl, resolvePlatformIntegrations } from "@/lib/integrations";
import { evolutionWebhookToken } from "@/lib/evolution-webhook-auth";
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  extractEvolutionNumber,
  extractQrBase64,
  getConnectionState,
  parseEvolutionState,
  setEvolutionWebhook,
  type EvolutionConfig,
} from "@/lib/evolution";
import { isMetaConfigured, normalizeWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp-meta";

export type WhatsAppLive = {
  provider: WhatsAppProvider;
  connected: boolean;
  serverReady: boolean;
  instance: string | null;
  state: "open" | "connecting" | "close";
  qr: string | null;
  number: string | null;
  webhookUrl: string;
  error: string | null;
  officialReady: boolean;
  officialState: "open" | "close";
  officialNumber: string | null;
  officialPhoneNumberId: string;
  officialWabaId: string;
  officialTokenMasked: string;
  officialWebhookUrl: string;
  officialVerifyToken: string;
};

function salonConfig(server: { evolutionUrl: string; evolutionApiKey: string }, instance: string): EvolutionConfig {
  return { url: server.evolutionUrl, apiKey: server.evolutionApiKey, instance };
}

function signedEvolutionWebhook(
  server: { publicAppUrl: string; evolutionApiKey: string },
  tenant: { slug: string; evolutionApiKey?: string | null },
) {
  const secret = (tenant.evolutionApiKey || server.evolutionApiKey || "").trim();
  const token = secret ? evolutionWebhookToken(secret, tenant.slug) : "";
  const webhookUrl = evolutionWebhookUrl(server.publicAppUrl, tenant.slug, token || undefined);
  const webhookHeaders = secret
    ? {
        "x-webhook-secret": secret,
        apikey: secret,
        ...(token ? { "x-webhook-token": token } : {}),
      }
    : undefined;
  return { webhookUrl, webhookHeaders };
}

function officialFromTenant(
  tenant: {
    slug: string;
    metaPhoneNumberId: string | null;
    metaAccessToken: string | null;
    metaWabaId: string | null;
    metaVerifyToken: string | null;
    metaNumber: string | null;
    metaStatus: string | null;
  },
  publicAppUrl: string,
) {
  return {
    officialReady: isMetaConfigured(tenant),
    officialState: tenant.metaStatus === "open" && isMetaConfigured(tenant) ? ("open" as const) : ("close" as const),
    officialNumber: tenant.metaNumber,
    officialPhoneNumberId: tenant.metaPhoneNumberId ?? "",
    officialWabaId: tenant.metaWabaId ?? "",
    officialTokenMasked: tenant.metaAccessToken ? maskSecret(tenant.metaAccessToken) : "",
    officialWebhookUrl: metaWebhookUrl(publicAppUrl, tenant.slug),
    officialVerifyToken: tenant.metaVerifyToken ?? "",
  };
}

const emptyOfficial = {
  officialReady: false,
  officialState: "close" as const,
  officialNumber: null,
  officialPhoneNumberId: "",
  officialWabaId: "",
  officialTokenMasked: "",
  officialWebhookUrl: "",
  officialVerifyToken: "",
};

function asState(value: string | null | undefined): WhatsAppLive["state"] {
  if (value === "open" || value === "connecting" || value === "close") return value;
  return "close";
}

/** Lê só o banco local. QR e status chegam pelo webhook, nunca por polling da Evolution. */
export async function readWhatsAppLive(tenantId: string): Promise<WhatsAppLive> {
  const [tenant, server] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    resolvePlatformIntegrations(),
  ]);
  if (!tenant) {
    return {
      provider: "evolution",
      connected: false,
      serverReady: false,
      instance: null,
      state: "close",
      qr: null,
      number: null,
      webhookUrl: "",
      error: "Salão não encontrado.",
      ...emptyOfficial,
    };
  }

  const official = officialFromTenant(tenant, server.publicAppUrl);
  const provider = normalizeWhatsAppProvider(tenant.whatsappProvider);
  const { webhookUrl } = signedEvolutionWebhook(server, tenant);
  const state = asState(tenant.evolutionStatus);
  const live = {
    ...official,
    provider,
    serverReady: server.hasEvolution,
    instance: tenant.evolutionInstance,
    state,
    qr: state === "open" ? null : tenant.evolutionQr,
    number: tenant.evolutionNumber,
    webhookUrl,
    error: null as string | null,
  };
  return {
    ...live,
    connected: provider === "official" ? live.officialState === "open" : live.state === "open",
  };
}

export async function provisionWhatsAppInstance(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Salão não encontrado.");
  const server = await resolvePlatformIntegrations();
  if (!server.hasEvolution) throw new Error("O servidor WhatsApp ainda não foi configurado na plataforma.");
  const tenantRowId = tenant.id;
  const instance = tenant.evolutionInstance || instanceNameForTenant(tenant.slug);
  const { webhookUrl, webhookHeaders } = signedEvolutionWebhook(server, tenant);
  const config = salonConfig(server, instance);

  async function persist(qr: string | null, status: string, number?: string | null) {
    await prisma.tenant.update({
      where: { id: tenantRowId },
      data: {
        evolutionInstance: instance,
        evolutionStatus: status,
        ...(status === "open" ? { evolutionQr: null } : qr ? { evolutionQr: qr } : {}),
        ...(number ? { evolutionNumber: number } : {}),
      },
    });
  }

  let webhookWarning: string | null = null;
  async function registerWebhook() {
    if (!webhookUrl) {
      webhookWarning = "Configure a URL pública da plataforma em Integrações para receber mensagens pelo webhook.";
      return;
    }
    try {
      await setEvolutionWebhook(config, webhookUrl, { headers: webhookHeaders });
    } catch (error) {
      webhookWarning = error instanceof Error ? error.message : "Não foi possível registrar o webhook na Evolution.";
      console.error("[evolution] failed to register webhook:", webhookWarning);
    }
  }

  try {
    const created = await createEvolutionInstance(config, {
      instance,
      webhookUrl: webhookUrl || undefined,
      webhookHeaders,
    });
    const qr = extractQrBase64(created);
    await registerWebhook();
    await persist(qr, "connecting");
    if (qr) return { instance, qr, state: "connecting" as const, webhookUrl, webhookWarning };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/exist|already|já existe|403|409/i.test(message)) throw error;
  }

  await registerWebhook();
  const connect = await connectEvolutionInstance(config);
  const qr = extractQrBase64(connect);
  const state = parseEvolutionState(connect);
  const number = extractEvolutionNumber(connect);
  const nextStatus = state === "open" ? "open" : "connecting";
  await persist(qr, nextStatus, number);
  return { instance, qr: nextStatus === "open" ? null : qr, state: nextStatus, number, webhookUrl, webhookWarning };
}

export async function syncEvolutionWebhookAndState(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Salão não encontrado.");
  const server = await resolvePlatformIntegrations();
  if (!server.hasEvolution) throw new Error("O servidor WhatsApp ainda não foi configurado na plataforma.");

  const { webhookUrl, webhookHeaders } = signedEvolutionWebhook(server, tenant);
  if (!webhookUrl) {
    throw new Error("Configure a URL pública da plataforma (APP_URL) em Integrações antes de sincronizar o webhook.");
  }

  const instance = tenant.evolutionInstance || instanceNameForTenant(tenant.slug);
  const config = salonConfig(server, instance);

  await setEvolutionWebhook(config, webhookUrl, { headers: webhookHeaders });

  let state = asState(tenant.evolutionStatus);
  let number = tenant.evolutionNumber;
  try {
    const statePayload = await getConnectionState(config);
    state = parseEvolutionState(statePayload);
    number = extractEvolutionNumber(statePayload) ?? number;
  } catch {
    // Keep existing persisted state if connectionState endpoint is temporarily unavailable
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      whatsappProvider: "evolution",
      evolutionInstance: instance,
      evolutionStatus: state,
      ...(number ? { evolutionNumber: number } : {}),
      ...(state === "open" ? { evolutionQr: null } : {}),
    },
  });

  return {
    instance,
    state,
    number: number ?? null,
    webhookUrl,
  };
}
