import 'dotenv/config';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../shared/database/connection';
import { PrecoModel } from '../modules/preco/preco.model';

interface PrecoSemCidade {
  _id: Types.ObjectId;
  municipio?: string;
}

async function main(): Promise<void> {
  await connectDatabase();

  let atualizados = 0;
  let ignorados = 0;

  const cursor = PrecoModel.collection.find(
    {
      $or: [{ cidade: { $exists: false } }, { cidade: '' }],
      municipio: { $exists: true, $ne: '' },
    },
    {
      projection: { _id: 1, municipio: 1 },
    },
  ) as AsyncIterable<PrecoSemCidade>;

  for await (const doc of cursor) {
    const cidade = doc.municipio ? normalizarCidade(doc.municipio) : '';

    if (!cidade) {
      ignorados += 1;
      continue;
    }

    await PrecoModel.collection.updateOne({ _id: doc._id }, { $set: { cidade } });
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
