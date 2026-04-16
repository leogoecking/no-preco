import { Router } from 'express';
import { alertas, estatisticas, volatilidade } from './inteligencia.controller';
import { limiterAnalise } from '../../shared/middleware/rate-limiter';

export const inteligenciaRouter = Router();

/**
 * GET /inteligencia/estatisticas
 *
 * Estatísticas da janela recente por produto.
 * Query params:
 *   municipio      string          — filtra por município
 *   dias           number 1–90     — janela de análise (padrão 7)
 *   produtos       csv             — ex: "arroz 5kg,feijão 1kg"
 *
 * Retorna: min, max, média, preço atual, variação % vs média.
 */
inteligenciaRouter.get('/inteligencia/estatisticas', limiterAnalise, estatisticas);

/**
 * GET /inteligencia/volatilidade
 *
 * Ranking dos produtos mais voláteis por coeficiente de variação (σ/μ).
 * Query params:
 *   municipio       string          — filtra por município
 *   dias            number 7–365    — janela de análise (padrão 30)
 *   limite          number 1–50     — máximo de produtos (padrão 20)
 *   minimoAmostras  number 2–30     — amostras mínimas para entrar (padrão 5)
 *   produtos        csv             — restringe análise a produtos específicos
 */
inteligenciaRouter.get('/inteligencia/volatilidade', limiterAnalise, volatilidade);

/**
 * GET /inteligencia/alertas
 *
 * Produtos com preço atual abaixo da média histórica de 6 meses.
 * Query params:
 *   municipio       string            — filtra por município
 *   variacaoLimiar  number -100 a -1  — limiar de queda % (padrão -5)
 *   produtos        csv               — restringe a produtos específicos
 *
 * Retorna preço atual, média 6m, variação % e flag ehMinimoHistorico.
 */
inteligenciaRouter.get('/inteligencia/alertas', limiterAnalise, alertas);
