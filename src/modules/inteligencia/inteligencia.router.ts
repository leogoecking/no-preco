import { Router } from 'express';
import { alertas, estatisticas, volatilidade } from './inteligencia.controller';
import { validateQuery } from '../../shared/validation/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import {
  EstatisticasQuerySchema,
  VolatilidadeQuerySchema,
  AlertasQuerySchema,
} from './inteligencia.schemas';

export const inteligenciaRouter = Router();

inteligenciaRouter.get(
  '/inteligencia/estatisticas',
  validateQuery(EstatisticasQuerySchema),
  asyncHandler(estatisticas),
);
inteligenciaRouter.get(
  '/inteligencia/volatilidade',
  validateQuery(VolatilidadeQuerySchema),
  asyncHandler(volatilidade),
);
inteligenciaRouter.get(
  '/inteligencia/alertas',
  validateQuery(AlertasQuerySchema),
  asyncHandler(alertas),
);
