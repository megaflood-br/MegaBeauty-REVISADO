"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe, Loader2, Search, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { compressImageDataUrl } from "@/lib/product-photo";
import type { WebImageCandidate, WebImageKind } from "@/lib/web-image-search";
import { cn } from "@/lib/utils";

type FetchImageResponse = {
  ok?: boolean;
  dataUrl?: string;
  error?: string;
};

type SearchImageResponse = {
  ok?: boolean;
  query?: string;
  items?: WebImageCandidate[];
  error?: string;
};

export function WebImagePicker({
  kind,
  name,
  brand = "",
  imageUrl,
  autoFetch = false,
  userHasCustomImage = false,
  onSelectImage,
  onManualOverride,
  onError,
}: {
  kind: WebImageKind;
  name: string;
  brand?: string;
  imageUrl: string;
  autoFetch?: boolean;
  userHasCustomImage?: boolean;
  onSelectImage: (dataUrl: string) => void;
  onManualOverride?: () => void;
  onError?: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customQuery, setCustomQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WebImageCandidate[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);

  const lastAutoQueryRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function downloadAndCompress(candidate: WebImageCandidate): Promise<string | null> {
    const res = await fetch("/api/images/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: candidate.image || candidate.thumbnail,
        fallbackUrl: candidate.thumbnail,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as FetchImageResponse;
    if (!res.ok || !data.dataUrl) {
      return null;
    }
    return compressImageDataUrl(data.dataUrl);
  }

  async function applyCandidate(candidate: WebImageCandidate, isAuto: boolean): Promise<boolean> {
    setApplyingUrl(candidate.image);
    setStatusMessage(null);
    onError?.(null);
    try {
      const compressed = await downloadAndCompress(candidate);
      if (!mountedRef.current) return false;
      if (!compressed) {
        if (!isAuto) {
          setStatusMessage("Não foi possível carregar essa foto. Escolha outra opção.");
        }
        return false;
      }
      onSelectImage(compressed);
      setSelectedSourceUrl(candidate.image);
      setAutoFilled(isAuto);
      if (!isAuto) {
        onManualOverride?.();
      }
      return true;
    } catch {
      if (!mountedRef.current) return false;
      if (!isAuto) {
        setStatusMessage("Não foi possível processar essa foto. Tente outra opção.");
      }
      return false;
    } finally {
      if (mountedRef.current) setApplyingUrl(null);
    }
  }

  async function runSearch(rawQuery: string, rawBrand: string, options: { autoApplyFirst: boolean }) {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      setStatusMessage("Digite o nome primeiro para buscar fotos na internet.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setStatusMessage(null);
    onError?.(null);

    try {
      const params = new URLSearchParams({ q: trimmed, kind });
      if (rawBrand.trim()) params.set("brand", rawBrand.trim());
      const res = await fetch(`/api/images/search?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as SearchImageResponse;
      if (!mountedRef.current || controller.signal.aborted) return;

      if (!res.ok) {
        setCandidates([]);
        setStatusMessage(data.error ?? "Não foi possível buscar fotos agora.");
        return;
      }

      const list = Array.isArray(data.items) ? data.items : [];
      setCandidates(list);
      setOpen(true);

      if (list.length === 0) {
        setStatusMessage("Nenhuma foto encontrada para este termo. Tente ajustar a busca.");
        return;
      }

      if (options.autoApplyFirst) {
        for (const candidate of list.slice(0, 3)) {
          if (!mountedRef.current || controller.signal.aborted) return;
          const ok = await applyCandidate(candidate, true);
          if (ok) break;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!mountedRef.current) return;
      setStatusMessage("Falha ao buscar imagens na internet. Tente novamente ou envie do computador.");
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        setSearching(false);
      }
    }
  }

  const trimmedName = name.trim();
  const trimmedBrand = brand.trim();
  const combinedAutoKey = `${trimmedName}|${trimmedBrand}`.toLowerCase();

  useEffect(() => {
    if (!autoFetch || userHasCustomImage) return;
    if (trimmedName.length < 4) return;
    if (combinedAutoKey === lastAutoQueryRef.current) return;

    const timer = window.setTimeout(() => {
      lastAutoQueryRef.current = combinedAutoKey;
      setCustomQuery(trimmedBrand ? `${trimmedName} ${trimmedBrand}` : trimmedName);
      void runSearch(trimmedName, trimmedBrand, { autoApplyFirst: true });
    }, 900);

    return () => window.clearTimeout(timer);
    // Intentionally keyed on primitive values to prevent unnecessary re-triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, userHasCustomImage, trimmedName, trimmedBrand, combinedAutoKey]);

  const effectiveSearchTerm = customQuery.trim() || (trimmedBrand ? `${trimmedName} ${trimmedBrand}` : trimmedName);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-8 px-3 text-xs whitespace-nowrap"
          disabled={searching}
          onClick={() => {
            const q = effectiveSearchTerm;
            if (!customQuery.trim() && q) setCustomQuery(q);
            setOpen(true);
            if (q.length >= 2) {
              void runSearch(q, "", { autoApplyFirst: !imageUrl });
            } else {
              setStatusMessage("Digite o nome acima ou informe um termo abaixo para buscar.");
            }
          }}
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
          {searching ? "Buscando foto..." : "Buscar na internet"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 rounded-xl border border-line bg-cream/70 p-3 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink">
              {autoFilled
                ? "Foto preenchida automaticamente · clique em outra opção para trocar"
                : "Escolha uma foto encontrada na internet"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar busca de fotos"
              className="rounded-md p-1 text-ink-soft hover:bg-sand hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            <Input
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch(customQuery, "", { autoApplyFirst: false });
                }
              }}
              placeholder={
                kind === "product"
                  ? "Ex.: Esmalte Risqué Branco"
                  : "Ex.: Alongamento de cílios volume russo"
              }
              className="h-9 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 px-3 text-xs"
              disabled={searching || customQuery.trim().length < 2}
              onClick={() => void runSearch(customQuery, "", { autoApplyFirst: false })}
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Buscar
            </Button>
          </div>

          {searching && candidates.length === 0 ? (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="aspect-square animate-pulse rounded-lg border border-line bg-sand"
                />
              ))}
            </div>
          ) : candidates.length > 0 ? (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {candidates.slice(0, 6).map((item) => {
                const isSelected = selectedSourceUrl === item.image && Boolean(imageUrl);
                const isApplying = applyingUrl === item.image;
                return (
                  <button
                    key={item.image}
                    type="button"
                    disabled={Boolean(applyingUrl)}
                    onClick={() => void applyCandidate(item, false)}
                    title={item.title}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine",
                      isSelected ? "border-wine ring-2 ring-wine" : "border-line hover:border-slate-400",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {isApplying ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white">
                        <Loader2 size={16} className="animate-spin" />
                      </span>
                    ) : isSelected ? (
                      <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-wine text-white shadow-xs">
                        <Check size={12} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {statusMessage ? (
            <p className="mt-2 text-xs text-ink-soft">{statusMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
