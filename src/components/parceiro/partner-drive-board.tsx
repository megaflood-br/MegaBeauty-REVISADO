"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Palette,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { BrandedArtworkPreview } from "@/components/marketing-drive/artwork-preview";
import { downloadBrandedArtwork } from "@/lib/canvas-brand-compose";
import {
  choosePartnerLogoUrl,
  formatFileSize,
  marketingAssetFileUrl,
  renderMarketingCaption,
  type LogoVariantPreference,
  type MarketingAssetDto,
  type MarketingMediaKind,
} from "@/lib/marketing-drive";
import { cn } from "@/lib/utils";

type PartnerBrandContext = {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  primary: string;
  partnerUrl: string;
};

export function PartnerDriveBoard({
  assets,
  brand,
}: {
  assets: MarketingAssetDto[];
  brand: PartnerBrandContext;
}) {
  const [folderFilter, setFolderFilter] = useState("ALL");
  const [kindFilter, setKindFilter] = useState<"ALL" | MarketingMediaKind>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MarketingAssetDto | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAnyLogo = Boolean(brand.logoUrl || brand.logoDarkUrl);

  const folders = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const a of assets) {
      if (a.folder && !seen.has(a.folder)) {
        seen.add(a.folder);
        list.push(a.folder);
      }
    }
    return list;
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((item) => {
      if (folderFilter !== "ALL" && item.folder !== folderFilter) return false;
      if (kindFilter !== "ALL" && item.mediaKind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.folder.toLowerCase().includes(q) ||
        (item.formatLabel ?? "").toLowerCase().includes(q) ||
        (item.caption ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, folderFilter, kindFilter, search]);

  async function handleQuickDownloadImage(
    asset: MarketingAssetDto,
    options?: { applyLogo?: boolean; variantOverride?: LogoVariantPreference; outputFormat?: "png" | "jpeg" },
  ) {
    setError(null);
    setDownloadingId(asset.id);
    try {
      const shouldApply = options?.applyLogo ?? asset.applyLogo;
      const variant = options?.variantOverride ?? asset.logoVariant;
      const logoUrl = shouldApply
        ? choosePartnerLogoUrl(variant, asset.logoBackdrop, {
            logoUrl: brand.logoUrl,
            logoDarkUrl: brand.logoDarkUrl,
          })
        : null;

      await downloadBrandedArtwork({
        artworkUrl: marketingAssetFileUrl(asset.id),
        title: asset.title,
        brandName: brand.name,
        brandPrimary: brand.primary,
        logoUrl,
        applyLogo: shouldApply,
        config: {
          logoPosition: asset.logoPosition,
          logoX: asset.logoX,
          logoY: asset.logoY,
          logoScale: asset.logoScale,
          logoPadding: asset.logoPadding,
          logoBackdrop: asset.logoBackdrop,
        },
        opacity: asset.logoOpacity,
        outputFormat: options?.outputFormat ?? "png",
      });

      void fetch(`/api/parceiro/materiais/${encodeURIComponent(asset.id)}/download`, {
        method: "POST",
      }).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar a arte personalizada.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleCopyCaption(asset: MarketingAssetDto) {
    const rendered = renderMarketingCaption(asset.caption, {
      brandName: brand.name,
      partnerUrl: brand.partnerUrl,
    });
    if (!rendered) return;
    try {
      await navigator.clipboard.writeText(rendered);
      setCopiedId(asset.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === asset.id ? null : current));
      }, 2000);
    } catch {
      // Clipboard blocked
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Materiais de Marketing</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Baixe artes, vídeos e apresentações para divulgar o <strong>{brand.name}</strong> — as imagens já saem com o seu logo aplicado.
          </p>
        </div>
        <Link
          href="/parceiro/aparencia"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-xs font-medium text-ink transition hover:bg-sand"
        >
          <Palette size={15} />
          {hasAnyLogo ? "Trocar meu logo" : "Cadastrar meu logo"}
        </Link>
      </div>

      {!hasAnyLogo ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          <span>
            Você ainda não enviou um logo em <strong>Marca do sistema</strong>. Enquanto isso, aplicamos o nome{" "}
            <strong>{brand.name}</strong> nas artes — envie seu logo PNG com fundo transparente para um acabamento profissional.
          </span>
          <Link
            href="/parceiro/aparencia"
            className="shrink-0 font-semibold text-amber-900 underline"
          >
            Enviar logo agora
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFolderFilter("ALL")}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              folderFilter === "ALL"
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink-soft hover:bg-sand hover:text-ink",
            )}
          >
            Todas ({assets.length})
          </button>
          {folders.map((folder) => {
            const count = assets.filter((a) => a.folder === folder).length;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => setFolderFilter(folder)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  folderFilter === folder
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-ink-soft hover:bg-sand hover:text-ink",
                )}
              >
                {folder} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-white p-0.5 text-xs">
            {(
              [
                { id: "ALL", label: "Todos" },
                { id: "IMAGE", label: "Artes" },
                { id: "VIDEO", label: "Vídeos" },
                { id: "PDF", label: "PDFs" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setKindFilter(tab.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  kindFilter === tab.id ? "bg-sand text-ink" : "text-ink-soft hover:text-ink",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-56">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar material..."
              className="h-9 pl-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Assets grid */}
      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-12 text-center">
          <FolderOpen size={32} className="text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-ink">
            {assets.length === 0 ? "Nenhum material publicado ainda" : "Nenhum material neste filtro"}
          </h3>
          <p className="mt-1 max-w-md text-sm text-ink-soft">
            {assets.length === 0
              ? "Assim que a equipe da plataforma subir novas artes e vídeos de campanha, eles aparecerão aqui prontos para download."
              : "Tente selecionar outra pasta ou limpar a busca."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((asset) => {
            const fileUrl = marketingAssetFileUrl(asset.id);
            const downloadDirectUrl = marketingAssetFileUrl(asset.id, true);
            const partnerLogo = choosePartnerLogoUrl(asset.logoVariant, asset.logoBackdrop, {
              logoUrl: brand.logoUrl,
              logoDarkUrl: brand.logoDarkUrl,
            });
            const isDownloading = downloadingId === asset.id;

            return (
              <div
                key={asset.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-slate-300"
              >
                <button
                  type="button"
                  onClick={() => setSelected(asset)}
                  className="group relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-slate-100 text-left"
                >
                  {asset.mediaKind === "IMAGE" ? (
                    <BrandedArtworkPreview
                      artworkUrl={fileUrl}
                      alt={asset.title}
                      applyLogo={asset.applyLogo}
                      config={{
                        logoPosition: asset.logoPosition,
                        logoX: asset.logoX,
                        logoY: asset.logoY,
                        logoScale: asset.logoScale,
                        logoPadding: asset.logoPadding,
                        logoBackdrop: asset.logoBackdrop,
                      }}
                      opacity={asset.logoOpacity}
                      logoUrl={partnerLogo}
                      brandName={brand.name}
                      brandPrimary={brand.primary}
                      className="h-full w-full transition group-hover:scale-[1.01]"
                    />
                  ) : asset.mediaKind === "VIDEO" ? (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <Film size={34} />
                      <span className="text-xs font-medium">Vídeo · {formatFileSize(asset.fileSize)}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <FileText size={34} />
                      <span className="text-xs font-medium">Documento PDF · {formatFileSize(asset.fileSize)}</span>
                    </div>
                  )}

                  <span className="absolute top-2.5 left-2.5 rounded-md bg-slate-900/75 px-2 py-0.5 text-[11px] font-medium text-white">
                    {asset.folder}
                  </span>
                </button>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 font-semibold text-ink">{asset.title}</h3>
                    {asset.formatLabel ? (
                      <span className="shrink-0 text-[11px] text-ink-soft">{asset.formatLabel}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-soft">
                    {asset.description ||
                      (asset.caption
                        ? renderMarketingCaption(asset.caption, {
                            brandName: brand.name,
                            partnerUrl: brand.partnerUrl,
                          })
                        : `${formatFileSize(asset.fileSize)}`)}
                  </p>

                  <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                    {asset.mediaKind === "IMAGE" ? (
                      <Button
                        type="button"
                        className="h-8 flex-1 text-xs"
                        disabled={isDownloading}
                        onClick={() => void handleQuickDownloadImage(asset)}
                      >
                        {isDownloading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : asset.applyLogo ? (
                          <Sparkles size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                        {isDownloading
                          ? "Gerando..."
                          : asset.applyLogo
                            ? "Baixar com meu logo"
                            : "Baixar arte"}
                      </Button>
                    ) : (
                      <a
                        href={downloadDirectUrl}
                        download
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-wine px-3 text-xs font-medium text-white transition hover:bg-wine-deep"
                      >
                        <Download size={14} />
                        Baixar arquivo
                      </a>
                    )}

                    {asset.caption ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-2.5 text-xs"
                        title="Copiar legenda pronta com seu link"
                        onClick={() => void handleCopyCaption(asset)}
                      >
                        {copiedId === asset.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs"
                      onClick={() => setSelected(asset)}
                    >
                      Detalhes
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <PartnerAssetPreviewModal
          asset={selected}
          brand={brand}
          downloading={downloadingId === selected.id}
          copied={copiedId === selected.id}
          onClose={() => setSelected(null)}
          onCopyCaption={() => void handleCopyCaption(selected)}
          onDownloadImage={(opts) => void handleQuickDownloadImage(selected, opts)}
        />
      ) : null}
    </div>
  );
}

function PartnerAssetPreviewModal({
  asset,
  brand,
  downloading,
  copied,
  onClose,
  onCopyCaption,
  onDownloadImage,
}: {
  asset: MarketingAssetDto;
  brand: PartnerBrandContext;
  downloading: boolean;
  copied: boolean;
  onClose: () => void;
  onCopyCaption: () => void;
  onDownloadImage: (opts: {
    applyLogo: boolean;
    variantOverride: LogoVariantPreference;
    outputFormat: "png" | "jpeg";
  }) => void;
}) {
  const [applyLogo, setApplyLogo] = useState(asset.applyLogo);
  const [variant, setVariant] = useState<LogoVariantPreference>(asset.logoVariant);

  const fileUrl = marketingAssetFileUrl(asset.id);
  const downloadDirectUrl = marketingAssetFileUrl(asset.id, true);
  const hasBothLogos = Boolean(brand.logoUrl && brand.logoDarkUrl);
  const effectiveLogo = applyLogo
    ? choosePartnerLogoUrl(variant, asset.logoBackdrop, {
        logoUrl: brand.logoUrl,
        logoDarkUrl: brand.logoDarkUrl,
      })
    : null;

  const renderedCaption = renderMarketingCaption(asset.caption, {
    brandName: brand.name,
    partnerUrl: brand.partnerUrl,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label="Fechar" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{asset.title}</h2>
            <p className="text-xs text-ink-soft">
              {[asset.folder, asset.formatLabel, formatFileSize(asset.fileSize)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.2fr_1fr]">
          <div className="flex items-center justify-center bg-slate-100 p-4">
            {asset.mediaKind === "IMAGE" ? (
              <BrandedArtworkPreview
                artworkUrl={fileUrl}
                alt={asset.title}
                applyLogo={applyLogo}
                config={{
                  logoPosition: asset.logoPosition,
                  logoX: asset.logoX,
                  logoY: asset.logoY,
                  logoScale: asset.logoScale,
                  logoPadding: asset.logoPadding,
                  logoBackdrop: asset.logoBackdrop,
                }}
                opacity={asset.logoOpacity}
                logoUrl={effectiveLogo}
                brandName={brand.name}
                brandPrimary={brand.primary}
                className="max-h-[60vh] max-w-full rounded-lg shadow-sm"
              />
            ) : asset.mediaKind === "VIDEO" ? (
              <video
                src={fileUrl}
                controls
                playsInline
                className="max-h-[60vh] w-full rounded-xl bg-black"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <FileText size={44} className="text-slate-400" />
                <div className="text-sm font-medium text-ink">{asset.fileName}</div>
                <p className="max-w-xs text-xs text-ink-soft">
                  Clique em baixar para abrir ou compartilhar este material em PDF com seus clientes.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between gap-4 p-5">
            <div className="space-y-4">
              {asset.description ? (
                <p className="text-sm text-ink-soft">{asset.description}</p>
              ) : null}

              {asset.mediaKind === "IMAGE" ? (
                <div className="space-y-2.5 rounded-xl border border-line bg-cream/40 p-3.5">
                  <div className="text-xs font-semibold text-ink">Personalização com sua marca</div>
                  <label className="flex items-center justify-between gap-2 text-sm text-ink">
                    <span>Aplicar meu logo na arte</span>
                    <input
                      type="checkbox"
                      checked={applyLogo}
                      onChange={(e) => setApplyLogo(e.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </label>
                  {applyLogo && hasBothLogos ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(
                        [
                          { id: "light", label: "Logo padrão" },
                          { id: "dark", label: "Logo claro (fundo escuro)" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setVariant(opt.id)}
                          className={cn(
                            "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                            variant === opt.id
                              ? "border-ink bg-ink text-white"
                              : "border-line bg-white text-ink-soft hover:bg-sand",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {renderedCaption ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink">Legenda sugerida (já com seu link)</span>
                    <button
                      type="button"
                      onClick={onCopyCaption}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copiado!" : "Copiar legenda"}
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-line bg-slate-50 p-3 text-xs whitespace-pre-wrap text-ink">
                    {renderedCaption}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              {asset.mediaKind === "IMAGE" ? (
                <>
                  <Button
                    type="button"
                    className="w-full justify-center"
                    disabled={downloading}
                    onClick={() =>
                      onDownloadImage({
                        applyLogo,
                        variantOverride: variant,
                        outputFormat: "png",
                      })
                    }
                  >
                    {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {downloading
                      ? "Preparando imagem..."
                      : applyLogo
                        ? "Baixar em alta qualidade (PNG com logo)"
                        : "Baixar arte limpa (PNG)"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center text-xs"
                    disabled={downloading}
                    onClick={() =>
                      onDownloadImage({
                        applyLogo,
                        variantOverride: variant,
                        outputFormat: "jpeg",
                      })
                    }
                  >
                    <ImageIcon size={14} />
                    Baixar versão leve para WhatsApp (JPG)
                  </Button>
                </>
              ) : (
                <a
                  href={downloadDirectUrl}
                  download
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-wine px-4 text-sm font-medium text-white transition hover:bg-wine-deep"
                >
                  <Download size={16} />
                  Baixar arquivo original
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
