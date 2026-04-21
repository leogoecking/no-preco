import cron from 'node-cron';
import { ColetaWorker, coletaWorker, RelatorioColeta, WorkerStatus } from './coleta.worker';
import { GrupoColeta } from './coleta.config';
import { Logger } from '../shared/logger/logger';

const CRON_PADRAO = '0 */6 * * *'; // a cada 6 horas (00h, 06h, 12h, 18h)
const TIMEZONE = 'America/Bahia';
const JITTER_MAX_MS = 20 * 60 * 1_000; // até 20 min de atraso aleatório por ciclo

/** Deriva o grupo rotativo a partir do horário UTC — cada 6h alterna entre 0 e 1. */
function grupoDoHorario(agora: Date = new Date()): GrupoColeta {
  return (Math.floor(agora.getUTCHours() / 6) % 2) as GrupoColeta;
}

/**
 * Pausas progressivas do circuit breaker (ms).
 * A cada ativação consecutiva, avança para o próximo escalão.
 * Reseta ao primeiro ciclo sem bloqueio.
 */
const PAUSAS_BACKOFF_MS = [
  60 * 60 * 1_000, // 1h
  2 * 60 * 60 * 1_000, // 2h
  4 * 60 * 60 * 1_000, // 4h
  12 * 60 * 60 * 1_000, // 12h (teto)
];

/**
 * WorkerScheduler
 *
 * Responsável exclusivamente por agendar e gerenciar o ciclo de vida
 * do ColetaWorker. Não conhece detalhes de scraping nem de banco —
 * delega tudo ao worker injetado.
 *
 * Pode ser instanciado com um worker customizado (útil em testes).
 */
export class WorkerScheduler {
  private readonly log: Logger;
  private task: cron.ScheduledTask | null = null;

  // ── Circuit Breaker ──────────────────────────
  /** Quantos ciclos consecutivos terminaram com bloqueio (403 ou 429). */
  private consecutivosBloqueio = 0;
  private readonly MAX_FALHAS_BLOQUEIO = 3;
  /** Quantas vezes o breaker já ativou desde o último ciclo limpo — índice em PAUSAS_BACKOFF_MS. */
  private ativacoesBreaker = 0;
  /** Timestamp (ms) até quando o scheduler deve ficar em silêncio. */
  private pausaAteMs: number | null = null;

  constructor(private readonly worker: ColetaWorker = coletaWorker) {
    this.log = new Logger('WorkerScheduler');
  }

  /** Inicia o agendamento. Lança se a expressão cron for inválida. */
  start(expressao: string = CRON_PADRAO): void {
    if (this.task) {
      this.log.warn('Scheduler já iniciado — ignorando chamada duplicada');
      return;
    }

    if (!cron.validate(expressao)) {
      throw new Error(`Expressão cron inválida: "${expressao}"`);
    }

    this.task = cron.schedule(expressao, () => this.disparar(), {
      timezone: TIMEZONE,
      runOnInit: false,
    });

    this.log.info('Scheduler iniciado', {
      cron: expressao,
      timezone: TIMEZONE,
      produtos:
        this.worker.getStatus().ultimoRelatorio?.totalTarefas ?? '(pendente primeiro ciclo)',
    });
  }

  /** Para o cron e sinaliza abort ao worker se estiver rodando. */
  stop(): void {
    if (!this.task) return;

    this.worker.abort();
    this.task.stop();
    this.task = null;

    this.log.info('Scheduler encerrado');
  }

  /** Expõe o status atual do worker para endpoints de health/status. */
  getWorkerStatus(): WorkerStatus {
    return this.worker.getStatus();
  }

  /**
   * Registra handlers de SIGTERM/SIGINT para graceful shutdown.
   * Aguarda o ciclo ativo encerrar (máx 30s) antes de sair.
   */
  registerShutdownHandlers(onBeforeExit?: () => Promise<void>): void {
    const shutdown = async (signal: string): Promise<void> => {
      this.log.info(`Sinal recebido — iniciando shutdown`, { signal });
      this.stop();

      const MAX_ESPERA_MS = 30_000;
      const TICK_MS = 300;
      let aguardado = 0;

      while (this.worker.getStatus().emExecucao && aguardado < MAX_ESPERA_MS) {
        await sleep(TICK_MS);
        aguardado += TICK_MS;
      }

      if (aguardado >= MAX_ESPERA_MS) {
        this.log.warn('Timeout de shutdown atingido — saída forçada');
      } else {
        this.log.info('Shutdown limpo concluído', { aguardadoMs: aguardado });
      }

      await onBeforeExit?.();
      process.exit(0);
    };

    process.once('SIGTERM', () => {
      shutdown('SIGTERM').catch(console.error);
    });
    process.once('SIGINT', () => {
      shutdown('SIGINT').catch(console.error);
    });
  }

  // ── Privado ───────────────────────────────────

  private async disparar(): Promise<void> {
    // Verifica se o circuit breaker está ativo
    if (this.pausaAteMs !== null) {
      const restanteMs = this.pausaAteMs - Date.now();

      if (restanteMs > 0) {
        this.log.warn('Circuit breaker ativo — disparo ignorado', {
          retomadaEm: new Date(this.pausaAteMs).toISOString(),
          restanteMin: +(restanteMs / 60_000).toFixed(1),
        });
        return;
      }

      // Pausa expirou — reset automático
      this.pausaAteMs = null;
      this.consecutivosBloqueio = 0;
      this.log.info('Circuit breaker resetado — retomando coletas normalmente');
    }

    const { emExecucao } = this.worker.getStatus();

    if (emExecucao) {
      this.log.warn('Disparo ignorado — worker ainda em execução no ciclo anterior');
      return;
    }

    const jitterMs = Math.floor(Math.random() * JITTER_MAX_MS);
    this.log.info('Aguardando jitter antes de disparar', {
      jitterMin: +(jitterMs / 60_000).toFixed(1),
    });
    await sleep(jitterMs);

    // Re-verifica após o jitter — ciclo anterior pode ter começado durante a espera
    if (this.worker.getStatus().emExecucao) {
      this.log.warn('Disparo ignorado após jitter — worker já em execução');
      return;
    }

    const grupo = grupoDoHorario();
    this.log.info('Disparando ciclo de coleta', { grupo });

    this.worker
      .execute({ grupo })
      .then((relatorio) => this.avaliarCircuitBreaker(relatorio))
      .catch((err: Error) => {
        this.log.error('Erro não tratado no ciclo', { erro: err.message, stack: err.stack });
      });
  }

  /**
   * Analisa o relatório do ciclo encerrado e gerencia o circuit breaker.
   *
   * Critério de "bloqueio": ciclo foi abortado E ao menos uma tarefa
   * falhou com BLOQUEIO_403 ou BLOQUEIO_429. Qualquer ciclo sem bloqueio
   * reseta o contador.
   */
  private avaliarCircuitBreaker(relatorio: RelatorioColeta): void {
    const teveBloqueio =
      relatorio.abortado &&
      relatorio.tarefas.some((t) => t.tipoErro === 'BLOQUEIO_403' || t.tipoErro === 'BLOQUEIO_429');

    if (teveBloqueio) {
      this.consecutivosBloqueio++;

      this.log.warn('Bloqueio registrado no ciclo', {
        consecutivos: this.consecutivosBloqueio,
        limiteParaPausa: this.MAX_FALHAS_BLOQUEIO,
      });

      if (this.consecutivosBloqueio >= this.MAX_FALHAS_BLOQUEIO) {
        const escalao = Math.min(this.ativacoesBreaker, PAUSAS_BACKOFF_MS.length - 1);
        const pausaMs = PAUSAS_BACKOFF_MS[escalao];
        this.pausaAteMs = Date.now() + pausaMs;
        this.ativacoesBreaker++;
        this.consecutivosBloqueio = 0;

        this.log.error('Circuit breaker ativado', {
          motivo: `${this.MAX_FALHAS_BLOQUEIO} bloqueios consecutivos`,
          ativacao: this.ativacoesBreaker,
          pausaAte: new Date(this.pausaAteMs).toISOString(),
          pausaDurMin: pausaMs / 60_000,
        });
      }
    } else {
      if (this.consecutivosBloqueio > 0 || this.ativacoesBreaker > 0) {
        this.log.info('Ciclo sem bloqueio — resetando contadores do circuit breaker');
      }
      this.consecutivosBloqueio = 0;
      this.ativacoesBreaker = 0;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Singleton exportado para uso no server.ts
// ─────────────────────────────────────────────
export const workerScheduler = new WorkerScheduler(coletaWorker);

// ─────────────────────────────────────────────
// Modo standalone: ts-node src/jobs/worker.scheduler.ts
// ─────────────────────────────────────────────
if (require.main === module) {
  (async (): Promise<void> => {
    const { connectDatabase } = await import('../shared/database/connection');
    const cronExpr = process.env['COLETA_CRON'] ?? CRON_PADRAO;

    const log = new Logger('standalone');
    log.info('Iniciando worker standalone', { cron: cronExpr });

    await connectDatabase();

    workerScheduler.start(cronExpr);
    workerScheduler.registerShutdownHandlers();

    // Executa imediatamente ao iniciar standalone
    log.info('Executando coleta inicial...');
    coletaWorker.execute().catch((err: Error) => {
      log.error('Erro na coleta inicial', { erro: err.message });
    });
  })().catch((err) => {
    process.stderr.write(
      JSON.stringify({ level: 'ERROR', msg: 'Falha fatal', erro: String(err) }) + '\n',
    );
    process.exit(1);
  });
}
