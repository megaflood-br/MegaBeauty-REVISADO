"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertProductsInTenant, assertServiceCategoryInTenant, requireTenant } from "@/lib/tenant";
import { parseBRLToCents } from "@/lib/money";

export async function upsertService(formData: FormData) {
  const { session } = await requireTenant();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const durationMin = Number(formData.get("durationMin") ?? 15);
  const safeDuration = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 15;
  const priceCents = Math.max(0, parseBRLToCents(String(formData.get("price") ?? "0")));
  const extraCostCents = Math.max(0, parseBRLToCents(String(formData.get("extraCost") ?? "0")));
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  const toNullableInt = (raw: FormDataEntryValue | null) => {
    const text = String(raw ?? "")
      .replace("%", "")
      .replace("R$", "")
      .replace(/\s/g, "")
      .replace(",", ".")
      .trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
  };
  const commissionPct = toNullableInt(formData.get("commissionPct"));
  const cashbackPct = toNullableInt(formData.get("cashbackPct"));
  const returnRaw = Number(formData.get("returnAfterDays") ?? "");
  const returnAfterDays = Number.isFinite(returnRaw) && returnRaw > 0 ? returnRaw : null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const aftercare = String(formData.get("aftercare") ?? "").trim() || null;
  const priceType = String(formData.get("priceType") ?? "fixed") === "from" ? "from" : "fixed";
  const color = String(formData.get("color") ?? "#6366F1");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  const active = String(formData.get("active") ?? "") !== "0";
  const onlineBooking = String(formData.get("onlineBooking") ?? "") !== "0";
  const favorite = String(formData.get("favorite") ?? "") === "1";

  if (!name) return { error: "Nome do serviço é obrigatório." };
  if (imageUrl && imageUrl.length > 400_000) {
    return { error: "Imagem muito grande. Use uma foto menor." };
  }
  if (categoryId && !(await assertServiceCategoryInTenant(session.tenantId, categoryId))) {
    return { error: "Categoria inválida." };
  }

  const productIds = formData.getAll("consumedProductId").map(String);
  const productQtys = formData.getAll("consumedQty").map(String);
  const products = productIds
    .map((productId, index) => ({
      productId,
      quantity: Math.max(0.01, Number(productQtys[index] ?? 1) || 1),
    }))
    .filter((row) => row.productId);

  if (!(await assertProductsInTenant(session.tenantId, products.map((p) => p.productId)))) {
    return { error: "Um ou mais produtos vinculados são inválidos." };
  }

  const data = {
    name,
    durationMin: safeDuration,
    priceCents,
    extraCostCents,
    categoryId,
    commissionPct,
    cashbackPct,
    description,
    aftercare,
    returnAfterDays,
    priceType,
    color,
    imageUrl,
    active,
    onlineBooking,
    favorite,
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (id) {
        const existing = await tx.service.findFirst({ where: { id, tenantId: session.tenantId } });
        if (!existing) return { error: "Serviço não encontrado." };
        await tx.service.update({ where: { id }, data });
        await tx.serviceProduct.deleteMany({ where: { serviceId: id } });
        if (products.length) {
          await tx.serviceProduct.createMany({
            data: products.map((row) => ({ serviceId: id, productId: row.productId, quantity: row.quantity })),
          });
        }
      } else {
        const created = await tx.service.create({
          data: { tenantId: session.tenantId, ...data },
        });
        if (products.length) {
          await tx.serviceProduct.createMany({
            data: products.map((row) => ({ serviceId: created.id, productId: row.productId, quantity: row.quantity })),
          });
        }
      }
      return { ok: true as const };
    });
    if ("error" in result) return result;
  } catch (err) {
    console.error("upsertService", err);
    return { error: "Não foi possível salvar o serviço. Confira os campos e tente de novo." };
  }

  revalidatePath("/servicos");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function toggleService(id: string, active: boolean) {
  const { session } = await requireTenant();
  await prisma.service.updateMany({
    where: { id, tenantId: session.tenantId },
    data: { active },
  });
  revalidatePath("/servicos");
  return { ok: true };
}

export async function toggleServiceFavorite(id: string) {
  const { session } = await requireTenant();
  const service = await prisma.service.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { favorite: true },
  });
  if (!service) return { error: "Serviço não encontrado." };
  await prisma.service.update({ where: { id }, data: { favorite: !service.favorite } });
  revalidatePath("/servicos");
  return { ok: true };
}
