import { requireTenant } from "@/lib/tenant";
import { canManageSettings } from "@/lib/auth";
import { Button, Card, Field, Input } from "@/components/ui";
import { saveSettings } from "@/app/actions/settings";
import { formAction } from "@/lib/utils";

export default async function ConfigPage() {
  const { session, tenant } = await requireTenant();
  if (!canManageSettings(session.role)) {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-3xl">Configurações do salão</h1>
        <p className="text-ink-soft">Somente proprietários e gerentes podem alterar as configurações.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="font-display text-3xl">Configurações do salão</h1>
      <Card>
        <form action={formAction(saveSettings)} className="grid gap-3">
          <Field label="Nome">
            <Input name="name" defaultValue={tenant.name} />
          </Field>
          <Field label="Nome fantasia">
            <Input name="tradeName" defaultValue={tenant.tradeName ?? ""} />
          </Field>
          <Field label="Telefone">
            <Input name="phone" defaultValue={tenant.phone ?? ""} />
          </Field>
          <Field label="E-mail">
            <Input name="email" defaultValue={tenant.email ?? ""} />
          </Field>
          <Field label="Endereço">
            <Input name="address" defaultValue={tenant.address ?? ""} />
          </Field>
          <Field label="Cidade">
            <Input name="city" defaultValue={tenant.city ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Abre">
              <Input name="openTime" type="time" defaultValue={tenant.openTime} />
            </Field>
            <Field label="Fecha">
              <Input name="closeTime" type="time" defaultValue={tenant.closeTime} />
            </Field>
          </div>
          <Field label="Lembrete (horas antes)">
            <Input name="reminderHours" type="number" defaultValue={tenant.reminderHours} />
          </Field>
          <Field label="Chave OpenAI (por salão)">
            <Input
              name="openaiApiKey"
              type="password"
              defaultValue=""
              autoComplete="new-password"
              placeholder={tenant.openaiApiKey ? "•••••••• (configurada — deixe em branco para manter)" : "sk-..."}
            />
          </Field>
          <p className="text-xs text-ink-soft">
            Link de agendamento online: <code>/agendar/{tenant.slug}</code>
          </p>
          <Button>Salvar</Button>
        </form>
      </Card>
    </div>
  );
}
