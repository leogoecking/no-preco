import rateLimit from 'express-rate-limit';

/** Resposta padrão de erro quando o limite é atingido */
function limitMessage(acao: string): { erro: string; tipo: string } {
  return {
    erro: `Muitas requisições. ${acao}`,
    tipo: 'RATE_LIMIT',
  };
}

/**
 * Limiter geral — aplicado a todas as rotas.
 * 120 requisições por IP a cada 15 minutos.
 */
export const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Tente novamente em 15 minutos.'),
});

/**
 * Limiter de leitura — rotas GET que consultam o banco.
 * 60 requisições por IP a cada minuto.
 */
export const limiterLeitura = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Máximo de 60 buscas por minuto atingido.'),
});

/**
 * Limiter de coleta — POST /coleta/disparar.
 * Disparo manual aciona scraping externo; precisa de janela larga.
 * 10 requisições por IP a cada hora.
 */
export const limiterColeta = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Máximo de 10 coletas manuais por hora atingido.'),
});

/**
 * Limiter de análise — POST /analise/carrinho.
 * Consulta é pesada (agregação MongoDB).
 * 30 requisições por IP a cada minuto.
 */
export const limiterAnalise = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Máximo de 30 análises por minuto atingido.'),
});
