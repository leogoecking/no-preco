const BASE = '/api'
const MUNICIPIO = 'Teixeira de Freitas'

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { erro?: string }).erro ?? `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { erro?: string }).erro ?? `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

import type { ResultadoBusca, ResultadoAnalise, ItemCarrinho } from '@/types/api'

export const api = {
  buscar: (produto: string) =>
    get<ResultadoBusca>('/buscar', { produto, municipio: MUNICIPIO, dias: 7, limite: 50 }),

  analisarCarrinho: (itens: ItemCarrinho[]) =>
    post<ResultadoAnalise>('/analise/carrinho', { municipio: MUNICIPIO, itens }),
}
