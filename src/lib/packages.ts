import { prisma } from "@/lib/db";
import { calendarDate } from "@/lib/dates";
import { loadFinanceCatalog } from "@/lib/finance-catalog";
import { loadPromoRules } from "@/lib/promo-load";
import { decorateCatalogItem } from "@/lib/promotions";
import { redactPhone } from "@/lib/utils";
import {
  effectiveClientPackageStatus,
  isClientPackageExpired,
  type ClientPackageBalanceItem,
  type ClientPackageDto,
  type PackageClientSummary,
  type PackageTemplateDto,
} from "@/lib/packages-shared";

export async function ensureLegacyPackageItems(tenantId: string, clientId?: string) {
  const legacyTemplates = await prisma.package.findMany({
    where: { tenantId, items: { none: {} } },
    include: { service: { select: { id: true, name: true, priceCents: true } } },
  });

  for (const tpl of legacyTemplates) {
    if (!tpl.serviceId || !tpl.service) continue;
    const qty = Math.max(1, tpl.sessions || 1);
    const unitPriceCents = qty > 0 ? Math.round(tpl.priceCents / qty) : tpl.service.priceCents;
    await prisma.packageItem.create({
      data: {
        packageId: tpl.id,
        type: "SERVICE",
        serviceId: tpl.service.id,
        description: tpl.service.name,
        quantity: qty,
        unitPriceCents,
        discountCents: 0,
      },
    });
  }

  const legacyClientPackages = await prisma.clientPackage.findMany({
    where: {
      tenantId,
      ...(clientId ? { clientId } : {}),
      OR: [{ items: { none: {} } }, { number: 0 }],
    },
    include: {
      package: {
        include: {
          service: { select: { id: true, name: true, priceCents: true } },
          items: true,
        },
      },
      items: true,
    },
    orderBy: { purchasedAt: "asc" },
  });

  if (!legacyClientPackages.length) return;

  const lastNumberRow = await prisma.clientPackage.findFirst({
    where: { tenantId, number: { gt: 0 } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  let nextNum = (lastNumberRow?.number ?? 0) + 1;

  for (const cp of legacyClientPackages) {
    const updateData: { number?: number; name?: string; totalCents?: number; status?: string } = {};
    if (!cp.number || cp.number <= 0) {
      updateData.number = nextNum++;
    }
    if (!cp.name && cp.package?.name) {
      updateData.name = cp.package.name;
    }
    if (!cp.totalCents && cp.package?.priceCents) {
      updateData.totalCents = cp.package.priceCents;
    }
    if (cp.status === "ACTIVE" && cp.remaining <= 0) {
      updateData.status = "CONSUMED";
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.clientPackage.update({ where: { id: cp.id }, data: updateData });
    }

    if (cp.items.length === 0 && cp.package) {
      if (cp.package.items.length > 0) {
        let remainingBudget = Math.max(0, cp.remaining);
        for (const tplItem of cp.package.items) {
          const itemRemaining = Math.min(tplItem.quantity, remainingBudget);
          remainingBudget = Math.max(0, remainingBudget - itemRemaining);
          await prisma.clientPackageItem.create({
            data: {
              clientPackageId: cp.id,
              type: tplItem.type,
              serviceId: tplItem.serviceId,
              productId: tplItem.productId,
              description: tplItem.description,
              totalQty: tplItem.quantity,
              remainingQty: itemRemaining,
              unitPriceCents: tplItem.unitPriceCents,
              discountCents: tplItem.discountCents,
            },
          });
        }
      } else if (cp.package.service) {
        const totalQty = Math.max(1, cp.package.sessions || cp.remaining || 1);
        const unitPriceCents =
          totalQty > 0 ? Math.round(cp.package.priceCents / totalQty) : cp.package.service.priceCents;
        await prisma.clientPackageItem.create({
          data: {
            clientPackageId: cp.id,
            type: "SERVICE",
            serviceId: cp.package.service.id,
            description: cp.package.service.name,
            totalQty,
            remainingQty: Math.max(0, Math.min(totalQty, cp.remaining)),
            unitPriceCents,
            discountCents: 0,
          },
        });
      }
    }
  }
}

export async function loadClientActivePackageBalances(
  tenantId: string,
  clientId?: string,
): Promise<Record<string, ClientPackageBalanceItem[]>> {
  await ensureLegacyPackageItems(tenantId, clientId);
  const now = new Date();
  const rows = await prisma.clientPackage.findMany({
    where: {
      tenantId,
      ...(clientId ? { clientId } : {}),
      status: "ACTIVE",
      remaining: { gt: 0 },
    },
    include: {
      package: { select: { name: true } },
      items: {
        where: { remainingQty: { gt: 0 } },
        orderBy: { description: "asc" },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { purchasedAt: "asc" }],
  });

  const grouped: Record<string, ClientPackageBalanceItem[]> = {};
  for (const pkg of rows) {
    if (isClientPackageExpired(pkg.expiresAt, now)) continue;
    const pkgName = pkg.name || pkg.package?.name || `Pacote #${pkg.number}`;
    for (const item of pkg.items) {
      const catalogId = item.type === "PRODUCT" ? item.productId : item.serviceId;
      if (!catalogId || item.remainingQty <= 0) continue;
      if (!grouped[pkg.clientId]) grouped[pkg.clientId] = [];
      grouped[pkg.clientId].push({
        id: item.id,
        clientPackageId: pkg.id,
        packageNumber: pkg.number,
        packageName: pkgName,
        type: item.type === "PRODUCT" ? "PRODUCT" : "SERVICE",
        catalogId,
        description: item.description,
        totalQty: item.totalQty,
        remainingQty: item.remainingQty,
        unitPriceCents: item.unitPriceCents,
        purchasedAt: pkg.purchasedAt.toISOString(),
        expiresAt: pkg.expiresAt ? pkg.expiresAt.toISOString() : null,
      });
    }
  }
  return grouped;
}

export async function loadClientSidebarSummaries(
  tenantId: string,
  hidePhones: boolean,
): Promise<PackageClientSummary[]> {
  const [clients, openComandaCounts] = await Promise.all([
    prisma.client.findMany({
      where: { tenantId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        imageUrl: true,
        birthDate: true,
        creditCents: true,
        cashbackCents: true,
        notes: true,
      },
    }),
    prisma.comanda.groupBy({
      by: ["clientId"],
      where: { tenantId, status: "OPEN" },
      _count: { _all: true },
    }),
  ]);
  const openMap = new Map(openComandaCounts.map((row) => [row.clientId, row._count._all]));
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    phone: redactPhone(c.phone, hidePhones),
    imageUrl: c.imageUrl,
    birthDate: c.birthDate ? calendarDate(c.birthDate) : null,
    creditCents: c.creditCents,
    cashbackCents: c.cashbackCents,
    openComandasCount: openMap.get(c.id) ?? 0,
    notes: c.notes,
  }));
}

function mapTemplateRow(row: {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  sessions: number;
  validityDays: number | null;
  active: boolean;
  items: {
    id: string;
    type: string;
    serviceId: string | null;
    productId: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
  }[];
  _count: { clients: number };
}): PackageTemplateDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    sessions: row.sessions,
    validityDays: row.validityDays,
    active: row.active,
    items: row.items.map((item) => ({
      id: item.id,
      type: item.type === "PRODUCT" ? "PRODUCT" : "SERVICE",
      serviceId: item.serviceId,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
    })),
    salesCount: row._count.clients,
  };
}

function mapClientPackageRow(
  row: {
    id: string;
    number: number;
    name: string;
    clientId: string;
    client: { name: string; phone: string };
    packageId: string | null;
    package: { name: string } | null;
    sellerId: string | null;
    seller: { name: string } | null;
    remaining: number;
    status: string;
    discountCents: number;
    creditCents: number;
    cashbackCents: number;
    totalCents: number;
    paymentMethod: string | null;
    notes: string | null;
    purchasedAt: Date;
    expiresAt: Date | null;
    items: {
      id: string;
      clientPackageId: string;
      type: string;
      serviceId: string | null;
      productId: string | null;
      description: string;
      totalQty: number;
      remainingQty: number;
      unitPriceCents: number;
      discountCents: number;
    }[];
    usages: {
      id: string;
      clientPackageItemId: string;
      clientPackageItem: { description: string };
      comandaId: string | null;
      comanda: { number: number } | null;
      quantity: number;
      usedAt: Date;
      notes: string | null;
    }[];
  },
  hidePhones: boolean,
): ClientPackageDto {
  const totalSessions = row.items.reduce((sum, i) => sum + i.totalQty, 0);
  const remaining = row.status === "CANCELLED" ? 0 : row.items.reduce((sum, i) => sum + i.remainingQty, 0);
  return {
    id: row.id,
    number: row.number,
    name: row.name || row.package?.name || `Pacote #${row.number}`,
    clientId: row.clientId,
    clientName: row.client.name,
    clientPhone: redactPhone(row.client.phone, hidePhones),
    packageId: row.packageId,
    templateName: row.package?.name ?? null,
    sellerId: row.sellerId,
    sellerName: row.seller?.name ?? null,
    remaining,
    totalSessions,
    status: row.status,
    effectiveStatus: effectiveClientPackageStatus({
      status: row.status,
      remaining,
      expiresAt: row.expiresAt,
    }),
    discountCents: row.discountCents,
    creditCents: row.creditCents,
    cashbackCents: row.cashbackCents,
    totalCents: row.totalCents,
    paymentMethod: row.paymentMethod,
    notes: row.notes,
    purchasedAt: row.purchasedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    items: row.items.map((item) => ({
      id: item.id,
      clientPackageId: item.clientPackageId,
      type: item.type === "PRODUCT" ? "PRODUCT" : "SERVICE",
      serviceId: item.serviceId,
      productId: item.productId,
      description: item.description,
      totalQty: item.totalQty,
      remainingQty: item.remainingQty,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
    })),
    usages: row.usages.map((u) => ({
      id: u.id,
      clientPackageItemId: u.clientPackageItemId,
      itemDescription: u.clientPackageItem.description,
      comandaId: u.comandaId,
      comandaNumber: u.comanda?.number ?? null,
      quantity: u.quantity,
      usedAt: u.usedAt.toISOString(),
      notes: u.notes,
    })),
  };
}

export async function loadPackagesWorkspace(tenantId: string, hidePhones: boolean) {
  await ensureLegacyPackageItems(tenantId);
  const [templates, clientPackages, clients, professionals, services, products, catalog, promos, balancesByClient] =
    await Promise.all([
      prisma.package.findMany({
        where: { tenantId },
        include: {
          items: { orderBy: { description: "asc" } },
          _count: { select: { clients: true } },
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      prisma.clientPackage.findMany({
        where: { tenantId },
        include: {
          client: { select: { name: true, phone: true } },
          package: { select: { name: true } },
          seller: { select: { name: true } },
          items: { orderBy: { description: "asc" } },
          usages: {
            include: {
              clientPackageItem: { select: { description: true } },
              comanda: { select: { number: true } },
            },
            orderBy: { usedAt: "desc" },
          },
        },
        orderBy: [{ purchasedAt: "desc" }, { number: "desc" }],
      }),
      loadClientSidebarSummaries(tenantId, hidePhones),
      prisma.professional.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.service.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, priceCents: true, durationMin: true },
      }),
      prisma.product.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, saleCents: true },
      }),
      loadFinanceCatalog(tenantId),
      loadPromoRules(tenantId),
      loadClientActivePackageBalances(tenantId),
    ]);

  const today = calendarDate();
  const pricedServices = services.map((s) => ({
    ...decorateCatalogItem(promos, today, "SERVICE", s),
    durationMin: s.durationMin,
  }));
  const pricedProducts = products.map((p) =>
    decorateCatalogItem(promos, today, "PRODUCT", { id: p.id, name: p.name, priceCents: p.saleCents }),
  );

  return {
    templates: templates.map(mapTemplateRow),
    clientPackages: clientPackages.map((row) => mapClientPackageRow(row, hidePhones)),
    clients,
    balancesByClient,
    professionals,
    services: pricedServices,
    products: pricedProducts,
    paymentMethods: catalog.methods.filter((m) => m.active),
  };
}

export async function loadClientPackagesForProfile(tenantId: string, clientId: string, hidePhones: boolean) {
  await ensureLegacyPackageItems(tenantId, clientId);
  const [templates, clientPackages, clientSummaryList, professionals, services, products, catalog, promos, balancesByClient] =
    await Promise.all([
      prisma.package.findMany({
        where: { tenantId, active: true },
        include: {
          items: { orderBy: { description: "asc" } },
          _count: { select: { clients: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.clientPackage.findMany({
        where: { tenantId, clientId },
        include: {
          client: { select: { name: true, phone: true } },
          package: { select: { name: true } },
          seller: { select: { name: true } },
          items: { orderBy: { description: "asc" } },
          usages: {
            include: {
              clientPackageItem: { select: { description: true } },
              comanda: { select: { number: true } },
            },
            orderBy: { usedAt: "desc" },
          },
        },
        orderBy: [{ purchasedAt: "desc" }, { number: "desc" }],
      }),
      loadClientSidebarSummaries(tenantId, hidePhones),
      prisma.professional.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.service.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, priceCents: true, durationMin: true },
      }),
      prisma.product.findMany({
        where: { tenantId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, saleCents: true },
      }),
      loadFinanceCatalog(tenantId),
      loadPromoRules(tenantId),
      loadClientActivePackageBalances(tenantId, clientId),
    ]);

  const today = calendarDate();
  const pricedServices = services.map((s) => ({
    ...decorateCatalogItem(promos, today, "SERVICE", s),
    durationMin: s.durationMin,
  }));
  const pricedProducts = products.map((p) =>
    decorateCatalogItem(promos, today, "PRODUCT", { id: p.id, name: p.name, priceCents: p.saleCents }),
  );

  return {
    templates: templates.map(mapTemplateRow),
    clientPackages: clientPackages.map((row) => mapClientPackageRow(row, hidePhones)),
    clients: clientSummaryList,
    balancesByClient,
    professionals,
    services: pricedServices,
    products: pricedProducts,
    paymentMethods: catalog.methods.filter((m) => m.active),
  };
}
