import { Request, Response } from 'express';
import { obterAlertas, obterEstatisticas, obterVolatilidade } from './inteligencia.service';
import { FiltroAlertas, FiltroEstatisticas, FiltroVolatilidade } from './inteligencia.types';
import { buildKey, cacheLento } from '../../shared/cache/app-cache';
import { withCache } from '../../shared/cache/with-cache';
import { Logger } from '../../shared/logger/logger';
import { EstatisticasQuery, VolatilidadeQuery, AlertasQuery } from './inteligencia.schemas';

const log = new Logger('InteligenciaController');

export async function estatisticas(req: Request, res: Response): Promise<void> {
  const { municipio, dias, produtos } = req.validatedQuery as EstatisticasQuery;
  const filtro: FiltroEstatisticas = { municipio, dias, produtos };

  try {
    const resultado = await withCache(cacheLento, buildKey('estat', filtro), () =>
      obterEstatisticas(filtro),
    );
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'estatísticas');
  }
}

export async function volatilidade(req: Request, res: Response): Promise<void> {
  const { municipio, dias, limite, minimoAmostras, produtos } =
    req.validatedQuery as VolatilidadeQuery;
  const filtro: FiltroVolatilidade = { municipio, dias, limite, minimoAmostras, produtos };

  try {
    const resultado = await withCache(cacheLento, buildKey('volat', filtro), () =>
      obterVolatilidade(filtro),
    );
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'volatilidade');
  }
}

export async function alertas(req: Request, res: Response): Promise<void> {
  const { municipio, variacaoLimiar, produtos } = req.validatedQuery as AlertasQuery;
  const filtro: FiltroAlertas = { municipio, variacaoLimiar, produtos };

  try {
    const resultado = await withCache(cacheLento, buildKey('alert', filtro), () =>
      obterAlertas(filtro),
    );
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'alertas');
  }
}

function handleError(err: unknown, res: Response, contexto: string): void {
  log.error(`Erro em ${contexto}`, { erro: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ erro: `Erro interno ao calcular ${contexto}.` });
}
