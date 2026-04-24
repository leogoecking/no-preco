import { useCarrinho } from '@/store/carrinho'

beforeEach(() => {
  localStorage.clear()
  useCarrinho.setState({ itens: [] })
})

describe('useCarrinho', () => {
  it('adiciona item ao carrinho com preço', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    const { itens } = useCarrinho.getState()
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ produto: 'arroz', preco: 10, quantidade: 1 })
  })

  it('adiciona item sem preço', () => {
    useCarrinho.getState().adicionar('feijao')
    expect(useCarrinho.getState().itens[0].preco).toBeUndefined()
  })

  it('incrementa quantidade ao adicionar item já presente', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().adicionar('arroz', 10)
    const { itens } = useCarrinho.getState()
    expect(itens).toHaveLength(1)
    expect(itens[0].quantidade).toBe(2)
  })

  it('não cria duplicatas para o mesmo produto', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().adicionar('arroz', 12)
    useCarrinho.getState().adicionar('arroz', 8)
    expect(useCarrinho.getState().itens).toHaveLength(1)
  })

  it('remove item pelo nome', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().adicionar('feijao', 5)
    useCarrinho.getState().remover('arroz')
    const { itens } = useCarrinho.getState()
    expect(itens).toHaveLength(1)
    expect(itens[0].produto).toBe('feijao')
  })

  it('altera quantidade de um item existente', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().alterarQuantidade('arroz', 5)
    expect(useCarrinho.getState().itens[0].quantidade).toBe(5)
  })

  it('limpa todos os itens', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().adicionar('feijao', 5)
    useCarrinho.getState().limpar()
    expect(useCarrinho.getState().itens).toHaveLength(0)
  })

  it('mantém outros itens ao remover um específico', () => {
    useCarrinho.getState().adicionar('arroz', 10)
    useCarrinho.getState().adicionar('feijao', 5)
    useCarrinho.getState().adicionar('macarrao', 3)
    useCarrinho.getState().remover('feijao')
    const nomes = useCarrinho.getState().itens.map((i) => i.produto)
    expect(nomes).toEqual(['arroz', 'macarrao'])
  })
})
