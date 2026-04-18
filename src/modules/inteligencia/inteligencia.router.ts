import { Router } from 'express';
import { alertas, estatisticas, volatilidade } from './inteligencia.controller';
import { validateQuery } from '../../shared/validation/validate';
import {
  EstatisticasQuerySchema,
  VolatilidadeQuerySchema,
  AlertasQuerySchema,
} from './inteligencia.schemas';

export const inteligenciaRouter = Router();

inteligenciaRouter.get(
  '/inteligencia/estatisticas',
  validateQuery(EstatisticasQuerySchema),
  estatisticas,
);
inteligenciaRouter.get(
  '/inteligencia/volatilidade',
  validateQuery(VolatilidadeQuerySchema),
  volatilidade,
);
inteligenciaRouter.get('/inteligencia/alertas', validateQuery(AlertasQuerySchema), alertas);
