"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Camera,
  Check,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Link2,
  Loader2,
  Save,
  Send,
  Sparkles,
  Trash2,
  Unlink,
  Wand2,
} from "lucide-react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import {
  STUDIO_FORMATS,
  STUDIO_STYLES,
  buildFallbackMarketingCopy,
  formatStudioPriceSummary,
  parseMoneyInputToCents,
  type StudioCatalogItem,
  type StudioFormatId,
  type StudioInstagramStatus,
  type StudioPostRecord,
  type StudioSalonProfile,
  type StudioStyleId,
} from "@/lib/marketing-studio";
import {
  renderMarketingArtworkToCanvas,
  renderMarketingArtworkToJpegDataUrl,
} from "@/lib/canvas-marketing-studio";
import { formatBRL } from "@/lib/money";
import { readProductPhoto } from "@/lib/product-photo";
import { cn } from "@/lib/utils";

function centsToFormValue(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

const DATE_PRESETS = [
  "Somente esta semana",
  "Vagas até sábado",
  "Terça a quinta",
  "Válido este mês",
];

export function AiStudioBoard({
  salon,
  catalog,
  initialPosts,
  instagram,
  hasOpenAi,
  canManage,
  instagramPublishEnabled,
}: {
  salon: StudioSalonProfile;
  catalog: StudioCatalogItem[];
  initialPosts: StudioPostRecord[];
  instagram: StudioInstagramStatus;
  hasOpenAi: boolean;
  canManage: boolean;
  instagramPublishEnabled: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);

  const firstItem = catalog[0] ?? null;

  const [selectedId, setSelectedId] = useState<string>(firstItem?.id ?? "");
  const [customTitle, setCustomTitle] = useState<string>(firstItem?.name ?? "Procedimento Especial");
  const [originalPrice, setOriginalPrice] = useState<string>(
    firstItem ? centsToFormValue(firstItem.priceCents) : "",
  );
  const [promoPrice, setPromoPrice] = useState<string>("");
  const [dateRange, setDateRange] = useState<string>("Somente esta semana");
  const [format, setFormat] = useState<StudioFormatId>("feed");
  const [style, setStyle] = useState<StudioStyleId>("editorial");
  const [generateAiBg, setGenerateAiBg] = useState<boolean>(false);
  const [customBgUrl, setCustomBgUrl] = useState<string | null>(firstItem?.imageUrl ?? null);

  const initialCopy = useMemo(
    () =>
      buildFallbackMarketingCopy({
        salonName: salon.name,
        itemName: firstItem?.name ?? "Procedimento Especial",
        itemKind: firstItem?.kind ?? "SERVICE",
        description: firstItem?.description,
        originalPriceCents: firstItem?.priceCents ?? null,
        promoPriceCents: null,
        dateRange: "Somente esta semana",
        bookingUrl: salon.bookingUrl,
        phone: salon.phone,
        city: salon.city,
      }),
    [firstItem, salon],
  );

  const [badgeText, setBadgeText] = useState<string>(initialCopy.badgeText);
  const [headline, setHeadline] = useState<string>(initialCopy.headline);
  const [subline, setSubline] = useState<string>(
    firstItem?.description?.slice(0, 90) ||
      (firstItem?.durationMin ? `Atendimento de ${firstItem.durationMin} min com nossa equipe` : ""),
  );
  const [ctaText, setCtaText] = useState<string>(initialCopy.ctaText);
  const [caption, setCaption] = useState<string>(initialCopy.caption);

  const [posts, setPosts] = useState<StudioPostRecord[]>(initialPosts);
  const [igStatus, setIgStatus] = useState<StudioInstagramStatus>(instagram);

  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishingTarget, setPublishingTarget] = useState<"FEED" | "STORY" | null>(null);
  const [connectingIg, setConnectingIg] = useState(false);
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);

  const selectedItem = useMemo(
    () => catalog.find((item) => item.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  const priceSummary = useMemo(() => {
    const origCents = parseMoneyInputToCents(originalPrice);
    const promoCents = parseMoneyInputToCents(promoPrice);
    return formatStudioPriceSummary(origCents, promoCents);
  }, [originalPrice, promoPrice]);

  const effectiveBgUrl = customBgUrl ?? selectedItem?.imageUrl ?? null;

  function applyCatalogSelection(id: string) {
    setSelectedId(id);
    const found = catalog.find((item) => item.id === id);
    if (!found) return;
    setCustomTitle(found.name);
    setOriginalPrice(centsToFormValue(found.priceCents));
    setPromoPrice("");
    setCustomBgUrl(found.imageUrl ?? null);
    const generated = buildFallbackMarketingCopy({
      salonName: salon.name,
      itemName: found.name,
      itemKind: found.kind,
      description: found.description,
      originalPriceCents: found.priceCents,
      promoPriceCents: null,
      dateRange,
      bookingUrl: salon.bookingUrl,
      phone: salon.phone,
      city: salon.city,
    });
    setBadgeText(generated.badgeText);
    setHeadline(generated.headline);
    setSubline(
      found.description?.slice(0, 90) ||
        (found.durationMin ? `Atendimento de ${found.durationMin} min com nossa equipe` : ""),
    );
    setCtaText(generated.ctaText);
    setCaption(generated.caption);
    setFeedback(null);
  }

  // Re-render live Canvas preview whenever art inputs change
  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderMarketingArtworkToCanvas(canvas, {
      format,
      style,
      backgroundUrl: effectiveBgUrl,
      logoUrl: salon.logoUrl,
      salonName: salon.name,
      accentColor: salon.accentColor,
      badgeText,
      headline,
      subline,
      priceText: priceSummary.priceText,
      promoPriceText: priceSummary.promoPriceText,
      dateRangeText: dateRange,
      ctaText,
      phone: salon.phone || "",
    }).catch(() => {
      if (active) {
        // ignore transient image load errors
      }
    });
    return () => {
      active = false;
    };
  }, [
    format,
    style,
    effectiveBgUrl,
    salon.logoUrl,
    salon.name,
    salon.accentColor,
    salon.phone,
    badgeText,
    headline,
    subline,
    priceSummary.priceText,
    priceSummary.promoPriceText,
    dateRange,
    ctaText,
  ]);

  // Listen for Instagram popup OAuth postMessage completion
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as { type?: string; username?: string; error?: string } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "INSTAGRAM_OAUTH_SUCCESS") {
        setConnectingIg(false);
        setIgStatus((prev) => ({
          ...prev,
          connected: true,
          username: data.username || prev.username || "instagram",
          connectedAt: new Date().toISOString(),
        }));
        setFeedback({
          kind: "ok",
          text: `Instagram @${data.username || "conectado"} vinculado com sucesso! Agora você já pode publicar direto da plataforma.`,
        });
        router.refresh();
      } else if (data.type === "INSTAGRAM_OAUTH_ERROR") {
        setConnectingIg(false);
        setFeedback({
          kind: "error",
          text: data.error || "Não foi possível conectar o Instagram.",
        });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  async function renderCurrentArtworkDataUrl(): Promise<string> {
    return renderMarketingArtworkToJpegDataUrl({
      format,
      style,
      backgroundUrl: effectiveBgUrl,
      logoUrl: salon.logoUrl,
      salonName: salon.name,
      accentColor: salon.accentColor,
      badgeText,
      headline,
      subline,
      priceText: priceSummary.priceText,
      promoPriceText: priceSummary.promoPriceText,
      dateRangeText: dateRange,
      ctaText,
      phone: salon.phone || "",
    });
  }

  async function handleGenerateAi() {
    setGenerating(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/marketing/studio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemName: customTitle.trim() || selectedItem?.name || "Atendimento Especial",
          itemKind: selectedItem?.kind ?? "SERVICE",
          description: selectedItem?.description ?? subline,
          originalPrice,
          promoPrice,
          dateRange,
          format,
          style,
          bookingUrl: salon.bookingUrl,
          generateAiBackground: generateAiBg,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        headline?: string;
        badgeText?: string;
        ctaText?: string;
        caption?: string;
        backgroundDataUrl?: string | null;
        source?: string;
        aiImageWarning?: string | null;
      };
      if (!response.ok || !data.ok) {
        setFeedback({ kind: "error", text: data.error || "Não foi possível gerar a arte com IA." });
        return;
      }
      if (data.headline) setHeadline(data.headline);
      if (data.badgeText) setBadgeText(data.badgeText);
      if (data.ctaText) setCtaText(data.ctaText);
      if (data.caption) setCaption(data.caption);
      if (data.backgroundDataUrl) setCustomBgUrl(data.backgroundDataUrl);

      setFeedback({
        kind: data.aiImageWarning ? "warn" : "ok",
        text: data.aiImageWarning
          ? data.aiImageWarning
          : data.source === "openai"
            ? "Arte e legenda geradas com IA! Revise os textos e publique ou baixe em alta resolução."
            : "Texto promocional atualizado automaticamente com os dados do salão.",
      });
    } catch {
      setFeedback({ kind: "error", text: "Erro de conexão ao gerar arte." });
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadArtwork() {
    try {
      const dataUrl = await renderCurrentArtworkDataUrl();
      const link = document.createElement("a");
      const slug = (customTitle || "arte-salao")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      link.download = `${slug || "arte"}-${format}.jpg`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setFeedback({ kind: "error", text: "Não foi possível exportar a imagem." });
    }
  }

  async function handleCopyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 2000);
    } catch {
      setFeedback({ kind: "error", text: "Não foi possível copiar a legenda automaticamente." });
    }
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setFeedback(null);
    try {
      const imageDataUrl = await renderCurrentArtworkDataUrl();
      const response = await fetch("/api/marketing/studio/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedItem?.kind === "SERVICE" ? selectedItem.id : null,
          packageId: selectedItem?.kind === "PACKAGE" ? selectedItem.id : null,
          title: customTitle.trim() || "Arte promocional",
          headline,
          badgeText,
          priceText: priceSummary.priceText,
          promoPriceText: priceSummary.promoPriceText,
          dateRangeText: dateRange,
          ctaText,
          caption,
          format,
          style,
          publishTarget: format === "story" ? "STORY" : "FEED",
          imageDataUrl,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        post?: StudioPostRecord;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.post) {
        setFeedback({ kind: "error", text: data.error || "Não foi possível salvar o rascunho." });
        return;
      }
      setPosts((prev) => [data.post!, ...prev]);
      setFeedback({ kind: "ok", text: "Arte salva no histórico do salão." });
    } catch {
      setFeedback({ kind: "error", text: "Erro ao salvar arte." });
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleConnectInstagram() {
    setConnectingIg(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/instagram/oauth/url");
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.url) {
        setConnectingIg(false);
        setFeedback({ kind: "error", text: data.error || "Não foi possível iniciar o login da Meta." });
        return;
      }
      const popup = window.open(
        data.url,
        "instagram_oauth_popup",
        "width=640,height=740,menubar=no,toolbar=no,status=no",
      );
      if (!popup) {
        setConnectingIg(false);
        setFeedback({
          kind: "warn",
          text: "O navegador bloqueou a janela de autorização da Meta. Libere pop-ups para este site e tente novamente.",
        });
      }
    } catch {
      setConnectingIg(false);
      setFeedback({ kind: "error", text: "Falha ao abrir a autorização do Instagram." });
    }
  }

  async function handleDisconnectInstagram() {
    const ok = await confirm({
      title: "Desconectar Instagram?",
      description: "Você poderá reconectar sua conta Instagram Business a qualquer momento.",
      confirmLabel: "Desconectar",
      danger: true,
    });
    if (!ok) return;
    const response = await fetch("/api/instagram/disconnect", { method: "POST" });
    if (response.ok) {
      setIgStatus((prev) => ({
        ...prev,
        connected: false,
        username: null,
        pageName: null,
        connectedAt: null,
      }));
      setFeedback({ kind: "ok", text: "Conta Instagram desconectada." });
      router.refresh();
    }
  }

  async function handlePublishInstagram(target: "FEED" | "STORY") {
    setPublishingTarget(target);
    setFeedback(null);
    try {
      const imageDataUrl = await renderCurrentArtworkDataUrl();
      const response = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedItem?.kind === "SERVICE" ? selectedItem.id : null,
          packageId: selectedItem?.kind === "PACKAGE" ? selectedItem.id : null,
          title: customTitle.trim() || "Arte promocional",
          headline,
          badgeText,
          priceText: priceSummary.priceText,
          promoPriceText: priceSummary.promoPriceText,
          dateRangeText: dateRange,
          ctaText,
          caption,
          format,
          style,
          publishTarget: target,
          imageDataUrl,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        post?: StudioPostRecord;
        error?: string;
      };
      if (data.post) {
        setPosts((prev) => [data.post!, ...prev]);
      }
      if (!response.ok || !data.ok) {
        setFeedback({
          kind: "error",
          text: data.error || "A Meta não concluiu a publicação. A arte ficou salva no histórico.",
        });
        return;
      }
      setFeedback({
        kind: "ok",
        text:
          target === "STORY"
            ? "Publicado nos Stories do Instagram com sucesso!"
            : "Publicado no Feed do Instagram com sucesso!",
      });
    } catch {
      setFeedback({ kind: "error", text: "Falha de conexão ao publicar no Instagram." });
    } finally {
      setPublishingTarget(null);
    }
  }

  async function handleDeletePost(id: string) {
    const ok = await confirm({
      title: "Excluir arte do histórico?",
      description: "Isso remove apenas o registro na plataforma (não apaga publicações já feitas no Instagram).",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    const response = await fetch(`/api/marketing/studio/posts?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setPosts((prev) => prev.filter((item) => item.id !== id));
    }
  }

  const previewAspectClass =
    format === "story" ? "aspect-[9/16] max-w-[290px]" : format === "portrait" ? "aspect-[4/5] max-w-[360px]" : "aspect-square max-w-[400px]";

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            feedback.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : feedback.kind === "warn"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-rose-200 bg-rose-50 text-rose-900",
          )}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        {/* Left column: Controls & AI copy */}
        <div className="space-y-4">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">1. Escolha o serviço ou pacote</h2>
                <p className="text-xs text-ink-soft">
                  Puxamos foto, valor, marca, WhatsApp e link de agendamento automaticamente do seu salão.
                </p>
              </div>
              {canManage ? (
                <Button
                  type="button"
                  disabled={generating}
                  onClick={() => void handleGenerateAi()}
                >
                  {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {generating ? "Gerando com IA..." : "Gerar textos com IA"}
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Serviço ou Pacote cadastrado">
                <select
                  value={selectedId}
                  onChange={(e) => applyCatalogSelection(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm"
                >
                  <option value="">Personalizado (digitar manualmente)</option>
                  {catalog.filter((i) => i.kind === "SERVICE").length > 0 ? (
                    <optgroup label="Serviços">
                      {catalog
                        .filter((i) => i.kind === "SERVICE")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {formatBRL(item.priceCents)}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {catalog.filter((i) => i.kind === "PACKAGE").length > 0 ? (
                    <optgroup label="Pacotes">
                      {catalog
                        .filter((i) => i.kind === "PACKAGE")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {formatBRL(item.priceCents)}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                </select>
              </Field>

              <Field label="Nome na campanha">
                <Input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Ex.: Mechas + Hidratação"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Valor normal (R$)">
                <Input
                  value={originalPrice}
                  onChange={(e) => setOriginalPrice(e.target.value)}
                  placeholder="Ex.: 180,00"
                />
              </Field>
              <Field label="Valor promocional (R$)">
                <Input
                  value={promoPrice}
                  onChange={(e) => setPromoPrice(e.target.value)}
                  placeholder="Opcional: 139,90"
                />
              </Field>
              <Field label="Datas / Validade">
                <Input
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  placeholder="Ex.: 10 a 15/12"
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                <Calendar size={12} />
                Atalhos:
              </span>
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDateRange(preset)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition",
                    dateRange === preset
                      ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                      : "border-line bg-white text-ink-soft hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              ))}
              {dateRange ? (
                <button
                  type="button"
                  onClick={() => setDateRange("")}
                  className="rounded-full px-2 py-1 text-xs text-ink-soft hover:text-ink"
                >
                  Limpar data
                </button>
              ) : null}
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-base font-semibold">2. Formato, estilo e fundo da arte</h2>

            <div className="grid gap-2 sm:grid-cols-3">
              {STUDIO_FORMATS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFormat(item.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition",
                    format === item.id
                      ? "border-blue-600 bg-blue-50 text-blue-950"
                      : "border-line bg-white text-ink hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{item.label}</span>
                    <span className="text-xs text-ink-soft">{item.ratio}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-soft">
                    {item.width} × {item.height} px
                  </div>
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {STUDIO_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStyle(item.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition",
                    style === item.id
                      ? "border-blue-600 bg-blue-50 text-blue-950"
                      : "border-line bg-white text-ink hover:bg-slate-50",
                  )}
                >
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="mt-0.5 text-[11px] text-ink-soft">{item.description}</div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-slate-50/70 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={bgFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void readProductPhoto(file)
                      .then((url) => setCustomBgUrl(url))
                      .catch((err: Error) => setFeedback({ kind: "error", text: err.message }));
                  }}
                />
                <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => bgFileRef.current?.click()}>
                  <ImagePlus size={14} />
                  Enviar foto de fundo
                </Button>
                {effectiveBgUrl ? (
                  <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setCustomBgUrl("")}>
                    Usar só gradiente da marca
                  </Button>
                ) : null}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
                <input
                  type="checkbox"
                  checked={generateAiBg}
                  onChange={(e) => setGenerateAiBg(e.target.checked)}
                  disabled={!hasOpenAi}
                  className="accent-blue-600"
                />
                <Wand2 size={13} className="text-blue-600" />
                <span>
                  Gerar foto de fundo com IA{" "}
                  {!hasOpenAi ? "(requer chave OpenAI na plataforma)" : "(opcional)"}
                </span>
              </label>
            </div>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-semibold">3. Textos da arte e legenda</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Selo de destaque (topo da oferta)">
                <Input value={badgeText} onChange={(e) => setBadgeText(e.target.value)} maxLength={42} />
              </Field>
              <Field label="Chamada de ação (botão rodapé)">
                <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} maxLength={56} />
              </Field>
            </div>
            <Field label="Título principal na arte">
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Subtítulo curto (opcional)">
              <Input
                value={subline}
                onChange={(e) => setSubline(e.target.value)}
                placeholder="Ex.: Resultado imediato com produtos profissionais"
                maxLength={100}
              />
            </Field>
            <Field label="Legenda para o Instagram">
              <Textarea rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleCopyCaption()}>
                {copiedCaption ? <Check size={15} /> : <Copy size={15} />}
                {copiedCaption ? "Legenda copiada" : "Copiar legenda"}
              </Button>
            </div>
          </Card>
        </div>

        {/* Right column: Live high-res preview & Instagram direct publish */}
        <div className="space-y-4">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Prévia em alta resolução</h2>
                <p className="text-xs text-ink-soft">
                  Logo e cores do salão aplicados com nitidez profissional.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void handleDownloadArtwork()}>
                  <Download size={15} />
                  Baixar JPG
                </Button>
                {canManage ? (
                  <Button type="button" variant="outline" disabled={savingDraft} onClick={() => void handleSaveDraft()}>
                    {savingDraft ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Salvar
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex justify-center rounded-2xl border border-line bg-slate-100/80 p-4">
              <canvas
                ref={canvasRef}
                className={cn(
                  "w-full rounded-xl shadow-lg",
                  previewAspectClass,
                )}
              />
            </div>
          </Card>

          {instagramPublishEnabled ? (
            <Card className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white">
                    <Camera size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Publicar direto no Instagram</h2>
                    <p className="text-xs text-ink-soft">
                      {igStatus.connected
                        ? `Conectado como @${igStatus.username}${igStatus.pageName ? ` (${igStatus.pageName})` : ""}`
                        : "Conecte a conta Instagram Profissional do salão para postar sem sair do sistema."}
                    </p>
                  </div>
                </div>
                {igStatus.connected && canManage ? (
                  <Button type="button" variant="ghost" className="h-8 text-xs text-rose-600" onClick={() => void handleDisconnectInstagram()}>
                    <Unlink size={13} />
                    Desconectar
                  </Button>
                ) : null}
              </div>

              {igStatus.connected ? (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      disabled={!canManage || publishingTarget !== null}
                      onClick={() => void handlePublishInstagram("FEED")}
                    >
                      {publishingTarget === "FEED" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Send size={15} />
                      )}
                      {publishingTarget === "FEED" ? "Publicando no Feed..." : "Publicar no Feed"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManage || publishingTarget !== null}
                      onClick={() => void handlePublishInstagram("STORY")}
                    >
                      {publishingTarget === "STORY" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Camera size={15} />
                      )}
                      {publishingTarget === "STORY" ? "Publicando Story..." : "Publicar nos Stories"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-ink-soft">
                    Dica: para o Feed, use formato <strong>1:1</strong> ou <strong>4:5</strong>. Para Stories, selecione o formato <strong>9:16</strong>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {igStatus.metaConfigured ? (
                    <Button
                      type="button"
                      disabled={!canManage || connectingIg}
                      onClick={() => void handleConnectInstagram()}
                      className="w-full"
                    >
                      {connectingIg ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                      {connectingIg ? "Aguardando autorização da Meta..." : "Conectar Instagram Business"}
                    </Button>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      O administrador geral da plataforma ainda precisa informar o <strong>App ID</strong> e o{" "}
                      <strong>App Secret</strong> da Meta em <strong>Plataforma → Integrações → Meta</strong>. Enquanto isso, você já pode gerar e baixar suas artes normalmente!
                    </div>
                  )}
                  <p className="text-[11px] text-ink-soft">
                    Requer conta Instagram Profissional (Comercial ou Criador) vinculada a uma Página do Facebook.
                  </p>
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>

      {/* Saved / Published History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Histórico de artes do salão</h2>
          <span className="text-xs text-ink-soft">{posts.length} arte(s)</span>
        </div>

        {posts.length === 0 ? (
          <Card className="py-8 text-center text-sm text-ink-soft">
            Nenhuma arte salva ainda. Gere sua primeira arte acima e clique em <strong>Salvar</strong> ou{" "}
            <strong>Publicar no Instagram</strong>.
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Card key={post.id} className="flex flex-col gap-3 p-3">
                <div className="relative aspect-square overflow-hidden rounded-xl border border-line bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={post.imageUrl} alt={post.title} className="h-full w-full object-cover" />
                  <span
                    className={cn(
                      "absolute top-2 left-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      post.status === "PUBLISHED"
                        ? "bg-emerald-600 text-white"
                        : post.status === "FAILED"
                          ? "bg-rose-600 text-white"
                          : "bg-slate-900/80 text-white",
                    )}
                  >
                    {post.status === "PUBLISHED"
                      ? `Publicado (${post.publishTarget === "STORY" ? "Story" : "Feed"})`
                      : post.status === "FAILED"
                        ? "Falha ao publicar"
                        : "Rascunho"}
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate font-medium text-ink">{post.title}</div>
                  <p className="line-clamp-2 text-xs text-ink-soft">{post.caption || post.headline}</p>
                  {post.errorMessage ? (
                    <p className="text-[11px] text-rose-600">{post.errorMessage}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                  <div className="flex items-center gap-1.5">
                    <a
                      href={post.imageUrl}
                      download={`${post.id}.jpg`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium text-ink hover:bg-slate-50"
                    >
                      <Download size={13} />
                      Baixar
                    </a>
                    {post.instagramPermalink ? (
                      <a
                        href={post.instagramPermalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <ExternalLink size={13} />
                        Ver post
                      </a>
                    ) : null}
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => void handleDeletePost(post.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Excluir arte"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
