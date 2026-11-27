import { canAccess, type Access, type PermissionModuleId } from "@/lib/permissions";

export type OnboardingStepId =
  | "salon_profile"
  | "services"
  | "team"
  | "clients"
  | "whatsapp"
  | "agenda";

export type OnboardingTourStatus = "PENDING" | "IN_PROGRESS" | "DISMISSED" | "COMPLETED";

export type OnboardingStep = {
  id: OnboardingStepId;
  index: number;
  module: PermissionModuleId;
  title: string;
  shortTitle: string;
  summary: string;
  checklist: string[];
  href: string;
  navHref: string;
  actionLabel: string;
  secondaryAction?: {
    label: string;
    href: string;
  };
  required: boolean;
  completed: boolean;
  statusDetail: string;
};

export type OnboardingState = {
  salonName: string;
  salonSlug: string;
  canRunTour: boolean;
  tourStatus: OnboardingTourStatus;
  savedStepIndex: number;
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  essentialCompletedCount: number;
  essentialTotalCount: number;
  percent: number;
  allEssentialDone: boolean;
  allDone: boolean;
  nextStepIndex: number;
  shouldAutoOpen: boolean;
  shouldResumeDock: boolean;
};

export type OnboardingBuildInput = {
  salonName: string;
  salonSlug: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  activeServicesCount: number;
  activeProfessionalsCount: number;
  linkedProfessionalsCount: number;
  clientsCount: number;
  appointmentsCount: number;
  whatsappConnected: boolean;
  canRunTour: boolean;
  isImpersonating?: boolean;
  tourStatus?: string | null;
  savedStepIndex?: number | null;
  allowedModules?: PermissionModuleId[] | null;
};

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "IN_PROGRESS",
  "DISMISSED",
  "COMPLETED",
]);

export function normalizeTourStatus(value?: string | null): OnboardingTourStatus {
  if (value && VALID_STATUSES.has(value)) {
    return value as OnboardingTourStatus;
  }
  return "PENDING";
}

export function canRunOnboardingTour(access: Access): boolean {
  if (access.isAdmin) return true;
  return (
    canAccess(access, "settings", "edit") ||
    canAccess(access, "services", "create") ||
    canAccess(access, "team", "create")
  );
}

export function buildOnboardingState(input: OnboardingBuildInput): OnboardingState {
  const hasPhone = Boolean(input.phone?.trim());
  const hasLocation = Boolean(input.city?.trim() || input.address?.trim());
  const hasHours = Boolean(input.openTime?.trim() && input.closeTime?.trim());
  const salonProfileDone = hasPhone && hasLocation && hasHours;

  const missingProfileFields: string[] = [];
  if (!hasPhone) missingProfileFields.push("telefone");
  if (!hasLocation) missingProfileFields.push("cidade/endereço");
  if (!hasHours) missingProfileFields.push("horário");

  const servicesDone = input.activeServicesCount > 0;
  const teamDone = input.activeProfessionalsCount > 0 && input.linkedProfessionalsCount > 0;
  const clientsDone = input.clientsCount > 0;
  const whatsappDone = input.whatsappConnected;
  const agendaDone = input.appointmentsCount > 0;

  const rawSteps: Omit<OnboardingStep, "index">[] = [
    {
      id: "salon_profile",
      module: "settings",
      title: "Dados e horário do salão",
      shortTitle: "Dados do salão",
      summary:
        "Telefone, endereço, cidade e horário de funcionamento alimentam a agenda, o agendamento online, os documentos e os lembretes enviados aos clientes.",
      checklist: [
        "Informe o telefone/WhatsApp principal da empresa",
        "Preencha endereço e cidade para aparecer no agendamento online",
        "Defina horário de abertura e fechamento do salão",
      ],
      href: "/configuracoes",
      navHref: "/configuracoes",
      actionLabel: "Configurar salão",
      required: true,
      completed: salonProfileDone,
      statusDetail: salonProfileDone
        ? `Horário ${input.openTime}–${input.closeTime}${input.city?.trim() ? ` · ${input.city.trim()}` : ""}`
        : `Falta preencher: ${missingProfileFields.join(", ")}`,
    },
    {
      id: "services",
      module: "services",
      title: "Catálogo de serviços e preços",
      shortTitle: "Serviços",
      summary:
        "Os serviços com duração e valor permitem calcular encaixes automáticos na agenda, abrir comandas com preço certo e apurar comissões.",
      checklist: [
        "Cadastre os principais serviços oferecidos pela empresa",
        "Defina duração média, preço e percentual de comissão",
        "Ative o agendamento online nos serviços que o cliente pode reservar",
      ],
      href: "/servicos",
      navHref: "/servicos",
      actionLabel: "Cadastrar serviços",
      required: true,
      completed: servicesDone,
      statusDetail: servicesDone
        ? `${input.activeServicesCount} ${input.activeServicesCount === 1 ? "serviço ativo" : "serviços ativos"}`
        : "Nenhum serviço ativo cadastrado ainda",
    },
    {
      id: "team",
      module: "team",
      title: "Equipe e serviços por profissional",
      shortTitle: "Equipe",
      summary:
        "Cada profissional ativo com serviços vinculados ganha coluna própria na agenda, recebe comissões e fica disponível no agendamento online.",
      checklist: [
        "Cadastre cada profissional da equipe com expediente próprio",
        "Vincule os serviços que cada profissional executa",
        "Defina comissão e acesso ao painel, se necessário",
      ],
      href: "/equipe",
      navHref: "/equipe",
      actionLabel: "Configurar equipe",
      required: true,
      completed: teamDone,
      statusDetail: teamDone
        ? `${input.linkedProfessionalsCount} ${
            input.linkedProfessionalsCount === 1 ? "profissional pronto" : "profissionais prontos"
          } na agenda`
        : input.activeProfessionalsCount > 0
          ? `${input.activeProfessionalsCount} cadastrado(s) — falta vincular serviços`
          : "Nenhum profissional cadastrado ainda",
    },
    {
      id: "clients",
      module: "clients",
      title: "Base de clientes",
      shortTitle: "Clientes",
      summary:
        "Ter os clientes cadastrados com WhatsApp libera histórico completo de atendimentos, pacotes, anamnese e mensagens automáticas.",
      checklist: [
        "Cadastre seus primeiros clientes manualmente ou importe sua planilha",
        "Inclua o número de WhatsApp com DDD para lembretes e confirmações",
      ],
      href: "/clientes",
      navHref: "/clientes",
      actionLabel: "Abrir clientes",
      secondaryAction: {
        label: "Importar planilha Excel",
        href: "/configuracoes?tab=importar",
      },
      required: true,
      completed: clientsDone,
      statusDetail: clientsDone
        ? `${input.clientsCount} ${input.clientsCount === 1 ? "cliente cadastrado" : "clientes cadastrados"}`
        : "Nenhum cliente cadastrado ainda",
    },
    {
      id: "whatsapp",
      module: "settings",
      title: "WhatsApp e notificações automáticas",
      shortTitle: "WhatsApp",
      summary:
        "Conecte o WhatsApp da empresa para enviar confirmações, avisos de alteração ou cancelamento, lembretes e ativar a Recepcionista IA.",
      checklist: [
        "Escaneie o QR Code da Evolution ou informe a API Oficial da Meta",
        "Depois de conectar, ative as campanhas desejadas em Marketing",
      ],
      href: "/configuracoes?tab=whatsapp",
      navHref: "/configuracoes",
      actionLabel: "Conectar WhatsApp",
      secondaryAction: {
        label: "Ver campanhas automáticas",
        href: "/marketing?tab=campanhas",
      },
      required: false,
      completed: whatsappDone,
      statusDetail: whatsappDone ? "WhatsApp conectado e pronto para envios" : "WhatsApp ainda não conectado",
    },
    {
      id: "agenda",
      module: "agenda",
      title: "Agenda, caixa e primeiro agendamento",
      shortTitle: "Agenda",
      summary:
        "Com dados, serviços, equipe e clientes prontos, faça um agendamento teste na agenda e confira suas contas e formas de pagamento.",
      checklist: [
        "Crie seu primeiro agendamento na agenda do dia",
        "Revise contas e taxas de cartão em Cadastros antes de fechar comandas",
        `Compartilhe o link /agendar/${input.salonSlug} com seus clientes`,
      ],
      href: "/agenda",
      navHref: "/agenda",
      actionLabel: "Ir para a agenda",
      secondaryAction: {
        label: "Conferir contas e pagamentos",
        href: "/cadastros",
      },
      required: true,
      completed: agendaDone,
      statusDetail: agendaDone
        ? `${input.appointmentsCount} ${
            input.appointmentsCount === 1 ? "agendamento registrado" : "agendamentos registrados"
          }`
        : "Nenhum agendamento criado ainda",
    },
  ];

  const allowedSet = input.allowedModules ? new Set(input.allowedModules) : null;
  const visibleSteps: OnboardingStep[] = rawSteps
    .filter((step) => !allowedSet || allowedSet.has(step.module))
    .map((step, idx) => ({ ...step, index: idx }));

  const totalCount = visibleSteps.length;
  const completedCount = visibleSteps.filter((step) => step.completed).length;
  const essentialSteps = visibleSteps.filter((step) => step.required);
  const essentialTotalCount = essentialSteps.length;
  const essentialCompletedCount = essentialSteps.filter((step) => step.completed).length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;
  const allEssentialDone = essentialCompletedCount === essentialTotalCount;
  const allDone = completedCount === totalCount;

  const firstPendingIndex = visibleSteps.findIndex((step) => !step.completed);
  const clampedSaved =
    typeof input.savedStepIndex === "number" && Number.isFinite(input.savedStepIndex)
      ? Math.max(0, Math.min(Math.max(0, totalCount - 1), Math.floor(input.savedStepIndex)))
      : 0;
  const nextStepIndex = firstPendingIndex >= 0 ? firstPendingIndex : clampedSaved;

  const tourStatus = normalizeTourStatus(input.tourStatus);
  const eligible = input.canRunTour && !input.isImpersonating && totalCount > 0;
  const shouldAutoOpen = eligible && tourStatus === "PENDING" && !allDone;
  const shouldResumeDock = eligible && tourStatus === "IN_PROGRESS" && !allDone;

  return {
    salonName: input.salonName,
    salonSlug: input.salonSlug,
    canRunTour: eligible,
    tourStatus,
    savedStepIndex: clampedSaved,
    steps: visibleSteps,
    completedCount,
    totalCount,
    essentialCompletedCount,
    essentialTotalCount,
    percent,
    allEssentialDone,
    allDone,
    nextStepIndex,
    shouldAutoOpen,
    shouldResumeDock,
  };
}

export function isLocationMatchingStep(pathname: string, search: string, step: OnboardingStep): boolean {
  const [targetPath, targetQuery] = step.href.split("?");
  if (pathname !== targetPath && !pathname.startsWith(`${targetPath}/`)) {
    return false;
  }
  const currentParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (targetQuery) {
    const targetParams = new URLSearchParams(targetQuery);
    for (const [key, value] of targetParams.entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  }
  // When step targets `/configuracoes` (default `salao` tab), don't match `?tab=whatsapp`
  if (targetPath === "/configuracoes") {
    const tab = currentParams.get("tab");
    return !tab || tab === "salao";
  }
  return true;
}
