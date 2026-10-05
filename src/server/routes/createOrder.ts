import type { Express, Request, Response } from 'express';

/** Legacy `/api/create-order` endpoint — retired (see below). The payment flow lives in routes/payment.ts. */
export function registerCreateOrderRoute(app: Express): void {
  // 🔒 RETIRED (forensic audit 2026-10-04). This older order creator took `userId` and the amount from the
  // request body with no sign-in, and called `Cashfree.PGCreateOrder` — a method the installed SDK does not
  // have, so every call failed and echoed the error. No client calls it (the app uses
  // POST /api/payment/create-order, which verifies the caller). It answers 410 like every retired route.
  app.post('/api/create-order', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'This endpoint was retired. Use /api/payment/create-order.' });
  });
}
