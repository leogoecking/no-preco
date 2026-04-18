import { PipelineStage } from 'mongoose';
import { PrecoModel } from '../preco/preco.model';
import {
  AlertaPreco,
  EstatisticaProduto,
  FiltroAlertas,
  FiltroEstatisticas,
  FiltroVolatilidade,
  NivelVolatilidade,
  ProdutoVolatilidade,
} from './inteligencia.types';

// ─────────────────────────────────────────────
// Pipeline 1 — Estatísticas da janela semanal
// ─────────────────────────────────────────────

/**
 * Agrupa os preços da janela informada e calcula, por produto:
 * min, max, média, desvio, preço mais recente e variação vs média.
 *
 * Toda a matemática roda no MongoDB — Node.js só recebe o resultado final.
 */
export async function buscarEstatisticasSemana(
  filtro: FiltroEstatisticas,
): Promise<EstatisticaProduto[]> {
  const dias = filtro.dias ?? 7;
  const dataInicio = diasAtras(dias);

  const match = buildMatch(dataInicio, filtro.municipio, filtro.produtos);

  type RawEstatistica = Omit<EstatisticaProduto, 'variacaoVsMedia' | 'amplitudeAbsoluta'> & {
    variacaoVsMedia: number;
    amplitudeAbsoluta: number;
  };

  const pipeline: PipelineStage[] = [
    { $match: match },

    // Garante que $first capture o dado mais recente
    { $sort: { dataColeta: -1 as const } },

    {
      $group: {
        _id: '$produto',
        precoAtual: { $first: '$preco' },
        mercadoAtual: { $first: '$mercado' },
        ultimaColeta: { $first: '$dataColeta' },
        precoMin: { $min: '$preco' },
        precoMax: { $max: '$preco' },
        precoMedio: { $avg: '$preco' },
        totalAmostras: { $sum: 1 },
      },
    },

    {
      $addFields: {
        produto: '$_id',

        // Amplitude absoluta: max − min
        amplitudeAbsoluta: { $subtract: ['$precoMax', '$precoMin'] },

        // Variação % do preço atual vs média (evita divisão por zero)
        variacaoVsMedia: {
          $cond: {
            if: { $gt: ['$precoMedio', 0] },
            then: {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $subtract: ['$precoAtual', '$precoMedio'] }, '$precoMedio'] },
                    100,
                  ],
                },
                2,
              ],
            },
            else: 0,
          },
        },

        precoMin: { $round: ['$precoMin', 2] },
        precoMax: { $round: ['$precoMax', 2] },
        precoMedio: { $round: ['$precoMedio', 2] },
        precoAtual: { $round: ['$precoAtual', 2] },
      },
    },

    { $project: { _id: 0 } },
    { $sort: { produto: 1 as const } },
  ];

  return PrecoModel.aggregate<RawEstatistica>(pipeline).exec();
}

// ─────────────────────────────────────────────
// Pipeline 2 — Ranking de volatilidade
// ─────────────────────────────────────────────

/**
 * Calcula, para cada produto, o coeficiente de variação (CV = σ/μ × 100)
 * usando $stdDevSamp do MongoDB. Ordena do mais volátil para o mais estável.
 *
 * Produtos com menos de `minimoAmostras` são excluídos — com poucas
 * observações, o CV não é estatisticamente representativo.
 */
export async function buscarRankingVolatilidade(
  filtro: FiltroVolatilidade,
): Promise<ProdutoVolatilidade[]> {
  const dias = filtro.dias ?? 30;
  const limite = filtro.limite ?? 20;
  const minimoAmostras = filtro.minimoAmostras ?? 5;
  const dataInicio = diasAtras(dias);

  const match = buildMatch(dataInicio, filtro.municipio, filtro.produtos);

  type RawVolatilidade = Omit<ProdutoVolatilidade, 'posicao' | 'nivel'>;

  const pipeline: PipelineStage[] = [
    { $match: match },

    {
      $group: {
        _id: '$produto',
        precoMin: { $min: '$preco' },
        precoMax: { $max: '$preco' },
        precoMedio: { $avg: '$preco' },
        desvioPadrao: { $stdDevSamp: '$preco' }, // ← nativo do MongoDB
        totalAmostras: { $sum: 1 },
      },
    },

    // Descarta produtos com poucas amostras antes de calcular CV
    { $match: { totalAmostras: { $gte: minimoAmostras } } },

    {
      $addFields: {
        produto: '$_id',

        // Coeficiente de variação (CV) — métrica adimensional de dispersão
        coeficienteVariacao: {
          $cond: {
            if: { $gt: ['$precoMedio', 0] },
            then: {
              $round: [{ $multiply: [{ $divide: ['$desvioPadrao', '$precoMedio'] }, 100] }, 2],
            },
            else: 0,
          },
        },

        // Amplitude %: (max − min) / média × 100
        amplitudePercent: {
          $cond: {
            if: { $gt: ['$precoMedio', 0] },
            then: {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $subtract: ['$precoMax', '$precoMin'] }, '$precoMedio'] },
                    100,
                  ],
                },
                2,
              ],
            },
            else: 0,
          },
        },

        precoMin: { $round: ['$precoMin', 2] },
        precoMax: { $round: ['$precoMax', 2] },
        precoMedio: { $round: ['$precoMedio', 2] },
        desvioPadrao: { $round: ['$desvioPadrao', 2] },
      },
    },

    { $project: { _id: 0 } },
    { $sort: { coeficienteVariacao: -1 as const } },
    { $limit: limite },
  ];

  const rows = await PrecoModel.aggregate<RawVolatilidade>(pipeline).exec();

  // Adiciona posição e classificação de nível (lógica simples, não vale uma pipeline)
  return rows.map((r, i) => ({
    ...r,
    posicao: i + 1,
    nivel: classificarNivel(r.coeficienteVariacao),
  }));
}

// ─────────────────────────────────────────────
// Pipeline 3 — Alertas de mínimo histórico (6 meses)
// ─────────────────────────────────────────────

/**
 * Calcula, numa única passagem, a média histórica de 6 meses e compara
 * com o preço mais recente de cada produto.
 *
 * Estratégia: sort DESC por dataColeta antes do $group — assim $first
 * captura o dado mais recente, enquanto $avg, $min, $max operam sobre
 * todos os documentos da janela.
 *
 * Flag `ehMinimoHistorico`: preço atual está dentro de 5% do mínimo histórico.
 */
export async function buscarAlertasMinHistorico(filtro: FiltroAlertas): Promise<AlertaPreco[]> {
  const variacaoLimiar = filtro.variacaoLimiar ?? -5;
  const dataInicio = diasAtras(180); // 6 meses

  const match = buildMatch(dataInicio, filtro.municipio, filtro.produtos);

  type RawAlerta = AlertaPreco;

  const pipeline: PipelineStage[] = [
    { $match: match },

    // DESC: garante que $first captura o preço mais recente
    { $sort: { dataColeta: -1 as const } },

    {
      $group: {
        _id: '$produto',

        // Preço e mercado da coleta mais recente
        precoAtual: { $first: '$preco' },
        mercadoAtual: { $first: '$mercado' },
        dataUltimaColeta: { $first: '$dataColeta' },

        // Estatísticas históricas dos 6 meses completos
        mediaHistorica6m: { $avg: '$preco' },
        minHistorico6m: { $min: '$preco' },
        maxHistorico6m: { $max: '$preco' },
        totalAmostras6m: { $sum: 1 },
      },
    },

    {
      $addFields: {
        produto: '$_id',

        // Variação % do preço atual vs média histórica
        variacaoVsMedia6m: {
          $cond: {
            if: { $gt: ['$mediaHistorica6m', 0] },
            then: {
              $round: [
                {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: ['$precoAtual', '$mediaHistorica6m'] },
                        '$mediaHistorica6m',
                      ],
                    },
                    100,
                  ],
                },
                2,
              ],
            },
            else: 0,
          },
        },

        // true se preço atual ≤ mínimo histórico × 1.05 (dentro de 5% do menor preço)
        ehMinimoHistorico: {
          $lte: ['$precoAtual', { $multiply: ['$minHistorico6m', 1.05] }],
        },

        precoAtual: { $round: ['$precoAtual', 2] },
        mediaHistorica6m: { $round: ['$mediaHistorica6m', 2] },
        minHistorico6m: { $round: ['$minHistorico6m', 2] },
        maxHistorico6m: { $round: ['$maxHistorico6m', 2] },
      },
    },

    { $project: { _id: 0 } },

    // Filtra apenas onde o preço está abaixo do limiar configurado
    { $match: { variacaoVsMedia6m: { $lte: variacaoLimiar } } },

    // Maior queda primeiro (melhor oportunidade de compra no topo)
    { $sort: { variacaoVsMedia6m: 1 as const } },
  ];

  return PrecoModel.aggregate<RawAlerta>(pipeline).exec();
}

// ─────────────────────────────────────────────
// Utilitários internos
// ─────────────────────────────────────────────

function diasAtras(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function buildMatch(
  dataInicio: Date,
  municipio?: string,
  produtos?: string[],
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    dataColeta: { $gte: dataInicio },
    preco: { $gt: 0 },
  };

  if (municipio) {
    match['municipio'] = { $regex: municipio, $options: 'i' };
  }

  if (produtos && produtos.length > 0) {
    match['produto'] = {
      $in: produtos.map((p) => new RegExp(p.toLowerCase().trim(), 'i')),
    };
  }

  return match;
}

function classificarNivel(cv: number): NivelVolatilidade {
  if (cv < 5) return 'ESTÁVEL';
  if (cv < 15) return 'MODERADO';
  if (cv < 30) return 'VOLÁTIL';
  return 'MUITO_VOLÁTIL';
}
