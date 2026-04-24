import jwt from 'jsonwebtoken';
import { login } from '../modules/auth/auth.controller';
import { Request, Response } from 'express';

function makeReq(body: object): Request {
  return { body } as Request;
}

function makeRes(): Response & { status: jest.Mock; json: jest.Mock } {
  const res = {} as Response & { status: jest.Mock; json: jest.Mock };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth.controller — login', () => {
  const ENV_BACKUP = process.env;

  beforeEach(() => {
    process.env = {
      ...ENV_BACKUP,
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'senha123',
      JWT_SECRET: 'segredo-de-teste',
    };
  });

  afterEach(() => {
    process.env = ENV_BACKUP;
  });

  it('retorna 401 quando as credenciais são inválidas', () => {
    const res = makeRes();
    login(makeReq({ usuario: 'admin', senha: 'errada' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ erro: 'Credenciais inválidas' });
  });

  it('retorna 401 quando o usuário não confere', () => {
    const res = makeRes();
    login(makeReq({ usuario: 'outro', senha: 'senha123' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('retorna 200 com token JWT válido para credenciais corretas', () => {
    const res = makeRes();
    login(makeReq({ usuario: 'admin', senha: 'senha123' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const { token } = res.json.mock.calls[0][0] as { token: string };
    expect(typeof token).toBe('string');
    const payload = jwt.verify(token, 'segredo-de-teste') as { usuario: string };
    expect(payload.usuario).toBe('admin');
  });

  it('retorna 500 quando variáveis de ambiente estão ausentes', () => {
    delete process.env.JWT_SECRET;
    const res = makeRes();
    login(makeReq({ usuario: 'admin', senha: 'senha123' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ erro: expect.stringContaining('autenticação') }),
    );
  });
});
