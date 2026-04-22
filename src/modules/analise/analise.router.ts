import { Router } from 'express';
import { analisar, analisarGet } from './analise.controller';
import { validateQuery, validateBody } from '../../shared/validation/validate';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { CarrinhoGetQuerySchema, CarrinhoPostBodySchema } from './analise.schemas';

export const analiseRouter = Router();

analiseRouter.get(
  '/analise/carrinho',
  validateQuery(CarrinhoGetQuerySchema),
  asyncHandler(analisarGet),
);
analiseRouter.post(
  '/analise/carrinho',
  validateBody(CarrinhoPostBodySchema),
  asyncHandler(analisar),
);
