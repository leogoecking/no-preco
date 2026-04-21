import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ItemCarrinho {
  produto: string
  quantidade: number
  preco?: number
}

interface CarrinhoStore {
  itens: ItemCarrinho[]
  adicionar: (produto: string, preco?: number) => void
  remover: (produto: string) => void
  alterarQuantidade: (produto: string, quantidade: number) => void
  limpar: () => void
}

export const useCarrinho = create<CarrinhoStore>()(
  persist(
    (set) => ({
      itens: [],

      adicionar: (produto, preco) =>
        set((state) => {
          const existe = state.itens.find((i) => i.produto === produto)
          if (existe) {
            return {
              itens: state.itens.map((i) =>
                i.produto === produto ? { ...i, quantidade: i.quantidade + 1 } : i,
              ),
            }
          }
          return { itens: [...state.itens, { produto, quantidade: 1, preco }] }
        }),

      remover: (produto) =>
        set((state) => ({ itens: state.itens.filter((i) => i.produto !== produto) })),

      alterarQuantidade: (produto, quantidade) =>
        set((state) => ({
          itens: state.itens.map((i) => (i.produto === produto ? { ...i, quantidade } : i)),
        })),

      limpar: () => set({ itens: [] }),
    }),
    { name: 'carrinho' },
  ),
)
