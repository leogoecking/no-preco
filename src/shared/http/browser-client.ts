import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

let instance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (instance && instance.connected) return instance;

  instance = (await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
    ],
  })) as Browser;

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
