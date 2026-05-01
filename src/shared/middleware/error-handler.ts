import { ErrorRequestHandler } from 'express';
import { Logger } from '../logger/logger';
import { ScraperError } from '../../modules/scraper/scraper.types';

const log = new Logger('ErrorHandler');

const RETRY_AFTER_BLOQUEIO_SEGUNDOS = 60;

function extrairTipoScraper(err: unknown): ScraperError['tipo'] | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const tipo = (err as { tipo?: unknown }).tipo;
  if (
    tipo === 'BLOQUEIO_403' ||
    tipo === 'BLOQUEIO_429' ||
    tipo === 'TIMEOUT' ||
    tipo === 'PARSE_FALHOU' ||
    tipo === 'SEM_RESULTADOS' ||
    tipo === 'ERRO_REDE' ||
    tipo === 'BROWSER_INDISPONIVEL'
  ) {
    return tipo;
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  const tipoScraper = extrairTipoScraper(err);
  const mensagem = err instanceof Error ? err.message : String(err);

  if (tipoScraper === 'BLOQUEIO_429' || tipoScraper === 'BLOQUEIO_403') {
    log.warn('Fonte externa bloqueando — devolvendo 503', {
      method: req.method,
      path: req.path,
      tipo: tipoScraper,
      erro: mensagem,
    });
    if (tipoScraper === 'BLOQUEIO_429') res.setHeader('Retry-After', RETRY_AFTER_BLOQUEIO_SEGUNDOS);
    res.status(503).json({
      erro: 'Fonte de dados temporariamente indisponível. Tente novamente em alguns minutos.',
      tipo: tipoScraper,
    });
    return;
  }

  log.error('Erro não tratado na requisição', {
    method: req.method,
    path: req.path,
    erro: mensagem,
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({ erro: 'Erro interno ao processar a requisição.' });
};
