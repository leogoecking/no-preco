import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { buildBrowserHeaders } from './browser-headers';

/** Delay aleatório entre min e max ms para imitar cadência humana */
function jitter(min = 800, max = 2500): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHttpClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 15_000,
    headers: buildBrowserHeaders(),
    // Segue redirects automaticamente (padrão), mas limita a 5
    maxRedirects: 5,
    // Descompressão automática de gzip/br
    decompress: true,
  });

  // Interceptor de request: injeta headers frescos e aplica jitter
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    await jitter();
    const fresh = buildBrowserHeaders(baseURL);
    config.headers = Object.assign(config.headers ?? {}, fresh);
    return config;
  });

  // Interceptor de response: loga status para debugging
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      console.log(
        `[http] ${response.config.method?.toUpperCase()} ${response.config.url} → ${response.status}`,
      );
      return response;
    },
    (error) => {
      const status = error.response?.status ?? 'NETWORK_ERROR';
      const url = error.config?.url ?? 'unknown';
      console.error(`[http] ERRO ${status} em ${url}`);
      return Promise.reject(error);
    },
  );

  return client;
}
