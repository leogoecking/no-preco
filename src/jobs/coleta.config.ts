/** Produto a ser monitorado com suas variações de busca */
export interface ProdutoMonitorado {
  /** Termo enviado para o scraper */
  termo: string;
  /** Rótulo legível para logs */
  label: string;
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
  delayMinMs: 5_000,
  delayMaxMs: 10_000,

  produtos: [
    // Cesta básica
    { termo: 'arroz 5kg', label: 'Arroz 5kg' },
    { termo: 'feijão carioca 1kg', label: 'Feijão Carioca 1kg' },
    { termo: 'feijão preto 1kg', label: 'Feijão Preto 1kg' },
    { termo: 'açúcar cristal 1kg', label: 'Açúcar Cristal 1kg' },
    { termo: 'farinha de trigo 1kg', label: 'Farinha de Trigo 1kg' },
    { termo: 'óleo de soja 900ml', label: 'Óleo de Soja 900ml' },
    { termo: 'macarrão espaguete 500g', label: 'Macarrão Espaguete 500g' },
    { termo: 'sal refinado 1kg', label: 'Sal Refinado 1kg' },
    // Proteínas
    { termo: 'frango inteiro kg', label: 'Frango Inteiro (kg)' },
    { termo: 'carne moída kg', label: 'Carne Moída (kg)' },
    { termo: 'ovos dúzia', label: 'Ovos (dúzia)' },
    // Laticínios
    { termo: 'leite integral 1l', label: 'Leite Integral 1L' },
    { termo: 'manteiga 200g', label: 'Manteiga 200g' },
    // Higiene
    { termo: 'sabão em pó 1kg', label: 'Sabão em Pó 1kg' },
    { termo: 'detergente 500ml', label: 'Detergente 500ml' },
  ],
};
