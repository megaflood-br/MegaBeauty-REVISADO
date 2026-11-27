import { canAccess, type Access, type PermissionModuleId } from "@/lib/permissions";

export type OnboardingPortal = "SALON" | "SUPPLIER" | "PARTNER";

export type OnboardingStepId =
  | "salon_profile"
  | "services"
  | "team"
  | "clients"
  | "whatsapp"
  | "agenda"
  | "supplier_company"
  | "supplier_products"
  | "supplier_promotions"
  | "supplier_orders"
  | "partner_brand"
  | "partner_landing"
  | "partner_payout"
  | "partner_links"
  | "partner_clients"
  | "partner_dashboard";

export type OnboardingTourStatus = "PENDING" | "IN_PROGRESS" | "DISMISSED" | "COMPLETED";

export type OnboardingStep = {
  id: OnboardingStepId;
  index: number;
  module?: PermissionModuleId;
  title: string;
  shortTitle: string;
  summary: string;
  checklist: string[];
  href: string;
  navHref: string;
  exactPath?: boolean;
  actionLabel: string;
  secondaryAction?: {
    label: string;
    href: string;
  };
  required: boolean;
  completed: boolean;
  statusDetail: string;
};

export type OnboardingFeature = {
  id: string;
  category: string;
  title: string;
  description: string;
  href: string;
  navHref: string;
};

export type OnboardingState = {
  portal: OnboardingPortal;
  homeHref: string;
  salonName: string;
  salonSlug: string;
  headline: string;
  subtitle: string;
  bannerHeadline: string;
  bannerSubtitle: string;
  canRunTour: boolean;
  tourStatus: OnboardingTourStatus;
  savedStepIndex: number;
  steps: OnboardingStep[];
  features: OnboardingFeature[];
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

export type SupplierOnboardingBuildInput = {
  companyName: string;
  companySlug: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  servedCitiesCount: number;
  payMethodsCount: number;
  deliveryMinCents: number;
  deliveryFeeCents: number;
  activeProductsCount: number;
  activePromotionsCount: number;
  ordersCount: number;
  isImpersonating?: boolean;
  tourStatus?: string | null;
  savedStepIndex?: number | null;
};

export type PartnerOnboardingBuildInput = {
  brandName: string;
  slug: string;
  commissionBps: number;
  holdDays: number;
  hasLogo: boolean;
  hasCustomHost: boolean;
  customHost?: string | null;
  hasLandingCopy: boolean;
  hasPayoutInfo: boolean;
  referredCount: number;
  paidInvoicesCount: number;
  isImpersonating?: boolean;
  tourStatus?: string | null;
  savedStepIndex?: number | null;
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

function finalizeOnboardingState(params: {
  portal: OnboardingPortal;
  homeHref: string;
  salonName: string;
  salonSlug: string;
  headline: string;
  subtitle: string;
  bannerHeadline: string;
  bannerSubtitle: string;
  steps: Omit<OnboardingStep, "index">[];
  features: OnboardingFeature[];
  canRunTour: boolean;
  isImpersonating?: boolean;
  tourStatus?: string | null;
  savedStepIndex?: number | null;
}): OnboardingState {
  const visibleSteps: OnboardingStep[] = params.steps.map((step, idx) => ({
    ...step,
    index: idx,
  }));

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
    typeof params.savedStepIndex === "number" && Number.isFinite(params.savedStepIndex)
      ? Math.max(0, Math.min(Math.max(0, totalCount - 1), Math.floor(params.savedStepIndex)))
      : 0;
  const nextStepIndex = firstPendingIndex >= 0 ? firstPendingIndex : clampedSaved;

  const tourStatus = normalizeTourStatus(params.tourStatus);
  const eligible = params.canRunTour && !params.isImpersonating && totalCount > 0;
  const shouldAutoOpen = eligible && tourStatus === "PENDING" && !allDone;
  const shouldResumeDock = eligible && tourStatus === "IN_PROGRESS" && !allDone;

  return {
    portal: params.portal,
    homeHref: params.homeHref,
    salonName: params.salonName,
    salonSlug: params.salonSlug,
    headline: params.headline,
    subtitle: params.subtitle,
    bannerHeadline: params.bannerHeadline,
    bannerSubtitle: params.bannerSubtitle,
    canRunTour: eligible,
    tourStatus,
    savedStepIndex: clampedSaved,
    steps: visibleSteps,
    features: params.features,
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

const SALON_FEATURES: (OnboardingFeature & { module: PermissionModuleId })[] = [
  {
    id: "feat_agenda",
    module: "agenda",
    category: "Operação diária",
    title: "Agenda inteligente e bloqueio de horários",
    description:
      "Controle colunas por profissional, duração automática de múltiplos serviços, bloqueios de ausência e link público de agendamento online.",
    href: "/agenda",
    navHref: "/agenda",
  },
  {
    id: "feat_comandas",
    module: "comandas",
    category: "Operação diária",
    title: "Comandas, pacotes e descontos automáticos",
    description:
      "Feche atendimentos com múltiplas formas de pagamento, baixa automática de sessões de pacotes do cliente, crédito e cashback.",
    href: "/comandas",
    navHref: "/comandas",
  },
  {
    id: "feat_pacotes",
    module: "comandas",
    category: "Operação diária",
    title: "Pacotes de serviços e produtos",
    description:
      "Crie combos pré-pagos com validade e saldo por cliente; ao fechar a comanda o sistema reconhece o item e abate automaticamente.",
    href: "/pacotes",
    navHref: "/pacotes",
  },
  {
    id: "feat_ia",
    module: "receptionist",
    category: "Atendimento e IA",
    title: "Recepcionista IA e central de WhatsApp",
    description:
      "Responda clientes 24h no WhatsApp, informe horários livres reais, faça agendamentos automáticos e transfira para humano quando necessário.",
    href: "/recepcionista",
    navHref: "/recepcionista",
  },
  {
    id: "feat_marketing",
    module: "marketing",
    category: "Atendimento e IA",
    title: "Campanhas e avisos automáticos no WhatsApp",
    description:
      "Configure lembretes de agendamento, confirmação, avisos de alteração ou cancelamento, aniversário, retorno e reconquista de clientes.",
    href: "/marketing?tab=campanhas",
    navHref: "/marketing",
  },
  {
    id: "feat_clientes",
    module: "clients",
    category: "Relacionamento",
    title: "Clientes, anamnese digital e documentação (POP)",
    description:
      "Histórico completo de serviços, fichas de anamnese assináveis pelo celular, importação Excel e POPs para vigilância sanitária.",
    href: "/clientes",
    navHref: "/clientes",
  },
  {
    id: "feat_equipe",
    module: "team",
    category: "Gestão e controle",
    title: "Equipe, comissões, metas e permissões",
    description:
      "Defina serviços por profissional, metas individuais, cálculo automático de comissões e perfis de permissão por tela e ação.",
    href: "/permissoes",
    navHref: "/permissoes",
  },
  {
    id: "feat_financeiro",
    module: "finance",
    category: "Gestão e controle",
    title: "Financeiro, estoque, fornecedores e notas fiscais",
    description:
      "Fluxo de caixa com taxas de cartão, controle de estoque com alerta de reposição direto dos fornecedores da sua cidade e emissão fiscal.",
    href: "/financeiro",
    navHref: "/financeiro",
  },
];

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
  const filteredSteps = rawSteps.filter((step) => !allowedSet || !step.module || allowedSet.has(step.module));
  const filteredFeatures: OnboardingFeature[] = SALON_FEATURES.filter(
    (feat) => !allowedSet || allowedSet.has(feat.module),
  ).map((feat) => ({
    id: feat.id,
    category: feat.category,
    title: feat.title,
    description: feat.description,
    href: feat.href,
    navHref: feat.navHref,
  }));

  return finalizeOnboardingState({
    portal: "SALON",
    homeHref: "/dashboard",
    salonName: input.salonName,
    salonSlug: input.salonSlug,
    headline: "Configure o essencial para o sistema funcionar completo",
    subtitle: "Preencha os dados-chave da empresa e conheça todos os recursos disponíveis no seu painel.",
    bannerHeadline: `Complete os dados essenciais de ${input.salonName}`,
    bannerSubtitle:
      "Preencha os itens abaixo para liberar agenda, agendamento online, comandas e mensagens automáticas sem erros.",
    steps: filteredSteps,
    features: filteredFeatures,
    canRunTour: input.canRunTour,
    isImpersonating: input.isImpersonating,
    tourStatus: input.tourStatus,
    savedStepIndex: input.savedStepIndex,
  });
}

const SUPPLIER_FEATURES: OnboardingFeature[] = [
  {
    id: "sup_feat_catalog",
    category: "Catálogo B2B",
    title: "Vitrine profissional de produtos",
    description:
      "Cadastre produtos com foto, marca, SKU, unidade, preço de atacado, pedido mínimo e controle de estoque em tempo real para os salões.",
    href: "/fornecedor",
    navHref: "/fornecedor",
  },
  {
    id: "sup_feat_restock",
    category: "Vendas inteligentes",
    title: "Alertas automáticos de reposição nos salões",
    description:
      "Quando um salão atendido fica com estoque baixo de um item compatível com o seu catálogo, o sistema sugere seu produto direto no painel dele.",
    href: "/fornecedor",
    navHref: "/fornecedor",
  },
  {
    id: "sup_feat_promos",
    category: "Vendas inteligentes",
    title: "Promoções e combos em destaque",
    description:
      "Crie ofertas por percentual, preço fixo ou combos (ex.: Leve 5, pague 3) com vigência por período e dias da semana exibidas no painel dos salões.",
    href: "/fornecedor/promocoes",
    navHref: "/fornecedor/promocoes",
  },
  {
    id: "sup_feat_orders",
    category: "Operação de pedidos",
    title: "Central de pedidos com entrega ou retirada",
    description:
      "Receba pedidos dos salões, confirme, separe, acompanhe entregas ou libere retirada no balcão com código exclusivo — e o estoque do salão é atualizado ao receber.",
    href: "/fornecedor/pedidos",
    navHref: "/fornecedor/pedidos",
  },
  {
    id: "sup_feat_geo",
    category: "Logística e cobertura",
    title: "Cobertura por cidades, frete e meios de pagamento",
    description:
      "Defina quais cidades você atende, endereço de retirada, pedido mínimo, taxa de entrega e formas de pagamento aceitas (Pix, dinheiro, cartão ou boleto).",
    href: "/fornecedor/empresa",
    navHref: "/fornecedor/empresa",
  },
];

export function buildSupplierOnboardingState(input: SupplierOnboardingBuildInput): OnboardingState {
  const hasPhone = Boolean(input.phone?.trim());
  const hasLocation = Boolean(input.city?.trim() || input.address?.trim());
  const hasServedCities = input.servedCitiesCount > 0;
  const hasPayMethods = input.payMethodsCount > 0;
  const companyDone = hasPhone && hasLocation && hasServedCities && hasPayMethods;

  const missingCompany: string[] = [];
  if (!hasPhone) missingCompany.push("telefone");
  if (!hasLocation) missingCompany.push("cidade/endereço");
  if (!hasServedCities) missingCompany.push("cidades atendidas");
  if (!hasPayMethods) missingCompany.push("formas de pagamento");

  const productsDone = input.activeProductsCount > 0;
  const promosDone = input.activePromotionsCount > 0;
  const ordersDone = input.ordersCount > 0;

  const steps: Omit<OnboardingStep, "index">[] = [
    {
      id: "supplier_company",
      title: "Dados da empresa, entrega e cidades atendidas",
      shortTitle: "Dados e cobertura",
      summary:
        "Os salões só visualizam seu catálogo e promoções quando sua cidade base, regiões atendidas, telefone, regras de entrega e formas de pagamento estão configurados.",
      checklist: [
        "Preencha telefone, endereço de retirada e cidade da distribuidora",
        "Adicione todas as cidades atendidas para aparecer nos salões da região",
        "Configure pedido mínimo, taxa de entrega e formas de pagamento aceitas",
      ],
      href: "/fornecedor/empresa",
      navHref: "/fornecedor/empresa",
      actionLabel: "Configurar empresa",
      required: true,
      completed: companyDone,
      statusDetail: companyDone
        ? `${input.servedCitiesCount} ${input.servedCitiesCount === 1 ? "cidade atendida" : "cidades atendidas"} · ${input.payMethodsCount} forma(s) de pagamento`
        : `Falta preencher: ${missingCompany.join(", ")}`,
    },
    {
      id: "supplier_products",
      title: "Catálogo de produtos profissionais",
      shortTitle: "Produtos",
      summary:
        "Cadastre os produtos com foto, marca, SKU, preço e estoque. O sistema cruza automaticamente seus itens com o estoque baixo dos salões da sua região.",
      checklist: [
        "Cadastre seus produtos ativos com marca, unidade e preço",
        "Informe estoque disponível e quantidade mínima por pedido",
        "Adicione foto e descrição para destacar sua vitrine no marketplace",
      ],
      href: "/fornecedor",
      navHref: "/fornecedor",
      exactPath: true,
      actionLabel: "Cadastrar produtos",
      required: true,
      completed: productsDone,
      statusDetail: productsDone
        ? `${input.activeProductsCount} ${input.activeProductsCount === 1 ? "produto ativo" : "produtos ativos"} no catálogo`
        : "Nenhum produto ativo cadastrado ainda",
    },
    {
      id: "supplier_promotions",
      title: "Promoções e combos em destaque",
      shortTitle: "Promoções",
      summary:
        "Crie campanhas promocionais (percentual, preço promocional ou Leve X, pague Y). Ofertas ativas aparecem automaticamente em destaque no painel dos salões atendidos.",
      checklist: [
        "Escolha o tipo de oferta (desconto %, preço fixo ou combo Leve/Pague)",
        "Selecione período de validade, dias da semana e produtos participantes",
      ],
      href: "/fornecedor/promocoes",
      navHref: "/fornecedor/promocoes",
      actionLabel: "Criar promoção",
      required: false,
      completed: promosDone,
      statusDetail: promosDone
        ? `${input.activePromotionsCount} ${input.activePromotionsCount === 1 ? "promoção ativa" : "promoções ativas"}`
        : "Nenhuma promoção ativa — opcional para destacar sua marca",
    },
    {
      id: "supplier_orders",
      title: "Central de pedidos, entregas e retiradas",
      shortTitle: "Pedidos",
      summary:
        "Acompanhe todos os pedidos enviados pelos salões, aprove, separe, informe saída para entrega ou valide o código de retirada no balcão.",
      checklist: [
        "Confira novos pedidos recebidos dos salões da sua região",
        "Atualize o status (Confirmado, Separando, Em entrega/Pronto para retirada)",
        "Ao confirmar a entrega, o salão recebe os itens direto no estoque",
      ],
      href: "/fornecedor/pedidos",
      navHref: "/fornecedor/pedidos",
      actionLabel: "Abrir central de pedidos",
      required: false,
      completed: ordersDone,
      statusDetail: ordersDone
        ? `${input.ordersCount} ${input.ordersCount === 1 ? "pedido registrado" : "pedidos registrados"}`
        : "Nenhum pedido recebido ainda — pronto para operar assim que um salão comprar",
    },
  ];

  return finalizeOnboardingState({
    portal: "SUPPLIER",
    homeHref: "/fornecedor",
    salonName: input.companyName,
    salonSlug: input.companySlug,
    headline: "Prepare sua distribuidora e conheça o Portal do Fornecedor",
    subtitle: "Configure cobertura, catálogo e promoções para vender direto para os salões da sua região.",
    bannerHeadline: `Complete o perfil de fornecedor de ${input.companyName}`,
    bannerSubtitle:
      "Defina cidades atendidas, regras de entrega e cadastre seus produtos para aparecer automaticamente nos salões da região.",
    steps,
    features: SUPPLIER_FEATURES,
    canRunTour: true,
    isImpersonating: input.isImpersonating,
    tourStatus: input.tourStatus,
    savedStepIndex: input.savedStepIndex,
  });
}

function partnerFeatures(commissionPctLabel: string, holdDays: number): OnboardingFeature[] {
  return [
    {
      id: "part_feat_brand",
      category: "Marca própria (White-label)",
      title: "Sistema inteiro com a sua identidade visual",
      description:
        "Personalize nome do produto, logo clara e escura, favicon e paleta de cores. Cada salão indicado acessa o CRM exibindo a sua marca.",
      href: "/parceiro/aparencia",
      navHref: "/parceiro/aparencia",
    },
    {
      id: "part_feat_landing",
      category: "Captação e vendas",
      title: "Landing page comercial editável",
      description:
        "Publique uma página de vendas exclusiva com sua chamada, benefícios, imagem de capa e botão de cadastro já vinculado à sua conta de parceiro.",
      href: "/parceiro/landing",
      navHref: "/parceiro/landing",
    },
    {
      id: "part_feat_links",
      category: "Captação e vendas",
      title: "Links rastreáveis, subdomínio e domínio próprio",
      description:
        "Compartilhe sua landing page, link de indicação (?ref=), subdomínio ou aponte um domínio próprio via CNAME com atribuição vitalícia (first-touch).",
      href: "/parceiro/links",
      navHref: "/parceiro/links",
    },
    {
      id: "part_feat_clients",
      category: "Carteira e conversão",
      title: "Gestão dos salões indicados",
      description:
        "Acompanhe todos os salões que se cadastraram pelos seus links, status de teste ou assinatura ativa e evolução da taxa de conversão.",
      href: "/parceiro/clientes",
      navHref: "/parceiro/clientes",
    },
    {
      id: "part_feat_finance",
      category: "Comissões recorrentes",
      title: `Comissão recorrente de ${commissionPctLabel} e repasses via Pix`,
      description:
        `Receba ${commissionPctLabel} sobre toda fatura paga pelos salões indicados, com liberação automática após ${holdDays} dias, extrato transparente e histórico de repasses.`,
      href: "/parceiro/financeiro",
      navHref: "/parceiro/financeiro",
    },
    {
      id: "part_feat_dashboard",
      category: "Comissões recorrentes",
      title: "Painel executivo de resultados",
      description:
        "Visualize total ganho, saldo disponível para saque, valores a receber, clientes ativos, conversão e evolução mensal das suas comissões.",
      href: "/parceiro",
      navHref: "/parceiro",
    },
  ];
}

export function buildPartnerOnboardingState(input: PartnerOnboardingBuildInput): OnboardingState {
  const commissionPct = `${(input.commissionBps / 100).toFixed(input.commissionBps % 100 === 0 ? 0 : 1)}%`;
  const brandDone = Boolean(input.brandName.trim() && input.hasLogo);
  const landingDone = input.hasLandingCopy;
  const payoutDone = input.hasPayoutInfo;
  const linksDone = input.hasCustomHost || input.referredCount > 0;
  const clientsDone = input.referredCount > 0;
  const dashboardDone = input.paidInvoicesCount > 0 || input.referredCount > 0;

  const steps: Omit<OnboardingStep, "index">[] = [
    {
      id: "partner_brand",
      title: "Marca do sistema (White-label)",
      shortTitle: "Marca própria",
      summary:
        "Configure o nome da sua marca, logos (clara e escura), favicon, cores e domínio próprio para que os salões indicados usem o sistema com a cara da sua empresa.",
      checklist: [
        "Defina o nome comercial e as cores primária e secundária da sua marca",
        "Envie a logo para fundo claro, fundo escuro e o favicon",
        "Opcional: informe um domínio próprio (CNAME) para rodar sem referência externa",
      ],
      href: "/parceiro/aparencia",
      navHref: "/parceiro/aparencia",
      actionLabel: "Configurar marca",
      required: true,
      completed: brandDone,
      statusDetail: brandDone
        ? input.hasCustomHost && input.customHost
          ? `Marca configurada · domínio ${input.customHost}`
          : "Marca e logo configuradas"
        : "Falta enviar a logo da sua marca em Marca do sistema",
    },
    {
      id: "partner_landing",
      title: "Personalize sua Landing page de vendas",
      shortTitle: "Landing page",
      summary:
        "Sua página comercial pronta para divulgar nas redes e no WhatsApp. Todo salão que clicar e criar conta por ela fica vinculado vitaliciamente a você.",
      checklist: [
        "Ajuste título principal, descrição e texto do botão de cadastro",
        "Envie uma imagem de destaque e revise a lista de diferenciais",
        "Abra a prévia da página para validar o visual antes de divulgar",
      ],
      href: "/parceiro/landing",
      navHref: "/parceiro/landing",
      actionLabel: "Editar landing page",
      required: true,
      completed: landingDone,
      statusDetail: landingDone
        ? "Textos da landing page personalizados"
        : "Usando textos padrão — personalize para sua oferta comercial",
    },
    {
      id: "partner_payout",
      title: "Dados bancários e Pix para receber comissões",
      shortTitle: "Financeiro / Pix",
      summary:
        `Você recebe ${commissionPct} sobre toda fatura paga pelos salões indicados (liberação em ${input.holdDays} dias). Cadastre sua chave Pix ou conta bancária para receber os repasses.`,
      checklist: [
        "Informe sua chave Pix e o tipo (CPF, CNPJ, e-mail, telefone ou aleatória)",
        "Opcional: preencha banco, agência e conta para conferência",
        "Acompanhe o extrato de comissões e comprovantes de repasse nesta tela",
      ],
      href: "/parceiro/financeiro",
      navHref: "/parceiro/financeiro",
      actionLabel: "Cadastrar Pix / banco",
      required: true,
      completed: payoutDone,
      statusDetail: payoutDone
        ? "Dados de recebimento configurados"
        : "Falta cadastrar sua chave Pix ou conta bancária",
    },
    {
      id: "partner_links",
      title: "Seus links de indicação e domínio próprio",
      shortTitle: "Meus links",
      summary:
        "Copie sua Landing Page personalizada, seu link direto de indicação ou configure domínio próprio/subdomínio. A atribuição first-touch garante sua comissão recorrente.",
      checklist: [
        "Copie o link da sua Landing page para campanhas, bio e WhatsApp",
        "Use o link de indicação direta para enviar salões direto ao cadastro",
        "Se configurou domínio próprio, valide o apontamento CNAME",
      ],
      href: "/parceiro/links",
      navHref: "/parceiro/links",
      actionLabel: "Abrir meus links",
      required: false,
      completed: linksDone,
      statusDetail: input.hasCustomHost && input.customHost
        ? `Domínio próprio ativo: ${input.customHost}`
        : `Links prontos com o identificador /p/${input.slug}`,
    },
    {
      id: "partner_clients",
      title: "Carteira de clientes indicados",
      shortTitle: "Clientes",
      summary:
        "Monitore cada salão que se cadastrou pelo seu link: veja quem está em período de teste, quem já virou assinante ativo e acompanhe o momento certo de ajudar na conversão.",
      checklist: [
        "Acompanhe novos cadastros vindos dos seus links",
        "Identifique salões em teste para apoiar a ativação da assinatura",
      ],
      href: "/parceiro/clientes",
      navHref: "/parceiro/clientes",
      actionLabel: "Ver clientes",
      required: false,
      completed: clientsDone,
      statusDetail: clientsDone
        ? `${input.referredCount} ${input.referredCount === 1 ? "salão indicado" : "salões indicados"}`
        : "Nenhum salão indicado ainda — compartilhe seus links para começar",
    },
    {
      id: "partner_dashboard",
      title: "Painel de comissões e taxa de conversão",
      shortTitle: "Painel",
      summary:
        "No Painel principal você acompanha em um só lugar total ganho, saldo disponível para saque, valores a receber, clientes ativos, conversão e histórico mensal.",
      checklist: [
        "Acompanhe a evolução mensal de comissões recorrentes",
        "Monitore sua taxa de conversão de testes para salões pagantes",
      ],
      href: "/parceiro",
      navHref: "/parceiro",
      exactPath: true,
      actionLabel: "Ver painel de resultados",
      required: false,
      completed: dashboardDone,
      statusDetail:
        input.paidInvoicesCount > 0
          ? `${input.paidInvoicesCount} fatura(s) paga(s) gerando comissão`
          : `Comissão configurada em ${commissionPct} por fatura paga`,
    },
  ];

  return finalizeOnboardingState({
    portal: "PARTNER",
    homeHref: "/parceiro",
    salonName: input.brandName,
    salonSlug: input.slug,
    headline: "Configure sua operação white-label e conheça o Portal do Parceiro",
    subtitle: `Personalize sua marca, landing page e dados Pix para começar a ganhar ${commissionPct} de comissão recorrente.`,
    bannerHeadline: `Finalize a configuração do parceiro ${input.brandName}`,
    bannerSubtitle:
      "Deixe sua marca, landing page e chave Pix prontas para divulgar seus links e acompanhar salões indicados e comissões.",
    steps,
    features: partnerFeatures(commissionPct, input.holdDays),
    canRunTour: true,
    isImpersonating: input.isImpersonating,
    tourStatus: input.tourStatus,
    savedStepIndex: input.savedStepIndex,
  });
}

export function isLocationMatchingStep(pathname: string, search: string, step: OnboardingStep): boolean {
  const [targetPath, targetQuery] = step.href.split("?");
  const matchesPath = step.exactPath
    ? pathname === targetPath
    : pathname === targetPath || pathname.startsWith(`${targetPath}/`);
  if (!matchesPath) {
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
