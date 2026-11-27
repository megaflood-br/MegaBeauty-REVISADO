"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Compass,
  ExternalLink,
  Layers,
  X,
} from "lucide-react";
import { updateOnboardingTourState } from "@/app/actions/onboarding";
import {
  isLocationMatchingStep,
  type OnboardingFeature,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingTourStatus,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type TourMode = "closed" | "modal" | "dock";
export type TourModalTab = "setup" | "features";

type OnboardingContextValue = {
  state: OnboardingState;
  mode: TourMode;
  modalTab: TourModalTab;
  activeStepIndex: number;
  activeStep: OnboardingStep | null;
  highlightedHref: string | null;
  pending: boolean;
  openModal: (stepIndex?: number, tab?: TourModalTab) => void;
  setModalTab: (tab: TourModalTab) => void;
  startStep: (stepIndex: number) => void;
  exploreFeature: (feature: OnboardingFeature) => void;
  enterDock: () => void;
  selectStep: (stepIndex: number) => void;
  snoozeModal: () => void;
  dismissPermanently: () => void;
  completeTour: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  return useContext(OnboardingContext);
}

export function OnboardingProvider({
  state,
  children,
}: {
  state: OnboardingState;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState<OnboardingTourStatus>(state.tourStatus);
  const [modalTab, setModalTab] = useState<TourModalTab>("setup");
  const [mode, setMode] = useState<TourMode>(() => {
    if (!state.canRunTour) return "closed";
    if (state.shouldResumeDock) return "dock";
    if (state.shouldAutoOpen && pathname === state.homeHref) return "modal";
    return "closed";
  });
  const [activeStepIndex, setActiveStepIndex] = useState<number>(() => state.nextStepIndex);

  const safeIndex = state.steps.length
    ? Math.max(0, Math.min(state.steps.length - 1, activeStepIndex))
    : 0;
  const activeStep = state.steps[safeIndex] ?? null;

  const persist = useCallback(
    (status: OnboardingTourStatus, stepIndex?: number) => {
      setLocalStatus(status);
      startTransition(async () => {
        await updateOnboardingTourState({ status, stepIndex });
      });
    },
    [],
  );

  const openModal = useCallback(
    (stepIndex?: number, tab: TourModalTab = "setup") => {
      if (!state.canRunTour || state.steps.length === 0) return;
      const target =
        typeof stepIndex === "number"
          ? Math.max(0, Math.min(state.steps.length - 1, stepIndex))
          : state.nextStepIndex;
      setActiveStepIndex(target);
      setModalTab(tab);
      setMode("modal");
    },
    [state.canRunTour, state.nextStepIndex, state.steps.length],
  );

  const selectStep = useCallback(
    (stepIndex: number) => {
      if (state.steps.length === 0) return;
      const clamped = Math.max(0, Math.min(state.steps.length - 1, stepIndex));
      setActiveStepIndex(clamped);
    },
    [state.steps.length],
  );

  const startStep = useCallback(
    (stepIndex: number) => {
      const target = state.steps[stepIndex];
      if (!target) return;
      setActiveStepIndex(stepIndex);
      setMode("dock");
      persist("IN_PROGRESS", stepIndex);
      router.push(target.href);
    },
    [persist, router, state.steps],
  );

  const exploreFeature = useCallback(
    (feature: OnboardingFeature) => {
      const matchingStepIndex = state.steps.findIndex((step) => step.navHref === feature.navHref);
      if (matchingStepIndex >= 0) {
        setActiveStepIndex(matchingStepIndex);
        setMode("dock");
        persist("IN_PROGRESS", matchingStepIndex);
      } else {
        setMode("closed");
      }
      router.push(feature.href);
    },
    [persist, router, state.steps],
  );

  const enterDock = useCallback(() => {
    setMode("dock");
    persist("IN_PROGRESS", safeIndex);
  }, [persist, safeIndex]);

  const snoozeModal = useCallback(() => {
    setMode("closed");
  }, []);

  const dismissPermanently = useCallback(() => {
    setMode("closed");
    persist("DISMISSED", safeIndex);
  }, [persist, safeIndex]);

  const completeTour = useCallback(() => {
    setMode("closed");
    persist("COMPLETED", safeIndex);
  }, [persist, safeIndex]);

  const effectiveState = useMemo<OnboardingState>(
    () => ({
      ...state,
      tourStatus: localStatus,
    }),
    [localStatus, state],
  );

  const highlightedHref =
    mode !== "closed" && activeStep && (mode === "dock" || modalTab === "setup")
      ? activeStep.navHref
      : null;

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state: effectiveState,
      mode,
      modalTab,
      activeStepIndex: safeIndex,
      activeStep,
      highlightedHref,
      pending,
      openModal,
      setModalTab,
      startStep,
      exploreFeature,
      enterDock,
      selectStep,
      snoozeModal,
      dismissPermanently,
      completeTour,
    }),
    [
      activeStep,
      completeTour,
      dismissPermanently,
      effectiveState,
      enterDock,
      exploreFeature,
      highlightedHref,
      modalTab,
      mode,
      openModal,
      pending,
      safeIndex,
      selectStep,
      snoozeModal,
      startStep,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {state.canRunTour ? (
        <Suspense fallback={null}>
          <OnboardingOverlay />
        </Suspense>
      ) : null}
    </OnboardingContext.Provider>
  );
}

export function SidebarTourTrigger() {
  const onboarding = useOnboarding();
  if (!onboarding || !onboarding.state.canRunTour || onboarding.state.totalCount === 0) {
    return null;
  }
  const { state, openModal, mode } = onboarding;
  const remaining = state.totalCount - state.completedCount;

  return (
    <div className="border-t border-white/10 px-3 py-2.5">
      <button
        type="button"
        onClick={() => openModal(state.nextStepIndex, "setup")}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine",
          mode !== "closed"
            ? "bg-white/15 text-white"
            : "bg-white/[0.06] text-slate-200 hover:bg-white/10 hover:text-white",
        )}
      >
        <Compass size={16} className="shrink-0 text-rose" />
        <span className="min-w-0 flex-1 truncate">
          {remaining > 0 ? "Tour e recursos" : "Rever tour e recursos"}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
          {state.completedCount}/{state.totalCount}
        </span>
      </button>
    </div>
  );
}

function groupFeaturesByCategory(features: OnboardingFeature[]) {
  const groups = new Map<string, OnboardingFeature[]>();
  for (const feature of features) {
    const existing = groups.get(feature.category) ?? [];
    existing.push(feature);
    groups.set(feature.category, existing);
  }
  return [...groups.entries()];
}

function OnboardingOverlay() {
  const onboarding = useOnboarding();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    if (!onboarding || onboarding.mode !== "modal") return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onboarding?.snoozeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onboarding]);

  if (!onboarding || onboarding.mode === "closed" || !onboarding.activeStep) {
    return null;
  }

  const {
    state,
    mode,
    modalTab,
    activeStepIndex,
    activeStep,
    setModalTab,
    selectStep,
    startStep,
    exploreFeature,
    enterDock,
    openModal,
    snoozeModal,
    dismissPermanently,
    completeTour,
  } = onboarding;

  const isOnTargetPage = isLocationMatchingStep(pathname, search, activeStep);
  const nextPendingIndex = state.steps.findIndex(
    (step, idx) => idx > activeStepIndex && !step.completed,
  );
  const fallbackNextIndex =
    nextPendingIndex >= 0
      ? nextPendingIndex
      : activeStepIndex + 1 < state.steps.length
        ? activeStepIndex + 1
        : state.steps.findIndex((step) => !step.completed);

  if (mode === "dock") {
    return (
      <aside
        aria-label="Guia de configuração inicial"
        className="no-print fixed right-4 bottom-4 z-40 w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper text-ink shadow-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Compass size={16} className="shrink-0 text-wine" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-ink-soft tabular-nums">
                <span>
                  Etapa {activeStepIndex + 1} de {state.totalCount}
                </span>
                <span aria-hidden="true">·</span>
                <span>{state.percent}% pronto</span>
              </div>
              <p className="truncate text-sm font-semibold text-ink">{activeStep.shortTitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openModal(activeStepIndex, "setup")}
              className="rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-sand hover:text-ink whitespace-nowrap"
            >
              Ver tudo
            </button>
            <button
              type="button"
              onClick={() => setDockCollapsed((value) => !value)}
              aria-label={dockCollapsed ? "Expandir guia" : "Recolher guia"}
              className="rounded-md p-1.5 text-ink-soft hover:bg-sand hover:text-ink"
            >
              {dockCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              type="button"
              onClick={snoozeModal}
              aria-label="Fechar guia temporariamente"
              className="rounded-md p-1.5 text-ink-soft hover:bg-sand hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {!dockCollapsed ? (
          <div className="space-y-3 p-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand">
              <div
                className="h-full rounded-full bg-wine transition-all duration-200"
                style={{ width: `${state.percent}%` }}
              />
            </div>

            <div className="flex items-start gap-2 text-xs">
              {activeStep.completed ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <Circle size={15} className="mt-0.5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-medium",
                    activeStep.completed ? "text-emerald-700" : "text-ink",
                  )}
                >
                  {activeStep.completed
                    ? "Etapa concluída"
                    : isOnTargetPage
                      ? "Você está na tela certa — preencha e salve abaixo"
                      : "Abra a tela desta etapa para preencher os dados"}
                </p>
                <p className="mt-0.5 text-ink-soft">{activeStep.statusDetail}</p>
              </div>
            </div>

            <ul className="space-y-1.5 border-t border-line pt-2.5 text-xs text-ink-soft">
              {activeStep.checklist.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={activeStepIndex === 0}
                  onClick={() => startStep(activeStepIndex - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-sand disabled:opacity-40 whitespace-nowrap"
                >
                  <ArrowLeft size={13} />
                  Anterior
                </button>
              </div>

              {!isOnTargetPage && !activeStep.completed ? (
                <button
                  type="button"
                  onClick={() => startStep(activeStepIndex)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-wine px-3 py-1.5 text-xs font-medium text-white hover:bg-wine-deep whitespace-nowrap"
                >
                  {activeStep.actionLabel}
                  <ArrowRight size={13} />
                </button>
              ) : state.allDone ? (
                <button
                  type="button"
                  onClick={completeTour}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Check size={14} />
                  Concluir tour
                </button>
              ) : fallbackNextIndex >= 0 && fallbackNextIndex !== activeStepIndex ? (
                <button
                  type="button"
                  onClick={() => startStep(fallbackNextIndex)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-wine px-3 py-1.5 text-xs font-medium text-white hover:bg-wine-deep whitespace-nowrap"
                >
                  Próximo: {state.steps[fallbackNextIndex]?.shortTitle}
                  <ArrowRight size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeTour}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  Finalizar tour
                </button>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    );
  }

  const featureGroups = groupFeaturesByCategory(state.features);

  return (
    <div
      className="no-print fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={snoozeModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft tabular-nums">
              <span>Primeiros passos</span>
              <span aria-hidden="true">·</span>
              <span>{state.salonName}</span>
              <span aria-hidden="true">·</span>
              <span>
                {state.completedCount} de {state.totalCount} concluídas ({state.percent}%)
              </span>
            </div>
            <h2
              id="onboarding-tour-title"
              className="mt-1 font-display text-xl font-semibold text-ink [text-wrap:balance]"
            >
              {state.headline}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {state.features.length > 0 ? (
              <div
                role="tablist"
                aria-label="Visualização do tour"
                className="flex items-center gap-1 rounded-lg bg-sand p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "setup"}
                  onClick={() => setModalTab("setup")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition whitespace-nowrap",
                    modalTab === "setup"
                      ? "bg-paper text-ink shadow-xs"
                      : "text-ink-soft hover:text-ink",
                  )}
                >
                  <Compass size={14} />
                  Configuração inicial
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "features"}
                  onClick={() => setModalTab("features")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition whitespace-nowrap",
                    modalTab === "features"
                      ? "bg-paper text-ink shadow-xs"
                      : "text-ink-soft hover:text-ink",
                  )}
                >
                  <Layers size={14} />
                  Recursos do sistema
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={snoozeModal}
              aria-label="Fechar tour"
              className="shrink-0 rounded-lg p-2 text-ink-soft hover:bg-sand hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="h-1 w-full bg-sand">
          <div
            className="h-full bg-wine transition-all duration-200"
            style={{ width: `${state.percent}%` }}
          />
        </div>

        {modalTab === "features" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p className="text-sm text-ink-soft">{state.subtitle}</p>
              <div className="mt-5 space-y-6">
                {featureGroups.map(([category, items]) => (
                  <section key={category} aria-label={category}>
                    <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                      {category}
                    </h3>
                    <div className="mt-2.5 divide-y divide-line rounded-xl border border-line bg-paper">
                      {items.map((feature) => (
                        <div
                          key={feature.id}
                          className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-ink">{feature.title}</div>
                            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                              {feature.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => exploreFeature(feature)}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand whitespace-nowrap"
                          >
                            Abrir área
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-cream/60 px-6 py-4">
              <button
                type="button"
                onClick={() => setModalTab("setup")}
                className="inline-flex items-center gap-2 rounded-lg bg-wine px-4 py-2 text-sm font-medium text-white transition hover:bg-wine-deep whitespace-nowrap"
              >
                <Compass size={15} />
                Ir para configuração passo a passo
              </button>
              <div className="flex items-center gap-3 text-xs text-ink-soft">
                <button
                  type="button"
                  onClick={snoozeModal}
                  className="hover:text-ink hover:underline whitespace-nowrap"
                >
                  Lembrar depois
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={dismissPermanently}
                  className="hover:text-ink hover:underline whitespace-nowrap"
                >
                  Não mostrar novamente
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-12">
            <nav
              aria-label="Etapas do tour inicial"
              className="border-b border-line bg-cream/60 p-4 md:col-span-5 md:border-r md:border-b-0"
            >
              <ol className="space-y-1">
                {state.steps.map((step, idx) => {
                  const selected = idx === activeStepIndex;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => selectStep(idx)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine",
                          selected
                            ? "bg-paper text-ink shadow-xs ring-1 ring-line"
                            : "text-ink-soft hover:bg-paper/70 hover:text-ink",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                            step.completed
                              ? "bg-emerald-600 text-white"
                              : selected
                                ? "bg-wine text-white"
                                : "border border-slate-300 bg-paper text-slate-600",
                          )}
                        >
                          {step.completed ? <Check size={12} /> : idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            0{idx + 1}. {step.shortTitle}
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-soft">
                            {step.completed
                              ? "Concluído"
                              : step.required
                                ? "Essencial"
                                : "Recomendado"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="flex flex-col justify-between p-6 md:col-span-7">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs text-ink-soft tabular-nums">
                  <span>
                    Etapa {activeStepIndex + 1} de {state.totalCount}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeStep.required ? "Essencial" : "Recomendado"}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      activeStep.completed
                        ? "font-medium text-emerald-700"
                        : "font-medium text-amber-700"
                    }
                  >
                    {activeStep.completed ? "Concluído" : "Pendente"}
                  </span>
                </div>

                <div>
                  <h3 className="font-display text-lg font-semibold text-ink [text-wrap:balance]">
                    {activeStep.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{activeStep.summary}</p>
                </div>

                <div className="flex items-start gap-2.5 border-y border-line py-3 text-sm">
                  {activeStep.completed ? (
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle size={17} className="mt-0.5 shrink-0 text-amber-600" />
                  )}
                  <div>
                    <div className="text-xs font-medium text-ink-soft">Situação atual</div>
                    <div className="text-sm font-medium text-ink">{activeStep.statusDetail}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-ink-soft">O que fazer nesta etapa</div>
                  <ul className="mt-2 space-y-2 text-sm text-ink">
                    {activeStep.checklist.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check size={15} className="mt-0.5 shrink-0 text-slate-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6 space-y-4 border-t border-line pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startStep(activeStepIndex)}
                    className="inline-flex items-center gap-2 rounded-lg bg-wine px-4 py-2.5 text-sm font-medium text-white transition hover:bg-wine-deep whitespace-nowrap"
                  >
                    {activeStep.completed
                      ? `Revisar ${activeStep.shortTitle.toLowerCase()}`
                      : activeStep.actionLabel}
                    <ArrowRight size={16} />
                  </button>

                  {activeStep.secondaryAction ? (
                    <Link
                      href={activeStep.secondaryAction.href}
                      onClick={enterDock}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm font-medium text-ink transition hover:bg-sand whitespace-nowrap"
                    >
                      {activeStep.secondaryAction.label}
                      <ExternalLink size={14} className="text-ink-soft" />
                    </Link>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={activeStepIndex === 0}
                      onClick={() => selectStep(activeStepIndex - 1)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-ink hover:bg-sand disabled:opacity-40 whitespace-nowrap"
                    >
                      <ArrowLeft size={14} />
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={activeStepIndex >= state.steps.length - 1}
                      onClick={() => selectStep(activeStepIndex + 1)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-ink hover:bg-sand disabled:opacity-40 whitespace-nowrap"
                    >
                      Próxima etapa
                      <ArrowRight size={14} />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    {state.allDone ? (
                      <button
                        type="button"
                        onClick={completeTour}
                        className="font-medium text-emerald-700 hover:underline whitespace-nowrap"
                      >
                        Concluir tour
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={snoozeModal}
                          className="hover:text-ink hover:underline whitespace-nowrap"
                        >
                          Lembrar depois
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={dismissPermanently}
                          className="hover:text-ink hover:underline whitespace-nowrap"
                        >
                          Não mostrar novamente
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
