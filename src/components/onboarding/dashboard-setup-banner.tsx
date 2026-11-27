"use client";

import { ArrowRight, Check, Compass, Layers, X } from "lucide-react";
import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { cn } from "@/lib/utils";

export function DashboardSetupBanner() {
  const onboarding = useOnboarding();
  if (!onboarding) return null;

  const { state, openModal, startStep, dismissPermanently } = onboarding;
  if (!state.canRunTour || state.allDone || state.tourStatus === "DISMISSED" || state.tourStatus === "COMPLETED") {
    return null;
  }

  return (
    <section
      aria-label="Configuração inicial"
      className="rounded-xl border border-line bg-paper p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-medium text-wine">
              <Compass size={14} />
              Primeiros passos
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {state.completedCount} de {state.totalCount} etapas concluídas
            </span>
            <span aria-hidden="true">·</span>
            <span>{state.percent}%</span>
          </div>
          <h2 className="mt-1 font-display text-lg font-semibold text-ink [text-wrap:balance]">
            {state.bannerHeadline}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{state.bannerSubtitle}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {state.features.length > 0 ? (
            <button
              type="button"
              onClick={() => openModal(state.nextStepIndex, "features")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-sand whitespace-nowrap"
            >
              <Layers size={15} className="text-ink-soft" />
              Recursos do sistema
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openModal(state.nextStepIndex, "setup")}
            className="inline-flex items-center gap-2 rounded-lg bg-wine px-4 py-2 text-sm font-medium text-white transition hover:bg-wine-deep whitespace-nowrap"
          >
            Continuar tour guiado
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={dismissPermanently}
            aria-label="Ocultar painel de primeiros passos"
            title="Ocultar (você pode reabrir no menu lateral)"
            className="rounded-lg p-2 text-ink-soft transition hover:bg-sand hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-sand">
        <div
          className="h-full rounded-full bg-wine transition-all duration-200"
          style={{ width: `${state.percent}%` }}
        />
      </div>

      <ol className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.steps.map((step, idx) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => startStep(idx)}
              className="group flex w-full items-start gap-2.5 rounded-lg py-1.5 text-left transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  step.completed
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-300 bg-paper text-slate-600 group-hover:border-wine group-hover:text-wine",
                )}
              >
                {step.completed ? <Check size={12} /> : idx + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm font-medium",
                    step.completed ? "text-ink-soft line-through" : "text-ink group-hover:text-wine",
                  )}
                >
                  {step.shortTitle}
                </span>
                <span className="block truncate text-xs text-ink-soft">{step.statusDetail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
