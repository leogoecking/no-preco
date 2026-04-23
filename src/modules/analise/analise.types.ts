// ─────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────

export interface ItemCarrinho {
  /** Termo de busca — deve corresponder ao campo `produto` no banco */
  produto: string;
  /** Multiplicador (padrão 1) */
  quantidade?: number;
}

export interface AnaliseInput {
  itens: ItemCarrinho[];
  municipio?: string;
}

// ─────────────────────────────────────────────
// Estrutura interna: matriz de preços
// produto → mercado → melhor oferta
// ─────────────────────────────────────────────

export interface Oferta {
  preco: number;
  mercado: string;
  cnpj: string;
  unidade?: string;
  dataColeta: Date;
}

/** Map<produto_normalizado, Map<mercado, Oferta>> */
export type MatrizPrecos = Map<string, Map<string, Oferta>>;

// ─────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────

export interface ItemResultado {
  produto: string;
  quantidade: number;
  preco: number;
  subtotal: number;
  unidade?: string;
}

export interface OpcaoMercadoUnico {
  mercado: string;
  cnpj: string;
  total: number;
  cobertura: number;
  itensEncontrados: number;
  itens: ItemResultado[];
  itensFaltantes: string[];
}

export interface ItemCombinacao extends ItemResultado {
  mercado: string;
  cnpj: string;
}

/** Usado internamente para consolidar por mercado antes de extrair string[] */
export interface ResumoPorMercado {
  mercado: string;
  cnpj: string;
  subtotal: number;
  itens: string[];
}

export interface OpcaoCombinacao {
  total: number;
  mercadosNecessarios: number;
  mercados: string[];
  itens: ItemCombinacao[];
  itensFaltantes: string[];
}

export type Recomendacao = 'mercado_unico' | 'combinacao' | 'sem_dados';

export interface Decisao {
  recomendacao: Recomendacao;
  motivo: string;
  economia: number;
  economiaPercent: number;
}

export interface ResultadoAnalise {
  geradoEm: string;
  municipio?: string;
  totalItensNaLista: number;
  naoEncontradosEmNenhumMercado: string[];
  mercadoUnico: OpcaoMercadoUnico | null;
  combinacao: OpcaoCombinacao;
  decisao: Decisao;
}
