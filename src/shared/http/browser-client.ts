import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { Logger } from '../logger/logger';

puppeteer.use(StealthPlugin());

const log = new Logger('BrowserClient');
const SHARED_PAGE_TTL_MS = 25 * 60 * 1000;

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
    .waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes(endpoint),
      { timeout: 15_000 },
    )
    .catch(() => null);

  await page.goto(baseUrl + endpoint, { waitUntil: 'load', timeout: 45_000 });
  const postResponse = await waitPost;

  if (postResponse) {
    sharedPageCsrf = postResponse.request().headers()['x-csrftoken'] ?? '';
    log.info('Page compartilhada inicializada', { csrfCapturado: Boolean(sharedPageCsrf) });
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
