"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Trophy } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type {
  ProfessionalOfTheDayMetric,
  ProfessionalOfTheDayMetrics,
} from "@/lib/dashboard";
import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfessionalOfTheDay({
  data,
}: {
  data: ProfessionalOfTheDayMetrics;
}) {
  const [criterion, setCriterion] = useState<ProfessionalOfTheDayMetric>(data.defaultCriterion);
  const leader = criterion === "attendances" ? data.byAttendances : data.byCommissions;

  return (
    <section
      aria-label="Profissional do Dia"
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-semibold text-ink whitespace-nowrap">Profissional do Dia</h2>
          <span aria-hidden="true" className="text-xs text-ink-soft">
            ·
          </span>
          <span className="text-xs text-ink-soft whitespace-nowrap">24h</span>
        </div>

        <div
          role="tablist"
          aria-label="Critério do Profissional do Dia"
          className="inline-flex items-center rounded-lg bg-sand p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={criterion === "attendances"}
            onClick={() => setCriterion("attendances")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wine",
              criterion === "attendances"
                ? "bg-paper text-ink shadow-xs"
                : "text-ink-soft hover:text-ink",
            )}
          >
            Atendimentos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={criterion === "commissions"}
            onClick={() => setCriterion("commissions")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wine",
              criterion === "commissions"
                ? "bg-paper text-ink shadow-xs"
                : "text-ink-soft hover:text-ink",
            )}
          >
            Comissões
          </button>
        </div>
      </div>

      {leader ? (
        <div className="flex flex-1 flex-col justify-between gap-4 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: leader.color }}
              >
                {initials(leader.name)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-ink">{leader.name}</div>
                <div className="truncate text-xs text-ink-soft">
                  {leader.specialty || "Equipe"}
                  <span aria-hidden="true"> · </span>
                  {criterion === "attendances" ? "Líder em atendimentos" : "Líder em comissões"}
                </div>
              </div>
            </div>
            <Trophy size={18} aria-hidden="true" className="shrink-0 text-amber-500" />
          </div>

          <div className="grid grid-cols-2 divide-x divide-line border-t border-line pt-3">
            <div className="pr-3">
              <div className="text-xs text-ink-soft">Atendimentos</div>
              <div
                className={cn(
                  "mt-0.5 font-display text-2xl tabular-nums",
                  criterion === "attendances" ? "text-ink" : "text-ink-soft",
                )}
              >
                {leader.attendances}
              </div>
            </div>
            <div className="pl-3">
              <div className="text-xs text-ink-soft">Comissões</div>
              <div
                className={cn(
                  "mt-0.5 font-display text-2xl tabular-nums",
                  criterion === "commissions" ? "text-ink" : "text-ink-soft",
                )}
              >
                {formatBRL(leader.commissionCents)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
            <span className="tabular-nums">
              {data.activeProfessionalsCount > 1
                ? `Entre ${data.activeProfessionalsCount} profissionais ativos`
                : "Único profissional com movimento"}
            </span>
            <Link
              href="/comissoes"
              className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
            >
              Comissões
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center">
          <Trophy size={20} aria-hidden="true" className="text-ink-soft/60" />
          <p className="text-sm font-medium text-ink">Sem destaque nas últimas 24h</p>
          <p className="text-xs text-ink-soft">
            {criterion === "attendances"
              ? "Nenhum atendimento registrado nas últimas 24 horas."
              : "Nenhuma comissão gerada nas últimas 24 horas."}
          </p>
          <Link
            href={criterion === "attendances" ? "/agenda" : "/comandas"}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-wine transition-colors hover:text-wine-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
          >
            {criterion === "attendances" ? "Abrir agenda" : "Abrir comandas"}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
