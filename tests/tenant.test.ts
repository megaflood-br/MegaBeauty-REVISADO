import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { prisma, prismaForTenant, unscopedPrisma } from "@/lib/db";
import { withTenantContext, withoutTenantScope } from "@/lib/tenant-context";
import { TenantIsolationError } from "@/lib/prisma-tenant";
import {
  detectTenantFromRequest,
  matchTenantPath,
  sanitizeTenantSlug,
  tenantSlugFromHost,
} from "@/lib/tenant-routing";
import { queryReceptionistAvailability } from "@/lib/receptionist-runtime";
import { getPublicBookingBusySlots, publicBook } from "@/app/actions/booking";
import { calendarDate, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { handleEvolutionWebhookRequest } from "@/lib/evolution-webhook-http";
import { evolutionWebhookToken } from "@/lib/evolution-webhook-auth";
import { ingestOutboundFromDevice } from "@/lib/whatsapp-inbound";
import { testEvolutionAuthAndWebhook } from "@/lib/whatsapp-live";

describe("detecção de tenant por domínio e path", () => {
  it("detecta subdomínio em produção e localhost, rejeitando reservados", () => {
    expect(tenantSlugFromHost("studio-aurora.beauty.megaflood.cloud", "beauty.megaflood.cloud")).toBe("studio-aurora");
    expect(tenantSlugFromHost("barbearia-norte.localhost:3000", "beauty.megaflood.cloud")).toBe("barbearia-norte");
    expect(tenantSlugFromHost("beauty.megaflood.cloud", "beauty.megaflood.cloud")).toBe("");
    expect(tenantSlugFromHost("www.beauty.megaflood.cloud", "beauty.megaflood.cloud")).toBe("");
    expect(tenantSlugFromHost("admin.beauty.megaflood.cloud", "beauty.megaflood.cloud")).toBe("");
    expect(tenantSlugFromHost("127.0.0.1:3000", "beauty.megaflood.cloud")).toBe("");
    expect(sanitizeTenantSlug("plataforma")).toBe("");
  });

  it("detecta path baseado em /t/[slug], /agendar/[slug] e /pop/[slug]", () => {
    expect(matchTenantPath("/t/studio-aurora")).toEqual({
      slug: "studio-aurora",
      source: "path",
      rewritePath: "/agendar/studio-aurora",
      isPublicPath: true,
    });
    expect(matchTenantPath("/t/studio-aurora/dashboard")).toEqual({
      slug: "studio-aurora",
      source: "path",
      rewritePath: "/dashboard",
      isPublicPath: false,
    });
    expect(matchTenantPath("/t/studio-aurora/login")).toEqual({
      slug: "studio-aurora",
      source: "path",
      rewritePath: "/login",
      isPublicPath: true,
    });
    expect(matchTenantPath("/agendar/studio-aurora")?.slug).toBe("studio-aurora");
    expect(matchTenantPath("/pop/studio-aurora/higienizacao")?.slug).toBe("studio-aurora");
    expect(matchTenantPath("/t/admin/dashboard")).toBeNull();
  });

  it("prioriza detecção por path quando domínio e path coexistem", () => {
    const byPath = detectTenantFromRequest({
      pathname: "/t/barbearia-norte/agenda",
      host: "studio-aurora.beauty.megaflood.cloud",
      rootDomain: "beauty.megaflood.cloud",
    });
    expect(byPath.slug).toBe("barbearia-norte");
    expect(byPath.source).toBe("path");
    expect(byPath.rewritePath).toBe("/agenda");

    const byDomain = detectTenantFromRequest({
      pathname: "/dashboard",
      host: "studio-aurora.beauty.megaflood.cloud",
      rootDomain: "beauty.megaflood.cloud",
    });
    expect(byDomain.slug).toBe("studio-aurora");
    expect(byDomain.source).toBe("domain");
    expect(byDomain.rewritePath).toBeNull();
  });
});

describe("isolamento multi-tenant automático no Prisma", () => {
  it("isola findMany, count e findUnique automaticamente via AsyncLocalStorage sem where manual", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    const norte = await unscopedPrisma.tenant.findUnique({ where: { slug: "barbearia-norte" } });
    expect(aurora).toBeTruthy();
    expect(norte).toBeTruthy();

    const auroraClients = await withTenantContext(aurora!.id, () => prisma.client.findMany());
    const norteClients = await withTenantContext(norte!.id, () => prisma.client.findMany());
    const norteCount = await withTenantContext(norte!.id, () => prisma.client.count());

    expect(auroraClients.length).toBeGreaterThan(0);
    expect(auroraClients.every((c) => c.tenantId === aurora!.id)).toBe(true);
    expect(norteClients).toHaveLength(0);
    expect(norteCount).toBe(0);

    // Tentativa de ler cliente do tenant Aurora usando ID direto dentro do escopo do tenant Norte deve retornar null.
    const foreignClientId = auroraClients[0].id;
    const crossReadById = await withTenantContext(norte!.id, () =>
      prisma.client.findUnique({ where: { id: foreignClientId } }),
    );
    expect(crossReadById).toBeNull();

    // Tentativa de escapar via filtro `OR` ou `tenantId` explícito de outro tenant retorna 0 registros.
    const crossOrEscape = await withTenantContext(norte!.id, () =>
      prisma.client.findMany({
        where: { OR: [{ tenantId: aurora!.id }, { id: foreignClientId }] },
      }),
    );
    expect(crossOrEscape).toHaveLength(0);

    const crossDirectEscape = await withTenantContext(norte!.id, () =>
      prisma.client.findMany({ where: { tenantId: aurora!.id } }),
    );
    expect(crossDirectEscape).toHaveLength(0);
  });

  it("injeta tenantId na criação e bloqueia mutações cross-tenant", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    const norte = await unscopedPrisma.tenant.findUnique({ where: { slug: "barbearia-norte" } });
    expect(aurora).toBeTruthy();
    expect(norte).toBeTruthy();

    const norteDb = prismaForTenant(norte!.id);
    const auroraClient = await unscopedPrisma.client.findFirst({ where: { tenantId: aurora!.id } });
    expect(auroraClient).toBeTruthy();

    // Tentativa de updateMany em registro de outro salão afeta 0 linhas.
    const crossUpdate = await norteDb.client.updateMany({
      where: { id: auroraClient!.id },
      data: { name: "Tentativa Invasao" },
    });
    expect(crossUpdate.count).toBe(0);

    // Tentativa de criar registro forçando tenantId de outro salão lança TenantIsolationError.
    await expect(
      norteDb.client.create({
        data: {
          name: "Invasor",
          phone: "11999990000",
          tenantId: aurora!.id,
        },
      }),
    ).rejects.toThrow(TenantIsolationError);

    // Tentativa de alterar tenantId no update lança TenantIsolationError.
    await expect(
      norteDb.client.updateMany({
        where: { id: "qualquer" },
        data: { tenantId: aurora!.id },
      }),
    ).rejects.toThrow(TenantIsolationError);

    // withoutTenantScope permite leitura global quando explicitamente autorizado (ex.: Super Admin).
    const globalTotal = await withTenantContext(norte!.id, () =>
      withoutTenantScope(() => prisma.client.count()),
    );
    expect(globalTotal).toBeGreaterThan(0);
  });

  it("consulta agenda futura (além de hoje/amanhã) com encaixe contíguo de 3h isolado por tenant", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    const norte = await unscopedPrisma.tenant.findUnique({ where: { slug: "barbearia-norte" } });
    expect(aurora).toBeTruthy();
    expect(norte).toBeTruthy();

    const prof = await unscopedPrisma.professional.findFirst({
      where: { tenantId: aurora!.id, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
    });
    const client = await unscopedPrisma.client.findFirst({ where: { tenantId: aurora!.id } });
    expect(prof).toBeTruthy();
    expect(client).toBeTruthy();

    const today = calendarDate();
    const futureDate = shiftCalendarDate(today, 12);
    const openTime = prof!.workStart || aurora!.openTime;
    const closeTime = prof!.workEnd || aurora!.closeTime;

    // Cria um agendamento real em +12 dias das 12:00 às 13:00 para validar que um bloco de 3h não pode cruzar esse intervalo
    const created = await unscopedPrisma.appointment.create({
      data: {
        tenantId: aurora!.id,
        clientId: client!.id,
        professionalId: prof!.id,
        startAt: zonedDateTime(futureDate, "12:00"),
        endAt: zonedDateTime(futureDate, "13:00"),
        status: "CONFIRMED",
      },
    });

    try {
      const result = await queryReceptionistAvailability({
        tenantId: aurora!.id,
        date: futureDate,
        professionalName: prof!.name,
        durationMin: 180,
        referenceDate: today,
      });

      expect(result.date).toBe(futureDate);
      expect(result.isPast).toBe(false);
      expect(result.outOfRange).toBe(false);
      expect(result.durationMin).toBe(180);
      expect(result.professionals).toHaveLength(1);

      const slots = result.professionals[0].startTimes;
      // Nenhum início de 3h entre 09:15 e 12:45 pode ser oferecido pois colide com 12:00..13:00
      expect(slots).not.toContain("09:15");
      expect(slots).not.toContain("10:00");
      expect(slots).not.toContain("11:00");
      expect(slots).not.toContain("12:00");
      expect(slots).not.toContain("12:45");
      // 13:00 em diante cabe se closeTime >= 16:00
      if (closeTime >= "16:00") {
        expect(slots).toContain("13:00");
      }
      // 09:00 cabe exato (09:00..12:00) se openTime <= 09:00
      if (openTime <= "09:00") {
        expect(slots).toContain("09:00");
      }

      // Isolamento: consultar a mesma data no tenant Norte não vaza a profissional nem compromissos da Aurora
      const norteResult = await queryReceptionistAvailability({
        tenantId: norte!.id,
        date: futureDate,
        professionalName: prof!.name,
        durationMin: 180,
        referenceDate: today,
      });
      expect(norteResult.professionals).toHaveLength(0);
    } finally {
      await unscopedPrisma.appointment.delete({ where: { id: created.id } }).catch(() => null);
    }
  });

  it("consulta disponibilidade pública em datas até +30 dias com isolamento por salão e bloqueio fora da janela", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    const norte = await unscopedPrisma.tenant.findUnique({ where: { slug: "barbearia-norte" } });
    expect(aurora).toBeTruthy();
    expect(norte).toBeTruthy();

    const prof = await unscopedPrisma.professional.findFirst({
      where: { tenantId: aurora!.id, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
    });
    const client = await unscopedPrisma.client.findFirst({ where: { tenantId: aurora!.id } });
    expect(prof).toBeTruthy();
    expect(client).toBeTruthy();

    const today = calendarDate();
    const day25 = shiftCalendarDate(today, 25);
    const day35 = shiftCalendarDate(today, 35);

    const created = await unscopedPrisma.appointment.create({
      data: {
        tenantId: aurora!.id,
        clientId: client!.id,
        professionalId: prof!.id,
        startAt: zonedDateTime(day25, "14:00"),
        endAt: zonedDateTime(day25, "16:00"),
        status: "CONFIRMED",
      },
    });

    try {
      const auroraRes = await getPublicBookingBusySlots({ slug: "studio-aurora", date: day25 });
      expect("busy" in auroraRes).toBe(true);
      if ("busy" in auroraRes) {
        expect(auroraRes.busy.some((b) => b.professionalId === prof!.id)).toBe(true);
      }

      // Isolamento multi-tenant: outro salão na mesma data não vê compromissos da Studio Aurora
      const norteRes = await getPublicBookingBusySlots({ slug: "barbearia-norte", date: day25 });
      expect("busy" in norteRes).toBe(true);
      if ("busy" in norteRes) {
        expect(norteRes.busy.some((b) => b.professionalId === prof!.id)).toBe(false);
      }

      // Data além dos 30 dias deve ser rejeitada
      const outOfRangeRes = await getPublicBookingBusySlots({ slug: "studio-aurora", date: day35 });
      expect("error" in outOfRangeRes).toBe(true);
    } finally {
      await unscopedPrisma.appointment.delete({ where: { id: created.id } }).catch(() => null);
    }
  });

  it("recebe webhook da Evolution com token HMAC, corrige status para open, isola por tenant e não pausa o bot no eco", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    const norte = await unscopedPrisma.tenant.findUnique({ where: { slug: "barbearia-norte" } });
    expect(aurora).toBeTruthy();
    expect(norte).toBeTruthy();

    const originalState = {
      evolutionApiKey: aurora!.evolutionApiKey,
      evolutionStatus: aurora!.evolutionStatus,
      evolutionInstance: aurora!.evolutionInstance,
    };
    const testSecret = "test-evo-webhook-secret-2026";
    const testPhone = "5511991234567";
    const token = evolutionWebhookToken(testSecret, "studio-aurora");

    await unscopedPrisma.tenant.update({
      where: { id: aurora!.id },
      data: {
        evolutionApiKey: testSecret,
        evolutionStatus: "connecting",
        evolutionInstance: "mb-studio-aurora",
      },
    });

    try {
      // 1. Sem autenticação deve retornar 401
      const unauthReq = new NextRequest("http://localhost:3000/api/webhooks/evolution?tenant=studio-aurora", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "MESSAGES_UPSERT", data: {} }),
      });
      const unauthRes = await handleEvolutionWebhookRequest(unauthReq);
      expect(unauthRes.status).toBe(401);

      // 2. Com token HMAC na query (sem header apikey!) e subpath messages-upsert (WEBHOOK_BY_EVENTS=true),
      //    @lid + remoteJidAlt e mensagem efêmera deve persistir no salão certo e curar evolutionStatus para "open"
      const signedReq = new NextRequest(
        `http://localhost:3000/api/webhooks/evolution/messages-upsert?tenant=studio-aurora&token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instance: "mb-studio-aurora",
            data: {
              key: {
                id: "WA-TEST-IN-1",
                fromMe: false,
                remoteJid: "998877665544@lid",
                remoteJidAlt: `${testPhone}@s.whatsapp.net`,
              },
              message: {
                ephemeralMessage: {
                  message: { conversation: "Olá, quero agendar escova" },
                },
              },
            },
          }),
        },
      );
      const okRes = await handleEvolutionWebhookRequest(signedReq, "messages-upsert");
      expect(okRes.status).toBe(200);
      const okJson = await okRes.json();
      expect(okJson.ok).toBe(true);
      expect(okJson.processed).toBe(1);

      const healedTenant = await unscopedPrisma.tenant.findUnique({
        where: { id: aurora!.id },
        select: { evolutionStatus: true },
      });
      expect(healedTenant?.evolutionStatus).toBe("open");

      const auroraConv = await withTenantContext(aurora!.id, () =>
        prisma.conversation.findFirst({
          where: { phone: testPhone },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        }),
      );
      expect(auroraConv).toBeTruthy();
      expect(auroraConv!.messages.some((m) => m.direction === "IN" && m.body === "Olá, quero agendar escova")).toBe(true);

      // Isolamento: outro salão não enxerga essa conversa
      const norteConv = await withTenantContext(norte!.id, () =>
        prisma.conversation.findFirst({ where: { phone: testPhone } }),
      );
      expect(norteConv).toBeNull();

      // 3. Eco de mensagem enviada pelo bot (fromMe: true) NÃO pode pausar o bot (botPausedUntil permanece null)
      await unscopedPrisma.message.create({
        data: {
          conversationId: auroraConv!.id,
          direction: "OUT",
          body: "Claro! Qual dia você prefere?",
          source: "AI",
        },
      });
      const echoResult = await withTenantContext(aurora!.id, () =>
        ingestOutboundFromDevice({
          tenantId: aurora!.id,
          phone: testPhone,
          body: "Claro! Qual dia você prefere?",
          waId: "WA-TEST-ECHO-1",
        }),
      );
      expect(echoResult.skipped).toBe("echo");

      const afterEcho = await unscopedPrisma.conversation.findUnique({
        where: { id: auroraConv!.id },
        select: { botPausedUntil: true },
      });
      expect(afterEcho?.botPausedUntil).toBeNull();

      // 4. WEBHOOK_BY_EVENTS=true concatenado na query (`?tenant=studio-aurora&token=.../messages-upsert`)
      //    e autenticação via `payload.apikey` no corpo JSON + unificação de conversa 11 dígitos vs 55+11 dígitos
      const localPhone = "11991230001";
      const fullPhone = `55${localPhone}`;
      const existingLocalConv = await unscopedPrisma.conversation.create({
        data: { tenantId: aurora!.id, phone: localPhone, lastMessageAt: new Date() },
      });
      try {
        const bodyKeyReq = new NextRequest(
          "http://localhost:3000/api/webhooks/evolution?tenant=studio-aurora/messages-upsert",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              instance: "mb-studio-aurora",
              apikey: testSecret,
              data: {
                key: { id: "WA-TEST-BODYKEY-1", fromMe: false, remoteJid: `${fullPhone}@s.whatsapp.net` },
                message: { conversation: "Oi, recebi sua mensagem!" },
              },
            }),
          },
        );
        const bodyKeyRes = await handleEvolutionWebhookRequest(bodyKeyReq);
        expect(bodyKeyRes.status).toBe(200);

        const suffixTokenReq = new NextRequest(
          `http://localhost:3000/api/webhooks/evolution?tenant=studio-aurora&token=${token}/messages-upsert`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              instance: "mb-studio-aurora",
              data: {
                key: { id: "WA-TEST-SUFFIX-2", fromMe: false, remoteJid: `${fullPhone}@s.whatsapp.net` },
                message: { conversation: "Segunda mensagem no mesmo chat" },
              },
            }),
          },
        );
        const suffixRes = await handleEvolutionWebhookRequest(suffixTokenReq);
        expect(suffixRes.status).toBe(200);

        // Ambas devem cair na MESMA conversa criada com 11 dígitos (sem duplicar conversa!)
        const allMatchingConvs = await unscopedPrisma.conversation.findMany({
          where: { tenantId: aurora!.id, phone: { in: [localPhone, fullPhone] } },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        });
        expect(allMatchingConvs).toHaveLength(1);
        expect(allMatchingConvs[0].id).toBe(existingLocalConv.id);
        expect(allMatchingConvs[0].messages.map((m) => m.body)).toEqual([
          "Oi, recebi sua mensagem!",
          "Segunda mensagem no mesmo chat",
        ]);
      } finally {
        await unscopedPrisma.message.deleteMany({ where: { conversationId: existingLocalConv.id } }).catch(() => null);
        await unscopedPrisma.conversation.deleteMany({
          where: { tenantId: aurora!.id, phone: { in: [localPhone, fullPhone] } },
        }).catch(() => null);
      }
    } finally {
      const conv = await unscopedPrisma.conversation.findUnique({
        where: { tenantId_phone: { tenantId: aurora!.id, phone: testPhone } },
        select: { id: true },
      });
      if (conv) {
        await unscopedPrisma.message.deleteMany({ where: { conversationId: conv.id } }).catch(() => null);
        await unscopedPrisma.conversation.delete({ where: { id: conv.id } }).catch(() => null);
      }
      await unscopedPrisma.tenant.update({
        where: { id: aurora!.id },
        data: originalState,
      });
    }
  });

  it("testEvolutionAuthAndWebhook valida autenticação do token Evolution e apontamento exato da URL do webhook", async () => {
    const hq = await unscopedPrisma.tenant.findFirst({ where: { isPlatform: true } });
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    expect(hq).toBeTruthy();
    expect(aurora).toBeTruthy();

    const originalHq = {
      evolutionUrl: hq!.evolutionUrl,
      evolutionApiKey: hq!.evolutionApiKey,
      publicAppUrl: hq!.publicAppUrl,
    };
    const originalAurora = {
      evolutionInstance: aurora!.evolutionInstance,
      evolutionApiKey: aurora!.evolutionApiKey,
    };

    const apiKey = "evo-live-verify-key-999";
    const appOrigin = "https://beauty.megaflood.cloud";
    const expectedToken = evolutionWebhookToken(apiKey, "studio-aurora");
    const expectedUrl = `${appOrigin}/api/webhooks/evolution?tenant=studio-aurora&token=${expectedToken}`;

    await unscopedPrisma.tenant.update({
      where: { id: hq!.id },
      data: {
        evolutionUrl: "https://evo.example.test",
        evolutionApiKey: apiKey,
        publicAppUrl: appOrigin,
      },
    });
    await unscopedPrisma.tenant.update({
      where: { id: aurora!.id },
      data: {
        evolutionInstance: "mb-studio-aurora",
        evolutionApiKey: null,
      },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      // Caso 1: Token válido (200) + webhook ativo apontado para nossa URL assinada + MESSAGES_UPSERT
      fetchSpy.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/instance/connectionState/")) {
          return new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 });
        }
        if (url.includes("/webhook/find/")) {
          return new Response(
            JSON.stringify({
              enabled: true,
              url: expectedUrl,
              byEvents: false,
              events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      });

      const okReport = await testEvolutionAuthAndWebhook(aurora!.id);
      expect(okReport.ok).toBe(true);
      expect(okReport.authOk).toBe(true);
      expect(okReport.authHttpStatus).toBe(200);
      expect(okReport.webhookPointedCorrectly).toBe(true);
      expect(okReport.expectedWebhookUrlMasked).not.toContain(expectedToken);

      // Caso 2: Token recusado pela Evolution (401)
      fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));
      const badAuth = await testEvolutionAuthAndWebhook(aurora!.id);
      expect(badAuth.ok).toBe(false);
      expect(badAuth.authOk).toBe(false);
      expect(badAuth.authHttpStatus).toBe(401);

      // Caso 3: Token autenticado (200), mas webhook aponta para URL antiga / errada
      fetchSpy.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/instance/connectionState/")) {
          return new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            url: "https://outro-dominio.example.com/webhook",
            byEvents: false,
            events: ["MESSAGES_UPSERT"],
          }),
          { status: 200 },
        );
      });
      const wrongUrl = await testEvolutionAuthAndWebhook(aurora!.id);
      expect(wrongUrl.ok).toBe(false);
      expect(wrongUrl.authOk).toBe(true);
      expect(wrongUrl.webhookPointedCorrectly).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      await unscopedPrisma.tenant.update({ where: { id: hq!.id }, data: originalHq });
      await unscopedPrisma.tenant.update({ where: { id: aurora!.id }, data: originalAurora });
    }
  });

  it("queryReceptionistAvailability reporta agenda livre e horário solicitado (14:00) corretamente no banco real", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    expect(aurora).toBeTruthy();
    const prof = await unscopedPrisma.professional.findFirst({
      where: { tenantId: aurora!.id, active: true, generateAgenda: true },
      orderBy: { name: "asc" },
    });
    const client = await unscopedPrisma.client.findFirst({ where: { tenantId: aurora!.id } });
    expect(prof).toBeTruthy();
    expect(client).toBeTruthy();

    const targetDay = shiftCalendarDate(calendarDate(), 18);

    // Sem agendamentos no dia: 14:00 deve estar livre e busy deve estar vazio
    const freeRes = await queryReceptionistAvailability({
      tenantId: aurora!.id,
      date: targetDay,
      professionalName: prof!.name,
      requestedTime: "14:00",
      referenceDate: targetDay,
      nowHHmm: "13:25",
    });
    expect(freeRes.requestedTime).toBe("14:00");
    expect(freeRes.currentTimeHHmm).toBe("13:25");
    expect(freeRes.professionals).toHaveLength(1);
    expect(freeRes.professionals[0].busy).toEqual([]);
    expect(freeRes.professionals[0].startTimes[0]).toBe("13:30");
    expect(freeRes.professionals[0].startTimes).toContain("14:00");

    // Com agendamento real 14:00..15:00: 14:00 deixa de estar livre e aparece em busy
    const created = await unscopedPrisma.appointment.create({
      data: {
        tenantId: aurora!.id,
        clientId: client!.id,
        professionalId: prof!.id,
        startAt: zonedDateTime(targetDay, "14:00"),
        endAt: zonedDateTime(targetDay, "15:00"),
        status: "CONFIRMED",
      },
    });
    try {
      const busyRes = await queryReceptionistAvailability({
        tenantId: aurora!.id,
        date: targetDay,
        professionalName: prof!.name,
        requestedTime: "14:00",
        referenceDate: targetDay,
        nowHHmm: "13:25",
      });
      expect(busyRes.professionals[0].busy).toEqual([{ start: "14:00", end: "15:00" }]);
      expect(busyRes.professionals[0].startTimes).not.toContain("14:00");
      expect(busyRes.professionals[0].startTimes).toContain("13:30");
      expect(busyRes.professionals[0].startTimes).toContain("15:00");
    } finally {
      await unscopedPrisma.appointment.delete({ where: { id: created.id } }).catch(() => null);
    }
  });

  it("publicBook soma a duração total dos serviços selecionados, bloqueia encaixes incompatíveis e grava todos os itens", async () => {
    const aurora = await unscopedPrisma.tenant.findUnique({ where: { slug: "studio-aurora" } });
    expect(aurora).toBeTruthy();

    const [services, prof, client] = await Promise.all([
      unscopedPrisma.service.findMany({
        where: { tenantId: aurora!.id, active: true },
        orderBy: { durationMin: "asc" },
        take: 2,
      }),
      unscopedPrisma.professional.findFirst({
        where: { tenantId: aurora!.id, active: true, generateAgenda: true },
        orderBy: { name: "asc" },
      }),
      unscopedPrisma.client.findFirst({ where: { tenantId: aurora!.id } }),
    ]);
    expect(services.length).toBeGreaterThanOrEqual(2);
    expect(prof).toBeTruthy();
    expect(client).toBeTruthy();

    const [svcA, svcB] = services;
    const totalDurationMin = svcA.durationMin + svcB.durationMin;
    const targetDay = shiftCalendarDate(calendarDate(), 19);
    const testPhone = "11988887766";

    // Cria um agendamento existente logo após o fim do primeiro serviço (bloqueando o bloco contínuo combinado)
    const blockerStart = zonedDateTime(targetDay, "10:00");
    const blockerAt = new Date(blockerStart.getTime() + svcA.durationMin * 60_000);
    const blockerEnd = new Date(blockerAt.getTime() + 60 * 60_000);

    const blocker = await unscopedPrisma.appointment.create({
      data: {
        tenantId: aurora!.id,
        clientId: client!.id,
        professionalId: prof!.id,
        startAt: blockerAt,
        endAt: blockerEnd,
        status: "CONFIRMED",
      },
    });

    const originalLinks = await unscopedPrisma.professionalService.findMany({
      where: { professionalId: prof!.id },
    });
    // Garante que a profissional de teste realiza os dois serviços
    for (const svc of [svcA, svcB]) {
      await unscopedPrisma.professionalService.upsert({
        where: { professionalId_serviceId: { professionalId: prof!.id, serviceId: svc.id } },
        update: {},
        create: { professionalId: prof!.id, serviceId: svc.id },
      });
    }

    let createdAppointmentId: string | null = null;
    try {
      // 1. Tentar às 10:00: o 1º serviço caberia sozinho, mas o bloco contínuo dos 2 conflita com blockerAt -> deve rejeitar
      const badForm = new FormData();
      badForm.set("slug", "studio-aurora");
      badForm.set("professionalId", prof!.id);
      badForm.append("serviceIds", svcA.id);
      badForm.append("serviceIds", svcB.id);
      badForm.set("startAt", blockerStart.toISOString());
      badForm.set("name", "Teste Contíguo");
      badForm.set("phone", testPhone);

      const conflictRes = await publicBook(badForm);
      expect(conflictRes).toHaveProperty("error");

      // 2. Tentar em horário livre após o bloqueio (14:00): deve aceitar e criar Appointment com endAt = 14:00 + totalDurationMin e 2 itens
      const freeStart = zonedDateTime(targetDay, "14:00");
      const okForm = new FormData();
      okForm.set("slug", "studio-aurora");
      okForm.set("professionalId", prof!.id);
      okForm.append("serviceIds", svcA.id);
      okForm.append("serviceIds", svcB.id);
      okForm.set("startAt", freeStart.toISOString());
      okForm.set("name", "Teste Contíguo");
      okForm.set("phone", testPhone);

      const okRes = await publicBook(okForm);
      expect(okRes).toEqual({ ok: true });

      const booked = await unscopedPrisma.appointment.findFirst({
        where: {
          tenantId: aurora!.id,
          professionalId: prof!.id,
          startAt: freeStart,
        },
        include: { items: { orderBy: { startAt: "asc" } } },
      });
      expect(booked).toBeTruthy();
      createdAppointmentId = booked!.id;
      expect(booked!.endAt.getTime() - booked!.startAt.getTime()).toBe(totalDurationMin * 60_000);
      expect(booked!.items).toHaveLength(2);
      expect(booked!.items.map((i) => i.serviceId)).toEqual([svcA.id, svcB.id]);
    } finally {
      if (createdAppointmentId) {
        await unscopedPrisma.appointment.delete({ where: { id: createdAppointmentId } }).catch(() => null);
      }
      await unscopedPrisma.appointment.delete({ where: { id: blocker.id } }).catch(() => null);
      await unscopedPrisma.client
        .deleteMany({ where: { tenantId: aurora!.id, phone: testPhone } })
        .catch(() => null);
      // Restaura links originais da profissional se necessário
      const originalIds = new Set(originalLinks.map((l) => l.serviceId));
      for (const svc of [svcA, svcB]) {
        if (!originalIds.has(svc.id)) {
          await unscopedPrisma.professionalService
            .delete({ where: { professionalId_serviceId: { professionalId: prof!.id, serviceId: svc.id } } })
            .catch(() => null);
        }
      }
    }
  });
});
