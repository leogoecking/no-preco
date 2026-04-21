import 'dotenv/config';
import { prisma } from '../src/shared/database/prisma';

interface CountRow {
  total: bigint;
}

interface GrupoRow {
  produto: string;
  cnpj: string;
  preco: string;
  ocorrencias: bigint;
}

interface TopProdutoRow {
  produto: string;
  duplicatas: bigint;
}

async function main(): Promise<void> {
  const total = await prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS total FROM precos`;
  console.log(`\nTotal de linhas em precos: ${total[0].total}\n`);

  const [{ total: duplicatasExcedentes }] = await prisma.$queryRaw<CountRow[]>`
    SELECT COALESCE(SUM(ocorrencias - 1), 0)::bigint AS total
    FROM (
      SELECT COUNT(*)::bigint AS ocorrencias
      FROM precos
      GROUP BY produto, cnpj, preco
      HAVING COUNT(*) > 1
    ) AS grupos
  `;
  console.log(
    `Linhas que seriam excluídas (mantém 1 por (produto, cnpj, preco)): ${duplicatasExcedentes}\n`,
  );

  const top10Grupos = await prisma.$queryRaw<GrupoRow[]>`
    SELECT produto, cnpj, preco::text AS preco, COUNT(*)::bigint AS ocorrencias
    FROM precos
    GROUP BY produto, cnpj, preco
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;
  console.log('Top 10 grupos (produto, cnpj, preco) com mais duplicatas:');
  for (const g of top10Grupos) {
    console.log(
      `  ${g.ocorrencias}x | ${g.produto} | cnpj=${g.cnpj || '(vazio)'} | R$ ${g.preco}`,
    );
  }
  console.log();

  const topProdutos = await prisma.$queryRaw<TopProdutoRow[]>`
    SELECT produto, SUM(ocorrencias - 1)::bigint AS duplicatas
    FROM (
      SELECT produto, COUNT(*) AS ocorrencias
      FROM precos
      GROUP BY produto, cnpj, preco
      HAVING COUNT(*) > 1
    ) AS grupos
    GROUP BY produto
    ORDER BY duplicatas DESC
    LIMIT 10
  `;
  console.log('Top 10 produtos por excedente de duplicatas:');
  for (const p of topProdutos) {
    console.log(`  ${p.duplicatas} duplicatas | ${p.produto}`);
  }
  console.log();

  const [{ total: cnpjVazio }] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS total FROM precos WHERE cnpj = ''
  `;
  console.log(`Linhas com cnpj vazio: ${cnpjVazio}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
