import NodeCache from 'node-cache';
import { buildKey, cacheRapido, cacheLento } from '../shared/cache/app-cache';

describe('buildKey', () => {
  it('gera chave com prefixo e parâmetros', () => {
    const chave = buildKey('busca', { termo: 'arroz', dias: 7 });
    expect(chave).toMatch(/^busca:/);
    expect(chave).toContain('arroz');
    expect(chave).toContain('7');
  });

  it('é determinística — mesma entrada, mesma saída', () => {
    const a = buildKey('busca', { termo: 'arroz', cidade: 'salvador', dias: 7 });
    const b = buildKey('busca', { termo: 'arroz', cidade: 'salvador', dias: 7 });
    expect(a).toBe(b);
  });

  it('ordena as chaves do objeto — independe da ordem dos params', () => {
    const a = buildKey('busca', { dias: 7, termo: 'arroz' });
    const b = buildKey('busca', { termo: 'arroz', dias: 7 });
    expect(a).toBe(b);
  });

  it('diferencia chaves com params distintos', () => {
    const a = buildKey('busca', { termo: 'arroz' });
    const b = buildKey('busca', { termo: 'feijao' });
    expect(a).not.toBe(b);
  });

  it('diferencia chaves com prefixos distintos', () => {
    const a = buildKey('busca', { termo: 'arroz' });
    const b = buildKey('historico', { termo: 'arroz' });
    expect(a).not.toBe(b);
  });

  it('trata valores undefined sem quebrar', () => {
    expect(() => buildKey('busca', { municipio: undefined })).not.toThrow();
  });
});

describe('instâncias de cache', () => {
  afterEach(() => {
    cacheRapido.flushAll();
    cacheLento.flushAll();
  });

  it('cacheRapido armazena e recupera valor', () => {
    cacheRapido.set('chave1', { dado: 'valor' });
    expect(cacheRapido.get('chave1')).toEqual({ dado: 'valor' });
  });

  it('cacheLento armazena e recupera valor', () => {
    cacheLento.set('chave2', [1, 2, 3]);
    expect(cacheLento.get('chave2')).toEqual([1, 2, 3]);
  });

  it('retorna undefined para chave inexistente', () => {
    expect(cacheRapido.get('inexistente')).toBeUndefined();
  });

  it('cacheRapido e cacheLento são instâncias independentes', () => {
    cacheRapido.set('x', 'rapido');
    expect(cacheLento.get('x')).toBeUndefined();
  });

  it('cacheRapido tem TTL de 5 minutos', () => {
    const stats = (cacheRapido as unknown as { options: { stdTTL: number } }).options;
    expect(stats.stdTTL).toBe(300);
  });

  it('cacheLento tem TTL de 30 minutos', () => {
    const stats = (cacheLento as unknown as { options: { stdTTL: number } }).options;
    expect(stats.stdTTL).toBe(1800);
  });
});
