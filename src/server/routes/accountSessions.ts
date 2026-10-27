import type { Express, Request } from 'express';
import { getAdminAuthForSessions, verifyFirebaseSession, type SessionVerification } from '../lib/authMiddleware';
import { revokeAccountSessions, sessionRevocationStore } from '../lib/sessionRevocation';

/** Bearer-only, no ambient cookie credentials. Existing CORS allowlist also gates browser preflight. */
export function registerAccountSessionRoutes(app: Express, deps = {
  verify: (req: Request) => verifyFirebaseSession(req),
  auth: getAdminAuthForSessions,
  store: sessionRevocationStore,
  revoke: revokeAccountSessions,
}): void {
  function failureStatus(result: SessionVerification): number {
    return result.reason === 'no-bearer' || ('invalid' in result && result.invalid) ? 401 : 503;
  }
  app.get('/api/auth/session', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await deps.verify(req);
      if (!result.token) return res.status(failureStatus(result)).json({ ok: false, code: 'session-unavailable' });
      return res.json({ ok: true });
    } catch {
      return res.status(503).json({ ok: false, code: 'session-unavailable' });
    }
  });

  app.post('/api/auth/sessions/revoke', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // No target UID or admin override exists. Reject unrecognized fields rather than silently
    // accepting a body that appears to request another account's logout.
    if (!req.is('application/json') || !req.body || req.body.confirm !== true
      || Object.keys(req.body).length !== 1) {
      return res.status(400).json({ ok: false, code: 'confirmation-required' });
    }
    try {
      const session = await deps.verify(req);
      if (!session.token) return res.status(failureStatus(session)).json({ ok: false, code: 'session-unavailable' });
      const result = await deps.revoke(session.token.uid, session.token.auth_time, await deps.auth(), deps.store());
      return res.status(result.ok ? 200 : result.status).json(result);
    } catch {
      return res.status(503).json({ ok: false, code: 'revocation-unconfirmed' });
    }
  });
}
