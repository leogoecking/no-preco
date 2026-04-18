import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ShoppingCart, Plus, Check } from 'lucide-react'
import { api } from '@/api/client'
import { useCarrinho } from '@/store/carrinho'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBRL } from '@/lib/utils'

export function BuscaProduto() {
  const [termo, setTermo] = useState('')
  const [busca, setBusca] = useState('')
  const { adicionar, itens: itensCarrinho } = useCarrinho()

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['busca', busca],
    queryFn: () => api.buscar(busca),
    enabled: busca.length > 1,
    staleTime: 1000 * 60 * 5,
  })

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    if (termo.trim().length > 1) setBusca(termo.trim())
  }

  const noCarrinho = (produto: string) => itensCarrinho.some((i) => i.produto === produto)

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleBuscar} className="flex gap-2">
        <Input
          placeholder="Buscar produto (ex: arroz 5kg)"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={isFetching}>
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Buscar</span>
        </Button>
      </form>

      {isFetching && (
        <div className="flex justify-center py-8 text-gray-400 text-sm">Buscando preços...</div>
      )}

      {isError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {data && !isFetching && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {data.totalItens} resultado{data.totalItens !== 1 ? 's' : ''} para{' '}
              <strong>{data.produto}</strong>
            </span>
            <Badge variant="secondary">Teixeira de Freitas</Badge>
          </div>

          {data.totalItens === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              Nenhum preço encontrado. Tente outro termo.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.itens.map((item, i) => (
                <Card key={i}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{item.produto}</p>
                      <p className="text-sm text-gray-500 truncate">{item.mercado}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-lg font-bold text-blue-600">
                        {formatBRL(item.preco)}
                      </span>
                      <Button
                        size="icon"
                        variant={noCarrinho(item.produto) ? 'outline' : 'default'}
                        onClick={() => adicionar(item.produto)}
                        title="Adicionar ao carrinho"
                      >
                        {noCarrinho(item.produto) ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!busca && !isFetching && (
        <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
          <ShoppingCart className="h-10 w-10 opacity-30" />
          <p className="text-sm">Busque um produto para ver os preços</p>
        </div>
      )}
    </div>
  )
}
