import mongoose from 'mongoose';

const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/no-preco';

/** Estado da conexão exposto para health check */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectDatabase(): Promise<void> {
  // Mongoose 8 não emite eventos deprecados; opções legadas foram removidas
  mongoose.connection.on('connected', () => {
    console.log(`[db] Conectado ao MongoDB: ${sanitizeUri(MONGODB_URI)}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB desconectado');
  });

  mongoose.connection.on('error', (err: Error) => {
    console.error('[db] Erro de conexão:', err.message);
  });

  await mongoose.connect(MONGODB_URI, {
    // Tempo máximo de espera para estabelecer conexão inicial
    serverSelectionTimeoutMS: 10_000,
    // Keepalive para evitar timeout em conexões ociosas
    socketTimeoutMS: 45_000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] Conexão encerrada');
}

/** Remove usuário:senha da URI para logging seguro */
function sanitizeUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    parsed.password = parsed.password ? '***' : '';
    parsed.username = parsed.username ? '***' : '';
    return parsed.toString();
  } catch {
    return uri.replace(/:\/\/[^@]+@/, '://***@');
  }
}
