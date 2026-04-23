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
