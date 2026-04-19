# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Instala dependências de produção.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
# --ignore-scripts evita que o postinstall (prisma generate) rode aqui:
# o schema ainda não foi copiado neste stage e o generate é feito no builder.
RUN npm ci --omit=dev --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder
# Instala todas as deps, gera o Prisma client e compila o TypeScript.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
# --ignore-scripts evita postinstall (prisma generate) antes do schema estar disponível
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Gera o cliente Prisma (inclui binary para linux-musl-openssl-3.0.x)
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner (imagem final)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

LABEL maintainer="no-preco-api"
LABEL description="API de monitoramento de preços"

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Chromium para Puppeteer (--no-sandbox já configurado no browser-client.ts)
RUN apk add --no-cache chromium

# node_modules de produção (sem devDeps)
COPY --from=deps    /app/node_modules          ./node_modules

# Binário gerado pelo prisma generate (linux-musl)
COPY --from=builder /app/node_modules/.prisma  ./node_modules/.prisma

# JavaScript compilado
COPY --from=builder /app/dist                  ./dist

COPY --from=builder /app/package.json          ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=20s \
            --retries=3 \
  CMD wget -qO- http://localhost:3000/api/ping || exit 1

CMD ["node", "dist/server.js"]
