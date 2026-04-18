-- CreateEnum
CREATE TYPE "Fonte" AS ENUM ('api', 'html', 'browser');

-- CreateTable
CREATE TABLE "precos" (
    "id" SERIAL NOT NULL,
    "produto" TEXT NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "mercado" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL DEFAULT '',
    "cidade" TEXT NOT NULL,
    "municipio" TEXT,
    "ean" TEXT,
    "unidade" TEXT,
    "fonte" "Fonte" NOT NULL DEFAULT 'api',
    "dataColeta" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "precos_produto_dataColeta_idx" ON "precos"("produto", "dataColeta" DESC);

-- CreateIndex
CREATE INDEX "precos_cidade_produto_dataColeta_idx" ON "precos"("cidade", "produto", "dataColeta" DESC);

-- CreateIndex
CREATE INDEX "precos_ean_idx" ON "precos"("ean");
