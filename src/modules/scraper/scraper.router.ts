import { Router } from 'express';
import { buscar, buscarPorEan, historico } from './scraper.controller';
import { limiterLeitura } from '../../shared/middleware/rate-limiter';
import { validateQuery, validateParams } from '../../shared/validation/validate';
import {
  BuscarQuerySchema,
  BuscarEanParamsSchema,
  BuscarEanQuerySchema,
  HistoricoQuerySchema,
} from './scraper.schemas';

export const scraperRouter = Router();

scraperRouter.get('/buscar', limiterLeitura, validateQuery(BuscarQuerySchema), buscar);
scraperRouter.get(
  '/buscar/ean/:ean',
  limiterLeitura,
  validateParams(BuscarEanParamsSchema),
  validateQuery(BuscarEanQuerySchema),
  buscarPorEan,
);
scraperRouter.get(
  '/produtos/historico',
  limiterLeitura,
  validateQuery(HistoricoQuerySchema),
  historico,
);
