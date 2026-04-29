import { ResumoPreco, Tendencia } from './preco.model';

export interface PontoHistorico {
  preco: number;
  dataColeta: Date;
}

const SPARKLINE_TAMANHO = 8;
const TOLERANCIA_MINIMO_HISTORICO = 1.05;
const LIMIAR_TENDENCIA = 0.03;

/**
 * Calcula o ResumoPreco a partir do menor preço atual e da série histórica
 * (em ordem cronológica ASC). Função pura — não consulta banco.
 */
export function calcularResumoPreco(
  precoMinAtual: number,
  historico: PontoHistorico[],
): ResumoPreco {
  const precos = historico.map((h) => h.preco);
  const temHistorico = precos.length > 0;

  const precoMin30d = temHistorico ? Math.min(...precos) : precoMinAtual;
  const precoMedio30d = temHistorico
    ? precos.reduce((a, b) => a + b, 0) / precos.length
    : precoMinAtual;

  const variacaoVsMedia30d =
    precoMedio30d > 0
      ? Math.round(((precoMinAtual - precoMedio30d) / precoMedio30d) * 1000) / 10
      : 0;

  const ehMinimoHistorico = precoMinAtual <= precoMin30d * TOLERANCIA_MINIMO_HISTORICO;

  return {
    precoMinAtual,
    precoMin30d,
    precoMedio30d,
    variacaoVsMedia30d,
    ehMinimoHistorico,
    tendencia: calcularTendencia(precos),
    sparkline: historico.slice(-SPARKLINE_TAMANHO).map((h) => ({
      preco: h.preco,
      dataColeta: h.dataColeta.toISOString(),
    })),
  };
}

export function calcularTendencia(precos: number[]): Tendencia {
  if (precos.length < 4) return 'estavel';
  const mid = Math.floor(precos.length / 2);
  const avgFirst = precos.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const avgSecond = precos.slice(mid).reduce((a, b) => a + b, 0) / (precos.length - mid);
  const diff = (avgSecond - avgFirst) / avgFirst;
  if (diff < -LIMIAR_TENDENCIA) return 'caindo';
  if (diff > LIMIAR_TENDENCIA) return 'subindo';
  return 'estavel';
}
