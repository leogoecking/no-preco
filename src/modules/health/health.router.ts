import { Router } from 'express';
import { ping } from './health.controller';

export const healthRouter = Router();

healthRouter.get('/ping', ping);
