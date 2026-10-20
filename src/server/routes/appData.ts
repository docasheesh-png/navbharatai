// Public data API for one app's shared database.
//
// The public key identifies the workspace. A separately verified Firebase ID token is the caller
// identity; the store enforces row ownership and preserves unowned legacy rows for the app owner.
// Private app credentials must use the same trusted Firebase project, or a separately connected
// database/auth provider. Arbitrary claimed user ids and tokens from other projects are refused.

import { verifyFirebaseToken } from '../lib/authMiddleware';
import { BoundedCache } from '../lib/boundedCache';
import { addressRateKey } from '../lib/clientAddress';
import type { Express, Request, Response } from 'express';
import { getServerDb } from '../lib/serverDb';
import { sanitizeRecord, type SharedScalar } from '../lib/sharedData';
import { runSharedData, type SharedDb } from '../lib/sharedDataStore';
import { routeParam } from '../lib/expressCompat';

const WS_RE = /^agentv3-[A-Za-z0-9_-]{4,80}$/;
// Bounded (audit 2026-10-11): the old Map was CLEARED at 5,000 keys, which reset every caller's limit.
const hits = new BoundedCache<string, { n: number; reset: number }>({ maxEntries: 20_000, ttlMs: 60_000 });

function tooFast(ip: string, workspaceId: string, now: number): boolean {
  const key = `${ip}|${workspaceId}`;
  const row = hits.get(key, now);
  if (!row || now > row.reset) {
    hits.set(key, { n: 1, reset: now + 60_000 }, now);
    return false;
  }
  row.n += 1;
  return row.n > 90;
}

function cors(res: Response): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Nbai-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}

function presentedKey(req: Request): string {
  const header = req.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const alt = req.get('x-nbai-key') || '';
  const key = alt.trim() || bearer;
  if (key.length < 8 || key.length > 200) return '';
  return key;
}

async function handle(req: Request, res: Response, op: 'list' | 'get' | 'create' | 'replace' | 'delete'): Promise<void> {
  cors(res);
  const workspaceId = routeParam(req.params.workspaceId);
  if (!WS_RE.test(workspaceId)) {
    res.status(400).json({ ok: false, error: 'That app id is not allowed. Nothing was changed.' });
    return;
  }
  if (tooFast(addressRateKey(req), workspaceId, Date.now())) {
    res.status(429).json({ ok: false, error: 'Too many requests. Nothing extra was charged.' });
    return;
  }
  const key = presentedKey(req);
  if (!key) {
    res.status(401).json({ ok: false, error: 'Send the app key. Nothing was changed.' });
    return;
  }
  const actorUid = await verifyFirebaseToken(req);
  if (!actorUid) {
    res.status(401).json({ ok: false, error: 'Sign in to access your records. The app key alone cannot open this database.' });
    return;
  }
  const db = getServerDb();
  if (!db) {
    res.status(503).json({ ok: false, error: 'The database is not switched on. Nothing was changed.' });
    return;
  }
  let data: Record<string, SharedScalar> | null = null;
  if (op === 'create' || op === 'replace') {
    const cleaned = sanitizeRecord(req.body);
    if (!cleaned.ok) {
      res.status(400).json({ ok: false, error: cleaned.error });
      return;
    }
    data = cleaned.data;
  }
  const id = typeof req.params.id === 'string' ? req.params.id : null;
  const result = await runSharedData(db as unknown as SharedDb, workspaceId, {
    op,
    actorUid,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    collection: routeParam(req.params.collection),
    id,
    key,
    nowMs: Date.now(),
    data,
  });
  res.status(result.status).json(result.body);
}

export function registerAppDataRoutes(app: Express): void {
  const pre = (req: Request, res: Response) => { cors(res); res.status(204).end(); void req; };
  app.options('/api/v1/data/:workspaceId/:collection', pre);
  app.options('/api/v1/data/:workspaceId/:collection/:id', pre);
  app.get('/api/v1/data/:workspaceId/:collection', (req, res) => { void handle(req, res, 'list'); });
  app.get('/api/v1/data/:workspaceId/:collection/:id', (req, res) => { void handle(req, res, 'get'); });
  app.post('/api/v1/data/:workspaceId/:collection', (req, res) => { void handle(req, res, 'create'); });
  app.patch('/api/v1/data/:workspaceId/:collection/:id', (req, res) => { void handle(req, res, 'replace'); });
  app.delete('/api/v1/data/:workspaceId/:collection/:id', (req, res) => { void handle(req, res, 'delete'); });
}
