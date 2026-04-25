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
  ean?: string;
}

/** Parâmetros aceitos pelo service de busca */
export interface BuscaParams {
  termo: string;
  /**
   * Nome legível do município (ex: "Teixeira de Freitas").
   * Usado como fallback no HTML e para popular o campo `municipio` do retorno.
   */
  municipio?: string;
  /**
   * Código IBGE do município (ex: 2931350 para Teixeira de Freitas).
   * Quando fornecido, é enviado como `codmun` na API JSON — forma que o site
   * realmente aceita para filtrar por cidade com precisão.
   * Se omitido, a busca retorna resultados de todo o estado.
   */
  municipioId?: number;
  pagina?: number;
  /** Quando fornecido, substitui `termo` na requisição — busca exata por código de barras */
  ean?: string;
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
  tipo:
    | 'BLOQUEIO_403'
    | 'BLOQUEIO_429'
    | 'TIMEOUT'
    | 'PARSE_FALHOU'
    | 'SEM_RESULTADOS'
    | 'ERRO_REDE'
    | 'BROWSER_INDISPONIVEL';
  mensagem: string;
  detalhes?: string;
  urlTentada?: string;
}
