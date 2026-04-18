import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import { createHttpClient } from '../../shared/http/axios-client';
import { buildApiHeaders } from '../../shared/http/browser-headers';
import { getBrowser } from '../../shared/http/browser-client';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const BASE_URL = 'https://precodahora.ba.gov.br';
const ENDPOINT_PESQUISA = '/produtos/pesquisa/';
const ENDPOINT_PAGINA = '/produtos/';

const client = createHttpClient(BASE_URL);

// ─────────────────────────────────────────────
// Cache de sessão Django
//
// O Puppeteer carrega a página uma vez, captura os cookies de sessão
// (incluindo csrftoken) e os armazena aqui. Buscas subsequentes usam
// Axios diretamente — sem abrir browser — até a sessão expirar.
// ─────────────────────────────────────────────

interface Sessao {
  cookies: string;
  csrfToken: string;
  expiresAt: number;
}

const SESSAO_TTL_MS = 25 * 60 * 1000; // 25 minutos
let sessaoCache: Sessao | null = null;

function sessaoValida(): boolean {
  return sessaoCache !== null && Date.now() < sessaoCache.expiresAt;
}

function invalidarSessao(): void {
  sessaoCache = null;
}

// ─────────────────────────────────────────────
// Retry com backoff exponencial
// ─────────────────────────────────────────────

const DELAYS_RETRY_MS = [2_000, 4_000] as const;

function ehErroTransiente(err: unknown): boolean {
  const axiosErr = err as AxiosError;
  const status = axiosErr.response?.status;
  if (status === 403 || status === 429) return false;
  if (!axiosErr.response) return true;
  return status !== undefined && status >= 500;
}

async function comRetry<T>(fn: () => Promise<T>, contexto: string): Promise<T> {
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= DELAYS_RETRY_MS.length; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      const ehUltima = tentativa === DELAYS_RETRY_MS.length;
      if (!ehErroTransiente(err) || ehUltima) throw err;

      const espera = DELAYS_RETRY_MS[tentativa];
      console.warn(
        `[scraper] ${contexto} — tentativa ${tentativa + 1} falhou. Retentar em ${espera / 1_000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  throw ultimoErro;
}

// ─────────────────────────────────────────────
// Estratégia 1: HTTP com sessão cacheada (via rápida)
//
// Usa os cookies + csrftoken capturados pelo Puppeteer para
// fazer requisições diretas sem abrir browser.
// Falha imediatamente se a sessão estiver expirada.
// ─────────────────────────────────────────────

async function buscarViaHttp(params: BuscaParams): Promise<ProdutoPreco[]> {
  if (!sessaoValida()) throw new Error('Sessão não disponível');

  const municipioId = params.municipioId ?? resolverMunicipioId(params.municipio);

  const form = new URLSearchParams({
    termo: params.ean ?? params.termo,
    pagina: String(params.pagina ?? 1),
    ordenar: 'preco.asc',
    raio: '15',
    horas: '48',
  });
  if (municipioId != null) form.set('codmun', String(municipioId));

  const response = await client.post<unknown>(ENDPOINT_PESQUISA, form, {
    headers: {
      ...buildApiHeaders(BASE_URL + ENDPOINT_PAGINA),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': sessaoCache!.csrfToken,
      Cookie: sessaoCache!.cookies,
    },
  });

  return extrairItens(response.data);
}

// ─────────────────────────────────────────────
// Estratégia 2: Browser headless (Puppeteer)
//
// Abre uma Page no Chromium, executa o JS do site e intercepta
// a resposta XHR de /produtos/pesquisa/.
// Ao terminar, salva os cookies de sessão para reutilização via HTTP.
// ─────────────────────────────────────────────

async function buscarViaBrowser(params: BuscaParams): Promise<ProdutoPreco[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const tipo = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let dadosApi: unknown = null;
    page.on('response', async (response) => {
      if (response.url().includes(ENDPOINT_PESQUISA) && dadosApi === null) {
        try {
          const contentType = response.headers()['content-type'] ?? '';
          if (contentType.includes('json')) {
            dadosApi = await response.json();
          }
        } catch {
          // Resposta não era JSON
        }
      }
    });

    const url = new URL(BASE_URL + ENDPOINT_PAGINA);
    url.searchParams.set('q', params.ean ?? params.termo);
    if (params.municipio) url.searchParams.set('municipio', params.municipio);

    await page.goto(url.toString(), { waitUntil: 'networkidle2', timeout: 45_000 });

    // Captura cookies de sessão para reutilização futura via HTTP
    const cookies = await page.cookies();
    const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value ?? '';
    if (csrfToken) {
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      sessaoCache = { cookies: cookieStr, csrfToken, expiresAt: Date.now() + SESSAO_TTL_MS };
      console.log('[scraper] Sessão capturada via Puppeteer — válida por 25 min');
    }

    if (dadosApi !== null) {
      const itens = extrairItens(dadosApi);
      if (itens.length > 0) return itens;
    }

    // Fallback: parse do HTML já renderizado pelo browser
    const html = await page.content();
    return parseHtmlRenderizado(html, params.termo);
  } finally {
    await page.close();
  }
}

// ─────────────────────────────────────────────
// Orquestrador: HTTP (sessão cacheada) → Puppeteer
// ─────────────────────────────────────────────

export async function buscarProdutos(params: BuscaParams): Promise<ResultadoBusca> {
  const pagina = params.pagina ?? 1;
  let itens: ProdutoPreco[] = [];
  let estrategiaUsada = 'browser';

  // Via rápida: HTTP com sessão cacheada
  if (sessaoValida()) {
    try {
      itens = await comRetry(() => buscarViaHttp(params), `HTTP "${params.termo}"`);
      estrategiaUsada = 'http';
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      console.warn(`[scraper] HTTP falhou (${status ?? 'sem resposta'}) — sessão invalidada, abrindo browser...`);
      invalidarSessao();
    }
  }

  // Puppeteer: primeira vez ou após sessão expirar
  if (itens.length === 0) {
    try {
      itens = await buscarViaBrowser(params);
      estrategiaUsada = 'browser';
    } catch (browserErr) {
      throw buildScraperError(
        classificarErro(browserErr),
        'Todas as estratégias falharam (http + browser)',
        browserErr,
        BASE_URL + ENDPOINT_PESQUISA,
      );
    }
  }

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
// Normalização de resposta
// ─────────────────────────────────────────────

function extrairItens(data: unknown): ProdutoPreco[] {
  if (!data || typeof data !== 'object') {
    throw new Error('Resposta não é um objeto JSON válido');
  }

  const raw = data as Record<string, unknown>;
  const lista: unknown[] =
    (raw['resultado'] as unknown[]) ??
    (raw['results'] as unknown[]) ??
    (raw['data'] as unknown[]) ??
    [];

  if (!Array.isArray(lista)) {
    throw new Error(`Shape inesperado. Keys: ${Object.keys(raw).join(', ')}`);
  }

  return lista.map(normalizarItem);
}

function normalizarItem(item: unknown): ProdutoPreco {
  if (!item || typeof item !== 'object') throw new Error('Item inválido');

  const raw = item as Record<string, unknown>;
  const produto = isRecord(raw['produto']) ? raw['produto'] : raw;
  const estab = isRecord(raw['estabelecimento']) ? raw['estabelecimento'] : raw;

  const preco = parsePreco(
    produto['precoUnitario'] ??
      produto['precoLiquido'] ??
      produto['precoBruto'] ??
      raw['preco'] ??
      raw['vl_preco'] ??
      0,
  );

  const municipioNome =
    String(
      estab['municipio'] ?? raw['municipio'] ?? raw['nm_municipio'] ?? raw['localidade'] ?? '',
    ).trim() || undefined;

  const eanRaw = String(
    produto['gtin'] ?? produto['ean'] ?? produto['codigoBarras'] ?? raw['gtin'] ?? raw['cd_gtin'] ?? '',
  ).trim();

  return {
    nome: String(produto['descricao'] ?? raw['nome'] ?? raw['ds_produto'] ?? '').trim(),
    preco,
    mercado: String(estab['nomeEstabelecimento'] ?? raw['mercado'] ?? raw['nm_estabelecimento'] ?? '').trim(),
    cnpj: formatarCnpj(String(estab['cnpj'] ?? raw['cnpj'] ?? raw['nu_cnpj'] ?? '')),
    cidade: municipioNome,
    municipio: municipioNome,
    dataColeta: String(produto['data'] ?? raw['data'] ?? raw['dt_coleta'] ?? '').trim() || undefined,
    unidade: String(produto['unidade'] ?? raw['unidade'] ?? raw['ds_unidade'] ?? '').trim() || undefined,
    ean: /^\d{8,14}$/.test(eanRaw) ? eanRaw : undefined,
  };
}

function parseHtmlRenderizado(html: string, termoBusca: string): ProdutoPreco[] {
  const $ = cheerio.load(html);
  const itens: ProdutoPreco[] = [];

  const linhas = $('table.tabela-produtos tbody tr, .card-produto, [data-produto]');

  if (linhas.length === 0) {
    const pageText = $('body').text().toLowerCase();
    if (pageText.includes('captcha') || pageText.includes('acesso negado')) {
      throw Object.assign(new Error('Bloqueio detectado no HTML renderizado'), {
        tipo: 'BLOQUEIO_403',
      });
    }
    console.warn(`[scraper] HTML renderizado sem dados para "${termoBusca}"`);
    return [];
  }

  linhas.each((_i, el) => {
    try {
      const linha = $(el);
      const nome = linha.find('[data-nome], .produto-nome, td:nth-child(1)').first().text().trim();
      const precoRaw = linha.find('[data-preco], .produto-preco, td:nth-child(2)').first().text().trim() || '0';
      const mercado = linha.find('[data-mercado], .produto-mercado, td:nth-child(3)').first().text().trim();
      const cnpj = linha.find('[data-cnpj], td:nth-child(4)').first().text().trim();
      if (!nome && !precoRaw) return;
      itens.push({
        nome,
        preco: parsePreco(precoRaw),
        mercado,
        cnpj: formatarCnpj(cnpj),
        municipio: linha.find('.produto-municipio, td:nth-child(5)').first().text().trim() || undefined,
        dataColeta: linha.find('.produto-data, td:nth-child(6)').first().text().trim() || undefined,
      });
    } catch (err) {
      console.warn('[scraper] Falha ao parsear linha HTML:', err);
    }
  });

  return itens;
}

// ─────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────

function parsePreco(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  const str = String(valor).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
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
  return { tipo, mensagem, detalhes: err instanceof Error ? err.message : String(err), urlTentada };
}
