"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  clearSessionCookie,
  hashPassword,
  homePath,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { cookies, headers } from "next/headers";
import { slugify } from "@/lib/utils";
import type { Role } from "@/lib/constants";
import { ensureFinanceCatalog } from "@/lib/finance-catalog";
import { ensureAnamnesisForms } from "@/lib/anamnesis";
import { resolveSignupPlan } from "@/lib/plans";
import { firstTouchPartnerId, PARTNER_REF_COOKIE, partnerHostCandidates, sanitizePartnerSlug } from "@/lib/partners";
import { getDetectedTenantHeaders } from "@/lib/tenant-headers";
import { withoutTenantScope } from "@/lib/tenant-context";

async function resolveSignupPartner() {
  const jar = await cookies();
  const headerList = await headers();
  const ref = sanitizePartnerSlug(headerList.get("x-partner-ref") || jar.get(PARTNER_REF_COOKIE)?.value);
  if (ref) {
    const bySlug = await withoutTenantScope(() =>
      prisma.partner.findUnique({ where: { slug: ref }, select: { id: true, status: true } }),
    );
    if (bySlug) return bySlug;
  }
  const candidates = partnerHostCandidates(headerList.get("x-forwarded-host") || headerList.get("host"));
  if (!candidates.length) return null;
  const byHost = await withoutTenantScope(() =>
    prisma.partnerBrand.findFirst({
      where: { customHost: { in: candidates } },
      select: { partner: { select: { id: true, status: true } } },
    }),
  );
  return byHost?.partner ?? null;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  const user = await withoutTenantScope(() =>
    prisma.user.findUnique({ where: { email }, include: { tenant: true } }),
  );
  if (!user || !user.active) {
    return { error: "E-mail ou senha inválidos." };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "E-mail ou senha inválidos." };
  if (user.tenant.status === "SUSPENDED" && user.role !== "SUPER_ADMIN") {
    return { error: "Esta conta está suspensa. Fale com o suporte MegaBeauty." };
  }

  // If signing in through a specific salon subdomain or `/t/[slug]/login`, ensure the account belongs to that salon.
  const detected = await getDetectedTenantHeaders();
  if (detected.slug && user.role !== "SUPER_ADMIN" && (detected.source === "domain" || detected.source === "path")) {
    const targetSalon = await withoutTenantScope(() =>
      prisma.tenant.findFirst({
        where: { slug: detected.slug, kind: "SALON", isPlatform: false },
        select: { id: true },
      }),
    );
    if (targetSalon && user.tenantId !== targetSalon.id) {
      return { error: "Esta conta não pertence ao salão acessado neste endereço." };
    }
  }

  await setSessionCookie({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  });
  const home = homePath(user.role, user.tenant.kind);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : home;
  const allowedNext = home === "/dashboard" ? safeNext : home;
  redirect(allowedNext);
}

export async function registerAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const salon = String(formData.get("salon") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !salon || !email || password.length < 6) {
    return { error: "Preencha todos os campos. A senha precisa ter 6+ caracteres." };
  }

  const exists = await withoutTenantScope(() => prisma.user.findUnique({ where: { email } }));
  if (exists) return { error: "Já existe uma conta com este e-mail." };

  let slug = slugify(salon);
  const slugTaken = await withoutTenantScope(() => prisma.tenant.findUnique({ where: { slug } }));
  if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const signupPlan = await resolveSignupPlan();
  const partner = await resolveSignupPartner();
  const partnerId = firstTouchPartnerId(null, partner?.status === "ACTIVE" ? partner.id : null);
  const tenant = await prisma.tenant.create({
    data: {
      name: salon,
      slug,
      email,
      plan: signupPlan?.slug ?? "profissional",
      status: "TRIAL",
      billingStatus: "TRIAL",
      partnerId,
      trialEndsAt: new Date(Date.now() + (signupPlan?.trialDays ?? 14) * 86_400_000),
      users: {
        create: {
          email,
          name,
          passwordHash: await hashPassword(password),
          role: "OWNER",
        },
      },
      categories: {
        create: [{ name: "Cabelo" }, { name: "Estética" }, { name: "Unhas" }, { name: "Barba" }],
      },
      automations: {
        create: [
          {
            name: "Confirmação de agendamento",
            trigger: "APPOINTMENT_CREATED",
            template:
              "Oi {{nome}}! Seu horário no {{salao}} está marcado para {{data}} às {{hora}}. Responda SIM para confirmar.",
          },
        ],
      },
    },
    include: { users: true },
  });

  const user = tenant.users[0];
  await ensureFinanceCatalog(tenant.id);
  await ensureAnamnesisForms(tenant.id);
  await setSessionCookie({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    name: user.name,
    role: "OWNER",
  });
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
