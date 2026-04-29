import { Prisma, Fonte, Preco } from '@prisma/client';
import { prisma } from '../../shared/database/prisma';
import { diasAtras } from '../../shared/utils/date';
import { normalizarSlug } from '../../shared/utils/normalize';
import { Logger } from '../../shared/logger/logger';
import { FonteColeta, PrecoRow, ResumoPreco } from './preco.model';
import { calcularResumoPreco } from './preco.stats';
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
  salvarLote(itens: ProdutoPreco[], fonte: FonteColeta): Promise<number>;
  buscarPorTermo(termo: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarPorEan(ean: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarHistorico(produto: string, opcoes?: HistoricoOptions): Promise<PrecoRow[]>;
  buscarUltimoPreco(produto: string, municipio?: string): Promise<PrecoRow | null>;
  contarRegistros(produto: string): Promise<number>;
  buscarStatsBatch(produtos: string[], municipio?: string): Promise<Map<string, ResumoPreco>>;
}

// ─────────────────────────────────────────────
// Implementação com Prisma + PostgreSQL
// ─────────────────────────────────────────────

export class PrecoRepository implements IPrecoRepository {
  async salvarLote(itens: ProdutoPreco[], fonte: FonteColeta): Promise<number> {
    if (itens.length === 0) return 0;

    try {
      const agora = new Date();
      const preparadosBrutos = itens.map((item) => preparar(item, fonte as Fonte, agora));

      // Dedup intra-lote: o scraper pode devolver o mesmo (ean, cnpj) ou
      // (produto, cnpj, mercado) mais de uma vez; mantemos apenas a última
      // ocorrência para não violar o UNIQUE parcial na transação.
      const mapaDedup = new Map<string, Preparado>();
      for (const p of preparadosBrutos) {
        const chave = p.ean ? chaveEan(p.ean, p.cnpj) : chaveProdMerc(p.produto, p.cnpj, p.mercado);
        mapaDedup.set(chave, p);
      }
      const preparados = Array.from(mapaDedup.values());

      const comEan = preparados.filter((p) => p.ean !== null);
      const semEan = preparados.filter((p) => p.ean === null);

      const [atuaisComEan, atuaisSemEan] = await Promise.all([
        comEan.length > 0 ? this.buscarAtuaisPorEan(comEan) : Promise.resolve(new Map()),
        semEan.length > 0 ? this.buscarAtuaisPorProdutoMercado(semEan) : Promise.resolve(new Map()),
      ]);

      const idsMesmoPreco: number[] = [];
      const paraMudarPreco: Array<{ id: number; item: Preparado; precoAnterior: Prisma.Decimal }> =
        [];
      const paraCriar: Preparado[] = [];

      for (const p of preparados) {
        const chave = p.ean ? chaveEan(p.ean, p.cnpj) : chaveProdMerc(p.produto, p.cnpj, p.mercado);
        const atual = (p.ean ? atuaisComEan : atuaisSemEan).get(chave);

        if (!atual) {
          paraCriar.push(p);
        } else if (atual.preco.equals(p.precoNovo)) {
          idsMesmoPreco.push(atual.id);
        } else {
          paraMudarPreco.push({ id: atual.id, item: p, precoAnterior: atual.preco });
        }
      }

      const temTrabalho =
        idsMesmoPreco.length > 0 || paraMudarPreco.length > 0 || paraCriar.length > 0;

      if (temTrabalho) {
        // Transação interativa com timeout ampliado: Neon está em sa-east-1 e
        // cada round-trip pesa ~100–200ms, então batches maiores estouram o
        // default de 5s do Prisma.
        await prisma.$transaction(
          async (tx) => {
            if (idsMesmoPreco.length > 0) {
              await tx.preco.updateMany({
                where: { id: { in: idsMesmoPreco } },
                data: { dataColeta: agora },
              });
            }

            // Atualizações de preço permanecem individuais (dados diferem
            // por linha), mas os pontos de histórico correspondentes vão
            // num único createMany.
            for (const alvo of paraMudarPreco) {
              await tx.preco.update({
                where: { id: alvo.id },
                data: {
                  preco: alvo.item.precoNovo,
                  precoAnterior: alvo.precoAnterior,
                  mercado: alvo.item.mercado,
                  cidade: alvo.item.cidade,
                  municipio: alvo.item.municipio,
                  unidade: alvo.item.unidade,
                  fonte: alvo.item.fonte,
                  dataColeta: alvo.item.dataColeta,
                },
              });
            }

            if (paraMudarPreco.length > 0) {
              await tx.historicoPreco.createMany({
                data: paraMudarPreco.map((a) => ({
                  precoId: a.id,
                  preco: a.item.precoNovo,
                  dataColeta: a.item.dataColeta,
                  fonte: a.item.fonte,
                })),
              });
            }

            // Novos: 1 batch insert retornando ids + 1 batch insert de histórico.
            // Postgres preserva ordem dos retornos igual à ordem dos inputs.
            if (paraCriar.length > 0) {
              const criados = await tx.preco.createManyAndReturn({
                data: paraCriar.map((n) => ({
                  produto: n.produto,
                  preco: n.precoNovo,
                  mercado: n.mercado,
                  cnpj: n.cnpj,
                  cidade: n.cidade,
                  municipio: n.municipio,
                  ean: n.ean,
                  unidade: n.unidade,
                  fonte: n.fonte,
                  dataColeta: n.dataColeta,
                })),
                select: { id: true },
              });

              await tx.historicoPreco.createMany({
                data: criados.map((c, i) => ({
                  precoId: c.id,
                  preco: paraCriar[i]!.precoNovo,
                  dataColeta: paraCriar[i]!.dataColeta,
                  fonte: paraCriar[i]!.fonte,
                })),
              });
            }
          },
          { timeout: 20_000 },
        );
      }

      const atualizados = idsMesmoPreco.length + paraMudarPreco.length;
      const inseridos = paraCriar.length;

      log.info('Preços processados', {
        inseridos,
        precosMudados: paraMudarPreco.length,
        confirmadosSemMudanca: idsMesmoPreco.length,
        total: itens.length,
      });

      return inseridos + atualizados;
    } catch (err) {
      const causa = err instanceof Error ? err : new Error(String(err));
      log.error('Falha ao salvar lote de preços', {
        erro: causa.message,
        nome: causa.name,
        stack: causa.stack,
      });
      throw new RepositoryError('Falha ao salvar lote de preços', err);
    }
  }

  private async buscarAtuaisPorEan(
    itens: Preparado[],
  ): Promise<Map<string, { id: number; preco: Prisma.Decimal }>> {
    const pares = itens.map((i) => Prisma.sql`(${i.ean}, ${i.cnpj})`);
    const rows = await prisma.$queryRaw<
      { id: number; ean: string; cnpj: string; preco: Prisma.Decimal }[]
    >(
      Prisma.sql`
        SELECT id, ean, cnpj, preco
        FROM precos
        WHERE ean IS NOT NULL AND (ean, cnpj) IN (${Prisma.join(pares)})
      `,
    );
    const mapa = new Map<string, { id: number; preco: Prisma.Decimal }>();
    for (const r of rows) mapa.set(chaveEan(r.ean, r.cnpj), { id: r.id, preco: r.preco });
    return mapa;
  }

  private async buscarAtuaisPorProdutoMercado(
    itens: Preparado[],
  ): Promise<Map<string, { id: number; preco: Prisma.Decimal }>> {
    const triplas = itens.map((i) => Prisma.sql`(${i.produto}, ${i.cnpj}, ${i.mercado})`);
    const rows = await prisma.$queryRaw<
      { id: number; produto: string; cnpj: string; mercado: string; preco: Prisma.Decimal }[]
    >(
      Prisma.sql`
        SELECT id, produto, cnpj, mercado, preco
        FROM precos
        WHERE ean IS NULL AND (produto, cnpj, mercado) IN (${Prisma.join(triplas)})
      `,
    );
    const mapa = new Map<string, { id: number; preco: Prisma.Decimal }>();
    for (const r of rows)
      mapa.set(chaveProdMerc(r.produto, r.cnpj, r.mercado), { id: r.id, preco: r.preco });
    return mapa;
  }

  async buscarPorTermo(termo: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    const tokens = termo
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) return [];

    // Cada token precisa aparecer em "produto" (em qualquer ordem).
    // Evita falha quando o usuário digita "picanha kg" mas o produto
    // está como "picanha bovina 1kg".
    const filtros = tokens.map((t) => Prisma.sql`produto ILIKE ${`%${t}%`}`);
    return this.buscarRecentes(Prisma.sql`(${Prisma.join(filtros, ' AND ')})`, opcoes);
  }

  async buscarPorEan(ean: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    return this.buscarRecentes(Prisma.sql`ean = ${ean.trim()}`, opcoes);
  }

  private buscarRecentes(
    filtroPrincipal: Prisma.Sql,
    opcoes: BuscaTermoOptions,
  ): Promise<PrecoRecente[]> {
    const { cidade, municipio, diasRecentes = 7, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;
    const dataLimite = diasAtras(diasRecentes);

    const whereExtra = cidadeFiltro
      ? Prisma.sql`AND cidade = ${normalizarCidade(cidadeFiltro)}`
      : Prisma.empty;

    return prisma.$queryRaw<PrecoRecente[]>(
      Prisma.sql`
        SELECT
          produto,
          preco::float8 AS preco,
          mercado,
          cnpj,
          cidade,
          municipio,
          unidade,
          "dataColeta"
        FROM precos
        WHERE ${filtroPrincipal}
          AND "dataColeta" >= ${dataLimite}
          ${whereExtra}
        ORDER BY preco ASC
        LIMIT ${limite}
      `,
    );
  }

  async buscarHistorico(produto: string, opcoes: HistoricoOptions = {}): Promise<PrecoRow[]> {
    const { dataInicio, dataFim, cidade, municipio, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;
    const produtoNorm = produto.toLowerCase().trim();

    const filtros: Prisma.Sql[] = [Prisma.sql`p.produto = ${produtoNorm}`];
    if (dataInicio) filtros.push(Prisma.sql`h."dataColeta" >= ${dataInicio}`);
    if (dataFim) filtros.push(Prisma.sql`h."dataColeta" <= ${dataFim}`);
    if (cidadeFiltro) filtros.push(Prisma.sql`p.cidade = ${normalizarCidade(cidadeFiltro)}`);

    const rows = await prisma.$queryRaw<HistoricoJoinRow[]>(
      Prisma.sql`
        SELECT
          h.id,
          p.produto,
          h.preco,
          p.mercado,
          p.cnpj,
          p.cidade,
          p.municipio,
          p.ean,
          p.unidade,
          h.fonte,
          h."dataColeta",
          h."registradoEm",
          p."atualizadoEm"
        FROM precos_historico h
        JOIN precos p ON p.id = h."precoId"
        WHERE ${Prisma.join(filtros, ' AND ')}
        ORDER BY h."dataColeta" DESC
        LIMIT ${limite}
      `,
    );

    return rows.map(mapHistoricoJoinRow);
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
    const produtoNorm = produto.toLowerCase().trim();
    const rows = await prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM precos_historico h
        JOIN precos p ON p.id = h."precoId"
        WHERE p.produto = ${produtoNorm}
      `,
    );
    return Number(rows[0]?.total ?? 0n);
  }

  async buscarStatsBatch(
    produtos: string[],
    municipio?: string,
  ): Promise<Map<string, ResumoPreco>> {
    if (produtos.length === 0) return new Map();

    const produtosNorm = produtos.map((p) => p.toLowerCase().trim());
    const cidadeSlug = municipio ? normalizarCidade(municipio) : null;
    const cidadeWhereAtual = cidadeSlug ? Prisma.sql`AND cidade = ${cidadeSlug}` : Prisma.empty;
    const cidadeWhereHist = cidadeSlug ? Prisma.sql`AND p.cidade = ${cidadeSlug}` : Prisma.empty;

    const [rowsAtual, rowsHistorico] = await Promise.all([
      prisma.$queryRaw<{ produto: string; precoMinAtual: number }[]>(
        Prisma.sql`
          SELECT produto, MIN(preco)::float8 AS "precoMinAtual"
          FROM precos
          WHERE produto = ANY(${produtosNorm})
            AND preco > 0
            ${cidadeWhereAtual}
          GROUP BY produto
        `,
      ),
      prisma.$queryRaw<{ produto: string; preco: number; dataColeta: Date }[]>(
        // Cap por produto via ROW_NUMBER: evita que produtos com muito histórico
        // engulam a cota dos demais e produzam stats incompletas.
        Prisma.sql`
          WITH ranked AS (
            SELECT
              p.produto,
              h.preco::float8 AS preco,
              h."dataColeta",
              ROW_NUMBER() OVER (PARTITION BY p.produto ORDER BY h."dataColeta" DESC) AS rn
            FROM precos_historico h
            JOIN precos p ON p.id = h."precoId"
            WHERE p.produto = ANY(${produtosNorm})
              AND h."dataColeta" >= NOW() - INTERVAL '30 days'
              AND h.preco > 0
              ${cidadeWhereHist}
          )
          SELECT produto, preco, "dataColeta"
          FROM ranked
          WHERE rn <= 50
          ORDER BY produto, "dataColeta" ASC
        `,
      ),
    ]);

    const atualMap = new Map(rowsAtual.map((r) => [r.produto, r.precoMinAtual]));

    const historicoMap = new Map<string, { preco: number; dataColeta: Date }[]>();
    for (const row of rowsHistorico) {
      if (!historicoMap.has(row.produto)) historicoMap.set(row.produto, []);
      historicoMap.get(row.produto)!.push(row);
    }

    const result = new Map<string, ResumoPreco>();

    for (const produto of produtosNorm) {
      const precoMinAtual = atualMap.get(produto);
      if (precoMinAtual === undefined) continue;

      const hist = historicoMap.get(produto) ?? [];
      result.set(produto, calcularResumoPreco(precoMinAtual, hist));
    }

    return result;
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

function normalizarEan(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === '' || t === '0') return null;
  return t;
}

function chaveEan(ean: string, cnpj: string): string {
  return `ean:${ean}::${cnpj}`;
}

function chaveProdMerc(produto: string, cnpj: string, mercado: string): string {
  return `pm:${produto}::${cnpj}::${mercado}`;
}

interface Preparado {
  produto: string;
  precoNovo: Prisma.Decimal;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio: string | null;
  ean: string | null;
  unidade: string | null;
  fonte: Fonte;
  dataColeta: Date;
}

function preparar(item: ProdutoPreco, fonte: Fonte, agora: Date): Preparado {
  return {
    produto: item.nome.toLowerCase().trim(),
    precoNovo: new Prisma.Decimal(item.preco),
    mercado: item.mercado.trim(),
    cnpj: item.cnpj?.trim() ?? '',
    cidade: normalizarCidade(item.cidade ?? item.municipio ?? 'desconhecida'),
    municipio: item.municipio ?? null,
    ean: normalizarEan(item.ean),
    unidade: item.unidade ?? null,
    fonte,
    dataColeta: item.dataColeta ? new Date(item.dataColeta) : agora,
  };
}

function toPrecoRow(row: Preco): PrecoRow {
  return {
    id: row.id,
    produto: row.produto,
    preco: Number(row.preco),
    precoAnterior: row.precoAnterior != null ? Number(row.precoAnterior) : null,
    mercado: row.mercado,
    cnpj: row.cnpj,
    cidade: row.cidade,
    municipio: row.municipio,
    ean: row.ean,
    unidade: row.unidade,
    fonte: row.fonte as FonteColeta,
    dataColeta: row.dataColeta,
    atualizadoEm: row.atualizadoEm,
    criadoEm: row.criadoEm,
  };
}

type HistoricoJoinRow = {
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
  registradoEm: Date;
  atualizadoEm: Date;
};

function mapHistoricoJoinRow(row: HistoricoJoinRow): PrecoRow {
  return {
    id: row.id,
    produto: row.produto,
    preco: Number(row.preco),
    precoAnterior: null,
    mercado: row.mercado,
    cnpj: row.cnpj,
    cidade: row.cidade,
    municipio: row.municipio,
    ean: row.ean,
    unidade: row.unidade,
    fonte: row.fonte as FonteColeta,
    dataColeta: row.dataColeta,
    atualizadoEm: row.atualizadoEm,
    criadoEm: row.registradoEm,
  };
}
