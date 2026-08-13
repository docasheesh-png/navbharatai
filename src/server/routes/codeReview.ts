import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { workspaceRateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring, vnumber, vboolean } from '../lib/validate';
import { codeReviewStore, buildComment, buildReply } from '../lib/CodeReviewStore';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';

/**
 * The one gate every route in this file goes through: a VERIFIED identity that OWNS the named
 * workspace. Returns the workspace id when the caller may have it, or null after answering.
 *
 * Written once, on purpose. Four routes each doing their own check is four chances to write three of
 * them — which is exactly how this file ended up with an ownership check in none of them.
 */
async function ownedWorkspace(req: Request, res: Response, action: string): Promise<{ uid: string; workspaceId: string } | null> {
  const uid = await verifyFirebaseToken(req);
  if (!uid) { res.status(401).json({ error: `Sign in to ${action}.` }); return null; }
  const workspaceId = String(req.params.workspaceId || '');
  if (!ownedByVerifiedUid(uid, workspaceId)) {
    // 404, not 403 — see the header. Confirming the id exists is half of what a prober wants.
    res.status(404).json({ error: 'Workspace not found.' });
    return null;
  }
  // The uid rides along so the two authoring routes do not verify the same token twice.
  return { uid, workspaceId };
}

/**
 * P-DEV.11 — Inline Code Review comments (file+line anchored, resolve + reply).
 *
 *   GET   /api/workspace/:workspaceId/review                      — list comments
 *   POST  /api/workspace/:workspaceId/review   { file, line, body } — add a comment
 *   POST  /api/workspace/:workspaceId/review/:id/resolve { resolved } — resolve / reopen
 *   POST  /api/workspace/:workspaceId/review/:id/reply   { body }   — reply to a thread
 *
 * Requires a signed-in user WHO OWNS THE WORKSPACE. Rate-limited + request-validated; persistence is
 * best-effort.
 *
 * SECURITY FIX (paid-surface audit, admin 2026-08-12). Every route here used to check only that
 * SOMEBODY was signed in, then take the workspace id straight from the URL. Being signed in says who
 * you are; it says nothing about whose workspace you just named. So any authenticated user could
 * read — and WRITE — review comments on any workspace whose id they knew, which is the textbook IDOR
 * the constitution's rule-3 sibling hunt exists to catch.
 *
 * `ownedByVerifiedUid` is the repo's existing answer (already used by appDebug and nbaiDomains); this
 * file simply never called it. A 404 rather than a 403 is deliberate: telling a stranger "that
 * workspace exists, but it isn't yours" confirms the id, which is half of what they came for.
 */
const addSchema = vobject({ file: vstring({ min: 1, max: 1000 }), line: vnumber({ int: true, min: 0 }), body: vstring({ min: 1, max: 5000 }) });
const resolveSchema = vobject({ resolved: vboolean() });
const replySchema = vobject({ body: vstring({ min: 1, max: 5000 }) });

export function registerCodeReviewRoutes(app: Express): void {
  app.get('/api/workspace/:workspaceId/review', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const owned = await ownedWorkspace(req, res, 'view review comments');
    if (!owned) return;
    const items = await codeReviewStore.list(owned.workspaceId);
    res.json({ comments: items });
  });

  app.post('/api/workspace/:workspaceId/review', workspaceRateLimiter(), validateBody(addSchema), async (req: Request, res: Response) => {
    const owned = await ownedWorkspace(req, res, 'add a review comment');
    if (!owned) return;
    const { file, line, body } = req.body as { file: string; line: number; body: string };
    const comment = buildComment({
      id: crypto.randomBytes(9).toString('base64url'),
      workspaceId: owned.workspaceId, file, line, body, author: owned.uid, now: Date.now(),
    });
    if (!comment) { res.status(400).json({ error: 'A file, a non-negative line, and a non-empty comment are required.' }); return; }
    const ok = await codeReviewStore.add(comment);
    if (!ok) { res.status(503).json({ error: 'Could not save the comment (storage unavailable).' }); return; }
    res.status(201).json({ comment });
  });

  app.post('/api/workspace/:workspaceId/review/:id/resolve', workspaceRateLimiter(), validateBody(resolveSchema), async (req: Request, res: Response) => {
    const owned = await ownedWorkspace(req, res, 'resolve a comment');
    if (!owned) return;
    const { resolved } = req.body as { resolved: boolean };
    const ok = await codeReviewStore.resolve(owned.workspaceId, String(req.params.id || ''), resolved);
    if (!ok) { res.status(404).json({ error: 'Comment not found.' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/workspace/:workspaceId/review/:id/reply', workspaceRateLimiter(), validateBody(replySchema), async (req: Request, res: Response) => {
    const owned = await ownedWorkspace(req, res, 'reply');
    if (!owned) return;
    const reply = buildReply({ author: owned.uid, body: (req.body as { body: string }).body, now: Date.now() });
    if (!reply) { res.status(400).json({ error: 'A non-empty reply is required.' }); return; }
    const ok = await codeReviewStore.reply(owned.workspaceId, String(req.params.id || ''), reply);
    if (!ok) { res.status(404).json({ error: 'Comment not found.' }); return; }
    res.status(201).json({ reply });
  });
}
