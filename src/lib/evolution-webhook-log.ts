export type WebhookTraceEntry = {
  at: string;
  tenantId: string | null;
  slug: string | null;
  instance: string | null;
  event: string;
  httpStatus: number;
  outcome: string;
  phoneSuffix: string | null;
};

const MAX_ENTRIES = 40;

const globalStore = globalThis as unknown as {
  __mbEvolutionWebhookLog?: WebhookTraceEntry[];
};

function store(): WebhookTraceEntry[] {
  if (!globalStore.__mbEvolutionWebhookLog) {
    globalStore.__mbEvolutionWebhookLog = [];
  }
  return globalStore.__mbEvolutionWebhookLog;
}

export function recordEvolutionWebhookTrace(entry: Omit<WebhookTraceEntry, "at">) {
  const list = store();
  list.unshift({
    ...entry,
    at: new Date().toISOString(),
  });
  if (list.length > MAX_ENTRIES) {
    list.length = MAX_ENTRIES;
  }
}

export function listEvolutionWebhookTraces(tenantId: string, slug?: string | null, limit = 8): WebhookTraceEntry[] {
  const cleanSlug = (slug ?? "").trim().toLowerCase();
  return store()
    .filter((entry) => {
      if (entry.tenantId && entry.tenantId === tenantId) return true;
      if (!entry.tenantId && cleanSlug && entry.slug?.toLowerCase() === cleanSlug) return true;
      return false;
    })
    .slice(0, limit);
}

export function maskWebhookUrlToken(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      const tok = parsed.searchParams.get("token") ?? "";
      parsed.searchParams.set("token", tok.length > 6 ? `${tok.slice(0, 4)}••••${tok.slice(-2)}` : "••••");
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&]token=)[^&]+/i, "$1••••");
  }
}
