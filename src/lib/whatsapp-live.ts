import { prisma } from "@/lib/db";
import { evolutionWebhookUrl, instanceNameForTenant, maskSecret, metaWebhookUrl, resolvePlatformIntegrations } from "@/lib/integrations";
import { evolutionWebhookToken, verifyEvolutionWebhookAuth } from "@/lib/evolution-webhook-auth";
import { listEvolutionWebhookTraces, maskWebhookUrlToken, type WebhookTraceEntry } from "@/lib/evolution-webhook-log";
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  extractEvolutionNumber,
  extractQrBase64,
  findEvolutionWebhook,
  getConnectionState,
  parseEvolutionState,
  probeEvolutionAuth,
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

  async function registerWebhook(): Promise<string | null> {
    if (!webhookUrl) {
      return "Configure a URL pública da plataforma em Integrações para receber mensagens pelo webhook.";
    }
    try {
      await setEvolutionWebhook(config, webhookUrl, { headers: webhookHeaders });
      return null;
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Não foi possível registrar o webhook na Evolution.";
      console.error("[evolution] failed to register webhook:", warning);
      return warning;
    }
  }

  try {
    const created = await createEvolutionInstance(config, {
      instance,
      webhookUrl: webhookUrl || undefined,
      webhookHeaders,
    });
    const qr = extractQrBase64(created);
    const webhookWarning = await registerWebhook();
    await persist(qr, "connecting");
    if (qr) return { instance, qr, state: "connecting" as const, number: null as string | null, webhookUrl, webhookWarning };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/exist|already|já existe|403|409/i.test(message)) throw error;
  }

  const webhookWarning = await registerWebhook();
  const connect = await connectEvolutionInstance(config);
  const qr = extractQrBase64(connect);
  const state = parseEvolutionState(connect);
  const number = extractEvolutionNumber(connect);
  const nextStatus: WhatsAppLive["state"] = state === "open" ? "open" : "connecting";
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

export type EvolutionWebhookTestCheck = {
  id: "credentials" | "token_auth" | "instance_state" | "webhook_enabled" | "webhook_url" | "webhook_events";
  label: string;
  ok: boolean;
  detail: string;
};

export type EvolutionWebhookTestReport = {
  ok: boolean;
  tenantId: string;
  tenantSlug: string;
  instance: string;
  evolutionOrigin: string;
  authOk: boolean;
  authHttpStatus: number | null;
  instanceState: "open" | "connecting" | "close" | "unknown";
  webhookPointedCorrectly: boolean;
  expectedWebhookUrlMasked: string;
  remoteWebhookUrlMasked: string;
  checks: EvolutionWebhookTestCheck[];
  summary: string;
};

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return url.trim();
  }
}

function compareWebhookUrls(remoteUrl: string, expectedUrl: string, tenantSlug: string) {
  const cleanRemote = remoteUrl.trim().replace(/\/$/, "");
  const cleanExpected = expectedUrl.trim().replace(/\/$/, "");
  if (!cleanRemote || !cleanExpected) {
    return { exactMatch: false, sameEndpoint: false, hasSignedToken: false };
  }
  if (cleanRemote === cleanExpected) {
    return { exactMatch: true, sameEndpoint: true, hasSignedToken: true };
  }
  try {
    const remoteParsed = new URL(cleanRemote);
    const expectedParsed = new URL(cleanExpected);
    const sameOriginAndPath =
      remoteParsed.origin.toLowerCase() === expectedParsed.origin.toLowerCase() &&
      remoteParsed.pathname.replace(/\/$/, "") === expectedParsed.pathname.replace(/\/$/, "");
    const remoteTenant = (remoteParsed.searchParams.get("tenant") ?? "").split("/")[0].trim().toLowerCase();
    const sameEndpoint = sameOriginAndPath && (!remoteTenant || remoteTenant === tenantSlug.toLowerCase());
    const hasSignedToken = Boolean(remoteParsed.searchParams.get("token")?.trim());
    return { exactMatch: false, sameEndpoint, hasSignedToken };
  } catch {
    return { exactMatch: false, sameEndpoint: false, hasSignedToken: false };
  }
}

/**
 * Script/rotina de teste que valida se:
 * 1) O token da Evolution API autentica com sucesso no servidor Evolution;
 * 2) A instância existe e está conectada;
 * 3) O webhook de mensagens na Evolution está ativo, com MESSAGES_UPSERT e apontado para a URL assinada correta.
 */
export async function testEvolutionAuthAndWebhook(tenantId: string): Promise<EvolutionWebhookTestReport> {
  const [tenant, server] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    resolvePlatformIntegrations(),
  ]);
  if (!tenant) throw new Error("Salão não encontrado.");

  const instance = tenant.evolutionInstance || instanceNameForTenant(tenant.slug);
  const evolutionOrigin = server.evolutionUrl ? safeOrigin(server.evolutionUrl) : "";
  const { webhookUrl: expectedUrl } = signedEvolutionWebhook(server, tenant);
  const expectedWebhookUrlMasked = maskWebhookUrlToken(expectedUrl);
  const checks: EvolutionWebhookTestCheck[] = [];

  if (!server.hasEvolution) {
    checks.push({
      id: "credentials",
      label: "Credenciais da Evolution API",
      ok: false,
      detail: "EVOLUTION_API_URL e/ou EVOLUTION_API_KEY não estão configuradas na plataforma.",
    });
    return {
      ok: false,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      instance,
      evolutionOrigin,
      authOk: false,
      authHttpStatus: null,
      instanceState: "unknown",
      webhookPointedCorrectly: false,
      expectedWebhookUrlMasked,
      remoteWebhookUrlMasked: "",
      checks,
      summary: "Configure a URL e a API Key da Evolution em Integrações antes de testar.",
    };
  }

  const secret = (tenant.evolutionApiKey || server.evolutionApiKey || "").trim();
  const expectedToken = evolutionWebhookToken(secret, tenant.slug);
  const localTokenValid = verifyEvolutionWebhookAuth({
    expectedSecret: secret,
    slug: tenant.slug,
    queryToken: expectedToken,
  });

  checks.push({
    id: "credentials",
    label: "Credenciais e assinatura do webhook",
    ok: Boolean(expectedUrl && localTokenValid),
    detail: expectedUrl
      ? `Servidor ${evolutionOrigin} · chave ${maskSecret(server.evolutionApiKey)} · assinatura HMAC válida.`
      : "URL pública da plataforma (APP_URL) não está configurada.",
  });

  const config = salonConfig(server, instance);
  const probe = await probeEvolutionAuth(config);

  checks.push({
    id: "token_auth",
    label: "Autenticação do token na Evolution API",
    ok: probe.authOk,
    detail: probe.authOk
      ? `Token autenticado com sucesso (HTTP ${probe.status ?? 200}).`
      : probe.reachable
        ? `Falha de autenticação (HTTP ${probe.status ?? "erro"}): ${probe.error || "API key recusada pela Evolution."}`
        : `Servidor Evolution inacessível: ${probe.error || "sem resposta."}`,
  });

  checks.push({
    id: "instance_state",
    label: "Estado da instância na Evolution",
    ok: probe.instanceFound && probe.state === "open",
    detail: !probe.authOk
      ? "Não verificado porque o token não autenticou."
      : !probe.instanceFound
        ? `Instância "${instance}" não existe na Evolution.`
        : probe.state === "open"
          ? `Instância "${instance}" conectada (open).`
          : `Instância "${instance}" encontrada, porém no estado "${probe.state}" (esperado: open).`,
  });

  const remote = probe.authOk ? await findEvolutionWebhook(config) : null;
  const remoteWebhookUrlMasked = remote?.url ? maskWebhookUrlToken(remote.url) : "";
  const urlCheck = compareWebhookUrls(remote?.url ?? "", expectedUrl, tenant.slug);
  const normalizedEvents = (remote?.events ?? []).map((event) => event.toUpperCase().replace(/\./g, "_"));
  const hasMessagesUpsert = normalizedEvents.includes("MESSAGES_UPSERT");

  checks.push({
    id: "webhook_enabled",
    label: "Webhook habilitado na Evolution",
    ok: Boolean(remote?.enabled),
    detail: !probe.authOk
      ? "Não verificado porque o token não autenticou."
      : !remote
        ? "Nenhum webhook retornado pela Evolution para esta instância."
        : remote.enabled
          ? `Webhook ativo${remote.byEvents ? " (byEvents: true)" : " (byEvents: false)"}.`
          : "Webhook existe na Evolution, mas está desativado (enabled: false).",
  });

  checks.push({
    id: "webhook_url",
    label: "URL do webhook apontada para o MegaBeauty",
    ok: Boolean(remote?.enabled && urlCheck.exactMatch),
    detail: !remote?.url
      ? "Nenhuma URL configurada na Evolution. Clique em Sincronizar webhook."
      : urlCheck.exactMatch
        ? `URL corresponde exatamente ao endpoint assinado (${remoteWebhookUrlMasked}).`
        : urlCheck.sameEndpoint && !urlCheck.hasSignedToken
          ? `Aponta para o nosso domínio (${remoteWebhookUrlMasked}), mas sem o token assinado atualizado. Clique em Sincronizar webhook.`
          : `URL divergente na Evolution (${remoteWebhookUrlMasked}) — esperado: ${expectedWebhookUrlMasked}.`,
  });

  checks.push({
    id: "webhook_events",
    label: "Evento MESSAGES_UPSERT inscrito",
    ok: hasMessagesUpsert,
    detail: !remote
      ? "Sem eventos cadastrados na Evolution."
      : hasMessagesUpsert
        ? `Eventos ativos: ${remote.events.join(", ")}.`
        : `MESSAGES_UPSERT não está na lista (${remote.events.join(", ") || "vazia"}).`,
  });

  const webhookPointedCorrectly = Boolean(remote?.enabled && urlCheck.exactMatch && hasMessagesUpsert);
  const ok = Boolean(expectedUrl && localTokenValid && probe.authOk && webhookPointedCorrectly);

  const summary = !probe.authOk
    ? `Falha na autenticação do token da Evolution API (${probe.status ? `HTTP ${probe.status}` : "sem conexão"}).`
    : !webhookPointedCorrectly
      ? "Token autenticado com sucesso, mas o webhook na Evolution não está apontado corretamente para nossa URL/eventos."
      : probe.state !== "open"
        ? `Token autenticado e webhook apontado corretamente, porém a instância está em "${probe.state}".`
        : "Tudo certo: token autenticado na Evolution API e webhook de mensagens apontado corretamente para nossa URL.";

  return {
    ok,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    instance,
    evolutionOrigin,
    authOk: probe.authOk,
    authHttpStatus: probe.status,
    instanceState: probe.state,
    webhookPointedCorrectly,
    expectedWebhookUrlMasked,
    remoteWebhookUrlMasked,
    checks,
    summary,
  };
}

/**
 * Helper conveniente para execução em linha de comando ou diagnósticos por slug.
 */
export async function testEvolutionAuthAndWebhookBySlug(slug?: string): Promise<EvolutionWebhookTestReport> {
  const cleanSlug = (slug ?? "").trim();
  const tenant = cleanSlug
    ? await prisma.tenant.findUnique({ where: { slug: cleanSlug }, select: { id: true } })
    : (await prisma.tenant.findFirst({
        where: { isPlatform: false, evolutionInstance: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })) ??
      (await prisma.tenant.findFirst({
        where: { isPlatform: false },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }));

  if (!tenant) {
    throw new Error(cleanSlug ? `Salão "${cleanSlug}" não encontrado.` : "Nenhum salão cadastrado encontrado.");
  }
  return testEvolutionAuthAndWebhook(tenant.id);
}

export type EvolutionDiagnostic = {
  instance: string;
  authOk: boolean;
  authHttpStatus: number | null;
  evolutionState: "open" | "connecting" | "close" | "unreachable";
  evolutionError: string | null;
  expectedWebhookUrlMasked: string;
  remoteWebhook: {
    enabled: boolean;
    urlMasked: string;
    urlMatches: boolean;
    byEvents: boolean;
    hasMessagesUpsert: boolean;
    events: string[];
  } | null;
  receptionistEnabled: boolean;
  recentWebhooks: WebhookTraceEntry[];
  testReport: EvolutionWebhookTestReport;
};

export async function diagnoseEvolutionWhatsApp(tenantId: string): Promise<EvolutionDiagnostic> {
  const [tenant, server, receptionist, testReport] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    resolvePlatformIntegrations(),
    prisma.receptionist.findUnique({ where: { tenantId }, select: { enabled: true } }),
    testEvolutionAuthAndWebhook(tenantId),
  ]);
  if (!tenant) throw new Error("Salão não encontrado.");
  if (!server.hasEvolution) throw new Error("O servidor WhatsApp ainda não foi configurado na plataforma.");

  const instance = tenant.evolutionInstance || instanceNameForTenant(tenant.slug);
  const config = salonConfig(server, instance);
  const { webhookUrl: expectedUrl } = signedEvolutionWebhook(server, tenant);

  const remote = testReport.authOk ? await findEvolutionWebhook(config) : null;
  const urlCheck = compareWebhookUrls(remote?.url ?? "", expectedUrl, tenant.slug);
  const normalizedEvents = (remote?.events ?? []).map((e) => e.toUpperCase().replace(/\./g, "_"));
  const authCheck = testReport.checks.find((c) => c.id === "token_auth");

  return {
    instance,
    authOk: testReport.authOk,
    authHttpStatus: testReport.authHttpStatus,
    evolutionState:
      testReport.instanceState === "unknown"
        ? "unreachable"
        : testReport.instanceState,
    evolutionError: testReport.authOk ? null : authCheck?.detail ?? null,
    expectedWebhookUrlMasked: testReport.expectedWebhookUrlMasked,
    remoteWebhook: remote
      ? {
          enabled: remote.enabled,
          urlMasked: maskWebhookUrlToken(remote.url),
          urlMatches: urlCheck.exactMatch,
          byEvents: remote.byEvents,
          hasMessagesUpsert: normalizedEvents.includes("MESSAGES_UPSERT"),
          events: remote.events,
        }
      : null,
    receptionistEnabled: Boolean(receptionist?.enabled),
    recentWebhooks: listEvolutionWebhookTraces(tenant.id, tenant.slug, 8),
    testReport,
  };
}
