import { TrendingDown, Store, ShoppingBag, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatBRL } from '@/lib/utils'
import type { ResultadoAnalise as TResultado } from '@/types/api'

interface Props {
  resultado: TResultado
  onNova: () => void
}

export function ResultadoAnalise({ resultado, onNova }: Props) {
  const { decisao, mercadoUnico, combinacao } = resultado

  if (decisao.recomendacao === 'sem_dados') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">
          Não encontramos preços suficientes para os produtos do seu carrinho.
        </p>
        <Button variant="outline" size="sm" onClick={onNova}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const isCombo = decisao.recomendacao === 'combinacao'

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3">
        <TrendingDown className="h-5 w-5 text-green-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-green-800">{decisao.motivo}</p>
          {decisao.economiaPercent > 0 && (
            <p className="text-xs text-green-700">
              Economia de {formatBRL(decisao.economia)} ({decisao.economiaPercent.toFixed(1)}%)
            </p>
          )}
        </div>
      </div>

      {isCombo && combinacao ? (
        <Card className="border-blue-200 ring-1 ring-blue-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingBag className="h-4 w-4 text-blue-600" />
                Melhor combinação
              </CardTitle>
              <Badge variant="success">Recomendado</Badge>
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatBRL(combinacao.total)}</p>
            <p className="text-xs text-gray-500">
              {combinacao.mercados.join(' + ')}
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {combinacao.itens.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 truncate flex-1">
                    {item.produto}
                    {item.quantidade > 1 && (
                      <span className="text-gray-400"> ×{item.quantidade}</span>
                    )}
                  </span>
                  <span className="text-gray-500 text-xs mx-2 shrink-0">{item.mercado}</span>
                  <span className="font-medium text-gray-900 shrink-0">
                    {formatBRL(item.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            {combinacao.itensFaltantes.length > 0 && (
              <p className="mt-2 text-xs text-orange-600">
                Não encontrado: {combinacao.itensFaltantes.join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {mercadoUnico && (
        <Card className={!isCombo ? 'border-blue-200 ring-1 ring-blue-200' : ''}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Store className="h-4 w-4 text-gray-600" />
                {mercadoUnico.mercado}
              </CardTitle>
              {!isCombo && <Badge variant="success">Recomendado</Badge>}
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatBRL(mercadoUnico.total)}</p>
            <p className="text-xs text-gray-500">
              {mercadoUnico.cobertura.toFixed(0)}% dos itens disponíveis
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {mercadoUnico.itens.map((item, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 truncate flex-1">
                    {item.produto}
                    {item.quantidade > 1 && (
                      <span className="text-gray-400"> ×{item.quantidade}</span>
                    )}
                  </span>
                  <span className="font-medium text-gray-900 shrink-0">
                    {formatBRL(item.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            {mercadoUnico.itensFaltantes.length > 0 && (
              <p className="mt-2 text-xs text-orange-600">
                Não encontrado: {mercadoUnico.itensFaltantes.join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Button variant="outline" size="sm" onClick={onNova} className="mt-2">
        Nova análise
      </Button>
    </div>
  )
}
