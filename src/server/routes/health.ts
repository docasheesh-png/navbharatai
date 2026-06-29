// P2.4 — Disaster Recovery: liveness + readiness probes and the backup trigger.
//
//   • GET  /api/live   — liveness: is the process alive? Always 200 while running.
//   • GET  /api/ready  — readiness: has the server finished initialization? Returns 503
//                        until ready (so Cloud Run's startup probe holds traffic), then
//                        200 with a per-dependency check report. Dependency degradation is
//                        REPORTED but does not 503 (avoids needlessly pulling a healthy
//                        instance out of rotation — see DR_RUNBOOK.md).
//   • POST /api/admin/backup/firestore — admin-triggered Firestore export (DR backup).

import type { Express, Request, Response } from 'express';
import { firestoreBackup } from '../lib/FirestoreBackup';
import { doraMetrics } from '../lib/DoraMetrics';

// Set true once the server has finished initialization (wired from server.ts).
let serverReady = false;
export function markServerReady(): void {
  const wasReady = serverReady;
  serverReady = true;
  // P-DEPLOY.1 — a production server reaching ready = a new Cloud Run revision going live
  // = a deployment. Record it (once per boot) so DORA deployment-frequency reflects real
  // revisions. Best-effort; skipped under tests / non-production.
  if (!wasReady && process.env.NODE_ENV === 'production') {
    try { doraMetrics.recordDeploy({ success: true }); } catch { /* never block readiness */ }
  }
}
export function isServerReady(): boolean { return serverReady; }

export interface ReadinessReport {
  ready: boolean;
  uptime: number;
  checks: { initialized: boolean; backupConfigured: boolean };
}

/** Pure (unit-tested): compute the readiness report from current signals. */
export function buildReadiness(ready: boolean, uptimeSec: number, backupConfigured: boolean): ReadinessReport {
  return { ready, uptime: uptimeSec, checks: { initialized: ready, backupConfigured } };
}

function adminOk(req: Request): boolean {
  return !!process.env.ADMIN_PASSWORD && req.query.admin === process.env.ADMIN_PASSWORD;
}

export function registerHealthRoutes(app: Express): void {
  app.get('/api/live', (_req: Request, res: Response) => {
    res.json({ status: 'live', uptime: process.uptime() });
  });

  app.get('/api/ready', (_req: Request, res: Response) => {
    const report = buildReadiness(isServerReady(), process.uptime(), firestoreBackup.isConfigured());
    res.status(report.ready ? 200 : 503).json(report);
  });

  // DR — trigger a Firestore export. Admin-gated; returns an honest result (incl. a clear
  // "not configured" state when FIRESTORE_BACKUP_BUCKET isn't set).
  app.post('/api/admin/backup/firestore', async (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const result = await firestoreBackup.trigger();
    res.status(result.ok ? 200 : (result.configured ? 502 : 400)).json(result);
  });
}
