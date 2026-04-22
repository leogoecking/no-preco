import { Router } from 'express';
import { disparar, status } from './coleta.controller';
import { limiterColeta } from '../../shared/middleware/rate-limiter';
import { autenticar } from '../../shared/middleware/auth.middleware';
import { validateBody } from '../../shared/validation/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { DispararBodySchema } from './coleta.schemas';

export const coletaRouter = Router();

coletaRouter.post(
  '/coleta/disparar',
  autenticar,
  limiterColeta,
  validateBody(DispararBodySchema),
  asyncHandler(disparar),
);

coletaRouter.get('/coleta/status', status);
