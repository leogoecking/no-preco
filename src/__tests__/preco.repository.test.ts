const mockCreateMany = jest.fn();
const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCount = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('../shared/database/prisma', () => ({
  prisma: {
    preco: {
      createMany: mockCreateMany,
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      count: mockCount,
    },
    $queryRaw: mockQueryRaw,
  },
}));

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
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('normaliza o nome do produto para lowercase antes de salvar', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 });
    await repo.salvarLote([produtoPreco({ nome: '  ARROZ 5KG  ' })], 'api');
    const chamada = mockCreateMany.mock.calls[0]![0] as { data: { produto: string }[] };
    expect(chamada.data[0]!.produto).toBe('arroz 5kg');
  });

  it('retorna o count retornado pelo Prisma', async () => {
    mockCreateMany.mockResolvedValue({ count: 3 });
    const result = await repo.salvarLote([produtoPreco(), produtoPreco(), produtoPreco()], 'api');
    expect(result).toBe(3);
  });

  it('propaga a fonte correta', async () => {
    mockCreateMany.mockResolvedValue({ count: 1 });
    await repo.salvarLote([produtoPreco()], 'browser');
    const chamada = mockCreateMany.mock.calls[0]![0] as { data: { fonte: string }[] };
    expect(chamada.data[0]!.fonte).toBe('browser');
  });

  it('lança RepositoryError quando createMany falha', async () => {
    mockCreateMany.mockRejectedValue(new Error('db error'));
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
});

// ─────────────────────────────────────────────
// buscarHistorico
// ─────────────────────────────────────────────

describe('PrecoRepository.buscarHistorico', () => {
  const prismaRow = {
    id: 1,
    produto: 'arroz 5kg',
    preco: { toNumber: () => 25.9 } as unknown as import('@prisma/client').Prisma.Decimal,
    mercado: 'Mercado A',
    cnpj: '00.000.000/0001-00',
    cidade: 'salvador',
    municipio: 'Salvador',
    ean: null,
    unidade: null,
    fonte: 'api' as const,
    dataColeta: new Date('2024-01-10'),
    criadoEm: new Date('2024-01-10'),
  };

  it('retorna preços mapeados para PrecoRow', async () => {
    mockFindMany.mockResolvedValue([prismaRow]);
    const result = await repo.buscarHistorico('arroz 5kg');
    expect(result).toHaveLength(1);
    expect(result[0]!.produto).toBe('arroz 5kg');
    expect(result[0]!.preco).toBe(Number(prismaRow.preco));
  });

  it('retorna array vazio quando não há histórico', async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await repo.buscarHistorico('produto sem historico');
    expect(result).toEqual([]);
  });

  it('passa limite para o findMany', async () => {
    mockFindMany.mockResolvedValue([]);
    await repo.buscarHistorico('arroz', { limite: 10 });
    const chamada = mockFindMany.mock.calls[0]![0] as { take: number };
    expect(chamada.take).toBe(10);
  });
});

// ─────────────────────────────────────────────
// contarRegistros
// ─────────────────────────────────────────────

describe('PrecoRepository.contarRegistros', () => {
  it('normaliza o produto e chama count', async () => {
    mockCount.mockResolvedValue(42);
    const result = await repo.contarRegistros('  ARROZ  ');
    expect(result).toBe(42);
    const chamada = mockCount.mock.calls[0]![0] as { where: { produto: string } };
    expect(chamada.where.produto).toBe('arroz');
  });

  it('retorna 0 quando não há registros', async () => {
    mockCount.mockResolvedValue(0);
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
      preco: { toNumber: () => 25.9 } as unknown as import('@prisma/client').Prisma.Decimal,
      mercado: 'Mercado A',
      cnpj: '00.000.000/0001-00',
      cidade: 'salvador',
      municipio: null,
      ean: null,
      unidade: null,
      fonte: 'api' as const,
      dataColeta: new Date('2024-01-10'),
      criadoEm: new Date('2024-01-10'),
    };
    mockFindFirst.mockResolvedValue(row);
    const result = await repo.buscarUltimoPreco('arroz 5kg');
    expect(result).not.toBeNull();
    expect(result!.produto).toBe('arroz 5kg');
  });
});
