import { Router } from 'express';
import { buscar, buscarPorEan, historico } from './scraper.controller';
import { limiterLeitura } from '../../shared/middleware/rate-limiter';
import { validateQuery, validateParams } from '../../shared/validation/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import {
  BuscarQuerySchema,
  BuscarEanParamsSchema,
  BuscarEanQuerySchema,
  HistoricoQuerySchema,
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
