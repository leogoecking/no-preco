import { Prisma, Fonte } from '@prisma/client';
import { prisma } from '../../shared/database/prisma';
import { diasAtras } from '../../shared/utils/date';
import { normalizarSlug } from '../../shared/utils/normalize';
import { Logger } from '../../shared/logger/logger';
import { PrecoRow } from './preco.model';
import { ProdutoPreco } from '../scraper/scraper.types';

const log = new Logger('PrecoRepository');

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

    try {
      const agora = new Date();
      const preparados = itens.map((item) => ({
        item,
        produto: item.nome.toLowerCase().trim(),
        cnpj: item.cnpj?.trim() ?? '',
        precoNovo: new Prisma.Decimal(item.preco),
      }));

      // cnpj vazio quebra a chave natural (produto, cnpj) — não consulta
      // para não colapsar estabelecimentos distintos numa única linha.
      const comCnpj = preparados.filter((p) => p.cnpj !== '');
      const ultimoPorChave: Map<string, { id: number; preco: Prisma.Decimal }> =
        comCnpj.length > 0 ? await this.buscarUltimosPorChave(comCnpj) : new Map();

      const idsParaAtualizar: number[] = [];
      const paraCriar: Prisma.PrecoCreateManyInput[] = [];

      for (const p of preparados) {
        const ultimo = p.cnpj ? ultimoPorChave.get(chaveProdutoCnpj(p.produto, p.cnpj)) : undefined;

        if (ultimo && ultimo.preco.equals(p.precoNovo)) {
          idsParaAtualizar.push(ultimo.id);
        } else {
          paraCriar.push({
            produto: p.produto,
            preco: p.precoNovo,
            mercado: p.item.mercado.trim(),
            cnpj: p.cnpj,
            cidade: normalizarCidade(p.item.cidade ?? p.item.municipio ?? 'desconhecida'),
            municipio: p.item.municipio ?? null,
            unidade: p.item.unidade ?? null,
            ean: p.item.ean ?? null,
            dataColeta: p.item.dataColeta ? new Date(p.item.dataColeta) : agora,
            fonte: fonte as Fonte,
          });
        }
      }

      const operacoes: Prisma.PrismaPromise<unknown>[] = [];
      if (idsParaAtualizar.length > 0) {
        operacoes.push(
          prisma.preco.updateMany({
            where: { id: { in: idsParaAtualizar } },
            data: { dataColeta: agora },
          }),
        );
      }
      if (paraCriar.length > 0) {
        operacoes.push(prisma.preco.createMany({ data: paraCriar }));
      }
      if (operacoes.length > 0) {
        await prisma.$transaction(operacoes);
      }

      log.info('Preços processados', {
        inseridos: paraCriar.length,
        atualizados: idsParaAtualizar.length,
        total: itens.length,
      });

      return paraCriar.length + idsParaAtualizar.length;
    } catch (err) {
      throw new RepositoryError('Falha ao salvar lote de preços', err);
    }
  }

  private async buscarUltimosPorChave(
    itens: { produto: string; cnpj: string }[],
  ): Promise<Map<string, { id: number; preco: Prisma.Decimal }>> {
    const pares = itens.map((i) => Prisma.sql`(${i.produto}, ${i.cnpj})`);

    const rows = await prisma.$queryRaw<
      { id: number; produto: string; cnpj: string; preco: Prisma.Decimal }[]
    >(
      Prisma.sql`
        SELECT DISTINCT ON (produto, cnpj)
          id, produto, cnpj, preco
        FROM precos
        WHERE (produto, cnpj) IN (${Prisma.join(pares)})
        ORDER BY produto, cnpj, "dataColeta" DESC
      `,
    );

    const mapa = new Map<string, { id: number; preco: Prisma.Decimal }>();
    for (const row of rows) {
      mapa.set(chaveProdutoCnpj(row.produto, row.cnpj), { id: row.id, preco: row.preco });
    }
    return mapa;
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

function chaveProdutoCnpj(produto: string, cnpj: string): string {
  return `${produto}::${cnpj}`;
}

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
