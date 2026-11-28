import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { requireMarketingReadApi, verifySameOrigin } from "@/lib/marketing-drive-storage";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const auth = await requireMarketingReadApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const asset = await withoutTenantScope(() =>
    prisma.partnerMarketingAsset.findUnique({ where: { id }, select: { id: true, active: true } }),
  );
  if (!asset || (auth.role === "PARTNER" && !asset.active)) {
    return NextResponse.json({ error: "Material não encontrado." }, { status: 404 });
  }

  if (auth.role === "PARTNER") {
    await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.update({
        where: { id: asset.id },
        data: { downloadsCount: { increment: 1 } },
      }),
    ).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
