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
  precoUnitario: number;
  subtotal: number;
  unidade?: string;
}

export interface OpcaoMercadoUnico {
  mercado: string;
  cnpj: string;
  totalCarrinho: number;
  cobertura: number;
  itensCobertos: ItemResultado[];
  itensFaltantes: string[];
}

export interface ItemCombinacao extends ItemResultado {
  mercado: string;
  cnpj: string;
}

export interface ResumoPorMercado {
  mercado: string;
  cnpj: string;
  subtotal: number;
  itens: string[];
}

export interface OpcaoCombinacao {
  totalCarrinho: number;
  mercadosNecessarios: number;
  itens: ItemCombinacao[];
  resumoPorMercado: ResumoPorMercado[];
  itensFaltantes: string[];
}

export type Recomendacao = 'MERCADO_UNICO' | 'COMBINACAO' | 'SEM_DADOS';

export interface Decisao {
  recomendacao: Recomendacao;
  motivo: string;
  economiaAbsoluta: number;
  economiaPercent: number;
}

export interface ResultadoAnalise {
  geradoEm: string;
  municipio?: string;
  totalItensNaLista: number;
  naoEncontradosEmNenhumMercado: string[];
  opcao1_mercadoUnico: OpcaoMercadoUnico | null;
  opcao2_combinacaoOtima: OpcaoCombinacao;
  decisao: Decisao;
}
