"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { calculateCommission } from "@/lib/commissions";
import { nextStock } from "@/lib/stock";
import { allocatePayments, comandaSubtotal, comandaTotal } from "@/lib/comandas";
import { parseBRLToCents, formatBRL } from "@/lib/money";
import { calendarDate, zonedDateTime } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/constants";
import { postLedgerEntry } from "@/lib/ledger";
import {
  cashbackExpiry,
  centsToPoints,
  earnCashbackCents,
  maxRedeemCents,
  tenantCashbackConfig,
} from "@/lib/cashback";
import { applyCatalogPrice } from "@/lib/promotions";
import { loadPromoRules } from "@/lib/promo-load";
import { moneyVar, safeDispatch } from "@/lib/dispatch-whatsapp-campaign";
import { safeNotifyAppointmentStatusChange } from "@/lib/appointment-status-notify";
import { canAccess } from "@/lib/permissions";
import { loadClientActivePackageBalances } from "@/lib/packages";
import { isClientPackageExpired, matchAvailablePackageItem } from "@/lib/packages-shared";

async function nextNumber(tenantId: string) {
  const last = await prisma.comanda.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

function revalidateComandas() {
  revalidatePath("/comandas");
  revalidatePath("/pacotes");
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  revalidatePath("/financeiro");
  revalidatePath("/comissoes");
  revalidatePath("/estoque");
  revalidatePath("/cadastros");
}

export async function createComandaFromAppointment(appointmentId: string) {
  const { session, access } = await requireTenant();
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: session.tenantId },
    include: { items: { include: { service: true } }, comanda: true },
  });
  if (!appointment) return { error: "Agendamento não encontrado." };
  if (appointment.comanda) {
    if (!canAccess(access, "comandas")) return { error: "Sem permissão para abrir comanda." };
    return { ok: true as const, id: appointment.comanda.id, existing: true };
  }
  if (!canAccess(access, "comandas", "create")) return { error: "Sem permissão para abrir comanda." };

  const balancesMap = await loadClientActivePackageBalances(session.tenantId, appointment.clientId);
  const clientBalances = balancesMap[appointment.clientId] ?? [];
  const allocatedByPkgItem: Record<string, number> = {};

  const comanda = await prisma.comanda.create({
    data: {
      tenantId: session.tenantId,
      number: await nextNumber(session.tenantId),
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      professionalId: appointment.professionalId,
      status: "OPEN",
      items: {
        create: appointment.items.map((item) => {
          const matched = matchAvailablePackageItem(clientBalances, "SERVICE", item.serviceId, 1, allocatedByPkgItem);
          if (matched) {
            allocatedByPkgItem[matched.id] = (allocatedByPkgItem[matched.id] ?? 0) + 1;
          }
          return {
            type: "SERVICE",
            serviceId: item.serviceId,
            professionalId: item.professionalId ?? appointment.professionalId,
            clientPackageItemId: matched?.id ?? null,
            description: item.service.name,
            quantity: 1,
            priceCents: matched ? 0 : item.priceCents,
            durationMin: item.durationMin,
          };
        }),
      },
    },
  });

  const nextStatus =
    appointment.status === "PENDING" || appointment.status === "AI_BOOKED" ? "CONFIRMED" : appointment.status;
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: nextStatus },
  });
  if (nextStatus !== appointment.status) {
    safeNotifyAppointmentStatusChange({
      tenantId: session.tenantId,
      appointmentId: appointment.id,
      previousStatus: appointment.status,
      nextStatus,
    });
  }

  revalidateComandas();
  revalidatePath("/atendimento");
  return { ok: true as const, id: comanda.id, existing: false };
}

export async function upsertComanda(formData: FormData) {
  const { session, access } = await requireTenant();
  const id = String(formData.get("id") ?? "");
  if (!canAccess(access, "comandas", id ? "edit" : "create")) {
    return { error: "Sem permissão para alterar comanda." };
  }
  const clientId = String(formData.get("clientId") ?? "");
  const professionalId = String(formData.get("professionalId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const discountCents = parseBRLToCents(String(formData.get("discount") ?? "0"));
  const creditCents = parseBRLToCents(String(formData.get("credit") ?? "0"));
  const cashbackCents = parseBRLToCents(String(formData.get("cashback") ?? "0"));
  const dateRaw = String(formData.get("occurredAt") ?? "");
  const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? zonedDateTime(dateRaw, "12:00") : new Date();
  const numberRaw = Number(formData.get("number") ?? "");

  if (!clientId) return { error: "Selecione um cliente." };

  const keys = formData.getAll("itemKey").map(String);
  const qtys = formData.getAll("itemQty").map(String);
  const prices = formData.getAll("itemPrice").map(String);
  const discounts = formData.getAll("itemDiscount").map(String);
  const discountTypes = formData.getAll("itemDiscountType").map(String);
  const itemProfessionals = formData.getAll("itemProfessionalId").map(String);
  const itemPackageIds = formData.getAll("itemPackageItemId").map(String);

  const [promos, balancesMap] = await Promise.all([
    loadPromoRules(session.tenantId),
    loadClientActivePackageBalances(session.tenantId, clientId),
  ]);
  const clientBalances = balancesMap[clientId] ?? [];
  const balanceById = new Map(clientBalances.map((b) => [b.id, b]));
  const allocatedByPkgItem: Record<string, number> = {};

  const parsedItems: {
    type: string;
    serviceId: string | null;
    productId: string | null;
    professionalId: string | null;
    clientPackageItemId: string | null;
    description: string;
    quantity: number;
    priceCents: number;
    discountCents: number;
    durationMin: number;
  }[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key) continue;
    const [kind, entityId] = key.split(":");
    const quantity = Number(String(qtys[i] ?? "1").replace(",", ".")) || 1;
    const priceCents = parseBRLToCents(prices[i] ?? "0");
    const discountInput = discounts[i] ?? "0";
    const discountType = discountTypes[i] === "percent" ? "percent" : "money";
    const requestedPkgItemId = (itemPackageIds[i] ?? "").trim() || null;

    let validatedPkgItemId: string | null = null;
    if (requestedPkgItemId) {
      const pkgBalance = balanceById.get(requestedPkgItemId);
      const unitsNeeded = Math.max(1, Math.ceil(quantity));
      if (!pkgBalance || pkgBalance.type !== kind || pkgBalance.catalogId !== entityId) {
        return { error: "Um dos itens vinculados ao pacote não corresponde ao saldo ativo do cliente." };
      }
      const alreadyUsed = allocatedByPkgItem[pkgBalance.id] ?? 0;
      if (pkgBalance.remainingQty - alreadyUsed < unitsNeeded) {
        return { error: `Saldo insuficiente no pacote #${pkgBalance.packageNumber} para ${pkgBalance.description}.` };
      }
      allocatedByPkgItem[pkgBalance.id] = alreadyUsed + unitsNeeded;
      validatedPkgItemId = pkgBalance.id;
    }

    const gross = Math.round(quantity * priceCents);
    const discountCentsItem =
      discountType === "percent"
        ? Math.round(gross * ((Number(String(discountInput).replace(",", ".")) || 0) / 100))
        : parseBRLToCents(discountInput);

    if (kind === "SERVICE") {
      const service = await prisma.service.findFirst({ where: { id: entityId, tenantId: session.tenantId } });
      if (!service) continue;
      if (validatedPkgItemId) {
        parsedItems.push({
          type: "SERVICE",
          serviceId: service.id,
          productId: null,
          professionalId: itemProfessionals[i] || professionalId,
          clientPackageItemId: validatedPkgItemId,
          description: service.name,
          quantity,
          priceCents: 0,
          discountCents: 0,
          durationMin: service.durationMin,
        });
      } else {
        const priced = applyCatalogPrice(
          promos,
          dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : calendarDate(),
          "SERVICE",
          service.id,
          service.priceCents,
          priceCents || undefined,
        );
        parsedItems.push({
          type: "SERVICE",
          serviceId: service.id,
          productId: null,
          professionalId: itemProfessionals[i] || professionalId,
          clientPackageItemId: null,
          description: priced.promoName ? `${service.name} (${priced.promoName})` : service.name,
          quantity,
          priceCents: priced.priceCents,
          discountCents: Math.min(Math.round(quantity * priced.priceCents), Math.max(0, discountCentsItem)),
          durationMin: service.durationMin,
        });
      }
    } else if (kind === "PRODUCT") {
      const product = await prisma.product.findFirst({ where: { id: entityId, tenantId: session.tenantId } });
      if (!product) continue;
      if (validatedPkgItemId) {
        parsedItems.push({
          type: "PRODUCT",
          serviceId: null,
          productId: product.id,
          professionalId: itemProfessionals[i] || professionalId,
          clientPackageItemId: validatedPkgItemId,
          description: product.name,
          quantity,
          priceCents: 0,
          discountCents: 0,
          durationMin: 0,
        });
      } else {
        const priced = applyCatalogPrice(
          promos,
          dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : calendarDate(),
          "PRODUCT",
          product.id,
          product.saleCents,
          priceCents || undefined,
        );
        parsedItems.push({
          type: "PRODUCT",
          serviceId: null,
          productId: product.id,
          professionalId: itemProfessionals[i] || professionalId,
          clientPackageItemId: null,
          description: priced.promoName ? `${product.name} (${priced.promoName})` : product.name,
          quantity,
          priceCents: priced.priceCents,
          discountCents: Math.min(Math.round(quantity * priced.priceCents), Math.max(0, discountCentsItem)),
          durationMin: 0,
        });
      }
    }
  }

  try {
    let comandaId = id;
    let number = Number.isFinite(numberRaw) && numberRaw > 0 ? Math.round(numberRaw) : await nextNumber(session.tenantId);

    if (id) {
      const existing = await prisma.comanda.findFirst({ where: { id, tenantId: session.tenantId } });
      if (!existing) return { error: "Comanda não encontrada." };
      if (existing.status !== "OPEN") return { error: "Esta comanda já foi encerrada." };
      if (number !== existing.number) {
        const taken = await prisma.comanda.findFirst({ where: { tenantId: session.tenantId, number } });
        if (taken) return { error: "Já existe uma comanda com este número." };
      }
      await prisma.comanda.update({
        where: { id },
        data: {
          clientId,
          professionalId,
          notes,
          discountCents,
          creditCents,
          cashbackCents,
          occurredAt,
          number,
        },
      });
      await prisma.comandaItem.deleteMany({ where: { comandaId: id } });
    } else {
      const taken = await prisma.comanda.findFirst({ where: { tenantId: session.tenantId, number } });
      if (taken) number = await nextNumber(session.tenantId);
      const created = await prisma.comanda.create({
        data: {
          tenantId: session.tenantId,
          number,
          clientId,
          professionalId,
          notes,
          discountCents,
          creditCents,
          cashbackCents,
          occurredAt,
          status: "OPEN",
        },
      });
      comandaId = created.id;
    }

    if (parsedItems.length) {
      await prisma.comandaItem.createMany({
        data: parsedItems.map((item) => ({ comandaId, ...item })),
      });
    }
    revalidateComandas();
    revalidatePath(`/comandas/${comandaId}`);
    return { ok: true, id: comandaId };
  } catch (err) {
    if (
      typeof err === "object" &&
      err &&
      "digest" in err &&
      String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    console.error("upsertComanda", err);
    return { error: "Não foi possível salvar a comanda. Confira os campos e tente de novo." };
  }
}

export async function createWalkInComanda(formData: FormData) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "create")) return { error: "Sem permissão para abrir comanda." };
  const clientId = String(formData.get("clientId") ?? "");
  const professionalId = String(formData.get("professionalId") ?? "") || null;
  if (!clientId) return { error: "Selecione um cliente." };

  const comanda = await prisma.comanda.create({
    data: {
      tenantId: session.tenantId,
      number: await nextNumber(session.tenantId),
      clientId,
      professionalId,
      status: "OPEN",
    },
  });
  revalidateComandas();
  redirect(`/comandas/${comanda.id}`);
}

export async function addComandaItem(formData: FormData) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "edit")) return { error: "Sem permissão para alterar comanda." };
  const comandaId = String(formData.get("comandaId") ?? "");
  const type = String(formData.get("type") ?? "SERVICE");
  const serviceId = String(formData.get("serviceId") ?? "") || null;
  const productId = String(formData.get("productId") ?? "") || null;
  const professionalId = String(formData.get("professionalId") ?? "") || null;
  const quantity = Number(formData.get("quantity") ?? 1) || 1;

  const comanda = await prisma.comanda.findFirst({
    where: { id: comandaId, tenantId: session.tenantId, status: "OPEN" },
    include: { items: true },
  });
  if (!comanda) return { error: "Comanda não encontrada ou já fechada." };

  const [promos, balancesMap] = await Promise.all([
    loadPromoRules(session.tenantId),
    loadClientActivePackageBalances(session.tenantId, comanda.clientId),
  ]);
  const clientBalances = balancesMap[comanda.clientId] ?? [];
  const allocatedByPkgItem: Record<string, number> = {};
  for (const existingItem of comanda.items) {
    if (existingItem.clientPackageItemId) {
      allocatedByPkgItem[existingItem.clientPackageItemId] =
        (allocatedByPkgItem[existingItem.clientPackageItemId] ?? 0) + Math.max(1, Math.ceil(existingItem.quantity));
    }
  }
  const onDate = calendarDate(comanda.occurredAt);

  if (type === "SERVICE") {
    const service = await prisma.service.findFirst({
      where: { id: serviceId ?? "", tenantId: session.tenantId },
    });
    if (!service) return { error: "Selecione um serviço." };
    const matched = matchAvailablePackageItem(clientBalances, "SERVICE", service.id, quantity, allocatedByPkgItem);
    const priced = applyCatalogPrice(promos, onDate, "SERVICE", service.id, service.priceCents);
    await prisma.comandaItem.create({
      data: {
        comandaId,
        type: "SERVICE",
        serviceId: service.id,
        professionalId: professionalId ?? comanda.professionalId,
        clientPackageItemId: matched?.id ?? null,
        description: matched ? service.name : priced.promoName ? `${service.name} (${priced.promoName})` : service.name,
        quantity,
        priceCents: matched ? 0 : priced.priceCents,
        durationMin: service.durationMin,
      },
    });
  } else {
    const product = await prisma.product.findFirst({
      where: { id: productId ?? "", tenantId: session.tenantId },
    });
    if (!product) return { error: "Selecione um produto." };
    const matched = matchAvailablePackageItem(clientBalances, "PRODUCT", product.id, quantity, allocatedByPkgItem);
    const priced = applyCatalogPrice(promos, onDate, "PRODUCT", product.id, product.saleCents);
    await prisma.comandaItem.create({
      data: {
        comandaId,
        type: "PRODUCT",
        productId: product.id,
        clientPackageItemId: matched?.id ?? null,
        description: matched ? product.name : priced.promoName ? `${product.name} (${priced.promoName})` : product.name,
        quantity,
        priceCents: matched ? 0 : priced.priceCents,
      },
    });
  }

  revalidatePath(`/comandas/${comandaId}`);
  revalidatePath("/comandas");
  return { ok: true };
}

export async function removeComandaItem(itemId: string) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "edit")) return { error: "Sem permissão para alterar comanda." };
  const item = await prisma.comandaItem.findFirst({
    where: { id: itemId, comanda: { tenantId: session.tenantId, status: "OPEN" } },
  });
  if (!item) return { error: "Item não encontrado." };
  await prisma.comandaItem.delete({ where: { id: item.id } });
  revalidatePath(`/comandas/${item.comandaId}`);
  revalidatePath("/comandas");
  return { ok: true };
}

export async function removeComandaItemForm(formData: FormData) {
  return removeComandaItem(String(formData.get("itemId") ?? ""));
}

type ParsedPayment = {
  method: string;
  paymentMethodId?: string;
  amountCents: number;
  installments: number;
  occurredAt: Date;
};

function parsePayments(formData: FormData): ParsedPayment[] {
  const methods = formData.getAll("payMethod").map(String);
  const methodIds = formData.getAll("payMethodId").map(String);
  const amounts = formData.getAll("payAmount").map(String);
  const installments = formData.getAll("payInstallments").map(String);
  const dates = formData.getAll("payDate").map(String);
  const allowed = new Set<string>(PAYMENT_METHODS);
  const payments: ParsedPayment[] = [];
  const count = Math.max(methods.length, methodIds.length, amounts.length);
  for (let i = 0; i < count; i++) {
    const method = methods[i] ?? "";
    const paymentMethodId = methodIds[i] || undefined;
    if (!paymentMethodId && !allowed.has(method)) continue;
    const amountCents = parseBRLToCents(amounts[i] ?? "0");
    if (amountCents <= 0) continue;
    const qty = Math.max(1, Math.min(12, Math.round(Number(installments[i] ?? "1") || 1)));
    const dateRaw = dates[i] ?? "";
    const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? zonedDateTime(dateRaw, "12:00") : new Date();
    payments.push({ method: method || "PIX", paymentMethodId, amountCents, installments: qty, occurredAt });
  }
  return payments;
}

async function finalizeOpenComanda(
  tenantId: string,
  comandaId: string,
  payments: ParsedPayment[],
  discountOverride?: number,
) {
  const comanda = await prisma.comanda.findFirst({
    where: { id: comandaId, tenantId },
    include: {
      items: {
        include: {
          service: { include: { products: true } },
          product: true,
          clientPackageItem: { include: { clientPackage: true } },
        },
      },
      appointment: { include: { commissions: true } },
    },
  });
  if (!comanda) return { error: "Comanda não encontrada." };
  if (comanda.status !== "OPEN") return { error: "Esta comanda já foi encerrada." };
  if (comanda.items.length === 0) return { error: "Inclua itens antes de fechar." };

  const packageUnitsByItemId = new Map<string, number>();
  for (const item of comanda.items) {
    if (!item.clientPackageItemId) continue;
    const pkgItem = item.clientPackageItem;
    if (!pkgItem || pkgItem.clientPackage.tenantId !== tenantId || pkgItem.clientPackage.clientId !== comanda.clientId) {
      return { error: `Pacote inválido para o item "${item.description}".` };
    }
    if (pkgItem.clientPackage.status !== "ACTIVE") {
      return { error: `O pacote #${pkgItem.clientPackage.number} não está mais ativo.` };
    }
    if (isClientPackageExpired(pkgItem.clientPackage.expiresAt)) {
      return { error: `O pacote #${pkgItem.clientPackage.number} já venceu.` };
    }
    const units = Math.max(1, Math.ceil(item.quantity));
    const totalNeeded = (packageUnitsByItemId.get(pkgItem.id) ?? 0) + units;
    if (pkgItem.remainingQty < totalNeeded) {
      return { error: `Saldo insuficiente no pacote #${pkgItem.clientPackage.number} para "${item.description}".` };
    }
    packageUnitsByItemId.set(pkgItem.id, totalNeeded);
  }

  const discountCents = discountOverride ?? comanda.discountCents;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { error: "Salão não encontrado." };
  const cashback = tenantCashbackConfig(tenant);
  const client = await prisma.client.findFirst({ where: { id: comanda.clientId, tenantId } });
  if (comanda.cashbackCents > 0) {
    const allowed = maxRedeemCents(comandaSubtotal(comanda.items), cashback, client?.cashbackCents ?? 0);
    if (comanda.cashbackCents > allowed) {
      return { error: `O cashback usado passa do limite (${formatBRL(allowed)}).` };
    }
  }
  const total = comandaTotal({
    items: comanda.items,
    discountCents,
    creditCents: comanda.creditCents,
    cashbackCents: comanda.cashbackCents,
  });
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  if (total > 0 && !payments.length) return { error: "Adicione um pagamento." };
  if (paidCents < total) return { error: "O total pago é menor que o valor da comanda." };

  const hasPackageItems = packageUnitsByItemId.size > 0;
  const allocated = total > 0 ? allocatePayments(total, payments) : [];
  const primary = allocated.find((p) => p.appliedCents > 0) ?? allocated[0];
  const resolvedPaymentMethod = primary?.method ?? (hasPackageItems ? "PACKAGE" : "CASH");

  await prisma.comanda.update({
    where: { id: comanda.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      paymentMethod: resolvedPaymentMethod,
      discountCents,
    },
  });

  if (packageUnitsByItemId.size > 0) {
    const affectedPackageIds = new Set<string>();
    for (const [pkgItemId, units] of packageUnitsByItemId.entries()) {
      const pkgItem = await prisma.clientPackageItem.findUnique({
        where: { id: pkgItemId },
        select: { id: true, clientPackageId: true, remainingQty: true },
      });
      if (!pkgItem) continue;
      affectedPackageIds.add(pkgItem.clientPackageId);
      await prisma.clientPackageItem.update({
        where: { id: pkgItem.id },
        data: { remainingQty: Math.max(0, pkgItem.remainingQty - units) },
      });
      await prisma.clientPackageUsage.create({
        data: {
          tenantId,
          clientPackageId: pkgItem.clientPackageId,
          clientPackageItemId: pkgItem.id,
          comandaId: comanda.id,
          quantity: units,
          notes: `Baixa automática na comanda #${comanda.number}`,
        },
      });
    }
    for (const pkgId of affectedPackageIds) {
      const siblingItems = await prisma.clientPackageItem.findMany({
        where: { clientPackageId: pkgId },
        select: { remainingQty: true },
      });
      const nextRemaining = siblingItems.reduce((sum, r) => sum + r.remainingQty, 0);
      await prisma.clientPackage.update({
        where: { id: pkgId },
        data: {
          remaining: nextRemaining,
          status: nextRemaining <= 0 ? "CONSUMED" : "ACTIVE",
        },
      });
    }
  }

  if (client && (comanda.creditCents > 0 || comanda.cashbackCents > 0 || cashback.enabled)) {
    let nextCashback = client.cashbackCents;
    const movements: {
      type: "EARN" | "REDEEM";
      amountCents: number;
      points: number;
      reason: string;
      expiresAt: Date | null;
    }[] = [];

    if (comanda.creditCents > 0 || comanda.cashbackCents > 0) {
      nextCashback = Math.max(0, nextCashback - comanda.cashbackCents);
      if (comanda.cashbackCents > 0) {
        movements.push({
          type: "REDEEM",
          amountCents: -comanda.cashbackCents,
          points: -centsToPoints(comanda.cashbackCents, cashback.centsPerPoint),
          reason: `Resgate na comanda #${comanda.number}`,
          expiresAt: null,
        });
      }
    }

    if (cashback.enabled) {
      const earned = earnCashbackCents(
        comanda.items.map((item) => ({
          type: item.type,
          quantity: item.quantity,
          priceCents: item.priceCents,
          discountCents: item.discountCents,
          cashbackPct: item.type === "PRODUCT" ? item.product?.cashbackPct : item.service?.cashbackPct,
        })),
        cashback,
      );
      if (earned > 0) {
        nextCashback += earned;
        movements.push({
          type: "EARN",
          amountCents: earned,
          points: centsToPoints(earned, cashback.centsPerPoint),
          reason: `Acúmulo da comanda #${comanda.number}`,
          expiresAt: cashbackExpiry(cashback.expireDays),
        });
        safeDispatch({
          tenantId,
          trigger: "CASHBACK",
          client,
          sentOn: comanda.id,
          vars: { valor: moneyVar(earned) },
        });
      }
    }

    await prisma.client.update({
      where: { id: client.id },
      data: {
        creditCents: Math.max(0, client.creditCents - comanda.creditCents),
        cashbackCents: nextCashback,
      },
    });
    if (movements.length) {
      await prisma.cashbackMovement.createMany({
        data: movements.map((move) => ({
          tenantId,
          clientId: client.id,
          comandaId: comanda.id,
          ...move,
        })),
      });
    }
  }

  for (const payment of allocated) {
    if (payment.appliedCents <= 0) continue;
    await postLedgerEntry({
      tenantId,
      type: "INCOME",
      category: "comanda",
      amountCents: payment.appliedCents,
      methodId: payment.paymentMethodId,
      methodCode: payment.method,
      description:
        payment.installments > 1 ? `Comanda #${comanda.number} · ${payment.installments}x` : `Comanda #${comanda.number}`,
      appointmentId: comanda.appointmentId,
      comandaId: comanda.id,
      occurredAt: payment.occurredAt,
    });
  }

  for (const item of comanda.items.filter((i) => i.type === "SERVICE")) {
    const professionalId = item.professionalId ?? comanda.professionalId;
    if (!professionalId) continue;
    const professional = await prisma.professional.findFirst({
      where: { id: professionalId, tenantId },
    });
    if (!professional) continue;
    const commissionUnitPriceCents =
      item.clientPackageItemId && item.priceCents === 0 && item.clientPackageItem
        ? item.clientPackageItem.unitPriceCents
        : item.priceCents;
    const { percent, amountCents } = calculateCommission({
      priceCents: Math.round(commissionUnitPriceCents * item.quantity),
      professionalPct: professional.commissionPct,
      servicePct: item.service?.commissionPct,
    });
    await prisma.commission.create({
      data: {
        tenantId,
        professionalId,
        appointmentId: comanda.appointmentId,
        comandaId: comanda.id,
        amountCents,
        percent,
      },
    });
  }

  for (const item of comanda.items) {
    if (item.type === "PRODUCT" && item.productId) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, tenantId },
      });
      if (!product) continue;
      const stock = nextStock(product.stock, "OUT", item.quantity);
      await prisma.product.update({ where: { id: product.id }, data: { stock } });
      await prisma.stockMovement.create({
        data: {
          tenantId,
          productId: product.id,
          type: "OUT",
          quantity: item.quantity,
          reason: `Comanda #${comanda.number}`,
          comandaId: comanda.id,
          appointmentId: comanda.appointmentId,
        },
      });
    }
    if (item.type === "SERVICE" && item.service) {
      for (const usage of item.service.products) {
        const product = await prisma.product.findFirst({
          where: { id: usage.productId, tenantId },
        });
        if (!product) continue;
        const qty = usage.quantity * item.quantity;
        const stock = nextStock(product.stock, "OUT", qty);
        await prisma.product.update({ where: { id: product.id }, data: { stock } });
        await prisma.stockMovement.create({
          data: {
            tenantId,
            productId: product.id,
            type: "OUT",
            quantity: qty,
            reason: `Uso em ${item.description}`,
            comandaId: comanda.id,
            appointmentId: comanda.appointmentId,
          },
        });
      }
    }
  }

  if (comanda.appointmentId) {
    const prevAppointment = await prisma.appointment.findFirst({
      where: { id: comanda.appointmentId, tenantId },
      select: { status: true },
    });
    await prisma.appointment.update({
      where: { id: comanda.appointmentId },
      data: { status: "COMPLETED" },
    });
    if (prevAppointment && prevAppointment.status !== "COMPLETED") {
      safeNotifyAppointmentStatusChange({
        tenantId,
        appointmentId: comanda.appointmentId,
        previousStatus: prevAppointment.status,
        nextStatus: "COMPLETED",
      });
    }
  }

  if (tenant.fiscalEnabled && tenant.fiscalAutoIssue) {
    try {
      const { issueComandaInvoices } = await import("@/lib/fiscal-issue");
      await issueComandaInvoices(tenantId, comanda.id);
    } catch {
      // fechamento não depende da nota
    }
  }

  if (client) {
    safeDispatch({
      tenantId,
      trigger: "REVIEW",
      client,
      sentOn: comanda.id,
    });
  }

  revalidateComandas();
  revalidatePath(`/comandas/${comanda.id}`);
  revalidatePath(`/clientes/${comanda.clientId}`);
  revalidatePath("/notas");
  return { ok: true as const, id: comanda.id };
}

export async function invoiceComanda(formData: FormData) {
  const saved = await upsertComanda(formData);
  if (saved && "error" in saved && saved.error) return saved;
  if (!saved || !("id" in saved) || !saved.id) return { error: "Não foi possível salvar a comanda." };
  const { session } = await requireTenant();
  return finalizeOpenComanda(session.tenantId, saved.id, parsePayments(formData));
}

export async function closeComanda(formData: FormData) {
  const { session, access } = await requireTenant();
  if (!canAccess(access, "comandas", "edit")) return { error: "Sem permissão para fechar comanda." };
  const comandaId = String(formData.get("comandaId") ?? "");
  const paymentMethodId = String(formData.get("paymentMethodId") ?? "");
  const method = String(formData.get("method") ?? "PIX");
  const discountCents = parseBRLToCents(String(formData.get("discount") ?? "0"));
  const allowed = new Set<string>(PAYMENT_METHODS);

  const comanda = await prisma.comanda.findFirst({
    where: { id: comandaId, tenantId: session.tenantId },
    include: { items: true },
  });
  if (!comanda) return { error: "Comanda não encontrada." };
  const total = comandaTotal({
    items: comanda.items,
    discountCents,
    creditCents: comanda.creditCents,
    cashbackCents: comanda.cashbackCents,
  });
  if (total > 0 && !paymentMethodId && !allowed.has(method)) return { error: "Forma de pagamento inválida." };

  return finalizeOpenComanda(
    session.tenantId,
    comandaId,
    total > 0
      ? [{ method, paymentMethodId: paymentMethodId || undefined, amountCents: total, installments: 1, occurredAt: new Date() }]
      : [],
    discountCents,
  );
}
