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
import { serverStats } from '../lib/serverStats';
import { buildHealthReport, renderStatusPageHtml, type HealthCheck } from '../lib/HealthReport';
import { adminRequestOk } from '../lib/adminAuth';

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

/**
 * Admin gate — the SHARED one (audit finding #3). This used to be a private copy that compared the
 * admin PASSWORD against `req.query.admin`, which wrote that password into Cloud Run access logs,
 * browser history and every proxy `Referer` on the way. It also used `===` on a secret, had no TTL
 * and no MFA. It now goes through the same timestamped, constant-time, expiring token the admin
 * panel uses — read from the `x-admin-token` header, never from a URL.
 */
const adminOk = (req: Request): boolean => adminRequestOk(req);

/** Assemble per-dependency health checks from real, live server state. */
function collectHealthChecks(): HealthCheck[] {
  const checks: HealthCheck[] = [];

  checks.push({
    name: 'Server initialization',
    status: isServerReady() ? 'ok' : 'down',
    detail: isServerReady() ? 'Ready' : 'Still initializing',
  });

  const backupOk = firestoreBackup.isConfigured();
  checks.push({
    name: 'Firestore backup',
    status: backupOk ? 'ok' : 'degraded',
    detail: backupOk ? 'Configured' : 'Not configured (set FIRESTORE_BACKUP_BUCKET)',
  });

  // 🔒 WHITE-LABEL LAW — `/status` and `/api/health` are PUBLIC (no token, no gate). This line used to
  // render "4 enabled (gemini, anthropic, grok, vertex)", so anyone who opened the status page learned
  // exactly which AI vendors NavBharatAI runs on. The standing rule is that a user never encounters a
  // vendor name and that provider identity is ADMIN-ONLY — the admin dashboard still gets the full
  // `providerEnabled` map from `/api/admin/*`. The COUNT is the honest, useful part of this check
  // (it is what tells a reader whether the engine can serve requests at all); the names were never
  // information a visitor could act on.
  const providers = serverStats.providerEnabled || ({} as Record<string, boolean>);
  const entries = Object.entries(providers);
  const enabled = entries.filter(([, on]) => on);
  checks.push({
    name: 'AI engines',
    status: enabled.length > 0 ? 'ok' : 'down',
    detail: enabled.length > 0
      ? `${enabled.length} of ${entries.length} available`
      : 'No engines available',
  });

  if (serverStats.maintenanceMode) {
    checks.push({ name: 'Maintenance mode', status: 'degraded', detail: 'Maintenance mode is ON' });
  }

  return checks;
}

export function registerHealthRoutes(app: Express): void {
  app.get('/api/live', (_req: Request, res: Response) => {
    res.json({ status: 'live', uptime: process.uptime() });
  });

  app.get('/api/ready', (_req: Request, res: Response) => {
    const report = buildReadiness(isServerReady(), process.uptime(), firestoreBackup.isConfigured());
    res.status(report.ready ? 200 : 503).json(report);
  });

  // U-15 — deep health probe: overall status + real uptime/memory/version + per-dependency checks.
  // Public + machine-readable; the /status page polls this. Never 503s on a degraded dependency
  // (mirrors /api/ready) so a healthy instance isn't pulled from rotation for a non-fatal issue.
  app.get('/api/health', (_req: Request, res: Response) => {
    const report = buildHealthReport({
      ready: isServerReady(),
      uptimeSec: process.uptime(),
      version: (process.env.K_REVISION || process.env.SERVICE_VERSION || process.env.GAE_VERSION || 'unknown').trim(),
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      maintenanceMode: !!serverStats.maintenanceMode,
      checks: collectHealthChecks(),
    });
    res.status(isServerReady() ? 200 : 503).json(report);
  });

  // STORE VERSION — what the installed Android app compares itself against (admin 2026-08-11:
  // "jab mai new app Play Store par dalu, to old app me notification jaye").
  //
  // The app ships in BUNDLED mode, so an installed copy runs its own frozen frontend forever and has
  // no way to learn that a newer build exists. This is that way: one public, unauthenticated GET (the
  // app must be able to ask before the user has signed in) returning the current store release.
  //
  // SET BY THE ADMIN AFTER EACH PLAY UPLOAD — `ANDROID_LATEST_VERSION_CODE` must match the
  // versionCode of the build that went live (the android-aab workflow stamps it with the CI run
  // number). Automating this needs a Play Developer service account, which this project does not have
  // yet; until it does, a human sets one number and that is stated plainly rather than pretended away.
  //
  // UNSET ⇒ the route answers with a null versionCode, and the client's decideUpdate() treats an
  // unknown as "no update". A misconfiguration therefore shows NOTHING, never a false prompt.
  app.get('/api/app-version', (_req: Request, res: Response) => {
    const num = (v: string | undefined): number | null => {
      const n = Number.parseInt(String(v ?? '').trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    res.set('Cache-Control', 'public, max-age=300'); // a version number does not need to be fresh to the second
    res.json({
      androidVersionCode: num(process.env.ANDROID_LATEST_VERSION_CODE),
      androidVersionName: (process.env.ANDROID_LATEST_VERSION_NAME || '').trim() || null,
      // Deliberately separate from the release number: forcing users off an old build is a decision,
      // not a consequence of shipping. Unset on a routine release.
      minAndroidVersionCode: num(process.env.ANDROID_MIN_VERSION_CODE),
      storeUrl: (process.env.ANDROID_STORE_URL || '').trim() || null,
    });
  });

  // U-15 — public status page (self-contained, polls /api/health).
  app.get('/status', (_req: Request, res: Response) => {
    res.type('html').send(renderStatusPageHtml());
  });

  // DR — trigger a Firestore export. Admin-gated; returns an honest result (incl. a clear
  // "not configured" state when FIRESTORE_BACKUP_BUCKET isn't set).
  app.post('/api/admin/backup/firestore', async (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const result = await firestoreBackup.trigger();
    res.status(result.ok ? 200 : (result.configured ? 502 : 400)).json(result);
  });
}
