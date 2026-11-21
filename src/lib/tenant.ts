import { redirect } from "next/navigation";
import { getSession, homePath, isPlatformAdmin, type SessionUser } from "@/lib/auth";
import { prisma, prismaForTenant } from "@/lib/db";
import { loadAccess } from "@/lib/access";
import { getDetectedTenantHeaders } from "@/lib/tenant-headers";
import { withTenantContext, withoutTenantScope } from "@/lib/tenant-context";

export { withTenantContext, withoutTenantScope, prismaForTenant };

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function scopedTenant<T extends { tenantId: string }>(tenantId: string, data: T): T {
  return { ...data, tenantId };
}

export { homePath };

/**
 * Resolves the tenant detected by middleware from domain (subdomain) or path (`/t/[slug]`, `/agendar/[slug]`).
 * Returns null if no tenant slug was detected or no matching non-platform tenant exists.
 */
export async function resolveDetectedTenant() {
  const detected = await getDetectedTenantHeaders();
  if (!detected.slug) return null;
  const tenant = await withoutTenantScope(() =>
    prisma.tenant.findFirst({
      where: { slug: detected.slug, isPlatform: false },
    }),
  );
  if (!tenant) return null;
  return { tenant, source: detected.source };
}

export async function requireTenant() {
  const session = await requireSession();
  if (isPlatformAdmin(session.role) && !session.impersonatorId) {
    redirect("/plataforma");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) redirect("/login");
  if (tenant.kind === "SUPPLIER") redirect("/fornecedor");
  if (tenant.kind === "PARTNER") redirect("/parceiro");
  if (tenant.status === "SUSPENDED" && !session.impersonatorId) {
    redirect("/login?suspended=1");
  }

  // If the request arrived via a specific salon subdomain or `/t/[slug]/...` path,
  // verify that the authenticated session belongs to that same tenant.
  const detected = await getDetectedTenantHeaders();
  if (detected.slug && (detected.source === "path" || detected.source === "domain")) {
    const requestedSalon = await withoutTenantScope(() =>
      prisma.tenant.findFirst({
        where: { slug: detected.slug, kind: "SALON", isPlatform: false },
        select: { id: true, slug: true },
      }),
    );
    if (requestedSalon && requestedSalon.id !== tenant.id) {
      redirect(`/login?tenant=${encodeURIComponent(requestedSalon.slug)}`);
    }
  }

  const access = await loadAccess(session);
  return { session, tenant, access, db: prismaForTenant(tenant.id, "SALON") };
}

export async function requireSupplier() {
  const session = await requireSession();
  if (isPlatformAdmin(session.role) && !session.impersonatorId) {
    redirect("/plataforma");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant || tenant.kind !== "SUPPLIER") redirect("/dashboard");
  if (tenant.status === "SUSPENDED" && !session.impersonatorId) {
    redirect("/login?suspended=1");
  }
  return { session, tenant, db: prismaForTenant(tenant.id, "SUPPLIER") };
}

export async function requirePartner() {
  const session = await requireSession();
  if (isPlatformAdmin(session.role) && !session.impersonatorId) {
    redirect("/plataforma");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant || tenant.kind !== "PARTNER") redirect("/dashboard");
  if (tenant.status === "SUSPENDED" && !session.impersonatorId) {
    redirect("/login?suspended=1");
  }
  const partner = await prisma.partner.findUnique({
    where: { tenantId: tenant.id },
    include: { brand: true },
  });
  if (!partner) redirect("/dashboard");
  return { session, tenant, partner, db: prismaForTenant(tenant.id, "PARTNER") };
}

export async function requirePlatformAdmin() {
  const session = await requireSession();
  if (!isPlatformAdmin(session.role) || session.impersonatorId) {
    redirect(session.impersonatorId ? "/dashboard" : homePath(session.role));
  }

  const adminUser = await withoutTenantScope(() =>
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, active: true, tenantId: true },
    }),
  );
  if (!adminUser || !adminUser.active || !isPlatformAdmin(adminUser.role)) {
    redirect("/login");
  }

  const sessionTenant = await withoutTenantScope(() =>
    prisma.tenant.findUnique({ where: { id: adminUser.tenantId } }),
  );
  if (sessionTenant?.isPlatform) {
    return { session, tenant: sessionTenant };
  }

  const platformTenant = await withoutTenantScope(() =>
    prisma.tenant.findFirst({ where: { isPlatform: true }, orderBy: { createdAt: "asc" } }),
  );
  if (platformTenant) {
    return { session, tenant: platformTenant };
  }

  if (sessionTenant) {
    return { session, tenant: sessionTenant };
  }

  redirect("/login");
}
