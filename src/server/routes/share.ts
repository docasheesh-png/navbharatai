import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { audit } from '../lib/audit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import {
  buildShareRecord,
  buildFeedback,
  isShareValid,
  saveShare,
  getShare,
  revokeShare,
  addFeedback,
  listFeedback,
  effectiveMaxHtml,
  isShareStorageConfigured,
} from '../lib/ShareStore';

/**
 * Client / Stakeholder Share Portal + Feedback (P-COLLAB.3).
 *
 * An owner shares a BUILT app read-only with a non-member via a token link; the client opens
 * `/?review=<token>`, sees the app rendered in a sandboxed iframe, and leaves feedback/approval — no
 * account needed. Owner-only endpoints (create/revoke/list-feedback) verify the caller's Firebase ID
 * token; the resolve + feedback endpoints are public (the token is the capability).
 *
 *   POST /api/share                     — owner creates a read-only share of the current app.
 *   GET  /api/share/:token              — resolve a share (public) → title + html to render.
 *   POST /api/share/:token/feedback     — client leaves feedback/approval (public).
 *   GET  /api/share/:token/feedback     — owner lists collected feedback.
 *   POST /api/share/:token/revoke       — owner revokes the share (link stops working).
 */
export function registerShareRoutes(app: Express): void {
  // Create a read-only share of the current app (authenticated owner only).
  app.post('/api/share', async (req: Request, res: Response) => {
    const ownerId = await verifyFirebaseToken(req);
    if (!ownerId) return res.status(401).json({ error: 'Sign in to share your app.' });

    const { title, html } = req.body || {};
    if (typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'Nothing to share yet — build an app first.' });
    }
    // Honest cap: with a Storage bucket, large snapshots offload there (up to MAX_HTML); without one the
    // inline Firestore-safe limit is the real ceiling. Reject oversize rather than truncate a runnable
    // app into a broken one.
    const maxHtml = effectiveMaxHtml(isShareStorageConfigured());
    if (html.length > maxHtml) {
      return res.status(413).json({ error: `App is too large to share (max ${Math.round(maxHtml / 1000)} KB).` });
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const share = buildShareRecord({ token, ownerId, title, html, now: Date.now() });
    const persisted = await saveShare(share);
    audit('SHARE_CREATED', { ownerId, token, persisted });

    return res.json({
      ok: true,
      token,
      url: `/?review=${token}`,
      persisted,
      message: persisted ? 'Read-only review link created — share it with your client.' : 'Link created (not yet persisted — Firestore unavailable).',
    });
  });

  // Resolve a share for the read-only viewer (public — the token is the capability).
  app.get('/api/share/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!token) return res.status(400).json({ valid: false, error: 'token required' });
    const share = await getShare(token);
    if (!share) return res.status(404).json({ valid: false, error: 'This shared app is not available.' });
    if (!isShareValid(share, Date.now())) {
      return res.status(410).json({ valid: false, error: share.status === 'revoked' ? 'This share was revoked.' : 'This share has expired.' });
    }
    return res.json({ valid: true, title: share.title, html: share.html });
  });

  // Leave feedback/approval on a shared app (public — clients aren't members).
  app.post('/api/share/:token/feedback', async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    const share = await getShare(token);
    if (!isShareValid(share, Date.now())) {
      return res.status(410).json({ error: 'This share is no longer accepting feedback.' });
    }
    const { rating, comment, name } = req.body || {};
    const record = buildFeedback({ rating, comment, name, now: Date.now() });
    const saved = await addFeedback(token, record);
    audit('SHARE_FEEDBACK', { token, rating: record.rating, saved });
    return res.json({ ok: saved, rating: record.rating, message: saved ? 'Thanks for your feedback!' : 'Could not record feedback right now.' });
  });

  // List collected feedback (owner of the share only).
  app.get('/api/share/:token/feedback', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Authentication required.' });
    const token = String(req.params.token || '');
    const share = await getShare(token);
    if (share && share.ownerId && share.ownerId !== uid) {
      return res.status(403).json({ error: 'Only the share owner can view its feedback.' });
    }
    const feedback = await listFeedback(token);
    return res.json({ feedback });
  });

  // Revoke a share (owner only) — the link stops working immediately.
  app.post('/api/share/:token/revoke', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Authentication required.' });
    const token = String(req.params.token || '');
    const share = await getShare(token);
    if (share && share.ownerId && share.ownerId !== uid) {
      return res.status(403).json({ error: 'Only the share owner can revoke it.' });
    }
    await revokeShare(token);
    audit('SHARE_REVOKED', { token, uid });
    return res.json({ ok: true });
  });
}
