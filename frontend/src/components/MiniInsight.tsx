import type { ResumoPreco, Tendencia } from '@/types/api'
import { formatBRL } from '@/lib/utils'

interface Props {
  resumo: ResumoPreco | undefined
  isLoading: boolean
}

type Veredicto = 'verde' | 'amarelo' | 'vermelho'

const EMOJI: Record<Veredicto, string> = {
  verde: '🟢',
  amarelo: '🟡',
  vermelho: '🔴',
}

const TEXTO: Record<Veredicto, string> = {
  verde: 'Ótimo preço — compre agora',
  amarelo: 'Preço normal — aguarde promoção',
  vermelho: 'Acima do padrão — evite',
}

const COR_SPARK: Record<Tendencia, string> = {
  caindo: '#16a34a',
  subindo: '#dc2626',
  estavel: '#9ca3af',
}

const W = 72
const H = 20

function avaliar(resumo: ResumoPreco): { veredicto: Veredicto; economia: number | null } {
  const { ehMinimoHistorico, variacaoVsMedia30d, tendencia, precoMedio30d, precoMinAtual } = resumo

  const economia = precoMedio30d > 0 ? precoMedio30d - precoMinAtual : null

  if (ehMinimoHistorico || variacaoVsMedia30d <= -8) {
    return { veredicto: 'verde', economia: economia !== null && economia > 0 ? economia : null }
  }
  if (variacaoVsMedia30d > 8 || (tendencia === 'subindo' && variacaoVsMedia30d > 3)) {
    return { veredicto: 'vermelho', economia: null }
  }
  return { veredicto: 'amarelo', economia: null }
}

export function MiniInsight({ resumo, isLoading }: Props) {
  if (isLoading) {
    return <div className="mt-1.5 h-4 w-40 animate-pulse rounded bg-gray-100" />
  }
  if (!resumo) return null

  const { veredicto, economia } = avaliar(resumo)
  const { sparkline, tendencia } = resumo
  const cor = COR_SPARK[tendencia]

  const precos = sparkline.map((p) => p.preco)
  const minP = Math.min(...precos)
  const maxP = Math.max(...precos)
  const rangeP = maxP - minP || 1
  const toX = (i: number) => (i / (sparkline.length - 1)) * W
  const toY = (p: number) => H - 2 - ((p - minP) / rangeP) * (H - 4)
  const polyline = sparkline.map((p, i) => `${toX(i)},${toY(p.preco)}`).join(' ')

  return (
    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
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
      <span className="text-xs font-semibold text-gray-700">
        {EMOJI[veredicto]} {TEXTO[veredicto]}
      </span>
      {economia !== null && (
        <span className="text-xs font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
          Economia {formatBRL(economia)}
        </span>
      )}
    </div>
  )
}
