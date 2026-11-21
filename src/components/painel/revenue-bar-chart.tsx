"use client";

import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL } from "@/lib/money";
import { formatDayLabel } from "@/lib/dates";
import type { DailyRevenuePoint, Last7DaysRevenueMetrics } from "@/lib/dashboard";

function formatCompactBRL(value: number) {
  if (value === 0) return "R$ 0";
  if (value >= 1000) {
    const k = value / 1000;
    const formatted = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(".", ",");
    return `R$ ${formatted} mil`;
  }
  return `R$ ${Math.round(value)}`;
}

type TooltipPayloadItem = {
  payload?: DailyRevenuePoint;
};

function RevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-line bg-paper px-3.5 py-2.5 shadow-sm">
      <div className="text-xs font-medium text-ink-soft capitalize">
        {formatDayLabel(point.date)}
        {point.isToday ? " · Hoje" : ""}
      </div>
      <div className="mt-1 font-display text-lg text-ink tabular-nums">
        {formatBRL(point.revenueCents)}
      </div>
      <div className="mt-0.5 text-xs text-ink-soft tabular-nums">
        {point.transactionsCount === 0
          ? "Sem entradas registradas"
          : `${point.transactionsCount} ${point.transactionsCount === 1 ? "entrada" : "entradas"}`}
      </div>
    </div>
  );
}

export function RevenueBarChart({ data }: { data: Last7DaysRevenueMetrics }) {
  const averageBRL = data.averageCents / 100;
  const hasRevenue = data.totalCents > 0;
  const deltaPositive = data.deltaPct >= 0;

  return (
    <section
      aria-label="Receita diária dos últimos 7 dias"
      className="overflow-hidden rounded-2xl border border-line bg-paper"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">Receita diária</h2>
          <span aria-hidden="true" className="text-xs text-ink-soft">
            ·
          </span>
          <span className="text-xs text-ink-soft">Últimos 7 dias</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-ink-soft">Total:</span>
            <span className="font-semibold text-ink">{formatBRL(data.totalCents)}</span>
          </div>
          <span aria-hidden="true" className="hidden text-line sm:inline">
            |
          </span>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-ink-soft">Média/dia:</span>
            <span className="font-semibold text-ink">{formatBRL(data.averageCents)}</span>
          </div>
          {data.prevTotalCents > 0 || data.totalCents > 0 ? (
            <>
              <span aria-hidden="true" className="hidden text-line sm:inline">
                |
              </span>
              <span
                className={
                  deltaPositive
                    ? "inline-flex items-center gap-1 font-medium text-emerald-700 tabular-nums"
                    : "inline-flex items-center gap-1 font-medium text-rose-700 tabular-nums"
                }
              >
                {deltaPositive ? (
                  <TrendingUp size={13} aria-hidden="true" />
                ) : (
                  <TrendingDown size={13} aria-hidden="true" />
                )}
                {deltaPositive ? "+" : ""}
                {data.deltaPct}% vs 7d anteriores
              </span>
            </>
          ) : null}
          <Link
            href="/financeiro"
            className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
          >
            Ver financeiro
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="px-5 pt-5 pb-4">
        {hasRevenue ? (
          <>
            <div className="h-64 w-full" role="img" aria-label="Gráfico de barras da receita diária dos últimos 7 dias">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={data.days}
                  margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
                  barCategoryGap="24%"
                >
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="axisLabel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    dy={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tickFormatter={formatCompactBRL}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    content={<RevenueTooltip />}
                  />
                  {averageBRL > 0 ? (
                    <ReferenceLine
                      y={averageBRL}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      strokeWidth={1.25}
                    />
                  ) : null}
                  <Bar
                    dataKey="revenueBRL"
                    name="Receita"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                    isAnimationActive={false}
                  >
                    {data.days.map((entry) => (
                      <Cell
                        key={entry.date}
                        fill={
                          entry.isToday
                            ? "#2563eb"
                            : entry.isPeak
                              ? "#4f46e5"
                              : "#93c5fd"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-soft">
              <div className="flex flex-wrap items-center gap-3 tabular-nums">
                {data.peakDay ? (
                  <span>
                    Maior dia:{" "}
                    <strong className="font-medium text-ink">
                      {data.peakDay.axisLabel} · {formatBRL(data.peakDay.revenueCents)}
                    </strong>
                  </span>
                ) : null}
                <span aria-hidden="true">·</span>
                <span>Linha tracejada indica a média diária ({formatBRL(data.averageCents)})</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#2563eb]" aria-hidden="true" />
                  Hoje
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#4f46e5]" aria-hidden="true" />
                  Maior receita
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#93c5fd]" aria-hidden="true" />
                  Demais dias
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="text-sm font-medium text-ink">
              Nenhuma receita registrada nos últimos 7 dias
            </p>
            <p className="max-w-md text-xs text-ink-soft">
              Assim que comandas forem fechadas ou entradas financeiras forem lançadas, o gráfico exibirá o faturamento diário da semana.
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/comandas"
                className="inline-flex items-center gap-1.5 rounded-lg bg-wine px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-wine-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
              >
                Abrir comandas
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
              <Link
                href="/financeiro"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wine"
              >
                Lançar no financeiro
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
