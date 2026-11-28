"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Power, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button, Card } from "@/components/ui";
import {
  PLATFORM_MODULES,
  PLATFORM_MODULE_GROUPS,
  countEnabledModules,
  type PlatformModuleKey,
  type PlatformModulesConfig,
} from "@/lib/platform-modules";
import { cn } from "@/lib/utils";

export function PlatformModulesBoard({ initialModules }: { initialModules: PlatformModulesConfig }) {
  const router = useRouter();
  const [modules, setModules] = useState<PlatformModulesConfig>(initialModules);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const summary = countEnabledModules(modules);

  async function savePatch(patch: Partial<Record<PlatformModuleKey, boolean>>, label: string) {
    setBusyKey(label);
    setFeedback(null);
    const previous = modules;
    setModules((prev) => ({ ...prev, ...patch }));
    try {
      const response = await fetch("/api/plataforma/modulos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modules: patch }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        modules?: PlatformModulesConfig;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.modules) {
        setModules(previous);
        setFeedback({
          kind: "error",
          text: data.error || "Não foi possível atualizar o módulo.",
        });
        return;
      }
      setModules(data.modules);
      setFeedback({
        kind: "ok",
        text: "Configuração salva e aplicada imediatamente na plataforma.",
      });
      router.refresh();
    } catch {
      setModules(previous);
      setFeedback({
        kind: "error",
        text: "Falha de conexão ao salvar módulos.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function setAll(enabled: boolean) {
    const patch = Object.fromEntries(
      PLATFORM_MODULES.map((item) => [item.key, enabled]),
    ) as Record<PlatformModuleKey, boolean>;
    await savePatch(patch, enabled ? "__all_on" : "__all_off");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-soft">
            <SlidersHorizontal size={14} />
            Controle Geral de Recursos
          </div>
          <h1 className="mt-1 font-display text-3xl">Módulos da Plataforma</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Ative ou desative módulos globalmente. Recursos desativados são ocultados nos menus e bloqueados no servidor em tempo real.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink">
            <ShieldCheck size={14} className="text-emerald-600" />
            {summary.enabled} de {summary.total} ativos
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={busyKey !== null || summary.enabled === summary.total}
            onClick={() => void setAll(true)}
          >
            Ativar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busyKey !== null || summary.enabled === 0}
            onClick={() => void setAll(false)}
          >
            Desativar todos
          </Button>
        </div>
      </div>

      {feedback ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm",
            feedback.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          )}
        >
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{feedback.text}</span>
        </div>
      ) : null}

      <div className="space-y-6">
        {PLATFORM_MODULE_GROUPS.map((group) => {
          const items = PLATFORM_MODULES.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Portal {group}
                </h2>
                <span className="text-xs text-ink-soft">
                  {items.filter((item) => modules[item.key]).length}/{items.length} ativos
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((item) => {
                  const enabled = modules[item.key];
                  const isBusy = busyKey === item.key || busyKey === "__all_on" || busyKey === "__all_off";
                  return (
                    <Card
                      key={item.key}
                      className={cn(
                        "flex items-start justify-between gap-4 transition",
                        !enabled && "border-slate-200 bg-slate-50/70 opacity-85",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-ink">{item.label}</h3>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              enabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-200 text-slate-600",
                            )}
                          >
                            {enabled ? "Ativo" : "Desativado"}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-ink-soft">{item.description}</p>
                        <p className="text-[11px] font-medium text-slate-500">Área: {item.areaHint}</p>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`Alternar módulo ${item.label}`}
                        disabled={isBusy}
                        onClick={() => void savePatch({ [item.key]: !enabled }, item.key)}
                        className={cn(
                          "relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60",
                          enabled ? "bg-emerald-600" : "bg-slate-300",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform",
                            enabled ? "translate-x-6" : "translate-x-1",
                          )}
                        >
                          <Power size={11} className={enabled ? "text-emerald-600" : "text-slate-400"} />
                        </span>
                      </button>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
