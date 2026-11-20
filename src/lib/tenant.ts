import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function scopedTenant<T extends { tenantId: string }>(tenantId: string, data: T): T {
  return { ...data, tenantId };
}

export async function requireTenant() {
  const session = await requireSession();
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) redirect("/login");
  return { session, tenant };
}

export async function assertClientInTenant(tenantId: string, clientId: string) {
  if (!clientId) return false;
  const row = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } });
  return Boolean(row);
}

export async function assertProfessionalInTenant(tenantId: string, professionalId: string) {
  if (!professionalId) return false;
  const row = await prisma.professional.findFirst({ where: { id: professionalId, tenantId }, select: { id: true } });
  return Boolean(row);
}

export async function assertProfessionalsInTenant(tenantId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return true;
  const count = await prisma.professional.count({ where: { tenantId, id: { in: unique } } });
  return count === unique.length;
}

export async function assertServicesInTenant(tenantId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return true;
  const count = await prisma.service.count({ where: { tenantId, id: { in: unique } } });
  return count === unique.length;
}

export async function assertProductsInTenant(tenantId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return true;
  const count = await prisma.product.count({ where: { tenantId, id: { in: unique } } });
  return count === unique.length;
}

export async function assertServiceCategoryInTenant(tenantId: string, categoryId: string) {
  if (!categoryId) return false;
  const row = await prisma.serviceCategory.findFirst({ where: { id: categoryId, tenantId }, select: { id: true } });
  return Boolean(row);
}

export async function assertProductCategoryInTenant(tenantId: string, categoryId: string) {
  if (!categoryId) return false;
  const row = await prisma.productCategory.findFirst({ where: { id: categoryId, tenantId }, select: { id: true } });
  return Boolean(row);
}
