import { NextResponse } from "next/server";
import OpenAI from "openai";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { checkPlatformModule } from "@/lib/platform-modules-server";
import { requireSalonMarketingApi } from "@/lib/instagram-server";
import {
  buildFallbackMarketingCopy,
  formatStudioPriceSummary,
  parseMoneyInputToCents,
  parseStudioFormat,
  parseStudioStyle,
} from "@/lib/marketing-studio";

export const runtime = "nodejs";
export const maxDuration = 60;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireSalonMarketingApi(request, "edit");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const mod = await checkPlatformModule("aiMarketingStudio");
    if (!mod.ok) return json({ error: mod.error }, 403);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: "Corpo da requisição inválido." }, 400);
    }

    const body = (rawBody ?? {}) as Record<string, unknown>;
    const itemName = String(body.itemName ?? "").trim().slice(0, 120);
    if (!itemName) {
      return json({ error: "Selecione ou informe um serviço/pacote." }, 400);
    }

    const itemKind = body.itemKind === "PACKAGE" ? "PACKAGE" : "SERVICE";
    const description = String(body.description ?? "").trim().slice(0, 400);
    const originalPriceCents = parseMoneyInputToCents(
      typeof body.originalPriceCents === "number"
        ? body.originalPriceCents
        : String(body.originalPrice ?? ""),
    );
    const promoPriceCents = parseMoneyInputToCents(
      typeof body.promoPriceCents === "number"
        ? body.promoPriceCents
        : String(body.promoPrice ?? ""),
    );
    const dateRange = String(body.dateRange ?? "").trim().slice(0, 80);
    const tone = String(body.tone ?? "elegante e persuasivo").trim().slice(0, 80);
    const format = parseStudioFormat(body.format);
    const style = parseStudioStyle(body.style);
    const generateAiBackground = Boolean(body.generateAiBackground);
    const bookingUrl = String(body.bookingUrl ?? "").trim().slice(0, 240);

    const fallback = buildFallbackMarketingCopy({
      salonName: auth.tenant.name,
      itemName,
      itemKind,
      description,
      originalPriceCents,
      promoPriceCents,
      dateRange,
      bookingUrl,
      phone: auth.tenant.phone,
      city: auth.tenant.city,
      tone,
    });

    const integrations = await resolvePlatformIntegrations();
    if (!integrations.hasOpenAi) {
      return json({
        ok: true,
        source: "smart_template",
        aiImageWarning: generateAiBackground
          ? "Chave OpenAI não configurada na plataforma — usando a foto do serviço/gradiente editorial."
          : null,
        ...fallback,
        backgroundDataUrl: null,
      });
    }

    const openai = new OpenAI({ apiKey: integrations.openaiApiKey });
    const pricing = formatStudioPriceSummary(originalPriceCents, promoPriceCents);

    let copy = fallback;
    let source: "openai" | "smart_template" = "smart_template";

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.75,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Você é um redator especialista em marketing de beleza e estética para Instagram no Brasil. Responda APENAS um JSON válido com as chaves: headline (máx 65 caracteres, impactante e curta para arte), badgeText (máx 34 caracteres, maiúsculas curtas ex: 20% OFF · SEMANA DA BELEZA), ctaText (máx 48 caracteres, chamada curta para agendar), caption (legenda completa e engajável para Instagram com emojis moderados, valor/datas quando informados, link/WhatsApp e 5 hashtags relevantes em português).",
          },
          {
            role: "user",
            content: JSON.stringify({
              salao: auth.tenant.name,
              cidade: auth.tenant.city || undefined,
              whatsapp: auth.tenant.phone || undefined,
              linkAgendamento: bookingUrl || undefined,
              tipo: itemKind === "PACKAGE" ? "Pacote" : "Serviço",
              nome: itemName,
              descricao: description || undefined,
              precoOriginal: pricing.priceText || undefined,
              precoFinal: pricing.promoPriceText || undefined,
              validadeDatas: dateRange || undefined,
              estiloVisual: style,
              formato: format,
              tomDeVoz: tone,
            }),
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        copy = {
          headline:
            typeof parsed.headline === "string" && parsed.headline.trim()
              ? parsed.headline.trim().slice(0, 80)
              : fallback.headline,
          badgeText:
            typeof parsed.badgeText === "string" && parsed.badgeText.trim()
              ? parsed.badgeText.trim().slice(0, 42)
              : fallback.badgeText,
          ctaText:
            typeof parsed.ctaText === "string" && parsed.ctaText.trim()
              ? parsed.ctaText.trim().slice(0, 56)
              : fallback.ctaText,
          caption:
            typeof parsed.caption === "string" && parsed.caption.trim()
              ? parsed.caption.trim().slice(0, 2200)
              : fallback.caption,
        };
        source = "openai";
      }
    } catch (cause) {
      console.error("OpenAI copy generation fallback triggered:", cause);
    }

    let backgroundDataUrl: string | null = null;
    let aiImageWarning: string | null = null;

    if (generateAiBackground) {
      try {
        const size: "1024x1024" | "1024x1792" = format === "story" ? "1024x1792" : "1024x1024";
        const imagePrompt = `Editorial luxury beauty salon photography background for "${itemName}" (${description || "beauty treatment"}). Soft cinematic studio lighting, shallow depth of field, clean upper-center composition with generous darker negative space at the bottom for typography overlay. STRICTLY NO TEXT, NO LETTERS, NO NUMBERS, NO LOGOS, NO WATERMARKS.`;
        const imgRes = await openai.images.generate({
          model: "dall-e-3",
          prompt: imagePrompt,
          size,
          n: 1,
          response_format: "b64_json",
        });
        const b64 = imgRes.data?.[0]?.b64_json;
        if (b64) {
          backgroundDataUrl = `data:image/png;base64,${b64}`;
        }
      } catch (cause) {
        console.error("OpenAI background generation failed:", cause);
        aiImageWarning =
          "Não foi possível gerar o fundo com IA agora — mantendo a foto do serviço ou gradiente editorial.";
      }
    }

    return json({
      ok: true,
      source,
      aiImageWarning,
      ...copy,
      backgroundDataUrl,
    });
  } catch (cause) {
    console.error("studio generate failed", cause);
    return json({ error: "Erro ao gerar arte com IA." }, 500);
  }
}
