import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { requirePartner } from "@/lib/tenant";
import { SYSTEM_PRIMARY } from "@/lib/branding";
import { resolvePlatformIntegrations } from "@/lib/integrations";
import { partnerAffiliateUrl, partnerCustomUrl, partnerLandingUrl } from "@/lib/partners";
import { publicAppOrigin } from "@/lib/public-url";
import { serializeMarketingAsset } from "@/lib/marketing-drive-storage";
import { loadPlatformModules } from "@/lib/platform-modules-server";
import { moduleDisabledMessage } from "@/lib/platform-modules";
import { PartnerDriveBoard } from "@/components/parceiro/partner-drive-board";

export default async function ParceiroMateriaisPage() {
  const { partner } = await requirePartner();
  const modules = await loadPlatformModules();
  if (!modules.partnerMarketingDrive) {
    return (
      <div className="rounded-xl border border-line bg-white p-8 text-sm text-ink-soft">
        {moduleDisabledMessage("partnerMarketingDrive")}
      </div>
    );
  }
  const [rows, integrations] = await Promise.all([
    withoutTenantScope(() =>
      prisma.partnerMarketingAsset.findMany({
        where: { active: true },
        orderBy: [{ createdAt: "desc" }],
      }),
    ),
    resolvePlatformIntegrations(),
  ]);

  const origin = publicAppOrigin(integrations.publicAppUrl);
  const partnerUrl =
    partnerCustomUrl(partner.brand?.customHost) ||
    partnerLandingUrl(partner.slug, origin) ||
    partnerAffiliateUrl(partner.slug, origin);

  return (
    <PartnerDriveBoard
      assets={rows.map(serializeMarketingAsset)}
      brand={{
        name: partner.brand?.name || partner.slug,
        logoUrl: partner.brand?.logoUrl || null,
        logoDarkUrl: partner.brand?.logoDarkUrl || null,
        primary: partner.brand?.primary || SYSTEM_PRIMARY,
        partnerUrl,
      }}
    />
  );
}
