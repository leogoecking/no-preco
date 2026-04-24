import { z } from 'zod';

export const BuscarQuerySchema = z
  .object({
    produto: z.string().trim().min(1).max(100).optional(),
    termo: z.string().trim().min(1).max(100).optional(),
    cidade: z.string().trim().max(100).optional(),
    municipio: z.string().trim().max(100).optional(),
    dias: z.coerce.number().int().min(1).max(90).default(7),
    limite: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((d) => d.produto || d.termo, {
    message: 'Parâmetro "produto" é obrigatório.',
    path: ['produto'],
  });

export type BuscarQuery = z.infer<typeof BuscarQuerySchema>;

export const BuscarEanParamsSchema = z.object({
  ean: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/, {
      message: 'EAN/GTIN inválido. Deve conter 8, 12, 13 ou 14 dígitos numéricos.',
    }),
});

export const BuscarEanQuerySchema = z.object({
  cidade: z.string().trim().max(100).optional(),
  municipio: z.string().trim().max(100).optional(),
});

export type BuscarEanQuery = z.infer<typeof BuscarEanQuerySchema>;

export const HistoricoQuerySchema = z.object({
  produto: z.string().trim().min(1, { message: 'Parâmetro "produto" é obrigatório.' }).max(100),
  municipio: z.string().trim().max(100).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  dataInicio: z
    .string()
    .datetime({ message: 'Parâmetro "dataInicio" é uma data inválida.' })
    .optional(),
  dataFim: z.string().datetime({ message: 'Parâmetro "dataFim" é uma data inválida.' }).optional(),
});

export type HistoricoQuery = z.infer<typeof HistoricoQuerySchema>;

export const StatsBodySchema = z.object({
  produtos: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  municipio: z.string().trim().max(100).optional(),
});

export type StatsBody = z.infer<typeof StatsBodySchema>;
