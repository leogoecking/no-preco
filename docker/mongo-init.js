/**
 * Script de inicialização do MongoDB.
 * Executado uma única vez quando o container é criado pela primeira vez.
 *
 * Cria um usuário com acesso restrito ao banco da aplicação,
 * separado do usuário root definido pelas variáveis de ambiente.
 */

// As variáveis abaixo são injetadas pelo docker-compose via MONGO_INITDB_*
const appUser = process.env.MONGO_APP_USER || 'no_preco_user';
const appPass = process.env.MONGO_APP_PASSWORD || 'no_preco_pass';
const dbName  = process.env.MONGO_INITDB_DATABASE || 'no-preco';

db = db.getSiblingDB(dbName);

db.createUser({
  user: appUser,
  pwd:  appPass,
  roles: [
    { role: 'readWrite', db: dbName },
  ],
});

// Cria índices iniciais antecipando o uso do Mongoose
// (o Mongoose também os cria, mas tê-los aqui acelera o primeiro boot)
db.createCollection('precos');

db.precos.createIndex({ produto: 1 });
db.precos.createIndex({ dataColeta: -1 });
db.precos.createIndex({ produto: 1, dataColeta: -1 });

print(`[mongo-init] Banco "${dbName}" e usuário "${appUser}" criados com sucesso.`);
