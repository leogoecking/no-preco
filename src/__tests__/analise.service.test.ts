jest.mock('../modules/analise/analise.repository', () => ({
  buscarMatrizPrecos: jest.fn(),
}));

import {
  analisarCarrinho,
  calcularCombinacaoOtima,
  calcularMercadoUnico,
  gerarDecisao,
} from '../modules/analise/analise.service';
import { buscarMatrizPrecos } from '../modules/analise/analise.repository';
import {
  MatrizPrecos,
  Oferta,
  OpcaoCombinacao,
  OpcaoMercadoUnico,
} from '../modules/analise/analise.types';

const mockBuscar = buscarMatrizPrecos as jest.MockedFunction<typeof buscarMatrizPrecos>;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function oferta(preco: number, mercado: string, cnpj = '00.000.000/0001-00'): Oferta {
  return { preco, mercado, cnpj, dataColeta: new Date('2024-01-01') };
}

function buildMatriz(dados: Record<string, Record<string, number>>): MatrizPrecos {
  const matriz: MatrizPrecos = new Map();
  for (const [produto, mercados] of Object.entries(dados)) {
    const porMercado = new Map<string, Oferta>();
    let idx = 0;
    for (const [mercado, preco] of Object.entries(mercados)) {
      porMercado.set(mercado, oferta(preco, mercado, `00.000.000/000${idx++}-00`));
    }
    matriz.set(produto, porMercado);
  }
  return matriz;
}

function itens(...nomes: string[]): { produto: string; quantidade: number }[] {
  return nomes.map((produto) => ({ produto, quantidade: 1 }));
}

// ─────────────────────────────────────────────
// analisarCarrinho
// ─────────────────────────────────────────────

describe('analisarCarrinho', () => {
  beforeEach(() => mockBuscar.mockReset());

  it('normaliza itens para lowercase antes de consultar o repositório', async () => {
    mockBuscar.mockResolvedValue(new Map());
    await analisarCarrinho({ itens: [{ produto: 'ARROZ', quantidade: 1 }] });
    expect(mockBuscar).toHaveBeenCalledWith(['arroz'], undefined);
  });

  it('popula naoEncontradosEmNenhumMercado com itens ausentes na matriz', async () => {
    mockBuscar.mockResolvedValue(buildMatriz({ arroz: { Mercado_A: 5 } }));
    const resultado = await analisarCarrinho({
      itens: [
        { produto: 'arroz', quantidade: 1 },
        { produto: 'feijao', quantidade: 1 },
      ],
    });
    expect(resultado.naoEncontradosEmNenhumMercado).toEqual(['feijao']);
  });

  it('repassa municipio para o repositório e para o resultado', async () => {
    mockBuscar.mockResolvedValue(new Map());
    const resultado = await analisarCarrinho({
      itens: [{ produto: 'arroz', quantidade: 1 }],
      municipio: 'Teixeira de Freitas',
    });
    expect(mockBuscar).toHaveBeenCalledWith(['arroz'], 'Teixeira de Freitas');
    expect(resultado.municipio).toBe('Teixeira de Freitas');
  });

  it('retorna totalItensNaLista com o número de itens normalizados', async () => {
    mockBuscar.mockResolvedValue(new Map());
    const resultado = await analisarCarrinho({
      itens: [
        { produto: 'arroz', quantidade: 2 },
        { produto: 'feijao', quantidade: 1 },
      ],
    });
    expect(resultado.totalItensNaLista).toBe(2);
  });

  it('retorna geradoEm como string ISO válida', async () => {
    mockBuscar.mockResolvedValue(new Map());
    const resultado = await analisarCarrinho({ itens: [{ produto: 'arroz', quantidade: 1 }] });
    expect(() => new Date(resultado.geradoEm)).not.toThrow();
    expect(new Date(resultado.geradoEm).toISOString()).toBe(resultado.geradoEm);
  });

  it('integração: retorna mercadoUnico e combinacao corretos para matriz conhecida', async () => {
    mockBuscar.mockResolvedValue(
      buildMatriz({
        arroz: { Mercado_A: 10, Mercado_B: 7 },
        feijao: { Mercado_A: 4, Mercado_B: 8 },
      }),
    );
    const resultado = await analisarCarrinho({
      itens: [
        { produto: 'arroz', quantidade: 1 },
        { produto: 'feijao', quantidade: 1 },
      ],
    });
    // Mercado_A = 14, Mercado_B = 15 → Mercado_A vence
    expect(resultado.mercadoUnico!.mercado).toBe('Mercado_A');
    expect(resultado.mercadoUnico!.total).toBe(14);
    // Combinação ótima: arroz em B (7) + feijao em A (4) = 11
    expect(resultado.combinacao.total).toBe(11);
    expect(resultado.naoEncontradosEmNenhumMercado).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// calcularMercadoUnico
// ─────────────────────────────────────────────

describe('calcularMercadoUnico', () => {
  it('retorna null quando a matriz está vazia', () => {
    expect(calcularMercadoUnico(itens('arroz'), new Map())).toBeNull();
  });

  it('retorna o mercado com menor custo total', () => {
    const matriz = buildMatriz({
      arroz: { Mercado_A: 10, Mercado_B: 8 },
      feijao: { Mercado_A: 5, Mercado_B: 7 },
    });
    const resultado = calcularMercadoUnico(itens('arroz', 'feijao'), matriz);
    // Mercado_A = 15, Mercado_B = 15 — empate — A vence por ordem de iteração
    expect(resultado).not.toBeNull();
    expect(resultado!.total).toBe(15);
  });

  it('prefere mercado com maior cobertura mesmo que mais caro', () => {
    const matriz = buildMatriz({
      arroz: { Mercado_A: 10, Mercado_B: 5 },
      feijao: { Mercado_A: 5 }, // Mercado_B não tem feijão
    });
    const resultado = calcularMercadoUnico(itens('arroz', 'feijao'), matriz);
    expect(resultado!.mercado).toBe('Mercado_A');
    expect(resultado!.cobertura).toBe(1);
  });

  it('retorna cobertura parcial quando nenhum mercado tem todos os itens', () => {
    const matriz = buildMatriz({
      arroz: { Mercado_A: 10 },
      feijao: { Mercado_B: 5 },
    });
    const resultado = calcularMercadoUnico(itens('arroz', 'feijao'), matriz);
    expect(resultado!.cobertura).toBe(0.5);
    expect(resultado!.itensFaltantes).toHaveLength(1);
  });

  it('respeita quantidade na soma do total', () => {
    const matriz = buildMatriz({ arroz: { Mercado_A: 10 } });
    const resultado = calcularMercadoUnico([{ produto: 'arroz', quantidade: 3 }], matriz);
    expect(resultado!.total).toBe(30);
  });
});

// ─────────────────────────────────────────────
// calcularCombinacaoOtima
// ─────────────────────────────────────────────

describe('calcularCombinacaoOtima', () => {
  it('seleciona o menor preço por produto independente do mercado', () => {
    const matriz = buildMatriz({
      arroz: { Mercado_A: 10, Mercado_B: 7 },
      feijao: { Mercado_A: 4, Mercado_B: 6 },
    });
    const resultado = calcularCombinacaoOtima(itens('arroz', 'feijao'), matriz);
    expect(resultado.total).toBe(11); // arroz=7 + feijao=4
    expect(resultado.mercadosNecessarios).toBe(2);
  });

  it('usa 1 mercado quando ele tem todos os menores preços', () => {
    const matriz = buildMatriz({
      arroz: { Mercado_A: 5, Mercado_B: 10 },
      feijao: { Mercado_A: 3, Mercado_B: 8 },
    });
    const resultado = calcularCombinacaoOtima(itens('arroz', 'feijao'), matriz);
    expect(resultado.mercadosNecessarios).toBe(1);
    expect(resultado.mercados[0]).toBe('Mercado_A');
  });

  it('registra produtos não encontrados em itensFaltantes', () => {
    const matriz = buildMatriz({ arroz: { Mercado_A: 5 } });
    const resultado = calcularCombinacaoOtima(itens('arroz', 'feijao'), matriz);
    expect(resultado.itensFaltantes).toContain('feijao');
    expect(resultado.itens).toHaveLength(1);
  });

  it('respeita quantidade no subtotal', () => {
    const matriz = buildMatriz({ arroz: { Mercado_A: 5 } });
    const resultado = calcularCombinacaoOtima([{ produto: 'arroz', quantidade: 4 }], matriz);
    expect(resultado.total).toBe(20);
    expect(resultado.itens[0]!.subtotal).toBe(20);
  });
});

// ─────────────────────────────────────────────
// gerarDecisao
// ─────────────────────────────────────────────

function opcao1(overrides: Partial<OpcaoMercadoUnico> = {}): OpcaoMercadoUnico {
  return {
    mercado: 'Mercado_A',
    cnpj: '00',
    total: 100,
    cobertura: 1,
    itensEncontrados: 0,
    itens: [],
    itensFaltantes: [],
    ...overrides,
  };
}

function opcao2(overrides: Partial<OpcaoCombinacao> = {}): OpcaoCombinacao {
  return {
    total: 80,
    mercadosNecessarios: 2,
    mercados: ['Mercado_B', 'Mercado_C'],
    itens: [],
    itensFaltantes: [],
    ...overrides,
  };
}

describe('gerarDecisao', () => {
  it('retorna sem_dados quando não há opcao1 e opcao2 sem itens', () => {
    const resultado = gerarDecisao(
      null,
      opcao2({ itens: [], total: 0, mercadosNecessarios: 0, mercados: [] }),
    );
    expect(resultado.recomendacao).toBe('sem_dados');
  });

  it('retorna combinacao quando opcao1 é null mas há itens', () => {
    const resultado = gerarDecisao(
      null,
      opcao2({
        itens: [{ produto: 'x', quantidade: 1, preco: 1, subtotal: 1, mercado: 'M', cnpj: '0' }],
      }),
    );
    expect(resultado.recomendacao).toBe('combinacao');
  });

  it('retorna combinacao quando cobertura do mercado único é incompleta', () => {
    const resultado = gerarDecisao(opcao1({ cobertura: 0.5 }), opcao2());
    expect(resultado.recomendacao).toBe('combinacao');
    expect(resultado.motivo).toContain('50%');
  });

  it('retorna mercado_unico quando combinação converge para 1 mercado', () => {
    const resultado = gerarDecisao(
      opcao1(),
      opcao2({
        mercadosNecessarios: 1,
        mercados: ['Mercado_B'],
      }),
    );
    expect(resultado.recomendacao).toBe('mercado_unico');
    expect(resultado.motivo).toContain('Mercado_B');
  });

  it('retorna combinacao quando economia supera o limiar de 5%', () => {
    const resultado = gerarDecisao(
      opcao1({ total: 100 }),
      opcao2({ total: 80, mercadosNecessarios: 2 }),
    );
    expect(resultado.recomendacao).toBe('combinacao');
    expect(resultado.economia).toBe(20);
    expect(resultado.economiaPercent).toBe(20);
  });

  it('retorna mercado_unico quando economia é menor que 5%', () => {
    const resultado = gerarDecisao(
      opcao1({ total: 100 }),
      opcao2({ total: 97, mercadosNecessarios: 2 }),
    );
    expect(resultado.recomendacao).toBe('mercado_unico');
    expect(resultado.economia).toBe(3);
  });

  it('inclui economia absoluta e percentual corretas', () => {
    const resultado = gerarDecisao(
      opcao1({ total: 200 }),
      opcao2({ total: 150, mercadosNecessarios: 2 }),
    );
    expect(resultado.economia).toBe(50);
    expect(resultado.economiaPercent).toBe(25);
  });
});
