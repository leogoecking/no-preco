import { render, screen, fireEvent } from '@testing-library/react'
import { ResultadoAnalise } from '@/components/ResultadoAnalise'
import type { ResultadoAnalise as TResultado } from '@/types/api'

const onNova = vi.fn()

const semDados: TResultado = {
  decisao: { recomendacao: 'sem_dados', economia: 0, economiaPercent: 0, motivo: '' },
  mercadoUnico: null,
  combinacao: null,
}

const comMercadoUnico: TResultado = {
  decisao: {
    recomendacao: 'mercado_unico',
    economia: 5,
    economiaPercent: 5,
    motivo: 'Concentrar em Mercado_A é mais prático.',
  },
  mercadoUnico: {
    mercado: 'Mercado_A',
    total: 97,
    cobertura: 1,
    itensEncontrados: 1,
    cnpj: '00',
    itens: [{ produto: 'arroz', preco: 7, quantidade: 1, subtotal: 7 }],
    itensFaltantes: [],
  },
  combinacao: null,
}

const comCombinacao: TResultado = {
  decisao: {
    recomendacao: 'combinacao',
    economia: 20,
    economiaPercent: 20,
    motivo: 'Dividir a compra em 2 mercados gera economia.',
  },
  mercadoUnico: null,
  combinacao: {
    total: 80,
    economia: 20,
    economiaPercent: 20,
    mercados: ['Mercado_B', 'Mercado_C'],
    itens: [{ produto: 'arroz', preco: 7, quantidade: 1, subtotal: 7, mercado: 'Mercado_B' }],
    itensFaltantes: [],
  },
}

beforeEach(() => onNova.mockReset())

describe('ResultadoAnalise — sem_dados', () => {
  it('exibe mensagem de produto não encontrado', () => {
    render(<ResultadoAnalise resultado={semDados} onNova={onNova} />)
    expect(screen.getByText(/Não encontramos preços/i)).toBeInTheDocument()
  })

  it('chama onNova ao clicar em Tentar novamente', () => {
    render(<ResultadoAnalise resultado={semDados} onNova={onNova} />)
    fireEvent.click(screen.getByText('Tentar novamente'))
    expect(onNova).toHaveBeenCalledTimes(1)
  })
})

describe('ResultadoAnalise — mercado_unico', () => {
  it('exibe nome do mercado recomendado', () => {
    render(<ResultadoAnalise resultado={comMercadoUnico} onNova={onNova} />)
    expect(screen.getByText('Mercado_A')).toBeInTheDocument()
  })

  it('exibe o motivo da decisão', () => {
    render(<ResultadoAnalise resultado={comMercadoUnico} onNova={onNova} />)
    expect(screen.getByText(/Concentrar em Mercado_A/i)).toBeInTheDocument()
  })

  it('exibe produto do carrinho no card', () => {
    render(<ResultadoAnalise resultado={comMercadoUnico} onNova={onNova} />)
    expect(screen.getByText('arroz')).toBeInTheDocument()
  })

  it('chama onNova ao clicar em Nova análise', () => {
    render(<ResultadoAnalise resultado={comMercadoUnico} onNova={onNova} />)
    fireEvent.click(screen.getByText('Nova análise'))
    expect(onNova).toHaveBeenCalledTimes(1)
  })
})

describe('ResultadoAnalise — combinacao', () => {
  it('exibe seção Melhor combinação', () => {
    render(<ResultadoAnalise resultado={comCombinacao} onNova={onNova} />)
    expect(screen.getByText('Melhor combinação')).toBeInTheDocument()
  })

  it('exibe os mercados da combinação concatenados', () => {
    render(<ResultadoAnalise resultado={comCombinacao} onNova={onNova} />)
    expect(screen.getByText('Mercado_B + Mercado_C')).toBeInTheDocument()
  })

  it('exibe o motivo da decisão', () => {
    render(<ResultadoAnalise resultado={comCombinacao} onNova={onNova} />)
    expect(screen.getByText(/Dividir a compra/i)).toBeInTheDocument()
  })
})
