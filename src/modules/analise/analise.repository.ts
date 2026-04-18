import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma';
import { MatrizPrecos, Oferta } from './analise.types';

interface OfertaRaw {
  produto: string;
  mercado: string;
  cnpj: string;
  preco: number;
  unidade?: string | null;
  dataColeta: Date;
}

/**
 * Executa uma única query no PostgreSQL e devolve a matriz
 * produto → mercado → oferta_mais_recente (menor preço por mercado).
 */
export async function buscarMatrizPrecos(
  termos: string[],
  municipio?: string,
): Promise<MatrizPrecos> {
  if (termos.length === 0) return new Map();

  const termosLike = termos.map((t) => `%${t.toLowerCase().trim()}%`);

  const municipioWhere = municipio
    ? Prisma.sql`AND municipio ILIKE ${'%' + municipio + '%'}`
    : Prisma.empty;

  const resultados = await prisma.$queryRaw<OfertaRaw[]>(
    Prisma.sql`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY produto, mercado, cnpj ORDER BY "dataColeta" DESC) AS rn
        FROM precos
        WHERE produto ILIKE ANY(ARRAY[${Prisma.join(termosLike)}])
          AND preco > 0
          ${municipioWhere}
      )
      SELECT
        produto,
        mercado,
        cnpj,
        preco::float8 AS preco,
        unidade,
        "dataColeta"
      FROM ranked
      WHERE rn = 1
    `,
  );

  return montarMatriz(resultados, termos);
}

function montarMatriz(rows: OfertaRaw[], termos: string[]): MatrizPrecos {
  const matriz: MatrizPrecos = new Map();
  const termosOrdenados = [...termos].sort((a, b) => b.length - a.length);

  for (const row of rows) {
    const termoAssociado =
      termosOrdenados.find((t) => row.produto.includes(t.toLowerCase().trim())) ?? row.produto;

    if (!matriz.has(termoAssociado)) {
      matriz.set(termoAssociado, new Map());
    }

    const porMercado = matriz.get(termoAssociado)!;

    const existente = porMercado.get(row.mercado);
    if (!existente || row.preco < existente.preco) {
      const oferta: Oferta = {
        preco: row.preco,
        mercado: row.mercado,
        cnpj: row.cnpj,
        unidade: row.unidade ?? undefined,
        dataColeta: row.dataColeta,
      };
      porMercado.set(row.mercado, oferta);
    }
  }

  return matriz;
}
