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

// Rotas
app.use(healthRouter);
app.use(scraperRouter);
app.use(coletaRouter);

// Análise e inteligência têm limiter próprio por serem agregações pesadas
app.use(limiterAnalise, analiseRouter);
app.use(limiterAnalise, inteligenciaRouter);

export default app;
