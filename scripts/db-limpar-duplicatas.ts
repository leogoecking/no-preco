import 'dotenv/config';
import { prisma } from '../src/shared/database/prisma';

interface CountRow {
  total: bigint;
}

async function main(): Promise<void> {
  const [{ total: antes }] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS total FROM precos
  `;

  const [{ total: previsto }] = await prisma.$queryRaw<CountRow[]>`
    SELECT COALESCE(SUM(ocorrencias - 1), 0)::bigint AS total
    FROM (
      SELECT COUNT(*)::bigint AS ocorrencias
      FROM precos
      GROUP BY produto, cnpj, preco
      HAVING COUNT(*) > 1
    ) AS grupos
  `;

  console.log(`Linhas antes do DELETE: ${antes}`);
  console.log(`Previsão de exclusão:   ${previsto}`);
  console.log();

  if (previsto === 0n) {
    console.log('Nenhuma duplicata encontrada — nada a fazer.');
    return;
  }

  const excluidas = await prisma.$transaction(async (tx) => {
    const deletados = await tx.$executeRaw`
      DELETE FROM precos
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY produto, cnpj, preco
            ORDER BY "dataColeta" DESC, id DESC
          ) AS rn
          FROM precos
        ) ranked
        WHERE rn > 1
      )
    `;

    if (BigInt(deletados) !== previsto) {
      throw new Error(
        `Delta inesperado: deletados=${deletados}, previsto=${previsto}. ROLLBACK automático.`,
      );
    }

    return deletados;
  });

  const [{ total: depois }] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS total FROM precos
  `;

  console.log(`Linhas excluídas:       ${excluidas}`);
  console.log(`Linhas depois do DELETE: ${depois}`);
  console.log(`Delta real:              ${antes - depois}`);
}

main()
  .catch((err) => {
    console.error('Falha — operação abortada (transação revertida):', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
