import NodeCache from 'node-cache';
import { withCache } from '../shared/cache/with-cache';

describe('withCache', () => {
  let cache: NodeCache;

  beforeEach(() => {
    cache = new NodeCache();
  });

  it('chama fn e armazena o resultado em caso de cache miss', async () => {
    const fn = jest.fn().mockResolvedValue('valor');
    const resultado = await withCache(cache, 'chave', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(resultado).toBe('valor');
  });

  it('retorna valor em cache sem chamar fn em caso de cache hit', async () => {
    cache.set('chave', 'cached');
    const fn = jest.fn();
    const resultado = await withCache(cache, 'chave', fn);
    expect(fn).not.toHaveBeenCalled();
    expect(resultado).toBe('cached');
  });

  it('chaves diferentes não interferem entre si', async () => {
    const fn1 = jest.fn().mockResolvedValue('a');
    const fn2 = jest.fn().mockResolvedValue('b');
    const r1 = await withCache(cache, 'k1', fn1);
    const r2 = await withCache(cache, 'k2', fn2);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('segunda chamada com mesma chave usa o cache', async () => {
    const fn = jest.fn().mockResolvedValue('valor');
    await withCache(cache, 'chave', fn);
    await withCache(cache, 'chave', fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propaga erro lançado pela fn sem armazenar em cache', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('falha'));
    await expect(withCache(cache, 'chave', fn)).rejects.toThrow('falha');
    expect(cache.get('chave')).toBeUndefined();
  });
});
