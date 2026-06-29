import type { Express, Request, Response } from 'express';
import { listWebhooks, addWebhook, removeWebhook, fireWebhooks, WEBHOOK_EVENTS } from '../WebhookManager';
import { requireUserMatch } from '../lib/authMiddleware';
import { validateBody, vobject, vstring, varray } from '../lib/validate';

/**
 * P-PME.9 — per-user webhook management.
 *
 *   GET    /api/webhooks/:userId          — list the user's webhooks
 *   POST   /api/webhooks/:userId          — register one { url, events? }
 *   DELETE /api/webhooks/:userId/:id      — remove one
 *   POST   /api/webhooks/:userId/test     — fire a test event to all subscribed webhooks
 *
 * All scoped to the authenticated user (requireUserMatch). Bodies are request-validated (P-DATA.1).
 */
const addSchema = vobject({
  url: vstring({ min: 1, max: 2048 }),
  events: varray(vstring(), { optional: true }),
});

export function registerWebhookRoutes(app: Express): void {
  app.get('/api/webhooks/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    res.json({ webhooks: await listWebhooks(req.params.userId), events: WEBHOOK_EVENTS });
  });

  app.post('/api/webhooks/:userId', requireUserMatch('userId'), validateBody(addSchema), async (req: Request, res: Response) => {
    const { url, events } = req.body as { url: string; events?: string[] };
    const result = await addWebhook(req.params.userId, url, events, new Date().toISOString());
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    res.json({ ok: true, webhook: result.webhook });
  });

  app.delete('/api/webhooks/:userId/:id', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const removed = await removeWebhook(req.params.userId, req.params.id);
    if (!removed) { res.status(404).json({ error: 'Webhook not found.' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/webhooks/:userId/test', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const result = await fireWebhooks(req.params.userId, 'BUILD_COMPLETE', {
      test: true, message: 'NavBharatAI test webhook', timestamp: new Date().toISOString(),
    });
    res.json({ ok: true, ...result });
  });
}
