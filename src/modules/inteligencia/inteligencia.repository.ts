import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma';
import { diasAtras } from '../../shared/utils/date';
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

export async function buscarEstatisticasSemana(
  filtro: FiltroEstatisticas,
): Promise<EstatisticaProduto[]> {
  const dias = filtro.dias ?? 7;
  const dataInicio = diasAtras(dias);
  const { municipioWhere, produtosWhere } = buildWhereFragments(filtro.municipio, filtro.produtos);

  type Row = EstatisticaProduto;

  return prisma.$queryRaw<Row[]>(
    Prisma.sql`
      WITH janela AS (
        SELECT produto, preco, mercado, "dataColeta"
        FROM precos
        WHERE "dataColeta" >= ${dataInicio}
          AND preco > 0
          ${municipioWhere}
          ${produtosWhere}
      ),
      latest AS (
        SELECT DISTINCT ON (produto)
          produto,
          preco        AS "precoAtual",
          mercado      AS "mercadoAtual",
          "dataColeta" AS "ultimaColeta"
        FROM janela
        ORDER BY produto, "dataColeta" DESC
      ),
      agg AS (
        SELECT
          produto,
          MIN(preco)::float8  AS "precoMin",
          MAX(preco)::float8  AS "precoMax",
          AVG(preco)::float8  AS "precoMedio",
          COUNT(*)::int       AS "totalAmostras"
        FROM janela
        GROUP BY produto
      )
      SELECT
        a.produto,
        ROUND(l."precoAtual"::numeric, 2)::float8                              AS "precoAtual",
        l."mercadoAtual",
        l."ultimaColeta",
        ROUND(a."precoMin"::numeric, 2)::float8                                AS "precoMin",
        ROUND(a."precoMax"::numeric, 2)::float8                                AS "precoMax",
        ROUND(a."precoMedio"::numeric, 2)::float8                              AS "precoMedio",
        a."totalAmostras",
        ROUND((a."precoMax" - a."precoMin")::numeric, 2)::float8               AS "amplitudeAbsoluta",
        CASE WHEN a."precoMedio" > 0 THEN
          ROUND(((l."precoAtual" - a."precoMedio") / a."precoMedio" * 100)::numeric, 2)::float8
        ELSE 0 END                                                             AS "variacaoVsMedia"
      FROM agg a
      JOIN latest l ON l.produto = a.produto
      ORDER BY a.produto
    `,
  );
}

// ─────────────────────────────────────────────
// Pipeline 2 — Ranking de volatilidade
// ─────────────────────────────────────────────

export async function buscarRankingVolatilidade(
  filtro: FiltroVolatilidade,
): Promise<ProdutoVolatilidade[]> {
  const dias = filtro.dias ?? 30;
  const limite = filtro.limite ?? 20;
  const minimoAmostras = filtro.minimoAmostras ?? 5;
  const dataInicio = diasAtras(dias);
  const { municipioWhere, produtosWhere } = buildWhereFragments(filtro.municipio, filtro.produtos);

  type RawRow = Omit<ProdutoVolatilidade, 'posicao' | 'nivel'>;

  const rows = await prisma.$queryRaw<RawRow[]>(
    Prisma.sql`
      WITH janela AS (
        SELECT produto, preco
        FROM precos
        WHERE "dataColeta" >= ${dataInicio}
          AND preco > 0
          ${municipioWhere}
          ${produtosWhere}
      ),
      agg AS (
        SELECT
          produto,
          MIN(preco)::float8          AS "precoMin",
          MAX(preco)::float8          AS "precoMax",
          AVG(preco)::float8          AS "precoMedio",
          STDDEV_SAMP(preco)::float8  AS "desvioPadrao",
          COUNT(*)::int               AS "totalAmostras"
        FROM janela
        GROUP BY produto
        HAVING COUNT(*) >= ${minimoAmostras}
      )
      SELECT
        produto,
        ROUND("precoMin"::numeric, 2)::float8     AS "precoMin",
        ROUND("precoMax"::numeric, 2)::float8     AS "precoMax",
        ROUND("precoMedio"::numeric, 2)::float8   AS "precoMedio",
        ROUND("desvioPadrao"::numeric, 2)::float8 AS "desvioPadrao",
        "totalAmostras",
        CASE WHEN "precoMedio" > 0 THEN
          ROUND(("desvioPadrao" / "precoMedio" * 100)::numeric, 2)::float8
        ELSE 0 END AS "coeficienteVariacao",
        CASE WHEN "precoMedio" > 0 THEN
          ROUND((("precoMax" - "precoMin") / "precoMedio" * 100)::numeric, 2)::float8
        ELSE 0 END AS "amplitudePercent"
      FROM agg
      ORDER BY "coeficienteVariacao" DESC
      LIMIT ${limite}
    `,
  );

  return rows.map((r, i) => ({
    ...r,
    posicao: i + 1,
    nivel: classificarNivel(r.coeficienteVariacao),
  }));
}

// ─────────────────────────────────────────────
// Pipeline 3 — Alertas de mínimo histórico (6 meses)
// ─────────────────────────────────────────────

export async function buscarAlertasMinHistorico(filtro: FiltroAlertas): Promise<AlertaPreco[]> {
  const variacaoLimiar = filtro.variacaoLimiar ?? -5;
  const dataInicio = diasAtras(180);
  const { municipioWhere, produtosWhere } = buildWhereFragments(filtro.municipio, filtro.produtos);

  return prisma.$queryRaw<AlertaPreco[]>(
    Prisma.sql`
      WITH janela AS (
        SELECT produto, preco, mercado, "dataColeta"
        FROM precos
        WHERE "dataColeta" >= ${dataInicio}
          AND preco > 0
          ${municipioWhere}
          ${produtosWhere}
      ),
      latest AS (
        SELECT DISTINCT ON (produto)
          produto,
          preco        AS "precoAtual",
          mercado      AS "mercadoAtual",
          "dataColeta" AS "dataUltimaColeta"
        FROM janela
        ORDER BY produto, "dataColeta" DESC
      ),
      agg AS (
        SELECT
          produto,
          AVG(preco)::float8 AS "mediaHistorica6m",
          MIN(preco)::float8 AS "minHistorico6m",
          MAX(preco)::float8 AS "maxHistorico6m",
          COUNT(*)::int      AS "totalAmostras6m"
        FROM janela
        GROUP BY produto
      )
      SELECT
        a.produto,
        ROUND(l."precoAtual"::numeric, 2)::float8         AS "precoAtual",
        l."mercadoAtual",
        l."dataUltimaColeta",
        ROUND(a."mediaHistorica6m"::numeric, 2)::float8   AS "mediaHistorica6m",
        ROUND(a."minHistorico6m"::numeric, 2)::float8     AS "minHistorico6m",
        ROUND(a."maxHistorico6m"::numeric, 2)::float8     AS "maxHistorico6m",
        a."totalAmostras6m",
        CASE WHEN a."mediaHistorica6m" > 0 THEN
          ROUND(((l."precoAtual" - a."mediaHistorica6m") / a."mediaHistorica6m" * 100)::numeric, 2)::float8
        ELSE 0 END AS "variacaoVsMedia6m",
        (l."precoAtual" <= a."minHistorico6m" * 1.05) AS "ehMinimoHistorico"
      FROM agg a
      JOIN latest l ON l.produto = a.produto
      WHERE (
        CASE WHEN a."mediaHistorica6m" > 0 THEN
          ((l."precoAtual" - a."mediaHistorica6m") / a."mediaHistorica6m" * 100)
        ELSE 0 END
      ) <= ${variacaoLimiar}
      ORDER BY "variacaoVsMedia6m" ASC
    `,
  );
}


function buildWhereFragments(
  municipio?: string,
  produtos?: string[],
): { municipioWhere: Prisma.Sql; produtosWhere: Prisma.Sql } {
  const municipioWhere = municipio
    ? Prisma.sql`AND municipio ILIKE ${'%' + municipio + '%'}`
    : Prisma.empty;

  const produtosWhere =
    produtos && produtos.length > 0
      ? Prisma.sql`AND produto ILIKE ANY(ARRAY[${Prisma.join(
          produtos.map((p) => `%${p.toLowerCase().trim()}%`),
        )}])`
      : Prisma.empty;

  return { municipioWhere, produtosWhere };
}

function classificarNivel(cv: number): NivelVolatilidade {
  if (cv < 5) return 'ESTÁVEL';
  if (cv < 15) return 'MODERADO';
  if (cv < 30) return 'VOLÁTIL';
  return 'MUITO_VOLÁTIL';
}
