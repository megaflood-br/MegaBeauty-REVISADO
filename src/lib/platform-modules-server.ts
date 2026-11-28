import { prisma } from "@/lib/db";
import { withoutTenantScope } from "@/lib/tenant-context";
import {
  defaultPlatformModules,
  isModuleEnabled,
  moduleDisabledMessage,
  parsePlatformModules,
  serializePlatformModules,
  type PlatformModuleKey,
  type PlatformModulesConfig,
} from "@/lib/platform-modules";

export async function loadPlatformModules(): Promise<PlatformModulesConfig> {
  try {
    const hq = await withoutTenantScope(() =>
      prisma.tenant.findFirst({
        where: { isPlatform: true },
        select: { platformModulesJson: true },
      }),
    );
    return parsePlatformModules(hq?.platformModulesJson);
  } catch {
    return defaultPlatformModules();
  }
}

export async function updatePlatformModules(
  patch: Partial<Record<PlatformModuleKey, boolean>>,
): Promise<PlatformModulesConfig> {
  const hq = await withoutTenantScope(() =>
    prisma.tenant.findFirst({
      where: { isPlatform: true },
      select: { id: true, platformModulesJson: true },
    }),
  );
  if (!hq) {
    throw new Error("Conta principal da plataforma não encontrada.");
  }
  const current = parsePlatformModules(hq.platformModulesJson);
  const nextJson = serializePlatformModules(current, patch);
  await withoutTenantScope(() =>
    prisma.tenant.update({
      where: { id: hq.id },
      data: { platformModulesJson: nextJson },
    }),
  );
  return parsePlatformModules(nextJson);
}

export async function checkPlatformModule(
  key: PlatformModuleKey,
): Promise<{ ok: true; modules: PlatformModulesConfig } | { ok: false; error: string; modules: PlatformModulesConfig }> {
  const modules = await loadPlatformModules();
  if (!isModuleEnabled(modules, key)) {
    return { ok: false, error: moduleDisabledMessage(key), modules };
  }
  return { ok: true, modules };
}
