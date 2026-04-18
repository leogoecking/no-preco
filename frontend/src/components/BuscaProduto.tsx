import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ShoppingCart, Plus, Check, Barcode, Wifi } from 'lucide-react'
import { api, EAN_REGEX } from '@/api/client'
import { useCarrinho } from '@/store/carrinho'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBRL } from '@/lib/utils'
import type { ItemPreco } from '@/types/api'

export function BuscaProduto() {
  const [termo, setTermo] = useState('')
  const [busca, setBusca] = useState('')
  const { adicionar, itens: itensCarrinho } = useCarrinho()

  const isEan = EAN_REGEX.test(busca)

  const { data: dataTermo, isFetching: fetchingTermo } = useQuery({
    queryKey: ['busca', busca],
    queryFn: () => api.buscar(busca),
    enabled: busca.length > 1 && !isEan,
    staleTime: 1000 * 60 * 5,
  })

  const { data: dataEan, isFetching: fetchingEan } = useQuery({
    queryKey: ['ean', busca],
    queryFn: () => api.buscarPorEan(busca),
    enabled: isEan,
    staleTime: 1000 * 60 * 5,
  })

  const isFetching = fetchingTermo || fetchingEan

  const itens: ItemPreco[] = isEan
    ? (dataEan?.itens ?? [])
    : (dataTermo?.itens ?? [])

  const totalItens = isEan ? (dataEan?.totalItens ?? 0) : (dataTermo?.totalItens ?? 0)
  const hasData = isEan ? !!dataEan : !!dataTermo
  const fonteAoVivo = isEan && dataEan?.fonte === 'scrape_ao_vivo'

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    const t = termo.trim()
    if (t.length > 1) setBusca(t)
  }

  const noCarrinho = (produto: string) => itensCarrinho.some((i) => i.produto === produto)

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleBuscar} className="flex gap-2">
        <div className="relative flex-1">
          <Input
            placeholder="Nome do produto ou código de barras (EAN)"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="pr-8"
          />
          {EAN_REGEX.test(termo) && (
            <Barcode className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
          )}
        </div>
        <Button type="submit" disabled={isFetching}>
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Buscar</span>
        </Button>
      </form>

      {isFetching && (
        <div className="flex justify-center py-8 text-gray-400 text-sm">
          {isEan ? 'Buscando por código de barras...' : 'Buscando preços...'}
        </div>
      )}

      {hasData && !isFetching && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-gray-500">
              {totalItens} resultado{totalItens !== 1 ? 's' : ''} para{' '}
              <strong>{busca}</strong>
            </span>
            <div className="flex gap-2">
              {fonteAoVivo && (
                <Badge variant="default" className="gap-1">
                  <Wifi className="h-3 w-3" />
                  Busca ao vivo
                </Badge>
              )}
              <Badge variant="secondary">Teixeira de Freitas</Badge>
            </div>
          </div>

          {totalItens === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              Nenhum preço encontrado. Tente outro termo.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {itens.map((item, i) => (
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
        <div className="flex flex-col items-center gap-3 py-12 text-gray-400">
          <ShoppingCart className="h-10 w-10 opacity-30" />
          <div className="text-center">
            <p className="text-sm">Busque um produto para ver os preços</p>
            <p className="text-xs mt-1 opacity-70">Aceita nome ou código de barras EAN/GTIN</p>
          </div>
        </div>
      )}
    </div>
  )
}
