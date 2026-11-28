import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { requirePlatformAdmin } from "@/lib/tenant";
import { serializeMarketingAsset } from "@/lib/marketing-drive-storage";
import { PlatformMarketingDriveBoard } from "@/components/plataforma/marketing-drive-board";

export default async function PlataformaMateriaisPage() {
  await requirePlatformAdmin();
  const rows = await withoutTenantScope(() =>
    prisma.partnerMarketingAsset.findMany({
      orderBy: [{ createdAt: "desc" }],
    }),
  );
  return <PlatformMarketingDriveBoard assets={rows.map(serializeMarketingAsset)} />;
}
