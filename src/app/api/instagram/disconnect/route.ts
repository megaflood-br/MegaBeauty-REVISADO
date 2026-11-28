import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSalonMarketingApi } from "@/lib/instagram-server";

export const runtime = "nodejs";

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

    await prisma.tenant.update({
      where: { id: auth.session.tenantId },
      data: {
        instagramUserId: null,
        instagramUsername: null,
        instagramPageId: null,
        instagramPageName: null,
        instagramAccessToken: null,
        instagramConnectedAt: null,
      },
    });

    revalidatePath("/marketing");
    return json({ ok: true });
  } catch (cause) {
    console.error("instagram disconnect failed", cause);
    return json({ error: "Não foi possível desconectar o Instagram." }, 500);
  }
}
