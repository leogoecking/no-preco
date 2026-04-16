/** Produto com preço retornado pelo scraper */
export interface ProdutoPreco {
  nome: string;
  preco: number;
  mercado: string;
  cnpj: string;
  cidade?: string;
  municipio?: string;
  dataColeta?: string;
  unidade?: string;
}

/** Parâmetros aceitos pelo service de busca */
export interface BuscaParams {
  termo: string;
  /**
   * Nome legível do município (ex: "Salvador").
   * Usado como fallback no HTML e para popular o campo `municipio` do retorno.
   */
  municipio?: string;
  /**
   * Código IBGE do município (ex: 2927408 para Salvador).
   * Quando fornecido, é enviado como `codmun` na API JSON — forma que o site
   * realmente aceita para filtrar por cidade com precisão.
   * Se omitido, a busca retorna resultados de todo o estado.
   */
  municipioId?: number;
  pagina?: number;
}

/** Resultado paginado */
export interface ResultadoBusca {
  termo: string;
  /**
   * Nome do município resolvido (vem da resposta da API, ou de `params.municipio`
   * como fallback) — salvo no banco para rastreabilidade.
   */
  municipio?: string;
  /** Código IBGE enviado na requisição, quando disponível. */
  municipioId?: number;
  pagina: number;
  totalItens: number;
  itens: ProdutoPreco[];
}

/** Erro estruturado do scraper */
export interface ScraperError {
  tipo: 'BLOQUEIO_403' | 'TIMEOUT' | 'PARSE_FALHOU' | 'SEM_RESULTADOS' | 'ERRO_REDE';
  mensagem: string;
  detalhes?: string;
  urlTentada?: string;
}
