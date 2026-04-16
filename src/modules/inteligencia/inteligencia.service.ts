import {
  buscarAlertasMinHistorico,
  buscarEstatisticasSemana,
  buscarRankingVolatilidade,
} from './inteligencia.repository';
import {
  FiltroAlertas,
  FiltroEstatisticas,
  FiltroVolatilidade,
  ResultadoAlertas,
  ResultadoEstatisticas,
  ResultadoVolatilidade,
} from './inteligencia.types';

export async function obterEstatisticas(
  filtro: FiltroEstatisticas,
): Promise<ResultadoEstatisticas> {
  const dias = filtro.dias ?? 7;
  const produtos = await buscarEstatisticasSemana(filtro);

  return {
    geradoEm: new Date().toISOString(),
    janelaEmDias: dias,
    municipio: filtro.municipio,
    totalProdutos: produtos.length,
    produtos,
  };
}

export async function obterVolatilidade(
  filtro: FiltroVolatilidade,
): Promise<ResultadoVolatilidade> {
  const dias           = filtro.dias           ?? 30;
  const minimoAmostras = filtro.minimoAmostras ?? 5;
  const ranking        = await buscarRankingVolatilidade(filtro);

  return {
    geradoEm: new Date().toISOString(),
    janelaEmDias: dias,
    municipio: filtro.municipio,
    minimoAmostras,
    totalProdutosAnalisados: ranking.length,
    ranking,
  };
}

export async function obterAlertas(filtro: FiltroAlertas): Promise<ResultadoAlertas> {
  const variacaoLimiar = filtro.variacaoLimiar ?? -5;
  const alertas        = await buscarAlertasMinHistorico(filtro);

  return {
    geradoEm: new Date().toISOString(),
    municipio: filtro.municipio,
    variacaoLimiar,
    totalAlertas: alertas.length,
    alertas,
  };
}
