import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { formatMediumDate, zonedDateTime } from "@/lib/dates";
import type { TodayOverviewMetrics } from "@/lib/dashboard";

function formatDayLabel(date: string) {
  return formatMediumDate(zonedDateTime(date, "12:00"));
}

export function TodayOverview({ overview }: { overview: TodayOverviewMetrics }) {
  const pendingToReceiveCents = Math.max(0, overview.expectedRevenueCents - overview.realizedRevenueCents);
  const appointmentSummaryParts = [
    overview.appointmentsConfirmed > 0
      ? `${overview.appointmentsConfirmed} ${overview.appointmentsConfirmed === 1 ? "confirmado" : "confirmados"}`
      : null,
    overview.appointmentsPending > 0
      ? `${overview.appointmentsPending} ${overview.appointmentsPending === 1 ? "pendente" : "pendentes"}`
      : null,
    overview.appointmentsCompleted > 0
      ? `${overview.appointmentsCompleted} ${overview.appointmentsCompleted === 1 ? "concluído" : "concluídos"}`
      : null,
    overview.appointmentsCancelled > 0
      ? `${overview.appointmentsCancelled} ${overview.appointmentsCancelled === 1 ? "cancelado" : "cancelados"}`
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <section
      aria-label="Visão geral do dia atual"
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">Visão geral de hoje</h2>
          <span aria-hidden="true" className="text-xs text-ink-soft">
            ·
          </span>
          <span className="text-xs text-ink-soft">{formatDayLabel(overview.today)}</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <Link
            href="/agenda"
            className="inline-flex items-center gap-1 whitespace-nowrap text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
          >
            Ver agenda
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <Link
            href="/comandas"
            className="inline-flex items-center gap-1 whitespace-nowrap text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
          >
            Ver comandas
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        <Link
          href="/agenda"
          className="group flex flex-col justify-between gap-2 px-5 py-4 transition-colors hover:bg-sand/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-wine"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-soft">Agendamentos do dia</span>
            <ArrowUpRight
              size={15}
              aria-hidden="true"
              className="text-ink-soft opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
          <div className="font-display text-3xl text-ink tabular-nums">{overview.appointmentsTotal}</div>
          <div className="text-xs text-ink-soft">
            {appointmentSummaryParts.length > 0
              ? appointmentSummaryParts.join(" · ")
              : "Nenhum agendamento marcado para hoje"}
          </div>
        </Link>

        <Link
          href="/comandas"
          className="group flex flex-col justify-between gap-2 px-5 py-4 transition-colors hover:bg-sand/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-wine"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-soft">Comandas abertas</span>
            <ArrowUpRight
              size={15}
              aria-hidden="true"
              className="text-ink-soft opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
          <div className="font-display text-3xl text-ink tabular-nums">{overview.openComandasCount}</div>
          <div className="text-xs text-ink-soft tabular-nums">
            {overview.openComandasCount > 0
              ? `${formatBRL(overview.openComandasCents)} aguardando fechamento`
              : "Nenhuma comanda em aberto hoje"}
          </div>
        </Link>

        <Link
          href="/financeiro"
          className="group flex flex-col justify-between gap-2 px-5 py-4 transition-colors hover:bg-sand/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-wine"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-soft">Receita prevista</span>
            <span className="text-xs font-medium text-ink-soft tabular-nums">{overview.realizedPct}% realizada</span>
          </div>
          <div className="font-display text-3xl text-ink tabular-nums">{formatBRL(overview.expectedRevenueCents)}</div>
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-valuenow={overview.realizedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Percentual da receita prevista já realizada hoje"
              className="h-1.5 w-full overflow-hidden rounded-full bg-sand"
            >
              <div
                className="h-full rounded-full bg-wine transition-all duration-200"
                style={{ width: `${overview.realizedPct}%` }}
              />
            </div>
            <div className="text-xs text-ink-soft tabular-nums">
              Realizado {formatBRL(overview.realizedRevenueCents)} · A receber {formatBRL(pendingToReceiveCents)}
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
