import {
  calcularResumoPreco,
  calcularTendencia,
  PontoHistorico,
} from '../modules/preco/preco.stats';

function ponto(preco: number, data: string): PontoHistorico {
  return { preco, dataColeta: new Date(data) };
}

describe('calcularResumoPreco', () => {
  it('sem histórico: usa o próprio precoMinAtual como mínimo e média', () => {
    const r = calcularResumoPreco(20, []);
    expect(r.precoMinAtual).toBe(20);
    expect(r.precoMin30d).toBe(20);
    expect(r.precoMedio30d).toBe(20);
    expect(r.variacaoVsMedia30d).toBe(0);
    expect(r.ehMinimoHistorico).toBe(true);
    expect(r.tendencia).toBe('estavel');
    expect(r.sparkline).toEqual([]);
  });

  it('histórico em queda: tendência caindo e ehMinimoHistorico verdadeiro', () => {
    const r = calcularResumoPreco(20, [
      ponto(30, '2024-01-01'),
      ponto(28, '2024-01-05'),
      ponto(25, '2024-01-10'),
      ponto(20, '2024-01-15'),
    ]);
    expect(r.precoMin30d).toBe(20);
    expect(r.tendencia).toBe('caindo');
    expect(r.ehMinimoHistorico).toBe(true);
    expect(r.variacaoVsMedia30d).toBeLessThan(0);
  });

  it('histórico em alta: tendência subindo e ehMinimoHistorico falso quando precoMinAtual está acima', () => {
    const r = calcularResumoPreco(35, [
      ponto(20, '2024-01-01'),
      ponto(22, '2024-01-05'),
      ponto(25, '2024-01-10'),
      ponto(30, '2024-01-15'),
    ]);
    expect(r.tendencia).toBe('subindo');
    expect(r.ehMinimoHistorico).toBe(false);
    expect(r.variacaoVsMedia30d).toBeGreaterThan(0);
  });

  it('aplica tolerância de 5% para ehMinimoHistorico', () => {
    const dentro = calcularResumoPreco(21, [ponto(20, '2024-01-01'), ponto(22, '2024-01-05')]);
    expect(dentro.ehMinimoHistorico).toBe(true);

    const fora = calcularResumoPreco(22, [ponto(20, '2024-01-01'), ponto(20, '2024-01-05')]);
    expect(fora.ehMinimoHistorico).toBe(false);
  });

  it('sparkline limita aos últimos 8 pontos preservando ordem', () => {
    const hist: PontoHistorico[] = [];
    for (let i = 1; i <= 10; i++) hist.push(ponto(i, `2024-01-${String(i).padStart(2, '0')}`));

    const r = calcularResumoPreco(10, hist);
    expect(r.sparkline).toHaveLength(8);
    expect(r.sparkline[0]!.preco).toBe(3);
    expect(r.sparkline[7]!.preco).toBe(10);
    expect(r.sparkline[0]!.dataColeta).toBe(new Date('2024-01-03').toISOString());
  });

  it('variacaoVsMedia30d arredonda para uma casa decimal', () => {
    const r = calcularResumoPreco(10, [ponto(11, '2024-01-01'), ponto(13, '2024-01-05')]);
    // média = 12 → variação = (10-12)/12 = -0.16666... → -16.7
    expect(r.variacaoVsMedia30d).toBe(-16.7);
  });
});

describe('calcularTendencia', () => {
  it('menos de 4 pontos retorna estavel', () => {
    expect(calcularTendencia([])).toBe('estavel');
    expect(calcularTendencia([10])).toBe('estavel');
    expect(calcularTendencia([10, 20, 30])).toBe('estavel');
  });

  it('queda acima do limiar de 3% retorna caindo', () => {
    expect(calcularTendencia([100, 100, 90, 90])).toBe('caindo');
  });

  it('alta acima do limiar de 3% retorna subindo', () => {
    expect(calcularTendencia([90, 90, 100, 100])).toBe('subindo');
  });

  it('variação dentro do limiar retorna estavel', () => {
    expect(calcularTendencia([100, 100, 101, 101])).toBe('estavel');
  });
});
