import { Router } from 'express';
import { login } from './auth.controller';
import { validateBody } from '../../shared/validation/validate';
import { LoginBodySchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post('/auth/login', validateBody(LoginBodySchema), login);
