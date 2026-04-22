import { Request, Response } from 'express';
import { precoRepository, PrecoRecente } from '../preco/preco.repository';
import { buscarProdutos } from './scraper.service';
import { ProdutoPreco, ResultadoBusca } from './scraper.types';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';
import { withCache } from '../../shared/cache/with-cache';
import { Logger } from '../../shared/logger/logger';
import { BuscarQuery, BuscarEanQuery, HistoricoQuery } from './scraper.schemas';

const log = new Logger('ScraperController');

type Fonte = 'banco_de_dados' | 'scrape_ao_vivo';

export async function buscar(req: Request, res: Response): Promise<void> {
  const { produto, termo, cidade, municipio, dias, limite } = req.validatedQuery as BuscarQuery;
  const termoBusca = (produto ?? termo)!;
  const cidadeFiltro = cidade ?? municipio;

  const resposta = await withCache(
    cacheRapido,
    buildKey('busca', { termo: termoBusca, cidade: cidadeFiltro, dias, limite }),
    async () => {
      const { itens, fonte } = await buscarComFallbackScrape({
        termoLog: termoBusca,
        diasNormal: dias,
        buscarNoBanco: (diasRecentes) =>
          precoRepository.buscarPorTermo(termoBusca, {
            cidade: cidadeFiltro,
            diasRecentes,
            limite,
          }),
        buscarNoScraper: () => buscarProdutos({ termo: termoBusca, municipio: cidadeFiltro }),
      });

      return {
        produto: termoBusca,
        cidade: cidadeFiltro,
        municipio: cidadeFiltro,
        diasConsultados: dias,
        totalItens: itens.length,
        fonte,
        atualizadoVia: fonte === 'banco_de_dados' ? 'coleta_agendada' : 'scrape_ao_vivo',
        itens,
      };
    },
  );
  res.status(200).json(resposta);
}

export async function buscarPorEan(req: Request, res: Response): Promise<void> {
  const ean = req.params['ean'] as string;
  const { cidade, municipio } = req.validatedQuery as BuscarEanQuery;
  const cidadeFiltro = cidade ?? municipio;

  const chave = buildKey('ean', { ean, cidade: cidadeFiltro });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  const { itens, fonte } = await buscarComFallbackScrape({
    termoLog: ean,
    diasNormal: 7,
    buscarNoBanco: (diasRecentes) =>
      precoRepository.buscarPorEan(ean, { cidade: cidadeFiltro, diasRecentes }),
    buscarNoScraper: () => buscarProdutos({ termo: ean, ean, municipio: cidadeFiltro }),
  });

  const resposta = { ean, cidade: cidadeFiltro, totalItens: itens.length, fonte, itens };
  if (itens.length > 0) cacheRapido.set(chave, resposta);
  res.status(200).json(resposta);
}

export async function historico(req: Request, res: Response): Promise<void> {
  const { produto, municipio, limite, dataInicio, dataFim } = req.validatedQuery as HistoricoQuery;

  const dataInicioDate = dataInicio ? new Date(dataInicio) : undefined;
  const dataFimDate = dataFim ? new Date(dataFim) : undefined;

  const resposta = await withCache(
    cacheRapido,
    buildKey('historico', { produto, municipio, limite, dataInicio, dataFim }),
    async () => {
      const [itens, total] = await Promise.all([
        precoRepository.buscarHistorico(produto, {
          dataInicio: dataInicioDate,
          dataFim: dataFimDate,
          municipio,
          limite,
        }),
        precoRepository.contarRegistros(produto),
      ]);
      return { produto, municipio, totalRegistros: total, retornados: itens.length, itens };
    },
  );
  res.status(200).json(resposta);
}

interface FallbackParams {
  termoLog: string;
  diasNormal: number;
  buscarNoBanco: (diasRecentes: number) => Promise<PrecoRecente[]>;
  buscarNoScraper: () => Promise<ResultadoBusca>;
}

async function buscarComFallbackScrape(
  params: FallbackParams,
): Promise<{ itens: PrecoRecente[]; fonte: Fonte }> {
  const itensIniciais = await params.buscarNoBanco(params.diasNormal);
  if (itensIniciais.length > 0) return { itens: itensIniciais, fonte: 'banco_de_dados' };

  log.info('Banco sem resultados — acionando scrape ao vivo', { termo: params.termoLog });

  const resultado = await params.buscarNoScraper();
  if (resultado.itens.length === 0) return { itens: [], fonte: 'scrape_ao_vivo' };

  await precoRepository.salvarLote(resultado.itens, 'api');
  const reconsulta = await params.buscarNoBanco(1);

  // Fallback: usa os itens do scraper direto se o banco ainda não os indexou
  const itens = reconsulta.length > 0 ? reconsulta : resultado.itens.map(mapScrapeItemParaRecente);
  return { itens, fonte: 'scrape_ao_vivo' };
}

function mapScrapeItemParaRecente(i: ProdutoPreco): PrecoRecente {
  return {
    produto: i.nome,
    preco: i.preco,
    mercado: i.mercado,
    cnpj: i.cnpj,
    cidade: i.cidade ?? i.municipio ?? '',
    municipio: i.municipio,
    unidade: i.unidade,
    dataColeta: i.dataColeta ? new Date(i.dataColeta) : new Date(),
  };
}
