# No-Preço API

API REST que coleta, armazena e analisa preços de produtos da cesta básica a partir de uma fonte pública estadual de transparência de preços.

O objetivo é transformar dados dispersos em um serviço estruturado: coleta automática via cron job, histórico persistido em PostgreSQL e endpoints de análise para comparar mercados, detectar variações de preço e identificar oportunidades de compra.

---

## O que o projeto resolve

A fonte pública exibe preços de forma manual e pontual. Esta API resolve três problemas concretos:

1. **Coleta automatizada** — cron job busca preços de 15 produtos da cesta básica a cada hora, sem intervenção humana.
2. **Histórico persistido** — cada coleta é salva com data, mercado e CNPJ do estabelecimento, permitindo análise temporal.
3. **Análise inteligente** — endpoints calculam o melhor mercado para uma lista de compras, ranking de volatilidade e alertas quando um produto está abaixo da média histórica de 6 meses.

---

## Tecnologias

| Camada | Tecnologia | Papel |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Base da aplicação |
| Framework HTTP | Express 4 | Servidor REST e roteamento |
| Banco de dados | PostgreSQL (Neon) + Prisma 7 | Persistência e consultas |
| Driver Prisma | `@prisma/adapter-pg` | Conexão via pool nativo do `pg` |
| Scraping | Puppeteer + Stealth Plugin | Browser headless com Page compartilhada |
| Parse HTML | Cheerio | Fallback quando resposta JSON não está disponível |
| Agendamento | node-cron 3 | Coleta periódica no timezone America/Bahia |
| Cache em memória | node-cache | TTL por query, evita buscas repetidas ao banco |
| Autenticação | JWT (jsonwebtoken) | Proteção de rotas administrativas |
| Containerização | Docker + Docker Compose | Ambiente reproduzível |
| Desenvolvimento | ts-node-dev | Hot reload sem compilação prévia |

---

## Estrutura do projeto

```
src/
├── app.ts                          # Monta o Express (rotas + middlewares)
├── server.ts                       # Ponto de entrada — inicializa DB e servidor
│
├── jobs/
│   ├── coleta.config.ts            # Lista de produtos monitorados e configurações
│   ├── coleta.worker.ts            # Orquestra o ciclo de coleta (circuit breaker incluso)
│   └── worker.scheduler.ts         # Gerencia o cron e o circuit breaker de 403s
│
├── modules/
│   ├── health/                     # GET /ping
│   ├── auth/                       # POST /auth/login
│   ├── scraper/                    # Lógica de coleta e normalização
│   ├── preco/                      # Repositório de preços (Prisma)
│   ├── coleta/                     # POST /coleta/disparar e GET /coleta/status
│   ├── analise/                    # POST /analise/carrinho
│   └── inteligencia/               # GET /inteligencia/estatisticas|volatilidade|alertas
│
├── shared/
│   ├── http/
│   │   └── browser-client.ts       # Puppeteer com Page compartilhada (CSRF + TTL 25min)
│   ├── cache/                      # Cache em memória com TTL configurável
│   ├── database/
│   │   ├── connection.ts           # Inicialização e healthcheck da conexão
│   │   └── prisma.ts               # Instância singleton do PrismaClient
│   ├── logger/logger.ts            # Logger estruturado (JSON)
│   ├── middleware/
│   │   ├── auth.middleware.ts      # Validação de JWT
│   │   └── rate-limiter.ts         # Rate limiting por rota
│   ├── utils/                      # Helpers de data, normalização e slug
│   └── validation/validate.ts      # Wrapper Zod para validação de body/query
│
└── __tests__/                      # Testes unitários (Jest)

prisma/
└── schema.prisma                   # Schema Prisma (model Preco)
```

---

## Pré-requisitos

- **Node.js** 20 ou superior — [nodejs.org](https://nodejs.org)
- **npm** 10 ou superior (já incluso com Node.js)
- **Docker** e **Docker Compose** — necessários para subir a API em container
- **Banco de dados PostgreSQL** — o projeto usa [Neon](https://neon.tech) (serverless cloud); crie um projeto gratuito e copie as strings de conexão

Verifique as versões instaladas:

```bash
node -v   # deve mostrar v20.x.x ou superior
npm -v    # deve mostrar 10.x.x ou superior
docker -v
```

---

## Instalação e execução local

### 1. Clone o repositório

```bash
git clone <url-do-repositorio>
cd no-preco
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Banco de dados — obrigatório
DATABASE_URL=postgresql://usuario:senha@ep-xxx.neon.tech/no-preco?sslmode=require
DIRECT_URL=postgresql://usuario:senha@ep-xxx.neon.tech/no-preco?sslmode=require

# Autenticação
JWT_SECRET=seu_segredo_jwt_aqui

# Servidor
PORT=3000

# Coleta automática
COLETA_ATIVO=true
COLETA_MUNICIPIO=Teixeira de Freitas
COLETA_CRON=0 * * * *    # toda hora; use "* * * * *" para testar a cada minuto
```

> `DATABASE_URL` usa o connection pooler do Neon; `DIRECT_URL` aponta para a conexão direta — necessária para `prisma migrate`.

### 4. Aplique as migrações do banco

```bash
npx prisma migrate deploy
```

### 5. Inicie o servidor em modo desenvolvimento

```bash
npm run dev
```

O servidor sobe em `http://localhost:3000` com hot reload ativado:

```
[db] Conectado ao PostgreSQL
[WorkerScheduler] Scheduler iniciado { cron: "0 * * * *", timezone: "America/Bahia" }
[Server] Servidor iniciado { porta: 3000, coleta: true }
```

---

## Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com hot reload (ts-node-dev) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda o build compilado (produção) |
| `npm run worker` | Sobe apenas o worker de coleta (sem servidor HTTP) |
| `npm run lint` | Verifica erros de lint |
| `npm run lint:fix` | Corrige erros de lint automaticamente |
| `npm run format` | Formata o código com Prettier |
| `npm test` | Roda a suíte de testes (Jest) |
| `npm run redeploy` | Rebuild e recria o container da API |
| `npm run redeploy:clean` | Rebuild sem cache e recria o container |

---

## Executando com Docker Compose

Para subir a API + nginx em modo produção:

```bash
docker compose up --build -d
```

> O banco de dados (Neon) é externo — nenhum container de banco é necessário.

Para acompanhar os logs:

```bash
docker compose logs -f api
```

Para parar:

```bash
docker compose down
```

---

## Endpoints da API

### Health

```
GET /ping
```
Retorna `{ status: "ok" }` se o servidor está respondendo.

---

### Autenticação

```
POST /auth/login
Content-Type: application/json

{ "email": "admin@example.com", "senha": "..." }
```
Retorna um JWT usado para proteger rotas administrativas.

---

### Produtos

```
GET /produtos/buscar?termo=arroz&municipio=Teixeira%20de%20Freitas&dias=7&limite=50
```
Busca no banco o preço mais recente por mercado. **Não faz scraping ao vivo** — consulta dados já coletados pelo cron.

```
GET /produtos/historico?produto=arroz 5kg&municipio=Teixeira%20de%20Freitas&limite=50
```
Histórico completo de preços. Parâmetros opcionais: `dataInicio`, `dataFim` (ISO 8601).

---

### Coleta manual

```
POST /coleta/disparar
Content-Type: application/json

{}   # sem body: ciclo completo da lista configurada
{ "produto": "arroz 5kg", "municipio": "Salvador" }   # produto específico
```
Dispara coleta em background e retorna `202 Accepted`. O ciclo sem body usa `COLETA_MUNICIPIO`.

```
GET /coleta/status
```
Retorna se há coleta em andamento e o relatório da última execução (sucessos, falhas, itens salvos, duração).

---

### Análise de carrinho

```
POST /analise/carrinho
Content-Type: application/json

{
  "municipio": "Teixeira de Freitas",
  "itens": [
    { "produto": "arroz 5kg",          "quantidade": 1 },
    { "produto": "feijão carioca 1kg", "quantidade": 2 }
  ]
}
```
Retorna:
- **opcao1_mercadoUnico** — mercado com menor soma total
- **opcao2_combinacaoOtima** — melhor preço por item em mercados diferentes

---

### Inteligência de preços

```
GET /inteligencia/estatisticas?municipio=Teixeira%20de%20Freitas&dias=7&produtos=arroz 5kg,feijão 1kg
```
Estatísticas por produto: mínimo, máximo, média, preço atual e variação vs. média.

```
GET /inteligencia/volatilidade?municipio=Teixeira%20de%20Freitas&dias=30&limite=10
```
Ranking dos produtos mais voláteis (coeficiente de variação σ/μ).

```
GET /inteligencia/alertas?municipio=Teixeira%20de%20Freitas&variacaoLimiar=-10
```
Produtos com preço atual abaixo da média histórica de 6 meses. `variacaoLimiar` define o percentual mínimo de queda (padrão: `-5`).

---

## Coleta automática

O cron job roda segundo `COLETA_CRON` (padrão: toda hora) e coleta preços de 15 produtos da cesta básica na cidade configurada em `COLETA_MUNICIPIO`:

- **Cesta básica:** arroz, feijão carioca, feijão preto, açúcar, farinha de trigo, óleo de soja, macarrão, sal
- **Proteínas:** frango, carne moída, ovos
- **Laticínios:** leite integral, manteiga
- **Higiene:** sabão em pó, detergente

A lista completa está em `src/jobs/coleta.config.ts`.

### Estratégia de scraping

Uma única Page do Puppeteer é inicializada e **compartilhada** entre todos os produtos do ciclo. Ela navega para o site uma vez, captura o CSRF token do POST inicial do JS e mantém a sessão ativa por até 25 minutos. Cada produto dispara apenas **um POST** via `fetch` dentro do contexto da Page — sem reabrir browser ou recarregar a página.

Ao final do JSON de resposta, o parser `extrairItens()` normaliza os dados. Se a resposta não for JSON, Cheerio faz parse do HTML já renderizado pelo browser como fallback.

### Circuit breaker

Se o scraper receber bloqueio 403/429 em **3 ciclos consecutivos**, o scheduler pausa automaticamente por **1 hora**. Qualquer ciclo bem-sucedido entre eles reseta o contador.

---

## Rate limiting

| Rota | Limite |
|---|---|
| Todas as rotas (geral) | 120 req / 15 min por IP |
| `GET /produtos/*` | 60 req / min por IP |
| `POST /coleta/disparar` | 10 req / hora por IP |
| `POST /analise/carrinho` e `/inteligencia/*` | 30 req / min por IP |

---

## Variáveis de ambiente — referência completa

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP |
| `DATABASE_URL` | — | **Obrigatório.** URI do PostgreSQL (connection pooler) |
| `DIRECT_URL` | — | **Obrigatório.** URI direta para `prisma migrate` |
| `JWT_SECRET` | — | **Obrigatório.** Segredo para assinatura dos tokens JWT |
| `COLETA_ATIVO` | `true` | `false` desliga o cron sem alterar código |
| `COLETA_MUNICIPIO` | `Teixeira de Freitas` | Cidade principal monitorada pelo cron |
| `COLETA_CRON` | `0 * * * *` | Expressão cron do agendamento (timezone: America/Bahia) |
