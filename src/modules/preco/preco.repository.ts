import { Prisma, Fonte } from '@prisma/client';
import { prisma } from '../../shared/database/prisma';
import { diasAtras } from '../../shared/utils/date';
import { normalizarSlug } from '../../shared/utils/normalize';
import { PrecoRow } from './preco.model';
import { ProdutoPreco } from '../scraper/scraper.types';

// ─────────────────────────────────────────────
// Interfaces públicas
// ─────────────────────────────────────────────

export interface HistoricoOptions {
  dataInicio?: Date;
  dataFim?: Date;
  cidade?: string;
  municipio?: string;
  limite?: number;
}

export interface BuscaTermoOptions {
  cidade?: string;
  municipio?: string;
  diasRecentes?: number;
  limite?: number;
}

export interface PrecoRecente {
  produto: string;
  preco: number;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio?: string | null;
  unidade?: string | null;
  dataColeta: Date;
}

export interface IPrecoRepository {
  salvarLote(itens: ProdutoPreco[], fonte: 'api' | 'html' | 'browser'): Promise<number>;
  buscarPorTermo(termo: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarPorEan(ean: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarHistorico(produto: string, opcoes?: HistoricoOptions): Promise<PrecoRow[]>;
  buscarUltimoPreco(produto: string, municipio?: string): Promise<PrecoRow | null>;
  contarRegistros(produto: string): Promise<number>;
}

// ─────────────────────────────────────────────
// Implementação com Prisma + PostgreSQL
// ─────────────────────────────────────────────

export class PrecoRepository implements IPrecoRepository {
  async salvarLote(itens: ProdutoPreco[], fonte: 'api' | 'html' | 'browser'): Promise<number> {
    if (itens.length === 0) return 0;

    const data = itens.map((item) => ({
      produto: item.nome.toLowerCase().trim(),
      preco: new Prisma.Decimal(item.preco),
      mercado: item.mercado.trim(),
      cnpj: item.cnpj?.trim() ?? '',
      cidade: normalizarCidade(item.cidade ?? item.municipio ?? 'desconhecida'),
      municipio: item.municipio ?? null,
      unidade: item.unidade ?? null,
      ean: item.ean ?? null,
      dataColeta: item.dataColeta ? new Date(item.dataColeta) : new Date(),
      fonte: fonte as Fonte,
    }));

    try {
      const result = await prisma.preco.createMany({ data, skipDuplicates: false });
      console.log(`[repository] ${result.count}/${itens.length} preços salvos`);
      return result.count;
    } catch (err) {
      throw new RepositoryError('Falha ao salvar lote de preços', err);
    }
  }

  async buscarPorTermo(termo: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    const { cidade, municipio, diasRecentes = 7, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;
    const dataLimite = diasAtras(diasRecentes);
    const termoLike = `%${termo.toLowerCase().trim()}%`;

    const whereExtra = cidadeFiltro
      ? Prisma.sql`AND cidade = ${normalizarCidade(cidadeFiltro)}`
      : Prisma.empty;

    return prisma.$queryRaw<PrecoRecente[]>(
      Prisma.sql`
        WITH ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY produto, mercado, cnpj ORDER BY "dataColeta" DESC) AS rn
          FROM precos
          WHERE produto ILIKE ${termoLike}
            AND "dataColeta" >= ${dataLimite}
            ${whereExtra}
        )
        SELECT
          produto,
          preco::float8 AS preco,
          mercado,
          cnpj,
          cidade,
          municipio,
          unidade,
          "dataColeta"
        FROM ranked
        WHERE rn = 1
        ORDER BY preco ASC
        LIMIT ${limite}
      `,
    );
  }

  async buscarPorEan(ean: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    const { cidade, municipio, diasRecentes = 7, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;
    const dataLimite = diasAtras(diasRecentes);

    const whereExtra = cidadeFiltro
      ? Prisma.sql`AND cidade = ${normalizarCidade(cidadeFiltro)}`
      : Prisma.empty;

    return prisma.$queryRaw<PrecoRecente[]>(
      Prisma.sql`
        WITH ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY produto, mercado, cnpj ORDER BY "dataColeta" DESC) AS rn
          FROM precos
          WHERE ean = ${ean.trim()}
            AND "dataColeta" >= ${dataLimite}
            ${whereExtra}
        )
        SELECT
          produto,
          preco::float8 AS preco,
          mercado,
          cnpj,
          cidade,
          municipio,
          unidade,
          "dataColeta"
        FROM ranked
        WHERE rn = 1
        ORDER BY preco ASC
        LIMIT ${limite}
      `,
    );
  }

  async buscarHistorico(produto: string, opcoes: HistoricoOptions = {}): Promise<PrecoRow[]> {
    const { dataInicio, dataFim, cidade, municipio, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;

    const rows = await prisma.preco.findMany({
      where: {
        produto: produto.toLowerCase().trim(),
        ...(dataInicio || dataFim
          ? {
              dataColeta: {
                ...(dataInicio ? { gte: dataInicio } : {}),
                ...(dataFim ? { lte: dataFim } : {}),
              },
            }
          : {}),
        ...(cidadeFiltro ? { cidade: normalizarCidade(cidadeFiltro) } : {}),
      },
      orderBy: { dataColeta: 'desc' },
      take: limite,
    });

    return rows.map(toPrecoRow);
  }

  async buscarUltimoPreco(produto: string, municipio?: string): Promise<PrecoRow | null> {
    const row = await prisma.preco.findFirst({
      where: {
        produto: produto.toLowerCase().trim(),
        ...(municipio ? { cidade: normalizarCidade(municipio) } : {}),
      },
      orderBy: { dataColeta: 'desc' },
    });

    return row ? toPrecoRow(row) : null;
  }

  async contarRegistros(produto: string): Promise<number> {
    return prisma.preco.count({ where: { produto: produto.toLowerCase().trim() } });
  }
}

export const precoRepository = new PrecoRepository();

// ─────────────────────────────────────────────
// Utilitários internos
// ─────────────────────────────────────────────

export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

const normalizarCidade = normalizarSlug;

type PrismaPreco = {
  id: number;
  produto: string;
  preco: Prisma.Decimal;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio: string | null;
  ean: string | null;
  unidade: string | null;
  fonte: Fonte;
  dataColeta: Date;
  criadoEm: Date;
};

function toPrecoRow(row: PrismaPreco): PrecoRow {
  return {
    id: row.id,
    produto: row.produto,
    preco: Number(row.preco),
    mercado: row.mercado,
    cnpj: row.cnpj,
    cidade: row.cidade,
    municipio: row.municipio,
    ean: row.ean,
    unidade: row.unidade,
    fonte: row.fonte as 'api' | 'html' | 'browser',
    dataColeta: row.dataColeta,
    criadoEm: row.criadoEm,
  };
}
