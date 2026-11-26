"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { reopenComanda } from "@/app/actions/comandas";

export function ReopenComandaButton({
  comandaId,
  comandaNumber,
  compact = false,
  onError,
  onReopened,
}: {
  comandaId: string;
  comandaNumber: number;
  compact?: boolean;
  onError?: (message: string | null) => void;
  onReopened?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleClick() {
    const ok = await confirm({
      title: `Reabrir comanda #${comandaNumber}?`,
      description:
        "A comanda voltará para o status aberta. Lançamentos financeiros, comissões pendentes, baixas de estoque, cashback, crédito e baixas de pacote gerados no fechamento serão estornados.",
      confirmLabel: "Reabrir comanda",
      cancelLabel: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    setPending(true);
    setLocalError(null);
    onError?.(null);
    try {
      const result = await reopenComanda(comandaId);
      if (result && "error" in result && result.error) {
        if (onError) onError(result.error);
        else setLocalError(result.error);
        return;
      }
      onReopened?.();
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível reabrir a comanda.";
      if (onError) onError(msg);
      else setLocalError(msg);
    } finally {
      setPending(false);
    }
  }

  if (compact) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void handleClick()}
        className="h-8 px-2.5 text-xs"
        title="Reabrir comanda fechada (somente administrador)"
      >
        <RotateCcw size={13} />
        {pending ? "Reabrindo..." : "Reabrir"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" disabled={pending} onClick={() => void handleClick()}>
        <RotateCcw size={15} />
        {pending ? "Reabrindo..." : "Reabrir comanda"}
      </Button>
      {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
    </div>
  );
}
