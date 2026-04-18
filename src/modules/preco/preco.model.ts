import { Schema, model, Document, Model } from 'mongoose';

// ─────────────────────────────────────────────
// Interface do documento (tipagem TypeScript)
// ─────────────────────────────────────────────

export interface IPreco {
  produto: string;
  preco: number;
  mercado: string;
  cnpj: string;
  cidade: string;
  municipio?: string;
  unidade?: string;
  dataColeta: Date;
  /** Rastreabilidade: via qual estratégia foi coletado */
  fonte: 'api' | 'html';
}

export type PrecoDocument = IPreco & Document;

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

const precoSchema = new Schema<IPreco>(
  {
    produto: {
      type: String,
      required: true,
      trim: true,
      // Normaliza para minúsculo na gravação — facilita buscas case-insensitive
      set: (v: string): string => v.toLowerCase().trim(),
    },
    preco: {
      type: Number,
      required: true,
      min: 0,
    },
    mercado: {
      type: String,
      required: true,
      trim: true,
    },
    cnpj: {
      type: String,
      required: true,
      trim: true,
    },
    cidade: {
      type: String,
      required: true,
      trim: true,
      set: normalizarCidade,
    },
    municipio: {
      type: String,
      trim: true,
    },
    unidade: {
      type: String,
      trim: true,
    },
    dataColeta: {
      type: Date,
      required: true,
      default: (): Date => new Date(),
    },
    fonte: {
      type: String,
      enum: ['api', 'html'],
      required: true,
    },
  },
  {
    // Adiciona createdAt e updatedAt automaticamente
    timestamps: true,
    // Evita salvar campos fora do schema
    strict: true,
    // Nome da collection no MongoDB
    collection: 'precos',
  },
);

// ─────────────────────────────────────────────
// Índices
// ─────────────────────────────────────────────

// Busca por nome de produto (query mais comum)
precoSchema.index({ produto: 1 });

// Filtro por cidade nas consultas públicas
precoSchema.index({ cidade: 1 });

// Ordenação cronológica decrescente
precoSchema.index({ dataColeta: -1 });

// Índice composto: histórico de um produto ordenado por data
// Cobre queries do tipo: db.precos.find({ produto }).sort({ dataColeta: -1 })
precoSchema.index({ produto: 1, dataColeta: -1 });

// Índice composto: busca por produto dentro da cidade, priorizando registros recentes
precoSchema.index({ cidade: 1, produto: 1, dataColeta: -1 });

// Índice composto: evita duplicatas exatas na mesma coleta (CNPJ + produto + data)
// sparse: true — não indexa documentos onde cnpj está ausente
precoSchema.index({ cnpj: 1, produto: 1, dataColeta: 1 }, { unique: false, sparse: true });

// ─────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────

export const PrecoModel: Model<IPreco> = model<IPreco>('Preco', precoSchema);

function normalizarCidade(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
