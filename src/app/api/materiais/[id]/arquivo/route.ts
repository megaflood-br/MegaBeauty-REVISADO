import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import { sanitizeDownloadFilename } from "@/lib/marketing-drive";
import { readMarketingDriveFile, requireMarketingReadApi } from "@/lib/marketing-drive-storage";
import { checkPlatformModule } from "@/lib/platform-modules-server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingReadApi();
  if (!auth.ok) {
    return new NextResponse(auth.error, { status: auth.status });
  }
  if (auth.role === "PARTNER") {
    const mod = await checkPlatformModule("partnerMarketingDrive");
    if (!mod.ok) {
      return new NextResponse(mod.error, { status: 403 });
    }
  }

  const { id } = await params;
  const asset = await withoutTenantScope(() =>
    prisma.partnerMarketingAsset.findUnique({ where: { id } }),
  );
  if (!asset) return new NextResponse("Material não encontrado.", { status: 404 });
  if (auth.role === "PARTNER" && !asset.active) {
    return new NextResponse("Material indisponível.", { status: 404 });
  }

  const data = await readMarketingDriveFile(asset.filePath);
  if (!data) return new NextResponse("Arquivo não encontrado.", { status: 404 });

  const url = new URL(request.url);
  const isDownload = url.searchParams.get("download") === "1";

  if (isDownload && auth.role === "PARTNER") {
    await withoutTenantScope(() =>
      prisma.partnerMarketingAsset.update({
        where: { id: asset.id },
        data: { downloadsCount: { increment: 1 } },
      }),
    ).catch(() => null);
  }

  const ext = path.extname(asset.filePath) || ".bin";
  const downloadName = sanitizeDownloadFilename(asset.title, ext);

  const headers = new Headers({
    "Content-Type": asset.mimeType,
    "Content-Length": String(data.byteLength),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  });

  if (isDownload) {
    headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
  } else {
    headers.set("Content-Disposition", `inline; filename="${downloadName}"`);
  }

  return new NextResponse(new Uint8Array(data), { status: 200, headers });
}
