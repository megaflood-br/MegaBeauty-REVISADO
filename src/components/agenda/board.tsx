"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { AppointmentEditor } from "@/components/agenda/appointment-editor";
import { ScheduleBlockEditor } from "@/components/agenda/schedule-block-editor";
import type {
  AgendaAppointment,
  AgendaClient,
  AgendaProfessional,
  AgendaScheduleBlock,
  AgendaService,
} from "@/components/agenda/types";
import { Avatar, Badge, Button } from "@/components/ui";
import { STATUS_COLOR, STATUS_LABEL, type AppointmentStatus } from "@/lib/constants";
import {
  buildSlots,
  formatDayLabel,
  formatTime,
  minutesInTz,
  parseHHmm,
  shiftCalendarDate,
} from "@/lib/dates";

const SLOT_H = 28;
const HEADER_H = 80;

type Placed = {
  appt: AgendaAppointment;
  start: Date;
  end: Date;
  top: number;
  height: number;
  lane: number;
  lanes: number;
};

function placeAppointments(
  items: AgendaAppointment[],
  openMin: number,
  closeMin: number,
  slotMinutes: number,
): Placed[] {
  const visible: Omit<Placed, "lane" | "lanes">[] = [];

  for (const appt of items) {
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    const startMin = minutesInTz(start);
    const endMin = Math.max(startMin + slotMinutes, minutesInTz(end));
    const clippedStart = Math.max(startMin, openMin);
    const clippedEnd = Math.min(endMin, closeMin);
    if (clippedEnd <= clippedStart) continue;
    visible.push({
      appt,
      start,
      end,
      top: ((clippedStart - openMin) / slotMinutes) * SLOT_H,
      height: Math.max(SLOT_H, ((clippedEnd - clippedStart) / slotMinutes) * SLOT_H),
    });
  }

  const sorted = visible.sort((a, b) => a.top - b.top || b.height - a.height);
  const laneEnds: number[] = [];
  const withLane = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.top + 0.5);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(item.top + item.height);
    } else {
      laneEnds[lane] = item.top + item.height;
    }
    return { ...item, lane, lanes: 1 };
  });

  return withLane.map((item) => {
    const overlapping = withLane.filter(
      (other) => other.top < item.top + item.height - 0.5 && other.top + other.height > item.top + 0.5,
    );
    const lanes = Math.max(...overlapping.map((o) => o.lane), item.lane) + 1;
    return { ...item, lanes };
  });
}

type PlacedBlock = {
  block: AgendaScheduleBlock;
  start: Date;
  end: Date;
  top: number;
  height: number;
};

function placeBlocks(
  items: AgendaScheduleBlock[],
  openMin: number,
  closeMin: number,
  slotMinutes: number,
): PlacedBlock[] {
  const placed: PlacedBlock[] = [];
  for (const block of items) {
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    const startMin = minutesInTz(start);
    const endMin = Math.max(startMin + slotMinutes, minutesInTz(end));
    const clippedStart = Math.max(startMin, openMin);
    const clippedEnd = Math.min(endMin, closeMin);
    if (clippedEnd <= clippedStart) continue;
    placed.push({
      block,
      start,
      end,
      top: ((clippedStart - openMin) / slotMinutes) * SLOT_H,
      height: Math.max(SLOT_H, ((clippedEnd - clippedStart) / slotMinutes) * SLOT_H),
    });
  }
  return placed;
}

export function AgendaBoard({
  date,
  openTime,
  closeTime,
  slotMinutes,
  professionals,
  appointments,
  blocks = [],
  clients,
  services,
  canCreate = true,
  canEdit = true,
  canRemove = true,
  canBlockSlots = false,
  canViewAll = true,
  canCreateComanda = true,
  canViewComanda = true,
  hidePhones = false,
}: {
  date: string;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  professionals: AgendaProfessional[];
  appointments: AgendaAppointment[];
  blocks?: AgendaScheduleBlock[];
  clients: AgendaClient[];
  services: AgendaService[];
  canCreate?: boolean;
  canEdit?: boolean;
  canRemove?: boolean;
  canBlockSlots?: boolean;
  canViewAll?: boolean;
  canCreateComanda?: boolean;
  canViewComanda?: boolean;
  hidePhones?: boolean;
}) {
  const slots = useMemo(() => buildSlots(openTime, closeTime, slotMinutes), [openTime, closeTime, slotMinutes]);
  const [draft, setDraft] = useState<{ professionalId: string; time: string } | null>(null);
  const [selected, setSelected] = useState<AgendaAppointment | null>(null);
  const [blockDraft, setBlockDraft] = useState<{ professionalId: string; time: string } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<AgendaScheduleBlock | null>(null);
  const openMin = parseHHmm(openTime);
  const closeMin = parseHHmm(closeTime);
  const gridHeight = slots.length * SLOT_H;
  const defaultBlockStart = slots.includes("12:00") ? "12:00" : slots[0] ?? openTime;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Agenda</h1>
          <p className="capitalize text-ink-soft">{formatDayLabel(date)}</p>
          {!canCreate && !canEdit ? (
            <p className="mt-1 text-sm text-ink-soft">
              {canBlockSlots
                ? "Você pode bloquear e desbloquear horários clicando em um espaço livre ou no botão Bloquear horário."
                : "Consulta apenas. Marcar horário e abrir comanda ficam com quem tem permissão."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBlockSlots && professionals.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockDraft({ professionalId: professionals[0].id, time: defaultBlockStart })}
            >
              <Lock size={15} />
              Bloquear horário
            </Button>
          ) : null}
          <Link href={`/agenda?date=${shiftCalendarDate(date, -1)}`} className="rounded-full border border-line p-2">
            <ChevronLeft size={18} />
          </Link>
          <Link href="/agenda" className="rounded-full border border-line px-4 py-2 text-sm">
            Hoje
          </Link>
          <Link href={`/agenda?date=${shiftCalendarDate(date, 1)}`} className="rounded-full border border-line p-2">
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <Badge key={key} color={STATUS_COLOR[key as AppointmentStatus]}>
            {label}
          </Badge>
        ))}
        {canBlockSlots || blocks.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            <Lock size={11} />
            Bloqueado{blocks.length > 0 ? ` (${blocks.length})` : ""}
          </span>
        ) : null}
        {appointments.some((a) => a.status === "AI_BOOKED") ? (
          canEdit ? (
            <button
              type="button"
              onClick={() => {
                const firstAi = appointments.find((a) => a.status === "AI_BOOKED");
                if (firstAi) setSelected(firstAi);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800 transition hover:bg-violet-200"
              title="Abrir próximo agendamento da IA para conferência"
            >
              <Bot size={12} />
              {appointments.filter((a) => a.status === "AI_BOOKED").length} para conferência
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">
              <Bot size={12} />
              {appointments.filter((a) => a.status === "AI_BOOKED").length} para conferência
            </span>
          )
        ) : null}
      </div>

      <div className="agenda-scroll max-h-[calc(100vh-13rem)] overflow-auto rounded-2xl border border-line bg-paper">
        <div aria-hidden className="w-full" style={{ height: HEADER_H + gridHeight }} />
        <div
          className="agenda-day-row"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: HEADER_H + gridHeight,
            minWidth: `calc(4rem + ${Math.max(professionals.length, 1)} * 14rem)`,
          }}
        >
          <div className="agenda-day-gutter sticky left-0 z-30 bg-sand">
            <div className="sticky top-0 z-30 border-b border-line bg-sand" style={{ height: HEADER_H }} />
            {slots.map((slot) => (
              <div key={slot} className="border-b border-line/70 px-1 text-[10px] text-ink-soft" style={{ height: SLOT_H }}>
                {slot.endsWith(":00") ? slot : ""}
              </div>
            ))}
          </div>
          {professionals.map((pro) => {
            const placed = placeAppointments(
              appointments.filter((a) => a.professionalId === pro.id),
              openMin,
              closeMin,
              slotMinutes,
            );
            const placedBlocks = placeBlocks(
              blocks.filter((b) => b.professionalId === pro.id),
              openMin,
              closeMin,
              slotMinutes,
            );
            const slotInteractive = canCreate || canBlockSlots;
            return (
              <div key={pro.id} className="agenda-day-col border-l border-line">
                <div
                  className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-paper px-3"
                  style={{ height: HEADER_H }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={pro.name} color={pro.color} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{pro.name.split(" ")[0]}</div>
                      <div className="truncate text-xs text-ink-soft">{pro.specialty}</div>
                    </div>
                  </div>
                  {canBlockSlots ? (
                    <button
                      type="button"
                      onClick={() => setBlockDraft({ professionalId: pro.id, time: defaultBlockStart })}
                      className="shrink-0 rounded-lg p-1.5 text-ink-soft transition hover:bg-sand hover:text-ink"
                      title={`Bloquear horário de ${pro.name}`}
                      aria-label={`Bloquear horário de ${pro.name}`}
                    >
                      <Lock size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="relative overflow-hidden" style={{ height: gridHeight }}>
                  {slots.map((slot) =>
                    slotInteractive ? (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => {
                          if (canCreate) setDraft({ professionalId: pro.id, time: slot });
                          else if (canBlockSlots) setBlockDraft({ professionalId: pro.id, time: slot });
                        }}
                        className="block w-full border-b border-dashed border-line/80 hover:bg-gold-soft/40"
                        style={{ height: SLOT_H }}
                        aria-label={
                          canCreate ? `Novo horário ${slot} com ${pro.name}` : `Bloquear horário ${slot} de ${pro.name}`
                        }
                      />
                    ) : (
                      <div
                        key={slot}
                        className="block w-full cursor-default border-b border-dashed border-line/80"
                        style={{ height: SLOT_H }}
                        aria-hidden
                      />
                    ),
                  )}
                  {placedBlocks.map((item) => (
                    <button
                      key={item.block.id}
                      type="button"
                      disabled={!canBlockSlots}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canBlockSlots) return;
                        setSelectedBlock(item.block);
                      }}
                      className={`absolute left-1 right-1 overflow-hidden rounded-lg border border-dashed border-slate-400 bg-slate-100/95 px-2 py-1 text-left text-slate-700 shadow-xs ${
                        canBlockSlots ? "hover:border-slate-500 hover:bg-slate-200/80" : "cursor-default"
                      }`}
                      style={{
                        top: item.top,
                        height: item.height,
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <Lock size={11} className="shrink-0 text-slate-500" />
                        <span className="truncate text-xs font-semibold leading-tight">
                          {item.block.reason || "Horário bloqueado"}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {formatTime(item.start)}–{formatTime(item.end)}
                      </div>
                    </button>
                  ))}
                  {placed.map((item) => {
                    const service = item.appt.items[0]?.service;
                    const width = `calc((100% - 8px) / ${item.lanes})`;
                    const left = `calc(4px + ${item.lane} * (100% - 8px) / ${item.lanes})`;
                    return (
                      <button
                        key={item.appt.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canEdit) return;
                          setSelected(item.appt);
                        }}
                        className={`absolute overflow-hidden rounded-lg px-2 py-1 text-left text-white shadow-sm ${canEdit ? "" : "cursor-default"}`}
                        style={{
                          top: item.top,
                          height: item.height,
                          left,
                          width,
                          background: STATUS_COLOR[item.appt.status],
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-semibold leading-tight">{item.appt.client.name}</span>
                          {item.appt.status === "AI_BOOKED" ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-white/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                              title="Agendado pela IA — aguardando conferência"
                            >
                              <Bot size={10} /> IA
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[11px] opacity-90">
                          {item.appt.items.length > 1
                            ? item.appt.items.map((i) => i.service.name).join(" + ")
                            : service?.name}
                        </div>
                        <div className="text-[10px] opacity-80">
                          {formatTime(item.start)}–{formatTime(item.end)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {draft && canCreate ? (
        <AppointmentEditor
          mode="create"
          date={date}
          defaultProfessionalId={draft.professionalId}
          defaultTime={draft.time}
          appointment={null}
          clients={clients}
          professionals={professionals}
          services={services}
          slots={slots}
          canRemove={canRemove}
          canCreateComanda={canCreateComanda}
          canViewComanda={canViewComanda}
          hidePhones={hidePhones}
          onClose={() => setDraft(null)}
        />
      ) : null}

      {selected && canEdit ? (
        <AppointmentEditor
          mode="edit"
          date={date}
          defaultProfessionalId={selected.professionalId}
          defaultTime={formatTime(new Date(selected.startAt))}
          appointment={selected}
          clients={clients}
          professionals={professionals}
          services={services}
          slots={slots}
          canRemove={canRemove}
          canCreateComanda={canCreateComanda}
          canViewComanda={canViewComanda}
          hidePhones={hidePhones}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {blockDraft && canBlockSlots ? (
        <ScheduleBlockEditor
          mode="create"
          date={date}
          openTime={openTime}
          closeTime={closeTime}
          defaultProfessionalId={blockDraft.professionalId}
          defaultStartTime={blockDraft.time}
          block={null}
          professionals={professionals}
          lockProfessional={!canViewAll}
          onClose={() => setBlockDraft(null)}
        />
      ) : null}

      {selectedBlock && canBlockSlots ? (
        <ScheduleBlockEditor
          mode="edit"
          date={date}
          openTime={openTime}
          closeTime={closeTime}
          defaultProfessionalId={selectedBlock.professionalId}
          defaultStartTime={formatTime(new Date(selectedBlock.startAt))}
          block={selectedBlock}
          professionals={professionals}
          lockProfessional={!canViewAll}
          onClose={() => setSelectedBlock(null)}
        />
      ) : null}
    </div>
  );
}
