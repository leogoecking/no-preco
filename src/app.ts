import express, { Application } from 'express';
import { healthRouter } from './modules/health/health.router';
import { scraperRouter } from './modules/scraper/scraper.router';
import { analiseRouter } from './modules/analise/analise.router';
import { coletaRouter } from './modules/coleta/coleta.router';
import { inteligenciaRouter } from './modules/inteligencia/inteligencia.router';
import { limiterGeral, limiterAnalise } from './shared/middleware/rate-limiter';

const app: Application = express();

app.use(express.json());

// Rate limit geral — aplicado a todas as rotas
app.use(limiterGeral);

app.get('/', (_req, res) => {
  res.json({
    nome: 'no-preco-api',
    status: 'online',
    endpoints: {
      health: '/ping',
      buscarProdutos: '/buscar?produto=arroz&cidade=teixeira-de-freitas',
      buscarPorEan: '/buscar/ean/7891234567890?municipio=Teixeira+de+Freitas',
      historicoProdutos: '/produtos/historico?termo=arroz',
      coletaStatus: '/coleta/status',
      analiseCarrinho: '/analise/carrinho?municipio=Teixeira+de+Freitas&itens=arroz:2,feijao:1',
      estatisticas: '/inteligencia/estatisticas',
      volatilidade: '/inteligencia/volatilidade',
      alertas: '/inteligencia/alertas',
    },
  });
});

// Rotas
app.use(healthRouter);
app.use(scraperRouter);
app.use(coletaRouter);

// Análise e inteligência têm limiter próprio por serem agregações pesadas
app.use(limiterAnalise, analiseRouter);
app.use(limiterAnalise, inteligenciaRouter);

export default app;
