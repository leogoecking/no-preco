import { PrecoModel } from '../preco/preco.model';
import { MatrizPrecos, Oferta } from './analise.types';

interface OfertaRaw {
  produto: string;
  mercado: string;
  cnpj: string;
  preco: number;
  unidade?: string;
  dataColeta: Date;
}

/**
 * Executa uma única agregação no MongoDB e devolve a matriz
 * produto → mercado → oferta_mais_recente.
 *
 * Pipeline:
 *  1. $match   — filtra pelos termos e município (usa $regex para busca parcial)
 *  2. $sort    — ordena por dataColeta DESC para que $first capture o mais recente
 *  3. $group   — agrupa por (produto, mercado) conservando o primeiro registro
 *  4. $project — molda o documento de saída
 */
export async function buscarMatrizPrecos(
  termos: string[],
  municipio?: string,
): Promise<MatrizPrecos> {
  if (termos.length === 0) return new Map();

  // Monta condições OR: cada termo vira um regex case-insensitive
  // para capturar variações como "arroz 5kg" → "arroz parboilizado tipo 1 5kg"
  const termosRegex = termos.map((t) => ({
    produto: { $regex: t.toLowerCase().trim(), $options: 'i' },
  }));

  const matchBase: Record<string, unknown> = { $or: termosRegex };

  if (municipio) {
    matchBase['municipio'] = { $regex: municipio, $options: 'i' };
  }

  const pipeline = [
    { $match: matchBase },

    // Garante que $first (no $group) pegue o preço mais recente
    { $sort: { dataColeta: -1 as const } },

    {
      $group: {
        _id: { produto: '$produto', mercado: '$mercado', cnpj: '$cnpj' },
        preco: { $first: '$preco' },
        unidade: { $first: '$unidade' },
        dataColeta: { $first: '$dataColeta' },
      },
    },

    {
      $project: {
        _id: 0,
        produto: '$_id.produto',
        mercado: '$_id.mercado',
        cnpj: '$_id.cnpj',
        preco: 1,
        unidade: 1,
        dataColeta: 1,
      },
    },
  ];

  const resultados = await PrecoModel.aggregate<OfertaRaw>(pipeline).exec();

  return montarMatriz(resultados, termos);
}

/**
 * Converte o array plano da agregação em Map<produto, Map<mercado, Oferta>>.
 *
 * Associação termo→produto: para cada linha do banco, descobre qual termo
 * da lista do usuário a gerou (pela substring match). Isso permite que o
 * relatório use o termo original da lista, não o nome completo do banco.
 */
function montarMatriz(rows: OfertaRaw[], termos: string[]): MatrizPrecos {
  const matriz: MatrizPrecos = new Map();
  const termosOrdenados = [...termos].sort((a, b) => b.length - a.length);

  for (const row of rows) {
    // Identifica a qual termo da lista este produto pertence.
    // Ordena por comprimento decrescente para que termos específicos ("arroz 5kg")
    // tenham prioridade sobre genéricos ("arroz") no primeiro match.
    const termoAssociado =
      termosOrdenados.find((t) => row.produto.includes(t.toLowerCase().trim())) ?? row.produto;

    if (!matriz.has(termoAssociado)) {
      matriz.set(termoAssociado, new Map());
    }

    const porMercado = matriz.get(termoAssociado)!;

    // Se já existe oferta para este mercado, mantém a de menor preço
    // (pode haver múltiplas unidades do mesmo produto no mesmo mercado)
    const existente = porMercado.get(row.mercado);
    if (!existente || row.preco < existente.preco) {
      const oferta: Oferta = {
        preco: row.preco,
        mercado: row.mercado,
        cnpj: row.cnpj,
        unidade: row.unidade,
        dataColeta: row.dataColeta,
      };
      porMercado.set(row.mercado, oferta);
    }
  }

  return matriz;
}
