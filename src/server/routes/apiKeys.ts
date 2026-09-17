// THE NAVBHARATAI API — key management, and the scope-gated `/api/v1/me`.
//
// Management routes (POST/GET/PATCH/DELETE /api/keys) authenticate with the user's Firebase token — a
// user manages only their OWN keys. The v1 data routes authenticate with an API KEY and enforce a scope,
// so a key actually DOES something end to end. The plaintext key is returned exactly ONCE, at
// creation; only its hash is stored.
//
// 🔴 REBUILT 2026-09-17 (admin: "api keys farzi nahi ho, kam kare"). Until this date two of the three
// scopes a user could tick were required by NOTHING, and `/api/v1/me` handed out monthly usage to any
// key that merely had `read:profile` — so the scopes were neither a control nor a contract. Now every
// scope guards a real door (developerApi.ts, `SCOPE_ROUTES`), `/me` respects the usage scope, and each
// key carries the daily ₹ cap that makes a leaked key survivable. The other v1 routes live in
// `developerApi.ts`; this file keeps the key lifecycle and the middleware they share.

import type { Express, Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { userProfileStore } from '../lib/UserProfileStore';
import { userCostStore } from '../lib/UserCostStore';
import {
  generateApiKey, hashApiKey, normalizeScopes, extractApiKey, hasScope, API_SCOPES, API_SCOPE_DESCRIPTIONS,
  type ApiScope,
} from '../lib/ApiKeyManager';
import { apiKeyStore } from '../lib/ApiKeyStore';
import { apiKeyUsageStore } from '../lib/ApiKeyUsageStore';
import {
  normalizeDailyCapInr, keyDayKey, apiError, DEFAULT_KEY_DAILY_CAP_INR, MAX_KEY_DAILY_CAP_INR, SCOPE_ROUTES,
} from '../lib/developerApi';
import { routeParam } from '../lib/expressCompat';

/** Auth context attached to a request authenticated by an API key. */
export interface ApiKeyContext { userId: string; keyId: string; scopes: string[]; dailyCapInr?: number }

/** Middleware: authenticate a request by its API key and attach the resolved context. */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const presented = extractApiKey({
    'x-api-key': req.headers['x-api-key'],
    authorization: req.headers['authorization'],
  });
  if (!presented) {
    res.status(401).json(apiError('invalid_request', 'API key required. Send it as X-API-Key or Authorization: Bearer nbai_…'));
    return;
  }
  apiKeyStore.findByHash(hashApiKey(presented)).then((auth) => {
    if (!auth) {
      res.status(401).json(apiError('invalid_request', 'Invalid or revoked API key.'));
      return;
    }
    (req as Request & { apiAuth?: ApiKeyContext }).apiAuth = auth;
    void apiKeyStore.touchLastUsed(auth.keyId); // best-effort, don't await
    next();
  }).catch(() => {
    res.status(500).json(apiError('engine_unavailable', 'API key verification failed. Please try again.'));
  });
}

/** Guard that the authenticated key carries a required scope. */
export function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = (req as Request & { apiAuth?: ApiKeyContext }).apiAuth;
    if (!auth || !hasScope(auth.scopes, scope)) {
      res.status(403).json(apiError('missing_scope', `This key is missing the required scope: ${scope}. Edit the key on the Developer Tools page to grant it.`, { scope }));
      return;
    }
    next();
  };
}

/** The key context a v1 handler reads after `apiKeyAuth` ran. */
export function apiAuthOf(req: Request): ApiKeyContext {
  return (req as Request & { apiAuth?: ApiKeyContext }).apiAuth!;
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
    const dailyCapInr = normalizeDailyCapInr(req.body?.dailyCapInr);

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
      dailyCapInr,
    });
    if (!ok) return res.status(503).json({ error: 'Could not store the key. Please try again.' });

    // The ONLY time the plaintext is ever returned.
    return res.status(201).json({
      id: key.id, name, scopes, dailyCapInr,
      key: key.plaintext,
      displayPrefix: key.displayPrefix, last4: key.last4,
      warning: 'Copy this key now — it will not be shown again.',
    });
  });

  // ── List own keys (metadata only, no secret) + today's use of each, and what a scope means ──
  app.get('/api/keys', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const keys = await apiKeyStore.listForUser(userId);
    const day = keyDayKey(Date.now());
    const usage = await apiKeyUsageStore.spentTodayForKeys(keys.filter((k) => !k.revoked).map((k) => k.id), day);
    return res.json({
      keys: keys.map((k) => {
        const today = usage.get(k.id);
        return {
          ...k,
          dailyCapInr: typeof k.dailyCapInr === 'number' ? k.dailyCapInr : DEFAULT_KEY_DAILY_CAP_INR,
          // `null` = not measured (unreadable), never a confident zero — the same rule the admin
          // badges follow. The screen shows nothing for null and "₹0 today" only for a real zero.
          todaySpentInr: today ? Math.round(today.spentInr * 100) / 100 : null,
          todayCalls: today ? today.calls : null,
        };
      }),
      availableScopes: API_SCOPES,
      scopeDescriptions: API_SCOPE_DESCRIPTIONS,
      scopeRoutes: SCOPE_ROUTES,
      dailyCap: { default: DEFAULT_KEY_DAILY_CAP_INR, max: MAX_KEY_DAILY_CAP_INR },
      day,
    });
  });

  // ── Edit a live key: name, scopes, daily cap (ownership enforced in the store) ──
  app.patch('/api/keys/:id', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const patch: { name?: string; scopes?: string[]; dailyCapInr?: number } = {};
    if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim().slice(0, 60);
    if (req.body?.scopes !== undefined) {
      const scopes = normalizeScopes(req.body.scopes);
      if (scopes.length === 0) return res.status(400).json({ error: 'A key needs at least one scope.' });
      patch.scopes = scopes;
    }
    if (req.body?.dailyCapInr !== undefined) patch.dailyCapInr = normalizeDailyCapInr(req.body.dailyCapInr);
    const ok = await apiKeyStore.update(userId, routeParam(req.params.id), patch);
    if (!ok) return res.status(404).json({ error: 'Key not found, not yours, or already revoked.' });
    return res.json({ ok: true, id: routeParam(req.params.id), ...patch });
  });

  // ── Revoke a key (ownership enforced in the store) ──
  app.delete('/api/keys/:id', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const revoked = await apiKeyStore.revoke(userId, routeParam(req.params.id));
    if (!revoked) return res.status(404).json({ error: 'Key not found or not yours.' });
    return res.json({ ok: true, id: routeParam(req.params.id) });
  });

  // ── v1: who am I — authenticated by API KEY + scope. ──
  // Registered at /api/me; clients call the canonical /api/v1/me, which apiVersionMiddleware
  // rewrites to /api/me before routing (the unversioned path also works as the deprecated shim).
  //
  // 🔒 USAGE RIDES ALONG ONLY WHEN THE KEY MAY READ USAGE. Until 2026-09-17 this route returned
  // `monthlyAiSpend` to every key with `read:profile`, which made `read:usage` a label rather than a
  // permission. A scope the user did not grant must not be granted by a different door.
  app.get('/api/me', apiKeyAuth, requireScope('read:profile'), async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const canReadUsage = hasScope(auth.scopes, 'read:usage');
    const [profile, usage] = await Promise.all([
      userProfileStore.get(auth.userId),
      canReadUsage ? userCostStore.get(auth.userId) : Promise.resolve(null),
    ]);
    return res.json({
      userId: auth.userId,
      displayName: profile?.displayName ?? '',
      scopes: auth.scopes,
      ...(canReadUsage
        ? { monthlyAiSpend: usage ?? { month: new Date().toISOString().slice(0, 7), totalBuilds: 0, totalCostUsd: 0 } }
        : {}),
    });
  });
}
