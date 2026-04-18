# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Instala APENAS dependências de produção.
# Camada cacheada separada: só é reexecutada quando package*.json mudar.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copia manifestos antes do source code para aproveitar cache de camada
COPY package*.json ./

# npm ci garante install reproduzível a partir do package-lock.json
# --omit=dev exclui devDependencies (~60% menos pacotes)
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder
# Instala TODAS as deps (inclui TypeScript, tipos, etc.) e compila.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copia apenas os arquivos necessários para o build
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner (imagem final)
# Imagem mínima: Alpine + Node.js + artefatos compilados.
# Não contém TypeScript, ESLint, código-fonte, nem devDependencies.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Metadados da imagem
LABEL maintainer="no-preco-api"
LABEL description="API de monitoramento de preços"

WORKDIR /app

ENV NODE_ENV=production

# Copia node_modules de produção (stage deps)
COPY --from=deps   /app/node_modules ./node_modules

# Copia o JavaScript compilado (stage builder)
COPY --from=builder /app/dist         ./dist

# package.json necessário para leitura de metadados em runtime
COPY --from=builder /app/package.json ./package.json

# ── Segurança: roda como usuário não-root ──────────────────────────────────
# O usuário "node" (uid 1000) já existe na imagem oficial node:alpine
USER node

EXPOSE 3000

# ── Health check ──────────────────────────────────────────────────────────
# --start-period: aguarda 20s antes de começar a checar (tempo de conexão ao Mongo)
# wget está disponível no Alpine sem instalação adicional
HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=20s \
            --retries=3 \
  CMD wget -qO- http://localhost:3000/ping || exit 1

CMD ["node", "dist/server.js"]
