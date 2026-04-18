export interface IPreco {
  produto: string;
  preco: number;
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
  criadoEm: Date;
}
