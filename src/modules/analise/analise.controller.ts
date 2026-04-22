import { Request, Response } from 'express';
import { analisarCarrinho } from './analise.service';
import { AnaliseInput, ItemCarrinho } from './analise.types';
import { buildKey, cacheRapido } from '../../shared/cache/app-cache';
import { withCache } from '../../shared/cache/with-cache';
import { CarrinhoGetQuery, CarrinhoPostBody } from './analise.schemas';

export async function analisarGet(req: Request, res: Response): Promise<void> {
  const { municipio, itens: itensParam } = req.validatedQuery as CarrinhoGetQuery;

  const itens: ItemCarrinho[] = [];
  const erros: string[] = [];

  for (const parte of itensParam.split(',')) {
    const [produto, qtdStr] = parte.trim().split(':');
    if (!produto) {
      erros.push(`Parte inválida: "${parte}"`);
      continue;
    }
    const quantidade = qtdStr ? Number(qtdStr) : 1;
    if (isNaN(quantidade) || quantidade <= 0) {
      erros.push(`Quantidade inválida para "${produto}"`);
      continue;
    }
    itens.push({ produto: produto.trim(), quantidade });
  }

  if (erros.length > 0) {
    res.status(400).json({ erro: 'Itens inválidos.', detalhes: erros });
    return;
  }

  if (itens.length > 50) {
    res.status(400).json({ erro: 'Máximo de 50 itens por análise.' });
    return;
  }

  await executarAnalise({ itens, municipio }, res);
}

export async function analisar(req: Request, res: Response): Promise<void> {
  const { municipio, itens } = req.body as CarrinhoPostBody;
  await executarAnalise({ itens, municipio }, res);
}

async function executarAnalise(input: AnaliseInput, res: Response): Promise<void> {
  const resultado = await withCache(
    cacheRapido,
    buildKey('analise', { municipio: input.municipio, itens: input.itens }),
    () => analisarCarrinho(input),
  );
  res.status(200).json(resultado);
}
