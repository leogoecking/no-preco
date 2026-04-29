import { Router } from 'express';
import { buscar, buscarPorEan, diag, historico, stats } from './scraper.controller';
import { limiterLeitura } from '../../shared/middleware/rate-limiter';
import { validateQuery, validateParams, validateBody } from '../../shared/validation/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import {
  BuscarQuerySchema,
  BuscarEanParamsSchema,
  BuscarEanQuerySchema,
  HistoricoQuerySchema,
  StatsBodySchema,
} from './scraper.schemas';

export const scraperRouter = Router();

scraperRouter.get(
  '/buscar',
  limiterLeitura,
  validateQuery(BuscarQuerySchema),
  asyncHandler(buscar),
);
scraperRouter.get(
  '/buscar/ean/:ean',
  limiterLeitura,
  validateParams(BuscarEanParamsSchema),
  validateQuery(BuscarEanQuerySchema),
  asyncHandler(buscarPorEan),
);
scraperRouter.get(
  '/produtos/historico',
  limiterLeitura,
  validateQuery(HistoricoQuerySchema),
  asyncHandler(historico),
);
scraperRouter.post(
  '/produtos/stats',
  limiterLeitura,
  validateBody(StatsBodySchema),
  asyncHandler(stats),
);
scraperRouter.get('/produtos/diag', limiterLeitura, diag);
