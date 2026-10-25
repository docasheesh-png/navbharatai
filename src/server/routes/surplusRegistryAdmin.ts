import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { controlSurplusModel, readSurplusObservations, refreshSurplusRegistry } from '../AI/SurplusRegistry/runtime';
import { isSurplusModelId } from '../AI/SurplusRegistry/config';
import { getSurplusConnectionTestStatus, runSurplusConnectionTest, runSurplusCredentialCheck } from '../AI/SurplusRegistry/connectionTest';

/** Verified-admin controls and an independently bounded, one-shot connection test. No production activation. */
export function registerSurplusRegistryAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many status reads. Please wait one minute.' } });
  const writes = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many manager actions. Please wait one minute.' } });
  const tests = rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many connection test requests. Read the saved status instead.' } });
  app.post('/api/admin/surplus-registry/credential-check', verifyAdminToken, tests, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      res.status(400).json({ error: 'Credential checking accepts only an empty JSON object.' }); return;
    }
    try {
      const result = await runSurplusCredentialCheck();
      audit('ADMIN_SURPLUS_CREDENTIAL_CHECK', { admin: adminUsername(), result: result.status });
      res.json(result);
    } catch {
      audit('ADMIN_SURPLUS_CREDENTIAL_CHECK_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'Saved credential check is unavailable.' });
    }
  });
  app.get('/api/admin/surplus-registry/connection-test', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await getSurplusConnectionTestStatus()); }
    catch {
      audit('ADMIN_SURPLUS_CONNECTION_STATUS_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'Connection test status is unavailable. Do not repeat the test.' });
    }
  });
  app.post('/api/admin/surplus-registry/connection-test', verifyAdminToken, tests, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // No caller-supplied prompt, model, credential, spending limit or hard-stop review is accepted.
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      res.status(400).json({ error: 'Connection testing accepts only an empty JSON object.' }); return;
    }
    audit('ADMIN_SURPLUS_CONNECTION_TEST_REQUESTED', { admin: adminUsername(), result: 'requested' });
    try {
      const status = await runSurplusConnectionTest();
      audit('ADMIN_SURPLUS_CONNECTION_TEST_STATUS', { admin: adminUsername(), result: status.status });
      res.json(status);
    } catch {
      audit('ADMIN_SURPLUS_CONNECTION_TEST_UNCONFIRMED', { admin: adminUsername(), result: 'unconfirmed' });
      res.status(503).json({ error: 'Connection test outcome is unconfirmed. Read the saved status; do not repeat the test.' });
    }
  });
  app.get('/api/admin/surplus-registry', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await readSurplusObservations()); }
    catch {
      audit('ADMIN_SURPLUS_REGISTRY_READ_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'Discounted builder status is unavailable. No eligibility is confirmed.' });
    }
  });
  /** Metadata sync only. Same durable lease/cooldown as the scheduler; never inference or production activation. */
  app.post('/api/admin/surplus-registry/sync', verifyAdminToken, writes, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await refreshSurplusRegistry();
      audit('ADMIN_SURPLUS_METADATA_SYNC', { admin: adminUsername(), result: result.status });
      res.json(result);
    } catch {
      audit('ADMIN_SURPLUS_METADATA_SYNC_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'Metadata sync failed. Previous observations are retained; empty or stale status cannot authorize paid Surplus admission.' });
    }
  });
  app.post('/api/admin/surplus-registry/models/action', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Provide a valid model control.' }); return;
    }
    const { modelId, action, expectedRevision, snapshotVersion, reason } = body as Record<string, unknown>;
    if (Object.keys(body).some(key => !['modelId', 'action', 'expectedRevision', 'snapshotVersion', 'reason'].includes(key))
      || !isSurplusModelId(modelId) || modelId.split('/').some(part => part === '.' || part === '..')
      || (action !== 'disable' && action !== 'enable')
      || !Number.isSafeInteger(expectedRevision) || ((expectedRevision as number) < 0 || (expectedRevision as number) >= Number.MAX_SAFE_INTEGER)
      || typeof snapshotVersion !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(snapshotVersion)
      || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) {
      res.status(400).json({ error: 'Provide a model, disable or enable action, current snapshot and control revision, and a 10–500 character reason.' }); return;
    }
    const event = { modelId, action, expectedRevision, snapshotVersion, reason: reason.trim() };
    try {
      await controlSurplusModel(modelId, action, expectedRevision as number, snapshotVersion, reason.trim());
      audit('ADMIN_SURPLUS_MODEL_CONTROL', { admin: adminUsername(), ...event, result: 'ok' });
      res.json({ ok: true, canDispatch: false });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const conflict = code === 'REGISTRY_VERSION_CHANGED', invalid = code === 'INVALID_SURPLUS_CONTROL';
      audit('ADMIN_SURPLUS_MODEL_CONTROL_FAILED', { admin: adminUsername(), ...event, result: conflict ? 'conflict' : invalid ? 'invalid' : 'unconfirmed' });
      if (conflict) { res.status(409).json({ error: 'The snapshot or controls changed. Refresh and review the current model before retrying.' }); return; }
      if (invalid) { res.status(400).json({ error: 'That candidate control is not valid for the current configuration.' }); return; }
      res.status(503).json({ error: 'Action could not be confirmed. Refresh the stored state before retrying.' });
    }
  });
}
