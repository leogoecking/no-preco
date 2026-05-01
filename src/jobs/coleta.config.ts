/**
 * Grupo rotativo legado — mantido como metadado opcional para compat. com
 * possíveis disparos ad-hoc por grupo (`worker.execute({ grupo })`). O
 * scheduler distribuído atual ignora este campo e usa cursor circular.
 */
export type GrupoColeta = 0 | 1;

/** Produto a ser monitorado com suas variações de busca */
export interface ProdutoMonitorado {
  /** Termo enviado para o scraper */
  termo: string;
  /** Rótulo legível para logs */
  label: string;
  /** Grupo opcional (legado). Se ausente, o produto entra no rodízio normal. */
  grupo?: GrupoColeta;
  /** Municípios específicos para este produto (sobrescreve o padrão global) */
  municipios?: string[];
}

export interface ColetaConfig {
  /** Expressão cron do agendamento. Lida pelo WorkerScheduler. */
  cron: string;
  /** Município padrão aplicado a todos os produtos sem municipios[] próprio */
  municipioPadrao: string;
  /** Delay mínimo em ms entre cada tarefa dentro de um mesmo ciclo */
  delayMinMs: number;
  /** Delay máximo em ms entre cada tarefa */
  delayMaxMs: number;
  /**
   * Quantas tarefas (produto×município) cada disparo do scheduler executa.
   * Mantém-se em 1 para distribuir o máximo possível ao longo do dia e
   * minimizar pressão no rate-limit do alvo.
   */
  tarefasPorCiclo: number;
  /** Lista de produtos monitorados */
  produtos: ProdutoMonitorado[];
}

export const coletaConfig: ColetaConfig = {
  cron: process.env['COLETA_CRON'] ?? '*/45 * * * *',
  municipioPadrao: process.env['COLETA_MUNICIPIO'] ?? 'Teixeira de Freitas',
  delayMinMs: 20_000,
  delayMaxMs: 40_000,
  tarefasPorCiclo: Number(process.env['COLETA_TAREFAS_POR_CICLO'] ?? 1),

  produtos: [
    // Cesta básica
    { termo: 'arroz 5kg', label: 'Arroz 5kg' },
    { termo: 'feijão carioca 1kg', label: 'Feijão Carioca 1kg' },
    { termo: 'cafe', label: 'cafe' },
    { termo: 'açúcar cristal 1kg', label: 'Açúcar Cristal 1kg' },
    { termo: 'farinha de trigo 1kg', label: 'Farinha de Trigo 1kg' },
    { termo: 'óleo de soja 900ml', label: 'Óleo de Soja 900ml' },
    { termo: 'macarrão espaguete 500g', label: 'Macarrão Espaguete 500g' },
    { termo: 'sal refinado 1kg', label: 'Sal Refinado 1kg' },
    // Proteínas
    { termo: 'moela', label: 'moela' },
    { termo: 'carne moída kg', label: 'Carne Moída (kg)' },
    { termo: 'ovos dúzia', label: 'Ovos (dúzia)' },
    // Laticínios
    { termo: 'leite integral 1l', label: 'Leite Integral 1L' },
    { termo: 'manteiga 200g', label: 'Manteiga 200g' },
    // Higiene
    { termo: 'sabão em pó 1kg', label: 'Sabão em Pó 1kg' },
    { termo: 'detergente 500ml', label: 'Detergente 500ml' },
    { termo: 'desodorante', label: 'Desodorante' },

    // Verduras e Legumes
    { termo: 'tomate kg', label: 'Tomate (kg)' },
    { termo: 'cenoura kg', label: 'Cenoura (kg)' },
  ],
};
