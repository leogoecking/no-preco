import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../shared/database/connection';
import { prisma } from '../shared/database/prisma';

async function main(): Promise<void> {
  await connectDatabase();

  let atualizados = 0;
  let ignorados = 0;

  const registros = await prisma.preco.findMany({
    where: { OR: [{ cidade: '' }, { cidade: 'desconhecida' }], municipio: { not: null } },
    select: { id: true, municipio: true },
  });

  for (const doc of registros) {
    const cidade = doc.municipio ? normalizarCidade(doc.municipio) : '';

    if (!cidade) {
      ignorados += 1;
      continue;
    }

    await prisma.preco.update({ where: { id: doc.id }, data: { cidade } });
    atualizados += 1;
  }

  console.log(`[backfill:cidade] documentos atualizados=${atualizados} ignorados=${ignorados}`);
}

function normalizarCidade(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main()
  .catch((err: Error) => {
    console.error('[backfill:cidade] falhou:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    disconnectDatabase().catch(() => null);
  });
