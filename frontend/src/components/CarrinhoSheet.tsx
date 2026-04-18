import { useMutation } from '@tanstack/react-query'
import { Minus, Plus, Trash2, ShoppingCart } from 'lucide-react'
import { api } from '@/api/client'
import { useCarrinho } from '@/store/carrinho'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ResultadoAnalise } from '@/components/ResultadoAnalise'
import type { ResultadoAnalise as TResultado } from '@/types/api'
import { useState } from 'react'

export function CarrinhoSheet() {
  const { itens, remover, alterarQuantidade, limpar } = useCarrinho()
  const [resultado, setResultado] = useState<TResultado | null>(null)
  const [open, setOpen] = useState(false)

  const total = itens.length

  const { mutate: analisar, isPending, isError, error, reset } = useMutation({
    mutationFn: () => api.analisarCarrinho(itens),
    onSuccess: (data) => setResultado(data),
  })

  function handleOpen(v: boolean) {
    setOpen(v)
    if (!v) {
      setResultado(null)
      reset()
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="relative gap-2">
          <ShoppingCart className="h-4 w-4" />
          <span>Carrinho</span>
          {total > 0 && (
            <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
              {total}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Meu Carrinho</SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 flex-col overflow-hidden px-6">
          {itens.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400">
              <ShoppingCart className="h-10 w-10 opacity-30" />
              <p className="text-sm">Carrinho vazio</p>
            </div>
          ) : resultado ? (
            <div className="flex-1 overflow-y-auto">
              <ResultadoAnalise resultado={resultado} onNova={() => { setResultado(null); reset() }} />
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <ul className="flex flex-col divide-y divide-gray-100">
                  {itens.map((item) => (
                    <li key={item.produto} className="flex items-center gap-3 py-3">
                      <p className="flex-1 text-sm font-medium text-gray-800 truncate">
                        {item.produto}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() =>
                            item.quantidade > 1
                              ? alterarQuantidade(item.produto, item.quantidade - 1)
                              : remover(item.produto)
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-5 text-center text-sm">{item.quantidade}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => alterarQuantidade(item.produto, item.quantidade + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-400 hover:text-red-600"
                        onClick={() => remover(item.produto)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              {isError && (
                <p className="mb-2 text-xs text-red-600">{(error as Error).message}</p>
              )}

              <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 pb-6">
                <Button onClick={() => analisar()} disabled={isPending} className="w-full">
                  {isPending ? 'Analisando...' : 'Onde comprar mais barato?'}
                </Button>
                <Button variant="ghost" size="sm" onClick={limpar} className="text-gray-400">
                  Limpar carrinho
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
