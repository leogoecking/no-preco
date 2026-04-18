import { Request, Response } from 'express';
import { precoRepository } from '../preco/preco.repository';
import { buscarProdutos } from './scraper.service';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';

// ─────────────────────────────────────────────
// GET /buscar?produto=arroz&cidade=teixeira-de-freitas&dias=7&limite=50
// GET /produtos/buscar?termo=arroz&municipio=Teixeira%20de%20Freitas&dias=7&limite=50
//
// Lê EXCLUSIVAMENTE do banco de dados.
// O scraping acontece em background (cron job a cada hora ou POST /coleta/disparar).
// O usuário recebe resposta imediata — nunca espera uma requisição externa.
// ─────────────────────────────────────────────

export async function buscar(req: Request, res: Response): Promise<void> {
  const termo = String(req.query['produto'] ?? req.query['termo'] ?? '').trim();
  const cidade = req.query['cidade'] ? String(req.query['cidade']).trim() : undefined;
  const municipio = req.query['municipio'] ? String(req.query['municipio']).trim() : undefined;
  const cidadeFiltro = cidade ?? municipio;
  const dias = req.query['dias'] ? Number(req.query['dias']) : 7;
  const limite = req.query['limite'] ? Number(req.query['limite']) : 100;

  if (!termo) {
    res.status(400).json({ erro: 'Parâmetro "produto" é obrigatório.' });
    return;
  }

  if (isNaN(dias) || dias < 1 || dias > 90) {
    res.status(400).json({ erro: 'Parâmetro "dias" deve ser entre 1 e 90.' });
    return;
  }

  if (isNaN(limite) || limite < 1 || limite > 200) {
    res.status(400).json({ erro: 'Parâmetro "limite" deve ser entre 1 e 200.' });
    return;
  }

  const chave = buildKey('busca', { termo, cidade: cidadeFiltro, dias, limite });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const itens = await precoRepository.buscarPorTermo(termo, {
      cidade: cidadeFiltro,
      diasRecentes: dias,
      limite,
    });

    const resposta = {
      produto: termo,
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

// ─────────────────────────────────────────────
// GET /buscar/ean/:ean?municipio=Teixeira+de+Freitas&cidade=teixeira-de-freitas
//
// Busca por código de barras EAN/GTIN (8, 12, 13 ou 14 dígitos).
// Fluxo:
//   1. Verifica no banco se há dados recentes (últimos 7 dias)
//   2. Se não há, faz scrape ao vivo usando o EAN como termo de busca
//   3. Salva os resultados no banco para consultas futuras
// ─────────────────────────────────────────────

export async function buscarPorEan(req: Request, res: Response): Promise<void> {
  const ean = String(req.params['ean'] ?? '')
    .trim()
    .replace(/\D/g, '');
  const cidade = req.query['cidade'] ? String(req.query['cidade']).trim() : undefined;
  const municipio = req.query['municipio'] ? String(req.query['municipio']).trim() : undefined;
  const cidadeFiltro = cidade ?? municipio;

  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(ean)) {
    res.status(400).json({
      erro: 'EAN/GTIN inválido. Deve conter 8, 12, 13 ou 14 dígitos numéricos.',
      exemplo: '/buscar/ean/7891234567890',
    });
    return;
  }

  const chave = buildKey('ean', { ean, cidade: cidadeFiltro });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    // Tenta banco primeiro (dados recentes dos últimos 7 dias)
    let itens = await precoRepository.buscarPorEan(ean, { cidade: cidadeFiltro, diasRecentes: 7 });

    let fonte: 'banco_de_dados' | 'scrape_ao_vivo' = 'banco_de_dados';

    if (itens.length === 0) {
      // Sem dados no banco — busca ao vivo na fonte
      fonte = 'scrape_ao_vivo';
      const resultado = await buscarProdutos({ termo: ean, ean, municipio: cidadeFiltro });

      if (resultado.itens.length > 0) {
        await precoRepository.salvarLote(resultado.itens, 'api');
        itens = await precoRepository.buscarPorEan(ean, { cidade: cidadeFiltro, diasRecentes: 1 });

        // Fallback: se o EAN não voltou salvo (API não retornou o campo), usa os itens diretos
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

    const resposta = {
      ean,
      cidade: cidadeFiltro,
      totalItens: itens.length,
      fonte,
      itens,
    };

    if (itens.length > 0) cacheRapido.set(chave, resposta);
    res.status(200).json(resposta);
  } catch (err) {
    console.error('[controller] Erro ao buscar por EAN:', err);
    res.status(500).json({ erro: 'Erro ao consultar preços por EAN.' });
  }
}

// ─────────────────────────────────────────────
// GET /produtos/historico?produto=arroz&municipio=Teixeira%20de%20Freitas&limite=50
// Histórico completo de um produto com filtros de data.
// ─────────────────────────────────────────────

export async function historico(req: Request, res: Response): Promise<void> {
  const produto = String(req.query['produto'] ?? '').trim();
  const municipio = req.query['municipio'] ? String(req.query['municipio']).trim() : undefined;
  const limite = req.query['limite'] ? Number(req.query['limite']) : 100;
  const dataInicio = req.query['dataInicio']
    ? new Date(String(req.query['dataInicio']))
    : undefined;
  const dataFim = req.query['dataFim'] ? new Date(String(req.query['dataFim'])) : undefined;

  if (!produto) {
    res.status(400).json({ erro: 'Parâmetro "produto" é obrigatório.' });
    return;
  }

  if (isNaN(limite) || limite < 1 || limite > 500) {
    res.status(400).json({ erro: 'Parâmetro "limite" deve ser entre 1 e 500.' });
    return;
  }

  if (dataInicio && isNaN(dataInicio.getTime())) {
    res.status(400).json({ erro: 'Parâmetro "dataInicio" é uma data inválida.' });
    return;
  }

  if (dataFim && isNaN(dataFim.getTime())) {
    res.status(400).json({ erro: 'Parâmetro "dataFim" é uma data inválida.' });
    return;
  }

  const chave = buildKey('historico', {
    produto,
    municipio,
    limite,
    dataInicio: dataInicio?.toISOString(),
    dataFim: dataFim?.toISOString(),
  });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const [itens, total] = await Promise.all([
      precoRepository.buscarHistorico(produto, { dataInicio, dataFim, municipio, limite }),
      precoRepository.contarRegistros(produto),
    ]);

    const resposta = {
      produto,
      municipio,
      totalRegistros: total,
      retornados: itens.length,
      itens,
    };

    cacheRapido.set(chave, resposta);
    res.status(200).json(resposta);
  } catch (err) {
    console.error('[controller] Erro ao buscar histórico:', err);
    res.status(500).json({ erro: 'Erro ao consultar histórico no banco de dados.' });
  }
}
