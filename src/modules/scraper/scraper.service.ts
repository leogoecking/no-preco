import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import { createHttpClient } from '../../shared/http/axios-client';
import { buildApiHeaders } from '../../shared/http/browser-headers';
import { getBrowser } from '../../shared/http/browser-client';
import { normalizarSlug } from '../../shared/utils/normalize';
import { Logger } from '../../shared/logger/logger';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const log = new Logger('Scraper');

const BASE_URL = 'https://precodahora.ba.gov.br';
// O site usa POST /produtos/ como endpoint de busca (confirmado via diagnóstico de rede).
// /produtos/pesquisa/ era uma suposição inicial — não existe na API real.
const ENDPOINT_PESQUISA = '/produtos/';
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
      log.warn(`${contexto} — tentativa ${tentativa + 1} falhou`, {
        retentar_em_s: espera / 1_000,
      });
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
  const coords = resolverCoordenadas(params.municipio);

  const form = new URLSearchParams({
    termo: params.ean ?? params.termo,
    pagina: String(params.pagina ?? 1),
    ordenar: 'preco.asc',
    raio: '15',
    horas: '72', // padrão do site é 0x48 = 72h
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
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
// a resposta do POST /produtos/ (endpoint real de busca, confirmado via diagnóstico).
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
      // Captura apenas o POST de busca — diferencia do GET da página pelo método HTTP
      const isPossBusca =
        response.request().method() === 'POST' && response.url().includes(ENDPOINT_PESQUISA);

      if (!isPossBusca || dadosApi !== null) return;

      const status = response.status();

      // 429 = rate limit ativo; propaga como bloqueio para o circuit breaker
      if (status === 429) {
        dadosApi = { _bloqueio429: true };
        return;
      }

      try {
        const contentType = response.headers()['content-type'] ?? '';
        if (contentType.includes('json')) {
          dadosApi = await response.json();
        }
      } catch {
        // Resposta não era JSON — será tratada no HTML fallback
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
      log.info('Sessão capturada via Puppeteer', { validade_min: 25 });
    }

    if (dadosApi !== null) {
      // Sentinel injetado pelo listener quando o site retorna 429
      if ((dadosApi as Record<string, unknown>)['_bloqueio429']) {
        throw Object.assign(new Error('Rate limit 429 detectado no POST de busca'), {
          tipo: 'BLOQUEIO_403',
        });
      }
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
      log.warn('HTTP falhou — sessão invalidada, abrindo browser', {
        status: status ?? 'sem_resposta',
      });
      invalidarSessao();
    }
  }

  // Puppeteer: primeira vez ou após sessão expirar
  if (itens.length === 0) {
    try {
      itens = await buscarViaBrowser(params);
      estrategiaUsada = 'browser';
    } catch (browserErr) {
      const scraperErr = buildScraperError(
        classificarErro(browserErr),
        'Todas as estratégias falharam (http + browser)',
        browserErr,
        BASE_URL + ENDPOINT_PESQUISA,
      );
      throw Object.assign(new Error(scraperErr.mensagem), scraperErr);
    }
  }

  const municipioResolvido = itens.find((i) => i.municipio)?.municipio ?? params.municipio;

  log.info('Busca concluída', {
    termo: params.termo,
    itens: itens.length,
    estrategia: estrategiaUsada,
    ...(municipioResolvido ? { municipio: municipioResolvido } : {}),
  });

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
    produto['gtin'] ??
      produto['ean'] ??
      produto['codigoBarras'] ??
      raw['gtin'] ??
      raw['cd_gtin'] ??
      '',
  ).trim();

  return {
    nome: String(produto['descricao'] ?? raw['nome'] ?? raw['ds_produto'] ?? '').trim(),
    preco,
    mercado: String(
      estab['nomeEstabelecimento'] ?? raw['mercado'] ?? raw['nm_estabelecimento'] ?? '',
    ).trim(),
    cnpj: formatarCnpj(String(estab['cnpj'] ?? raw['cnpj'] ?? raw['nu_cnpj'] ?? '')),
    cidade: municipioNome,
    municipio: municipioNome,
    dataColeta:
      String(produto['data'] ?? raw['data'] ?? raw['dt_coleta'] ?? '').trim() || undefined,
    unidade:
      String(produto['unidade'] ?? raw['unidade'] ?? raw['ds_unidade'] ?? '').trim() || undefined,
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
    log.warn('HTML renderizado sem dados', { termo: termoBusca });
    return [];
  }

  linhas.each((_i, el) => {
    try {
      const linha = $(el);
      const nome = linha.find('[data-nome], .produto-nome, td:nth-child(1)').first().text().trim();
      const precoRaw =
        linha.find('[data-preco], .produto-preco, td:nth-child(2)').first().text().trim() || '0';
      const mercado = linha
        .find('[data-mercado], .produto-mercado, td:nth-child(3)')
        .first()
        .text()
        .trim();
      const cnpj = linha.find('[data-cnpj], td:nth-child(4)').first().text().trim();
      if (!nome && !precoRaw) return;
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
      log.warn('Falha ao parsear linha HTML', {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return itens;
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

interface Coordenadas {
  latitude: number;
  longitude: number;
}

// Coordenadas centrais por município (mesma lógica do JS do site: latitude_central / longitude_central)
const MUNICIPIOS_COORDS: Record<string, { id: number } & Coordenadas> = {
  salvador: { id: 2927408, latitude: -12.9714, longitude: -38.5014 },
  'teixeira-de-freitas': { id: 2931350, latitude: -17.5339, longitude: -39.7423 },
};

// Fallback: centro geográfico da Bahia (coordenada padrão do site quando nenhum município está selecionado)
const COORDS_CENTRAL_BA: Coordenadas = { latitude: -12.9714, longitude: -38.5014 };

function resolverMunicipioId(municipio?: string): number | undefined {
  if (!municipio) return undefined;
  return MUNICIPIOS_COORDS[normalizarSlug(municipio)]?.id;
}

function resolverCoordenadas(municipio?: string): Coordenadas {
  if (!municipio) return COORDS_CENTRAL_BA;
  return MUNICIPIOS_COORDS[normalizarSlug(municipio)] ?? COORDS_CENTRAL_BA;
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
