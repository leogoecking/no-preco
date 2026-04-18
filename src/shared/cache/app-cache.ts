import NodeCache from 'node-cache';

// Buscas e histórico: dados mudam a cada coleta (~1h)
export const cacheRapido = new NodeCache({ stdTTL: 5 * 60, checkperiod: 60 });

// Agregações pesadas: estatísticas, volatilidade, alertas
export const cacheLento = new NodeCache({ stdTTL: 30 * 60, checkperiod: 120 });

/** Gera chave de cache a partir de um objeto de parâmetros */
export function buildKey(prefix: string, params: object): string {
  const sorted = Object.keys(params as Record<string, unknown>)
    .sort()
    .map((k) => `${k}=${JSON.stringify((params as Record<string, unknown>)[k])}`)
    .join('&');
  return `${prefix}:${sorted}`;
}
