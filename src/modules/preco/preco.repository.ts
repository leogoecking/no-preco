import { PrecoDocument, PrecoModel } from './preco.model';
import { ProdutoPreco } from '../scraper/scraper.types';

// ─────────────────────────────────────────────
// Interface pública do Repository
// ─────────────────────────────────────────────

export interface HistoricoOptions {
  dataInicio?: Date;
  dataFim?: Date;
  cidade?: string;
  municipio?: string;
  /** Máximo de registros retornados (padrão: 100) */
  limite?: number;
}

export interface BuscaTermoOptions {
  cidade?: string;
  municipio?: string;
  /** Apenas preços coletados nos últimos N dias (padrão: 7) */
  diasRecentes?: number;
  /** Máximo de registros (padrão: 100) */
  limite?: number;
}

export interface PrecoRecente {
  produto: string;
  preco: number;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio?: string;
  unidade?: string;
  dataColeta: Date;
}

export interface IPrecoRepository {
  salvarLote(itens: ProdutoPreco[], fonte: 'api' | 'html'): Promise<PrecoDocument[]>;
  buscarPorTermo(termo: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarPorEan(ean: string, opcoes?: BuscaTermoOptions): Promise<PrecoRecente[]>;
  buscarHistorico(produto: string, opcoes?: HistoricoOptions): Promise<PrecoDocument[]>;
  buscarUltimoPreco(produto: string, municipio?: string): Promise<PrecoDocument | null>;
  contarRegistros(produto: string): Promise<number>;
}

// ─────────────────────────────────────────────
// Implementação com Mongoose
// ─────────────────────────────────────────────

export class PrecoRepository implements IPrecoRepository {
  /**
   * Persiste um lote de preços coletados.
   * Usa insertMany com ordered:false para continuar após falhas individuais
   * (ex: violação de índice único em um item não cancela o restante).
   */
  async salvarLote(itens: ProdutoPreco[], fonte: 'api' | 'html'): Promise<PrecoDocument[]> {
    if (itens.length === 0) return [];

    const docs = itens.map((item) => ({
      produto: item.nome,
      preco: item.preco,
      mercado: item.mercado,
      cnpj: item.cnpj,
      cidade: normalizarCidade(item.cidade ?? item.municipio ?? 'desconhecida'),
      municipio: item.municipio,
      unidade: item.unidade,
      ean: item.ean,
      dataColeta: item.dataColeta ? new Date(item.dataColeta) : new Date(),
      fonte,
    }));

    try {
      const resultado = await PrecoModel.insertMany(docs, {
        ordered: false,
        // Retorna os documentos completos com _id gerado
        rawResult: false,
      });

      console.log(`[repository] ${resultado.length}/${itens.length} preços salvos`);
      return resultado as unknown as PrecoDocument[];
    } catch (err: unknown) {
      // BulkWriteError: alguns documentos foram inseridos, outros falharam
      // (ex: duplicate key) — loga mas não lança, pois inserções parciais são OK
      if (isBulkWriteError(err)) {
        const inserted = err.result?.nInserted ?? 0;
        console.warn(
          `[repository] Inserção parcial: ${inserted}/${itens.length} salvos (duplicatas ignoradas)`,
        );
        return [];
      }
      throw new RepositoryError('Falha ao salvar lote de preços', err);
    }
  }

  /**
   * Busca os preços mais recentes para um termo de pesquisa via agregação.
   * Retorna o menor preço por mercado (deduplicado), ordenado do mais barato.
   * Esta é a query usada pela rota de busca do usuário — lê apenas do banco.
   */
  async buscarPorTermo(termo: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    const { cidade, municipio, diasRecentes = 7, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;

    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - diasRecentes);

    const match: Record<string, unknown> = {
      produto: { $regex: termo.toLowerCase().trim(), $options: 'i' },
      dataColeta: { $gte: dataLimite },
    };

    if (cidadeFiltro) {
      match['cidade'] = normalizarCidade(cidadeFiltro);
    }

    try {
      const resultado = await PrecoModel.aggregate<PrecoRecente>([
        { $match: match },
        { $sort: { dataColeta: -1 } },
        // Preço mais recente por (produto, mercado)
        {
          $group: {
            _id: { produto: '$produto', mercado: '$mercado', cnpj: '$cnpj' },
            preco: { $first: '$preco' },
            cidade: { $first: '$cidade' },
            municipio: { $first: '$municipio' },
            unidade: { $first: '$unidade' },
            dataColeta: { $first: '$dataColeta' },
          },
        },
        {
          $project: {
            _id: 0,
            produto: '$_id.produto',
            mercado: '$_id.mercado',
            cnpj: '$_id.cnpj',
            preco: 1,
            cidade: 1,
            municipio: 1,
            unidade: 1,
            dataColeta: 1,
          },
        },
        // Mais baratos primeiro
        { $sort: { preco: 1 } },
        { $limit: limite },
      ]).exec();

      return resultado;
    } catch (err) {
      throw new RepositoryError(`Falha ao buscar preços para "${termo}"`, err);
    }
  }

  /**
   * Busca preços recentes por EAN/GTIN exato.
   * Retorna o menor preço por mercado, ordenado do mais barato.
   */
  async buscarPorEan(ean: string, opcoes: BuscaTermoOptions = {}): Promise<PrecoRecente[]> {
    const { cidade, municipio, diasRecentes = 7, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;

    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - diasRecentes);

    const match: Record<string, unknown> = {
      ean: ean.trim(),
      dataColeta: { $gte: dataLimite },
    };

    if (cidadeFiltro) {
      match['cidade'] = normalizarCidade(cidadeFiltro);
    }

    try {
      const resultado = await PrecoModel.aggregate<PrecoRecente>([
        { $match: match },
        { $sort: { dataColeta: -1 } },
        {
          $group: {
            _id: { produto: '$produto', mercado: '$mercado', cnpj: '$cnpj' },
            preco: { $first: '$preco' },
            cidade: { $first: '$cidade' },
            municipio: { $first: '$municipio' },
            unidade: { $first: '$unidade' },
            dataColeta: { $first: '$dataColeta' },
          },
        },
        {
          $project: {
            _id: 0,
            produto: '$_id.produto',
            mercado: '$_id.mercado',
            cnpj: '$_id.cnpj',
            preco: 1,
            cidade: 1,
            municipio: 1,
            unidade: 1,
            dataColeta: 1,
          },
        },
        { $sort: { preco: 1 } },
        { $limit: limite },
      ]).exec();

      return resultado;
    } catch (err) {
      throw new RepositoryError(`Falha ao buscar preços para EAN "${ean}"`, err);
    }
  }

  /**
   * Retorna o histórico de preços de um produto, do mais recente para o mais antigo.
   * Aplica filtros opcionais de data e município.
   */
  async buscarHistorico(produto: string, opcoes: HistoricoOptions = {}): Promise<PrecoDocument[]> {
    const { dataInicio, dataFim, cidade, municipio, limite = 100 } = opcoes;
    const cidadeFiltro = cidade ?? municipio;

    const filtro: Record<string, unknown> = {
      produto: produto.toLowerCase().trim(),
    };

    if (dataInicio || dataFim) {
      filtro['dataColeta'] = {
        ...(dataInicio ? { $gte: dataInicio } : {}),
        ...(dataFim ? { $lte: dataFim } : {}),
      };
    }

    if (cidadeFiltro) {
      filtro['cidade'] = normalizarCidade(cidadeFiltro);
    }

    try {
      return await PrecoModel.find(filtro)
        .sort({ dataColeta: -1 })
        .limit(limite)
        .lean<PrecoDocument[]>()
        .exec();
    } catch (err) {
      throw new RepositoryError(`Falha ao buscar histórico de "${produto}"`, err);
    }
  }

  /**
   * Retorna o registro mais recente de um produto, opcionalmente filtrado por município.
   * Útil para exibir "preço atual" sem carregar o histórico completo.
   */
  async buscarUltimoPreco(produto: string, municipio?: string): Promise<PrecoDocument | null> {
    const filtro: Record<string, unknown> = {
      produto: produto.toLowerCase().trim(),
    };

    if (municipio) {
      filtro['cidade'] = normalizarCidade(municipio);
    }

    try {
      return await PrecoModel.findOne(filtro).sort({ dataColeta: -1 }).lean<PrecoDocument>().exec();
    } catch (err) {
      throw new RepositoryError(`Falha ao buscar último preço de "${produto}"`, err);
    }
  }

  /** Retorna quantos registros existem para um produto — útil para paginação */
  async contarRegistros(produto: string): Promise<number> {
    try {
      return await PrecoModel.countDocuments({ produto: produto.toLowerCase().trim() });
    } catch (err) {
      throw new RepositoryError(`Falha ao contar registros de "${produto}"`, err);
    }
  }
}

// ─────────────────────────────────────────────
// Instância singleton exportada
// ─────────────────────────────────────────────

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

interface BulkWriteError extends Error {
  result?: { nInserted?: number };
}

function isBulkWriteError(err: unknown): err is BulkWriteError {
  return err instanceof Error && err.name === 'MongoBulkWriteError';
}

function normalizarCidade(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
