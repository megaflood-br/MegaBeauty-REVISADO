import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canAccess, shouldHidePhones } from "@/lib/permissions";
import { redactPhone } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { readWhatsAppLive } from "@/lib/whatsapp-live";
import { atendimentoPath, MARKETING_TABS, parseMarketingTab, syncMarketingReplies } from "@/lib/marketing";
import { settingsPath } from "@/lib/settings";
import { MarketingBoard } from "@/components/marketing/marketing-board";
import { CampaignsBoard } from "@/components/whatsapp/campaigns-board";
import { AiStudioBoard } from "@/components/marketing/ai-studio-board";
import { ensureWhatsAppCampaigns } from "@/lib/ensure-campaigns";
import { runDueCampaigns } from "@/lib/run-due-campaigns";
import { loadPlatformModules } from "@/lib/platform-modules-server";
import { instagramOAuthCallbackUrl, resolvePlatformIntegrations } from "@/lib/integrations";
import { publicAppOrigin } from "@/lib/public-url";
import { parseStudioFormat, parseStudioStyle, type StudioCatalogItem } from "@/lib/marketing-studio";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tab?: string }>;
}) {
  const { session, tenant, access } = await requireTenant();
  const hidePhones = shouldHidePhones(access);
  const [params, modules] = await Promise.all([searchParams, loadPlatformModules()]);
  if (params.tab === "inbox") redirect(atendimentoPath(params.c));
  if (params.tab === "conexao") redirect(settingsPath("whatsapp"));

  const visibleTabs = modules.aiMarketingStudio
    ? MARKETING_TABS
    : MARKETING_TABS.filter((item) => item.id !== "estudio");

  const parsedTab = parseMarketingTab(params.tab);
  const tab = parsedTab === "estudio" && !modules.aiMarketingStudio ? "listas" : parsedTab;
  const selectedId = typeof params.c === "string" ? params.c : null;
  const current = visibleTabs.find((item) => item.id === tab) ?? visibleTabs[0];
  const live = tab === "estudio" ? null : await readWhatsAppLive(session.tenantId);
  const connected = live?.connected ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Marketing</h1>
        <p className="text-ink-soft">{current.description}</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {visibleTabs.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.id === "listas" ? "/marketing" : `/marketing?tab=${item.id}`}
              className={cn(
                "-mb-px inline-flex items-center border-b-2 px-4 py-2.5 text-sm",
                active ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {tab === "estudio" ? (
        <AiStudioPanel
          tenant={tenant}
          canManage={canAccess(access, "marketing", "edit")}
          packagesEnabled={modules.packages}
          instagramPublishEnabled={modules.instagramPublish}
        />
      ) : tab === "campanhas" ? (
        <CampaignsPanel tenantId={session.tenantId} canManage={canAccess(access, "marketing", "edit")} connected={connected} />
      ) : (
        <ListsPanel
          tenantId={session.tenantId}
          selectedId={selectedId}
          canManage={canAccess(access, "marketing", "edit")}
          hidePhones={hidePhones}
          connected={connected}
        />
      )}
    </div>
  );
}

async function AiStudioPanel({
  tenant,
  canManage,
  packagesEnabled,
  instagramPublishEnabled,
}: {
  tenant: {
    id: string;
    name: string;
    slug: string;
    phone: string | null;
    city: string | null;
    address: string | null;
    accentColor: string;
    logoUrl: string | null;
    instagramUserId: string | null;
    instagramUsername: string | null;
    instagramPageName: string | null;
    instagramConnectedAt: Date | null;
  };
  canManage: boolean;
  packagesEnabled: boolean;
  instagramPublishEnabled: boolean;
}) {
  const [services, packages, posts, integrations] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId: tenant.id, active: true },
      include: { category: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    packagesEnabled
      ? prisma.package.findMany({
          where: { tenantId: tenant.id, active: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.salonMarketingPost.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 18,
    }),
    resolvePlatformIntegrations(),
  ]);

  const catalog: StudioCatalogItem[] = [
    ...services.map((s) => ({
      id: s.id,
      kind: "SERVICE" as const,
      name: s.name,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
      description: s.description,
      imageUrl: s.imageUrl,
      categoryName: s.category?.name ?? null,
    })),
    ...packages.map((p) => ({
      id: p.id,
      kind: "PACKAGE" as const,
      name: p.name,
      priceCents: p.priceCents,
      durationMin: null,
      description: p.description,
      imageUrl: null,
      categoryName: "Pacote",
    })),
  ];

  const origin = publicAppOrigin(integrations.publicAppUrl);
  const bookingUrl = origin ? `${origin}/agendar/${tenant.slug}` : `/agendar/${tenant.slug}`;

  return (
    <AiStudioBoard
      salon={{
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        phone: tenant.phone,
        city: tenant.city,
        address: tenant.address,
        accentColor: tenant.accentColor,
        logoUrl: tenant.logoUrl,
        bookingUrl,
      }}
      catalog={catalog}
      hasOpenAi={integrations.hasOpenAi}
      canManage={canManage}
      instagramPublishEnabled={instagramPublishEnabled}
      instagram={{
        connected: Boolean(tenant.instagramUserId && tenant.instagramUsername),
        username: tenant.instagramUsername,
        pageName: tenant.instagramPageName,
        connectedAt: tenant.instagramConnectedAt?.toISOString() ?? null,
        metaConfigured: integrations.hasMetaInstagram,
        callbackUrl: instagramOAuthCallbackUrl(integrations.publicAppUrl),
      }}
      initialPosts={posts.map((row) => ({
        id: row.id,
        serviceId: row.serviceId,
        packageId: row.packageId,
        title: row.title,
        headline: row.headline,
        badgeText: row.badgeText,
        priceText: row.priceText,
        promoPriceText: row.promoPriceText,
        dateRangeText: row.dateRangeText,
        ctaText: row.ctaText,
        caption: row.caption,
        format: parseStudioFormat(row.format),
        style: parseStudioStyle(row.style),
        imageUrl: row.imageUrl,
        status: row.status,
        publishTarget: row.publishTarget === "STORY" ? "STORY" : "FEED",
        instagramMediaId: row.instagramMediaId,
        instagramPermalink: row.instagramPermalink,
        errorMessage: row.errorMessage,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }))}
    />
  );
}

async function ListsPanel({
  tenantId,
  selectedId,
  canManage,
  hidePhones,
  connected,
}: {
  tenantId: string;
  selectedId: string | null;
  canManage: boolean;
  hidePhones: boolean;
  connected: boolean;
}) {
  await syncMarketingReplies(tenantId, selectedId ?? undefined).catch(() => 0);
  const [campaigns, clients, services] = await Promise.all([
    prisma.marketingCampaign.findMany({
      where: { tenantId },
      include: {
        recipients: {
          include: { client: { select: { name: true } } },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.client.findMany({
      where: { tenantId, active: true },
      select: { tags: true },
    }),
    prisma.service.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const tags = [
    ...new Set(
      clients.flatMap((client) =>
        client.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <MarketingBoard
      canManage={canManage}
      hidePhones={hidePhones}
      connected={connected}
      selectedId={selectedId}
      tags={tags}
      services={services}
      campaigns={campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        body: campaign.body,
        audience: campaign.audience,
        tag: campaign.tag,
        serviceId: campaign.serviceId,
        inactiveDays: campaign.inactiveDays,
        status: campaign.status,
        createdAt: campaign.createdAt.toISOString(),
        sentAt: campaign.sentAt?.toISOString() ?? null,
        recipients: campaign.recipients.map((row) => ({
          id: row.id,
          clientId: row.clientId,
          clientName: row.client.name,
          phone: redactPhone(row.phone, hidePhones),
          status: row.status,
          error: row.error,
          sentAt: row.sentAt?.toISOString() ?? null,
          repliedAt: row.repliedAt?.toISOString() ?? null,
          replyPreview: row.replyPreview,
          conversationId: row.conversationId,
        })),
      }))}
    />
  );
}

async function CampaignsPanel({
  tenantId,
  canManage,
  connected,
}: {
  tenantId: string;
  canManage: boolean;
  connected: boolean;
}) {
  const campaigns = await ensureWhatsAppCampaigns(tenantId);
  void runDueCampaigns(tenantId).catch(() => null);
  return (
    <CampaignsBoard
      canManage={canManage}
      connected={connected}
      campaigns={campaigns.map((row) => ({
        id: row.id,
        trigger: row.trigger,
        template: row.template,
        active: row.active,
      }))}
    />
  );
}
