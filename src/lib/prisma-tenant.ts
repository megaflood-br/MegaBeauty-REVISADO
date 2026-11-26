import type { PrismaClient } from "@prisma/client";
import type { RequestScopeResolver, TenantScope, TenantScopeKind } from "@/lib/tenant-context";

async function defaultScopeProvider(): Promise<TenantScope | null> {
  const resolver = (
    globalThis as unknown as { __mbActiveTenantScopeResolver?: RequestScopeResolver }
  ).__mbActiveTenantScopeResolver;
  if (!resolver) return null;
  return resolver();
}

/**
 * All tenant-owned domain models that must always be isolated by `tenantId`
 * whenever an active tenant scope is present.
 */
export const CORE_TENANT_SCOPED_MODELS = new Set<string>([
  "User",
  "PermissionProfile",
  "Professional",
  "ProfessionalGoal",
  "FiscalInvoice",
  "Promotion",
  "ServiceCategory",
  "Service",
  "Client",
  "Appointment",
  "ScheduleBlock",
  "Comanda",
  "ProductCategory",
  "Product",
  "ProductLot",
  "ProductRequest",
  "StockMovement",
  "Commission",
  "FinanceAccount",
  "PaymentMethodConfig",
  "FinanceCategory",
  "Transaction",
  "Package",
  "ClientPackage",
  "ClientPackageUsage",
  "Conversation",
  "Receptionist",
  "Automation",
  "CampaignSend",
  "MarketingCampaign",
  "MarketingRecipient",
  "SalonPop",
  "SalonDocument",
  "AnamnesisForm",
  "Anamnesis",
  "SupportTicket",
  "SupportCall",
  "SupportPresence",
  "CashbackMovement",
]);

/**
 * Supplier marketplace catalog models: isolated to the supplier's `tenantId`
 * for supplier scopes, while readable across suppliers when a salon browses
 * the marketplace.
 */
export const SUPPLIER_TENANT_SCOPED_MODELS = new Set<string>([
  "SupplierProduct",
  "SupplierPromotion",
]);

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

function shouldScopeModel(model: string | undefined, kind?: TenantScopeKind): boolean {
  if (!model) return false;
  if (CORE_TENANT_SCOPED_MODELS.has(model)) return true;
  if (kind === "SUPPLIER" && SUPPLIER_TENANT_SCOPED_MODELS.has(model)) return true;
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const UNIQUE_WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
]);

const FILTERED_READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

function assertNoCrossTenantScalar(value: unknown, tenantId: string, context: string) {
  if (typeof value === "string" && value !== tenantId) {
    throw new TenantIsolationError(
      `Violação de isolamento multi-tenant bloqueada em ${context}: tenantId diferente do escopo ativo.`,
    );
  }
}

function scopeUniqueWhere(where: unknown, tenantId: string, model: string): Record<string, unknown> {
  const current = isPlainRecord(where) ? { ...where } : {};
  if ("tenantId" in current) {
    assertNoCrossTenantScalar(current.tenantId, tenantId, `${model}.where`);
  }
  return { ...current, tenantId };
}

function scopeFilteredWhere(where: unknown, tenantId: string): Record<string, unknown> {
  if (!isPlainRecord(where) || Object.keys(where).length === 0) {
    return { tenantId };
  }
  return {
    AND: [where, { tenantId }],
  };
}

function enforceCreateData(data: unknown, tenantId: string, model: string): Record<string, unknown> {
  if (!isPlainRecord(data)) {
    return { tenantId };
  }
  const next: Record<string, unknown> = { ...data };

  if ("tenantId" in next && next.tenantId !== undefined) {
    assertNoCrossTenantScalar(next.tenantId, tenantId, `${model}.create`);
  }

  if (isPlainRecord(next.tenant)) {
    const relation = next.tenant;
    if (isPlainRecord(relation.connect) && "id" in relation.connect) {
      assertNoCrossTenantScalar(relation.connect.id, tenantId, `${model}.create.tenant.connect`);
      return next;
    }
    return next;
  }

  next.tenantId = tenantId;
  return next;
}

function guardUpdateData(data: unknown, tenantId: string, model: string): unknown {
  if (!isPlainRecord(data)) return data;
  const next: Record<string, unknown> = { ...data };

  if ("tenantId" in next && next.tenantId !== undefined) {
    if (typeof next.tenantId === "string") {
      assertNoCrossTenantScalar(next.tenantId, tenantId, `${model}.update`);
    } else if (isPlainRecord(next.tenantId) && "set" in next.tenantId) {
      assertNoCrossTenantScalar(next.tenantId.set, tenantId, `${model}.update`);
    }
  }

  if (isPlainRecord(next.tenant) && isPlainRecord(next.tenant.connect) && "id" in next.tenant.connect) {
    assertNoCrossTenantScalar(next.tenant.connect.id, tenantId, `${model}.update.tenant.connect`);
  }

  return next;
}

function applyScopeToArgs(
  model: string,
  operation: string,
  rawArgs: unknown,
  tenantId: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = isPlainRecord(rawArgs) ? { ...rawArgs } : {};

  if (UNIQUE_WHERE_OPS.has(operation)) {
    args.where = scopeUniqueWhere(args.where, tenantId, model);
    if (operation === "update") {
      args.data = guardUpdateData(args.data, tenantId, model);
    } else if (operation === "upsert") {
      args.create = enforceCreateData(args.create, tenantId, model);
      args.update = guardUpdateData(args.update, tenantId, model);
    }
    return args;
  }

  if (FILTERED_READ_OPS.has(operation)) {
    args.where = scopeFilteredWhere(args.where, tenantId);
    if (operation === "updateMany" || operation === "updateManyAndReturn") {
      args.data = guardUpdateData(args.data, tenantId, model);
    }
    return args;
  }

  if (operation === "create") {
    args.data = enforceCreateData(args.data, tenantId, model);
    return args;
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    if (Array.isArray(args.data)) {
      args.data = args.data.map((row) => enforceCreateData(row, tenantId, model));
    } else if (isPlainRecord(args.data)) {
      args.data = enforceCreateData(args.data, tenantId, model);
    }
    return args;
  }

  return args;
}

/**
 * Extends a PrismaClient instance so every query on tenant-scoped models
 * automatically enforces `tenantId` isolation from the active scope.
 */
export function applyTenantIsolation(
  baseClient: PrismaClient,
  scopeProvider: () => Promise<TenantScope | null> = defaultScopeProvider,
) {
  return baseClient.$extends({
    name: "megaBeautyTenantIsolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scope = await scopeProvider();
          if (!scope || scope.mode !== "tenant" || !shouldScopeModel(model, scope.kind)) {
            return query(args);
          }
          const scopedArgs = applyScopeToArgs(model, operation, args, scope.tenantId);
          return query(scopedArgs);
        },
      },
    },
  });
}

/**
 * Creates a PrismaClient permanently bound to a single `tenantId`.
 * Useful for public routes, webhooks, background workers, and tests.
 */
export function createTenantPrisma(
  baseClient: PrismaClient,
  tenantId: string,
  kind: TenantScopeKind = "SALON",
) {
  if (!tenantId || !tenantId.trim()) {
    throw new TenantIsolationError("createTenantPrisma requer um tenantId válido.");
  }
  const fixedScope: TenantScope = { mode: "tenant", tenantId: tenantId.trim(), kind };
  return applyTenantIsolation(baseClient, async () => fixedScope);
}
