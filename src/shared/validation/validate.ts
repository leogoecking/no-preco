import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodTypeAny, ZodError } from 'zod';

type Source = 'query' | 'body' | 'params';

const rotulos: Record<Source, string> = {
  query: 'Parâmetros inválidos',
  body: 'Body inválido',
  params: 'Parâmetros de rota inválidos',
};

const camposValidados: Record<Source, 'validatedQuery' | 'validatedBody' | 'validatedParams'> = {
  query: 'validatedQuery',
  body: 'validatedBody',
  params: 'validatedParams',
};

function formatErrors(err: ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

function validate(source: Source, schema: ZodTypeAny): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({ erro: rotulos[source], detalhes: formatErrors(result.error) });
      return;
    }
    // req.query e req.params têm tipos restritos (ParsedQs / ParamsDictionary);
    // só reassinalamos quando Express aceita sem cast (body) ou via cast controlado.
    if (source === 'body') {
      req.body = result.data;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req[source] = result.data as any;
    }
    req[camposValidados[source]] = result.data;
    next();
  };
}

export const validateQuery = (schema: ZodTypeAny): RequestHandler => validate('query', schema);
export const validateBody = (schema: ZodTypeAny): RequestHandler => validate('body', schema);
export const validateParams = (schema: ZodTypeAny): RequestHandler => validate('params', schema);
