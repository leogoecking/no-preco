import { Request, Response } from 'express';
import { precoRepository } from '../preco/preco.repository';
import { buscarProdutos } from './scraper.service';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';
import { withCache } from '../../shared/cache/with-cache';
import { Logger } from '../../shared/logger/logger';
import { BuscarQuery, BuscarEanQuery, HistoricoQuery } from './scraper.schemas';

const log = new Logger('ScraperController');

export async function buscar(req: Request, res: Response): Promise<void> {
  const { produto, termo, cidade, municipio, dias, limite } = req.validatedQuery as BuscarQuery;
  const termoBusca = (produto ?? termo)!;
  const cidadeFiltro = cidade ?? municipio;

  const resposta = await withCache(
    cacheRapido,
    buildKey('busca', { termo: termoBusca, cidade: cidadeFiltro, dias, limite }),
    async () => {
      let itens = await precoRepository.buscarPorTermo(termoBusca, {
        cidade: cidadeFiltro,
        diasRecentes: dias,
        limite,
      });

      let fonte: 'banco_de_dados' | 'scrape_ao_vivo' = 'banco_de_dados';

      if (itens.length === 0) {
        log.info('Banco sem resultados — acionando scrape ao vivo', {
          termo: termoBusca,
          cidade: cidadeFiltro,
        });

        fonte = 'scrape_ao_vivo';
        const resultado = await buscarProdutos({ termo: termoBusca, municipio: cidadeFiltro });

        if (resultado.itens.length > 0) {
          await precoRepository.salvarLote(resultado.itens, 'api');
          itens = await precoRepository.buscarPorTermo(termoBusca, {
            cidade: cidadeFiltro,
            diasRecentes: 1,
            limite,
          });

          // Fallback: usa os itens do scraper direto se o banco ainda não os indexou
          if (itens.length === 0) {
            itens = resultado.itens.map((i) => ({
              produto: i.nome,
              preco: i.preco,
              mercado: i.mercado,
              cnpj: i.cnpj,
              cidade: i.cidade ?? i.municipio ?? '',
              municipio: i.municipio,
              unidade: i.unidade,
              dataColeta: i.dataColeta ? new Date(i.dataColeta) : new Date(),
            }));
          }
        }
      }

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

  let itens = await precoRepository.buscarPorEan(ean, { cidade: cidadeFiltro, diasRecentes: 7 });
  let fonte: 'banco_de_dados' | 'scrape_ao_vivo' = 'banco_de_dados';

  if (itens.length === 0) {
    fonte = 'scrape_ao_vivo';
    const resultado = await buscarProdutos({ termo: ean, ean, municipio: cidadeFiltro });

    if (resultado.itens.length > 0) {
      await precoRepository.salvarLote(resultado.itens, 'api');
      itens = await precoRepository.buscarPorEan(ean, { cidade: cidadeFiltro, diasRecentes: 1 });

      if (itens.length === 0) {
        itens = resultado.itens.map((i) => ({
          produto: i.nome,
          preco: i.preco,
          mercado: i.mercado,
          cnpj: i.cnpj,
          cidade: i.cidade ?? i.municipio ?? '',
          municipio: i.municipio,
          unidade: i.unidade,
          dataColeta: i.dataColeta ? new Date(i.dataColeta) : new Date(),
        }));
      }
    }
  }

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
