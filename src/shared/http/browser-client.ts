/**
 * browser-client.ts
 *
 * Singleton de Browser Puppeteer compartilhado entre requisições.
 * Uma única instância do Chromium fica viva durante todo o processo —
 * cada coleta abre/fecha apenas uma Page, sem o custo de relançar o browser.
 */

import puppeteer, { Browser } from 'puppeteer';

let instance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (instance && instance.connected) return instance;

  instance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // evita crash em ambientes com /dev/shm pequeno
      '--disable-gpu',
      '--disable-extensions',
    ],
  });

  // Garante limpeza se o processo encerrar de forma inesperada
  instance.on('disconnected', () => {
    instance = null;
  });

  return instance;
}

export async function closeBrowser(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
