import { Router } from 'express';
import { analisar } from './analise.controller';

export const analiseRouter = Router();

/**
 * POST /analise/carrinho
 *
 * Body JSON:
 * {
 *   "municipio": "Salvador",          // opcional
 *   "itens": [
 *     { "produto": "arroz 5kg",  "quantidade": 1 },
 *     { "produto": "feijão 1kg", "quantidade": 2 }
 *   ]
 * }
 *
 * Retorna comparativo entre:
 *   opcao1_mercadoUnico   — mercado com menor soma total
 *   opcao2_combinacaoOtima — melhor preço por item em qualquer mercado
 */
analiseRouter.post('/analise/carrinho', analisar);
