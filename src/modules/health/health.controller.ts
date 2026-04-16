import { Request, Response } from 'express';
import { getHealthStatus } from './health.service';

export function ping(_req: Request, res: Response): void {
  const status = getHealthStatus();
  res.status(200).json(status);
}
