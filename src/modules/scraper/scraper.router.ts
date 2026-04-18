import { Router } from 'express';
import { buscar, buscarPorEan, historico } from './scraper.controller';
import { limiterLeitura } from '../../shared/middleware/rate-limiter';

export const scraperRouter = Router();

/**
 * GET /buscar?produto=arroz&cidade=teixeira-de-freitas&dias=7&limite=50
 * GET /produtos/buscar?termo=arroz&municipio=Teixeira%20de%20Freitas&dias=7&limite=50
 *
 * Lê do banco de dados — resposta imediata, sem scraping ao vivo.
 * Retorna o preço mais recente por mercado para o termo buscado.
 * O banco é populado pelo cron job (a cada hora) ou por POST /coleta/disparar.
 */
scraperRouter.get('/buscar', limiterLeitura, buscar);
scraperRouter.get('/produtos/buscar', limiterLeitura, buscar);

/**
 * GET /buscar/ean/:ean?municipio=Teixeira+de+Freitas
 *
 * Busca por código de barras EAN/GTIN (8, 12, 13 ou 14 dígitos).
 * Consulta o banco primeiro; se sem dados recentes, faz scrape ao vivo.
 */
scraperRouter.get('/buscar/ean/:ean', limiterLeitura, buscarPorEan);

/**
 * GET /produtos/historico?produto=arroz&municipio=Teixeira%20de%20Freitas&limite=50
 *
 * Histórico completo de um produto.
 * Filtros opcionais: dataInicio, dataFim (ISO 8601), municipio, limite.
 */
scraperRouter.get('/produtos/historico', limiterLeitura, historico);
