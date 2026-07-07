import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring, vnumber, vboolean } from '../lib/validate';
import { codeReviewStore, buildComment, buildReply } from '../lib/CodeReviewStore';

/**
 * P-DEV.11 — Inline Code Review comments (file+line anchored, resolve + reply).
 *
 *   GET   /api/workspace/:workspaceId/review                      — list comments
 *   POST  /api/workspace/:workspaceId/review   { file, line, body } — add a comment
 *   POST  /api/workspace/:workspaceId/review/:id/resolve { resolved } — resolve / reopen
 *   POST  /api/workspace/:workspaceId/review/:id/reply   { body }   — reply to a thread
 *
 * Requires a signed-in user. Rate-limited + request-validated; persistence is best-effort.
 */
const addSchema = vobject({ file: vstring({ min: 1, max: 1000 }), line: vnumber({ int: true, min: 0 }), body: vstring({ min: 1, max: 5000 }) });
const resolveSchema = vobject({ resolved: vboolean() });
const replySchema = vobject({ body: vstring({ min: 1, max: 5000 }) });

export function registerCodeReviewRoutes(app: Express): void {
  app.get('/api/workspace/:workspaceId/review', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Sign in to view review comments.' }); return; }
    const items = await codeReviewStore.list(String(req.params.workspaceId || ''));
    res.json({ comments: items });
  });

  app.post('/api/workspace/:workspaceId/review', workspaceRateLimiter(), validateBody(addSchema), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Sign in to add a review comment.' }); return; }
    const { file, line, body } = req.body as { file: string; line: number; body: string };
    const comment = buildComment({
      id: crypto.randomBytes(9).toString('base64url'),
      workspaceId: String(req.params.workspaceId || ''), file, line, body, author: uid, now: Date.now(),
    });
    if (!comment) { res.status(400).json({ error: 'A file, a non-negative line, and a non-empty comment are required.' }); return; }
    const ok = await codeReviewStore.add(comment);
    if (!ok) { res.status(503).json({ error: 'Could not save the comment (storage unavailable).' }); return; }
    res.status(201).json({ comment });
  });

  app.post('/api/workspace/:workspaceId/review/:id/resolve', workspaceRateLimiter(), validateBody(resolveSchema), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Sign in to resolve a comment.' }); return; }
    const { resolved } = req.body as { resolved: boolean };
    const ok = await codeReviewStore.resolve(String(req.params.workspaceId || ''), String(req.params.id || ''), resolved);
    if (!ok) { res.status(404).json({ error: 'Comment not found.' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/workspace/:workspaceId/review/:id/reply', workspaceRateLimiter(), validateBody(replySchema), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Sign in to reply.' }); return; }
    const reply = buildReply({ author: uid, body: (req.body as { body: string }).body, now: Date.now() });
    if (!reply) { res.status(400).json({ error: 'A non-empty reply is required.' }); return; }
    const ok = await codeReviewStore.reply(String(req.params.workspaceId || ''), String(req.params.id || ''), reply);
    if (!ok) { res.status(404).json({ error: 'Comment not found.' }); return; }
    res.status(201).json({ reply });
  });
}
