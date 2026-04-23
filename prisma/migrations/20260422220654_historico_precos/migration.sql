-- Normaliza GTIN inválido: string vazia e "0" viram NULL para que a chave parcial
-- (ean, cnpj) não agrupe produtos distintos sob um GTIN ausente.
UPDATE "precos" SET "ean" = NULL WHERE "ean" = '' OR "ean" = '0';

-- Cria a tabela de histórico sem FK ainda, para permitir o backfill antes
-- da dedup em "precos".
CREATE TABLE "precos_historico" (
    "id" SERIAL NOT NULL,
    "precoId" INTEGER NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "dataColeta" TIMESTAMP(3) NOT NULL,
    "fonte" "Fonte" NOT NULL DEFAULT 'api',
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precos_historico_pkey" PRIMARY KEY ("id")
);

-- Tabela auxiliar de mapeamento (não-temp para sobreviver entre statements).
-- Será removida ao final desta migration.
CREATE TABLE "_migracao_preco_map" (
    id_antigo INTEGER NOT NULL,
    id_sobrevivente INTEGER NOT NULL
);

-- Mapa id_antigo → id_sobrevivente por chave natural. Sobrevivente é a linha
-- mais recente (maior dataColeta, desempate pelo maior id).
INSERT INTO "_migracao_preco_map" (id_antigo, id_sobrevivente)
WITH ranked_com_ean AS (
    SELECT id, FIRST_VALUE(id) OVER (
        PARTITION BY "ean", "cnpj"
        ORDER BY "dataColeta" DESC, id DESC
    ) AS id_sobrevivente
    FROM "precos"
    WHERE "ean" IS NOT NULL
),
ranked_sem_ean AS (
    SELECT id, FIRST_VALUE(id) OVER (
        PARTITION BY "produto", "cnpj", "mercado"
        ORDER BY "dataColeta" DESC, id DESC
    ) AS id_sobrevivente
    FROM "precos"
    WHERE "ean" IS NULL
)
SELECT id, id_sobrevivente FROM ranked_com_ean
UNION ALL
SELECT id, id_sobrevivente FROM ranked_sem_ean;

-- Backfill do histórico: todas as linhas atuais viram pontos históricos
-- apontando para a linha sobrevivente da mesma chave natural.
INSERT INTO "precos_historico" ("precoId", "preco", "dataColeta", "fonte", "registradoEm")
SELECT m.id_sobrevivente, p."preco", p."dataColeta", p."fonte", p."criadoEm"
FROM "precos" p
JOIN "_migracao_preco_map" m ON m.id_antigo = p.id;

-- Remove duplicatas de "precos", mantendo apenas a linha sobrevivente.
DELETE FROM "precos"
WHERE id IN (
    SELECT id_antigo FROM "_migracao_preco_map" WHERE id_antigo <> id_sobrevivente
);

-- Limpeza da tabela auxiliar.
DROP TABLE "_migracao_preco_map";

-- Colunas novas em precos.
ALTER TABLE "precos"
    ADD COLUMN "precoAnterior" DECIMAL(10,2),
    ADD COLUMN "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Unique parciais: Prisma DSL não expressa UNIQUE com WHERE, então criamos
-- diretamente aqui. São duas classes disjuntas (ean presente vs ausente).
CREATE UNIQUE INDEX "precos_ean_cnpj_uk"
    ON "precos" ("ean", "cnpj") WHERE "ean" IS NOT NULL;

CREATE UNIQUE INDEX "precos_produto_cnpj_mercado_uk"
    ON "precos" ("produto", "cnpj", "mercado") WHERE "ean" IS NULL;

-- FK e índice de histórico.
ALTER TABLE "precos_historico"
    ADD CONSTRAINT "precos_historico_precoId_fkey"
    FOREIGN KEY ("precoId") REFERENCES "precos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "precos_historico_precoId_dataColeta_idx"
    ON "precos_historico" ("precoId", "dataColeta" DESC);
