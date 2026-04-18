/**
 * Diagnóstico do scraper: navega via Puppeteer e registra
 * - todas as requisições de rede
 * - o HTML final renderizado (primeiros 3000 chars)
 * - o conteúdo da XHR de pesquisa, se capturado
 *
 * Uso: npx ts-node scripts/debug-scraper.ts
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'https://precodahora.ba.gov.br';
const ENDPOINT_PAGINA = '/produtos/';
const ENDPOINT_PESQUISA = '/produtos/pesquisa/';
const TERMO = 'arroz 5kg';
const MUNICIPIO = 'Teixeira de Freitas';

async function main() {
  console.log('Iniciando Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  const requests: string[] = [];
  const respostasXhr: { url: string; status: number; contentType: string }[] = [];
  let dadosXhr: unknown = null;

  page.on('request', (req) => {
    const tipo = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
      req.abort();
    } else {
      requests.push(`${req.method()} ${req.url()}`);
      req.continue();
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const method = response.request().method();
    const contentType = response.headers()['content-type'] ?? '';
    respostasXhr.push({ url, status: response.status(), contentType });

    // Captura POST para /produtos/ (que é a busca real)
    const isPesquisa =
      url.includes(ENDPOINT_PESQUISA) ||
      (method === 'POST' && url.includes('/produtos/'));

    if (isPesquisa) {
      try {
        const body = await response.text();
        console.log(`\n=== RESPOSTA ${method} ${url} (${response.status()}) ===`);
        console.log('Content-Type:', contentType);
        console.log('Body (primeiros 2000):', body.slice(0, 2000));
        if (contentType.includes('json')) {
          dadosXhr = JSON.parse(body);
        }
      } catch (e) {
        console.log('Erro ao ler resposta:', e);
      }
    }
  });

  const url = new URL(BASE_URL + ENDPOINT_PAGINA);
  url.searchParams.set('q', TERMO);
  url.searchParams.set('municipio', MUNICIPIO);

  console.log('\nNavegando para:', url.toString());
  // Espera load + 3s adicionais para POST completar
  await page.goto(url.toString(), { waitUntil: 'load', timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n=== Requisições de rede ===');
  requests.forEach((r) => console.log(' ', r));

  console.log('\n=== Todas as respostas ===');
  respostasXhr
    .filter((r) => r.url.includes('precodahora'))
    .forEach((r) => console.log(` [${r.status}] ${r.url} — ${r.contentType}`));

  console.log('\n=== dadosXhr capturado ===', dadosXhr ? JSON.stringify(dadosXhr).slice(0, 500) : 'null');

  const html = await page.content().catch(() => '<erro: contexto destruído>');
  console.log('\n=== HTML final (primeiros 4000 chars) ===');
  console.log(html.slice(0, 4000));

  // Inspeciona elementos visíveis relacionados a produtos
  const seletoresTestados = [
    'table.tabela-produtos',
    '.card-produto',
    '[data-produto]',
    '.produto',
    'tbody tr',
    '[class*="produto"]',
    '[class*="preco"]',
    '[class*="item"]',
  ];

  console.log('\n=== Seletores testados ===');
  for (const sel of seletoresTestados) {
    const count = await page.$$eval(sel, (els) => els.length).catch(() => 0);
    if (count > 0) console.log(`  ENCONTRADO: "${sel}" — ${count} elementos`);
    else console.log(`  não encontrado: "${sel}"`);
  }

  await browser.close();
}

main().catch(console.error);
