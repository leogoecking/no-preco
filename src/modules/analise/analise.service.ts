import { buscarMatrizPrecos } from './analise.repository';
import {
  AnaliseInput,
  Decisao,
  ItemCombinacao,
  ItemCarrinho,
  MatrizPrecos,
  Oferta,
  OpcaoCombinacao,
  OpcaoMercadoUnico,
  Recomendacao,
  ResumoPorMercado,
  ResultadoAnalise,
} from './analise.types';

// Limiar de economia para recomendar combinação de mercados
// Abaixo de 5% de economia não justifica visitar múltiplos mercados
const LIMIAR_ECONOMIA_PERCENT = 5;

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

export async function analisarCarrinho(input: AnaliseInput): Promise<ResultadoAnalise> {
  const itensNormalizados = normalizarItens(input.itens);
  const termos = itensNormalizados.map((i) => i.produto);

  const matriz = await buscarMatrizPrecos(termos, input.municipio);

  const naoEncontrados = termos.filter((t) => !matriz.has(t));

  const opcao2 = calcularCombinacaoOtima(itensNormalizados, matriz);
  const opcao1 = calcularMercadoUnico(itensNormalizados, matriz);
  const decisao = gerarDecisao(opcao1, opcao2);

  return {
    geradoEm: new Date().toISOString(),
    municipio: input.municipio,
    totalItensNaLista: itensNormalizados.length,
    naoEncontradosEmNenhumMercado: naoEncontrados,
    opcao1_mercadoUnico: opcao1,
    opcao2_combinacaoOtima: opcao2,
    decisao,
  };
}

// ─────────────────────────────────────────────
// Algoritmo 1 — Mercado único mais barato
// ─────────────────────────────────────────────

/**
 * Para cada mercado que aparece na matriz, calcula o custo total
 * somando o preço daquele mercado para cada item da lista.
 * Mercados sem todos os itens são ranqueados pela cobertura + custo parcial.
 * Retorna o melhor candidato.
 */
export function calcularMercadoUnico(
  itens: Required<ItemCarrinho>[],
  matriz: MatrizPrecos,
): OpcaoMercadoUnico | null {
  // Coleta todos os mercados presentes na matriz
  const todosMercados = new Set<string>();
  for (const porMercado of matriz.values()) {
    for (const mercado of porMercado.keys()) {
      todosMercados.add(mercado);
    }
  }

  if (todosMercados.size === 0) return null;

  type CandidatoMercado = {
    mercado: string;
    cnpj: string;
    total: number;
    cobertura: number;
    itensCobertos: { produto: string; quantidade: number; oferta: Oferta }[];
    itensFaltantes: string[];
  };

  const candidatos: CandidatoMercado[] = [];

  for (const nomeMercado of todosMercados) {
    let total = 0;
    let cobertos = 0;
    const itensCobertos: CandidatoMercado['itensCobertos'] = [];
    const itensFaltantes: string[] = [];
    let cnpj = '';

    for (const item of itens) {
      const oferta = matriz.get(item.produto)?.get(nomeMercado);

      if (oferta) {
        total += oferta.preco * item.quantidade;
        itensCobertos.push({ produto: item.produto, quantidade: item.quantidade, oferta });
        cnpj = oferta.cnpj;
        cobertos++;
      } else {
        itensFaltantes.push(item.produto);
      }
    }

    candidatos.push({
      mercado: nomeMercado,
      cnpj,
      total,
      cobertura: cobertos / itens.length,
      itensCobertos,
      itensFaltantes,
    });
  }

  // Ordena: primeiro por cobertura decrescente, depois por custo crescente
  // Prioriza mercados completos; entre completos, o mais barato vence
  candidatos.sort((a, b) => {
    if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
    return a.total - b.total;
  });

  const melhor = candidatos[0];
  if (!melhor) return null;

  return {
    mercado: melhor.mercado,
    cnpj: melhor.cnpj,
    totalCarrinho: arredondar(melhor.total),
    cobertura: arredondar(melhor.cobertura, 4),
    itensCobertos: melhor.itensCobertos.map(({ produto, quantidade, oferta }) => ({
      produto,
      quantidade,
      precoUnitario: arredondar(oferta.preco),
      subtotal: arredondar(oferta.preco * quantidade),
      unidade: oferta.unidade,
    })),
    itensFaltantes: melhor.itensFaltantes,
  };
}

// ─────────────────────────────────────────────
// Algoritmo 2 — Combinação ótima de mercados
// ─────────────────────────────────────────────

/**
 * Para cada item da lista, seleciona o mercado com menor preço
 * independentemente de quantos mercados isso envolver.
 * Custo ótimo teórico = Σ min_mercado(preco(p)) para todo p.
 */
export function calcularCombinacaoOtima(
  itens: Required<ItemCarrinho>[],
  matriz: MatrizPrecos,
): OpcaoCombinacao {
  const itensResultado: ItemCombinacao[] = [];
  const itensFaltantes: string[] = [];

  for (const item of itens) {
    const ofertasPorMercado = matriz.get(item.produto);

    if (!ofertasPorMercado || ofertasPorMercado.size === 0) {
      itensFaltantes.push(item.produto);
      continue;
    }

    // Encontra a oferta de menor preço entre todos os mercados
    const melhorOferta = encontrarMenorPreco(ofertasPorMercado);

    itensResultado.push({
      produto: item.produto,
      quantidade: item.quantidade,
      precoUnitario: arredondar(melhorOferta.preco),
      subtotal: arredondar(melhorOferta.preco * item.quantidade),
      unidade: melhorOferta.unidade,
      mercado: melhorOferta.mercado,
      cnpj: melhorOferta.cnpj,
    });
  }

  const totalCarrinho = arredondar(itensResultado.reduce((acc, i) => acc + i.subtotal, 0));

  const resumoPorMercado = consolidarPorMercado(itensResultado);

  return {
    totalCarrinho,
    mercadosNecessarios: resumoPorMercado.length,
    itens: itensResultado,
    resumoPorMercado,
    itensFaltantes,
  };
}

// ─────────────────────────────────────────────
// Lógica de decisão
// ─────────────────────────────────────────────

export function gerarDecisao(opcao1: OpcaoMercadoUnico | null, opcao2: OpcaoCombinacao): Decisao {
  // Nenhum dado encontrado
  if (!opcao1 && opcao2.itens.length === 0) {
    return {
      recomendacao: 'SEM_DADOS',
      motivo: 'Nenhum preço encontrado no banco para os produtos informados.',
      economiaAbsoluta: 0,
      economiaPercent: 0,
    };
  }

  // Sem dados para opcao1 — combinação é a única alternativa
  if (!opcao1) {
    return {
      recomendacao: 'COMBINACAO',
      motivo: 'Nenhum mercado único cobre todos os itens da lista.',
      economiaAbsoluta: 0,
      economiaPercent: 0,
    };
  }

  const economiaAbsoluta = arredondar(opcao1.totalCarrinho - opcao2.totalCarrinho);
  const economiaPercent = arredondar((economiaAbsoluta / opcao1.totalCarrinho) * 100, 2);
  const mercadosExtras = opcao2.mercadosNecessarios - 1;

  let recomendacao: Recomendacao;
  let motivo: string;

  if (opcao1.cobertura < 1) {
    // Mercado único não tem todos os produtos
    recomendacao = 'COMBINACAO';
    motivo = `O melhor mercado único (${opcao1.mercado}) cobre apenas ${Math.round(opcao1.cobertura * 100)}% dos itens. A combinação é necessária para uma compra completa.`;
  } else if (opcao2.mercadosNecessarios === 1) {
    // Combinação ótima também aponta para 1 único mercado
    recomendacao = 'MERCADO_UNICO';
    motivo = `A combinação ótima já concentra tudo em ${opcao2.resumoPorMercado[0]?.mercado ?? opcao1.mercado}. Não há vantagem em dividir a compra.`;
  } else if (economiaPercent >= LIMIAR_ECONOMIA_PERCENT) {
    recomendacao = 'COMBINACAO';
    motivo = `Dividir a compra em ${opcao2.mercadosNecessarios} mercados gera economia de R$ ${economiaAbsoluta.toFixed(2)} (${economiaPercent.toFixed(1)}%), visitando ${mercadosExtras} mercado(s) adicional(is).`;
  } else {
    recomendacao = 'MERCADO_UNICO';
    motivo = `A economia da combinação (R$ ${economiaAbsoluta.toFixed(2)} / ${economiaPercent.toFixed(1)}%) não justifica visitar ${mercadosExtras} mercado(s) extra(s). Concentrar em ${opcao1.mercado} é mais prático.`;
  }

  return { recomendacao, motivo, economiaAbsoluta, economiaPercent };
}

// ─────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────

function normalizarItens(itens: ItemCarrinho[]): Required<ItemCarrinho>[] {
  return itens.map((i) => ({
    produto: i.produto.toLowerCase().trim(),
    quantidade: Math.max(1, Math.round(i.quantidade ?? 1)),
  }));
}

function encontrarMenorPreco(ofertas: Map<string, Oferta>): Oferta & { mercado: string } {
  let melhor: (Oferta & { mercado: string }) | null = null;

  for (const [nomeMercado, oferta] of ofertas.entries()) {
    if (!melhor || oferta.preco < melhor.preco) {
      melhor = { ...oferta, mercado: nomeMercado };
    }
  }

  if (!melhor) throw new Error('encontrarMenorPreco chamado com Map vazio');
  return melhor;
}

function consolidarPorMercado(itens: ItemCombinacao[]): ResumoPorMercado[] {
  const porMercado = new Map<string, ResumoPorMercado>();

  for (const item of itens) {
    const chave = item.cnpj || item.mercado;

    if (!porMercado.has(chave)) {
      porMercado.set(chave, {
        mercado: item.mercado,
        cnpj: item.cnpj,
        subtotal: 0,
        itens: [],
      });
    }

    const entry = porMercado.get(chave)!;
    entry.subtotal = arredondar(entry.subtotal + item.subtotal);
    entry.itens.push(item.produto);
  }

  // Ordena por subtotal decrescente (mercado principal primeiro)
  return Array.from(porMercado.values()).sort((a, b) => b.subtotal - a.subtotal);
}

function arredondar(n: number, casas = 2): number {
  return Math.round(n * 10 ** casas) / 10 ** casas;
}
