import { useQuery } from '@tanstack/react-query'
import { Check, Plus, Store, TrendingDown } from 'lucide-react'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatBRL } from '@/lib/utils'
import { useCarrinho } from '@/store/carrinho'

const LIMITE_VISIVEL = 5

export function AlertasPreco() {
  const { adicionar, itens } = useCarrinho()
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['inteligencia', 'alertas'],
    queryFn: () => api.alertas(),
    staleTime: 1000 * 60 * 10,
  })

  const alertas = data?.alertas.slice(0, LIMITE_VISIVEL) ?? []
  const totalOculto = Math.max((data?.totalAlertas ?? 0) - alertas.length, 0)
  const noCarrinho = (produto: string) => itens.some((i) => i.produto === produto)

  return (
    <section className="mb-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">Alertas de preço</h2>
          <p className="text-xs text-gray-500">
            {data
              ? `${data.totalAlertas} oportunidade${data.totalAlertas !== 1 ? 's' : ''} em Teixeira de Freitas`
              : 'Teixeira de Freitas'}
          </p>
        </div>
        <Badge variant="success" className="gap-1">
          <TrendingDown className="h-3 w-3" />
          -5%
        </Badge>
      </div>

      {isFetching && !data && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-center text-sm text-gray-400">
          Carregando alertas...
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error instanceof Error ? error.message : 'Erro ao carregar alertas.'}
        </div>
      )}

      {data && data.totalAlertas === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-center text-sm text-gray-400">
          Nenhum alerta ativo agora.
        </div>
      )}

      {alertas.length > 0 && (
        <div className="flex flex-col gap-2">
          {alertas.map((alerta) => {
            const adicionado = noCarrinho(alerta.produto)

            return (
              <Card key={`${alerta.produto}-${alerta.mercadoAtual}`}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-gray-900">{alerta.produto}</p>
                        {alerta.ehMinimoHistorico && (
                          <Badge variant="success" className="shrink-0">
                            Mínimo
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                        <Store className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{alerta.mercadoAtual}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span>Média 6m: {formatBRL(alerta.mediaHistorica6m)}</span>
                        <span>Mín.: {formatBRL(alerta.minHistorico6m)}</span>
                        <span>{formatarData(alerta.dataUltimaColeta)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-700">
                          {formatBRL(alerta.precoAtual)}
                        </p>
                        <p className="text-xs font-semibold text-green-700">
                          {formatarPercentual(alerta.variacaoVsMedia6m)}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant={adicionado ? 'outline' : 'default'}
                        onClick={() => adicionar(alerta.produto, alerta.precoAtual)}
                        title="Adicionar ao carrinho"
                      >
                        {adicionado ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {totalOculto > 0 && (
            <p className="text-center text-xs text-gray-400">
              +{totalOculto} alerta{totalOculto !== 1 ? 's' : ''} encontrado
              {totalOculto !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function formatarPercentual(value: number): string {
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}% vs média`
}

function formatarData(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}
