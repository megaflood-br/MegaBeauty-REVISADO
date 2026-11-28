import { requirePlatformAdmin } from "@/lib/tenant";
import { loadPlatformModules } from "@/lib/platform-modules-server";
import { PlatformModulesBoard } from "@/components/plataforma/modules-board";

export default async function PlataformaModulosPage() {
  await requirePlatformAdmin();
  const modules = await loadPlatformModules();
  return <PlatformModulesBoard initialModules={modules} />;
}
