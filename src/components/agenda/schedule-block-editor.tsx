"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteScheduleBlock, saveScheduleBlock } from "@/app/actions/appointments";
import { formatTime, parseHHmm } from "@/lib/dates";
import type { AgendaProfessional, AgendaScheduleBlock } from "@/components/agenda/types";

const QUICK_REASONS = [
  "Almoço",
  "Compromisso pessoal",
  "Consulta médica",
  "Ausência / Externo",
  "Folga",
] as const;

const QUICK_DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "2 horas", minutes: 120 },
  { label: "4 horas", minutes: 240 },
] as const;

function minutesToHHmm(total: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function defaultEndForStart(startHHmm: string, closeTime: string, durationMin = 120) {
  const startMin = parseHHmm(startHHmm);
  const closeMin = parseHHmm(closeTime);
  const target = startMin + durationMin;
  if (closeMin > startMin) {
    return minutesToHHmm(Math.min(target, closeMin));
  }
  return minutesToHHmm(target);
}

export function ScheduleBlockEditor({
  mode,
  date,
  openTime,
  closeTime,
  defaultProfessionalId,
  defaultStartTime,
  block,
  professionals,
  lockProfessional = false,
  onClose,
}: {
  mode: "create" | "edit";
  date: string;
  openTime: string;
  closeTime: string;
  defaultProfessionalId: string;
  defaultStartTime: string;
  block: AgendaScheduleBlock | null;
  professionals: AgendaProfessional[];
  lockProfessional?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const initialStart = block ? formatTime(new Date(block.startAt)) : defaultStartTime;
  const initialEnd = block ? formatTime(new Date(block.endAt)) : defaultEndForStart(defaultStartTime, closeTime, 120);

  const [professionalId, setProfessionalId] = useState(
    block?.professionalId ?? defaultProfessionalId ?? professionals[0]?.id ?? "",
  );
  const [blockDate, setBlockDate] = useState(date);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [reason, setReason] = useState(block?.reason ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPro = professionals.find((p) => p.id === professionalId) ?? professionals[0];
  const proOpen = selectedPro?.workStart || openTime;
  const proClose = selectedPro?.workEnd || closeTime;

  function applyDuration(minutes: number) {
    setEndTime(defaultEndForStart(startTime, proClose, minutes));
  }

  function applyFullDay() {
    setStartTime(proOpen);
    setEndTime(proClose);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await saveScheduleBlock({
        id: block?.id,
        professionalId,
        date: blockDate,
        startTime,
        endTime,
        reason,
      });
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o bloqueio.");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!block) return;
    const ok = await confirm({
      title: "Desbloquear este horário?",
      description: "O intervalo voltará a ficar disponível para novos agendamentos na agenda, no site e na IA.",
      confirmLabel: "Desbloquear",
      cancelLabel: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    setError(null);
    setPending(true);
    try {
      const result = await deleteScheduleBlock(block.id);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o bloqueio.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-block-title"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Lock size={17} />
            </span>
            <div>
              <h2 id="schedule-block-title" className="text-base font-semibold">
                {mode === "edit" ? "Editar bloqueio de horário" : "Bloquear horário na agenda"}
              </h2>
              <p className="text-xs text-ink-soft">
                Impede novos agendamentos no painel, agendamento online e recepcionista IA.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-sand"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Profissional" required>
              <Select
                value={professionalId}
                disabled={lockProfessional || professionals.length <= 1}
                onChange={(e) => setProfessionalId(e.target.value)}
              >
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Data" required>
              <Input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} required />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Início" required>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </Field>
            <Field label="Término" required>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </Field>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-soft">Atalhos de duração</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_DURATIONS.map((preset) => (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => applyDuration(preset.minutes)}
                  className="rounded-lg border border-line bg-slate-50 px-2.5 py-1 text-xs font-medium text-ink hover:bg-sand"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={applyFullDay}
                className="rounded-lg border border-line bg-slate-50 px-2.5 py-1 text-xs font-medium text-ink hover:bg-sand"
              >
                Dia inteiro ({proOpen}–{proClose})
              </button>
            </div>
          </div>

          <Field label="Motivo (opcional)">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={140}
              placeholder="Ex.: Consulta médica, almoço, compromisso externo..."
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setReason(label)}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-ink-soft hover:border-slate-300 hover:text-ink"
              >
                {label}
              </button>
            ))}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            {mode === "edit" && block ? (
              <Button type="button" variant="danger" disabled={pending} onClick={() => void handleDelete()}>
                <Trash2 size={15} />
                Desbloquear horário
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                <Lock size={15} />
                {pending ? "Salvando..." : mode === "edit" ? "Salvar bloqueio" : "Bloquear horário"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
