import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../logger/logger';
import { ScraperError } from '../../modules/scraper/scraper.types';

const log = new Logger('ScraperHttpClient');

const SESSION_TTL_MS = 25 * 60 * 1_000;

const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];

export interface HttpResponse {
  status: number;
  body: string;
}

interface SessionState {
  cookies: Map<string, string>;
  csrfToken: string;
  userAgent: string;
  capturedAt: number;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** Extrai pares nome=valor de cabeçalhos Set-Cookie e mescla no jar. */
function aplicarSetCookies(setCookies: string[] | undefined, jar: Map<string, string>): void {
  if (!setCookies || setCookies.length === 0) return;
  for (const sc of setCookies) {
    const primeiroPar = sc.split(';')[0];
    if (!primeiroPar) continue;
    const igual = primeiroPar.indexOf('=');
    if (igual <= 0) continue;
    const nome = primeiroPar.slice(0, igual).trim();
    const valor = primeiroPar.slice(igual + 1).trim();
    if (nome) jar.set(nome, valor);
  }
}

function serializarCookies(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Extrai o CSRF token Flask-WTF do `<input name="csrf_token">` no HTML.
 * Esse é o token assinado (HMAC) que o servidor espera no header `X-CSRFToken` —
 * **não** confundir com o `csrf_token` do payload do cookie session, que é a
 * chave-mestra interna e não vai no header.
 */
function extrairCsrfDoHtml(html: string): string {
  try {
    const $ = cheerio.load(html);
    const valor = $('input[name="csrf_token"]').attr('value') ?? '';
    return valor.trim();
  } catch (err) {
    log.warn('Falha ao parsear HTML para extrair CSRF', {
      erro: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

export class ScraperHttpClient {
  private session: SessionState | null = null;
  private initInFlight: Promise<SessionState> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly endpoint: string,
  ) {}

  private isSessionValida(): boolean {
    return (
      this.session !== null &&
      this.session.csrfToken !== '' &&
      Date.now() - this.session.capturedAt < SESSION_TTL_MS
    );
  }

  private async ensureSession(): Promise<SessionState> {
    if (this.isSessionValida()) return this.session as SessionState;
    if (this.initInFlight) return this.initInFlight;

    this.initInFlight = this.capturarSessao();
    try {
      this.session = await this.initInFlight;
      return this.session;
    } finally {
      this.initInFlight = null;
    }
  }

  private async capturarSessao(): Promise<SessionState> {
    const userAgent = pickRandom(USER_AGENTS);
    const url = this.baseUrl + this.endpoint;
    const cookies = new Map<string, string>();

    const resp = await axios.get<string>(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      validateStatus: () => true,
      timeout: 15_000,
      responseType: 'text',
      transformResponse: [(data: unknown): unknown => data],
    });

    if (resp.status !== 200) {
      const tipo: ScraperError['tipo'] =
        resp.status === 429 ? 'BLOQUEIO_429' : resp.status === 403 ? 'BLOQUEIO_403' : 'ERRO_REDE';
      throw Object.assign(new Error(`GET inicial retornou status ${resp.status}`), { tipo });
    }

    aplicarSetCookies(resp.headers['set-cookie'], cookies);

    const html = typeof resp.data === 'string' ? resp.data : '';
    const csrfToken = extrairCsrfDoHtml(html);

    if (!csrfToken) {
      throw Object.assign(
        new Error('CSRF não encontrado no HTML — input[name="csrf_token"] ausente'),
        { tipo: 'PARSE_FALHOU' as ScraperError['tipo'] },
      );
    }

    log.info('Sessão HTTP capturada', {
      csrfCapturado: true,
      ua: userAgent.slice(0, 60),
      cookies: cookies.size,
    });

    return {
      cookies,
      csrfToken,
      userAgent,
      capturedAt: Date.now(),
    };
  }

  async post(body: string): Promise<HttpResponse> {
    const sess = await this.ensureSession();
    const url = this.baseUrl + this.endpoint;

    const resp = await axios.post<string>(url, body, {
      headers: {
        'User-Agent': sess.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': sess.csrfToken,
        Referer: url,
        Origin: this.baseUrl,
        Cookie: serializarCookies(sess.cookies),
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      validateStatus: () => true,
      timeout: 30_000,
      responseType: 'text',
      transformResponse: [(data: unknown): unknown => data],
    });

    // O servidor pode rotacionar cookies — atualiza o jar para próximas requests.
    aplicarSetCookies(resp.headers['set-cookie'], sess.cookies);

    return {
      status: resp.status,
      body: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
    };
  }

  invalidateSession(): void {
    if (this.session === null) return;
    this.session = null;
    log.info('Sessão HTTP invalidada — próxima requisição renovará');
  }

  /**
   * Verifica se o alvo está acessível e a sessão pode ser estabelecida.
   * Reaproveita sessão válida em cache; senão dispara o GET inicial.
   * Retorna `ok:false` com `tipo` quando o alvo recusa (429/403) ou rede falha.
   */
  async probe(): Promise<ProbeResult> {
    try {
      await this.ensureSession();
      return { ok: true };
    } catch (err) {
      const tipo =
        (err as Error & { tipo?: ScraperError['tipo'] }).tipo ??
        ('ERRO_REDE' as ScraperError['tipo']);
      return {
        ok: false,
        tipo,
        mensagem: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export interface ProbeResult {
  ok: boolean;
  tipo?: ScraperError['tipo'];
  mensagem?: string;
}

const BASE_URL = 'https://precodahora.ba.gov.br';
const ENDPOINT = '/produtos/';

export const scraperHttpClient = new ScraperHttpClient(BASE_URL, ENDPOINT);

export function invalidateScraperHttpSession(): void {
  scraperHttpClient.invalidateSession();
}
