# 🚀 Roadmap: Sistema de Monitoramento de Preços (BA)

Este projeto tem como objetivo construir um backend robusto em Node.js para coletar, armazenar e analisar preços de produtos no estado da Bahia (foco inicial: Teixeira de Freitas), utilizando o site "Preço da Hora" como fonte.

---

## 🛠️ Stack Tecnológica
- **Linguagem:** TypeScript / Node.js
- **Framework:** Express.js
- **Banco de Dados:** PostgreSQL 17 — Neon (cloud serverless) via Prisma 7
- **Scraping:** Axios + Cheerio
- **Automação:** node-cron (Worker Service)
- **Qualidade/CI:** Jest (Testes), ESLint, GitHub Actions (CI/CD)

---

## 🏗️ Arquitetura e Padrões
- **Camadas:** Controller -> Service -> Repository.
- **Clean Code:** Nomes semânticos, funções pequenas, tipagem forte com interfaces.
- **Resiliência:** Tratamento de erros centralizado, rotação de User-Agent, delays entre requisições.

---

## 🧩 Fases do Desenvolvimento

### ✅ FASE 1: Fundação (Concluída)
- [x] Setup do projeto com TypeScript e Express.
- [x] Estrutura de pastas modular (`src/controllers`, `src/services`, etc.).
- [x] Configuração de ESLint e Prettier.

### ✅ FASE 2: Motor de Coleta (Concluída)
- [x] Service de scraping utilizando Axios/Cheerio.
- [x] Tratamento de headers para evitar bloqueios 403.
- [x] Implementação de busca por produto e cidade.

### ✅ FASE 3: Persistência (Concluída)
- [x] Migração de MongoDB para PostgreSQL 17 (Neon serverless).
- [x] ORM Prisma 7 com driver adapter `@prisma/adapter-pg`.
- [x] Schema `prisma/schema.prisma` — model `Preco`, enum `Fonte` (api/html/browser).
- [x] Client singleton em `src/shared/database/prisma.ts`.
- [x] Migrations em `prisma/migrations/`.

### 🔄 FASE 4: Automação (Em Progresso)
- [ ] Implementação de Worker Service com `node-cron`.
- [ ] Lógica de concorrência zero (não rodar se o anterior estiver ativo).
- [ ] Intervalo randômico entre scrapes para proteção de IP.

### 📅 FASE 5: Inteligência e API (Próximo Passo)
- [ ] Criar queries Prisma/SQL para:
    - Menor preço atual por cidade.
    - Histórico de variação de preço.
    - Sugestão de "Cesta Básica Mais Barata" entre mercados.
- [ ] Implementação de Cache (Memory-cache) para buscas frequentes.

### 🛡️ FASE 6: Qualidade e CI/CD
- [x] Setup do GitHub Actions (`.github/workflows/ci.yml`).
- [ ] Escrita de testes unitários com Jest para lógica de preços.
- [ ] Dockerização da aplicação (Dockerfile e docker-compose).

---

## ⚠️ Regras e Restrições para a IA
1. **Não sugerir** o uso de ferramentas de automação externas (n8n, Zapier) neste estágio; manter tudo no código puro (Node.js).
2. **Priorizar** o uso de TypeScript em todas as sugestões.
3. **Evitar** bibliotecas pesadas de scraping (como Puppeteer/Playwright) a menos que o site bloqueie o Axios permanentemente.
4. **Focar** na experiência de um Desenvolvedor Júnior: código legível, bem comentado e seguindo padrões de mercado.

---

## 🎯 Objetivo Final
Transformar o projeto em uma ferramenta de utilidade pública para a região de Teixeira de Freitas e um portfólio de alto nível para transição de carreira.