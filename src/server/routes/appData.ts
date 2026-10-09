// Public data API for one app's shared database.
//
// The published app calls this with its key. There is no Firebase user on that call — the key is
// the credential, and it only opens the workspace it was created for. Firestore rules deny the
// collection to browsers; this route is the only door, and it stops at the operation cap so one
// app cannot run the bill. Nothing here charges a wallet.

import type { Express, Request, Response } from 'express';
import { getServerDb } from '../lib/serverDb';
import { sanitizeRecord, type SharedScalar } from '../lib/sharedData';
import { runSharedData, type SharedDb } from '../lib/sharedDataStore';
import { routeParam } from '../lib/expressCompat';

const WS_RE = /^agentv3-[A-Za-z0-9_-]{4,80}$/;
const hits = new Map<string, { n: number; reset: number }>();

function tooFast(ip: string, workspaceId: string, now: number): boolean {
  const key = `${ip}|${workspaceId}`;
  const row = hits.get(key);
  if (!row || now > row.reset) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { n: 1, reset: now + 60_000 });
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
  const key = bearer || alt.trim();
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
  if (tooFast(req.ip || 'unknown', workspaceId, Date.now())) {
    res.status(429).json({ ok: false, error: 'Too many requests. Nothing extra was charged.' });
    return;
  }
  const key = presentedKey(req);
  if (!key) {
    res.status(401).json({ ok: false, error: 'Send the app key. Nothing was changed.' });
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
