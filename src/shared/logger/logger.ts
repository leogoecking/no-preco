type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  ts: string;
  level: LogLevel;
  ctx: string;
  msg: string;
  [key: string]: unknown;
}

/**
 * Logger estruturado que emite JSON lines para stdout/stderr.
 * Compatível com CloudWatch, Datadog, Loki e qualquer agregador
 * que consuma linhas JSON (cada entrada é um JSON completo numa linha).
 *
 * Uso:
 *   const log = new Logger('ColetaWorker');
 *   log.info('Ciclo iniciado', { tarefas: 15 });
 *   // → {"ts":"...","level":"INFO","ctx":"ColetaWorker","msg":"Ciclo iniciado","tarefas":15}
 */
export class Logger {
  constructor(private readonly context: string) {}

  debug(msg: string, data?: Record<string, unknown>): void {
    this.emit('DEBUG', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.emit('INFO', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.emit('WARN', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.emit('ERROR', msg, data);
  }

  /** Cria um child logger com contexto mais específico */
  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`);
  }

  private emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      ctx: this.context,
      msg,
      ...data,
    };

    const line = JSON.stringify(entry);

    if (level === 'ERROR' || level === 'WARN') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}
