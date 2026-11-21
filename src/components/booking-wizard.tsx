"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { getPublicBookingBusySlots, publicBook } from "@/app/actions/booking";
import { Button, Field, Input, Select } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { formatBRL } from "@/lib/money";
import { calendarDate, formatDayLabel, minutesToLabel, shiftCalendarDate, zonedDateTime } from "@/lib/dates";
import { bestPromotion, type PromoRule } from "@/lib/promotions";
import {
  PUBLIC_BOOKING_MAX_DAYS,
  buildUpcomingBookingDays,
  isDateInBookingWindow,
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

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(today);
  const [pageIndex, setPageIndex] = useState(0);
  const [time, setTime] = useState("");
  const [busyByDate, setBusyByDate] = useState<Record<string, BookingBusyInterval[]>>({});
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const service = services.find((s) => s.id === serviceId);
  const serviceDurationMin = service?.durationMin ?? 0;
  const pros = useMemo(
    () => professionals.filter((p) => !serviceId || p.serviceIds.includes(serviceId) || p.serviceIds.length === 0),
    [professionals, serviceId],
  );
  const activeProfessional = pros.find((p) => p.id === professionalId) ?? null;
  const effectiveProfessionalId = activeProfessional?.id ?? "";

  const effectiveOpenTime = activeProfessional?.workStart || openTime;
  const effectiveCloseTime = activeProfessional?.workEnd || closeTime;

  const activeBusy = busyByDate[date] ?? initialBusy;

  const servicePromo = service ? bestPromotion(promotions, date, "SERVICE", service.id, service.priceCents) : null;
  const dayOffers = useMemo(
    () =>
      services.flatMap((item) => {
        const promo = bestPromotion(promotions, date, "SERVICE", item.id, item.priceCents);
        return promo ? [{ service: item, promo }] : [];
      }),
    [services, promotions, date],
  );

  const freeSlots =
    effectiveProfessionalId && serviceDurationMin
      ? publicBookingSlotsForDate({
          date,
          openTime: effectiveOpenTime,
          closeTime: effectiveCloseTime,
          slotMinutes,
          durationMin: serviceDurationMin,
          professionalId: effectiveProfessionalId,
          busy: activeBusy,
          today,
        })
      : [];

  const selectedTime = freeSlots.includes(time) ? time : "";

  const totalPages = Math.ceil(upcomingDays.length / DAYS_PER_PAGE);
  const visibleDays = upcomingDays.slice(pageIndex * DAYS_PER_PAGE, (pageIndex + 1) * DAYS_PER_PAGE);

  const visibleAvailabilityCounts: Record<string, number> | null =
    effectiveProfessionalId && serviceDurationMin
      ? Object.fromEntries(
          visibleDays.map((day) => {
            const dayBusy = busyByDate[day.date] ?? initialBusy;
            const count = publicBookingSlotsForDate({
              date: day.date,
              openTime: effectiveOpenTime,
              closeTime: effectiveCloseTime,
              slotMinutes,
              durationMin: serviceDurationMin,
              professionalId: effectiveProfessionalId,
              busy: dayBusy,
              today,
            }).length;
            return [day.date, count];
          }),
        )
      : null;

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

  function handleServiceChange(nextServiceId: string) {
    setServiceId(nextServiceId);
    setTime("");
    setError(null);
    const nextPros = professionals.filter(
      (p) => !nextServiceId || p.serviceIds.includes(nextServiceId) || p.serviceIds.length === 0,
    );
    if (professionalId && !nextPros.some((p) => p.id === professionalId)) {
      setProfessionalId("");
    }
  }

  function handleProfessionalChange(nextProfId: string) {
    setProfessionalId(nextProfId);
    setTime("");
    setError(null);
  }

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
      className="grid gap-4 rounded-3xl bg-paper p-6"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await publicBook(formData);
          if (result?.error) setError(result.error);
          else setDone(true);
        });
      }}
    >
      <input type="hidden" name="slug" value={slug} />
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
      <Field label="Serviço">
        <SearchSelect
          name="serviceId"
          required
          placeholder="Buscar serviço..."
          value={serviceId}
          onChange={handleServiceChange}
          options={services.map((s) => {
            const promo = bestPromotion(promotions, date, "SERVICE", s.id, s.priceCents);
            return {
              value: s.id,
              label: s.name,
              hint: promo
                ? `${minutesToLabel(s.durationMin)} · ${formatBRL(promo.priceCents)} na ${promo.promo.name}`
                : `${minutesToLabel(s.durationMin)} · ${formatBRL(s.priceCents)}`,
            };
          })}
        />
      </Field>
      <Field label="Profissional">
        <SearchSelect
          name="professionalId"
          required
          placeholder="Buscar profissional..."
          value={effectiveProfessionalId}
          onChange={handleProfessionalChange}
          options={pros.map((p) => ({ value: p.id, label: p.name }))}
        />
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
                    title={soldOut ? "Sem horários livres" : `${slotCount} horário(s) livre(s)`}
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

      <Field label="Horário">
        <Select value={selectedTime} onChange={(e) => setTime(e.target.value)} required disabled={!effectiveProfessionalId || !service}>
          <option value="">
            {!effectiveProfessionalId
              ? "Selecione a profissional primeiro"
              : loadingDate === date
                ? "Atualizando horários..."
                : freeSlots.length
                  ? `Escolha um horário livre (${freeSlots.length} opções)`
                  : "Sem encaixe livre neste dia"}
          </option>
          {freeSlots.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {effectiveProfessionalId && service ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <Clock size={12} />
            {freeSlots.length
              ? `Encaixe contínuo validado para ${minutesToLabel(service.durationMin)} (${effectiveOpenTime} às ${effectiveCloseTime}).`
              : `Sem bloco livre de ${minutesToLabel(service.durationMin)} neste dia. Experimente outra data nos próximos ${maxDays} dias.`}
          </p>
        ) : null}
      </Field>

      <Field label="Seu nome">
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label="WhatsApp">
        <Input name="phone" required placeholder="11999999999" />
      </Field>
      {servicePromo ? (
        <p className="text-sm text-emerald-700">
          Oferta válida neste dia: {servicePromo.promo.name} por {formatBRL(servicePromo.priceCents)}.
        </p>
      ) : null}
      {error ? <p className="text-sm text-warn">{error}</p> : null}
      <Button disabled={pending || !selectedTime}>{pending ? "Reservando..." : "Confirmar agendamento"}</Button>
    </form>
  );
}
