"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { canAccess } from "@/lib/permissions";
import { parseBRLToCents, formatBRL } from "@/lib/money";
import { zonedDateTime } from "@/lib/dates";
import { postLedgerEntry } from "@/lib/ledger";
import { centsToPoints, maxRedeemCents, tenantCashbackConfig } from "@/lib/cashback";
import { packageItemLineTotalCents, packageTotalCents } from "@/lib/packages-shared";

function revalidatePackages(clientId?: string) {
  revalidatePath("/pacotes");
  revalidatePath("/comandas");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/financeiro");
  revalidatePath("/dashboard");
}

type ParsedPackageItem = {
  type: "SERVICE" | "PRODUCT";
  serviceId: string | null;
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
};

async function parseSubmittedPackageItems(tenantId: string, formData: FormData): Promise<ParsedPackageItem[]> {
  const keys = formData.getAll("itemKey").map(String);
  const qtys = formData.getAll("itemQty").map(String);
  const prices = formData.getAll("itemPrice").map(String);
  const discounts = formData.getAll("itemDiscount").map(String);
  const discountTypes = formData.getAll("itemDiscountType").map(String);

  const items: ParsedPackageItem[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]?.trim();
    if (!key) continue;
    const [kind, entityId] = key.split(":");
    if (!entityId || (kind !== "SERVICE" && kind !== "PRODUCT")) continue;
    const quantity = Math.max(1, Math.round(Number(String(qtys[i] ?? "1").replace(",", ".")) || 1));
    const inputPriceCents = parseBRLToCents(prices[i] ?? "0");
    const discountInput = discounts[i] ?? "0";
    const discountType = discountTypes[i] === "percent" ? "percent" : "money";

    if (kind === "SERVICE") {
      const service = await prisma.service.findFirst({ where: { id: entityId, tenantId } });
      if (!service) continue;
      const unitPriceCents = prices[i] !== undefined ? inputPriceCents : service.priceCents;
      const gross = quantity * unitPriceCents;
      const discountCents =
        discountType === "percent"
          ? Math.min(gross, Math.round(gross * ((Number(String(discountInput).replace(",", ".")) || 0) / 100)))
          : Math.min(gross, Math.max(0, parseBRLToCents(discountInput)));
      items.push({
        type: "SERVICE",
        serviceId: service.id,
        productId: null,
        description: service.name,
        quantity,
        unitPriceCents,
        discountCents,
      });
    } else {
      const product = await prisma.product.findFirst({ where: { id: entityId, tenantId } });
      if (!product) continue;
      const unitPriceCents = prices[i] !== undefined ? inputPriceCents : product.saleCents;
      const gross = quantity * unitPriceCents;
      const discountCents =
        discountType === "percent"
          ? Math.min(gross, Math.round(gross * ((Number(String(discountInput).replace(",", ".")) || 0) / 100)))
          : Math.min(gross, Math.max(0, parseBRLToCents(discountInput)));
      items.push({
        type: "PRODUCT",
        serviceId: null,
        productId: product.id,
        description: product.name,
        quantity,
        unitPriceCents,
        discountCents,
      });
    }
  }
  return items;
}

async function nextClientPackageNumber(tenantId: string) {
  const last = await prisma.clientPackage.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

export async function upsertPackageTemplate(formData: FormData) {
  const { session, access } = await requireTenant();
  const id = String(formData.get("id") ?? "").trim();
  if (!canAccess(access, "comandas", id ? "edit" : "create")) {
    return { error: "Sem permissão para salvar pacote predefinido." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const validityRaw = String(formData.get("validityDays") ?? "").trim();
  const validityDays = validityRaw ? Math.max(1, Math.round(Number(validityRaw) || 0)) : null;
  const active = formData.get("active") !== "false";

  if (!name) return { error: "Informe o nome do pacote predefinido." };

  const items = await parseSubmittedPackageItems(session.tenantId, formData);
  if (items.length === 0) return { error: "Adicione ao menos um serviço ou produto no pacote." };

  const sessions = items.reduce((sum, item) => sum + item.quantity, 0);
  const priceCents = items.reduce((sum, item) => sum + packageItemLineTotalCents(item), 0);
  const primaryServiceId = items.find((i) => i.type === "SERVICE")?.serviceId ?? null;

  if (id) {
    const existing = await prisma.package.findFirst({
      where: { id, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!existing) return { error: "Pacote predefinido não encontrado." };

    await prisma.package.update({
      where: { id },
      data: {
        name,
        description,
        validityDays,
        active,
        sessions,
        priceCents,
        serviceId: primaryServiceId,
      },
    });
    await prisma.packageItem.deleteMany({ where: { packageId: id } });
    await prisma.packageItem.createMany({
      data: items.map((item) => ({ packageId: id, ...item })),
    });
  } else {
    await prisma.package.create({
      data: {
        tenantId: session.tenantId,
        name,
        description,
        validityDays,
        active,
        sessions,
        priceCents,
        serviceId: primaryServiceId,
        items: { create: items },
      },
    });
  }

  revalidatePackages();
  return { ok: true as const };
}

export async function togglePackageTemplate(id: string, active: boolean) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "edit")) return { error: "Sem permissão para alterar pacote." };
  const existing = await prisma.package.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
  if (!existing) return { error: "Pacote não encontrado." };
  await prisma.package.update({ where: { id }, data: { active } });
  revalidatePackages();
  return { ok: true as const };
}

export async function deletePackageTemplate(id: string) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "remove")) return { error: "Sem permissão para excluir pacote." };
  const existing = await prisma.package.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
  if (!existing) return { error: "Pacote não encontrado." };
  await prisma.package.delete({ where: { id } });
  revalidatePackages();
  return { ok: true as const };
}

export async function createClientPackage(formData: FormData) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "create")) {
    return { error: "Sem permissão para vender pacotes." };
  }

  const clientId = String(formData.get("clientId") ?? "").trim();
  const packageId = String(formData.get("packageId") ?? "").trim() || null;
  const sellerId = String(formData.get("sellerId") ?? "").trim() || null;
  const customName = String(formData.get("name") ?? "").trim();
  const purchasedAtRaw = String(formData.get("purchasedAt") ?? "").trim();
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();
  const discountInput = String(formData.get("discount") ?? "0");
  const discountType = String(formData.get("discountType") ?? "money") === "percent" ? "percent" : "money";
  const creditCents = Math.max(0, parseBRLToCents(String(formData.get("credit") ?? "0")));
  const cashbackCents = Math.max(0, parseBRLToCents(String(formData.get("cashback") ?? "0")));
  const paymentMethodId = String(formData.get("paymentMethodId") ?? "").trim() || null;
  const paymentMethodCode = String(formData.get("paymentMethod") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!clientId) return { error: "Selecione um cliente." };

  const [client, tenant, template] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, tenantId: session.tenantId } }),
    prisma.tenant.findUnique({ where: { id: session.tenantId } }),
    packageId ? prisma.package.findFirst({ where: { id: packageId, tenantId: session.tenantId } }) : Promise.resolve(null),
  ]);
  if (!client) return { error: "Cliente não encontrado." };
  if (!tenant) return { error: "Salão não encontrado." };

  if (sellerId) {
    const seller = await prisma.professional.findFirst({ where: { id: sellerId, tenantId: session.tenantId }, select: { id: true } });
    if (!seller) return { error: "Vendedor inválido." };
  }

  const items = await parseSubmittedPackageItems(session.tenantId, formData);
  if (items.length === 0) return { error: "Adicione ao menos um serviço ou produto no pacote." };

  const itemsSubtotal = items.reduce((sum, item) => sum + packageItemLineTotalCents(item), 0);
  const discountCents =
    discountType === "percent"
      ? Math.min(itemsSubtotal, Math.round(itemsSubtotal * ((Number(discountInput.replace(",", ".")) || 0) / 100)))
      : Math.min(itemsSubtotal, Math.max(0, parseBRLToCents(discountInput)));

  if (creditCents > client.creditCents) {
    return { error: `O cliente possui apenas ${formatBRL(client.creditCents)} em crédito.` };
  }
  const cashbackConfig = tenantCashbackConfig(tenant);
  if (cashbackCents > 0) {
    const allowed = maxRedeemCents(itemsSubtotal, cashbackConfig, client.cashbackCents);
    if (cashbackCents > allowed) {
      return { error: `O cashback usado passa do limite (${formatBRL(allowed)}).` };
    }
  }

  const totalCents = packageTotalCents({
    items,
    discountCents,
    creditCents,
    cashbackCents,
  });

  const purchasedAt = /^\d{4}-\d{2}-\d{2}$/.test(purchasedAtRaw) ? zonedDateTime(purchasedAtRaw, "12:00") : new Date();
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw) ? zonedDateTime(expiresAtRaw, "23:59") : null;
  const totalSessions = items.reduce((sum, item) => sum + item.quantity, 0);
  const number = await nextClientPackageNumber(session.tenantId);
  const resolvedName =
    customName ||
    template?.name ||
    (items.length === 1 ? `${items[0].description} (${items[0].quantity}x)` : `Pacote #${number}`);

  let resolvedMethodCode = paymentMethodCode;
  if (paymentMethodId) {
    const pm = await prisma.paymentMethodConfig.findFirst({
      where: { id: paymentMethodId, tenantId: session.tenantId },
      select: { code: true },
    });
    if (pm) resolvedMethodCode = pm.code;
  }

  const created = await prisma.clientPackage.create({
    data: {
      tenantId: session.tenantId,
      number,
      name: resolvedName,
      clientId: client.id,
      packageId: template?.id ?? null,
      sellerId,
      remaining: totalSessions,
      status: "ACTIVE",
      discountCents,
      creditCents,
      cashbackCents,
      totalCents,
      paymentMethod: totalCents > 0 ? resolvedMethodCode || "PIX" : "COURTESY",
      notes,
      purchasedAt,
      expiresAt,
      items: {
        create: items.map((item) => ({
          type: item.type,
          serviceId: item.serviceId,
          productId: item.productId,
          description: item.description,
          totalQty: item.quantity,
          remainingQty: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
        })),
      },
    },
  });

  if (creditCents > 0 || cashbackCents > 0) {
    await prisma.client.update({
      where: { id: client.id },
      data: {
        creditCents: Math.max(0, client.creditCents - creditCents),
        cashbackCents: Math.max(0, client.cashbackCents - cashbackCents),
      },
    });
    if (cashbackCents > 0) {
      await prisma.cashbackMovement.create({
        data: {
          tenantId: session.tenantId,
          clientId: client.id,
          type: "REDEEM",
          amountCents: -cashbackCents,
          points: -centsToPoints(cashbackCents, cashbackConfig.centsPerPoint),
          reason: `Resgate no pacote #${number}`,
        },
      });
    }
  }

  if (totalCents > 0 && resolvedMethodCode !== "NONE" && resolvedMethodCode !== "COURTESY") {
    await postLedgerEntry({
      tenantId: session.tenantId,
      type: "INCOME",
      category: "pacote",
      amountCents: totalCents,
      methodId: paymentMethodId,
      methodCode: resolvedMethodCode || "PIX",
      description: `Pacote #${number} · ${client.name}`,
      professionalId: sellerId,
      occurredAt: purchasedAt,
    });
  }

  revalidatePackages(client.id);
  return { ok: true as const, id: created.id, number };
}

export async function consumeClientPackageItemManual(formData: FormData) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "edit")) {
    return { error: "Sem permissão para dar baixa no pacote." };
  }

  const clientPackageItemId = String(formData.get("clientPackageItemId") ?? "").trim();
  const quantity = Math.max(1, Math.round(Number(formData.get("quantity") ?? "1") || 1));
  const notes = String(formData.get("notes") ?? "").trim() || "Baixa manual";

  const item = await prisma.clientPackageItem.findFirst({
    where: {
      id: clientPackageItemId,
      clientPackage: { tenantId: session.tenantId },
    },
    include: {
      clientPackage: { include: { items: true } },
    },
  });
  if (!item) return { error: "Item do pacote não encontrado." };
  if (item.clientPackage.status !== "ACTIVE") return { error: "Este pacote não está mais ativo." };
  if (item.clientPackage.expiresAt && item.clientPackage.expiresAt.getTime() < Date.now()) {
    return { error: "Este pacote já venceu." };
  }
  if (item.remainingQty < quantity) {
    return { error: `Saldo insuficiente (restam ${item.remainingQty}).` };
  }

  const nextItemRemaining = item.remainingQty - quantity;
  await prisma.clientPackageItem.update({
    where: { id: item.id },
    data: { remainingQty: nextItemRemaining },
  });
  await prisma.clientPackageUsage.create({
    data: {
      tenantId: session.tenantId,
      clientPackageId: item.clientPackageId,
      clientPackageItemId: item.id,
      quantity,
      notes,
    },
  });

  const nextTotalRemaining = item.clientPackage.items.reduce(
    (sum, row) => sum + (row.id === item.id ? nextItemRemaining : row.remainingQty),
    0,
  );
  await prisma.clientPackage.update({
    where: { id: item.clientPackageId },
    data: {
      remaining: nextTotalRemaining,
      status: nextTotalRemaining <= 0 ? "CONSUMED" : "ACTIVE",
    },
  });

  revalidatePackages(item.clientPackage.clientId);
  return { ok: true as const };
}

export async function cancelClientPackage(id: string) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "remove")) {
    return { error: "Sem permissão para cancelar pacotes." };
  }
  const existing = await prisma.clientPackage.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, clientId: true },
  });
  if (!existing) return { error: "Pacote não encontrado." };

  await prisma.clientPackage.update({
    where: { id },
    data: { status: "CANCELLED", remaining: 0 },
  });

  revalidatePackages(existing.clientId);
  return { ok: true as const };
}
