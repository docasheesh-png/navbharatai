/**
 * Admin → AI Engines → Traffic control (Traffic Manager V2, P2, owner-approved 2026-11-17).
 *
 * GET  /api/admin/traffic-control           the document in force, what THIS instance enforces, the registry
 *                                           (providers/models to choose from) and the latest revisions + audit rows
 * POST /api/admin/traffic-control           save a new revision: { expectedRevision, body, reason, totp }
 * POST /api/admin/traffic-control/rollback  make an older revision current again: { expectedRevision, targetRevision, reason, totp }
 *
 * 🔒 EVERY WRITE NEEDS: an admin session (verifyAdminToken), a reason, the revision the admin saw, and a FRESH
 * 6-digit authenticator code. Admin login MFA is optional in this codebase (with no enrolment, login is
 * password-only), so a session alone is not proof of MFA: these writes refuse until MFA is enrolled (owner
 * requirement 6). A code is accepted once per instance (replay guard). No provider is called here.
 */
import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { getServerDb } from '../lib/serverDb';
import { BoundedCache } from '../lib/boundedCache';
import { ControlConflictError, TrafficControlStore } from '../AI/TrafficRegistry/controlStore';
import { ControlInputError, CONTROL_SURFACES } from '../AI/TrafficRegistry/controlTypes';
import { adoptTrafficControl, currentTrafficControl, trafficControlSyncStatus } from '../AI/TrafficRegistry/controlSync';
import { admissionGaps } from '../AI/TrafficRegistry/controlDecision';
import { buildRegistrySnapshot } from '../AI/TrafficRegistry/snapshot';
import { LEGACY_PATHS } from '../AI/TrafficRegistry/legacyControl';
import { sharedHealthStatus } from '../AI/ProviderHealth/healthShare';
import { suspectedFamilyOutages, type HealthObservation } from '../AI/ProviderHealth/familyHealth';
import { trafficProviderViews } from '../AI/ProviderHealth/trafficHealth';

export type StepUpResult = 'ok' | 'invalid' | 'not-enrolled' | 'unavailable';
export type StepUpVerifier = (code: string) => Promise<StepUpResult>;

const usedCodes = new BoundedCache<string, true>({ maxEntries: 64, ttlMs: 120_000 });

function store(): TrafficControlStore {
  const db = getServerDb(); if (!db) throw new Error('storage unavailable');
  return new TrafficControlStore(db);
}

async function stepUp(verify: StepUpVerifier, code: unknown): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return { ok: false, status: 400, error: 'Enter the current 6-digit code from your authenticator app.' };
  if (usedCodes.has(code)) return { ok: false, status: 401, error: 'That code was already used. Wait for the next code and try again.' };
  const result = await verify(code).catch((): StepUpResult => 'unavailable');
  if (result === 'not-enrolled') return { ok: false, status: 403, error: 'Traffic controls need admin MFA. Enrol an authenticator under Admin → Security first. Nothing was changed.' };
  if (result === 'unavailable') return { ok: false, status: 503, error: 'MFA could not be checked right now. Nothing was changed.' };
  if (result !== 'ok') return { ok: false, status: 401, error: 'The authenticator code is wrong or expired. Nothing was changed.' };
  usedCodes.set(code, true);
  return { ok: true };
}

function only(body: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return Object.keys(body).every(k => keys.includes(k)) ? body as Record<string, unknown> : null;
}

function writeFailure(e: unknown): { status: number; error: string } {
  if (e instanceof ControlInputError) return { status: 400, error: e.message };
  if (e instanceof ControlConflictError) return { status: 409, error: e.message };
  return { status: 503, error: 'The change could not be confirmed. Reload to see the saved revision before trying again.' };
}

/** Shared provider health (P3) for the admin: what other servers report, and suspected shared outages. No free text. */
function sharedHealthView(now: number) {
  const shared = sharedHealthStatus(now);
  const local: HealthObservation[] = trafficProviderViews(now).filter(v => v.state !== 'up')
    .map(v => ({ provider: v.provider, state: v.state, kind: v.lastFailureKind ?? 'other', at: v.changedAt, model: v.model, source: 'local' as const }));
  const remote: HealthObservation[] = shared.remote.map(r => ({ provider: r.provider, state: r.state, kind: r.kind, at: r.atMs, model: r.model ?? null, source: 'shared' as const }));
  return {
    mode: shared.mode, lastPullAtMs: shared.lastPullAtMs, lastPullOk: shared.lastPullOk, intervalMs: shared.intervalMs,
    writes: shared.writes, adopted: shared.adopted,
    reported: shared.remote.map(r => ({ provider: r.provider, state: r.state, kind: r.kind, atMs: r.atMs })),
    families: suspectedFamilyOutages([...local, ...remote], now),
  };
}

export function registerTrafficControlAdminRoutes(app: Express, verifyAdminToken: RequestHandler, verifyStepUp: StepUpVerifier): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many reads. Please wait one minute.' } });
  const writes = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many changes. Please wait one minute.' } });

  app.get('/api/admin/traffic-control', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const s = store();
      const [saved, history] = await Promise.all([s.read(), s.history(20)]);
      const now = Date.now();
      const snapshot = buildRegistrySnapshot();
      res.json({
        current: saved,
        thisInstance: { ...trafficControlSyncStatus(), enforcingRevision: currentTrafficControl()?.revision ?? 0 },
        surfaces: CONTROL_SURFACES,
        providers: snapshot.providers.map(p => ({ id: p.id, name: p.name, kind: p.kind, family: p.family })),
        models: snapshot.models.map(m => ({ key: m.key, surfaces: m.surfaces, dependsOn: m.dependsOn })),
        admission: Object.fromEntries(Object.entries(saved?.models ?? {}).filter(([, m]) => m.admission)
          .map(([k, m]) => [k, { required: m.admission!.required, gaps: admissionGaps(m.admission, now) }])),
        history,
        paths: LEGACY_PATHS,
        sharedHealth: sharedHealthView(now),
      });
    } catch {
      res.status(503).json({ error: 'The traffic controls could not be read. Nothing is confirmed on or off.' });
    }
  });

  app.post('/api/admin/traffic-control', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const b = only(req.body, ['expectedRevision', 'body', 'reason', 'totp']);
    if (!b) { res.status(400).json({ error: 'Send { expectedRevision, body, reason, totp } and nothing else.' }); return; }
    const mfa = await stepUp(verifyStepUp, b.totp);
    if (!mfa.ok) { audit('ADMIN_TRAFFIC_CONTROL_REFUSED', { admin: adminUsername(), result: `mfa-${mfa.status}` }, 'warn'); res.status(mfa.status).json({ error: mfa.error }); return; }
    try {
      const doc = await store().apply({ expectedRevision: b.expectedRevision, body: b.body, reason: b.reason, actor: adminUsername() });
      adoptTrafficControl(doc); // this instance at once; the others within one sync interval
      audit('ADMIN_TRAFFIC_CONTROL', { admin: adminUsername(), result: 'saved', revision: doc.revision, reason: doc.reason.slice(0, 300) }, 'warn');
      res.json({ revision: doc.revision, current: doc });
    } catch (e) {
      const f = writeFailure(e);
      audit('ADMIN_TRAFFIC_CONTROL_FAILED', { admin: adminUsername(), result: String(f.status) });
      res.status(f.status).json({ error: f.error });
    }
  });

  app.post('/api/admin/traffic-control/rollback', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const b = only(req.body, ['expectedRevision', 'targetRevision', 'reason', 'totp']);
    if (!b) { res.status(400).json({ error: 'Send { expectedRevision, targetRevision, reason, totp } and nothing else.' }); return; }
    const mfa = await stepUp(verifyStepUp, b.totp);
    if (!mfa.ok) { audit('ADMIN_TRAFFIC_CONTROL_REFUSED', { admin: adminUsername(), result: `mfa-${mfa.status}` }, 'warn'); res.status(mfa.status).json({ error: mfa.error }); return; }
    try {
      const doc = await store().rollback({ expectedRevision: b.expectedRevision, targetRevision: b.targetRevision, reason: b.reason, actor: adminUsername() });
      adoptTrafficControl(doc);
      audit('ADMIN_TRAFFIC_CONTROL_ROLLBACK', { admin: adminUsername(), result: 'saved', revision: doc.revision, reason: doc.reason.slice(0, 300) }, 'warn');
      res.json({ revision: doc.revision, current: doc });
    } catch (e) {
      const f = writeFailure(e);
      audit('ADMIN_TRAFFIC_CONTROL_FAILED', { admin: adminUsername(), result: String(f.status) });
      res.status(f.status).json({ error: f.error });
    }
  });
}

/** Test hook. */
export function __resetTrafficControlAdminForTests(): void { usedCodes.clear(); }
