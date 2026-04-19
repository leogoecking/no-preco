import express, { Application } from 'express';
import { healthRouter } from './modules/health/health.router';
import { scraperRouter } from './modules/scraper/scraper.router';
import { analiseRouter } from './modules/analise/analise.router';
import { coletaRouter } from './modules/coleta/coleta.router';
import { inteligenciaRouter } from './modules/inteligencia/inteligencia.router';
import { authRouter } from './modules/auth/auth.router';
import { limiterGeral, limiterAnalise } from './shared/middleware/rate-limiter';

const app: Application = express();

// Confia no primeiro proxy (nginx) para X-Forwarded-For — necessário para o rate limiter
app.set('trust proxy', 1);

app.use(express.json());

// Rate limit geral — aplicado a todas as rotas
app.use(limiterGeral);

app.get('/', (_req, res) => {
  res.json({
    nome: 'no-preco-api',
    status: 'online',
    endpoints: {
      health: '/api/ping',
      buscarProdutos: '/api/buscar?produto=arroz&cidade=teixeira-de-freitas',
      buscarPorEan: '/api/buscar/ean/7891234567890?municipio=Teixeira+de+Freitas',
      historicoProdutos: '/api/produtos/historico?termo=arroz',
      coletaStatus: '/api/coleta/status',
      analiseCarrinho: '/api/analise/carrinho?municipio=Teixeira+de+Freitas&itens=arroz:2,feijao:1',
      estatisticas: '/api/inteligencia/estatisticas',
      volatilidade: '/api/inteligencia/volatilidade',
      alertas: '/api/inteligencia/alertas',
    },
  });
});

// Rotas
app.use('/api', authRouter);
app.use('/api', healthRouter);
app.use('/api', scraperRouter);
app.use('/api', coletaRouter);

// Análise e inteligência têm limiter próprio por serem agregações pesadas
app.use('/api', limiterAnalise, analiseRouter);
app.use('/api', limiterAnalise, inteligenciaRouter);

export default app;
