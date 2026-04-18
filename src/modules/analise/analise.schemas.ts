import { z } from 'zod';

const ItemCarrinhoSchema = z.object({
  produto: z.string().trim().min(1).max(100),
  quantidade: z.coerce.number().positive().default(1),
});

export const CarrinhoGetQuerySchema = z.object({
  municipio: z.string().trim().max(100).optional(),
  itens: z.string().trim().min(1, { message: 'Parâmetro "itens" obrigatório.' }),
});

export type CarrinhoGetQuery = z.infer<typeof CarrinhoGetQuerySchema>;

export const CarrinhoPostBodySchema = z.object({
  municipio: z.string().trim().max(100).optional(),
  itens: z
    .array(ItemCarrinhoSchema)
    .min(1, { message: 'O campo "itens" deve ser um array não vazio.' })
    .max(50, { message: 'Máximo de 50 itens por análise.' }),
});

export type CarrinhoPostBody = z.infer<typeof CarrinhoPostBodySchema>;
