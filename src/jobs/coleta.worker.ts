import { buscarProdutos } from '../modules/scraper/scraper.service';
import { precoRepository } from '../modules/preco/preco.repository';
import { ScraperError } from '../modules/scraper/scraper.types';
import { coletaConfig, ProdutoMonitorado } from './coleta.config';
import { Logger } from '../shared/logger/logger';

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────

export interface TarefaColeta {
  produto: ProdutoMonitorado;
  municipio: string;
}

export interface ResultadoTarefa {
  produto: string;
  municipio: string;
  status: 'sucesso' | 'sem_resultados' | 'erro';
  itensSalvos?: number;
  erro?: string;
  tipoErro?: ScraperError['tipo'];
  duracaoMs: number;
}

export interface RelatorioColeta {
  iniciadoEm: Date;
  finalizadoEm: Date;
  duracaoMs: number;
  totalTarefas: number;
  sucessos: number;
  semResultados: number;
  falhas: number;
  itensSalvos: number;
  abortado: boolean;
  tarefas: ResultadoTarefa[];
}

export interface WorkerStatus {
  emExecucao: boolean;
  municipioPadrao: string;
  ultimoRelatorio: RelatorioColeta | null;
}

// ─────────────────────────────────────────────
// ColetaWorker
// ─────────────────────────────────────────────

/**
 * Worker de coleta de preços.
 *
 * Todo o estado de execução fica encapsulado na instância —
 * sem variáveis de módulo ou globais. Isso torna o worker
 * testável, substituível e isolado de outros ciclos.
 *
 * Cancelamento via AbortController: ao chamar abort(), o delay
 * entre requisições é interrompido imediatamente e o loop encerra
 * ao final da iteração corrente sem forçar um throw abrupto.
 */
export class ColetaWorker {
  private readonly log: Logger;
  private isRunning = false;
  private lastReport: RelatorioColeta | null = null;
  private abortController = new AbortController();

  constructor() {
    this.log = new Logger('ColetaWorker');
  }

  // ── API pública ──────────────────────────────

  getStatus(): WorkerStatus {
    return {
      emExecucao: this.isRunning,
      municipioPadrao: coletaConfig.municipioPadrao,
      ultimoRelatorio: this.lastReport,
    };
  }

  /**
   * Sinaliza cancelamento para o ciclo em andamento.
   * O loop para ao final da iteração atual (não força interrupção abrupta).
   */
  abort(): void {
    if (!this.isRunning) return;
    this.log.warn('Sinal de abort recebido — encerrando após iteração atual');
    this.abortController.abort();
  }

  /**
   * Executa um ciclo completo de coleta.
   * Se já estiver em execução, retorna o relatório anterior sem bloquear.
   */
  async execute(): Promise<RelatorioColeta> {
    if (this.isRunning) {
      this.log.warn('Ciclo já em execução — pulando disparo');
      if (!this.lastReport) throw new Error('Worker em execução mas sem relatório anterior disponível');
      return this.lastReport;
    }

    // Reseta o AbortController para este novo ciclo
    this.abortController = new AbortController();
    this.isRunning = true;

    const inicio = new Date();
    const tarefas = this.expandirTarefas();
    const resultados: ResultadoTarefa[] = [];
    let itensSalvos = 0;

    this.log.info('Ciclo iniciado', {
      tarefas: tarefas.length,
      municipioPadrao: coletaConfig.municipioPadrao,
    });

    try {
      for (let i = 0; i < tarefas.length; i++) {
        if (this.abortController.signal.aborted) {
          this.log.warn('Ciclo interrompido por abort', { progresso: `${i}/${tarefas.length}` });
          break;
        }

        const resultado = await this.processarTarefa(tarefas[i], i, tarefas.length);
        resultados.push(resultado);
        itensSalvos += resultado.itensSalvos ?? 0;

        // Aborta o ciclo inteiro se o site estiver bloqueando ativamente
        if (resultado.tipoErro === 'BLOQUEIO_403') {
          this.log.error('Bloqueio 403 detectado — abortando ciclo para proteger o IP');
          this.abortController.abort();
          continue;
        }

        // Delay entre tarefas (exceto após a última)
        if (i < tarefas.length - 1 && !this.abortController.signal.aborted) {
          try {
            await this.delay();
          } catch (err) {
            if ((err as DOMException).name === 'AbortError') break;
            throw err;
          }
        }
      }
    } finally {
      this.isRunning = false;
    }

    const fim = new Date();
    const relatorio = this.buildRelatorio(inicio, fim, tarefas.length, resultados, itensSalvos);

    this.lastReport = relatorio;

    this.logRelatorio(relatorio);
    return relatorio;
  }

  // ── Processamento de tarefa individual ──────

  private async processarTarefa(
    tarefa: TarefaColeta,
    indice: number,
    total: number,
  ): Promise<ResultadoTarefa> {
    const { produto, municipio } = tarefa;
    const taskLog = this.log.child(`${indice + 1}/${total}`);
    const inicio = Date.now();

    taskLog.info('Coletando', { produto: produto.label, municipio });

    try {
      const resultado = await buscarProdutos({
        termo: produto.termo,
        municipio,
        pagina: 1,
      });

      if (resultado.itens.length === 0) {
        taskLog.warn('Sem resultados', { produto: produto.label, municipio });

        return {
          produto: produto.label,
          municipio,
          status: 'sem_resultados',
          itensSalvos: 0,
          duracaoMs: Date.now() - inicio,
        };
      }

      const salvos = await precoRepository.salvarLote(resultado.itens, 'api');

      taskLog.info('Sucesso', {
        produto: produto.label,
        municipio,
        encontrados: resultado.itens.length,
        salvos: salvos.length,
        duracaoMs: Date.now() - inicio,
      });

      return {
        produto: produto.label,
        municipio,
        status: 'sucesso',
        itensSalvos: salvos.length,
        duracaoMs: Date.now() - inicio,
      };
    } catch (err) {
      const scraperErr = err as ScraperError;
      const mensagem = scraperErr.mensagem ?? (err instanceof Error ? err.message : String(err));

      taskLog.error('Falha na coleta', {
        produto: produto.label,
        municipio,
        erro: mensagem,
        tipo: scraperErr.tipo ?? 'DESCONHECIDO',
        duracaoMs: Date.now() - inicio,
      });

      return {
        produto: produto.label,
        municipio,
        status: 'erro',
        erro: mensagem,
        tipoErro: scraperErr.tipo,
        duracaoMs: Date.now() - inicio,
      };
    }
  }

  // ── Utilitários privados ─────────────────────

  private expandirTarefas(): TarefaColeta[] {
    const tarefas: TarefaColeta[] = [];

    for (const produto of coletaConfig.produtos) {
      const municipios = produto.municipios ?? [coletaConfig.municipioPadrao];
      for (const municipio of municipios) {
        tarefas.push({ produto, municipio });
      }
    }

    return tarefas;
  }

  /**
   * Delay cancelável via AbortController.
   * Se abort() for chamado durante o sleep, a Promise rejeita
   * com AbortError e o loop encerra limpo.
   */
  private delay(): Promise<void> {
    const ms =
      Math.floor(Math.random() * (coletaConfig.delayMaxMs - coletaConfig.delayMinMs + 1)) +
      coletaConfig.delayMinMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);

      this.abortController.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Delay cancelado', 'AbortError'));
        },
        { once: true },
      );
    });
  }

  private buildRelatorio(
    inicio: Date,
    fim: Date,
    totalTarefas: number,
    tarefas: ResultadoTarefa[],
    itensSalvos: number,
  ): RelatorioColeta {
    return {
      iniciadoEm: inicio,
      finalizadoEm: fim,
      duracaoMs: fim.getTime() - inicio.getTime(),
      totalTarefas,
      sucessos: tarefas.filter((t) => t.status === 'sucesso').length,
      semResultados: tarefas.filter((t) => t.status === 'sem_resultados').length,
      falhas: tarefas.filter((t) => t.status === 'erro').length,
      itensSalvos,
      abortado: this.abortController.signal.aborted,
      tarefas,
    };
  }

  private logRelatorio(r: RelatorioColeta): void {
    const nivel = r.falhas > 0 || r.abortado ? 'warn' : 'info';

    this.log[nivel]('Ciclo finalizado', {
      duracaoMin: +(r.duracaoMs / 60_000).toFixed(2),
      totalTarefas: r.totalTarefas,
      executadas: r.tarefas.length,
      sucessos: r.sucessos,
      semResultados: r.semResultados,
      falhas: r.falhas,
      itensSalvos: r.itensSalvos,
      abortado: r.abortado,
      erros: r.tarefas
        .filter((t) => t.status === 'erro')
        .map((t) => ({ produto: t.produto, tipo: t.tipoErro ?? 'ERR' })),
    });
  }
}

// ─────────────────────────────────────────────
// Singleton compartilhado entre server.ts e coleta.controller.ts
// ─────────────────────────────────────────────
export const coletaWorker = new ColetaWorker();
