import OpenAI from "openai";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistant";

export function createOpenAI(apiKey?: string | null) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export function fallbackInsight(stats: {
  revenueCents: number;
  appointments: number;
  occupancy: number;
  noShows: number;
  lowStock: number;
  lowStockNames?: string[];
}) {
  const hints: string[] = [];
  if (stats.occupancy < 55) {
    hints.push(
      "A ocupação da agenda está abaixo de 55%. Vale disparar uma campanha de horários ociosos no WhatsApp para as profissionais com mais buracos.",
    );
  } else {
    hints.push("A ocupação está saudável. Foque em upsell de pacotes nas clientes recorrentes desta semana.");
  }
  if (stats.noShows > 0) {
    hints.push(
      `Houve ${stats.noShows} não comparecimento(s). Ative o lembrete automático 24h antes e peça confirmação com um toque.`,
    );
  }
  if (stats.lowStockNames?.length) {
    hints.push(`Em baixa agora: ${stats.lowStockNames.join(", ")}. Reponha antes do pico de sábado.`);
  } else if (stats.lowStock > 0) {
    hints.push(`${stats.lowStock} produto(s) estão no estoque mínimo. Reponha antes do pico de sábado.`);
  }
  if (stats.appointments === 0) {
    hints.push("Agenda vazia hoje. Publique o link de agendamento online nos stories e no WhatsApp Business.");
  }
  return hints.join(" ");
}

export async function chatWithSalonContext(params: {
  apiKey?: string | null;
  question: string;
  context: string;
}) {
  const client = createOpenAI(params.apiKey);
  if (!client) {
    return {
      source: "local" as const,
      answer:
        "A OpenAI ainda não está configurada na plataforma. Com os dados atuais: " +
        params.context.slice(0, 400) +
        " Configure a chave universal em Plataforma → Integrações.",
    };
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: ASSISTANT_SYSTEM_PROMPT,
      },
      { role: "user", content: `Contexto do salão:\n${params.context}\n\nPergunta: ${params.question}` },
    ],
  });

  return {
    source: "openai" as const,
    answer: completion.choices[0]?.message?.content ?? "Não consegui gerar uma resposta agora.",
  };
}

export async function draftWhatsAppMessage(params: {
  apiKey?: string | null;
  goal: string;
  clientName: string;
  salonName: string;
}) {
  const client = createOpenAI(params.apiKey);
  if (!client) {
    return `Oi ${params.clientName.split(" ")[0]}! Aqui é do ${params.salonName}. ${params.goal} Qualquer coisa é só responder esta mensagem 💛`;
  }
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "Escreva mensagens curtas de WhatsApp em português brasileiro, tom caloroso e profissional, sem emojis em excesso, no máximo 3 frases.",
      },
      {
        role: "user",
        content: `Salão: ${params.salonName}. Cliente: ${params.clientName}. Objetivo: ${params.goal}`,
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

export async function chatAsReceptionist(params: {
  apiKey?: string | null;
  system: string;
  incoming: string;
  history?: { role: "user" | "assistant"; text: string }[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxToolRounds?: number;
}) {
  const client = createOpenAI(params.apiKey);
  if (!client) return null;
  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (params.history ?? []).slice(-8).map((item) => ({
    role: item.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: item.text,
  }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: params.system },
    ...history,
    { role: "user", content: params.incoming },
  ];

  const hasTools = Boolean(params.tools?.length && params.onToolCall);
  if (!hasTools) {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 240,
      messages,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return text || null;
  }

  const maxRounds = Math.min(3, Math.max(1, params.maxToolRounds ?? 3));
  for (let round = 0; round < maxRounds; round++) {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 260,
      messages,
      tools: params.tools,
      tool_choice: "auto",
    });
    const message = completion.choices[0]?.message;
    if (!message) return null;

    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      const text = message.content?.trim() ?? "";
      return text || null;
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls.slice(0, 4)) {
      if (toolCall.type !== "function") continue;
      let parsedArgs: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(toolCall.function.arguments || "{}");
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          parsedArgs = raw as Record<string, unknown>;
        }
      } catch {
        parsedArgs = {};
      }
      const toolOutput = await params.onToolCall!(toolCall.function.name, parsedArgs);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolOutput,
      });
    }
  }

  const finalCompletion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 240,
    messages,
  });
  const finalText = finalCompletion.choices[0]?.message?.content?.trim() ?? "";
  return finalText || null;
}
