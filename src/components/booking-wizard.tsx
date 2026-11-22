"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Search, X } from "lucide-react";
import { getPublicBookingBusySlots, publicBook } from "@/app/actions/booking";
import { Button, Field, Input } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { formatBRL } from "@/lib/money";
import { calendarDate, formatDayLabel, minutesToLabel, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { bestPromotion, type PromoRule } from "@/lib/promotions";
import {
  PUBLIC_BOOKING_MAX_DAYS,
  buildUpcomingBookingDays,
  calculateSelectedServicesTotals,
  filterEligibleProfessionals,
  formatSlotEndTime,
  isDateInBookingWindow,
  publicBookingSlotOptions,
  publicBookingSlotsForDate,
  type BookingBusyInterval,
} from "@/lib/booking-availability";
import { cn } from "@/lib/utils";

type Service = { id: string; name: string; durationMin: number; priceCents: number };
type Professional = {
  id: string;
  name: string;
  color: string;
  workStart?: string | null;
  workEnd?: string | null;
  serviceIds: string[];
};

const EMPTY_PROMOTIONS: PromoRule[] = [];
const DAYS_PER_PAGE = 7;

export function BookingWizard({
  slug,
  salon,
  services,
  professionals,
  busy: initialBusy,
  openTime,
  closeTime,
  slotMinutes,
  today: initialToday,
  maxDays = PUBLIC_BOOKING_MAX_DAYS,
  promotions = EMPTY_PROMOTIONS,
}: {
  slug: string;
  salon: string;
  services: Service[];
  professionals: Professional[];
  busy: BookingBusyInterval[];
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  today?: string;
  maxDays?: number;
  promotions?: PromoRule[];
}) {
  const today = useMemo(() => initialToday ?? calendarDate(), [initialToday]);
  const maxDate = useMemo(() => shiftCalendarDate(today, maxDays), [today, maxDays]);
  const upcomingDays = useMemo(() => buildUpcomingBookingDays(today, maxDays), [today, maxDays]);

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(() =>
    services[0]?.id ? [services[0].id] : [],
  );
  const [serviceQuery, setServiceQuery] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(today);
  const [pageIndex, setPageIndex] = useState(0);
  const [time, setTime] = useState("");
  const [busyByDate, setBusyByDate] = useState<Record<string, BookingBusyInterval[]>>({});
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { selectedServices, totalDurationMin } = useMemo(
    () => calculateSelectedServicesTotals(services, selectedServiceIds),
    [services, selectedServiceIds],
  );

  const selectedServiceIdList = useMemo(
    () => selectedServices.map((item) => item.id),
    [selectedServices],
  );

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter((item) => item.name.toLowerCase().includes(q));
  }, [services, serviceQuery]);

  const pros = useMemo(
    () => filterEligibleProfessionals(professionals, selectedServiceIdList),
    [professionals, selectedServiceIdList],
  );

  const activeProfessional = pros.find((p) => p.id === professionalId) ?? null;
  const effectiveProfessionalId = activeProfessional?.id ?? "";

  const effectiveOpenTime = activeProfessional?.workStart || openTime;
  const effectiveCloseTime = activeProfessional?.workEnd || closeTime;

  const activeBusy = busyByDate[date] ?? initialBusy;

  const selectedPricing = useMemo(() => {
    let totalBaseCents = 0;
    let totalFinalCents = 0;
    const appliedPromos: { serviceName: string; promoName: string; priceCents: number }[] = [];

    for (const item of selectedServices) {
      totalBaseCents += item.priceCents;
      const promo = bestPromotion(promotions, date, "SERVICE", item.id, item.priceCents);
      if (promo) {
        totalFinalCents += promo.priceCents;
        appliedPromos.push({
          serviceName: item.name,
          promoName: promo.promo.name,
          priceCents: promo.priceCents,
        });
      } else {
        totalFinalCents += item.priceCents;
      }
    }

    return {
      totalBaseCents,
      totalFinalCents,
      discountCents: Math.max(0, totalBaseCents - totalFinalCents),
      appliedPromos,
    };
  }, [selectedServices, promotions, date]);

  const dayOffers = useMemo(
    () =>
      services.flatMap((item) => {
        const promo = bestPromotion(promotions, date, "SERVICE", item.id, item.priceCents);
        return promo ? [{ service: item, promo }] : [];
      }),
    [services, promotions, date],
  );

  const slotOptions = useMemo(
    () =>
      effectiveProfessionalId && totalDurationMin > 0
        ? publicBookingSlotOptions({
            date,
            openTime: effectiveOpenTime,
            closeTime: effectiveCloseTime,
            slotMinutes,
            durationMin: totalDurationMin,
            professionalId: effectiveProfessionalId,
            busy: activeBusy,
            today,
          })
        : [],
    [
      effectiveProfessionalId,
      totalDurationMin,
      date,
      effectiveOpenTime,
      effectiveCloseTime,
      slotMinutes,
      activeBusy,
      today,
    ],
  );

  const freeSlotOptions = useMemo(
    () => slotOptions.filter((option) => option.available),
    [slotOptions],
  );

  const blockedSlotCount = useMemo(
    () => slotOptions.filter((option) => !option.available && option.reason !== "past").length,
    [slotOptions],
  );

  const selectedSlot = freeSlotOptions.find((option) => option.start === time) ?? null;
  const selectedTime = selectedSlot?.start ?? "";
  const timeBecameIncompatible = Boolean(time) && !selectedTime && Boolean(effectiveProfessionalId) && totalDurationMin > 0;

  const totalPages = Math.ceil(upcomingDays.length / DAYS_PER_PAGE);
  const visibleDays = upcomingDays.slice(pageIndex * DAYS_PER_PAGE, (pageIndex + 1) * DAYS_PER_PAGE);

  const visibleAvailabilityCounts: Record<string, number> | null = useMemo(() => {
    if (!effectiveProfessionalId || totalDurationMin <= 0) return null;
    return Object.fromEntries(
      visibleDays.map((day) => {
        const dayBusy = busyByDate[day.date] ?? initialBusy;
        const count = publicBookingSlotsForDate({
          date: day.date,
          openTime: effectiveOpenTime,
          closeTime: effectiveCloseTime,
          slotMinutes,
          durationMin: totalDurationMin,
          professionalId: effectiveProfessionalId,
          busy: dayBusy,
          today,
        }).length;
        return [day.date, count];
      }),
    );
  }, [
    effectiveProfessionalId,
    totalDurationMin,
    visibleDays,
    busyByDate,
    initialBusy,
    effectiveOpenTime,
    effectiveCloseTime,
    slotMinutes,
    today,
  ]);

  function selectDate(nextDate: string) {
    if (!isDateInBookingWindow(nextDate, today, maxDays)) {
      setError(`Escolha uma data entre hoje e os próximos ${maxDays} dias.`);
      return;
    }
    setError(null);
    setDate(nextDate);
    setTime("");

    const idx = upcomingDays.findIndex((item) => item.date === nextDate);
    if (idx >= 0) {
      setPageIndex(Math.floor(idx / DAYS_PER_PAGE));
    }

    setLoadingDate(nextDate);
    void getPublicBookingBusySlots({ slug, date: nextDate })
      .then((result) => {
        if ("busy" in result) {
          setBusyByDate((current) => ({ ...current, [result.date]: result.busy }));
        }
      })
      .finally(() => {
        setLoadingDate((current) => (current === nextDate ? null : current));
      });
  }

  function toggleService(targetId: string) {
    setError(null);
    const nextIds = selectedServiceIds.includes(targetId)
      ? selectedServiceIds.filter((id) => id !== targetId)
      : [...selectedServiceIds, targetId];
    setSelectedServiceIds(nextIds);

    const nextPros = filterEligibleProfessionals(professionals, nextIds);
    if (professionalId && !nextPros.some((p) => p.id === professionalId)) {
      setProfessionalId("");
      setTime("");
    }
  }

  function handleProfessionalChange(nextProfId: string) {
    setProfessionalId(nextProfId);
    setTime("");
    setError(null);
  }

  const canSubmit =
    !pending &&
    loadingDate !== date &&
    selectedServices.length > 0 &&
    totalDurationMin > 0 &&
    Boolean(effectiveProfessionalId) &&
    Boolean(selectedTime);

  if (done) {
    return (
      <div className="rounded-3xl bg-paper p-8 text-center">
        <h2 className="font-display text-3xl">Horário reservado</h2>
        <p className="mt-2 text-ink-soft">O {salon} vai confirmar pelo WhatsApp. Até já!</p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5 rounded-3xl bg-paper p-6"
      action={(formData) => {
        if (!canSubmit) {
          setError("Selecione serviços, profissional e um horário com bloco contíguo disponível.");
          return;
        }
        setError(null);
        startTransition(async () => {
          const result = await publicBook(formData);
          if (result?.error) setError(result.error);
          else setDone(true);
        });
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      {selectedServices.map((item) => (
        <input key={item.id} type="hidden" name="serviceIds" value={item.id} />
      ))}
      <input type="hidden" name="serviceId" value={selectedServices[0]?.id ?? ""} />
      <input type="hidden" name="startAt" value={selectedTime ? zonedDateTime(date, selectedTime).toISOString() : ""} />

      {dayOffers.length ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">Ofertas neste dia</p>
          <ul className="mt-1 space-y-1">
            {dayOffers.map(({ service: offer, promo }) => (
              <li key={offer.id}>
                {offer.name}: {formatBRL(promo.priceCents)} na {promo.promo.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-soft">
            Serviços ({selectedServices.length} selecionado{selectedServices.length === 1 ? "" : "s"})
          </span>
          {totalDurationMin > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-wine">
              <Clock size={12} />
              Duração total: {minutesToLabel(totalDurationMin)}
            </span>
          ) : null}
        </div>

        {services.length > 5 ? (
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
            <Input
              type="search"
              value={serviceQuery}
              onChange={(e) => setServiceQuery(e.target.value)}
              placeholder="Buscar serviços para adicionar..."
              className="pl-8 text-sm"
            />
          </div>
        ) : null}

        <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-0.5">
          {filteredServices.map((item) => {
            const checked = selectedServiceIds.includes(item.id);
            const promo = bestPromotion(promotions, date, "SERVICE", item.id, item.priceCents);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={checked}
                onClick={() => toggleService(item.id)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                  checked
                    ? "border-wine bg-wine/5 text-ink"
                    : "border-line bg-white hover:border-wine/40 hover:bg-sand/40",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition",
                      checked ? "border-wine bg-wine text-white" : "border-line bg-white",
                    )}
                  >
                    {checked ? <Check size={12} /> : null}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-ink-soft">
                      {minutesToLabel(item.durationMin)}
                      {promo ? ` · ${promo.promo.name}` : ""}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {promo ? (
                    <>
                      <span className="block text-[11px] text-ink-soft line-through">{formatBRL(item.priceCents)}</span>
                      <span className="text-sm font-semibold text-emerald-700">{formatBRL(promo.priceCents)}</span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold">{formatBRL(item.priceCents)}</span>
                  )}
                </div>
              </button>
            );
          })}
          {!filteredServices.length ? (
            <p className="rounded-xl border border-line bg-sand/30 px-3 py-2 text-xs text-ink-soft">
              Nenhum serviço encontrado para &ldquo;{serviceQuery}&rdquo;.
            </p>
          ) : null}
        </div>

        {selectedServices.length > 0 ? (
          <div className="rounded-2xl border border-line bg-sand/35 px-3.5 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {selectedServices.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-0.5 text-xs text-ink"
                >
                  {item.name} ({minutesToLabel(item.durationMin)})
                  <button
                    type="button"
                    aria-label={`Remover ${item.name}`}
                    onClick={() => toggleService(item.id)}
                    className="text-ink-soft hover:text-wine"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2 text-xs">
              <span className="text-ink-soft">
                Tempo contíguo necessário:{" "}
                <strong className="text-ink">{minutesToLabel(totalDurationMin)}</strong>
              </span>
              <span className="font-semibold text-ink">
                Total: {formatBRL(selectedPricing.totalFinalCents)}
                {selectedPricing.discountCents > 0 ? (
                  <span className="ml-1 font-normal text-emerald-700">
                    (-{formatBRL(selectedPricing.discountCents)})
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-warn">Selecione pelo menos um serviço para verificar os horários livres.</p>
        )}
      </div>

      <Field label="Profissional">
        <SearchSelect
          name="professionalId"
          required
          placeholder={
            selectedServices.length === 0
              ? "Selecione ao menos um serviço primeiro..."
              : pros.length === 0
                ? "Nenhuma profissional realiza essa combinação"
                : "Buscar profissional..."
          }
          value={effectiveProfessionalId}
          onChange={handleProfessionalChange}
          options={pros.map((p) => ({
            value: p.id,
            label: p.name,
            hint: `${p.workStart || openTime} às ${p.workEnd || closeTime}`,
          }))}
        />
        {selectedServices.length > 1 && pros.length === 0 ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-warn">
            <AlertCircle size={13} />
            Nenhuma profissional realiza todos os serviços selecionados juntos. Remova um serviço ou faça agendamentos separados.
          </p>
        ) : null}
      </Field>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft">
            <CalendarDays size={15} />
            Dia (próximos {maxDays} dias)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:bg-sand disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[4.5rem] text-center text-xs text-ink-soft">
              {pageIndex + 1} / {totalPages}
            </span>
            <button
              type="button"
              aria-label="Próxima semana"
              disabled={pageIndex >= totalPages - 1}
              onClick={() => setPageIndex((current) => Math.min(totalPages - 1, current + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:bg-sand disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {visibleDays.map((day) => {
            const active = day.date === date;
            const slotCount = visibleAvailabilityCounts ? visibleAvailabilityCounts[day.date] : null;
            const soldOut = slotCount === 0;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => selectDate(day.date)}
                className={cn(
                  "flex flex-col items-center rounded-xl border px-1 py-2 text-center transition",
                  active
                    ? "border-wine bg-wine text-white"
                    : soldOut
                      ? "border-line/60 bg-sand/40 text-ink-soft/60 hover:border-line"
                      : "border-line bg-white hover:border-wine/50 hover:bg-sand/50",
                )}
              >
                <span className={cn("text-[10px] uppercase tracking-wide", active ? "text-white/80" : "text-ink-soft")}>
                  {day.isToday ? "Hoje" : day.weekdayShort}
                </span>
                <span className="mt-0.5 text-sm font-semibold">{day.dayNumber}</span>
                <span className={cn("text-[10px]", active ? "text-white/80" : "text-ink-soft")}>{day.monthShort}</span>
                {slotCount !== null ? (
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 rounded-full",
                      active
                        ? soldOut
                          ? "bg-white/40"
                          : "bg-emerald-300"
                        : soldOut
                          ? "bg-slate-300"
                          : "bg-emerald-500",
                    )}
                    title={
                      soldOut
                        ? `Sem bloco contíguo de ${minutesToLabel(totalDurationMin)}`
                        : `${slotCount} encaixe(s) compatível(is)`
                    }
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs capitalize text-ink-soft">{formatDayLabel(date)}</p>
          <Input
            type="date"
            aria-label="Selecionar data no calendário"
            value={date}
            min={today}
            max={maxDate}
            onChange={(e) => {
              if (e.target.value) selectDate(e.target.value);
            }}
            className="w-auto py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-soft">Horário disponível</span>
          {selectedTime && totalDurationMin > 0 ? (
            <span className="text-xs font-medium text-wine">
              Bloco reservado: {selectedTime} às {formatSlotEndTime(selectedTime, totalDurationMin)}
            </span>
          ) : null}
        </div>

        {timeBecameIncompatible ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              O horário <strong>{time}</strong> não comporta o bloco contíguo de{" "}
              <strong>{minutesToLabel(totalDurationMin)}</strong> na agenda desta profissional. Escolha outro encaixe disponível abaixo.
            </span>
          </div>
        ) : null}

        {!selectedServices.length ? (
          <p className="rounded-xl border border-line bg-sand/30 px-3 py-2.5 text-xs text-ink-soft">
            Selecione pelo menos um serviço acima para calcular os blocos livres.
          </p>
        ) : !effectiveProfessionalId ? (
          <p className="rounded-xl border border-line bg-sand/30 px-3 py-2.5 text-xs text-ink-soft">
            Escolha a profissional para consultar os horários compatíveis com {minutesToLabel(totalDurationMin)}.
          </p>
        ) : loadingDate === date ? (
          <p className="rounded-xl border border-line bg-sand/30 px-3 py-2.5 text-xs text-ink-soft">
            Validando blocos contíguos disponíveis na agenda...
          </p>
        ) : freeSlotOptions.length ? (
          <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-4">
            {freeSlotOptions.map((slot) => {
              const isSelected = slot.start === selectedTime;
              return (
                <button
                  key={slot.start}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setTime(slot.start);
                    setError(null);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition",
                    isSelected
                      ? "border-wine bg-wine text-white"
                      : "border-line bg-white text-ink hover:border-wine/50 hover:bg-sand/50",
                  )}
                >
                  <span className="text-sm font-semibold">{slot.start}</span>
                  <span className={cn("text-[10px]", isSelected ? "text-white/85" : "text-ink-soft")}>
                    até {slot.end}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
            <p className="font-medium">
              Sem bloco contíguo livre de {minutesToLabel(totalDurationMin)} neste dia.
            </p>
            <p className="mt-0.5 text-amber-800/90">
              {blockedSlotCount > 0
                ? "Os intervalos livres existentes são menores que a duração total selecionada ou ultrapassam o expediente."
                : "Não há mais horários livres dentro do expediente hoje."}
              {" "}Experimente outra data nos próximos {maxDays} dias ou ajuste os serviços selecionados.
            </p>
          </div>
        )}

        {effectiveProfessionalId && totalDurationMin > 0 && freeSlotOptions.length > 0 ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <Clock size={12} />
            Mostrando apenas os {freeSlotOptions.length} encaixe(s) com bloco contíguo de{" "}
            {minutesToLabel(totalDurationMin)} ({effectiveOpenTime} às {effectiveCloseTime}).
          </p>
        ) : null}
      </div>

      <Field label="Seu nome">
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label="WhatsApp">
        <Input name="phone" required placeholder="11999999999" />
      </Field>

      {selectedPricing.appliedPromos.length ? (
        <p className="text-sm text-emerald-700">
          Desconto aplicado neste dia:{" "}
          {selectedPricing.appliedPromos
            .map((p) => `${p.serviceName} (${p.promoName}) por ${formatBRL(p.priceCents)}`)
            .join(" · ")}
        </p>
      ) : null}

      {error ? <p className="text-sm text-warn">{error}</p> : null}
      <Button disabled={!canSubmit}>
        {pending
          ? "Reservando..."
          : selectedTime
            ? `Confirmar (${selectedTime} – ${formatSlotEndTime(selectedTime, totalDurationMin)})`
            : "Confirmar agendamento"}
      </Button>
    </form>
  );
}
