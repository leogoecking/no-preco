const mockCreateManyAndReturn = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindFirst = jest.fn();
const mockHistoricoCreateMany = jest.fn();
const mockQueryRaw = jest.fn();
const mockTransaction = jest.fn(async (arg: unknown) => {
  const tx = {
    preco: {
      update: mockUpdate,
      updateMany: mockUpdateMany,
      createManyAndReturn: mockCreateManyAndReturn,
    },
    historicoPreco: {
      createMany: mockHistoricoCreateMany,
    },
  };
  if (typeof arg === 'function') {
    return (arg as (t: typeof tx) => Promise<unknown>)(tx);
  }
  return Promise.all(arg as Promise<unknown>[]);
});

jest.mock('../shared/database/prisma', () => ({
  prisma: {
    preco: {
      update: mockUpdate,
      updateMany: mockUpdateMany,
      createManyAndReturn: mockCreateManyAndReturn,
      findFirst: mockFindFirst,
    },
    historicoPreco: {
      createMany: mockHistoricoCreateMany,
    },
    $queryRaw: mockQueryRaw,
    $transaction: mockTransaction,
  },
}));

import { Prisma } from '@prisma/client';
import { PrecoRepository, RepositoryError } from '../modules/preco/preco.repository';
import { ProdutoPreco } from '../modules/scraper/scraper.types';

const repo = new PrecoRepository();

function produtoPreco(overrides: Partial<ProdutoPreco> = {}): ProdutoPreco {
  return {
    nome: 'Arroz 5kg',
    preco: 25.9,
    mercado: 'Mercado A',
    cnpj: '00.000.000/0001-00',
    cidade: 'Salvador',
    municipio: 'Salvador',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────
// salvarLote
// ─────────────────────────────────────────────

describe('PrecoRepository.salvarLote', () => {
  it('retorna 0 e não chama o banco quando lista está vazia', async () => {
    const result = await repo.salvarLote([], 'api');
    expect(result).toBe(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('insere novo em batch e cria histórico inicial em batch', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([{ id: 100 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    const result = await repo.salvarLote([produtoPreco({ nome: '  ARROZ 5KG  ' })], 'api');

    expect(result).toBe(1);
    expect(mockCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(mockHistoricoCreateMany).toHaveBeenCalledTimes(1);

    const criadosCall = mockCreateManyAndReturn.mock.calls[0]![0] as {
      data: { produto: string; fonte: string }[];
      select: { id: boolean };
    };
    expect(criadosCall.data[0]!.produto).toBe('arroz 5kg');
    expect(criadosCall.data[0]!.fonte).toBe('api');
    expect(criadosCall.select.id).toBe(true);

    const histCall = mockHistoricoCreateMany.mock.calls[0]![0] as {
      data: { precoId: number; preco: Prisma.Decimal }[];
    };
    expect(histCall.data[0]!.precoId).toBe(100);
  });

  it('atualiza apenas dataColeta quando o preço não mudou', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: 42,
        produto: 'arroz 5kg',
        cnpj: '00.000.000/0001-00',
        mercado: 'Mercado A',
        preco: new Prisma.Decimal(25.9),
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await repo.salvarLote([produtoPreco({ preco: 25.9 })], 'api');

    expect(result).toBe(1);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockCreateManyAndReturn).not.toHaveBeenCalled();
    expect(mockHistoricoCreateMany).not.toHaveBeenCalled();
    const chamada = mockUpdateMany.mock.calls[0]![0] as {
      where: { id: { in: number[] } };
      data: { dataColeta: Date };
    };
    expect(chamada.where.id.in).toEqual([42]);
  });

  it('atualiza preço e cria ponto de histórico em batch quando o preço mudou', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: 42,
        produto: 'arroz 5kg',
        cnpj: '00.000.000/0001-00',
        mercado: 'Mercado A',
        preco: new Prisma.Decimal(25.9),
      },
    ]);
    mockUpdate.mockResolvedValue({});
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    const result = await repo.salvarLote([produtoPreco({ preco: 27.5 })], 'api');

    expect(result).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockHistoricoCreateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreateManyAndReturn).not.toHaveBeenCalled();

    const update = mockUpdate.mock.calls[0]![0] as {
      where: { id: number };
      data: { preco: Prisma.Decimal; precoAnterior: Prisma.Decimal };
    };
    expect(update.where.id).toBe(42);
    expect(update.data.preco.equals(new Prisma.Decimal(27.5))).toBe(true);
    expect(update.data.precoAnterior.equals(new Prisma.Decimal(25.9))).toBe(true);

    const hist = mockHistoricoCreateMany.mock.calls[0]![0] as {
      data: { precoId: number; preco: Prisma.Decimal }[];
    };
    expect(hist.data[0]!.precoId).toBe(42);
    expect(hist.data[0]!.preco.equals(new Prisma.Decimal(27.5))).toBe(true);
  });

  it('normaliza GTIN vazio e "0" tratando como ausência', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 2 });

    await repo.salvarLote(
      [
        produtoPreco({ ean: '' }),
        produtoPreco({ nome: 'Feijão', cnpj: '11.111.111/0001-11', ean: '0' }),
      ],
      'api',
    );

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const [[sql]] = mockQueryRaw.mock.calls as [[{ strings: readonly string[] }]];
    expect(sql.strings.join(' ')).toContain('ean IS NULL');

    const criados = mockCreateManyAndReturn.mock.calls[0]![0] as {
      data: { ean: string | null }[];
    };
    for (const d of criados.data) expect(d.ean).toBeNull();
  });

  it('usa chave (ean, cnpj) quando GTIN válido está presente', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([{ id: 1 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    await repo.salvarLote([produtoPreco({ ean: '7891000100103' })], 'api');

    const [[sql]] = mockQueryRaw.mock.calls as [[{ strings: readonly string[] }]];
    expect(sql.strings.join(' ')).toContain('ean IS NOT NULL');
  });

  it('mistura updates e inserts no mesmo lote em única transação', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: 10,
        produto: 'arroz 5kg',
        cnpj: '00.000.000/0001-00',
        mercado: 'Mercado A',
        preco: new Prisma.Decimal(25.9),
      },
    ]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockCreateManyAndReturn.mockResolvedValue([{ id: 11 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    const result = await repo.salvarLote(
      [
        produtoPreco({ preco: 25.9 }),
        produtoPreco({ nome: 'Feijão', cnpj: '11.111.111/0001-11', preco: 10 }),
      ],
      'api',
    );

    expect(result).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockCreateManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('propaga a fonte correta para Preco e histórico inicial', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([{ id: 1 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    await repo.salvarLote([produtoPreco()], 'browser');

    const criados = mockCreateManyAndReturn.mock.calls[0]![0] as { data: { fonte: string }[] };
    const hist = mockHistoricoCreateMany.mock.calls[0]![0] as { data: { fonte: string }[] };
    expect(criados.data[0]!.fonte).toBe('browser');
    expect(hist.data[0]!.fonte).toBe('browser');
  });

  it('dedup intra-lote: mesma chave natural vira uma única operação', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([{ id: 1 }]);
    mockHistoricoCreateMany.mockResolvedValue({ count: 1 });

    const result = await repo.salvarLote(
      [
        produtoPreco({ ean: '7891000100103', preco: 10 }),
        produtoPreco({ ean: '7891000100103', preco: 12 }),
      ],
      'api',
    );

    expect(result).toBe(1);
    const criados = mockCreateManyAndReturn.mock.calls[0]![0] as {
      data: { preco: Prisma.Decimal }[];
    };
    expect(criados.data).toHaveLength(1);
    expect(criados.data[0]!.preco.equals(new Prisma.Decimal(12))).toBe(true);
  });

  it('lança RepositoryError quando a persistência falha', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCreateManyAndReturn.mockRejectedValue(new Error('db error'));
    await expect(repo.salvarLote([produtoPreco()], 'api')).rejects.toBeInstanceOf(RepositoryError);
  });
});

// ─────────────────────────────────────────────
// buscarPorTermo
// ─────────────────────────────────────────────

describe('PrecoRepository.buscarPorTermo', () => {
  it('retorna resultado do $queryRaw', async () => {
    const rows = [{ produto: 'arroz 5kg', preco: 25.9, mercado: 'Mercado A' }];
    mockQueryRaw.mockResolvedValue(rows);
    const result = await repo.buscarPorTermo('arroz');
    expect(result).toEqual(rows);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('retorna array vazio quando não há resultados', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await repo.buscarPorTermo('produto inexistente');
    expect(result).toEqual([]);
  });

  it('quebra termo em tokens e exige todos com AND (ordem livre)', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await repo.buscarPorTermo('Picanha KG');

    const [[sql]] = mockQueryRaw.mock.calls as [
      [{ strings: readonly string[]; values: unknown[] }],
    ];
    const sqlStr = sql.strings.join(' ');
    // Dois tokens → duas ocorrências de ILIKE no filtro principal
    const ocorrencias = (sqlStr.match(/ILIKE/g) ?? []).length;
    expect(ocorrencias).toBeGreaterThanOrEqual(2);
    expect(sql.values).toContain('%picanha%');
    expect(sql.values).toContain('%kg%');
  });

  it('retorna vazio quando termo é só espaços em branco', async () => {
    const result = await repo.buscarPorTermo('   ');
    expect(result).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// buscarHistorico
// ─────────────────────────────────────────────

describe('PrecoRepository.buscarHistorico', () => {
  it('retorna pontos do historico mapeados para PrecoRow', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: 1,
        produto: 'arroz 5kg',
        preco: new Prisma.Decimal(25.9),
        mercado: 'Mercado A',
        cnpj: '00.000.000/0001-00',
        cidade: 'salvador',
        municipio: 'Salvador',
        ean: null,
        unidade: null,
        fonte: 'api',
        dataColeta: new Date('2024-01-10'),
        registradoEm: new Date('2024-01-10'),
        atualizadoEm: new Date('2024-01-12'),
      },
    ]);
    const result = await repo.buscarHistorico('arroz 5kg');
    expect(result).toHaveLength(1);
    expect(result[0]!.produto).toBe('arroz 5kg');
    expect(result[0]!.preco).toBe(25.9);
    expect(result[0]!.precoAnterior).toBeNull();
  });

  it('retorna array vazio quando não há histórico', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await repo.buscarHistorico('produto sem historico');
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// contarRegistros
// ─────────────────────────────────────────────

describe('PrecoRepository.contarRegistros', () => {
  it('conta pontos no historico do produto normalizado', async () => {
    mockQueryRaw.mockResolvedValue([{ total: 42n }]);
    const result = await repo.contarRegistros('  ARROZ  ');
    expect(result).toBe(42);
  });

  it('retorna 0 quando não há registros', async () => {
    mockQueryRaw.mockResolvedValue([]);
    expect(await repo.contarRegistros('inexistente')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// buscarUltimoPreco
// ─────────────────────────────────────────────

describe('PrecoRepository.buscarUltimoPreco', () => {
  it('retorna null quando não encontra registro', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await repo.buscarUltimoPreco('inexistente')).toBeNull();
  });

  it('retorna PrecoRow mapeado quando encontra registro', async () => {
    const row = {
      id: 1,
      produto: 'arroz 5kg',
      preco: new Prisma.Decimal(25.9),
      precoAnterior: new Prisma.Decimal(23.5),
      mercado: 'Mercado A',
      cnpj: '00.000.000/0001-00',
      cidade: 'salvador',
      municipio: null,
      ean: null,
      unidade: null,
      fonte: 'api' as const,
      dataColeta: new Date('2024-01-10'),
      atualizadoEm: new Date('2024-01-12'),
      criadoEm: new Date('2024-01-10'),
    };
    mockFindFirst.mockResolvedValue(row);
    const result = await repo.buscarUltimoPreco('arroz 5kg');
    expect(result).not.toBeNull();
    expect(result!.produto).toBe('arroz 5kg');
    expect(result!.precoAnterior).toBe(23.5);
  });
});

// ─────────────────────────────────────────────
// buscarStatsBatch
// ─────────────────────────────────────────────

describe('PrecoRepository.buscarStatsBatch', () => {
  it('retorna Map vazio e não chama o banco quando produtos é vazio', async () => {
    const result = await repo.buscarStatsBatch([]);
    expect(result.size).toBe(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('filtra por cidade slug (não ILIKE em municipio) e usa o slug normalizado', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ produto: 'arroz 5kg', precoMinAtual: 25.9 }])
      .mockResolvedValueOnce([]);

    await repo.buscarStatsBatch(['Arroz 5kg'], 'Teixeira de Freitas');

    const [[sqlAtual], [sqlHist]] = mockQueryRaw.mock.calls as [
      [{ strings: readonly string[]; values: unknown[] }],
      [{ strings: readonly string[]; values: unknown[] }],
    ];

    const sqlAtualStr = sqlAtual.strings.join(' ');
    expect(sqlAtualStr).toContain('cidade =');
    expect(sqlAtualStr).not.toContain('ILIKE');
    expect(sqlAtual.values).toContain('teixeira-de-freitas');

    const sqlHistStr = sqlHist.strings.join(' ');
    expect(sqlHistStr).toContain('p.cidade =');
    expect(sqlHistStr).not.toContain('ILIKE');
    expect(sqlHist.values).toContain('teixeira-de-freitas');
  });

  it('aplica cap de 50 pontos por produto no histórico (ROW_NUMBER por produto)', async () => {
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await repo.buscarStatsBatch(['arroz 5kg']);

    const [, [sqlHist]] = mockQueryRaw.mock.calls as [
      [{ strings: readonly string[]; values: unknown[] }],
      [{ strings: readonly string[]; values: unknown[] }],
    ];
    const sqlStr = sqlHist.strings.join(' ');
    expect(sqlStr).toContain('ROW_NUMBER()');
    expect(sqlStr).toContain('PARTITION BY p.produto');
    expect(sqlStr).toContain('rn <= 50');
    expect(sqlStr).not.toMatch(/LIMIT\s+500/);
  });

  it('omite o filtro de cidade quando municipio não é informado', async () => {
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await repo.buscarStatsBatch(['arroz 5kg']);

    const [[sqlAtual], [sqlHist]] = mockQueryRaw.mock.calls as [
      [{ strings: readonly string[]; values: unknown[] }],
      [{ strings: readonly string[]; values: unknown[] }],
    ];
    expect(sqlAtual.strings.join(' ')).not.toContain('cidade =');
    expect(sqlHist.strings.join(' ')).not.toContain('cidade =');
  });

  it('monta ResumoPreco com tendência, sparkline e ehMinimoHistorico', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ produto: 'arroz 5kg', precoMinAtual: 20 }])
      .mockResolvedValueOnce([
        { produto: 'arroz 5kg', preco: 30, dataColeta: new Date('2024-01-01') },
        { produto: 'arroz 5kg', preco: 28, dataColeta: new Date('2024-01-05') },
        { produto: 'arroz 5kg', preco: 25, dataColeta: new Date('2024-01-10') },
        { produto: 'arroz 5kg', preco: 20, dataColeta: new Date('2024-01-15') },
      ]);

    const result = await repo.buscarStatsBatch(['arroz 5kg']);
    const resumo = result.get('arroz 5kg');

    expect(resumo).toBeDefined();
    expect(resumo!.precoMinAtual).toBe(20);
    expect(resumo!.precoMin30d).toBe(20);
    expect(resumo!.ehMinimoHistorico).toBe(true);
    expect(resumo!.tendencia).toBe('caindo');
    expect(resumo!.sparkline).toHaveLength(4);
  });
});
