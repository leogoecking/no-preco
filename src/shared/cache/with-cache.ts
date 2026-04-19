import NodeCache from 'node-cache';

export async function withCache<T>(
  cache: NodeCache,
  chave: string,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = cache.get<T>(chave);
  if (hit !== undefined) return hit;
  const value = await fn();
  cache.set(chave, value);
  return value;
}
