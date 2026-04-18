import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { LoginBody } from './auth.schemas';

export function login(req: Request, res: Response): void {
  const { usuario, senha } = req.body as LoginBody;

  const adminUser = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!adminUser || !adminPassword || !secret) {
    res.status(500).json({ erro: 'Configuração de autenticação ausente no servidor' });
    return;
  }

  if (usuario !== adminUser || senha !== adminPassword) {
    res.status(401).json({ erro: 'Credenciais inválidas' });
    return;
  }

  const token = jwt.sign({ usuario }, secret, { expiresIn: '8h' });
  res.status(200).json({ token });
}
