import { Router } from 'express';
import { disparar, status } from './coleta.controller';
import { limiterColeta } from '../../shared/middleware/rate-limiter';

export const coletaRouter = Router();

/**
 * POST /coleta/disparar
 * Dispara coleta em background. Retorna 202 imediatamente.
 * Rate limit: 10 req/hora por IP.
 *
 * Body opcional: { "produto": "arroz 5kg", "municipio": "Salvador" }
 * Sem body: executa o ciclo completo da lista configurada.
 */
coletaRouter.post('/coleta/disparar', limiterColeta, disparar);

/**
 * GET /coleta/status
 * Retorna se há coleta em andamento e o relatório da última execução.
 */
coletaRouter.get('/coleta/status', status);
