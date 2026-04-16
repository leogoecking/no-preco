import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import { createHttpClient } from '../../shared/http/axios-client';
import { buildApiHeaders } from '../../shared/http/browser-headers';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const BASE_URL = 'https://precodahora.ba.gov.br';

// Endpoints descobertos via DevTools — Network tab (XHR/Fetch)
const ENDPOINTS = {
  // API JSON interna (prioridade 1 — mais limpa e rápida)
  apiProdutos: '/produtos/pesquisa/',
  // Fallback: página HTML com tabela de resultados
  htmlPesquisa: '/produtos/',
} as const;

const client = createHttpClient(BASE_URL);

// ─────────────────────────────────────────────
// Retry com backoff exponencial
// ─────────────────────────────────────────────

/** Delays (ms) entre tentativas: 1ª retentar após 2s, 2ª após 4s, desiste. */
const DELAYS_RETRY_MS = [2_000, 4_000] as const;

/**
 * Erros transientes merecem retry (rede instável, timeout, 5xx).
 * Bloqueios explícitos (403/429) não devem ser retentados — ativam o circuit breaker.
 */
function ehErroTransiente(err: unknown): boolean {
  const axiosErr = err as AxiosError;
  const status = axiosErr.response?.status;
  if (status === 403 || status === 429) return false;
  if (!axiosErr.response) return true; // ECONNABORTED, ENETUNREACH, sem resposta
  return status !== undefined && status >= 500;
}

async function comRetry<T>(fn: () => Promise<T>, contexto: string): Promise<T> {
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= DELAYS_RETRY_MS.length; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;

      const ehUltimaTentativa = tentativa === DELAYS_RETRY_MS.length;
      if (!ehErroTransiente(err) || ehUltimaTentativa) throw err;

      const espera = DELAYS_RETRY_MS[tentativa];
      console.warn(
        `[scraper] ${contexto} — tentativa ${tentativa + 1} falhou. Retentar em ${espera / 1_000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  // Nunca alcançado, mas satisfaz o compilador
  throw ultimoErro;
}

// ─────────────────────────────────────────────
// Estratégia 1: API JSON oculta
// ─────────────────────────────────────────────

async function buscarViaApi(params: BuscaParams): Promise<ProdutoPreco[]> {
  const url = ENDPOINTS.apiProdutos;

  // A API do site usa "codmun" (código IBGE inteiro) para filtrar por município.
  // "municipio" (string) é usado apenas na estratégia HTML de fallback.
  const queryParams: Record<string, unknown> = {
    produto: params.termo,
    pagina: params.pagina ?? 1,
    ordenar: 'preco.asc',
    raio: 15,
    horas: 48,
  };

  if (params.municipioId != null) {
    queryParams['codmun'] = params.municipioId;
  }

  const response = await client.get<unknown>(url, {
    params: queryParams,
    headers: buildApiHeaders(BASE_URL + ENDPOINTS.htmlPesquisa),
  });

  const data = response.data;

  // Valida shape mínima esperada: { results: [...] } ou { data: [...] }
  if (!data || typeof data !== 'object') {
    throw new Error('Resposta da API não é um objeto JSON válido');
  }

  const raw = data as Record<string, unknown>;
  const lista: unknown[] = (raw['results'] as unknown[]) ?? (raw['data'] as unknown[]) ?? [];

  if (!Array.isArray(lista)) {
    throw new Error(`Shape inesperado — campo "results"/"data" não é array. Keys: ${Object.keys(raw).join(', ')}`);
  }

  return lista.map(normalizarItemApi);
}

function normalizarItemApi(item: unknown): ProdutoPreco {
  if (!item || typeof item !== 'object') {
    throw new Error('Item da API inválido');
  }

  const raw = item as Record<string, unknown>;

  const preco = parsePreco(raw['preco'] ?? raw['vl_preco'] ?? raw['valor'] ?? 0);

  // O nome do município pode vir sob várias chaves dependendo da versão da API.
  // "localidade" é o nome observado no endpoint /municipios/ do próprio site.
  const municipioNome =
    String(raw['municipio'] ?? raw['nm_municipio'] ?? raw['localidade'] ?? raw['cidade'] ?? '').trim() || undefined;

  return {
    nome: String(raw['produto'] ?? raw['nome'] ?? raw['ds_produto'] ?? '').trim(),
    preco,
    mercado: String(raw['estabelecimento'] ?? raw['mercado'] ?? raw['nm_estabelecimento'] ?? '').trim(),
    cnpj: formatarCnpj(String(raw['cnpj'] ?? raw['nu_cnpj'] ?? '')),
    municipio: municipioNome,
    dataColeta: String(raw['data'] ?? raw['dt_coleta'] ?? '').trim() || undefined,
    unidade: String(raw['unidade'] ?? raw['ds_unidade'] ?? '').trim() || undefined,
  };
}

// ─────────────────────────────────────────────
// Estratégia 2: parse HTML com Cheerio (fallback)
// ─────────────────────────────────────────────

async function buscarViaHtml(params: BuscaParams): Promise<ProdutoPreco[]> {
  const url = ENDPOINTS.htmlPesquisa;

  // O HTML aceita o nome do município como string. Se só temos o ID, não há como
  // resolver o nome sem uma chamada extra ao /municipios/ — nesse caso, omitimos
  // o filtro e aceitamos resultados sem recorte geográfico preciso.
  const queryParams: Record<string, unknown> = {
    q: params.termo,
    page: params.pagina ?? 1,
  };

  if (params.municipio) {
    queryParams['municipio'] = params.municipio;
  }

  const response = await client.get<string>(url, {
    params: queryParams,
    responseType: 'text',
  });

  const html = response.data;

  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('Resposta HTML vazia');
  }

  return parseHtml(html, params.termo);
}

function parseHtml(html: string, termoBusca: string): ProdutoPreco[] {
  const $ = cheerio.load(html);
  const itens: ProdutoPreco[] = [];

  // Seletor baseado na estrutura comum do Preço da Hora BA.
  // AJUSTE estes seletores após inspecionar o HTML real no DevTools.
  const linhas = $('table.tabela-produtos tbody tr, .card-produto, [data-produto]');

  if (linhas.length === 0) {
    // Verifica se há indicação de bloqueio/captcha na página
    const pageText = $('body').text().toLowerCase();
    if (pageText.includes('captcha') || pageText.includes('acesso negado') || pageText.includes('403')) {
      throw Object.assign(new Error('Possível bloqueio detectado no HTML'), { tipo: 'BLOQUEIO_403' });
    }

    console.warn(`[scraper] Nenhum seletor encontrou dados para "${termoBusca}". HTML recebido: ${html.slice(0, 300)}`);
    return [];
  }

  linhas.each((_i, el) => {
    try {
      const linha = $(el);

      // Tentativas de seletor para cada campo — adaptar ao HTML real
      const nome =
        linha.find('[data-nome], .produto-nome, td:nth-child(1)').first().text().trim() ||
        linha.attr('data-nome') ||
        '';

      const precoRaw =
        linha.find('[data-preco], .produto-preco, td:nth-child(2)').first().text().trim() ||
        linha.attr('data-preco') ||
        '0';

      const mercado =
        linha.find('[data-mercado], .produto-mercado, td:nth-child(3)').first().text().trim() ||
        linha.attr('data-mercado') ||
        '';

      const cnpj =
        linha.find('[data-cnpj], .produto-cnpj, td:nth-child(4)').first().text().trim() ||
        linha.attr('data-cnpj') ||
        '';

      if (!nome && !precoRaw) return; // linha vazia — pula

      itens.push({
        nome,
        preco: parsePreco(precoRaw),
        mercado,
        cnpj: formatarCnpj(cnpj),
        municipio: linha.find('.produto-municipio, td:nth-child(5)').first().text().trim() || undefined,
        dataColeta: linha.find('.produto-data, td:nth-child(6)').first().text().trim() || undefined,
      });
    } catch (err) {
      console.warn('[scraper] Falha ao parsear linha individual:', err);
    }
  });

  return itens;
}

// ─────────────────────────────────────────────
// Orquestrador: API JSON → fallback HTML
// ─────────────────────────────────────────────

export async function buscarProdutos(params: BuscaParams): Promise<ResultadoBusca> {
  const pagina = params.pagina ?? 1;
  let itens: ProdutoPreco[] = [];
  let estrategiaUsada = 'api';

  try {
    itens = await comRetry(
      () => buscarViaApi(params),
      `API "${params.termo}"`,
    );
  } catch (apiErr) {
    const axiosErr = apiErr as AxiosError;
    const status = axiosErr.response?.status;

    console.warn(`[scraper] API falhou (status ${status ?? 'sem resposta'}), tentando HTML...`);

    // 404 na rota da API é esperado se o endpoint mudou → tenta HTML
    // 403/429 → o site está bloqueando ativamente
    if (status === 403 || status === 429) {
      throw buildScraperError('BLOQUEIO_403', `Servidor retornou ${status}`, axiosErr, ENDPOINTS.apiProdutos);
    }

    try {
      estrategiaUsada = 'html';
      itens = await comRetry(
        () => buscarViaHtml(params),
        `HTML "${params.termo}"`,
      );
    } catch (htmlErr) {
      throw buildScraperError(
        classificarErro(htmlErr),
        'Ambas as estratégias falharam',
        htmlErr,
        ENDPOINTS.htmlPesquisa,
      );
    }
  }

  // Resolve o nome do município para o retorno:
  // 1) nome que veio nos itens da API (mais confiável)
  // 2) params.municipio passado pelo chamador (fallback)
  const municipioResolvido =
    itens.find((i) => i.municipio)?.municipio ?? params.municipio;

  console.log(
    `[scraper] "${params.termo}" — ${itens.length} itens via ${estrategiaUsada}` +
    (municipioResolvido ? ` (${municipioResolvido})` : ''),
  );

  return {
    termo: params.termo,
    municipio: municipioResolvido,
    municipioId: params.municipioId,
    pagina,
    totalItens: itens.length,
    itens,
  };
}

// ─────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────

function parsePreco(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  const str = String(valor)
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function formatarCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function classificarErro(err: unknown): ScraperError['tipo'] {
  const axiosErr = err as AxiosError;
  if (axiosErr.code === 'ECONNABORTED') return 'TIMEOUT';
  if (axiosErr.response?.status === 403 || axiosErr.response?.status === 429) return 'BLOQUEIO_403';
  if ((err as Error & { tipo?: string }).tipo === 'BLOQUEIO_403') return 'BLOQUEIO_403';
  return 'PARSE_FALHOU';
}

function buildScraperError(
  tipo: ScraperError['tipo'],
  mensagem: string,
  err: unknown,
  urlTentada?: string,
): ScraperError {
  const detalhes = err instanceof Error ? err.message : String(err);
  return { tipo, mensagem, detalhes, urlTentada };
}
