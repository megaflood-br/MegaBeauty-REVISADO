import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyTenantIsolation, createTenantPrisma } from "@/lib/prisma-tenant";
import type { TenantScopeKind } from "@/lib/tenant-context";

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
  prisma?: ReturnType<typeof applyTenantIsolation>;
};

function resolveDatabaseUrl() {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  return `file:${path.resolve(process.cwd(), "prisma/dev.db")}`;
}

function createBasePrisma() {
  return new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function isCurrentClient(client: PrismaClient | undefined): client is PrismaClient {
  if (typeof client?.supplierProduct?.findMany !== "function") return false;
  if (typeof (client as { supplierPromotion?: { findMany?: unknown } }).supplierPromotion?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { marketingCampaign?: { findMany?: unknown } }).marketingCampaign?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { salonPop?: { findMany?: unknown } }).salonPop?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { salonDocument?: { findMany?: unknown } }).salonDocument?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { partner?: { findUnique?: unknown } }).partner?.findUnique !== "function") {
    return false;
  }
  if (typeof (client as { permissionProfile?: { findMany?: unknown } }).permissionProfile?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { receptionist?: { findUnique?: unknown } }).receptionist?.findUnique !== "function") {
    return false;
  }
  if (typeof (client as { clientPackageItem?: { findMany?: unknown } }).clientPackageItem?.findMany !== "function") {
    return false;
  }
  if (typeof (client as { scheduleBlock?: { findMany?: unknown } }).scheduleBlock?.findMany !== "function") {
    return false;
  }
  const models = (
    client as unknown as {
      _runtimeDataModel?: { models?: Record<string, { fields?: { name?: string }[] }> };
    }
  )._runtimeDataModel?.models;
  const productFields = models?.SupplierProduct?.fields;
  const tenantFields = models?.Tenant?.fields;
  const campaignFields = models?.MarketingCampaign?.fields;
  const popFields = models?.SalonPop?.fields;
  const documentFields = models?.SalonDocument?.fields;
  const conversationFields = models?.Conversation?.fields;
  const messageFields = models?.Message?.fields;
  const comandaItemFields = models?.ComandaItem?.fields;
  const userFields = models?.User?.fields;
  return Boolean(
    productFields?.some((field) => field.name === "imageUrl") &&
      tenantFields?.some((field) => field.name === "servedCities") &&
      tenantFields?.some((field) => field.name === "logoUrl") &&
      tenantFields?.some((field) => field.name === "logoDarkUrl") &&
      tenantFields?.some((field) => field.name === "faviconUrl") &&
      tenantFields?.some((field) => field.name === "technicalResponsible") &&
      tenantFields?.some((field) => field.name === "partnerId") &&
      campaignFields?.some((field) => field.name === "serviceId") &&
      popFields?.some((field) => field.name === "registry") &&
      documentFields?.some((field) => field.name === "kind") &&
      conversationFields?.some((field) => field.name === "botPaused") &&
      conversationFields?.some((field) => field.name === "botPausedUntil") &&
      messageFields?.some((field) => field.name === "source") &&
      comandaItemFields?.some((field) => field.name === "clientPackageItemId") &&
      userFields?.some((field) => field.name === "onboardingTourStatus") &&
      tenantFields?.some((field) => field.name === "whatsappProvider") &&
      tenantFields?.some((field) => field.name === "metaPhoneNumberId") &&
      tenantFields?.some((field) => field.name === "evolutionQr"),
  );
}

const currentBase = isCurrentClient(globalForPrisma.prismaBase)
  ? globalForPrisma.prismaBase
  : createBasePrisma();

/**
 * Unscoped base PrismaClient for platform-wide operations or migrations.
 * Prefer `prisma` (automatically tenant-isolated) or `withoutTenantScope(...)`.
 */
export const unscopedPrisma = currentBase;

/**
 * Default Prisma client with automatic `tenantId` isolation across all
 * tenant-scoped models whenever an active request or AsyncLocalStorage
 * tenant context is present.
 */
export const prisma =
  globalForPrisma.prismaBase === currentBase && globalForPrisma.prisma
    ? globalForPrisma.prisma
    : applyTenantIsolation(currentBase);

/**
 * Returns a Prisma client permanently locked to a single `tenantId`.
 */
export function prismaForTenant(tenantId: string, kind: TenantScopeKind = "SALON") {
  return createTenantPrisma(unscopedPrisma, tenantId, kind);
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = currentBase;
  globalForPrisma.prisma = prisma;
}
