import { describe, expect, it } from "vitest";
import {
  PLATFORM_MODULES,
  countEnabledModules,
  defaultPlatformModules,
  isModuleEnabled,
  parsePlatformModules,
  serializePlatformModules,
} from "@/lib/platform-modules";
import {
  buildFallbackMarketingCopy,
  formatStudioPriceSummary,
  parseMoneyInputToCents,
  parseStudioFormat,
  parseStudioStyle,
} from "@/lib/marketing-studio";
import {
  signInstagramOAuthState,
  verifyInstagramOAuthState,
} from "@/lib/instagram-server";
import { parseMarketingTab } from "@/lib/marketing-shared";
import { instagramOAuthCallbackUrl } from "@/lib/integrations";

describe("módulos globais da plataforma", () => {
  it("habilita todos os módulos por padrão e aceita desativação parcial", () => {
    const defaults = defaultPlatformModules();
    expect(countEnabledModules(defaults)).toEqual({
      enabled: PLATFORM_MODULES.length,
      total: PLATFORM_MODULES.length,
    });
    expect(parsePlatformModules(null)).toEqual(defaults);
    expect(parsePlatformModules("json-invalido")).toEqual(defaults);

    const saved = serializePlatformModules(defaults, {
      instagramPublish: false,
      partnerMarketingDrive: false,
    });
    const parsed = parsePlatformModules(saved);
    expect(isModuleEnabled(parsed, "instagramPublish")).toBe(false);
    expect(isModuleEnabled(parsed, "partnerMarketingDrive")).toBe(false);
    expect(isModuleEnabled(parsed, "aiMarketingStudio")).toBe(true);
    expect(isModuleEnabled(parsed, "packages")).toBe(true);
    expect(countEnabledModules(parsed).enabled).toBe(PLATFORM_MODULES.length - 2);
  });
});

describe("estúdio de marketing com IA e Instagram", () => {
  it("reconhece a aba estudio e monta URL de callback OAuth da Meta", () => {
    expect(parseMarketingTab("estudio")).toBe("estudio");
    expect(parseMarketingTab("desconhecida")).toBe("listas");
    expect(instagramOAuthCallbackUrl("https://beauty.megaflood.cloud/")).toBe(
      "https://beauty.megaflood.cloud/api/instagram/oauth/callback",
    );
  });

  it("formata valores promocionais e gera copy engajável mesmo sem chave OpenAI", () => {
    expect(parseMoneyInputToCents("149,90")).toBe(14990);
    expect(parseMoneyInputToCents("R$ 1.250,00")).toBe(125000);
    expect(parseStudioFormat("story")).toBe("story");
    expect(parseStudioFormat("invalido")).toBe("feed");
    expect(parseStudioStyle("flash")).toBe("flash");
    expect(parseStudioStyle("outro")).toBe("editorial");

    const pricing = formatStudioPriceSummary(20000, 14000);
    expect(pricing.discountPct).toBe(30);
    expect(pricing.priceText).toContain("200,00");
    expect(pricing.promoPriceText).toContain("140,00");

    const copy = buildFallbackMarketingCopy({
      salonName: "Studio Aurora",
      itemName: "Mechas + Hidratação",
      originalPriceCents: 20000,
      promoPriceCents: 14000,
      dateRange: "10 a 15/12",
      bookingUrl: "https://beauty.megaflood.cloud/agendar/studio-aurora",
      phone: "(11) 99999-8888",
      city: "São Paulo",
    });
    expect(copy.badgeText).toContain("30% OFF");
    expect(copy.headline).toContain("Mechas + Hidratação");
    expect(copy.caption).toContain("10 a 15/12");
    expect(copy.caption).toContain("https://beauty.megaflood.cloud/agendar/studio-aurora");
    expect(copy.caption).toContain("#saopaulo");
  });

  it("assina e valida o state OAuth do Instagram com proteção contra adulteração e expiração", () => {
    const secret = "test-secret-key-for-hmac-verification";
    const now = 1_700_000_000_000;
    const token = signInstagramOAuthState({
      tenantId: "tenant_123",
      userId: "user_456",
      secret,
      now,
    });

    const verified = verifyInstagramOAuthState(token, { secret, now: now + 5_000 });
    expect(verified).toMatchObject({ tenantId: "tenant_123", userId: "user_456" });

    // Adulterated token must fail
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifyInstagramOAuthState(tampered, { secret, now: now + 5_000 })).toBeNull();

    // Wrong secret must fail
    expect(verifyInstagramOAuthState(token, { secret: "wrong-secret", now: now + 5_000 })).toBeNull();

    // Expired token (>10 min) must fail
    expect(verifyInstagramOAuthState(token, { secret, now: now + 11 * 60 * 1000 })).toBeNull();
  });
});
