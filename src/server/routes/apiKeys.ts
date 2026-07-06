// U-7 (foundation) — public API-key management + a key-gated v1 endpoint.
//
// Management routes (POST/GET/DELETE /api/keys) authenticate with the user's Firebase token — a user
// manages only their OWN keys. The v1 data route (GET /api/v1/me) authenticates with an API KEY and
// enforces a scope, so keys actually DO something end-to-end (create a key → call /api/v1/me with it).
//
// The plaintext key is returned exactly ONCE, at creation. Only its hash is stored.

import type { Express, Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { userProfileStore } from '../lib/UserProfileStore';
import { userCostStore } from '../lib/UserCostStore';
import {
  generateApiKey, hashApiKey, normalizeScopes, extractApiKey, hasScope, API_SCOPES, type ApiScope,
} from '../lib/ApiKeyManager';
import { apiKeyStore } from '../lib/ApiKeyStore';

/** Auth context attached to a request authenticated by an API key. */
interface ApiKeyContext { userId: string; keyId: string; scopes: string[]; }

/** Middleware: authenticate a request by its API key and attach the resolved context. */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const presented = extractApiKey({
    'x-api-key': req.headers['x-api-key'],
    authorization: req.headers['authorization'],
  });
  if (!presented) {
    res.status(401).json({ error: 'API key required. Send it as X-API-Key or Authorization: Bearer nbai_…' });
    return;
  }
  apiKeyStore.findByHash(hashApiKey(presented)).then((auth) => {
    if (!auth) {
      res.status(401).json({ error: 'Invalid or revoked API key.' });
      return;
    }
    (req as Request & { apiAuth?: ApiKeyContext }).apiAuth = auth;
    void apiKeyStore.touchLastUsed(auth.keyId); // best-effort, don't await
    next();
  }).catch(() => {
    res.status(500).json({ error: 'API key verification failed.' });
  });
}

/** Guard that the authenticated key carries a required scope. */
function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = (req as Request & { apiAuth?: ApiKeyContext }).apiAuth;
    if (!auth || !hasScope(auth.scopes, scope)) {
      res.status(403).json({ error: `This key is missing the required scope: ${scope}` });
      return;
    }
    next();
  };
}

export function registerApiKeyRoutes(app: Express): void {
  // ── Create a key (Firebase-authenticated) — returns the plaintext ONCE ──
  app.post('/api/keys', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const name = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim().slice(0, 60) : 'Untitled key';
    const scopes = normalizeScopes(req.body?.scopes);
    if (scopes.length === 0) {
      return res.status(400).json({ error: `At least one valid scope is required. Allowed: ${API_SCOPES.join(', ')}` });
    }

    const key = generateApiKey();
    const ok = await apiKeyStore.create({
      id: key.id,
      userId,
      name,
      hash: key.hash,
      displayPrefix: key.displayPrefix,
      last4: key.last4,
      scopes,
      createdAt: Date.now(),
      lastUsedAt: null,
      revoked: false,
    });
    if (!ok) return res.status(503).json({ error: 'Could not store the key. Please try again.' });

    // The ONLY time the plaintext is ever returned.
    return res.status(201).json({
      id: key.id, name, scopes,
      key: key.plaintext,
      displayPrefix: key.displayPrefix, last4: key.last4,
      warning: 'Copy this key now — it will not be shown again.',
    });
  });

  // ── List own keys (metadata only, no secret) ──
  app.get('/api/keys', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const keys = await apiKeyStore.listForUser(userId);
    return res.json({ keys, availableScopes: API_SCOPES });
  });

  // ── Revoke a key (ownership enforced in the store) ──
  app.delete('/api/keys/:id', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const revoked = await apiKeyStore.revoke(userId, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'Key not found or not yours.' });
    return res.json({ ok: true, id: req.params.id });
  });

  // ── v1 data endpoint — authenticated by API KEY + scope. Proves keys work end-to-end. ──
  // Registered at /api/me; clients call the canonical /api/v1/me, which apiVersionMiddleware
  // rewrites to /api/me before routing (the unversioned path also works as the deprecated shim).
  app.get('/api/me', apiKeyAuth, requireScope('read:profile'), async (req: Request, res: Response) => {
    const auth = (req as Request & { apiAuth?: ApiKeyContext }).apiAuth!;
    const [profile, usage] = await Promise.all([
      userProfileStore.get(auth.userId),
      userCostStore.get(auth.userId),
    ]);
    return res.json({
      userId: auth.userId,
      displayName: profile?.displayName ?? '',
      scopes: auth.scopes,
      monthlyAiSpend: usage ?? { month: new Date().toISOString().slice(0, 7), totalBuilds: 0, totalCostUsd: 0 },
    });
  });
}
