"use client";

import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

type RouteError = Error & { digest?: string };

function isChunkLoadError(error: RouteError) {
  const name = error?.name || "";
  const message = error?.message || "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export function RouteErrorView({
  error,
  reset,
  inPanel = false,
}: {
  error: RouteError;
  reset: () => void;
  inPanel?: boolean;
}) {
  useEffect(() => {
    console.error("[MegaBeauty route error]", error);
  }, [error]);

  const chunkError = isChunkLoadError(error);
  const title = chunkError ? "Nova atualização disponível" : "Não foi possível carregar esta página";
  const description = chunkError
    ? "O sistema recebeu uma atualização enquanto esta tela estava aberta. Recarregue a página para continuar normalmente."
    : "Ocorreu um erro inesperado ao abrir esta tela. Você pode tentar novamente ou recarregar a página.";

  const technicalSummary = [
    error?.name ? `Tipo: ${error.name}` : null,
    error?.message ? `Mensagem: ${error.message}` : null,
    error?.digest ? `Código: ${error.digest}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={
        inPanel
          ? "flex min-h-[60vh] items-center justify-center p-4"
          : "flex min-h-screen items-center justify-center bg-cream p-6 text-ink"
      }
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-base font-semibold text-ink">{title}</h1>
            <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (chunkError ? window.location.reload() : reset())}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-95"
          >
            <RefreshCw className="h-4 w-4" />
            {chunkError ? "Recarregar página" : "Tentar novamente"}
          </button>
          {!chunkError ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-cream"
            >
              Recarregar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-cream hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        </div>

        {technicalSummary ? (
          <details className="mt-4 rounded-lg border border-line bg-cream/60 px-3 py-2 text-xs text-ink-soft">
            <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
              Detalhes técnicos
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink">
              {technicalSummary}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
