import { ErrorRequestHandler } from 'express';
import { Logger } from '../logger/logger';

const log = new Logger('ErrorHandler');

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  log.error('Erro não tratado na requisição', {
    method: req.method,
    path: req.path,
    erro: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (res.headersSent) return;

  res.status(500).json({ erro: 'Erro interno ao processar a requisição.' });
};
