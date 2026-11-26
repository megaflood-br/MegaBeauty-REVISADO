"use client";

import Link from "next/link";
import {
  Cake,
  CircleDollarSign,
  Coins,
  FileText,
  LayoutGrid,
  MessageCircle,
  Plus,
  UserRound,
} from "lucide-react";
import { formatBRL } from "@/lib/money";
import { formatBirthdayLabel, type ClientPackageBalanceItem, type PackageClientSummary } from "@/lib/packages-shared";
import { displayPhoneBR } from "@/lib/utils";

export function ClientPackageSidebar({
  client,
  packageBalances,
  allocatedByItemId = {},
  hidePhones = false,
  mode = "comanda",
  onAddPackageItemToComanda,
  onClickAddPackage,
}: {
  client: PackageClientSummary | null;
  packageBalances: ClientPackageBalanceItem[];
  allocatedByItemId?: Record<string, number>;
  hidePhones?: boolean;
  mode?: "comanda" | "package";
  onAddPackageItemToComanda?: (item: ClientPackageBalanceItem) => void;
  onClickAddPackage?: () => void;
}) {
  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-10 text-center text-sm text-ink-soft">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <UserRound size={28} />
        </div>
        <p className="font-medium text-ink">Nenhum cliente selecionado</p>
        <p className="mt-1 text-xs text-ink-soft">
          Selecione um cliente para visualizar saldo de pacotes, crédito, cashback e anotações.
        </p>
      </div>
    );
  }

  const initials = client.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const uniquePackagesCount = new Set(packageBalances.map((item) => item.clientPackageId)).size;

  return (
    <div className="flex flex-col gap-5 px-5 py-5 text-sm">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-50 to-indigo-100 text-xl font-semibold text-blue-700 ring-2 ring-blue-100">
          {initials || <UserRound size={28} />}
        </div>
        <Link
          href={`/clientes/${client.id}?tab=pacotes`}
          className="mt-3 text-base font-semibold text-ink hover:text-blue-600"
        >
          {client.name}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-ink-soft">{displayPhoneBR(client.phone, hidePhones)}</span>
          <Link
            href="/atendimento"
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600"
          >
            <MessageCircle size={11} />
            Conversar
          </Link>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink uppercase">Informações</h4>
        <ul className="space-y-2 text-xs text-blue-600">
          <li className="flex items-center gap-2">
            <Cake size={14} className="shrink-0 text-blue-500" />
            <span>{formatBirthdayLabel(client.birthDate)}</span>
          </li>
          <li className="flex items-center gap-2">
            <Coins size={14} className="shrink-0 text-blue-500" />
            <span>{formatBRL(client.cashbackCents)} em cashback</span>
          </li>
          <li className="flex items-center gap-2">
            <CircleDollarSign size={14} className="shrink-0 text-blue-500" />
            <span>{formatBRL(client.creditCents)} em crédito</span>
          </li>
          <li className="flex items-center gap-2">
            <FileText size={14} className="shrink-0 text-blue-500" />
            <span>
              {client.openComandasCount}{" "}
              {client.openComandasCount === 1 ? "comanda em aberto" : "comandas em aberto"}
            </span>
          </li>
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wide text-ink uppercase">Pacotes</h4>
          {mode === "comanda" ? (
            onClickAddPackage ? (
              <button
                type="button"
                onClick={onClickAddPackage}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:underline"
              >
                <Plus size={12} />
                Adicionar
              </button>
            ) : (
              <Link
                href={`/pacotes?novo=1&cliente=${client.id}`}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:underline"
              >
                <Plus size={12} />
                Adicionar
              </Link>
            )
          ) : null}
        </div>

        {mode === "package" ? (
          <Link
            href={`/clientes/${client.id}?tab=pacotes`}
            className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
          >
            <LayoutGrid size={14} className="shrink-0" />
            <span>
              {uniquePackagesCount === 0
                ? "Nenhum pacote em aberto"
                : `${uniquePackagesCount} ${uniquePackagesCount === 1 ? "pacote não consumido" : "pacotes não consumidos"}`}
            </span>
          </Link>
        ) : packageBalances.length === 0 ? (
          <p className="text-xs text-ink-soft">Nenhum pacote disponível</p>
        ) : (
          <ul className="space-y-2.5">
            {packageBalances.map((item) => {
              const allocated = allocatedByItemId[item.id] ?? 0;
              const liveRemaining = Math.max(0, item.remainingQty - allocated);
              const clickable = Boolean(onAddPackageItemToComanda) && liveRemaining > 0;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onAddPackageItemToComanda?.(item)}
                    title={
                      clickable
                        ? `Clique para lançar ${item.description} usando o pacote #${item.packageNumber}`
                        : "Todo o saldo deste item já está alocado nesta comanda"
                    }
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                      clickable
                        ? "border-transparent hover:border-blue-200 hover:bg-blue-50/60"
                        : "cursor-default border-transparent opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <span className="font-medium text-blue-600 leading-snug">
                        {item.description} (#{item.packageNumber})
                      </span>
                      <span className="shrink-0 text-ink-soft">{formatBRL(item.unitPriceCents)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-soft">
                      <span>
                        Saldo: <strong className={liveRemaining > 0 ? "text-ink" : "text-amber-700"}>{liveRemaining}</strong>
                        {allocated > 0 ? ` (em uso: ${allocated})` : ""}
                      </span>
                      {clickable ? <span className="text-blue-600">+ usar</span> : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wide text-ink uppercase">Anotações</h4>
          <Link
            href={`/clientes/${client.id}?tab=anotacoes`}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:underline"
          >
            <Plus size={12} />
            Editar
          </Link>
        </div>
        {client.notes ? (
          <p className="whitespace-pre-line rounded-lg bg-slate-50 p-2.5 text-xs text-ink-soft">{client.notes}</p>
        ) : (
          <p className="text-xs text-ink-soft">Nenhuma anotação encontrada</p>
        )}
      </div>
    </div>
  );
}
