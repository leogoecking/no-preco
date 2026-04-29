/**
 * @deprecated Camada Puppeteer mantida apenas como **fallback** caso o cliente HTTP
 * direto (`scraper-http-client.ts`) falhe, seja detectado ou pare de funcionar.
 *
 * Critérios para remoção (avaliar quando aplicável):
 *   1. Os logs do orquestrador (`scraper.service.ts`) não dispararem
 *      "HTTP falhou — acionando fallback via browser" por 30+ dias consecutivos;
 *   2. Ou, inversamente, se o site começar a rejeitar requests HTTP de forma
 *      sistemática (forçar revisão da estratégia, possivelmente proxy).
 *
 * Custo de manter: ~150 MB na imagem Docker (chromium) e ~200-300 MB de RAM em pico.
 *
 * Ao remover, também remover:
 *   - dependências `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`
 *   - imports e usos em `scraper.service.ts` e `worker.scheduler.ts`
 */
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { Logger } from '../logger/logger';

puppeteer.use(StealthPlugin());

const log = new Logger('BrowserClient');
const SHARED_PAGE_TTL_MS = 25 * 60 * 1000;

const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];

const VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

let browserInstance: Browser | null = null;

let sharedPage: Page | null = null;
let sharedPageReadyAt = 0;
let sharedPageCsrf = '';
let initInFlight: Promise<Page> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;

  browserInstance = (await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
    ],
  })) as Browser;

  browserInstance.on('disconnected', () => {
    browserInstance = null;
    sharedPage = null;
    sharedPageReadyAt = 0;
    sharedPageCsrf = '';
  });

  return browserInstance;
}

export interface SessionPage {
  page: Page;
  csrfToken: string;
}

/**
 * Retorna uma Page compartilhada com sessão (CSRF + cookies) pronta para uso.
 * - Reutiliza a mesma Page enquanto válida (TTL 25min) — evita reabrir browser.
 * - Dispara uma única navegação inicial para capturar o CSRF token.
 * - Mutex garante que chamadas concorrentes aguardem a inicialização em andamento.
 */
export async function getSharedPage(baseUrl: string, endpoint: string): Promise<SessionPage> {
  const agora = Date.now();
  const aindaValida =
    sharedPage !== null &&
    !sharedPage.isClosed() &&
    sharedPageReadyAt > 0 &&
    agora - sharedPageReadyAt < SHARED_PAGE_TTL_MS;

  if (aindaValida) {
    return { page: sharedPage as Page, csrfToken: sharedPageCsrf };
  }

  if (initInFlight) {
    await initInFlight;
    return { page: sharedPage as Page, csrfToken: sharedPageCsrf };
  }

  initInFlight = inicializarPaginaCompartilhada(baseUrl, endpoint);
  try {
    const page = await initInFlight;
    return { page, csrfToken: sharedPageCsrf };
  } finally {
    initInFlight = null;
  }
}

async function inicializarPaginaCompartilhada(baseUrl: string, endpoint: string): Promise<Page> {
  if (sharedPage && !sharedPage.isClosed()) {
    await sharedPage.close().catch(() => undefined);
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  const userAgent = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);
  await page.setUserAgent(userAgent);
  await page.setViewport(viewport);

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const tipo = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Navega uma vez para capturar o CSRF token do POST inicial disparado pelo JS.
  // A resposta 202 "sem parâmetro" é esperada aqui — só queremos o header x-csrftoken.
  const waitPost = page
    .waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(endpoint), {
      timeout: 15_000,
    })
    .catch(() => null);

  await page.goto(baseUrl + endpoint, { waitUntil: 'load', timeout: 45_000 });
  const postResponse = await waitPost;

  if (postResponse) {
    sharedPageCsrf = postResponse.request().headers()['x-csrftoken'] ?? '';
    log.info('Page compartilhada inicializada', {
      csrfCapturado: Boolean(sharedPageCsrf),
      ua: userAgent.slice(0, 60),
      viewport: `${viewport.width}x${viewport.height}`,
    });
  } else {
    log.warn('POST inicial não interceptado — CSRF pode estar ausente');
    sharedPageCsrf = '';
  }

  sharedPage = page;
  sharedPageReadyAt = Date.now();
  return page;
}

/** Força recriação da Page compartilhada na próxima chamada. */
export function invalidateSharedPage(): void {
  sharedPageReadyAt = 0;
  sharedPageCsrf = '';
}

/**
 * Descarta browser e page completamente.
 * Use após bloqueio (429/403) — a próxima requisição abre browser novo,
 * com cookies, cache e fingerprint local zerados.
 */
export async function resetBrowserSession(): Promise<void> {
  if (sharedPage && !sharedPage.isClosed()) {
    await sharedPage.close().catch(() => undefined);
  }
  sharedPage = null;
  sharedPageReadyAt = 0;
  sharedPageCsrf = '';

  if (browserInstance) {
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
  }

  log.info('Browser session resetada — próxima coleta abrirá sessão nova');
}

export async function closeBrowser(): Promise<void> {
  if (sharedPage && !sharedPage.isClosed()) {
    await sharedPage.close().catch(() => undefined);
  }
  sharedPage = null;
  sharedPageReadyAt = 0;
  sharedPageCsrf = '';

  if (browserInstance) {
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
  }
}
