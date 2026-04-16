import 'dotenv/config';
import app from './app';
import { connectDatabase } from './shared/database/connection';
import { workerScheduler } from './jobs/worker.scheduler';
import { closeBrowser } from './shared/http/browser-client';
import { Logger } from './shared/logger/logger';

const PORT        = process.env['PORT'] ?? 3000;
const CRON_EXPR   = process.env['COLETA_CRON'] ?? '*/30 * * * *';
const COLETA_ATIVO = process.env['COLETA_ATIVO'] !== 'false';

const log = new Logger('Server');

async function bootstrap(): Promise<void> {
  await connectDatabase();

  if (COLETA_ATIVO) {
    workerScheduler.start(CRON_EXPR);
  } else {
    log.info('Job de coleta desabilitado', { motivo: 'COLETA_ATIVO=false' });
  }

  workerScheduler.registerShutdownHandlers();

  process.once('SIGTERM', () => closeBrowser().catch(() => null));
  process.once('SIGINT',  () => closeBrowser().catch(() => null));

  app.listen(PORT, () => {
    log.info('Servidor iniciado', { porta: PORT, coleta: COLETA_ATIVO });
  });
}

bootstrap().catch((err: Error) => {
  log.error('Falha crítica na inicialização', { erro: err.message, stack: err.stack });
  process.exit(1);
});
