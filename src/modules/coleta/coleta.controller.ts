import { Request, Response } from 'express';
import { coletaWorker } from '../../jobs/coleta.worker';
import { buscarProdutos } from '../scraper/scraper.service';
import { precoRepository } from '../preco/preco.repository';
import { Logger } from '../../shared/logger/logger';
import { DispararBody } from './coleta.schemas';

const log = new Logger('ColetaController');

export async function disparar(req: Request, res: Response): Promise<void> {
  const { emExecucao } = coletaWorker.getStatus();

  if (emExecucao) {
    res.status(409).json({
      erro: 'Já existe uma coleta em andamento.',
      status: 'em_execucao',
      consultarStatus: '/api/coleta/status',
    });
    return;
  }

  const { produto, municipio } = req.body as DispararBody;

  res.status(202).json({
    mensagem: produto
      ? `Coleta de "${produto}" iniciada em background.`
      : 'Ciclo completo iniciado em background.',
    status: 'iniciado',
    consultarStatus: '/api/coleta/status',
  });

  if (produto) {
    coletarProdutoEspecifico(produto, municipio);
  } else {
    coletaWorker.execute({ modo: 'completo' }).catch((err: Error) => {
      log.error('Erro no ciclo completo disparado manualmente', { erro: err.message });
    });
  }
}

export function status(_req: Request, res: Response): void {
  const { emExecucao, municipioPadrao, ultimoRelatorio } = coletaWorker.getStatus();

  res.status(200).json({
    emExecucao,
    municipioPadrao,
    ultimoRelatorio: ultimoRelatorio
      ? {
          iniciadoEm: ultimoRelatorio.iniciadoEm,
          finalizadoEm: ultimoRelatorio.finalizadoEm,
          duracaoMs: ultimoRelatorio.duracaoMs,
          totalTarefas: ultimoRelatorio.totalTarefas,
          sucessos: ultimoRelatorio.sucessos,
          semResultados: ultimoRelatorio.semResultados,
          falhas: ultimoRelatorio.falhas,
          itensSalvos: ultimoRelatorio.itensSalvos,
          abortado: ultimoRelatorio.abortado,
        }
      : null,
  });
}

function coletarProdutoEspecifico(termo: string, municipio?: string): void {
  // IIFE async garante que o .catch() cobre toda a cadeia, incluindo
  // erros gerados após awaits internos (ex: salvarLote).
  (async (): Promise<void> => {
    const resultado = await buscarProdutos({ termo, municipio, pagina: 1 });

    if (resultado.itens.length === 0) {
      log.warn('Produto sem resultados', { termo, municipio });
      return;
    }

    const salvos = await precoRepository.salvarLote(resultado.itens, 'api');
    log.info('Produto coletado', { termo, salvos });
  })().catch((err: Error) => {
    log.error('Erro ao coletar produto específico', { termo, erro: err.message });
  });
}
