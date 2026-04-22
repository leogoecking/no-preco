/** Índice do grupo rotativo — cicla a cada 6h para reduzir pressão no servidor. */
export type GrupoColeta = 0 | 1;

/** Produto a ser monitorado com suas variações de busca */
export interface ProdutoMonitorado {
  /** Termo enviado para o scraper */
  termo: string;
  /** Rótulo legível para logs */
  label: string;
  /** Grupo rotativo (0 ou 1) — divide a carga em disparos alternados. */
  grupo: GrupoColeta;
  /** Municípios específicos para este produto (sobrescreve o padrão global) */
  municipios?: string[];
}

export interface ColetaConfig {
  /** Expressão cron do agendamento (padrão: toda hora) */
  cron: string;
  /** Município padrão aplicado a todos os produtos sem municipios[] próprio */
  municipioPadrao: string;
  /** Delay mínimo em ms entre cada produto (proteção anti-ban) */
  delayMinMs: number;
  /** Delay máximo em ms entre cada produto */
  delayMaxMs: number;
  /** Lista de produtos monitorados */
  produtos: ProdutoMonitorado[];
}

export const coletaConfig: ColetaConfig = {
  cron: process.env['COLETA_CRON'] ?? '0 * * * *',
  municipioPadrao: process.env['COLETA_MUNICIPIO'] ?? 'Teixeira de Freitas',
  delayMinMs: 20_000,
  delayMaxMs: 40_000,

  produtos: [
    // Cesta básica
    { termo: 'arroz 5kg', label: 'Arroz 5kg', grupo: 0 },
    { termo: 'feijão carioca 1kg', label: 'Feijão Carioca 1kg', grupo: 1 },
    { termo: 'cafe', label: 'cafe', grupo: 0 },
    { termo: 'açúcar cristal 1kg', label: 'Açúcar Cristal 1kg', grupo: 1 },
    { termo: 'farinha de trigo 1kg', label: 'Farinha de Trigo 1kg', grupo: 0 },
    { termo: 'óleo de soja 900ml', label: 'Óleo de Soja 900ml', grupo: 1 },
    { termo: 'macarrão espaguete 500g', label: 'Macarrão Espaguete 500g', grupo: 0 },
    { termo: 'sal refinado 1kg', label: 'Sal Refinado 1kg', grupo: 1 },
    // Proteínas
    { termo: 'moela', label: 'moela', grupo: 0 },
    { termo: 'carne moída kg', label: 'Carne Moída (kg)', grupo: 1 },
    { termo: 'ovos dúzia', label: 'Ovos (dúzia)', grupo: 0 },
    // Laticínios
    { termo: 'leite integral 1l', label: 'Leite Integral 1L', grupo: 1 },
    { termo: 'manteiga 200g', label: 'Manteiga 200g', grupo: 0 },
    // Higiene
    { termo: 'sabão em pó 1kg', label: 'Sabão em Pó 1kg', grupo: 1 },
    { termo: 'detergente 500ml', label: 'Detergente 500ml', grupo: 0 },
    { termo: 'desodorante', label: 'Desodorante', grupo: 1 },

    // Verduras e Legumes
    { termo: 'tomate kg', label: 'Tomate (kg)', grupo: 1 },
    { termo: 'cenoura kg', label: 'Cenoura (kg)', grupo: 0 },
  ],
};
