export const PLATFORM_MODULES = [
  {
    key: "packages",
    label: "Pacotes de Serviços e Produtos",
    group: "Salão",
    description: "Venda de pacotes com múltiplas sessões/itens, controle de saldo do cliente e baixa automática nas comandas.",
    areaHint: "/pacotes e /comandas",
  },
  {
    key: "reopenComandas",
    label: "Reabertura de Comandas Fechadas",
    group: "Salão",
    description: "Permite que administradores reabram comandas fechadas com estorno seguro de caixa, estoque, comissões e pacotes.",
    areaHint: "/comandas",
  },
  {
    key: "agendaBlocks",
    label: "Bloqueio de Horários na Agenda",
    group: "Salão",
    description: "Criação e gestão de bloqueios de agenda por profissional (almoço, folga, compromisso) na grade diária.",
    areaHint: "/agenda",
  },
  {
    key: "aiMarketingStudio",
    label: "Estúdio de Artes com IA",
    group: "Salão",
    description: "Geração automática de artes promocionais e legendas puxando serviços, preços, datas e marca do salão.",
    areaHint: "/marketing (Estúdio IA)",
  },
  {
    key: "instagramPublish",
    label: "Publicação Direta no Instagram",
    group: "Salão",
    description: "Conexão OAuth da conta Instagram Business do salão e postagem direta no Feed e nos Stories pela plataforma.",
    areaHint: "/marketing (Estúdio IA)",
  },
  {
    key: "webImageSearch",
    label: "Busca Automática de Fotos na Internet",
    group: "Global",
    description: "Pesquisa direta de imagens na internet (sem gastar tokens de IA) ao cadastrar serviços, estoque e catálogo do fornecedor.",
    areaHint: "/servicos, /estoque e /fornecedor",
  },
  {
    key: "onboardingTours",
    label: "Tour de Primeiros Acessos",
    group: "Global",
    description: "Guias interativos passo a passo para novos salões, fornecedores e parceiros na primeira visita.",
    areaHint: "Salão, Fornecedor e Parceiro",
  },
  {
    key: "supplierBulkImport",
    label: "Importação em Massa (Planilha e XML NF-e)",
    group: "Fornecedor",
    description: "Importação de catálogo de fornecedores via Excel/CSV de qualquer ERP ou arquivos XML de Nota Fiscal (NF-e).",
    areaHint: "/fornecedor",
  },
  {
    key: "partnerMarketingDrive",
    label: "Drive de Marketing para Parceiros",
    group: "Parceiro",
    description: "Biblioteca de artes, vídeos e PDFs enviados pela plataforma para os parceiros baixarem com aplicação automática do próprio logo.",
    areaHint: "/plataforma/materiais e /parceiro/materiais",
  },
] as const;

export type PlatformModuleDef = (typeof PLATFORM_MODULES)[number];
export type PlatformModuleKey = PlatformModuleDef["key"];
export type PlatformModuleGroup = PlatformModuleDef["group"];
export type PlatformModulesConfig = Record<PlatformModuleKey, boolean>;

export const PLATFORM_MODULE_GROUPS: PlatformModuleGroup[] = [
  "Salão",
  "Fornecedor",
  "Parceiro",
  "Global",
];

export function defaultPlatformModules(): PlatformModulesConfig {
  return {
    packages: true,
    reopenComandas: true,
    agendaBlocks: true,
    aiMarketingStudio: true,
    instagramPublish: true,
    webImageSearch: true,
    onboardingTours: true,
    supplierBulkImport: true,
    partnerMarketingDrive: true,
  };
}

export function isPlatformModuleKey(value: string): value is PlatformModuleKey {
  return PLATFORM_MODULES.some((item) => item.key === value);
}

export function parsePlatformModules(raw: string | null | undefined): PlatformModulesConfig {
  const base = defaultPlatformModules();
  if (!raw || typeof raw !== "string") return base;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
    const record = parsed as Record<string, unknown>;
    for (const def of PLATFORM_MODULES) {
      if (typeof record[def.key] === "boolean") {
        base[def.key] = record[def.key] as boolean;
      }
    }
  } catch {
    return base;
  }
  return base;
}

export function serializePlatformModules(
  current: PlatformModulesConfig,
  patch?: Partial<Record<PlatformModuleKey, boolean>>,
): string {
  const next: PlatformModulesConfig = { ...defaultPlatformModules(), ...current };
  if (patch) {
    for (const def of PLATFORM_MODULES) {
      if (typeof patch[def.key] === "boolean") {
        next[def.key] = patch[def.key] as boolean;
      }
    }
  }
  return JSON.stringify(next);
}

export function isModuleEnabled(config: PlatformModulesConfig, key: PlatformModuleKey): boolean {
  return config[key] !== false;
}

export function countEnabledModules(config: PlatformModulesConfig): { enabled: number; total: number } {
  const total = PLATFORM_MODULES.length;
  let enabled = 0;
  for (const def of PLATFORM_MODULES) {
    if (config[def.key] !== false) enabled += 1;
  }
  return { enabled, total };
}

export function moduleDisabledMessage(key: PlatformModuleKey): string {
  const def = PLATFORM_MODULES.find((item) => item.key === key);
  const name = def ? def.label : "Este módulo";
  return `${name} está desativado pelo administrador da plataforma.`;
}
