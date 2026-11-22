"use client";

import { useEffect, useState, useTransition } from "react";
import { Activity, BadgeCheck, QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import {
  connectWhatsAppInstance,
  diagnoseWhatsAppInstance,
  disconnectOfficialWhatsApp,
  disconnectWhatsAppInstance,
  saveOfficialWhatsApp,
  setWhatsAppProvider,
  syncWhatsAppInstance,
} from "@/app/actions/whatsapp";
import type { EvolutionDiagnostic, WhatsAppLive } from "@/lib/whatsapp-live";
import type { WhatsAppProvider } from "@/lib/whatsapp-meta";
import { cn } from "@/lib/utils";

export function WhatsAppConnect({ initial }: { initial: WhatsAppLive }) {
  const [live, setLive] = useState(initial);
  const [pending, setPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<EvolutionDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(initial.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [phoneNumberId, setPhoneNumberId] = useState(initial.officialPhoneNumberId);
  const [wabaId, setWabaId] = useState(initial.officialWabaId);
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const response = await fetch("/api/whatsapp/live", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const next = (await response.json()) as WhatsAppLive;
      if (!cancelled) {
        setLive(next);
        setError(next.error);
      }
    }
    void tick();
    const wait = live.provider === "evolution" && live.state === "connecting" ? 3000 : 8000;
    const timer = window.setInterval(() => void tick(), wait);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live.provider, live.state]);

  async function connect() {
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await connectWhatsAppInstance();
    if (result && "error" in result && typeof result.error === "string") {
      setError(result.error);
    } else if (result && "ok" in result && result.ok) {
      const nextState = result.state ?? "connecting";
      setLive((current) => ({
        ...current,
        qr: nextState === "open" ? null : result.qr ?? current.qr,
        state: nextState,
        connected: nextState === "open",
        number: result.number ?? current.number,
        webhookUrl: result.webhookUrl || current.webhookUrl,
        provider: "evolution",
      }));
      if (result.warning) {
        setError(result.warning);
      } else if (nextState === "open") {
        setNotice("WhatsApp já está conectado e o webhook foi sincronizado.");
      }
    }
    setPending(false);
  }

  async function syncWebhook() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    const result = await syncWhatsAppInstance();
    if (result && "error" in result && typeof result.error === "string") {
      setError(result.error);
    } else if (result && "ok" in result && result.ok) {
      setLive((current) => ({
        ...current,
        provider: "evolution",
        instance: result.instance,
        state: result.state,
        connected: result.state === "open",
        qr: result.state === "open" ? null : current.qr,
        number: result.number ?? current.number,
        webhookUrl: result.webhookUrl,
      }));
      setNotice(
        result.state === "open"
          ? "Webhook reconfigurado na Evolution e conexão confirmada."
          : "Webhook reconfigurado na Evolution. Leia o QR Code se o celular ainda não estiver pareado.",
      );
    }
    setSyncing(false);
  }

  async function diagnoseWebhook() {
    setDiagnosing(true);
    setError(null);
    const result = await diagnoseWhatsAppInstance();
    if (result && "error" in result && typeof result.error === "string") {
      setError(result.error);
    } else if (result && "ok" in result && result.ok) {
      setDiagnostic(result.diagnostic);
    }
    setDiagnosing(false);
  }

  async function disconnect() {
    setPending(true);
    setError(null);
    setNotice(null);
    await disconnectWhatsAppInstance();
    setLive((current) => ({ ...current, state: "close", qr: null, number: null, connected: current.provider === "official" && current.officialState === "open" }));
    setPending(false);
  }

  function choose(provider: WhatsAppProvider) {
    setError(null);
    setNotice(null);
    setLive((current) => ({
      ...current,
      provider,
      connected: provider === "official" ? current.officialState === "open" : current.state === "open",
    }));
    const form = new FormData();
    form.set("provider", provider);
    startSave(async () => {
      const result = await setWhatsAppProvider(form);
      if (result && "error" in result && result.error) setError(result.error);
    });
  }

  function saveOfficial() {
    setError(null);
    setNotice(null);
    startSave(async () => {
      const form = new FormData();
      form.set("metaPhoneNumberId", phoneNumberId);
      form.set("metaWabaId", wabaId);
      form.set("metaAccessToken", accessToken);
      const result = await saveOfficialWhatsApp(form);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setAccessToken("");
      setLive((current) => ({
        ...current,
        provider: "official",
        connected: true,
        officialReady: true,
        officialState: "open",
        officialNumber: result && "number" in result ? result.number ?? null : current.officialNumber,
        officialPhoneNumberId: phoneNumberId,
      }));
    });
  }

  async function disconnectOfficial() {
    setPending(true);
    setError(null);
    setNotice(null);
    await disconnectOfficialWhatsApp();
    setLive((current) => ({
      ...current,
      officialState: "close",
      connected: current.provider === "evolution" && current.state === "open",
    }));
    setPending(false);
  }

  const evolutionOn = live.state === "open";
  const officialOn = live.officialState === "open";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl">Conexão WhatsApp</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Escolha o método ativo. A Evolution (QR Code) continua disponível; a API oficial usa o número da Meta Cloud API.
          Status e QR da Evolution entram pelo webhook e ficam no banco — a tela não consulta a API em loop.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => choose("evolution")}
          className={cn(
            "rounded-xl border px-4 py-3 text-left",
            live.provider === "evolution" ? "border-wine bg-wine/5" : "border-line hover:bg-sand",
          )}
        >
          <p className="text-sm font-medium">QR Code · Evolution</p>
          <p className="mt-0.5 text-xs text-ink-soft">WhatsApp Business no celular do salão.</p>
          {evolutionOn ? <p className="mt-2 text-xs font-semibold text-emerald-700">Conectado</p> : null}
        </button>
        <button
          type="button"
          onClick={() => choose("official")}
          className={cn(
            "rounded-xl border px-4 py-3 text-left",
            live.provider === "official" ? "border-wine bg-wine/5" : "border-line hover:bg-sand",
          )}
        >
          <p className="text-sm font-medium">API oficial · Meta</p>
          <p className="mt-0.5 text-xs text-ink-soft">Cloud API com Phone Number ID e token.</p>
          {officialOn ? <p className="mt-2 text-xs font-semibold text-emerald-700">Conectada</p> : null}
        </button>
      </div>

      {live.provider === "official" ? (
        <OfficialPanel
          live={live}
          phoneNumberId={phoneNumberId}
          wabaId={wabaId}
          accessToken={accessToken}
          pending={pending || saving}
          onPhoneNumberId={setPhoneNumberId}
          onWabaId={setWabaId}
          onAccessToken={setAccessToken}
          onSave={saveOfficial}
          onDisconnect={disconnectOfficial}
        />
      ) : (
        <EvolutionPanel
          live={live}
          pending={pending}
          syncing={syncing}
          diagnosing={diagnosing}
          diagnostic={diagnostic}
          onConnect={connect}
          onSync={syncWebhook}
          onDiagnose={diagnoseWebhook}
          onDisconnect={disconnect}
        />
      )}

      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

function EvolutionPanel({
  live,
  pending,
  syncing,
  diagnosing,
  diagnostic,
  onConnect,
  onSync,
  onDiagnose,
  onDisconnect,
}: {
  live: WhatsAppLive;
  pending: boolean;
  syncing: boolean;
  diagnosing: boolean;
  diagnostic: EvolutionDiagnostic | null;
  onConnect: () => void;
  onSync: () => void;
  onDiagnose: () => void;
  onDisconnect: () => void;
}) {
  const connected = live.state === "open";
  const busy = pending || syncing || diagnosing;
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-xl px-3 py-2 text-sm",
          connected ? "bg-emerald-50 text-emerald-800" : live.serverReady ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-ink-soft",
        )}
      >
        {!live.serverReady
          ? "Servidor Evolution ainda não foi configurado na plataforma."
          : connected
            ? `Conectado${live.number ? ` · ${live.number}` : ""}`
            : "Aguardando leitura do QR Code"}
      </div>

      {!live.serverReady ? (
        <p className="text-sm text-ink-soft">
          Peça ao administrador da plataforma para salvar a URL e a API key da Evolution em Integrações. O inbox continua em
          modo demonstração.
        </p>
      ) : connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Smartphone size={16} />
            Instância {live.instance}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onSync}>
              <RefreshCw size={16} className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Sincronizando..." : "Sincronizar webhook"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onDiagnose}>
              <Activity size={16} />
              {diagnosing ? "Verificando..." : "Diagnosticar recebimento"}
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={onDisconnect}>
              <Unplug size={16} />
              Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {live.qr ? (
            <div className="rounded-2xl border border-line bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={live.qr} alt="QR Code do WhatsApp" className="mx-auto h-56 w-56" />
            </div>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-line text-ink-soft">
              <QrCode size={36} />
              <p className="mt-2 text-sm">Gere o QR Code para vincular este salão.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={onConnect}>
              <RefreshCw size={16} />
              {live.qr ? "Atualizar QR" : "Gerar QR Code"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onSync}>
              <RefreshCw size={16} className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Sincronizando..." : "Sincronizar webhook"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onDiagnose}>
              <Activity size={16} />
              {diagnosing ? "Verificando..." : "Diagnosticar recebimento"}
            </Button>
          </div>
        </div>
      )}

      {diagnostic ? (
        <div className="space-y-2 rounded-xl border border-line bg-sand/50 p-3 text-xs text-ink">
          <p className="font-semibold">Diagnóstico do recebimento ({diagnostic.instance})</p>
          <p className={diagnostic.testReport.ok ? "font-medium text-emerald-700" : "font-medium text-amber-800"}>
            {diagnostic.testReport.summary}
          </p>
          <ul className="space-y-1 text-ink-soft">
            <li>
              Autenticação do token Evolution:{" "}
              <strong className={diagnostic.authOk ? "text-emerald-700" : "text-red-600"}>
                {diagnostic.authOk
                  ? `Autenticado (HTTP ${diagnostic.authHttpStatus ?? 200})`
                  : `Recusado / inacessível${diagnostic.authHttpStatus ? ` (HTTP ${diagnostic.authHttpStatus})` : ""}`}
              </strong>
            </li>
            <li>
              Estado real na Evolution:{" "}
              <strong className="text-ink">
                {diagnostic.evolutionState}
                {diagnostic.evolutionError ? ` (${diagnostic.evolutionError})` : ""}
              </strong>
            </li>
            <li>
              Webhook cadastrado na Evolution:{" "}
              {diagnostic.remoteWebhook ? (
                <strong className={diagnostic.remoteWebhook.enabled && diagnostic.remoteWebhook.urlMatches && diagnostic.remoteWebhook.hasMessagesUpsert ? "text-emerald-700" : "text-amber-800"}>
                  {diagnostic.remoteWebhook.enabled ? "Ativo" : "Desativado"} ·{" "}
                  {diagnostic.remoteWebhook.urlMatches ? "URL correta" : "URL diferente da esperada"} ·{" "}
                  {diagnostic.remoteWebhook.hasMessagesUpsert ? "MESSAGES_UPSERT ativo" : "sem MESSAGES_UPSERT"}
                </strong>
              ) : (
                <strong className="text-red-600">Não configurado na Evolution (clique em Sincronizar webhook)</strong>
              )}
            </li>
            {diagnostic.remoteWebhook?.urlMasked ? (
              <li className="break-all">URL atual na Evolution: {diagnostic.remoteWebhook.urlMasked}</li>
            ) : null}
            <li>
              Recepcionista virtual:{" "}
              <strong className={diagnostic.receptionistEnabled ? "text-emerald-700" : "text-amber-800"}>
                {diagnostic.receptionistEnabled ? "Atendimento automático ligado" : "Desligada (ative em Recepcionista)"}
              </strong>
            </li>
          </ul>
          <div className="border-t border-line pt-2">
            <p className="font-medium text-ink">Últimos eventos recebidos pelo servidor:</p>
            {diagnostic.recentWebhooks.length ? (
              <ul className="mt-1 space-y-1 text-ink-soft">
                {diagnostic.recentWebhooks.map((item, idx) => (
                  <li key={`${item.at}-${idx}`} className="font-mono text-[11px]">
                    {new Date(item.at).toLocaleTimeString("pt-BR")} · HTTP {item.httpStatus} · {item.event} · {item.outcome}
                    {item.phoneSuffix ? ` · final ${item.phoneSuffix}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-ink-soft">
                Nenhum webhook chegou ainda neste servidor. Envie uma mensagem de outro WhatsApp para o número do salão e clique em
                Verificar novamente. Se continuar vazio, a Evolution não está conseguindo acessar a URL pública acima.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {live.webhookUrl ? (
        <p className="break-all text-xs text-ink-soft">Webhook Evolution: {live.webhookUrl}</p>
      ) : null}
    </div>
  );
}

function OfficialPanel({
  live,
  phoneNumberId,
  wabaId,
  accessToken,
  pending,
  onPhoneNumberId,
  onWabaId,
  onAccessToken,
  onSave,
  onDisconnect,
}: {
  live: WhatsAppLive;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  pending: boolean;
  onPhoneNumberId: (value: string) => void;
  onWabaId: (value: string) => void;
  onAccessToken: (value: string) => void;
  onSave: () => void;
  onDisconnect: () => void;
}) {
  const connected = live.officialState === "open";
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-xl px-3 py-2 text-sm",
          connected ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900",
        )}
      >
        {connected
          ? `API oficial conectada${live.officialNumber ? ` · ${live.officialNumber}` : ""}`
          : "Cole o Phone Number ID e o token permanente da Cloud API."}
      </div>

      <Field label="Phone Number ID">
        <Input value={phoneNumberId} onChange={(event) => onPhoneNumberId(event.target.value)} placeholder="123456789012345" />
      </Field>
      <Field label="WhatsApp Business Account ID">
        <Input value={wabaId} onChange={(event) => onWabaId(event.target.value)} placeholder="opcional" />
      </Field>
      <Field label="Token de acesso">
        <Input
          type="password"
          value={accessToken}
          onChange={(event) => onAccessToken(event.target.value)}
          placeholder={live.officialTokenMasked || "EAAG... token permanente"}
        />
      </Field>

      {live.officialWebhookUrl ? (
        <div className="space-y-1 rounded-xl border border-line bg-sand/50 px-3 py-2 text-xs text-ink-soft">
          <p>
            Webhook: <span className="break-all font-mono text-ink">{live.officialWebhookUrl}</span>
          </p>
          {live.officialVerifyToken ? (
            <p>
              Verify token: <span className="font-mono text-ink">{live.officialVerifyToken}</span>
            </p>
          ) : (
            <p>O verify token aparece depois de salvar.</p>
          )}
          <p>Na Meta: mensagem → Webhook → este URL, campo <span className="font-mono">messages</span>.</p>
        </div>
      ) : null}

      <p className="text-xs text-ink-soft">
        Texto livre só funciona dentro de 24h da última mensagem da cliente. Fora da janela a Meta exige modelo aprovado.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={onSave}>
          <BadgeCheck size={16} />
          {pending ? "Validando..." : connected ? "Salvar e testar de novo" : "Salvar e conectar"}
        </Button>
        {connected ? (
          <Button type="button" variant="danger" disabled={pending} onClick={onDisconnect}>
            <Unplug size={16} />
            Desconectar oficial
          </Button>
        ) : null}
      </div>
    </div>
  );
}
