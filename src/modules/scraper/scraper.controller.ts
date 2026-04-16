import { Request, Response } from 'express';
import { precoRepository } from '../preco/preco.repository';

// ─────────────────────────────────────────────
// GET /buscar?produto=arroz&cidade=teixeira-de-freitas&dias=7&limite=50
// GET /produtos/buscar?termo=arroz&municipio=Salvador&dias=7&limite=50
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

  try {
    const itens = await precoRepository.buscarPorTermo(termo, {
      cidade: cidadeFiltro,
      diasRecentes: dias,
      limite,
    });

    res.status(200).json({
      produto: termo,
      cidade: cidadeFiltro,
      municipio: cidadeFiltro,
      diasConsultados: dias,
      totalItens: itens.length,
      // Informa explicitamente a origem dos dados para o frontend
      fonte: 'banco_de_dados',
      atualizadoVia: 'coleta_agendada',
      itens,
    });
  } catch (err) {
    console.error('[controller] Erro ao buscar no banco:', err);
    res.status(500).json({ erro: 'Erro ao consultar o banco de dados.' });
  }
}

// ─────────────────────────────────────────────
// GET /produtos/historico?produto=arroz&municipio=Salvador&limite=50
// Histórico completo de um produto com filtros de data.
// ─────────────────────────────────────────────

export async function historico(req: Request, res: Response): Promise<void> {
  const produto = String(req.query['produto'] ?? '').trim();
  const municipio = req.query['municipio'] ? String(req.query['municipio']).trim() : undefined;
  const limite = req.query['limite'] ? Number(req.query['limite']) : 100;
  const dataInicio = req.query['dataInicio'] ? new Date(String(req.query['dataInicio'])) : undefined;
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

  try {
    const [itens, total] = await Promise.all([
      precoRepository.buscarHistorico(produto, { dataInicio, dataFim, municipio, limite }),
      precoRepository.contarRegistros(produto),
    ]);

    res.status(200).json({
      produto,
      municipio,
      totalRegistros: total,
      retornados: itens.length,
      itens,
    });
  } catch (err) {
    console.error('[controller] Erro ao buscar histórico:', err);
    res.status(500).json({ erro: 'Erro ao consultar histórico no banco de dados.' });
  }
}
