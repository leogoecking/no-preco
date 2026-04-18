import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import { createHttpClient } from '../../shared/http/axios-client';
import { buildApiHeaders } from '../../shared/http/browser-headers';
import { getBrowser } from '../../shared/http/browser-client';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const BASE_URL = 'https://precodahora.ba.gov.br';

// Endpoints descobertos via DevTools — Network tab (XHR/Fetch)
const ENDPOINTS = {
  // API JSON interna (prioridade 1 — mais limpa e rápida)
  apiProdutos: '/produtos/',
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
  const { csrfToken, cookie } = await obterCredenciaisBusca();
  const municipioId = params.municipioId ?? resolverMunicipioId(params.municipio);

  // A API do site usa "codmun" (código IBGE inteiro) para filtrar por município.
  // "municipio" (string) é usado apenas na estratégia HTML de fallback.
  const form = new URLSearchParams({
    termo: params.ean ?? params.termo,
    pagina: String(params.pagina ?? 1),
    ordenar: 'preco.asc',
    raio: '15',
    horas: '48',
  });

  if (municipioId != null) {
    form.set('codmun', String(municipioId));
  }

  const response = await client.post<unknown>(url, form, {
    headers: {
      ...buildApiHeaders(BASE_URL + ENDPOINTS.htmlPesquisa),
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': csrfToken,
      Cookie: cookie,
    },
  });

  const data = response.data;

  // Valida shape mínima esperada: { results: [...] } ou { data: [...] }
  if (!data || typeof data !== 'object') {
    throw new Error('Resposta da API não é um objeto JSON válido');
  }

  const raw = data as Record<string, unknown>;
  const lista: unknown[] =
    (raw['resultado'] as unknown[]) ??
    (raw['results'] as unknown[]) ??
    (raw['data'] as unknown[]) ??
    [];

  if (!Array.isArray(lista)) {
    throw new Error(
      `Shape inesperado — lista de resultados não é array. Keys: ${Object.keys(raw).join(', ')}`,
    );
  }

  return lista.map(normalizarItemApi);
}

async function obterCredenciaisBusca(): Promise<{ csrfToken: string; cookie: string }> {
  const response = await client.get<string>(ENDPOINTS.htmlPesquisa, {
    headers: buildApiHeaders(BASE_URL + ENDPOINTS.htmlPesquisa),
    responseType: 'text',
  });

  const $ = cheerio.load(response.data);
  const csrfToken = $('#validate').attr('data-id');
  const rawCookie = response.headers['set-cookie'];
  const cookieArray = Array.isArray(rawCookie) ? rawCookie : rawCookie ? [rawCookie] : [];
  const cookie = cookieArray.map((value) => value.split(';')[0]).join('; ');

  if (!csrfToken || !cookie) {
    throw new Error('Não foi possível obter token CSRF/cookies da página de busca');
  }

  return { csrfToken, cookie };
}

function normalizarItemApi(item: unknown): ProdutoPreco {
  if (!item || typeof item !== 'object') {
    throw new Error('Item da API inválido');
  }

  const raw = item as Record<string, unknown>;

  const produtoRaw = isRecord(raw['produto']) ? raw['produto'] : raw;
  const estabelecimentoRaw = isRecord(raw['estabelecimento']) ? raw['estabelecimento'] : raw;

  const preco = parsePreco(
    produtoRaw['precoUnitario'] ??
      produtoRaw['precoLiquido'] ??
      produtoRaw['precoBruto'] ??
      raw['preco'] ??
      raw['vl_preco'] ??
      raw['valor'] ??
      0,
  );

  // O nome do município pode vir sob várias chaves dependendo da versão da API.
  // "localidade" é o nome observado no endpoint /municipios/ do próprio site.
  const municipioNome =
    String(
      estabelecimentoRaw['municipio'] ??
        raw['municipio'] ??
        raw['nm_municipio'] ??
        raw['localidade'] ??
        raw['cidade'] ??
        '',
    ).trim() || undefined;

  const eanRaw = String(
    produtoRaw['gtin'] ??
      produtoRaw['ean'] ??
      produtoRaw['codigoBarras'] ??
      raw['gtin'] ??
      raw['ean'] ??
      raw['cd_gtin'] ??
      raw['codigoBarras'] ??
      '',
  ).trim();

  return {
    nome: String(produtoRaw['descricao'] ?? raw['nome'] ?? raw['ds_produto'] ?? '').trim(),
    preco,
    mercado: String(
      estabelecimentoRaw['nomeEstabelecimento'] ??
        raw['mercado'] ??
        raw['nm_estabelecimento'] ??
        '',
    ).trim(),
    cnpj: formatarCnpj(String(estabelecimentoRaw['cnpj'] ?? raw['cnpj'] ?? raw['nu_cnpj'] ?? '')),
    cidade: municipioNome,
    municipio: municipioNome,
    dataColeta:
      String(produtoRaw['data'] ?? raw['data'] ?? raw['dt_coleta'] ?? '').trim() || undefined,
    unidade:
      String(produtoRaw['unidade'] ?? raw['unidade'] ?? raw['ds_unidade'] ?? '').trim() ||
      undefined,
    ean: /^\d{8,14}$/.test(eanRaw) ? eanRaw : undefined,
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
    if (
      pageText.includes('captcha') ||
      pageText.includes('acesso negado') ||
      pageText.includes('403')
    ) {
      throw Object.assign(new Error('Possível bloqueio detectado no HTML'), {
        tipo: 'BLOQUEIO_403',
      });
    }

    console.warn(
      `[scraper] Nenhum seletor encontrou dados para "${termoBusca}". HTML recebido: ${html.slice(0, 300)}`,
    );
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
        municipio:
          linha.find('.produto-municipio, td:nth-child(5)').first().text().trim() || undefined,
        dataColeta: linha.find('.produto-data, td:nth-child(6)').first().text().trim() || undefined,
      });
    } catch (err) {
      console.warn('[scraper] Falha ao parsear linha individual:', err);
    }
  });

  return itens;
}

// ─────────────────────────────────────────────
// Estratégia 3: Browser headless (Puppeteer)
//
// Resolve o challenge JS do site automaticamente:
// 1. Abre uma Page no Chromium compartilhado
// 2. Intercepta a resposta XHR de /produtos/pesquisa/ (JSON real)
// 3. Se não capturar JSON, faz parse do HTML já renderizado pelo browser
// ─────────────────────────────────────────────

async function buscarViaBrowser(params: BuscaParams): Promise<ProdutoPreco[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Bloqueia recursos desnecessários para acelerar o carregamento
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const tipo = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Captura a resposta do endpoint JSON interno quando o browser a receber
    let dadosApi: unknown = null;
    page.on('response', async (response) => {
      if (response.url().includes('/produtos/pesquisa/') && dadosApi === null) {
        try {
          const contentType = response.headers()['content-type'] ?? '';
          if (contentType.includes('json')) {
            dadosApi = await response.json();
          }
        } catch {
          // Resposta não era JSON — ignora
        }
      }
    });

    // Monta URL da busca com os parâmetros disponíveis
    const url = new URL(`${BASE_URL}${ENDPOINTS.htmlPesquisa}`);
    url.searchParams.set('q', params.termo);
    if (params.municipio) url.searchParams.set('municipio', params.municipio);

    // Navega até a página — o browser executa o challenge JS e dispara o XHR
    await page.goto(url.toString(), {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    });

    // Se o XHR foi capturado, normaliza com a mesma função da estratégia API
    if (dadosApi !== null) {
      const raw = dadosApi as Record<string, unknown>;
      const lista: unknown[] =
        (raw['resultado'] as unknown[]) ??
        (raw['results'] as unknown[]) ??
        (raw['data'] as unknown[]) ??
        [];
      if (Array.isArray(lista) && lista.length > 0) {
        return lista.map(normalizarItemApi);
      }
    }

    // Fallback: parse do HTML já renderizado pelo Chromium
    const htmlRenderizado = await page.content();
    return parseHtml(htmlRenderizado, params.termo);
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────
// Orquestrador: API JSON → fallback HTML → browser
// ─────────────────────────────────────────────

export async function buscarProdutos(params: BuscaParams): Promise<ResultadoBusca> {
  const pagina = params.pagina ?? 1;
  let itens: ProdutoPreco[] = [];
  let estrategiaUsada = 'api';

  try {
    itens = await comRetry(() => buscarViaApi(params), `API "${params.termo}"`);
  } catch (apiErr) {
    const axiosErr = apiErr as AxiosError;
    const status = axiosErr.response?.status;

    console.warn(`[scraper] API falhou (status ${status ?? 'sem resposta'}), tentando HTML...`);

    // 404 na rota da API é esperado se o endpoint mudou → tenta HTML
    // 403/429 → o site está bloqueando ativamente
    if (status === 403 || status === 429) {
      throw buildScraperError(
        'BLOQUEIO_403',
        `Servidor retornou ${status}`,
        axiosErr,
        ENDPOINTS.apiProdutos,
      );
    }

    try {
      estrategiaUsada = 'html';
      itens = await comRetry(() => buscarViaHtml(params), `HTML "${params.termo}"`);
    } catch {
      // API e HTML falharam — usa browser headless como última opção
    }

    if (itens.length === 0) {
      try {
        estrategiaUsada = 'browser';
        itens = await buscarViaBrowser(params);
      } catch (browserErr) {
        throw buildScraperError(
          classificarErro(browserErr),
          'Todas as estratégias falharam (axios API, axios HTML, browser)',
          browserErr,
          ENDPOINTS.htmlPesquisa,
        );
      }
    }
  }

  // Resolve o nome do município para o retorno:
  // 1) nome que veio nos itens da API (mais confiável)
  // 2) params.municipio passado pelo chamador (fallback)
  const municipioResolvido = itens.find((i) => i.municipio)?.municipio ?? params.municipio;

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

function resolverMunicipioId(municipio?: string): number | undefined {
  if (!municipio) return undefined;

  const municipios: Record<string, number> = {
    salvador: 2927408,
    'teixeira-de-freitas': 2931350,
  };

  return municipios[normalizarSlug(municipio)];
}

function normalizarSlug(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
