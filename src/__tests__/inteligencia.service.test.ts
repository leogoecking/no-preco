jest.mock('../modules/inteligencia/inteligencia.repository', () => ({
  buscarEstatisticasSemana: jest.fn(),
  buscarRankingVolatilidade: jest.fn(),
  buscarAlertasMinHistorico: jest.fn(),
}));

import {
  obterEstatisticas,
  obterVolatilidade,
  obterAlertas,
} from '../modules/inteligencia/inteligencia.service';
import {
  buscarEstatisticasSemana,
  buscarRankingVolatilidade,
  buscarAlertasMinHistorico,
} from '../modules/inteligencia/inteligencia.repository';
import {
  EstatisticaProduto,
  ProdutoVolatilidade,
  AlertaPreco,
} from '../modules/inteligencia/inteligencia.types';

const mockBuscarEstatisticas = buscarEstatisticasSemana as jest.MockedFunction<
  typeof buscarEstatisticasSemana
>;
const mockBuscarVolatilidade = buscarRankingVolatilidade as jest.MockedFunction<
  typeof buscarRankingVolatilidade
>;
const mockBuscarAlertas = buscarAlertasMinHistorico as jest.MockedFunction<
  typeof buscarAlertasMinHistorico
>;

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const estatisticaFixture: EstatisticaProduto = {
  produto: 'arroz',
  precoAtual: 25.9,
  mercadoAtual: 'Mercado A',
  precoMin: 23,
  precoMax: 28,
  precoMedio: 25.5,
  amplitudeAbsoluta: 5,
  variacaoVsMedia: 1.57,
  totalAmostras: 10,
  ultimaColeta: new Date('2024-01-10'),
};

const volatilidade: ProdutoVolatilidade = {
  posicao: 1,
  produto: 'arroz',
  precoMin: 23,
  precoMax: 28,
  precoMedio: 25.5,
  desvioPadrao: 1.5,
  coeficienteVariacao: 5.88,
  amplitudePercent: 19.6,
  nivel: 'MODERADO',
  totalAmostras: 12,
};

const alerta: AlertaPreco = {
  produto: 'arroz',
  precoAtual: 22,
  mercadoAtual: 'Mercado A',
  dataUltimaColeta: new Date('2024-01-10'),
  mediaHistorica6m: 25,
  minHistorico6m: 21,
  maxHistorico6m: 30,
  variacaoVsMedia6m: -12,
  ehMinimoHistorico: true,
  totalAmostras6m: 40,
};

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────
// obterEstatisticas
// ─────────────────────────────────────────────

describe('obterEstatisticas', () => {
  it('usa dias = 7 como padrão', async () => {
    mockBuscarEstatisticas.mockResolvedValue([]);
    const resultado = await obterEstatisticas({});
    expect(resultado.janelaEmDias).toBe(7);
  });

  it('respeita dias explícito no filtro', async () => {
    mockBuscarEstatisticas.mockResolvedValue([]);
    const resultado = await obterEstatisticas({ dias: 14 });
    expect(resultado.janelaEmDias).toBe(14);
  });

  it('repassa o filtro ao repository', async () => {
    mockBuscarEstatisticas.mockResolvedValue([]);
    await obterEstatisticas({ municipio: 'Salvador', dias: 7 });
    expect(mockBuscarEstatisticas).toHaveBeenCalledWith({ municipio: 'Salvador', dias: 7 });
  });

  it('retorna shape correto com totalProdutos', async () => {
    mockBuscarEstatisticas.mockResolvedValue([estatisticaFixture]);
    const resultado = await obterEstatisticas({});
    expect(resultado.totalProdutos).toBe(1);
    expect(resultado.produtos).toHaveLength(1);
    expect(resultado.produtos[0]).toEqual(estatisticaFixture);
    expect(resultado.geradoEm).toBeDefined();
  });

  it('retorna totalProdutos = 0 quando não há dados', async () => {
    mockBuscarEstatisticas.mockResolvedValue([]);
    const resultado = await obterEstatisticas({});
    expect(resultado.totalProdutos).toBe(0);
    expect(resultado.produtos).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// obterVolatilidade
// ─────────────────────────────────────────────

describe('obterVolatilidade', () => {
  it('usa dias = 30 e minimoAmostras = 5 como padrão', async () => {
    mockBuscarVolatilidade.mockResolvedValue([]);
    const resultado = await obterVolatilidade({});
    expect(resultado.janelaEmDias).toBe(30);
    expect(resultado.minimoAmostras).toBe(5);
  });

  it('respeita overrides de dias e minimoAmostras', async () => {
    mockBuscarVolatilidade.mockResolvedValue([]);
    const resultado = await obterVolatilidade({ dias: 60, minimoAmostras: 10 });
    expect(resultado.janelaEmDias).toBe(60);
    expect(resultado.minimoAmostras).toBe(10);
  });

  it('repassa filtro ao repository', async () => {
    mockBuscarVolatilidade.mockResolvedValue([]);
    await obterVolatilidade({ municipio: 'Teixeira de Freitas', limite: 5 });
    expect(mockBuscarVolatilidade).toHaveBeenCalledWith({
      municipio: 'Teixeira de Freitas',
      limite: 5,
    });
  });

  it('retorna shape correto com totalProdutosAnalisados', async () => {
    mockBuscarVolatilidade.mockResolvedValue([volatilidade]);
    const resultado = await obterVolatilidade({});
    expect(resultado.totalProdutosAnalisados).toBe(1);
    expect(resultado.ranking[0]).toEqual(volatilidade);
  });
});

// ─────────────────────────────────────────────
// obterAlertas
// ─────────────────────────────────────────────

describe('obterAlertas', () => {
  it('usa variacaoLimiar = -5 como padrão', async () => {
    mockBuscarAlertas.mockResolvedValue([]);
    const resultado = await obterAlertas({});
    expect(resultado.variacaoLimiar).toBe(-5);
  });

  it('respeita variacaoLimiar explícito', async () => {
    mockBuscarAlertas.mockResolvedValue([]);
    const resultado = await obterAlertas({ variacaoLimiar: -10 });
    expect(resultado.variacaoLimiar).toBe(-10);
  });

  it('repassa filtro ao repository', async () => {
    mockBuscarAlertas.mockResolvedValue([]);
    await obterAlertas({ municipio: 'Salvador', variacaoLimiar: -8 });
    expect(mockBuscarAlertas).toHaveBeenCalledWith({
      municipio: 'Salvador',
      variacaoLimiar: -8,
    });
  });

  it('retorna shape correto com totalAlertas', async () => {
    mockBuscarAlertas.mockResolvedValue([alerta]);
    const resultado = await obterAlertas({});
    expect(resultado.totalAlertas).toBe(1);
    expect(resultado.alertas[0]).toEqual(alerta);
    expect(resultado.geradoEm).toBeDefined();
  });

  it('retorna totalAlertas = 0 quando não há alertas', async () => {
    mockBuscarAlertas.mockResolvedValue([]);
    const resultado = await obterAlertas({});
    expect(resultado.totalAlertas).toBe(0);
  });
});
