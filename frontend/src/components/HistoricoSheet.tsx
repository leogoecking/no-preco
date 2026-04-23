import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { api } from '@/api/client'
import { formatBRL } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface Props {
  produto: string
}

const CORES = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed']

const PAD = { top: 12, right: 20, bottom: 36, left: 56 }
const VW = 400
const VH = 220
const CW = VW - PAD.left - PAD.right
const CH = VH - PAD.top - PAD.bottom

function fmtDia(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function HistoricoSheet({ produto }: Props) {
  const [open, setOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['historico', produto],
    queryFn: () => api.historico(produto),
    enabled: open,
    staleTime: 1000 * 60 * 5,
  })

  const itens = data?.itens ?? []

  const allDates = itens.map((i) => new Date(i.dataColeta).getTime())
  const allPrecos = itens.map((i) => i.preco)

  const minDate = Math.min(...allDates)
  const maxDate = Math.max(...allDates)
  const minPreco = Math.min(...allPrecos)
  const maxPreco = Math.max(...allPrecos)

  const dateRange = maxDate - minDate || 1
  const yMin = minPreco * 0.95
  const yMax = maxPreco * 1.05
  const yRange = yMax - yMin || 1

  const toX = (d: Date) => PAD.left + ((d.getTime() - minDate) / dateRange) * CW
  const toY = (p: number) => PAD.top + CH - ((p - yMin) / yRange) * CH

  const yTicks = [0, 1, 2, 3].map((i) => yMin + (yRange * i) / 3)
  const xTicks = [0, 1, 2, 3].map((i) => new Date(minDate + (dateRange * i) / 3))

  const mercados = [...new Set(itens.map((i) => i.mercado))].slice(0, 5)
  const grupos = mercados.map((mercado, idx) => ({
    mercado,
    cor: CORES[idx],
    pontos: itens
      .filter((i) => i.mercado === mercado)
      .map((i) => ({ data: new Date(i.dataColeta), preco: i.preco }))
      .sort((a, b) => a.data.getTime() - b.data.getTime()),
  }))

  const minItem = itens.length > 0 ? itens.reduce((a, b) => (a.preco <= b.preco ? a : b)) : null
  const maxItem = itens.length > 0 ? itens.reduce((a, b) => (a.preco >= b.preco ? a : b)) : null

  const recentes = [...itens]
    .sort((a, b) => new Date(b.dataColeta).getTime() - new Date(a.dataColeta).getTime())
    .slice(0, 8)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-gray-400 hover:text-blue-600"
          title="Ver histórico de preços"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>

      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base leading-snug pr-6">{produto}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-6 pb-6">
          {isLoading && (
            <p className="py-12 text-center text-sm text-gray-400">Carregando histórico...</p>
          )}

          {isError && (
            <p className="py-12 text-center text-sm text-red-500">Erro ao carregar histórico.</p>
          )}

          {data && itens.length === 0 && (
            <p className="py-12 text-center text-sm text-gray-400">
              Nenhum histórico disponível para este produto.
            </p>
          )}

          {data && itens.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-green-100 bg-green-50 p-3">
                  <p className="text-xs font-medium text-green-700">Menor preço</p>
                  <p className="text-lg font-bold text-green-800">{formatBRL(minItem!.preco)}</p>
                  <p className="truncate text-xs text-green-600">{minItem!.mercado}</p>
                </div>
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="text-xs font-medium text-red-700">Maior preço</p>
                  <p className="text-lg font-bold text-red-800">{formatBRL(maxItem!.preco)}</p>
                  <p className="truncate text-xs text-red-600">{maxItem!.mercado}</p>
                </div>
              </div>

              {itens.length > 1 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">Evolução de preços</p>
                  <svg
                    viewBox={`0 0 ${VW} ${VH}`}
                    className="w-full"
                    aria-label="Gráfico de histórico de preços"
                  >
                    {yTicks.map((tick, i) => (
                      <line
                        key={i}
                        x1={PAD.left}
                        y1={toY(tick)}
                        x2={VW - PAD.right}
                        y2={toY(tick)}
                        stroke="#f3f4f6"
                        strokeWidth="1"
                      />
                    ))}

                    {yTicks.map((tick, i) => (
                      <text
                        key={i}
                        x={PAD.left - 4}
                        y={toY(tick) + 4}
                        textAnchor="end"
                        fontSize="9"
                        fill="#9ca3af"
                      >
                        {formatBRL(tick)}
                      </text>
                    ))}

                    {xTicks.map((tick, i) => (
                      <text
                        key={i}
                        x={toX(tick)}
                        y={VH - PAD.bottom + 14}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#9ca3af"
                      >
                        {fmtDia(tick)}
                      </text>
                    ))}

                    {grupos.map(({ cor, pontos }) => (
                      <g key={cor}>
                        <polyline
                          points={pontos.map((p) => `${toX(p.data)},${toY(p.preco)}`).join(' ')}
                          fill="none"
                          stroke={cor}
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                        {pontos.map((p, i) => (
                          <circle key={i} cx={toX(p.data)} cy={toY(p.preco)} r="2.5" fill={cor} />
                        ))}
                      </g>
                    ))}
                  </svg>

                  {mercados.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {grupos.map(({ mercado, cor }) => (
                        <div key={mercado} className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-4 rounded-full"
                            style={{ background: cor }}
                          />
                          <span className="max-w-[120px] truncate text-xs text-gray-500">
                            {mercado}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Registros recentes</p>
                <div className="flex flex-col divide-y divide-gray-100">
                  {recentes.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-gray-700">{item.mercado}</p>
                        <p className="text-xs text-gray-400">{fmtDia(new Date(item.dataColeta))}</p>
                      </div>
                      <span className="ml-2 shrink-0 font-semibold text-gray-900">
                        {formatBRL(item.preco)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-center text-xs text-gray-400">
                {data.totalRegistros} registro{data.totalRegistros !== 1 ? 's' : ''} no total ·{' '}
                {data.retornados} exibidos
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
