import { headers } from "next/headers";
import {
  TENANT_ID_HEADER,
  TENANT_ROLE_HEADER,
  TENANT_SLUG_HEADER,
  TENANT_SOURCE_HEADER,
  sanitizeTenantSlug,
  type TenantDetectionSource,
} from "@/lib/tenant-routing";
import { registerRequestScopeResolver, type TenantScopeKind } from "@/lib/tenant-context";

function kindFromRole(role: string | null): TenantScopeKind | undefined {
  if (role === "SUPPLIER") return "SUPPLIER";
  if (role === "PARTNER") return "PARTNER";
  if (role && role !== "SUPER_ADMIN") return "SALON";
  return undefined;
}

/**
 * Registers the Next.js App Router header-based tenant scope resolver so
 * Prisma queries automatically isolate by `x-tenant-id` stamped in `src/proxy.ts`.
 */
registerRequestScopeResolver(async () => {
  try {
    const headerList = await headers();
    const tenantId = headerList.get(TENANT_ID_HEADER)?.trim();
    if (!tenantId) return null;
    const role = headerList.get(TENANT_ROLE_HEADER)?.trim() || null;
    return {
      mode: "tenant",
      tenantId,
      kind: kindFromRole(role),
    };
  } catch {
    return null;
  }
});

export type DetectedTenantHeaders = {
  slug: string;
  source: TenantDetectionSource | "";
  tenantId: string;
};

/**
 * Reads the tenant slug/source detected by `src/proxy.ts` from domain or path.
 */
export async function getDetectedTenantHeaders(): Promise<DetectedTenantHeaders> {
  try {
    const headerList = await headers();
    const slug = sanitizeTenantSlug(headerList.get(TENANT_SLUG_HEADER));
    const rawSource = headerList.get(TENANT_SOURCE_HEADER);
    const source: TenantDetectionSource | "" =
      rawSource === "domain" || rawSource === "path" || rawSource === "session" ? rawSource : "";
    const tenantId = headerList.get(TENANT_ID_HEADER)?.trim() || "";
    return { slug, source, tenantId };
  } catch {
    return { slug: "", source: "", tenantId: "" };
  }
}
