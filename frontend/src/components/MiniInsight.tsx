import type { ResumoPreco, Tendencia } from '@/types/api'

interface Props {
  resumo: ResumoPreco | undefined
  isLoading: boolean
}

const COR: Record<Tendencia, string> = {
  caindo: '#16a34a',
  subindo: '#dc2626',
  estavel: '#9ca3af',
}

const LABEL: Record<Tendencia, string> = {
  caindo: '↓ Caindo',
  subindo: '↑ Subindo',
  estavel: '→ Estável',
}

const W = 80
const H = 24

export function MiniInsight({ resumo, isLoading }: Props) {
  if (isLoading) {
    return <div className="mt-1 h-4 w-28 animate-pulse rounded bg-gray-100" />
  }
  if (!resumo) return null

  const { sparkline, tendencia, ehMinimoHistorico, variacaoVsMedia30d } = resumo
  const cor = COR[tendencia]

  const precos = sparkline.map((p) => p.preco)
  const minP = Math.min(...precos)
  const maxP = Math.max(...precos)
  const rangeP = maxP - minP || 1
  const toX = (i: number) => (i / (sparkline.length - 1)) * W
  const toY = (p: number) => H - 2 - ((p - minP) / rangeP) * (H - 4)
  const polyline = sparkline.map((p, i) => `${toX(i)},${toY(p.preco)}`).join(' ')

  const sinal = variacaoVsMedia30d > 0 ? '+' : ''
  const pctCor = variacaoVsMedia30d <= 0 ? 'text-green-600' : 'text-red-500'

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {sparkline.length >= 2 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <polyline
            points={polyline}
            fill="none"
            stroke={cor}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="text-xs font-medium" style={{ color: cor }}>
        {LABEL[tendencia]}
      </span>
      {ehMinimoHistorico && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">
          Mínimo 30d
        </span>
      )}
      <span className={`text-xs font-medium ${pctCor}`}>
        {sinal}{variacaoVsMedia30d.toFixed(1)}% vs média
      </span>
    </div>
  )
}
