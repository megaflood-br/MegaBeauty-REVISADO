import { AsyncLocalStorage } from "node:async_hooks";

export type TenantScopeKind = "SALON" | "SUPPLIER" | "PARTNER";

export type TenantScope =
  | {
      mode: "tenant";
      tenantId: string;
      kind?: TenantScopeKind;
    }
  | {
      mode: "bypass";
    };

export type RequestScopeResolver = () => Promise<TenantScope | null>;

const globalForTenantStore = globalThis as unknown as {
  __mbTenantStorage?: AsyncLocalStorage<TenantScope>;
  __mbRequestScopeResolver?: RequestScopeResolver;
  __mbActiveTenantScopeResolver?: RequestScopeResolver;
};

const tenantStorage =
  globalForTenantStore.__mbTenantStorage ??
  (globalForTenantStore.__mbTenantStorage = new AsyncLocalStorage<TenantScope>());

/**
 * Registers the server-only Next.js request header scope resolver
 * (called by `src/lib/tenant-headers.ts`).
 */
export function registerRequestScopeResolver(resolver: RequestScopeResolver) {
  globalForTenantStore.__mbRequestScopeResolver = resolver;
}

/**
 * Runs an async operation with strict Prisma-level `tenantId` isolation.
 * Awaits `fn()` inside `AsyncLocalStorage.run` so lazy `PrismaPromise` instances
 * always resolve while the tenant context is active.
 */
export function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
  kind?: TenantScopeKind,
): Promise<T> {
  if (!tenantId || !tenantId.trim()) {
    throw new Error("withTenantContext requer um tenantId válido.");
  }
  return tenantStorage.run({ mode: "tenant", tenantId: tenantId.trim(), kind }, async () => await fn());
}

/**
 * Explicitly bypasses automatic Prisma tenant scoping for verified platform-level
 * or cross-tenant operations (e.g., Super Admin management, auth lookup, impersonation exit).
 */
export function withoutTenantScope<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ mode: "bypass" }, async () => await fn());
}

/**
 * Reads the current synchronous AsyncLocalStorage tenant scope, if any.
 */
export function getExplicitTenantScope(): TenantScope | null {
  return tenantStorage.getStore() ?? null;
}

/**
 * Resolves the active tenant scope for Prisma query isolation:
 * 1. Explicit `AsyncLocalStorage` scope (`withTenantContext` / `withoutTenantScope`)
 * 2. Registered server request resolver (reads proxy-verified `x-tenant-id` header)
 */
export async function resolveActiveTenantScope(): Promise<TenantScope | null> {
  const explicit = tenantStorage.getStore();
  if (explicit) return explicit;

  const resolver = globalForTenantStore.__mbRequestScopeResolver;
  if (!resolver) return null;

  try {
    return await resolver();
  } catch {
    return null;
  }
}

// Register the active scope resolver on globalThis so `src/lib/prisma-tenant.ts`
// never needs to statically import `node:async_hooks` or `next/headers`.
globalForTenantStore.__mbActiveTenantScopeResolver = resolveActiveTenantScope;
