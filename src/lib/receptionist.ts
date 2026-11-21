import { formatBRL } from "@/lib/money";
import { spin } from "@/lib/whatsapp-copy";
import {
  MAX_LOOKAHEAD_DAYS,
  formatAvailabilityForPrompt,
  formatAvailabilitySlots,
  formatDurationPt,
  parseExplicitDurationMin,
  parseRequestedDate,
  type AvailabilityDayResult,
  type RequestedDateMatch,
} from "@/lib/receptionist-availability";

export const RECEPTIONIST_STYLES = ["direto", "conversador"] as const;
export const RECEPTIONIST_PERSONALITIES = ["feliz", "brincalhao", "formal"] as const;
export const RECEPTIONIST_EMOJIS = ["nenhum", "moderado", "sempre"] as const;

export type ReceptionistStyle = (typeof RECEPTIONIST_STYLES)[number];
export type ReceptionistPersonality = (typeof RECEPTIONIST_PERSONALITIES)[number];
export type ReceptionistEmoji = (typeof RECEPTIONIST_EMOJIS)[number];

export type ReceptionistConfig = {
  enabled: boolean;
  name: string;
  avatarUrl: string | null;
  style: ReceptionistStyle;
  personality: ReceptionistPersonality;
  emoji: ReceptionistEmoji;
  instructions: string;
};

export const RECEPTIONIST_PRESETS = [
  { id: "luna", label: "Luna", color: "#7C3AED" },
  { id: "maya", label: "Maya", color: "#DB2777" },
  { id: "sofia", label: "Sofia", color: "#0F766E" },
  { id: "valentina", label: "Valentina", color: "#C2410C" },
] as const;

export type ReceptionistPresetId = (typeof RECEPTIONIST_PRESETS)[number]["id"];

export const DEFAULT_RECEPTIONIST: ReceptionistConfig = {
  enabled: false,
  name: "Luna",
  avatarUrl: "preset:luna",
  style: "conversador",
  personality: "feliz",
  emoji: "moderado",
  instructions: "",
};

export type ReceptionistCatalog = {
  salon: string;
  city: string | null;
  hours: string;
  todayDate?: string;
  todayLabel?: string;
  slotMinutes?: number;
  services: { name: string; durationMin: number; price: string; professionals: string[] }[];
  professionals: { name: string; nickname: string | null; specialty: string | null; today: string[]; tomorrow: string[] }[];
};

export type ReceptionistHistoryItem = { role: "user" | "assistant"; text: string };

export type ReceptionistAvailabilityIntent = {
  asksForSlots: boolean;
  asksForPrices: boolean;
  dateMatch: RequestedDateMatch | null;
  service: ReceptionistCatalog["services"][number] | null;
  professional: ReceptionistCatalog["professionals"][number] | null;
  explicitDurationMin: number | null;
};

export function isReceptionistStyle(value: string): value is ReceptionistStyle {
  return RECEPTIONIST_STYLES.includes(value as ReceptionistStyle);
}

export function isReceptionistPersonality(value: string): value is ReceptionistPersonality {
  return RECEPTIONIST_PERSONALITIES.includes(value as ReceptionistPersonality);
}

export function isReceptionistEmoji(value: string): value is ReceptionistEmoji {
  return RECEPTIONIST_EMOJIS.includes(value as ReceptionistEmoji);
}

export function receptionistPreset(id: string) {
  return RECEPTIONIST_PRESETS.find((item) => item.id === id) ?? null;
}

export function receptionistPresetId(avatarUrl: string | null | undefined) {
  if (!avatarUrl?.startsWith("preset:")) return null;
  return receptionistPreset(avatarUrl.slice("preset:".length))?.id ?? null;
}

export function normalizeReceptionist(
  input?: Partial<{
    enabled: boolean;
    name: string;
    avatarUrl: string | null;
    style: string;
    personality: string;
    emoji: string;
    instructions: string;
  }> | null,
): ReceptionistConfig {
  const name = String(input?.name ?? DEFAULT_RECEPTIONIST.name).trim() || DEFAULT_RECEPTIONIST.name;
  return {
    enabled: input?.enabled === true,
    name: name.slice(0, 40),
    avatarUrl: input?.avatarUrl || DEFAULT_RECEPTIONIST.avatarUrl,
    style: input?.style && isReceptionistStyle(input.style) ? input.style : DEFAULT_RECEPTIONIST.style,
    personality:
      input?.personality && isReceptionistPersonality(input.personality)
        ? input.personality
        : DEFAULT_RECEPTIONIST.personality,
    emoji: input?.emoji && isReceptionistEmoji(input.emoji) ? input.emoji : DEFAULT_RECEPTIONIST.emoji,
    instructions: String(input?.instructions ?? "").trim().slice(0, 500),
  };
}

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function wantsHumanHandover(text: string) {
  return /(falar com (alguem|atendente|recepcao|humano|pessoa)|atendente humana|quero .{0,24}pessoa|chama(r)? (a )?recepcao|nao (e|eh) robot?|nao (e|eh) ia|pessoa de verdade)/.test(
    fold(text),
  );
}

export function asksAvailability(text: string) {
  const q = fold(text);
  if (/(horario|horarios|agenda|vaga|vagas|encaixe|disponivel|disponibilidade|livre|livres|marcar|agendar|hoje|amanha|semana que vem|proxima semana)/.test(q)) {
    return true;
  }
  return parseRequestedDate(text) !== null;
}

export function asksPrices(text: string) {
  return /(preco|precos|valor|valores|quanto (custa|fica|e|eh)|tabela|servico|servicos)/.test(fold(text));
}

export function matchCatalogService(text: string, services: ReceptionistCatalog["services"]) {
  const q = fold(text);
  const sorted = services.slice().sort((a, b) => b.name.length - a.name.length);
  return sorted.find((service) => fold(service.name).length >= 3 && q.includes(fold(service.name))) ?? null;
}

export function matchCatalogProfessional(text: string, professionals: ReceptionistCatalog["professionals"]) {
  const q = fold(text);
  const sorted = professionals.slice().sort((a, b) => b.name.length - a.name.length);
  return (
    sorted.find((row) => {
      const name = fold(row.name);
      const first = name.split(" ")[0] ?? "";
      const nick = fold(row.nickname ?? "");
      return (
        (name.length >= 3 && q.includes(name)) ||
        (first.length >= 3 && q.includes(first)) ||
        (nick.length >= 3 && q.includes(nick))
      );
    }) ?? null
  );
}

/**
 * Extracts target date, service, professional, and duration from the incoming message,
 * falling back to recent client turns in `history` so follow-ups like "e dia 28?" preserve
 * the previously requested service (e.g., a 3-hour procedure).
 */
export function resolveAvailabilityIntentFromMessages(input: {
  incoming: string;
  history?: ReceptionistHistoryItem[];
  catalog: ReceptionistCatalog;
  referenceDate?: string;
}): ReceptionistAvailabilityIntent {
  const refDate = input.referenceDate ?? input.catalog.todayDate;
  const incomingDate = parseRequestedDate(input.incoming, refDate);
  let service = matchCatalogService(input.incoming, input.catalog.services);
  let professional = matchCatalogProfessional(input.incoming, input.catalog.professionals);
  let explicitDurationMin = parseExplicitDurationMin(input.incoming);
  let dateMatch = incomingDate;

  const asksForSlots = asksAvailability(input.incoming) || incomingDate !== null;
  const asksForPrices = asksPrices(input.incoming);

  const recentUserMessages = (input.history ?? [])
    .filter((item) => item.role === "user" && item.text.trim())
    .slice(-4)
    .reverse();

  // Only inherit context from prior turns when the current turn is clearly continuing a scheduling query
  if (asksForSlots || service || professional || explicitDurationMin) {
    for (const msg of recentUserMessages) {
      if (!service) {
        service = matchCatalogService(msg.text, input.catalog.services);
      }
      if (!professional) {
        professional = matchCatalogProfessional(msg.text, input.catalog.professionals);
      }
      if (!explicitDurationMin && !service) {
        explicitDurationMin = parseExplicitDurationMin(msg.text);
      }
      if (!dateMatch && (service || professional) && !asksForPrices) {
        dateMatch = parseRequestedDate(msg.text, refDate);
      }
    }
  }

  return {
    asksForSlots,
    asksForPrices,
    dateMatch,
    service,
    professional,
    explicitDurationMin,
  };
}

export function styleLabel(style: ReceptionistStyle) {
  return style === "direto" ? "Objetiva e direta" : "Conversadora";
}

export function personalityLabel(personality: ReceptionistPersonality) {
  if (personality === "brincalhao") return "Brincalhona";
  if (personality === "formal") return "Formal e respeitosa";
  return "Feliz e educada";
}

export function emojiLabel(emoji: ReceptionistEmoji) {
  if (emoji === "nenhum") return "Sem emojis";
  if (emoji === "sempre") return "Sempre usar emojis";
  return "Uso moderado";
}

export function buildReceptionistSystemPrompt(
  config: ReceptionistConfig,
  catalog: ReceptionistCatalog,
  availability?: AvailabilityDayResult | null,
) {
  const emojiRule =
    config.emoji === "nenhum"
      ? "Não use emojis."
      : config.emoji === "sempre"
        ? "Use um ou dois emojis por mensagem."
        : "No máximo um emoji, só se ficar natural.";
  const extra = config.instructions ? `Instruções do salão: ${config.instructions}` : "";
  const todayLine = catalog.todayDate
    ? `Data de hoje: ${catalog.todayLabel ? `${catalog.todayLabel} ` : ""}(${catalog.todayDate}). Você pode consultar qualquer data até ${MAX_LOOKAHEAD_DAYS} dias à frente.`
    : "";
  const availabilityBlock = availability ? `\n${formatAvailabilityForPrompt(availability)}` : "";
  return [
    `Você é ${config.name}, recepcionista virtual do salão ${catalog.salon}.`,
    `Estilo: ${styleLabel(config.style)}. Personalidade: ${personalityLabel(config.personality)}. ${emojiRule}`,
    todayLine,
    "Fale em português brasileiro, curto, como WhatsApp. No máximo 4 frases.",
    "Varie as palavras a cada resposta. Não copie a mensagem anterior da conversa.",
    "Só responda porque a cliente escreveu agora. Não comece conversa nem faça propaganda sozinha.",
    "Nunca invente horário, preço ou profissional. Use só o catálogo abaixo e a ferramenta check_availability.",
    "Quando a cliente perguntar sobre qualquer data específica (incluindo dias da semana, semana que vem, dia do mês) ou sobre um serviço com duração específica (especialmente procedimentos longos como 2h ou 3h), consulte check_availability com a data exata e o serviço para validar encaixe contínuo real.",
    "Os horários retornados por check_availability são horários de INÍCIO onde o procedimento cabe inteiro sem conflito.",
    "Nunca confirme, crie ou altere agendamento. Se a cliente quiser marcar, ofereça horários reais e diga que a recepção confirma.",
    "Não revele dados de outras clientes, faturamento, estoque ou informações internas.",
    "Se pedirem uma pessoa da equipe, diga que vai chamar a recepção.",
    extra,
    "",
    "Catálogo:",
    formatReceptionistCatalog(catalog),
    availabilityBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatReceptionistCatalog(catalog: ReceptionistCatalog) {
  const slotMinutes = catalog.slotMinutes ?? 15;
  const services = catalog.services.length
    ? catalog.services
        .slice(0, 24)
        .map((row) => {
          const who = row.professionals.length ? ` · ${row.professionals.join(", ")}` : "";
          return `- ${row.name}: ${row.price}, ${row.durationMin} min${who}`;
        })
        .join("\n")
    : "- nenhum serviço ativo";
  const team = catalog.professionals.length
    ? catalog.professionals
        .map((row) => {
          const today = row.today.length
            ? `hoje ${formatAvailabilitySlots(row.today, slotMinutes)}`
            : "hoje sem vaga";
          const tomorrow = row.tomorrow.length
            ? `amanhã ${formatAvailabilitySlots(row.tomorrow, slotMinutes)}`
            : "amanhã sem vaga";
          const specialty = row.specialty ? ` (${row.specialty})` : "";
          return `- ${row.name}${specialty}: ${today}; ${tomorrow}`;
        })
        .join("\n")
    : "- nenhuma profissional ativa";
  return [
    `Salão: ${catalog.salon}${catalog.city ? ` · ${catalog.city}` : ""}`,
    `Horário: ${catalog.hours}`,
    "Serviços:",
    services,
    "Profissionais e resumo de horários livres (hoje e amanhã — use check_availability para outras datas ou encaixe exato por duração):",
    team,
  ].join("\n");
}

export function formatServicePrice(priceCents: number) {
  return formatBRL(priceCents);
}

export function handoverReply(config: ReceptionistConfig) {
  const emoji = config.emoji === "nenhum" ? "" : " 💛";
  return spin(`{Claro|Pronto|Beleza}. Vou chamar alguém da equipe do salão para continuar com você.${emoji}`);
}

function formatComputedAvailabilityReply(availability: AvailabilityDayResult, emoji: string) {
  if (availability.isPast) {
    return spin(
      `Essa data (${availability.label}) já passou.${emoji} Me fala um dia a partir de hoje que eu verifico os horários livres para você.`,
    );
  }
  if (availability.outOfRange) {
    return spin(
      `Por aqui eu consigo consultar a agenda de hoje até ${MAX_LOOKAHEAD_DAYS} dias à frente.${emoji} Para datas mais distantes, posso chamar a recepção para te ajudar.`,
    );
  }

  const durationLabel = formatDurationPt(availability.durationMin);
  const servicePhrase = availability.serviceName
    ? `para ${availability.serviceName} (${durationLabel})`
    : `com bloco contínuo de ${durationLabel}`;

  if (!availability.professionals.length) {
    return spin(
      `Não encontrei profissional ativa para atender ${servicePhrase}.${emoji} Posso chamar a recepção para conferir para você.`,
    );
  }

  const available = availability.professionals.filter((row) => row.startTimes.length > 0);
  if (!available.length) {
    const who = availability.professionals.map((row) => row.name).slice(0, 3).join(", ");
    return spin(
      `Em ${availability.label} não há encaixe contínuo ${servicePhrase} com ${who}.${emoji} Quer que eu olhe outra data para você?`,
    );
  }

  const details = available
    .slice(0, 3)
    .map((row) => `${row.name} (${row.summary})`)
    .join("; ");

  return spin(
    `Em ${availability.label}, ${servicePhrase}, tenho horários de início com ${details}.${emoji} Eu não marco sozinha: {se algum encaixar|se algum desses servir}, a recepção confirma para você.`,
  );
}

export function localReceptionistReply(input: {
  config: ReceptionistConfig;
  catalog: ReceptionistCatalog;
  incoming: string;
  availability?: AvailabilityDayResult | null;
}) {
  const { config, catalog, incoming, availability: computedAvailability } = input;
  if (wantsHumanHandover(incoming)) return { text: handoverReply(config), handover: true };

  const service = matchCatalogService(incoming, catalog.services);
  const professional = matchCatalogProfessional(incoming, catalog.professionals);
  const price = asksPrices(incoming);
  const availability = asksAvailability(incoming);
  const first = incoming.trim().length < 18 && /^(oi|ola|olá|bom dia|boa tarde|boa noite|hey|eai|e ai)/i.test(incoming.trim());
  const emoji = config.emoji === "nenhum" ? "" : config.emoji === "sempre" ? " ✨" : " 💛";

  if (first && !service && !professional && !price && !availability && !computedAvailability) {
    return {
      text: spin(
        `{Oi|Olá|Oi oi}! Sou a ${config.name}, recepcionista do ${catalog.salon}.${emoji} {Posso falar|Consigo te ajudar} de serviços, valores e horários livres. O que você procura?`,
      ),
      handover: false,
    };
  }

  if (service && price && !availability && !computedAvailability) {
    const who = service.professionals.length ? ` Com ${service.professionals.join(" ou ")}.` : "";
    return {
      text: spin(
        `${service.name} {fica|sai por} ${service.price} e leva cerca de ${service.durationMin} minutos.${who}${emoji} {Se quiser|Se fizer sentido}, eu vejo os horários livres para a recepção confirmar.`,
      ),
      handover: false,
    };
  }

  if (computedAvailability && (availability || computedAvailability.isPast || computedAvailability.outOfRange || !price)) {
    return {
      text: formatComputedAvailabilityReply(computedAvailability, emoji),
      handover: false,
    };
  }

  if (service && (price || !availability)) {
    const who = service.professionals.length ? ` Com ${service.professionals.join(" ou ")}.` : "";
    return {
      text: spin(
        `${service.name} {fica|sai por} ${service.price} e leva cerca de ${service.durationMin} minutos.${who}${emoji} {Se quiser|Se fizer sentido}, eu vejo os horários livres para a recepção confirmar.`,
      ),
      handover: false,
    };
  }

  if (availability || professional || service) {
    const slotMinutes = catalog.slotMinutes ?? 15;
    const row = professional ?? catalog.professionals[0];
    if (!row) {
      return {
        text: spin(
          `{Ainda não tenho|Não achei} profissionais ativas no cadastro para consultar horário. Posso chamar a recepção para te ajudar.`,
        ),
        handover: false,
      };
    }
    const slots = row.today.length
      ? `hoje: ${formatAvailabilitySlots(row.today, slotMinutes)}`
      : row.tomorrow.length
        ? `amanhã: ${formatAvailabilitySlots(row.tomorrow, slotMinutes)}`
        : "sem vaga hoje ou amanhã na grade";
    const who = professional ? row.name : catalog.professionals.map((item) => item.name).slice(0, 3).join(", ");
    return {
      text: spin(
        `${who} tem horário ${slots}.${emoji} Eu não marco sozinha: {se algum encaixar|se algum desses servir}, a recepção confirma para você.`,
      ),
      handover: false,
    };
  }

  if (price) {
    const top = catalog.services.slice(0, 4).map((row) => `${row.name} ${row.price}`).join(", ");
    return {
      text: top
        ? spin(`{Alguns valores|Valores de referência}: ${top}.${emoji} Quer que eu veja horário de algum desses?`)
        : spin(`Ainda não tenho a tabela de serviços cadastrada. Posso chamar a recepção.`),
      handover: false,
    };
  }

  return {
    text: spin(
      `{Posso te ajudar|Consigo te orientar} com serviços, valores e horários livres do ${catalog.salon}.${emoji} Me diz o que você quer fazer e se tem preferência de profissional.`,
    ),
    handover: false,
  };
}

