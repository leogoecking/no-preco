import { ColetaWorker } from '../jobs/coleta.worker';

// Bloqueia imports pesados que o worker traz indiretamente
jest.mock('../jobs/coleta.config', () => ({
  coletaConfig: {
    municipioPadrao: 'Salvador',
    delayMinMs: 0,
    delayMaxMs: 0,
    cron: '0 * * * *',
    produtos: [{ termo: 'arroz', label: 'Arroz 5kg' }],
  },
}));
jest.mock('../modules/scraper/scraper.service', () => ({
  buscarProdutos: jest.fn(),
}));
jest.mock('../modules/preco/preco.repository', () => ({
  precoRepository: { salvarLote: jest.fn() },
}));
jest.mock('../shared/database/connection', () => ({
  connectDatabase: jest.fn(),
}));

import { buscarProdutos } from '../modules/scraper/scraper.service';
import { precoRepository } from '../modules/preco/preco.repository';

const mockBuscar = buscarProdutos as jest.Mock;
const mockSalvar = precoRepository.salvarLote as jest.Mock;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function resultadoVazio(): object {
  return {
    itens: [],
    termo: '',
    municipio: '',
    totalItens: 0,
    pagina: 1,
    estrategia: 'api' as const,
  };
}

function resultadoComItens(): object {
  return {
    itens: [
      { nome: 'Arroz', preco: 10, mercado: 'M', cnpj: '0', cidade: 'C', dataColeta: '2024-01-01' },
    ],
    termo: 'arroz',
    municipio: 'Salvador',
    totalItens: 1,
    pagina: 1,
    estrategia: 'api' as const,
  };
}

// ─────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────

describe('ColetaWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('retorna emExecucao=false no estado inicial', () => {
      const worker = new ColetaWorker();
      expect(worker.getStatus().emExecucao).toBe(false);
    });

    it('retorna ultimoRelatorio=null antes do primeiro ciclo', () => {
      const worker = new ColetaWorker();
      expect(worker.getStatus().ultimoRelatorio).toBeNull();
    });
  });

  describe('execute — guard de execução simultânea', () => {
    it('lança erro ao tentar executar sem relatório anterior quando já está rodando', async () => {
      mockBuscar.mockImplementation(() => new Promise(() => {})); // nunca resolve
      const worker = new ColetaWorker();

      // Dispara sem aguardar — worker fica em isRunning=true
      worker.execute().catch(() => {});

      await expect(worker.execute()).rejects.toThrow(
        'Worker em execução mas sem relatório anterior disponível',
      );
    });
  });

  describe('execute — ciclo completo', () => {
    it('retorna relatório com sucesso quando scraper retorna itens', async () => {
      mockBuscar.mockResolvedValue(resultadoComItens());
      mockSalvar.mockResolvedValue([{ id: '1' }]);

      const worker = new ColetaWorker();
      const relatorio = await worker.execute();

      expect(relatorio.sucessos).toBeGreaterThan(0);
      expect(relatorio.falhas).toBe(0);
      expect(relatorio.abortado).toBe(false);
      expect(relatorio.itensSalvos).toBeGreaterThan(0);
    });

    it('registra sem_resultados quando scraper retorna lista vazia', async () => {
      mockBuscar.mockResolvedValue(resultadoVazio());

      const worker = new ColetaWorker();
      const relatorio = await worker.execute();

      expect(relatorio.semResultados).toBeGreaterThan(0);
      expect(relatorio.sucessos).toBe(0);
    });

    it('registra falha quando scraper lança erro', async () => {
      mockBuscar.mockRejectedValue(new Error('timeout'));

      const worker = new ColetaWorker();
      const relatorio = await worker.execute();

      expect(relatorio.falhas).toBeGreaterThan(0);
      expect(relatorio.sucessos).toBe(0);
    });

    it('reseta isRunning para false após o ciclo mesmo com erro', async () => {
      mockBuscar.mockRejectedValue(new Error('falha'));

      const worker = new ColetaWorker();
      await worker.execute();

      expect(worker.getStatus().emExecucao).toBe(false);
    });

    it('salva o relatório em lastReport após o ciclo', async () => {
      mockBuscar.mockResolvedValue(resultadoVazio());

      const worker = new ColetaWorker();
      await worker.execute();

      expect(worker.getStatus().ultimoRelatorio).not.toBeNull();
    });
  });

  describe('abort', () => {
    it('não faz nada quando o worker não está em execução', () => {
      const worker = new ColetaWorker();
      expect(() => worker.abort()).not.toThrow();
    });
  });
});
