import { formatBRL } from "@/lib/money";
import { spin } from "@/lib/whatsapp-copy";
import {
  MAX_LOOKAHEAD_DAYS,
  formatAvailabilityForPrompt,
  formatAvailabilitySlots,
  formatDurationPt,
  parseExplicitDurationMin,
  parseRequestedDate,
  parseRequestedTime,
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
  nowHHmm?: string;
  slotMinutes?: number;
  services: { name: string; durationMin: number; price: string; professionals: string[] }[];
  professionals: {
    name: string;
    nickname: string | null;
    specialty: string | null;
    services?: string[];
    today: string[];
    tomorrow: string[];
  }[];
};

export type ReceptionistHistoryItem = { role: "user" | "assistant"; text: string };

export type ClientUpcomingAppointment = {
  id: string;
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  professionalName: string;
  serviceNames: string[];
  status: string;
  statusLabel: string;
};

export type ReceptionistAvailabilityIntent = {
  asksForSlots: boolean;
  asksForPrices: boolean;
  asksOwnAppointments: boolean;
  dateMatch: RequestedDateMatch | null;
  requestedTime: string | null;
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

/**
 * Detects requests to cancel, reschedule, swap, or modify an existing appointment.
 * These actions are intentionally NOT allowed for the AI and must be handed over to a human.
 */
export function wantsCancelOrReschedule(text: string) {
  const q = fold(text);
  return /(cancel(a|ar|o|amento)|desmarc(a|ar|o)|remarc(a|ar|o)|reagend(a|ar|o)|adi(a|ar|o)\s+(o\s+|meu\s+)?(horario|agendamento)|antecip(a|ar|o)\s+(o\s+|meu\s+)?(horario|agendamento)|(troc(a|ar)|mud(a|ar)|alter(a|ar))\s+(o\s+|a\s+|de\s+|meu\s+|minha\s+)?(horario|agendamento|dia|data|profissional|servico|reserva)|passar\s+(o\s+|meu\s+)?(horario|agendamento)\s+para|nao\s+vou\s+(conseguir|poder)\s+(ir|comparecer)|preciso\s+(cancelar|desmarcar|remarcar|reagendar|trocar|mudar)\b)/.test(
    q,
  );
}

export function asksAvailability(text: string) {
  const q = fold(text);
  if (/(horario|horarios|agenda|vaga|vagas|encaixe|disponivel|disponibilidade|livre|livres|marcar|agendar|hoje|amanha|semana que vem|proxima semana)/.test(q)) {
    return true;
  }
  return parseRequestedDate(text) !== null || parseRequestedTime(text) !== null;
}

export function asksPrices(text: string) {
  return /(preco|precos|valor|valores|quanto (custa|fica|e|eh)|tabela|servico|servicos)/.test(fold(text));
}

/**
 * Detects when the client is asking to check/verify their OWN existing appointments
 * (e.g., "qual meu horário hoje?", "quando seria meu agendamento?", "tenho horário marcado?").
 */
export function asksOwnAppointments(text: string): boolean {
  const q = fold(text);
  if (!q) return false;
  if (
    /\b(quero|pode|gostaria de|preciso)?\s*(agend(ar|e|a)|marc(ar|a|ue))\b/.test(q) &&
    !/\b(ver|verific|confer|saber|qual|quando|que horas|ja\s+(esta|ta|estou|foi))\b/.test(q)
  ) {
    return false;
  }
  return /(qual\s+(e|eh|era|seria|fica|ficou)?\s*(o\s+)?meu\s+(horario|agendamento|atendimento)|que\s+horas?\s+(e|eh|era|seria|fica|ficou|esta|ta)\s+(o\s+)?meu\s+(horario|agendamento|atendimento)|quando\s+(e|eh|era|seria|fica|ficou|esta|ta)\s+(o\s+)?meu\s+(horario|agendamento|atendimento)|qual\s+dia\s+(e|eh|fica|ficou|esta|ta)\s+(o\s+)?meu\s+(horario|agendamento)|(ver|verific(ar|a|ue)|confer(ir|e)|consult(ar|a|e)|chec(ar|a|ue)|saber|olh(ar|a|e)|confirm(ar|a))\s+(qual\s+(e|eh|seria|ficou)?\s*)?(o\s+|os\s+)?meus?\s+(horarios?|agendamentos?|atendimentos?)|quais\s+(sao\s+)?(os\s+)?meus?\s+(horarios?|agendamentos?)|tenho\s+(algum\s+)?(horario|agendamento)(\s+marcad[oa]|\s+hoje|\s+amanha|\s+essa\s+semana|\s+esta\s+semana)?|ja\s+(estou|to|esta|ta)\s+(agendad|marcad)[oa]|meu\s+(horario|agendamento)\s+(de\s+)?(hoje|amanha|essa\s+semana|esta\s+semana))/.test(
    q,
  );
}

export function formatClientAppointmentsForPrompt(
  appointments: ClientUpcomingAppointment[],
  todayDate?: string,
): string {
  if (!appointments.length) {
    return "Agendamentos futuros DESTA cliente (somente desta cliente): nenhum agendamento futuro encontrado para este telefone.";
  }
  const lines = appointments.map((appt) => {
    const dayTag = todayDate && appt.date === todayDate ? `HOJE (${appt.dateLabel} · ${appt.date})` : `${appt.dateLabel} (${appt.date})`;
    const svc = appt.serviceNames.length ? appt.serviceNames.join(" + ") : "Atendimento";
    const statusHint =
      appt.status === "AI_BOOKED"
        ? "Agendado pela IA (aguardando conferência da equipe)"
        : appt.statusLabel;
    return `- ${dayTag} das ${appt.startTime} às ${appt.endTime} · ${svc} com ${appt.professionalName} · Status: ${statusHint}`;
  });
  return [
    "Agendamentos futuros DESTA cliente (somente desta cliente — use esta lista quando ela perguntar qual é ou quando é o horário dela; NUNCA diga que o horário dela está 'indisponível'):",
    ...lines,
  ].join("\n");
}

export function looksLikeBookingConfirmationClaim(text: string): boolean {
  const q = fold(text);
  if (!q) return false;
  // Ignore pure questions asking the client if they want to confirm/book
  if (
    /(gostaria de confirmar|quer (que eu )?(confirmar|agendar|marcar|registrar)|deseja (confirmar|agendar|marcar)|posso (confirmar|agendar|marcar|registrar))/.test(
      q,
    )
  ) {
    return false;
  }
  return /(vou (registrar|agendar|marcar|reservar|anotar|confirmar) (o |a |seu |sua |esse |este )?(agendamento|horario|reserva|sessao)|estou (registrando|agendando|marcando|reservando)|(agendamento|horario|reserva) (foi |esta |ta |ficou )?(registrad|criad|confirmad|agendad|marcad|feit|realizad|garantid)[oa]|\b(agendamento|horario|reserva)\b[^?.!]{0,90}\b(foi|ficou)\s+(registrad|criad|confirmad|agendad|marcad|feit|realizad|garantid)[oa]|(agendei|marquei|registrei|reservei|anotei) (o |a |seu |sua |esse |para )?(agendamento|horario|manicure|pedicure|corte|escova|servico|voce|com\b)|ficou (agendad|marcad|registrad|reservad)[oa]|(esta|ta) (agendad|marcad|registrad|reservad)[oa])/.test(
    q,
  );
}

/**
 * Returns only the turns AFTER the last completed booking confirmation in history,
 * preventing services/times/professionals from a previous finished booking from leaking
 * into a brand new booking request.
 */
export function sliceActiveBookingHistory(history?: ReceptionistHistoryItem[]): ReceptionistHistoryItem[] {
  if (!history?.length) return [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "assistant" && looksLikeBookingConfirmationClaim(history[i].text)) {
      return history.slice(i + 1);
    }
  }
  return history;
}

export function isAffirmativeBookingReply(text: string): boolean {
  const q = fold(text);
  if (!q) return false;
  if (/\b(nao|nunca|prefiro\s+outro|prefiro\s+outra|outro\s+servico|outra\s+coisa)\b/.test(q)) {
    return false;
  }
  return /(^|\b)(sim|pode(\s+(ser|agendar|marcar|confirmar|fazer))?|quero|isso|esse|essa|claro|fechado|combinado|confirmo|confirmado|ok|beleza|bora|perfeito|com\s+certeza|ta\s+bom|tudo\s+bem|por\s+favor)(\b|$)/.test(
    q,
  );
}

const SERVICE_TOKEN_STOPWORDS = new Set([
  "para",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "com",
  "sem",
  "mais",
  "hoje",
  "amanha",
  "hora",
  "horas",
  "tarde",
  "manha",
  "noite",
  "quero",
  "pode",
  "agendar",
  "agende",
  "marcar",
  "marque",
  "horario",
  "horarios",
  "fazer",
  "atendimento",
  "servico",
  "servicos",
  "simples",
  "completa",
  "completo",
  "tradicional",
  "feminino",
  "feminina",
  "masculino",
  "masculina",
  "express",
]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMentionsCatalogService(
  text: string,
  target: ReceptionistCatalog["services"][number],
  allServices: ReceptionistCatalog["services"],
): boolean {
  const q = fold(text);
  const name = fold(target.name);
  if (!q || !name) return false;
  if (name.length >= 3 && q.includes(name)) return true;
  if (matchCatalogService(text, allServices)?.name === target.name) return true;

  // Match distinctive whole-word tokens from multi-word service names (e.g., "limpeza" for "Limpeza de Pele")
  const tokens = name
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !SERVICE_TOKEN_STOPWORDS.has(token));
  for (const token of tokens) {
    if (new RegExp(`\\b${escapeRegex(token)}\\b`).test(q)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the professional explicitly requested by the client in the current active booking window
 * (prioritizing the current incoming message over older turns).
 */
export function findActiveRequestedProfessional(input: {
  incoming: string;
  history?: ReceptionistHistoryItem[];
  professionals: ReceptionistCatalog["professionals"];
}) {
  const fromIncoming = matchCatalogProfessional(input.incoming, input.professionals);
  if (fromIncoming) return fromIncoming;

  const activeHistory = sliceActiveBookingHistory(input.history);
  for (let i = activeHistory.length - 1; i >= 0; i -= 1) {
    const item = activeHistory[i];
    if (item.role !== "user") continue;
    const match = matchCatalogProfessional(item.text, input.professionals);
    if (match) return match;
  }
  return null;
}

/**
 * Verifies that the client actually mentioned or affirmatively confirmed `serviceName`
 * in the active booking window (after any prior completed booking), preventing the AI
 * from guessing a service or reusing a service from an earlier booking/professional.
 */
export function hasClientConfirmedServiceInTurn(input: {
  serviceName: string;
  incoming: string;
  history?: ReceptionistHistoryItem[];
  catalogServices: ReceptionistCatalog["services"];
  professionals?: ReceptionistCatalog["professionals"];
  activeProfessionalName?: string | null;
}): boolean {
  const target = matchCatalogService(input.serviceName, input.catalogServices);
  if (!target) return false;

  if (textMentionsCatalogService(input.incoming, target, input.catalogServices)) {
    return true;
  }

  const activeHistory = sliceActiveBookingHistory(input.history);
  const lastAssistant = [...activeHistory].reverse().find((item) => item.role === "assistant");
  const incomingProf = input.professionals?.length
    ? matchCatalogProfessional(input.incoming, input.professionals)
    : null;

  // Client replied affirmatively ("sim", "pode ser", "quero") after assistant proposed this service
  if (lastAssistant && isAffirmativeBookingReply(input.incoming)) {
    if (textMentionsCatalogService(lastAssistant.text, target, input.catalogServices)) {
      return true;
    }
  }

  // Client picked a professional offered by the assistant for this service (e.g. "Com a Aline então")
  if (lastAssistant && incomingProf && input.professionals?.length) {
    const assistantMentionsService = textMentionsCatalogService(lastAssistant.text, target, input.catalogServices);
    const assistantMentionsProf = matchCatalogProfessional(lastAssistant.text, [incomingProf]) !== null;
    if (assistantMentionsService && assistantMentionsProf) {
      return true;
    }
  }

  // Check prior user turns in the active window without crossing a switch from a different professional
  const targetProfName = incomingProf?.name ?? input.activeProfessionalName ?? null;
  for (let i = activeHistory.length - 1; i >= 0; i -= 1) {
    const item = activeHistory[i];
    if (item.role !== "user") continue;
    if (targetProfName && input.professionals?.length) {
      const msgProf = matchCatalogProfessional(item.text, input.professionals);
      if (msgProf && msgProf.name !== targetProfName) {
        break;
      }
    }
    if (textMentionsCatalogService(item.text, target, input.catalogServices)) {
      return true;
    }
  }

  return false;
}

export function matchCatalogService(text: string, services: ReceptionistCatalog["services"]) {
  const q = fold(text);
  if (!q) return null;
  const exact = services.find((service) => fold(service.name) === q);
  if (exact) return exact;
  const sorted = services.slice().sort((a, b) => b.name.length - a.name.length);
  const fullInText = sorted.find((service) => fold(service.name).length >= 3 && q.includes(fold(service.name)));
  if (fullInText) return fullInText;
  // Concise tool/service query (e.g., "manicure" matching unique catalog item "Manicure Tradicional")
  if (q.length >= 3 && q.split(/\s+/).length <= 4) {
    const partialMatches = services.filter((service) => fold(service.name).includes(q));
    if (partialMatches.length === 1) return partialMatches[0];
  }
  return null;
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
 * falling back to recent client turns in the active booking window (never across a completed
 * booking confirmation and never inheriting an incompatible service from another professional).
 */
export function resolveAvailabilityIntentFromMessages(input: {
  incoming: string;
  history?: ReceptionistHistoryItem[];
  catalog: ReceptionistCatalog;
  referenceDate?: string;
}): ReceptionistAvailabilityIntent {
  const refDate = input.referenceDate ?? input.catalog.todayDate;
  const incomingDate = parseRequestedDate(input.incoming, refDate);
  const incomingTime = parseRequestedTime(input.incoming);
  const incomingProf = matchCatalogProfessional(input.incoming, input.catalog.professionals);
  let service = matchCatalogService(input.incoming, input.catalog.services);
  let professional = incomingProf;
  let explicitDurationMin = parseExplicitDurationMin(input.incoming);
  let dateMatch = incomingDate;
  let requestedTime = incomingTime;

  const asksOwn = asksOwnAppointments(input.incoming);
  const asksForSlots = !asksOwn && (asksAvailability(input.incoming) || incomingDate !== null || incomingTime !== null);
  const asksForPrices = asksPrices(input.incoming);

  const activeHistory = sliceActiveBookingHistory(input.history);
  const recentUserMessages = activeHistory
    .filter((item) => item.role === "user" && item.text.trim())
    .slice(-4)
    .reverse();

  // Only inherit context from prior turns when the current turn is clearly continuing a scheduling query
  if (!asksOwn && (asksForSlots || service || professional || explicitDurationMin)) {
    for (const msg of recentUserMessages) {
      const msgProf = matchCatalogProfessional(msg.text, input.catalog.professionals);
      const switchedProfessional = Boolean(incomingProf && msgProf && msgProf.name !== incomingProf.name);

      if (!service && !switchedProfessional) {
        const candidateService = matchCatalogService(msg.text, input.catalog.services);
        if (candidateService) {
          const allowedByIncomingProf =
            !incomingProf?.services?.length ||
            incomingProf.services.some((allowed) => fold(allowed) === fold(candidateService.name));
          if (allowedByIncomingProf) {
            service = candidateService;
          }
        }
      }
      if (!professional) {
        professional = msgProf;
      }
      if (!explicitDurationMin && !service && !switchedProfessional) {
        explicitDurationMin = parseExplicitDurationMin(msg.text);
      }
      if (!dateMatch && (service || professional || requestedTime) && !asksForPrices) {
        dateMatch = parseRequestedDate(msg.text, refDate);
      }
      if (!requestedTime && (incomingDate || professional || service) && !asksForPrices) {
        requestedTime = parseRequestedTime(msg.text);
      }
    }
  }

  return {
    asksForSlots,
    asksForPrices,
    asksOwnAppointments: asksOwn,
    dateMatch,
    requestedTime,
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
  options?: {
    bookingMode?: "live" | "simulate" | "off";
    knownClientName?: string | null;
    clientAppointments?: ClientUpcomingAppointment[] | null;
  },
) {
  const bookingMode = options?.bookingMode ?? "live";
  const emojiRule =
    config.emoji === "nenhum"
      ? "Não use emojis."
      : config.emoji === "sempre"
        ? "Use um ou dois emojis por mensagem."
        : "No máximo um emoji, só se ficar natural.";
  const extra = config.instructions ? `Instruções do salão: ${config.instructions}` : "";
  const todayLine = catalog.todayDate
    ? `Data de hoje: ${catalog.todayLabel ? `${catalog.todayLabel} ` : ""}(${catalog.todayDate})${catalog.nowHHmm ? ` · Horário atual agora no salão: ${catalog.nowHHmm}` : ""}. Você pode consultar qualquer data até ${MAX_LOOKAHEAD_DAYS} dias à frente.`
    : "";
  const clientLine =
    bookingMode !== "off"
      ? options?.knownClientName
        ? `Cliente identificada no cadastro: ${options.knownClientName} (não precisa pedir o nome dela novamente).`
        : "Cliente ainda sem nome cadastrado: peça o nome dela antes de finalizar o agendamento."
      : "";
  const bookingRule =
    bookingMode === "off"
      ? "Você não cria agendamentos automaticamente neste modo; ofereça horários reais e diga que a recepção confirma."
      : bookingMode === "simulate"
        ? "Você PODE agendar novos horários usando a ferramenta create_appointment (neste ambiente de teste o sistema apenas simula e não grava na agenda real). REGRA OBRIGATÓRIA: NUNCA diga que agendou, marcou ou vai registrar sem ANTES chamar create_appointment nesta mesma resposta e receber sucesso. Quando a cliente pedir para agendar ou responder 'sim'/'pode'/'confirmo', chame create_appointment IMEDIATAMENTE antes de responder, e avise que fica com status 'Agendado pela IA' para conferência da equipe."
        : "Você PODE agendar novos horários na agenda do salão usando a ferramenta create_appointment. REGRA OBRIGATÓRIA: NUNCA diga 'vou registrar', 'vou agendar', 'agendado', 'marcado' ou 'confirmado' sem ANTES executar create_appointment nesta mesma resposta e receber 'AGENDAMENTO CRIADO COM SUCESSO'. Quando a cliente pedir explicitamente para agendar (ex.: 'agende manicure com a Ana hoje às 15h') ou responder 'sim'/'pode'/'ok'/'confirmo' para um horário que você ofereceu, CHAME create_appointment IMEDIATAMENTE nesta resposta antes de escrever o texto final. Se a cliente ainda não tiver nome cadastrado, peça o nome dela antes de finalizar. Ao concluir com sucesso, confirme os detalhes reais e avise que o horário ficou registrado como 'Agendado pela IA' para conferência da equipe.";
  const availabilityBlock = availability ? `\n${formatAvailabilityForPrompt(availability)}` : "";
  const clientAppointmentsBlock =
    options?.clientAppointments != null
      ? `\n${formatClientAppointmentsForPrompt(options.clientAppointments, catalog.todayDate)}`
      : "";
  return [
    `Você é ${config.name}, recepcionista virtual do salão ${catalog.salon}.`,
    `Estilo: ${styleLabel(config.style)}. Personalidade: ${personalityLabel(config.personality)}. ${emojiRule}`,
    todayLine,
    clientLine,
    "Fale em português brasileiro, curto, como WhatsApp. No máximo 4 frases.",
    "Varie as palavras a cada resposta. Não copie a mensagem anterior da conversa.",
    "Só responda porque a cliente escreveu agora. Não comece conversa nem faça propaganda sozinha.",
    "Nunca invente horário, preço ou profissional. Use só o catálogo abaixo e as ferramentas check_availability, create_appointment e get_my_appointments.",
    "Quando a cliente perguntar sobre OS PRÓPRIOS agendamentos dela (ex.: 'qual meu horário hoje?', 'quando é meu agendamento?', 'tenho horário marcado?'), responda usando a lista 'Agendamentos futuros DESTA cliente' ou chamando get_my_appointments — informe data, horário, serviço, profissional e status. NUNCA consulte check_availability para responder qual é o horário já marcado da cliente e NUNCA diga que o horário dela está indisponível.",
    "Quando a cliente perguntar sobre disponibilidade para um NOVO horário em qualquer data específica (incluindo dias da semana, semana que vem, dia do mês), um horário específico (ex.: 14:00) ou um serviço com duração específica (especialmente procedimentos longos como 2h ou 3h), consulte check_availability com a data exata, o horário (se mencionado) e o serviço para validar encaixe contínuo real.",
    "Os horários retornados por check_availability são horários de INÍCIO onde o procedimento cabe inteiro sem conflito.",
    "IMPORTANTE SOBRE FAIXAS DE HORÁRIOS: uma faixa contínua como '13:30 até 18:00' significa que TODOS os horários de início dentro desse intervalo (ex.: 13:30, 14:00, 14:30, 15:00, ..., 18:00) estão LIVRES. NUNCA diga que um horário dentro de uma faixa livre está indisponível e NUNCA se contradiga.",
    "Se a consulta mostrar 'HORÁRIO PERGUNTADO HH:mm: DISPONÍVEL', confirme claramente que esse horário está livre. Só diga que um horário está indisponível se a consulta mostrar explicitamente que ele está ocupado ou indisponível.",
    bookingRule,
    "REGRA DE SERVIÇO E PROFISSIONAL: NUNCA adivinhe um serviço nem reutilize o serviço de um agendamento anterior quando a cliente pedir para agendar com uma profissional sem dizer qual serviço deseja (ex.: 'agende com a Sandy'). Se a cliente não informou qual serviço quer neste pedido, PERGUNTE qual serviço ela deseja, listando apenas os serviços que essa profissional realmente realiza. NUNCA agende um serviço que a profissional não realiza e NUNCA troque a profissional escolhida pela cliente sem confirmação dela.",
    "REGRA ESTRITA: você NUNCA pode cancelar, desmarcar, trocar, remarcar ou alterar agendamentos já existentes. Se a cliente pedir cancelamento, troca ou remarcação, diga educadamente que vai passar para alguém da equipe do salão cuidar disso.",
    "Não revele dados de outras clientes, faturamento, estoque ou informações internas.",
    "Se pedirem uma pessoa da equipe, diga que vai chamar a recepção.",
    extra,
    "",
    "Catálogo:",
    formatReceptionistCatalog(catalog),
    clientAppointmentsBlock,
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
          const allowedServices = row.services?.length ? ` · realiza apenas: ${row.services.join(", ")}` : "";
          return `- ${row.name}${specialty}${allowedServices}: ${today}; ${tomorrow}`;
        })
        .join("\n")
    : "- nenhuma profissional ativa";
  return [
    `Salão: ${catalog.salon}${catalog.city ? ` · ${catalog.city}` : ""}`,
    `Horário: ${catalog.hours}`,
    "Serviços:",
    services,
    `Profissionais e faixas contínuas de horários de início livres (cada faixa 'A até B' inclui TODOS os horários a cada ${slotMinutes} min de A até B; respeite rigorosamente os serviços que cada profissional realiza; use check_availability para outras datas, horários específicos ou encaixe exato por duração):`,
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

export function cancelOrRescheduleHandoverReply(config: ReceptionistConfig) {
  const emoji = config.emoji === "nenhum" ? "" : " 💛";
  return spin(
    `{Claro|Entendi}! Para cancelar ou trocar um horário já marcado, vou passar para alguém da equipe do salão cuidar disso com você direitinho.${emoji}`,
  );
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

  if (availability.requestedTime) {
    const requestedTime = availability.requestedTime;
    const freeAtRequested = available.filter((row) => row.startTimes.includes(requestedTime));
    if (freeAtRequested.length) {
      const who = freeAtRequested
        .slice(0, 3)
        .map((row) => row.name)
        .join(", ");
      const ranges = freeAtRequested
        .slice(0, 3)
        .map((row) => `${row.name} (${row.summary})`)
        .join("; ");
      return spin(
        `Sim! Em ${availability.label}, às ${requestedTime} está disponível ${servicePhrase} com ${who} (horários livres: ${ranges}).${emoji} Eu não marco sozinha: {se quiser esse horário|se ficar bom para você}, a recepção confirma.`,
      );
    }
    const details = available
      .slice(0, 3)
      .map((row) => `${row.name} (${row.summary})`)
      .join("; ");
    return spin(
      `Em ${availability.label}, às ${requestedTime} não há encaixe ${servicePhrase}, mas temos horários livres com ${details}.${emoji} Eu não marco sozinha: {se algum encaixar|se algum desses servir}, a recepção confirma para você.`,
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
  clientAppointments?: ClientUpcomingAppointment[] | null;
}) {
  const { config, catalog, incoming, availability: computedAvailability, clientAppointments } = input;
  if (wantsCancelOrReschedule(incoming)) return { text: cancelOrRescheduleHandoverReply(config), handover: true };
  if (wantsHumanHandover(incoming)) return { text: handoverReply(config), handover: true };

  const emoji = config.emoji === "nenhum" ? "" : config.emoji === "sempre" ? " ✨" : " 💛";

  if (asksOwnAppointments(incoming) && clientAppointments != null) {
    if (!clientAppointments.length) {
      return {
        text: spin(
          `Não encontrei nenhum agendamento futuro registrado para o seu número.${emoji} Se quiser, posso ver os horários livres para marcar.`,
        ),
        handover: false,
      };
    }
    const items = clientAppointments.slice(0, 3).map((appt) => {
      const when = catalog.todayDate && appt.date === catalog.todayDate ? `hoje (${appt.dateLabel})` : appt.dateLabel;
      const svc = appt.serviceNames.length ? appt.serviceNames.join(" + ") : "Atendimento";
      return `${svc} com ${appt.professionalName} ${when} às ${appt.startTime} (${appt.statusLabel})`;
    });
    return {
      text: `Encontrei seu agendamento: ${items.join("; ")}.${emoji}`,
      handover: false,
    };
  }

  const service = matchCatalogService(incoming, catalog.services);
  const professional = matchCatalogProfessional(incoming, catalog.professionals);
  const price = asksPrices(incoming);
  const availability = asksAvailability(incoming);
  const first = incoming.trim().length < 18 && /^(oi|ola|olá|bom dia|boa tarde|boa noite|hey|eai|e ai)/i.test(incoming.trim());

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

