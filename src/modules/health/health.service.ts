import { isDatabaseConnected } from '../../shared/database/connection';
import { workerScheduler } from '../../jobs/worker.scheduler';

interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected';
    job: {
      emExecucao: boolean;
      ultimaColeta: string | null;
      sucessos: number | null;
      falhas: number | null;
      itensSalvos: number | null;
    };
  };
}

export function getHealthStatus(): HealthStatus {
  const dbConnected = isDatabaseConnected();
  const { emExecucao, ultimoRelatorio } = workerScheduler.getWorkerStatus();

  return {
    status: dbConnected ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      database: dbConnected ? 'connected' : 'disconnected',
      job: {
        emExecucao,
        ultimaColeta:  ultimoRelatorio?.finalizadoEm.toISOString() ?? null,
        sucessos:      ultimoRelatorio?.sucessos      ?? null,
        falhas:        ultimoRelatorio?.falhas        ?? null,
        itensSalvos:   ultimoRelatorio?.itensSalvos   ?? null,
      },
    },
  };
}
