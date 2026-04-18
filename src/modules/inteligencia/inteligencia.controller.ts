import { Request, Response } from 'express';
import { obterAlertas, obterEstatisticas, obterVolatilidade } from './inteligencia.service';
import { FiltroAlertas, FiltroEstatisticas, FiltroVolatilidade } from './inteligencia.types';
import { buildKey, cacheLento } from '../../shared/cache/app-cache';
import { EstatisticasQuery, VolatilidadeQuery, AlertasQuery } from './inteligencia.schemas';

export async function estatisticas(req: Request, res: Response): Promise<void> {
  const { municipio, dias, produtos } = req.query as unknown as EstatisticasQuery;

  const filtro: FiltroEstatisticas = { municipio, dias, produtos };
  const chave = buildKey('estat', filtro);
  const cached = cacheLento.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const resultado = await obterEstatisticas(filtro);
    cacheLento.set(chave, resultado);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'estatísticas');
  }
}

export async function volatilidade(req: Request, res: Response): Promise<void> {
  const { municipio, dias, limite, minimoAmostras, produtos } =
    req.query as unknown as VolatilidadeQuery;

  const filtro: FiltroVolatilidade = { municipio, dias, limite, minimoAmostras, produtos };
  const chave = buildKey('volat', filtro);
  const cached = cacheLento.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const resultado = await obterVolatilidade(filtro);
    cacheLento.set(chave, resultado);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'volatilidade');
  }
}

export async function alertas(req: Request, res: Response): Promise<void> {
  const { municipio, variacaoLimiar, produtos } = req.query as unknown as AlertasQuery;

  const filtro: FiltroAlertas = { municipio, variacaoLimiar, produtos };
  const chave = buildKey('alert', filtro);
  const cached = cacheLento.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const resultado = await obterAlertas(filtro);
    cacheLento.set(chave, resultado);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'alertas');
  }
}

function handleError(err: unknown, res: Response, contexto: string): void {
  console.error(`[inteligencia] Erro em ${contexto}:`, err);
  res.status(500).json({ erro: `Erro interno ao calcular ${contexto}.` });
}
