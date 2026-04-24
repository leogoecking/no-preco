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

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error((b as { erro?: string }).erro ?? `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

import type {
  ResultadoBusca,
  ResultadoBuscaEan,
  ResultadoAnalise,
  ResultadoAlertas,
  ResultadoHistorico,
  StatusColeta,
  ItemCarrinho,
  StatsResponse,
} from '@/types/api'

export const EAN_REGEX = /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/

export const api = {
  buscar: (produto: string) =>
    get<ResultadoBusca>('/buscar', { produto, municipio: MUNICIPIO, dias: 7, limite: 50 }),

  buscarPorEan: (ean: string) =>
    get<ResultadoBuscaEan>(`/buscar/ean/${ean}`, { municipio: MUNICIPIO }),

  analisarCarrinho: (itens: ItemCarrinho[]) =>
    post<ResultadoAnalise>('/analise/carrinho', { municipio: MUNICIPIO, itens }),

  alertas: () =>
    get<ResultadoAlertas>('/inteligencia/alertas', { municipio: MUNICIPIO, variacaoLimiar: -5 }),

  historico: (produto: string) =>
    get<ResultadoHistorico>('/produtos/historico', { produto, municipio: MUNICIPIO, limite: 60 }),

  login: (usuario: string, senha: string) =>
    post<{ token: string }>('/auth/login', { usuario, senha }),

  coletaStatus: () =>
    get<StatusColeta>('/coleta/status'),

  coletaDisparar: (token: string, produto?: string, municipio?: string) =>
    post<{ mensagem: string; status: string }>(
      '/coleta/disparar',
      { produto, municipio },
      token,
    ),

  stats: (produtos: string[]) =>
    post<StatsResponse>('/produtos/stats', { produtos, municipio: MUNICIPIO }),
}
