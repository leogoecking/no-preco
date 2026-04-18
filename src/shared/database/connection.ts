import { prisma } from './prisma';

let connected = false;

export function isDatabaseConnected(): boolean {
  return connected;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  connected = true;
  console.log('[db] Conectado ao PostgreSQL (Neon)');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  connected = false;
  console.log('[db] Conexão encerrada');
}
