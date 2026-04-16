# No-Preço API

API REST que coleta, armazena e analisa preços de produtos da cesta básica a partir do portal público **Preço da Hora BA** (`precodahora.ba.gov.br`), mantido pelo governo do Estado da Bahia.

O objetivo é transformar dados dispersos em um serviço estruturado: coleta automática via cron job, histórico persistido em MongoDB e endpoints de análise que permitem comparar mercados, detectar variações de preço e identificar oportunidades de compra.

---

## O que o projeto resolve

O portal oficial exibe preços de forma manual e pontual. Esta API resolve três problemas concretos:

1. **Coleta automatizada** — um cron job busca preços de 15 produtos da cesta básica de hora em hora, sem intervenção humana.
2. **Histórico persistido** — cada coleta é salva no MongoDB com data, mercado e CNPJ do estabelecimento, permitindo análise temporal.
3. **Análise inteligente** — endpoints calculam o melhor mercado para uma lista de compras, ranking de volatilidade e alertas quando um produto está abaixo da média histórica de 6 meses.

---

## Tecnologias

| Camada | Tecnologia | Papel |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Base da aplicação |
| Framework HTTP | Express 4 | Servidor REST e roteamento |
| Banco de dados | MongoDB 7 + Mongoose 8 | Persistência e consultas |
| Scraping | Axios + Cheerio | Requisições HTTP e parse HTML |
| Agendamento | node-cron 3 | Coleta periódica |
| Containerização | Docker + Docker Compose | Ambiente reproduzível |
| Desenvolvimento | ts-node-dev | Hot reload sem compilação prévia |

---

## Estrutura do projeto

```
src/
├── app.ts                          # Monta o Express (rotas + middlewares)
├── server.ts                       # Ponto de entrada — conecta banco e sobe servidor
│
├── jobs/
│   ├── coleta.config.ts            # Lista de produtos monitorados e configurações
│   ├── coleta.worker.ts            # Orquestra o ciclo de coleta (circuit breaker incluso)
│   ├── worker.scheduler.ts         # Gerencia o cron e o circuit breaker de 403s
│   └── cron-teste.ts               # Script isolado para testar o agendamento
│
├── modules/
│   ├── health/                     # GET /ping
│   ├── scraper/                    # Lógica de scraping (API JSON + fallback HTML)
│   ├── preco/                      # Model Mongoose e repositório de preços
│   ├── coleta/                     # POST /coleta/disparar e GET /coleta/status
│   ├── analise/                    # POST /analise/carrinho
│   └── inteligencia/               # GET /inteligencia/estatisticas|volatilidade|alertas
│
└── shared/
    ├── http/
    │   ├── axios-client.ts         # Cliente HTTP com jitter e interceptors
    │   └── browser-headers.ts      # Rotação de User-Agents (14 perfis)
    ├── database/connection.ts      # Conexão Mongoose com healthcheck
    ├── logger/logger.ts            # Logger estruturado
    └── middleware/rate-limiter.ts  # Rate limiting por rota
```

---

## Pré-requisitos

- **Node.js** 20 ou superior — [nodejs.org](https://nodejs.org)
- **npm** 10 ou superior (já incluso com Node.js)
- **Docker** e **Docker Compose** — necessários para subir o MongoDB

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

Crie um arquivo `.env` na raiz do projeto. O Docker Compose lê este arquivo automaticamente:

```bash
cp .env.example .env   # se o arquivo de exemplo existir
# ou crie manualmente:
```

Conteúdo mínimo do `.env`:

```env
# Banco de dados — obrigatório
MONGO_ROOT_PASSWORD=senha_root_aqui
MONGO_APP_PASSWORD=senha_app_aqui

# Opcionais (os valores abaixo já são os padrões)
MONGO_ROOT_USER=admin
MONGO_APP_USER=no_preco_user
MONGO_DB=no-preco
MONGO_PORT=27017

# Servidor
PORT=3000

# Coleta automática
COLETA_ATIVO=true
COLETA_MUNICIPIO=Salvador
COLETA_CRON=0 * * * *    # toda hora; use "* * * * *" para testar a cada minuto
```

### 4. Suba o MongoDB com Docker

```bash
docker compose up mongo -d
```

Aguarde o container ficar saudável (cerca de 20 segundos):

```bash
docker compose ps   # a coluna STATUS deve mostrar "healthy"
```

### 5. Inicie o servidor em modo desenvolvimento

```bash
npm run dev
```

O servidor sobe em `http://localhost:3000` com hot reload ativado. Você verá no terminal:

```
[db] Conectado ao MongoDB: mongodb://***:***@localhost:27017/no-preco
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
| `npm run cron:teste` | Testa o agendamento a cada minuto sem banco de dados |
| `npm run lint` | Verifica erros de lint |
| `npm run lint:fix` | Corrige erros de lint automaticamente |
| `npm run format` | Formata o código com Prettier |

---

## Executando com Docker Compose (ambiente completo)

Para subir MongoDB + API juntos em modo produção:

```bash
docker compose up --build -d
```

Para acompanhar os logs:

```bash
docker compose logs -f api
```

Para parar tudo:

```bash
docker compose down
```

Para parar e apagar os volumes (apaga todos os dados):

```bash
docker compose down -v
```

---

## Endpoints da API

### Health

```
GET /ping
```
Retorna `{ status: "ok" }` se o servidor está respondendo.

---

### Produtos

```
GET /produtos/buscar?termo=arroz&municipio=Salvador&dias=7&limite=50
```
Busca no banco o preço mais recente por mercado para o termo informado. **Não faz scraping ao vivo** — consulta os dados já coletados pelo cron.

```
GET /produtos/historico?produto=arroz 5kg&municipio=Salvador&limite=50
```
Retorna o histórico completo de preços de um produto. Parâmetros opcionais: `dataInicio`, `dataFim` (ISO 8601).

---

### Coleta manual

```
POST /coleta/disparar
Content-Type: application/json

{}   # sem body: executa o ciclo completo da lista configurada
{ "produto": "arroz 5kg", "municipio": "Salvador" }   # produto específico
```
Dispara uma coleta em background e retorna `202 Accepted` imediatamente.

```
GET /coleta/status
```
Retorna se há coleta em andamento e o relatório detalhado da última execução (sucessos, falhas, itens salvos, duração).

---

### Análise de carrinho

```
POST /analise/carrinho
Content-Type: application/json

{
  "municipio": "Salvador",
  "itens": [
    { "produto": "arroz 5kg",        "quantidade": 1 },
    { "produto": "feijão carioca 1kg", "quantidade": 2 }
  ]
}
```
Retorna duas opções de compra:
- **opcao1_mercadoUnico** — mercado com menor soma total para todos os itens
- **opcao2_combinacaoOtima** — melhor preço por item em mercados diferentes

---

### Inteligência de preços

```
GET /inteligencia/estatisticas?municipio=Salvador&dias=7&produtos=arroz 5kg,feijão 1kg
```
Estatísticas por produto na janela de tempo: mínimo, máximo, média, preço atual e variação percentual vs. média.

```
GET /inteligencia/volatilidade?municipio=Salvador&dias=30&limite=10
```
Ranking dos produtos mais voláteis, ordenados por coeficiente de variação (σ/μ).

```
GET /inteligencia/alertas?municipio=Salvador&variacaoLimiar=-10
```
Produtos com preço atual abaixo da média histórica de 6 meses. `variacaoLimiar` define o percentual mínimo de queda para aparecer no alerta (padrão: `-5`).

---

## Coleta automática

O cron job roda segundo a expressão definida em `COLETA_CRON` (padrão: `0 * * * *` — toda hora) e coleta preços de 15 produtos da cesta básica:

- **Cesta básica:** arroz, feijão carioca, feijão preto, açúcar, farinha de trigo, óleo de soja, macarrão, sal
- **Proteínas:** frango, carne moída, ovos
- **Laticínios:** leite integral, manteiga
- **Higiene:** sabão em pó, detergente

A lista completa e os municípios monitorados estão em `src/jobs/coleta.config.ts`.

### Estratégia de scraping

Cada coleta tenta primeiro a **API JSON interna** do portal. Se falhar, cai para o **parse do HTML** com Cheerio. Requisições com erro transiente (rede, timeout, 5xx) são retentadas com backoff exponencial: 2 s → 4 s → desiste.

### Circuit breaker

Se o site retornar bloqueio 403 em **3 ciclos consecutivos**, o scheduler pausa automaticamente por **1 hora** antes de tentar novamente. Qualquer ciclo bem-sucedido entre eles reseta o contador.

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
| `MONGODB_URI` | `mongodb://localhost:27017/no-preco` | URI de conexão (sobrescreve as variáveis individuais do Mongo) |
| `MONGO_ROOT_USER` | `admin` | Usuário root do MongoDB |
| `MONGO_ROOT_PASSWORD` | — | **Obrigatório.** Senha do root |
| `MONGO_APP_USER` | `no_preco_user` | Usuário da aplicação (acesso restrito ao banco) |
| `MONGO_APP_PASSWORD` | — | **Obrigatório.** Senha do usuário da aplicação |
| `MONGO_DB` | `no-preco` | Nome do banco de dados |
| `MONGO_PORT` | `27017` | Porta exposta pelo container do MongoDB |
| `COLETA_ATIVO` | `true` | `false` desliga o cron job sem alterar código |
| `COLETA_MUNICIPIO` | `Salvador` | Município padrão para produtos sem município próprio |
| `COLETA_CRON` | `0 * * * *` | Expressão cron do agendamento |
