import { z } from 'zod';

export const DispararBodySchema = z.object({
  produto: z.string().trim().min(1).max(100).optional(),
  municipio: z.string().trim().max(100).optional(),
});

export type DispararBody = z.infer<typeof DispararBodySchema>;
