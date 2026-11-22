export type EvolutionConfig = {
  url: string;
  apiKey: string;
  instance: string;
};

export const EVOLUTION_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
] as const;

export type EvolutionWebhookKind = "qrcode" | "connection" | "messages-upsert" | "messages-update" | "other";

export function evolutionWebhookKind(payload: Record<string, unknown>): EvolutionWebhookKind {
  const event = String(payload.event ?? payload.type ?? "").toLowerCase().replace(/_/g, ".");
  if (event.includes("qrcode")) return "qrcode";
  if (event.includes("connection")) return "connection";
  if (event.includes("messages.update")) return "messages-update";
  if (event.includes("messages.upsert") || event.includes("messages.set")) return "messages-upsert";
  return "other";
}

function headers(apiKey: string) {
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
  };
}

function evolutionErrorMessage(json: unknown, text: string, status: number) {
  if (json && typeof json === "object" && "message" in json) {
    const value = (json as { message?: unknown }).message;
    if (typeof value === "string" && value) return value;
    if (value != null) return JSON.stringify(value).slice(0, 240);
  }
  return text.slice(0, 240) || `Evolution API ${status}`;
}

export function isEvolutionConfigured(config: Partial<EvolutionConfig> | null | undefined) {
  return Boolean(config?.url && config?.apiKey && config?.instance);
}

export async function sendPresence(
  config: EvolutionConfig,
  number: string,
  delayMs = 1200,
  options?: { wait?: boolean },
) {
  const url = `${config.url.replace(/\/$/, "")}/chat/sendPresence/${config.instance}`;
  const wait = options?.wait !== false;
  const response = await fetch(url, {
    method: "POST",
    headers: headers(config.apiKey),
    body: JSON.stringify({
      number: number.replace(/\D/g, ""),
      delay: delayMs,
      presence: "composing",
    }),
    signal: AbortSignal.timeout(wait ? Math.max(4000, delayMs + 2000) : 2500),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Evolution API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

export function evolutionRemoteJid(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function webhookData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data ?? payload;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : {};
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

export async function markMessagesAsRead(
  config: EvolutionConfig,
  messages: { phone: string; id: string }[],
) {
  const readMessages = messages
    .map((item) => ({
      remoteJid: evolutionRemoteJid(item.phone),
      fromMe: false,
      id: item.id,
    }))
    .filter((item) => item.id);
  if (!readMessages.length) return null;
  return evoFetch(config, `/chat/markMessageAsRead/${config.instance}`, {
    method: "POST",
    body: JSON.stringify({ readMessages }),
  });
}

export async function sendTextMessage(
  config: EvolutionConfig,
  number: string,
  text: string,
  options?: { delayMs?: number; presence?: boolean },
) {
  const delay = Math.max(0, options?.delayMs ?? 0);
  const digits = number.replace(/\D/g, "");
  let sendDelay = delay;
  if (options?.presence && delay) {
    try {
      await sendPresence(config, digits, delay);
      sendDelay = 0;
    } catch {
      sendDelay = delay;
    }
  }
  const url = `${config.url.replace(/\/$/, "")}/message/sendText/${config.instance}`;
  const response = await fetch(url, {
    method: "POST",
    headers: headers(config.apiKey),
    body: JSON.stringify({
      number: digits,
      text,
      ...(sendDelay ? { delay: sendDelay } : {}),
    }),
    signal: AbortSignal.timeout(Math.max(12000, sendDelay + 8000)),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Evolution API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

export async function evoFetch(config: Pick<EvolutionConfig, "url" | "apiKey">, path: string, init?: RequestInit) {
  const url = `${config.url.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(8000),
    headers: {
      ...headers(config.apiKey),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(evolutionErrorMessage(json, text, response.status));
  }
  return json;
}

export function extractQrBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const nestedRoots = [root];
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    nestedRoots.push(root.data as Record<string, unknown>);
  }
  const candidates: unknown[] = [];
  for (const node of nestedRoots) {
    candidates.push(node.base64, node.qrcode, node.qrCode);
    if (node.qrcode && typeof node.qrcode === "object") {
      const nested = node.qrcode as Record<string, unknown>;
      candidates.push(nested.base64, nested.code);
    }
    if (node.qrCode && typeof node.qrCode === "object") {
      candidates.push((node.qrCode as Record<string, unknown>).base64);
    }
  }
  for (const value of candidates) {
    if (typeof value === "string" && value.includes("base64")) return value;
    if (typeof value === "string" && value.length > 80) {
      return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
    }
  }
  return null;
}

export function parseEvolutionState(payload: unknown): "open" | "connecting" | "close" {
  if (!payload || typeof payload !== "object") return "close";
  const root = payload as Record<string, unknown>;
  const instance = (root.instance ?? root) as Record<string, unknown>;
  const raw = String(instance.state ?? instance.status ?? root.state ?? root.status ?? "").toLowerCase();
  if (raw.includes("open") || raw === "connected") return "open";
  if (raw.includes("connect") || raw.includes("qr") || raw === "pairing") return "connecting";
  return "close";
}

export function extractEvolutionNumber(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const instance = (root.instance && typeof root.instance === "object" ? root.instance : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data
    : {}) as Record<string, unknown>;
  const owner =
    instance.owner ??
    instance.wuid ??
    data.wuid ??
    data.owner ??
    root.owner ??
    root.wuid ??
    root.number ??
    root.sender;
  if (typeof owner !== "string" || !owner) return null;
  return owner.split("@")[0].split(":")[0].replace(/\D/g, "") || null;
}

export function extractEvolutionInstance(payload: Record<string, unknown>): string {
  const raw = payload.instance;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const name = (raw as Record<string, unknown>).instanceName ?? (raw as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const data = webhookData(payload);
  if (typeof data.instance === "string" && data.instance.trim()) return data.instance.trim();
  return "";
}

export async function getConnectionState(config: EvolutionConfig) {
  return evoFetch(config, `/instance/connectionState/${config.instance}`);
}

export async function createEvolutionInstance(
  server: Pick<EvolutionConfig, "url" | "apiKey">,
  params: { instance: string; webhookUrl?: string; webhookHeaders?: Record<string, string> },
) {
  return evoFetch(server, "/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: params.instance,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      groupsIgnore: true,
      ...(params.webhookUrl
        ? {
            webhook: {
              enabled: true,
              url: params.webhookUrl,
              byEvents: false,
              base64: false,
              ...(params.webhookHeaders ? { headers: params.webhookHeaders } : {}),
              events: [...EVOLUTION_WEBHOOK_EVENTS],
            },
          }
        : {}),
    }),
  });
}

export async function connectEvolutionInstance(config: EvolutionConfig) {
  return evoFetch(config, `/instance/connect/${config.instance}`);
}

/**
 * Registers the Evolution webhook supporting Evolution API v2 (`byEvents` / `webhookByEvents`,
 * with or without custom `headers`) and Evolution API v1 (flat body).
 */
export async function setEvolutionWebhook(
  config: EvolutionConfig,
  webhookUrl: string,
  options?: { headers?: Record<string, string> },
) {
  const customHeaders = options?.headers ?? {
    "x-webhook-secret": config.apiKey,
    apikey: config.apiKey,
  };
  const payloads: Record<string, unknown>[] = [
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: customHeaders,
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    },
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: customHeaders,
        webhookByEvents: false,
        webhookBase64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    },
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    },
    {
      enabled: true,
      url: webhookUrl,
      headers: customHeaders,
      webhookByEvents: false,
      webhookBase64: false,
      events: [...EVOLUTION_WEBHOOK_EVENTS],
    },
  ];

  let firstError: unknown = null;
  for (const body of payloads) {
    try {
      return await evoFetch(config, `/webhook/set/${config.instance}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  throw firstError ?? new Error("Não foi possível registrar o webhook na Evolution.");
}

export type EvolutionRemoteWebhookInfo = {
  enabled: boolean;
  url: string;
  byEvents: boolean;
  events: string[];
};

export async function findEvolutionWebhook(config: EvolutionConfig): Promise<EvolutionRemoteWebhookInfo | null> {
  try {
    const raw = await evoFetch(config, `/webhook/find/${config.instance}`, { method: "GET" });
    if (!raw || typeof raw !== "object") return null;
    const root = raw as Record<string, unknown>;
    const node = (root.webhook && typeof root.webhook === "object" ? root.webhook : root) as Record<string, unknown>;
    const events = Array.isArray(node.events)
      ? node.events.filter((item): item is string => typeof item === "string")
      : [];
    return {
      enabled: Boolean(node.enabled),
      url: typeof node.url === "string" ? node.url : "",
      byEvents: Boolean(node.byEvents ?? node.webhookByEvents),
      events,
    };
  } catch {
    return null;
  }
}

export async function resolveEvolutionLidPhone(config: EvolutionConfig, lidJid: string): Promise<string> {
  if (!lidJid || !lidJid.includes("@lid")) return "";
  try {
    const result = await evoFetch(config, `/chat/findContacts/${config.instance}`, {
      method: "POST",
      signal: AbortSignal.timeout(2500),
      body: JSON.stringify({ where: { id: lidJid } }),
    });
    const list = Array.isArray(result) ? result : result && typeof result === "object" ? [result] : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const candidates = [row.remoteJid, row.remoteJidAlt, row.jid, row.wuid, row.phone, row.number, row.id]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      const direct = candidates.find((c) => c.includes("@s.whatsapp.net"));
      if (direct) return digitsFromJid(direct);
      const numeric = candidates.find((c) => !c.includes("@lid") && /\d{10,15}/.test(c));
      if (numeric) return digitsFromJid(numeric);
    }
  } catch {
    // non-fatal fallback
  }
  return "";
}

export async function logoutEvolutionInstance(config: EvolutionConfig) {
  return evoFetch(config, `/instance/logout/${config.instance}`, { method: "DELETE" });
}

function unwrapMessageNode(raw: unknown, depth = 0): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || depth > 5) return {};
  const msg = raw as Record<string, unknown>;
  const wrappers = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage",
    "deviceSentMessage",
  ];
  for (const key of wrappers) {
    const nested = msg[key];
    if (nested && typeof nested === "object" && "message" in nested) {
      return unwrapMessageNode((nested as { message?: unknown }).message, depth + 1);
    }
  }
  const protocol = msg.protocolMessage as { editedMessage?: unknown } | undefined;
  if (protocol?.editedMessage && typeof protocol.editedMessage === "object") {
    return unwrapMessageNode(protocol.editedMessage, depth + 1);
  }
  return msg;
}

export function extractInboundText(payload: Record<string, unknown>) {
  const data = webhookData(payload);
  const message = unwrapMessageNode(data.message ?? payload.message);

  if (typeof message.conversation === "string" && message.conversation.trim()) {
    return message.conversation;
  }
  const extended = message.extendedTextMessage as { text?: string } | undefined;
  if (typeof extended?.text === "string" && extended.text.trim()) {
    return extended.text;
  }

  const image = message.imageMessage as { caption?: string } | undefined;
  if (image) return image.caption?.trim() || "[Imagem recebida]";
  const video = message.videoMessage as { caption?: string } | undefined;
  if (video) return video.caption?.trim() || "[Vídeo recebido]";
  const doc = message.documentMessage as { caption?: string; fileName?: string } | undefined;
  if (doc) return doc.caption?.trim() || (doc.fileName ? `[Documento: ${doc.fileName}]` : "[Documento recebido]");
  if (message.audioMessage) return "[Áudio recebido]";
  if (message.stickerMessage) return "[Figurinha recebida]";

  const buttons = message.buttonsResponseMessage as { selectedDisplayText?: string; selectedButtonId?: string } | undefined;
  if (buttons?.selectedDisplayText) return buttons.selectedDisplayText;
  if (buttons?.selectedButtonId) return buttons.selectedButtonId;

  const list = message.listResponseMessage as { title?: string; singleSelectReply?: { selectedRowId?: string } } | undefined;
  if (list?.title) return list.title;
  if (list?.singleSelectReply?.selectedRowId) return list.singleSelectReply.selectedRowId;

  const template = message.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined;
  if (template?.selectedDisplayText) return template.selectedDisplayText;

  if (typeof data.body === "string" && data.body.trim()) return data.body;
  if (typeof data.text === "string" && data.text.trim()) return data.text;
  return "";
}

function digitsFromJid(jid: string) {
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

export function extractRawRemoteJid(payload: Record<string, unknown>) {
  const data = webhookData(payload);
  const key = (data.key ?? payload.key ?? {}) as Record<string, unknown>;
  return String(key.remoteJid ?? data.remoteJid ?? payload.remoteJid ?? "").trim();
}

export function extractPhone(payload: Record<string, unknown>) {
  const data = webhookData(payload);
  const key = (data.key ?? payload.key ?? {}) as Record<string, unknown>;
  const primaryJid = extractRawRemoteJid(payload);
  if (
    primaryJid.includes("@g.us") ||
    primaryJid.includes("@broadcast") ||
    primaryJid.includes("@newsletter")
  ) {
    return "";
  }

  const candidates = [
    key.remoteJid,
    key.remoteJidAlt,
    key.senderPn,
    key.participant,
    data.remoteJid,
    data.remoteJidAlt,
    data.senderPn,
    data.participant,
    payload.remoteJid,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  // When WhatsApp sends a @lid JID, prefer the real phone JID (@s.whatsapp.net) if present
  const directPhoneJid = candidates.find((jid) => jid.includes("@s.whatsapp.net"));
  if (directPhoneJid) return digitsFromJid(directPhoneJid);

  if (primaryJid.includes("@lid")) {
    const fallbackNumeric = candidates.find(
      (jid) => !jid.includes("@lid") && !jid.includes("@g.us") && !jid.includes("@broadcast"),
    );
    if (fallbackNumeric) return digitsFromJid(fallbackNumeric);
  }

  return primaryJid ? digitsFromJid(primaryJid) : "";
}

export function extractEvolutionMessageId(payload: Record<string, unknown>) {
  const data = webhookData(payload);
  const key = (data.key ?? payload.key ?? {}) as Record<string, unknown>;
  const id = key.id ?? data.keyId ?? data.id;
  return typeof id === "string" && id.trim() ? id.trim() : "";
}

export function isEvolutionFromMe(payload: Record<string, unknown>) {
  const data = webhookData(payload);
  const key = (data.key ?? payload.key ?? {}) as Record<string, unknown>;
  return key.fromMe === true || data.fromMe === true;
}

export function extractWebhookMessagePayloads(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = payload.data;
  if (Array.isArray(data)) {
    return data
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({ ...payload, data: item }));
  }
  if (data && typeof data === "object" && Array.isArray((data as { messages?: unknown }).messages)) {
    const msgs = (data as { messages: unknown[] }).messages;
    return msgs
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({ ...payload, data: item }));
  }
  return [payload];
}
