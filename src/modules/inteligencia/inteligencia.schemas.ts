import { z } from 'zod';

const csvList = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .optional();

export const EstatisticasQuerySchema = z.object({
  municipio: z.string().trim().max(100).optional(),
  dias: z.coerce.number().int().min(1).max(90).default(7),
  produtos: csvList,
});

export type EstatisticasQuery = z.infer<typeof EstatisticasQuerySchema>;

export const VolatilidadeQuerySchema = z.object({
  municipio: z.string().trim().max(100).optional(),
  dias: z.coerce.number().int().min(7).max(365).default(30),
  limite: z.coerce.number().int().min(1).max(50).default(20),
  minimoAmostras: z.coerce.number().int().min(2).max(30).default(5),
  produtos: csvList,
});

export type VolatilidadeQuery = z.infer<typeof VolatilidadeQuerySchema>;

export const AlertasQuerySchema = z.object({
  municipio: z.string().trim().max(100).optional(),
  variacaoLimiar: z.coerce.number().min(-100).max(-1).default(-5),
  produtos: csvList,
});

export type AlertasQuery = z.infer<typeof AlertasQuerySchema>;
