import { Request, Response } from 'express';
import { analisarCarrinho } from './analise.service';
import { AnaliseInput, ItemCarrinho } from './analise.types';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';

export async function analisar(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;

  // ── Validação do body ──────────────────────
  if (!body || !Array.isArray(body['itens']) || body['itens'].length === 0) {
    res.status(400).json({
      erro: 'O campo "itens" é obrigatório e deve ser um array não vazio.',
      exemplo: {
        municipio: 'Teixeira de Freitas',
        itens: [
          { produto: 'arroz 5kg', quantidade: 1 },
          { produto: 'feijão carioca 1kg', quantidade: 2 },
        ],
      },
    });
    return;
  }

  const itensRaw = body['itens'] as unknown[];
  const itens: ItemCarrinho[] = [];
  const errosValidacao: string[] = [];

  for (let i = 0; i < itensRaw.length; i++) {
    const item = itensRaw[i] as Record<string, unknown>;

    if (!item || typeof item['produto'] !== 'string' || !item['produto'].trim()) {
      errosValidacao.push(`itens[${i}]: campo "produto" inválido ou ausente`);
      continue;
    }

    const quantidade = item['quantidade'] !== undefined ? Number(item['quantidade']) : 1;

    if (isNaN(quantidade) || quantidade <= 0) {
      errosValidacao.push(`itens[${i}]: "quantidade" deve ser um número positivo`);
      continue;
    }

    itens.push({ produto: item['produto'].trim(), quantidade });
  }

  if (errosValidacao.length > 0) {
    res.status(400).json({ erro: 'Itens inválidos na lista.', detalhes: errosValidacao });
    return;
  }

  if (itens.length > 50) {
    res.status(400).json({ erro: 'Máximo de 50 itens por análise.' });
    return;
  }

  const municipio = typeof body['municipio'] === 'string' ? body['municipio'].trim() : undefined;

  const input: AnaliseInput = { itens, municipio };
  const chave = buildKey('analise', { municipio, itens });
  const cached = cacheRapido.get(chave);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const resultado = await analisarCarrinho(input);
    cacheRapido.set(chave, resultado);
    res.status(200).json(resultado);
  } catch (err) {
    console.error('[analise] Erro ao calcular:', err);
    res.status(500).json({ erro: 'Erro interno ao processar a análise.' });
  }
}
