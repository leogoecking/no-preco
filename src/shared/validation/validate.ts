import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';

function formatErrors(err: ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ erro: 'Parâmetros inválidos', detalhes: formatErrors(result.error) });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.query = result.data as any;
    next();
  };
}

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ erro: 'Body inválido', detalhes: formatErrors(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res
        .status(400)
        .json({ erro: 'Parâmetros de rota inválidos', detalhes: formatErrors(result.error) });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.params = result.data as any;
    next();
  };
}
