import { Router } from 'express';
import { buscar, historico } from './scraper.controller';
import { limiterLeitura } from '../../shared/middleware/rate-limiter';

export const scraperRouter = Router();

/**
 * GET /buscar?produto=arroz&cidade=teixeira-de-freitas&dias=7&limite=50
 * GET /produtos/buscar?termo=arroz&municipio=Salvador&dias=7&limite=50
 *
 * Lê do banco de dados — resposta imediata, sem scraping ao vivo.
 * Retorna o preço mais recente por mercado para o termo buscado.
 * O banco é populado pelo cron job (a cada hora) ou por POST /coleta/disparar.
 */
scraperRouter.get('/buscar', limiterLeitura, buscar);
scraperRouter.get('/produtos/buscar', limiterLeitura, buscar);

/**
 * GET /produtos/historico?produto=arroz&municipio=Salvador&limite=50
 *
 * Histórico completo de um produto.
 * Filtros opcionais: dataInicio, dataFim (ISO 8601), municipio, limite.
 */
scraperRouter.get('/produtos/historico', limiterLeitura, historico);
