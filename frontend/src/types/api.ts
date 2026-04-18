export interface ItemPreco {
  produto: string
  preco: number
  mercado: string
  cnpj?: string
  cidade: string
  municipio?: string
  unidade?: string
  dataColeta: string
}

export interface ResultadoBusca {
  produto: string
  municipio?: string
  diasConsultados: number
  totalItens: number
  itens: ItemPreco[]
}

export interface ItemCarrinho {
  produto: string
  quantidade: number
}

export interface OpcaoMercadoUnico {
  mercado: string
  total: number
  itensEncontrados: number
  itensFaltantes: string[]
  cobertura: number
  itens: { produto: string; preco: number; quantidade: number; subtotal: number }[]
}

export interface OpcaoCombinacao {
  total: number
  economia: number
  economiaPercent: number
  mercados: string[]
  itens: {
    produto: string
    preco: number
    quantidade: number
    subtotal: number
    mercado: string
  }[]
  itensFaltantes: string[]
}

export interface Decisao {
  recomendacao: 'mercado_unico' | 'combinacao' | 'sem_dados'
  economia: number
  economiaPercent: number
  motivo: string
}

export interface ResultadoAnalise {
  municipio?: string
  mercadoUnico: OpcaoMercadoUnico | null
  combinacao: OpcaoCombinacao | null
  decisao: Decisao
}
