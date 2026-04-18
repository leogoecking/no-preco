import { z } from 'zod';

export const LoginBodySchema = z.object({
  usuario: z.string().trim().min(1, { message: '"usuario" é obrigatório.' }),
  senha: z.string().min(1, { message: '"senha" é obrigatória.' }),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;
