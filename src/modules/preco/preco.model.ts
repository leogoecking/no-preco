export interface IPreco {
  produto: string;
  preco: number;
  precoAnterior?: number | null;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio?: string | null;
  unidade?: string | null;
  ean?: string | null;
  dataColeta: Date;
  fonte: 'api' | 'html' | 'browser';
}

export interface PrecoRow extends IPreco {
  id: number;
  atualizadoEm: Date;
  criadoEm: Date;
}

export interface HistoricoPrecoRow {
  id: number;
  precoId: number;
  preco: number;
  dataColeta: Date;
  fonte: 'api' | 'html' | 'browser';
  registradoEm: Date;
}

export type Tendencia = 'caindo' | 'subindo' | 'estavel';

export interface ResumoPreco {
  precoMinAtual: number;
  precoMin30d: number;
  precoMedio30d: number;
  /** % de variação do preço mínimo atual vs média dos últimos 30 dias */
  variacaoVsMedia30d: number;
  /** true se precoMinAtual está dentro de 5% do menor preço dos últimos 30 dias */
  ehMinimoHistorico: boolean;
  tendencia: Tendencia;
  /** Últimos 8 pontos de mudança de preço, ordenados do mais antigo ao mais recente */
  sparkline: { preco: number; dataColeta: string }[];
}
