import { create } from 'zustand'

export interface ItemCarrinho {
  produto: string
  quantidade: number
}

interface CarrinhoStore {
  itens: ItemCarrinho[]
  adicionar: (produto: string) => void
  remover: (produto: string) => void
  alterarQuantidade: (produto: string, quantidade: number) => void
  limpar: () => void
}

export const useCarrinho = create<CarrinhoStore>((set) => ({
  itens: [],

  adicionar: (produto) =>
    set((state) => {
      const existe = state.itens.find((i) => i.produto === produto)
      if (existe) {
        return {
          itens: state.itens.map((i) =>
            i.produto === produto ? { ...i, quantidade: i.quantidade + 1 } : i,
          ),
        }
      }
      return { itens: [...state.itens, { produto, quantidade: 1 }] }
    }),

  remover: (produto) =>
    set((state) => ({ itens: state.itens.filter((i) => i.produto !== produto) })),

  alterarQuantidade: (produto, quantidade) =>
    set((state) => ({
      itens: state.itens.map((i) => (i.produto === produto ? { ...i, quantidade } : i)),
    })),

  limpar: () => set({ itens: [] }),
}))
