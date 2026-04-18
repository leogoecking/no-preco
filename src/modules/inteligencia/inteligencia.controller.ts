import { Request, Response } from 'express';
import { obterAlertas, obterEstatisticas, obterVolatilidade } from './inteligencia.service';
import { FiltroAlertas, FiltroEstatisticas, FiltroVolatilidade } from './inteligencia.types';

// ─────────────────────────────────────────────
// GET /inteligencia/estatisticas
// ─────────────────────────────────────────────

export async function estatisticas(req: Request, res: Response): Promise<void> {
  const municipio = strParam(req, 'municipio');
  const dias = numParam(req, 'dias', 7, 1, 90);
  const produtos = listParam(req, 'produtos');

  if (dias === null) {
    res.status(400).json({ erro: '"dias" deve ser um número entre 1 e 90.' });
    return;
  }

  const filtro: FiltroEstatisticas = { municipio, dias, produtos };

  try {
    const resultado = await obterEstatisticas(filtro);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'estatísticas');
  }
}

// ─────────────────────────────────────────────
// GET /inteligencia/volatilidade
// ─────────────────────────────────────────────

export async function volatilidade(req: Request, res: Response): Promise<void> {
  const municipio = strParam(req, 'municipio');
  const dias = numParam(req, 'dias', 30, 7, 365);
  const limite = numParam(req, 'limite', 20, 1, 50);
  const minimoAmostras = numParam(req, 'minimoAmostras', 5, 2, 30);
  const produtos = listParam(req, 'produtos');

  if (dias === null || limite === null || minimoAmostras === null) {
    res.status(400).json({ erro: 'Parâmetros numéricos fora do intervalo permitido.' });
    return;
  }

  const filtro: FiltroVolatilidade = { municipio, dias, limite, minimoAmostras, produtos };

  try {
    const resultado = await obterVolatilidade(filtro);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'volatilidade');
  }
}

// ─────────────────────────────────────────────
// GET /inteligencia/alertas
// ─────────────────────────────────────────────

export async function alertas(req: Request, res: Response): Promise<void> {
  const municipio = strParam(req, 'municipio');
  const variacaoLimiar = numParam(req, 'variacaoLimiar', -5, -100, -1);
  const produtos = listParam(req, 'produtos');

  if (variacaoLimiar === null) {
    res.status(400).json({ erro: '"variacaoLimiar" deve ser um número entre -100 e -1.' });
    return;
  }

  const filtro: FiltroAlertas = { municipio, variacaoLimiar, produtos };

  try {
    const resultado = await obterAlertas(filtro);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res, 'alertas');
  }
}

// ─────────────────────────────────────────────
// Utilitários de parsing de query params
// ─────────────────────────────────────────────

function strParam(req: Request, key: string): string | undefined {
  const val = req.query[key];
  if (!val || typeof val !== 'string') return undefined;
  return val.trim() || undefined;
}

/**
 * Parseia um query param numérico com fallback e validação de intervalo.
 * Retorna null se o valor foi fornecido mas está fora do intervalo.
 */
function numParam(
  req: Request,
  key: string,
  defaultVal: number,
  min: number,
  max: number,
): number | null {
  const raw = req.query[key];
  if (!raw) return defaultVal;

  const n = Number(raw);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

/**
 * Parseia uma lista separada por vírgula.
 * Ex: ?produtos=arroz 5kg,feijão 1kg → ['arroz 5kg', 'feijão 1kg']
 */
function listParam(req: Request, key: string): string[] | undefined {
  const raw = req.query[key];
  if (!raw || typeof raw !== 'string') return undefined;
  const itens = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return itens.length > 0 ? itens : undefined;
}

function handleError(err: unknown, res: Response, contexto: string): void {
  console.error(`[inteligencia] Erro em ${contexto}:`, err);
  res.status(500).json({ erro: `Erro interno ao calcular ${contexto}.` });
}
