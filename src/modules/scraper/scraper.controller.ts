import { Request, Response } from 'express';
import { precoRepository } from '../preco/preco.repository';
import { buscarProdutos } from './scraper.service';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';
import { BuscarQuery, BuscarEanQuery, HistoricoQuery } from './scraper.schemas';

export async function buscar(req: Request, res: Response): Promise<void> {
  const { produto, termo, cidade, municipio, dias, limite } = req.query as unknown as BuscarQuery;
  const termoBusca = (produto ?? termo)!;
  const cidadeFiltro = cidade ?? municipio;

  const chave = buildKey('busca', { termo: termoBusca, cidade: cidadeFiltro, dias, limite });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const itens = await precoRepository.buscarPorTermo(termoBusca, {
      cidade: cidadeFiltro,
      diasRecentes: dias,
      limite,
    });

    const resposta = {
      produto: termoBusca,
      cidade: cidadeFiltro,
      municipio: cidadeFiltro,
      diasConsultados: dias,
      totalItens: itens.length,
      fonte: 'banco_de_dados',
      atualizadoVia: 'coleta_agendada',
      itens,
    };

    cacheRapido.set(chave, resposta);
    res.status(200).json(resposta);
  } catch (err) {
    console.error('[controller] Erro ao buscar no banco:', err);
    res.status(500).json({ erro: 'Erro ao consultar o banco de dados.' });
  }
}

export async function buscarPorEan(req: Request, res: Response): Promise<void> {
  const ean = req.params['ean'] as string;
  const { cidade, municipio } = req.query as unknown as BuscarEanQuery;
  const cidadeFiltro = cidade ?? municipio;

  const chave = buildKey('ean', { ean, cidade: cidadeFiltro });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
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
  } catch (err) {
    console.error('[controller] Erro ao buscar por EAN:', err);
    res.status(500).json({ erro: 'Erro ao consultar preços por EAN.' });
  }
}

export async function historico(req: Request, res: Response): Promise<void> {
  const { produto, municipio, limite, dataInicio, dataFim } =
    req.query as unknown as HistoricoQuery;

  const dataInicioDate = dataInicio ? new Date(dataInicio) : undefined;
  const dataFimDate = dataFim ? new Date(dataFim) : undefined;

  const chave = buildKey('historico', { produto, municipio, limite, dataInicio, dataFim });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const [itens, total] = await Promise.all([
      precoRepository.buscarHistorico(produto, {
        dataInicio: dataInicioDate,
        dataFim: dataFimDate,
        municipio,
        limite,
      }),
      precoRepository.contarRegistros(produto),
    ]);

    const resposta = { produto, municipio, totalRegistros: total, retornados: itens.length, itens };
    cacheRapido.set(chave, resposta);
    res.status(200).json(resposta);
  } catch (err) {
    console.error('[controller] Erro ao buscar histórico:', err);
    res.status(500).json({ erro: 'Erro ao consultar histórico no banco de dados.' });
  }
}
