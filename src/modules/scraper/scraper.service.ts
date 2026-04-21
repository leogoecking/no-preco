import * as cheerio from 'cheerio';
import { AxiosError } from 'axios';
import { getSharedPage, invalidateSharedPage } from '../../shared/http/browser-client';
import { normalizarSlug } from '../../shared/utils/normalize';
import { Logger } from '../../shared/logger/logger';
import { BuscaParams, ProdutoPreco, ResultadoBusca, ScraperError } from './scraper.types';

const log = new Logger('Scraper');

const BASE_URL = 'https://precodahora.ba.gov.br';
// O site usa POST /produtos/ como endpoint de busca (confirmado via diagnóstico de rede).
const ENDPOINT_PESQUISA = '/produtos/';

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

  const coords = resolverCoordenadas(params.municipio);
  const termoBusca = params.ean ?? params.termo;

  const body = new URLSearchParams({
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

  let resultado: { status: number; body: string };
  try {
    resultado = await page.evaluate(
      async (url, csrf, payload) => {
        const resp = await fetch(url, {
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
      BASE_URL + ENDPOINT_PESQUISA,
      csrfToken,
      body,
    );
  } catch (err) {
    log.warn('page.evaluate(fetch) lançou exceção', {
      termo: params.termo,
      erro: err instanceof Error ? err.message : String(err),
    });
    invalidateSharedPage();
    throw err;
  }

  log.info('POST /produtos/ disparado', {
    status: resultado.status,
    termo: params.termo,
    preview: resultado.body.slice(0, 150),
  });

  if (resultado.status === 429 || resultado.status === 403) {
    invalidateSharedPage();
    const tipo: ScraperError['tipo'] = resultado.status === 429 ? 'BLOQUEIO_429' : 'BLOQUEIO_403';
    throw Object.assign(new Error(`Rate limit ${resultado.status} no POST de busca`), { tipo });
  }

  if (resultado.status === 202) {
    log.warn('Site retornou 202 — parâmetros rejeitados', {
      preview: resultado.body.slice(0, 200),
    });
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
    invalidateSharedPage();
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
  return parseHtmlRenderizado(html, params.termo);
}

// ─────────────────────────────────────────────
// Orquestrador
// ─────────────────────────────────────────────

export async function buscarProdutos(params: BuscaParams): Promise<ResultadoBusca> {
  const pagina = params.pagina ?? 1;
  let itens: ProdutoPreco[] = [];

  try {
    itens = await buscarViaBrowser(params);
  } catch (browserErr) {
    const scraperErr = buildScraperError(
      classificarErro(browserErr),
      'Falha na busca via browser compartilhado',
      browserErr,
      BASE_URL + ENDPOINT_PESQUISA,
    );
    throw Object.assign(new Error(scraperErr.mensagem), scraperErr);
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

  const axiosErr = err as AxiosError;
  if (axiosErr.code === 'ECONNABORTED') return 'TIMEOUT';
  if (axiosErr.response?.status === 429) return 'BLOQUEIO_429';
  if (axiosErr.response?.status === 403) return 'BLOQUEIO_403';
  return 'PARSE_FALHOU';
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
