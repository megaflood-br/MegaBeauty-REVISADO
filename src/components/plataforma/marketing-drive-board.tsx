"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  EyeOff,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { BrandedArtworkPreview } from "@/components/marketing-drive/artwork-preview";
import {
  DEFAULT_MARKETING_FOLDERS,
  LOGO_BACKDROP_OPTIONS,
  LOGO_POSITION_OPTIONS,
  LOGO_VARIANT_OPTIONS,
  formatFileSize,
  marketingAssetFileUrl,
  type LogoBackdropStyle,
  type LogoPositionPreset,
  type LogoVariantPreference,
  type MarketingAssetDto,
} from "@/lib/marketing-drive";
import { cn } from "@/lib/utils";

export function PlatformMarketingDriveBoard({ assets }: { assets: MarketingAssetDto[] }) {
  const router = useRouter();
  const confirm = useConfirm();

  const [folderFilter, setFolderFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [drawerAsset, setDrawerAsset] = useState<MarketingAssetDto | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  const folders = useMemo(() => {
    const set = new Set<string>(DEFAULT_MARKETING_FOLDERS);
    for (const item of assets) {
      if (item.folder) set.add(item.folder);
    }
    return [...set];
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((item) => {
      if (folderFilter !== "ALL" && item.folder !== folderFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.folder.toLowerCase().includes(q) ||
        (item.formatLabel ?? "").toLowerCase().includes(q) ||
        (item.caption ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, folderFilter, search]);

  const stats = useMemo(() => {
    let totalDownloads = 0;
    let imagesCount = 0;
    let activeCount = 0;
    for (const a of assets) {
      totalDownloads += a.downloadsCount;
      if (a.mediaKind === "IMAGE") imagesCount += 1;
      if (a.active) activeCount += 1;
    }
    return { total: assets.length, activeCount, imagesCount, totalDownloads };
  }, [assets]);

  async function toggleActive(asset: MarketingAssetDto) {
    setBusyId(asset.id);
    try {
      await fetch(`/api/plataforma/materiais/${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !asset.active }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(asset: MarketingAssetDto) {
    const ok = await confirm({
      title: `Excluir "${asset.title}"?`,
      description: "O arquivo será removido do Drive e deixará de aparecer para todos os parceiros.",
      confirmLabel: "Excluir material",
      danger: true,
    });
    if (!ok) return;
    setBusyId(asset.id);
    try {
      await fetch(`/api/plataforma/materiais/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Drive de Marketing</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Envie artes, vídeos e PDFs para seus parceiros baixarem — imagens recebem o logo de cada parceiro automaticamente.
          </p>
        </div>
        <Button type="button" onClick={() => setDrawerAsset(null)}>
          <Plus size={16} />
          Enviar material
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-white px-4 py-3">
          <div className="text-xs text-ink-soft">Total de arquivos</div>
          <div className="mt-1 text-2xl font-semibold text-ink">{stats.total}</div>
        </div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3">
          <div className="text-xs text-ink-soft">Publicados para parceiros</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{stats.activeCount}</div>
        </div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3">
          <div className="text-xs text-ink-soft">Artes com logo automático</div>
          <div className="mt-1 text-2xl font-semibold text-ink">{stats.imagesCount}</div>
        </div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3">
          <div className="text-xs text-ink-soft">Downloads pelos parceiros</div>
          <div className="mt-1 text-2xl font-semibold text-blue-700">{stats.totalDownloads}</div>
        </div>
      </div>

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
            if (count === 0 && !DEFAULT_MARKETING_FOLDERS.includes(folder as (typeof DEFAULT_MARKETING_FOLDERS)[number])) {
              return null;
            }
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
                {folder} {count > 0 ? `(${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar material..."
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      {/* Assets grid */}
      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-12 text-center">
          <FolderOpen size={32} className="text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-ink">
            {assets.length === 0 ? "Nenhum material no Drive ainda" : "Nenhum material encontrado"}
          </h3>
          <p className="mt-1 max-w-md text-sm text-ink-soft">
            {assets.length === 0
              ? "Suba artes para Feed, Stories, Anúncios, Vídeos ou PDFs. Você define onde o logo do parceiro aparece e eles já baixam pronto para publicar."
              : "Tente limpar o filtro de pasta ou ajustar o termo buscado."}
          </p>
          {assets.length === 0 ? (
            <Button type="button" className="mt-4" onClick={() => setDrawerAsset(null)}>
              <Upload size={16} />
              Enviar primeiro material
            </Button>
          ) : null}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((asset) => {
            const fileUrl = marketingAssetFileUrl(asset.id);
            const isBusy = busyId === asset.id;
            return (
              <div
                key={asset.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-2xl border bg-white transition",
                  asset.active ? "border-line" : "border-line opacity-70",
                )}
              >
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-100">
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
                      logoUrl={null}
                      brandName="LOGO PARCEIRO"
                      className="h-full w-full"
                    />
                  ) : asset.mediaKind === "VIDEO" ? (
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <Film size={32} />
                      <span className="text-xs font-medium">Vídeo ({formatFileSize(asset.fileSize)})</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <FileText size={32} />
                      <span className="text-xs font-medium">PDF ({formatFileSize(asset.fileSize)})</span>
                    </div>
                  )}

                  <span className="absolute top-2.5 left-2.5 rounded-md bg-slate-900/75 px-2 py-0.5 text-[11px] font-medium text-white">
                    {asset.folder}
                  </span>
                  {!asset.active ? (
                    <span className="absolute top-2.5 right-2.5 rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white">
                      Oculto
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 font-semibold text-ink">{asset.title}</h3>
                    {asset.formatLabel ? (
                      <span className="shrink-0 text-[11px] text-ink-soft">{asset.formatLabel}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-soft">
                    {asset.description || asset.caption || `${asset.fileName} · ${formatFileSize(asset.fileSize)}`}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
                    <span className="inline-flex items-center gap-1">
                      {asset.mediaKind === "IMAGE" ? (
                        asset.applyLogo ? (
                          <>
                            <Sparkles size={13} className="text-wine" />
                            Logo automático
                          </>
                        ) : (
                          <>
                            <ImageIcon size={13} />
                            Sem logo
                          </>
                        )
                      ) : asset.mediaKind === "VIDEO" ? (
                        "Download direto"
                      ) : (
                        "Documento PDF"
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Download size={13} />
                      {asset.downloadsCount}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 flex-1 text-xs"
                      onClick={() => setDrawerAsset(asset)}
                    >
                      <Pencil size={13} />
                      Configurar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs"
                      disabled={isBusy}
                      title={asset.active ? "Ocultar dos parceiros" : "Publicar para parceiros"}
                      onClick={() => void toggleActive(asset)}
                    >
                      {asset.active ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={isBusy}
                      title="Excluir"
                      onClick={() => void handleDelete(asset)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drawerAsset !== undefined ? (
        <MarketingAssetDrawer
          asset={drawerAsset}
          folders={folders}
          onClose={() => setDrawerAsset(undefined)}
          onSaved={() => {
            setDrawerAsset(undefined);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function MarketingAssetDrawer({
  asset,
  folders,
  onClose,
  onSaved,
}: {
  asset: MarketingAssetDto | null;
  folders: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(asset);

  const [file, setFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [detectedKind, setDetectedKind] = useState<"IMAGE" | "VIDEO" | "PDF">(asset?.mediaKind ?? "IMAGE");

  const [title, setTitle] = useState(asset?.title ?? "");
  const [folder, setFolder] = useState(asset?.folder ?? "Feed");
  const [formatLabel, setFormatLabel] = useState(asset?.formatLabel ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [caption, setCaption] = useState(asset?.caption ?? "");
  const [active, setActive] = useState(asset?.active ?? true);

  const [applyLogo, setApplyLogo] = useState(asset?.applyLogo ?? true);
  const [logoPosition, setLogoPosition] = useState<LogoPositionPreset>(asset?.logoPosition ?? "bottom-right");
  const [logoX, setLogoX] = useState(asset?.logoX ?? 88);
  const [logoY, setLogoY] = useState(asset?.logoY ?? 88);
  const [logoScale, setLogoScale] = useState(asset?.logoScale ?? 22);
  const [logoOpacity, setLogoOpacity] = useState(asset?.logoOpacity ?? 100);
  const [logoPadding, setLogoPadding] = useState(asset?.logoPadding ?? 4);
  const [logoBackdrop, setLogoBackdrop] = useState<LogoBackdropStyle>(asset?.logoBackdrop ?? "none");
  const [logoVariant, setLogoVariant] = useState<LogoVariantPreference>(asset?.logoVariant ?? "auto");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewImageUrl =
    detectedKind === "IMAGE"
      ? localPreviewUrl || (asset ? marketingAssetFileUrl(asset.id) : null)
      : null;

  function handleSelectFile(picked: File | null) {
    if (!picked) return;
    setError(null);
    setFile(picked);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120));
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);

    const lower = picked.name.toLowerCase();
    if (picked.type.startsWith("video/") || lower.endsWith(".mp4") || lower.endsWith(".webm")) {
      setDetectedKind("VIDEO");
      setLocalPreviewUrl(null);
      setApplyLogo(false);
      if (folder === "Feed") setFolder("Vídeos");
    } else if (picked.type === "application/pdf" || lower.endsWith(".pdf")) {
      setDetectedKind("PDF");
      setLocalPreviewUrl(null);
      setApplyLogo(false);
      if (folder === "Feed") setFolder("Apresentações / PDF");
    } else {
      setDetectedKind("IMAGE");
      setLocalPreviewUrl(URL.createObjectURL(picked));
      setApplyLogo(true);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!isEditing && !file) {
      setError("Selecione um arquivo para enviar ao Drive.");
      return;
    }
    if (!title.trim()) {
      setError("Informe um título para o material.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing && asset) {
        const res = await fetch(`/api/plataforma/materiais/${encodeURIComponent(asset.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            folder: folder.trim() || "Feed",
            formatLabel: formatLabel.trim() || null,
            description: description.trim() || null,
            caption: caption.trim() || null,
            active,
            applyLogo: detectedKind === "IMAGE" ? applyLogo : false,
            logoPosition,
            logoX,
            logoY,
            logoScale,
            logoOpacity,
            logoPadding,
            logoBackdrop,
            logoVariant,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Não foi possível atualizar o material.");
          return;
        }
      } else if (file) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("title", title.trim());
        fd.set("folder", folder.trim() || "Feed");
        fd.set("formatLabel", formatLabel.trim());
        fd.set("description", description.trim());
        fd.set("caption", caption.trim());
        fd.set("active", active ? "1" : "0");
        fd.set("applyLogo", detectedKind === "IMAGE" && applyLogo ? "1" : "0");
        fd.set("logoPosition", logoPosition);
        fd.set("logoX", String(logoX));
        fd.set("logoY", String(logoY));
        fd.set("logoScale", String(logoScale));
        fd.set("logoOpacity", String(logoOpacity));
        fd.set("logoPadding", String(logoPadding));
        fd.set("logoBackdrop", logoBackdrop);
        fd.set("logoVariant", logoVariant);

        const res = await fetch("/api/plataforma/materiais", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Não foi possível enviar o arquivo.");
          return;
        }
      }
      onSaved();
    } catch {
      setError("Erro ao salvar o material. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isEditing ? "Configurar material" : "Enviar material para o Drive"}
            </h2>
            <p className="text-xs text-ink-soft">
              Aceita PNG, JPG, WebP (até 10 MB), PDF (até 10 MB) e vídeos MP4/WebM (até 20 MB).
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-sand" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.05fr_1fr]">
          {/* Left column: File upload + live visual logo placement */}
          <div className="border-b border-line bg-slate-50/70 p-5 lg:border-r lg:border-b-0">
            {!isEditing ? (
              <div className="mb-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.pdf,.mp4,.webm"
                  className="hidden"
                  onChange={(e) => {
                    handleSelectFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" className="w-full justify-center" onClick={() => fileRef.current?.click()}>
                  <Upload size={15} />
                  {file ? `Trocar arquivo (${file.name})` : "Escolher arquivo de mídia"}
                </Button>
              </div>
            ) : null}

            <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-2xl border border-line bg-white p-3">
              {previewImageUrl ? (
                <BrandedArtworkPreview
                  artworkUrl={previewImageUrl}
                  alt={title || "Prévia da arte"}
                  applyLogo={applyLogo}
                  config={{
                    logoPosition,
                    logoX,
                    logoY,
                    logoScale,
                    logoPadding,
                    logoBackdrop,
                  }}
                  opacity={logoOpacity}
                  logoUrl={null}
                  brandName="LOGO PARCEIRO"
                  interactive={applyLogo}
                  onPickCustomPosition={(x, y) => {
                    setLogoPosition("custom");
                    setLogoX(x);
                    setLogoY(y);
                  }}
                  className="max-h-[420px] max-w-full"
                />
              ) : detectedKind === "VIDEO" ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-soft">
                  <Film size={36} className="text-slate-400" />
                  <p className="text-sm font-medium text-ink">{file?.name || asset?.fileName || "Vídeo"}</p>
                  <p className="text-xs">Vídeos ficam disponíveis para download direto pelos parceiros.</p>
                </div>
              ) : detectedKind === "PDF" ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-soft">
                  <FileText size={36} className="text-slate-400" />
                  <p className="text-sm font-medium text-ink">{file?.name || asset?.fileName || "Documento PDF"}</p>
                  <p className="text-xs">PDFs ficam disponíveis para download direto pelos parceiros.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-soft">
                  <ImageIcon size={36} className="text-slate-300" />
                  <p className="text-sm">Escolha uma arte para visualizar o posicionamento do logo.</p>
                </div>
              )}
            </div>

            {detectedKind === "IMAGE" && previewImageUrl ? (
              <p className="mt-2 text-center text-xs text-ink-soft">
                {applyLogo
                  ? "Clique diretamente sobre a arte para posicionar o logo em qualquer lugar, ou use os atalhos ao lado."
                  : "Aplicação automática de logo desativada para esta arte."}
              </p>
            ) : null}
          </div>

          {/* Right column: Metadata + Logo placement controls */}
          <div className="space-y-4 p-5">
            <Field label="Título do material" required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Post Feed — Agenda cheia no salão"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pasta / Categoria">
                <Input
                  value={folder}
                  list="marketing-folders-list"
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Feed"
                />
                <datalist id="marketing-folders-list">
                  {folders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </Field>
              <Field label="Formato (opcional)">
                <Input
                  value={formatLabel}
                  onChange={(e) => setFormatLabel(e.target.value)}
                  placeholder="Ex.: 1080×1080 · Feed"
                />
              </Field>
            </div>

            <Field label="Descrição curta">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Ideal para campanha de tráfego pago no Instagram"
              />
            </Field>

            <Field label="Legenda / Copy sugerida (opcional)">
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="min-h-24 text-sm"
                placeholder="Use {{marca}} e {{link}} para personalizar automaticamente para cada parceiro..."
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCaption((prev) => `${prev}${prev ? " " : ""}{{marca}}`)}
                  className="rounded-md border border-line bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-sand hover:text-ink"
                >
                  + Inserir {"{{marca}}"}
                </button>
                <button
                  type="button"
                  onClick={() => setCaption((prev) => `${prev}${prev ? " " : ""}{{link}}`)}
                  className="rounded-md border border-line bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-sand hover:text-ink"
                >
                  + Inserir {"{{link}}"}
                </button>
              </div>
            </Field>

            {detectedKind === "IMAGE" ? (
              <div className="space-y-3 rounded-xl border border-line bg-cream/40 p-3.5">
                <label className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
                  <span>Aplicar logo do parceiro ao baixar</span>
                  <input
                    type="checkbox"
                    checked={applyLogo}
                    onChange={(e) => setApplyLogo(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                </label>

                {applyLogo ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Posição do logo">
                        <Select
                          value={logoPosition}
                          onChange={(e) => setLogoPosition(e.target.value as LogoPositionPreset)}
                        >
                          {LOGO_POSITION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Fundo atrás do logo">
                        <Select
                          value={logoBackdrop}
                          onChange={(e) => setLogoBackdrop(e.target.value as LogoBackdropStyle)}
                        >
                          {LOGO_BACKDROP_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <Field label="Versão do logo preferida">
                      <Select
                        value={logoVariant}
                        onChange={(e) => setLogoVariant(e.target.value as LogoVariantPreference)}
                      >
                        {LOGO_VARIANT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="grid gap-1 text-xs font-medium text-ink-soft">
                        <span>Tamanho ({logoScale}%)</span>
                        <input
                          type="range"
                          min={8}
                          max={50}
                          value={logoScale}
                          onChange={(e) => setLogoScale(Number(e.target.value))}
                          className="accent-blue-600"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-ink-soft">
                        <span>Opacidade ({logoOpacity}%)</span>
                        <input
                          type="range"
                          min={30}
                          max={100}
                          value={logoOpacity}
                          onChange={(e) => setLogoOpacity(Number(e.target.value))}
                          className="accent-blue-600"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-ink-soft">
                        <span>Margem ({logoPadding}%)</span>
                        <input
                          type="range"
                          min={0}
                          max={12}
                          value={logoPadding}
                          onChange={(e) => setLogoPadding(Number(e.target.value))}
                          className="accent-blue-600"
                        />
                      </label>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              Visível imediatamente no portal dos parceiros
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Publicar no Drive"}
          </Button>
        </div>
      </aside>
    </div>
  );
}
