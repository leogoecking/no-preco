import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import {
  getSharedPage,
  invalidateSharedPage,
  resetBrowserSession,
} from '../../shared/http/browser-client';
import {
  scraperHttpClient,
  invalidateScraperHttpSession,
  marcarBloqueioScraperHttp,
  HttpResponse,
  ProbeResult,
} from '../../shared/http/scraper-http-client';
import { normalizarSlug } from '../../shared/utils/normalize';
import { Logger } from '../../shared/logger/logger';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const log = new Logger('Scraper');

const BASE_URL = 'https://precodahora.ba.gov.br';
// O site usa POST /produtos/ como endpoint de busca (confirmado via diagnóstico de rede).
const ENDPOINT_PESQUISA = '/produtos/';

// ─────────────────────────────────────────────
// Métricas in-memory (boot-relativas)
//
// Servem para decidir empiricamente quando remover o fallback Puppeteer:
// se `browserAcionado` ficar em zero por dias seguidos, é seguro remover.
// Reseta a cada restart — sem persistência intencional.
// ─────────────────────────────────────────────

export interface ScraperMetrics {
  httpSucesso: number;
  httpFalha: number;
  browserAcionado: number;
  browserSucesso: number;
  browserFalha: number;
  bloqueio429: number;
  bloqueio403: number;
  ultimoEvento: { tipo: string; em: string } | null;
  iniciadoEm: string;
}

const metrics: ScraperMetrics = {
  httpSucesso: 0,
  httpFalha: 0,
  browserAcionado: 0,
  browserSucesso: 0,
  browserFalha: 0,
  bloqueio429: 0,
  bloqueio403: 0,
  ultimoEvento: null,
  iniciadoEm: new Date().toISOString(),
};

function registrarEvento(tipo: keyof Omit<ScraperMetrics, 'ultimoEvento' | 'iniciadoEm'>): void {
  metrics[tipo]++;
  metrics.ultimoEvento = { tipo, em: new Date().toISOString() };
}

export function getScraperMetrics(): ScraperMetrics {
  return { ...metrics };
}

/**
 * Valida conectividade com o alvo via GET leve (probe canário).
 * Usado pelo worker para evitar gastar tarefa quando o alvo já está negando acesso.
 */
export async function probarConectividade(): Promise<ProbeResult> {
  return scraperHttpClient.probe();
}

// ─────────────────────────────────────────────
// Estratégia única: Page compartilhada (Puppeteer)
//
// Uma Page é aberta uma vez (via `getSharedPage`), navega para o site
// e captura o CSRF token do POST inicial disparado pelo JS. Buscas
// subsequentes reutilizam a mesma Page, disparando apenas um fetch
// por produto — sem page.goto() adicional.
// ─────────────────────────────────────────────

async function buscarViaBrowser(params: BuscaParams): Promise<ProdutoPreco[]> {
  const { page, csrfToken } = await getSharedPage(BASE_URL, ENDPOINT_PESQUISA);
  const body = montarBodyBusca(params);
  const resultado = await executarFetchNoBrowser(
    page,
    BASE_URL + ENDPOINT_PESQUISA,
    csrfToken,
    body,
    params.termo,
  );
  return interpretarResposta(resultado, page, params.termo);
}

function montarBodyBusca(params: BuscaParams): string {
  const coords = resolverCoordenadas(params.municipio);
  const termoBusca = params.ean ?? params.termo;

  return new URLSearchParams({
    produto: termoBusca,
    descricao: termoBusca,
    termo: termoBusca,
    horas: '72',
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    raio: '15',
    pagina: String(params.pagina ?? 1),
    ordenar: 'preco.asc',
  }).toString();
}

type RespostaFetch = { status: number; body: string };

async function executarFetchNoBrowser(
  page: Awaited<ReturnType<typeof getSharedPage>>['page'],
  url: string,
  csrfToken: string,
  body: string,
  termo: string,
): Promise<RespostaFetch> {
  try {
    return await page.evaluate(
      async (u, csrf, payload) => {
        const resp = await fetch(u, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': csrf,
          },
          body: payload,
          credentials: 'include',
        });
        const texto = await resp.text();
        return { status: resp.status, body: texto };
      },
      url,
      csrfToken,
      body,
    );
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    log.warn('page.evaluate(fetch) lançou exceção', { termo, erro: mensagem });

    // "Execution context was destroyed" = página navegou/redirecionou durante o
    // evaluate. No site alvo isso ocorre quando um IP suspeito é redirecionado
    // para página de erro/captcha — tratar como bloqueio ativo.
    if (mensagem.includes('Execution context was destroyed')) {
      await resetBrowserSession();
      throw Object.assign(new Error('Navegação forçada durante evaluate — bloqueio provável'), {
        tipo: 'BLOQUEIO_403',
      });
    }

    invalidateSharedPage();
    throw err;
  }
}

async function interpretarResposta(
  resultado: RespostaFetch,
  page: Awaited<ReturnType<typeof getSharedPage>>['page'],
  termo: string,
): Promise<ProdutoPreco[]> {
  log.info('POST /produtos/ disparado', {
    status: resultado.status,
    termo,
    preview: resultado.body.slice(0, 150),
  });

  if (resultado.status === 429 || resultado.status === 403) {
    await resetBrowserSession();
    const tipo: ScraperError['tipo'] = resultado.status === 429 ? 'BLOQUEIO_429' : 'BLOQUEIO_403';
    throw Object.assign(new Error(`Rate limit ${resultado.status} no POST de busca`), { tipo });
  }

  if (resultado.status === 202) {
    logar202(resultado.body);
    return [];
  }

  let dadosApi: unknown = null;
  try {
    dadosApi = JSON.parse(resultado.body);
  } catch {
    log.warn('Resposta do POST não é JSON', { preview: resultado.body.slice(0, 300) });
  }

  const bloqueio = detectarBloqueioNoBody(dadosApi);
  if (bloqueio) {
    await resetBrowserSession();
    throw Object.assign(new Error(`Bloqueio embutido no body (codigo=${bloqueio.codigo})`), {
      tipo: bloqueio.tipo,
    });
  }

  if (dadosApi !== null) {
    const itens = extrairItens(dadosApi);
    if (itens.length > 0) return itens;
  }

  // Fallback: parse do HTML já renderizado pelo browser
  const html = await page.content();
  return parseHtmlRenderizado(html, termo);
}

// ─────────────────────────────────────────────
// Caminho primário: HTTP direto
//
// Replica o que o JS do site faz: GET inicial para capturar cookies + CSRF
// (extraído do cookie `session` Flask), depois POST com header X-CSRFToken.
// Sem browser headless → sem detecção por fingerprint Puppeteer.
// ─────────────────────────────────────────────

async function buscarViaHttp(params: BuscaParams): Promise<ProdutoPreco[]> {
  const body = montarBodyBusca(params);
  let resposta: HttpResponse;

  try {
    resposta = await scraperHttpClient.post(body);
  } catch (err) {
    invalidateScraperHttpSession();
    throw err;
  }

  log.info('POST /produtos/ via HTTP', {
    status: resposta.status,
    termo: params.termo,
    preview: resposta.body.slice(0, 150),
  });

  if (resposta.status === 429 || resposta.status === 403) {
    marcarBloqueioScraperHttp();
    const tipo: ScraperError['tipo'] = resposta.status === 429 ? 'BLOQUEIO_429' : 'BLOQUEIO_403';
    throw Object.assign(new Error(`Rate limit ${resposta.status} no POST de busca`), { tipo });
  }

  if (resposta.status === 401) {
    invalidateScraperHttpSession();
    throw Object.assign(new Error(`Sessão HTTP rejeitada (status 401)`), {
      tipo: 'PARSE_FALHOU' as ScraperError['tipo'],
    });
  }

  if (resposta.status === 202) {
    logar202(resposta.body);
    return [];
  }

  let dadosApi: unknown = null;
  try {
    dadosApi = JSON.parse(resposta.body);
  } catch {
    log.warn('Resposta HTTP não é JSON', { preview: resposta.body.slice(0, 300) });
  }

  const bloqueio = detectarBloqueioNoBody(dadosApi);
  if (bloqueio) {
    marcarBloqueioScraperHttp();
    throw Object.assign(new Error(`Bloqueio embutido no body (codigo=${bloqueio.codigo})`), {
      tipo: bloqueio.tipo,
    });
  }

  if (dadosApi !== null) {
    return extrairItens(dadosApi);
  }

  return [];
}

// ─────────────────────────────────────────────
// Orquestrador
//
// Estratégia: tenta HTTP direto primeiro. Bloqueios reais (429/403)
// propagam imediatamente — não vale tentar browser, vai esbarrar igual.
// Outros erros (401, parse, rede) caem no fallback de browser para
// resiliência caso o site mude o esquema CSRF.
// ─────────────────────────────────────────────

export async function buscarProdutos(params: BuscaParams): Promise<ResultadoBusca> {
  const pagina = params.pagina ?? 1;
  let itens: ProdutoPreco[] = [];

  try {
    itens = await buscarViaHttp(params);
    registrarEvento('httpSucesso');
  } catch (httpErr) {
    const tipoHttp = classificarErro(httpErr);
    registrarEvento('httpFalha');

    // Bloqueios reais não merecem fallback — propagar
    if (tipoHttp === 'BLOQUEIO_429' || tipoHttp === 'BLOQUEIO_403') {
      registrarEvento(tipoHttp === 'BLOQUEIO_429' ? 'bloqueio429' : 'bloqueio403');
      const scraperErr = buildScraperError(
        tipoHttp,
        'Bloqueio detectado no caminho HTTP',
        httpErr,
        BASE_URL + ENDPOINT_PESQUISA,
      );
      throw Object.assign(new Error(scraperErr.mensagem), scraperErr);
    }

    log.warn('HTTP falhou — acionando fallback via browser', {
      tipo: tipoHttp,
      erro: httpErr instanceof Error ? httpErr.message : String(httpErr),
    });
    registrarEvento('browserAcionado');

    try {
      itens = await buscarViaBrowser(params);
      registrarEvento('browserSucesso');
    } catch (browserErr) {
      registrarEvento('browserFalha');
      const tipoBrowser = classificarErro(browserErr);
      if (tipoBrowser === 'BLOQUEIO_429') registrarEvento('bloqueio429');
      else if (tipoBrowser === 'BLOQUEIO_403') registrarEvento('bloqueio403');

      const scraperErr = buildScraperError(
        tipoBrowser,
        'Falha em ambos os caminhos (HTTP e browser)',
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

function resolverCoordenadas(municipio?: string): Coordenadas {
  if (!municipio) return COORDS_CENTRAL_BA;
  return MUNICIPIOS_COORDS[normalizarSlug(municipio)] ?? COORDS_CENTRAL_BA;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function classificarErro(err: unknown): ScraperError['tipo'] {
  const tipoExplicito = (err as Error & { tipo?: ScraperError['tipo'] }).tipo;
  if (tipoExplicito === 'BLOQUEIO_403' || tipoExplicito === 'BLOQUEIO_429') return tipoExplicito;

  const mensagem = err instanceof Error ? err.message : String(err);
  if (
    mensagem.includes('Could not find Chrome') ||
    mensagem.includes('Failed to launch the browser process') ||
    mensagem.includes('Target closed') ||
    mensagem.includes('Browser was not found')
  ) {
    return 'BROWSER_INDISPONIVEL';
  }

  const axiosErr = err as AxiosError;
  if (axiosErr.code === 'ECONNABORTED') return 'TIMEOUT';
  if (axiosErr.response?.status === 429) return 'BLOQUEIO_429';
  if (axiosErr.response?.status === 403) return 'BLOQUEIO_403';
  return 'PARSE_FALHOU';
}

/**
 * Loga uma resposta HTTP 202 do alvo já normalizada por `codigo`.
 * `codigo:50` = sem resultados (info); demais códigos = comportamento
 * inesperado e merecem warn para diagnóstico.
 */
function logar202(body: string): void {
  let codigo: number | null = null;
  let descricao = '';
  try {
    const json = JSON.parse(body) as { codigo?: unknown; descricao?: unknown };
    codigo = typeof json.codigo === 'number' ? json.codigo : null;
    descricao = typeof json.descricao === 'string' ? json.descricao : '';
  } catch {
    // mantém vazios — body não-JSON cai naturalmente no log de inesperado
  }

  if (codigo === 50) {
    log.info('Site retornou 202 — sem resultados', { codigo, descricao });
  } else {
    log.warn('Site retornou 202 — comportamento inesperado', { codigo, descricao });
  }
}

/**
 * Detecta bloqueio quando o servidor responde HTTP 200 mas o body
 * carrega `{codigo: 429|403, descricao: "..."}`. Sem isto, essas
 * falhas caem em PARSE_FALHOU e mascaram o rate limit real.
 */
function detectarBloqueioNoBody(
  dadosApi: unknown,
): { codigo: number; tipo: ScraperError['tipo'] } | null {
  if (!isRecord(dadosApi)) return null;
  const codigo = Number(dadosApi['codigo']);
  if (codigo === 429) return { codigo, tipo: 'BLOQUEIO_429' };
  if (codigo === 403) return { codigo, tipo: 'BLOQUEIO_403' };
  return null;
}

function buildScraperError(
  tipo: ScraperError['tipo'],
  mensagem: string,
  err: unknown,
  urlTentada?: string,
): ScraperError {
  return { tipo, mensagem, detalhes: err instanceof Error ? err.message : String(err), urlTentada };
}
