/**
 * cron-teste.ts
 *
 * Script standalone para validar o agendamento com node-cron
 * sem precisar subir o servidor completo nem conectar ao banco.
 *
 * FASE 1 — log simples a cada minuto
 * FASE 2 — chamada real ao ScraperService (descomente a seção abaixo)
 *
 * Executar:
 *   npm run cron:teste
 */

import cron from 'node-cron';

// ─────────────────────────────────────────────
// FASE 1: log simples — confirma que o cron dispara
// ─────────────────────────────────────────────

function tarefaLog(): void {
  const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' });
  console.log(`[cron-teste] disparo às ${agora}`);
}

// ─────────────────────────────────────────────
// FASE 2: chamada real ao ScraperService
// Descomente o bloco abaixo e substitua "tarefaLog" por "tarefaScraper" no schedule.
// ─────────────────────────────────────────────

// import { buscarProdutos } from '../modules/scraper/scraper.service';
// async function tarefaScraper(): Promise<void> {
//   const agora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' });
//   console.log(`[cron-teste] iniciando scraping às ${agora}...`);
//   try {
//     const resultado = await buscarProdutos({ termo: 'arroz', municipio: 'Teixeira de Freitas' });
//     console.log('[cron-teste] resultado:', {
//       termo: resultado.termo,
//       municipio: resultado.municipio,
//       totalItens: resultado.totalItens,
//       primeiroItem: resultado.itens[0] ?? null,
//     });
//   } catch (err) {
//     console.error('[cron-teste] erro no scraping:', err instanceof Error ? err.message : String(err));
//   }
// }

// ─────────────────────────────────────────────
// Agendamento
//
// Troque "tarefaLog" por "tarefaScraper" quando quiser avançar para a Fase 2.
// ─────────────────────────────────────────────

const EXPRESSAO_CRON = '* * * * *'; // a cada minuto

if (!cron.validate(EXPRESSAO_CRON)) {
  console.error(`Expressão cron inválida: "${EXPRESSAO_CRON}"`);
  process.exit(1);
}

console.log(`[cron-teste] scheduler iniciado — expressão: "${EXPRESSAO_CRON}" (a cada minuto)`);
console.log('[cron-teste] aguardando primeiro disparo... (Ctrl+C para encerrar)\n');

cron.schedule(
  EXPRESSAO_CRON,
  () => {
    // FASE 1 — descomente a linha abaixo para testar só o log:
    tarefaLog();

    // FASE 2 — comente a linha acima e descomente esta para chamar o scraper:
    // tarefaScraper().catch(console.error);
  },
  { timezone: 'America/Bahia' },
);
