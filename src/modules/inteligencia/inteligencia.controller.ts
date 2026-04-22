import { Request, Response } from 'express';
import { obterAlertas, obterEstatisticas, obterVolatilidade } from './inteligencia.service';
import { FiltroAlertas, FiltroEstatisticas, FiltroVolatilidade } from './inteligencia.types';
import { buildKey, cacheLento } from '../../shared/cache/app-cache';
import { withCache } from '../../shared/cache/with-cache';
import { EstatisticasQuery, VolatilidadeQuery, AlertasQuery } from './inteligencia.schemas';

export async function estatisticas(req: Request, res: Response): Promise<void> {
  const { municipio, dias, produtos } = req.validatedQuery as EstatisticasQuery;
  const filtro: FiltroEstatisticas = { municipio, dias, produtos };

  const resultado = await withCache(cacheLento, buildKey('estat', filtro), () =>
    obterEstatisticas(filtro),
  );
  res.status(200).json(resultado);
}

export async function volatilidade(req: Request, res: Response): Promise<void> {
  const { municipio, dias, limite, minimoAmostras, produtos } =
    req.validatedQuery as VolatilidadeQuery;
  const filtro: FiltroVolatilidade = { municipio, dias, limite, minimoAmostras, produtos };

  const resultado = await withCache(cacheLento, buildKey('volat', filtro), () =>
    obterVolatilidade(filtro),
  );
  res.status(200).json(resultado);
}

export async function alertas(req: Request, res: Response): Promise<void> {
  const { municipio, variacaoLimiar, produtos } = req.validatedQuery as AlertasQuery;
  const filtro: FiltroAlertas = { municipio, variacaoLimiar, produtos };

  const resultado = await withCache(cacheLento, buildKey('alert', filtro), () =>
    obterAlertas(filtro),
  );
  res.status(200).json(resultado);
}
