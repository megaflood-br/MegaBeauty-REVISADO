import { requireSupplier } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { SupplierProductBoard } from "@/components/fornecedor/product-board";
import { DashboardSetupBanner } from "@/components/onboarding/dashboard-setup-banner";
import { loadPlatformModules } from "@/lib/platform-modules-server";

export default async function FornecedorProdutosPage() {
  const { session } = await requireSupplier();
  const [modules, products] = await Promise.all([
    loadPlatformModules(),
    prisma.supplierProduct.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <div className="space-y-5">
      <DashboardSetupBanner />
      <SupplierProductBoard
        enableBulkImport={modules.supplierBulkImport}
        enableWebImageSearch={modules.webImageSearch}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          brand: product.brand,
          sku: product.sku,
          category: product.category,
          unit: product.unit,
          priceCents: product.priceCents,
          minQty: product.minQty,
          stock: product.stock,
          description: product.description,
          imageUrl: product.imageUrl,
          active: product.active,
        }))}
      />
    </div>
  );
}
