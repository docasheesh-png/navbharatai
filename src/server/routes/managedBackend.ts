/**
 * managedBackend routes — the HTTP surface of "Deploy to NavBharatAI Cloud" (managed backend
 * hosting: user backends on the platform's own GCP account, billed to the user's wallet plan).
 *
 * Flow a client follows:
 *   1. GET  /api/managed-backend/status                 — feature + plan + this user's apps
 *   2. POST /api/managed-backend/plan/purchase          — buy/extend the ₹199/30d plan (wallet debit)
 *   3. POST /api/managed-backend/deploy                 — {appId, files} → starts build, returns ids
 *   4. GET  /api/managed-backend/apps/:serviceId/status — poll; ADVANCES the deploy from reality
 *   5. POST /api/managed-backend/apps/:serviceId/suspend|resume, DELETE .../apps/:serviceId
 *
 * Every gate answers honestly: feature off → 503 with the flag name; not configured → 503 naming the
 * missing envs; no plan → 402 naming the price; over caps → 400 naming the number and the cap. The
 * deploy itself is poll-driven (see cloudRunBackend.ts) so a server restart mid-deploy loses nothing.
 */

import express, { type Express, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { verifyFirebaseToken, enforceNotBanned, rateLimiter, type RateLimitOptions } from '../lib/authMiddleware';
import { verifiedIdentity } from '../lib/identityPolicy';
import { sendSafeError } from '../lib/httpError';
import { getServerDb } from '../lib/serverDb';
import {
  managedBackendEnabled, managedBackendConfig, serviceNameFor, subdomainFor,
  startManagedDeploy, advanceManagedDeploy, probeService, deleteManagedService,
} from '../lib/cloudRunBackend';
import { limitsForPlan, checkSourceSize, stripForbiddenFiles } from '../lib/backendLimits';
import { provisionNeonDatabase, deleteNeonDatabase, neonConfigured, neonRequirement } from '../lib/neonProvision';
import {
  readBackendPlanStatus, purchaseBackendPlan, backendPlanPriceInr, BACKEND_PLAN_DAYS,
} from '../lib/backendHostingPlan';
import {
  readManagedApp, writeManagedApp, listManagedAppsForUser, type ManagedAppRecord,
} from '../lib/backendRegistry';
import { appsDomain } from '../lib/backendSubdomainRouter';

const MANAGED_BACKEND_RATE: RateLimitOptions = {
  name: 'managed-backend', authed: 120, anon: 0, noun: 'managed hosting requests', durable: false,
};

/** Managed apps one user may keep — a platform-spend cap, sized generously for real use. */
const MAX_APPS_PER_USER = 5;

function appsUrlFor(subdomain: string): string | null {
  const d = appsDomain();
  return d ? `https://${subdomain}.${d}` : null;
}

async function requireUid(req: Request, res: Response): Promise<string | null> {
  const identity = await verifiedIdentity(req);
  const uid = identity?.uid ?? null;
  if (!uid) {
    res.status(401).json({ error: 'Sign in to use managed hosting.' });
    return null;
  }
  return uid;
}

/** The two global gates every managed endpoint shares, answered honestly. */
function featureGate(res: Response): boolean {
  if (!managedBackendEnabled()) {
    res.status(503).json({ error: 'Managed backend hosting is not enabled on this server (AGENTV3_MANAGED_BACKEND).' });
    return false;
  }
  const cfg = managedBackendConfig();
  if (!cfg.configured) {
    res.status(503).json({ error: `Managed backend hosting is not configured — the admin must set ${cfg.missing.join(', ')}.` });
    return false;
  }
  return true;
}

/** Owner-gated registry read shared by the per-app endpoints. */
async function ownedApp(req: Request, res: Response, uid: string): Promise<ManagedAppRecord | null> {
  const serviceId = String(req.params.serviceId ?? '');
  const app = serviceId ? await readManagedApp(serviceId) : null;
  if (!app || app.state === 'deleted' || app.uid !== uid) {
    // One answer for absent AND foreign apps — existence must not leak across users.
    res.status(404).json({ error: 'App not found.' });
    return null;
  }
  return app;
}

export function registerManagedBackendRoutes(app: Express): void {
  const limiter = rateLimiter(MANAGED_BACKEND_RATE);

  // ---- 1. status: feature, plan, and this user's apps ----
  app.get('/api/managed-backend/status', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const cfg = managedBackendConfig();
      const plan = await readBackendPlanStatus(getServerDb(), uid);
      const apps = await listManagedAppsForUser(uid, MAX_APPS_PER_USER);
      res.json({
        enabled: managedBackendEnabled(),
        configured: cfg.configured && neonConfigured(),
        region: cfg.region,
        appsDomain: appsDomain() || null,
        plan: { active: plan.active, serving: plan.serving, priceInr: plan.priceInr, days: plan.days, expiresAt: plan.plan?.expiresAt ?? null },
        apps: apps.map((a) => ({
          serviceId: a.serviceId, appId: a.appId, subdomain: a.subdomain, state: a.state,
          url: a.url, appsUrl: appsUrlFor(a.subdomain), lastDeployError: a.lastDeployError,
        })),
        maxApps: MAX_APPS_PER_USER,
      });
    } catch (e) {
      sendSafeError(res, 500, 'Could not read managed hosting status.', e, 'managed-backend status');
    }
  });

  // ---- 2. plan purchase (wallet debit — atomic, idempotent per period) ----
  app.post('/api/managed-backend/plan/purchase', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      if (!managedBackendEnabled()) {
        res.status(503).json({ error: 'Managed backend hosting is not enabled on this server.' });
        return;
      }
      const result = await purchaseBackendPlan(getServerDb(), uid);
      if (!result.ok) {
        const status = result.reason === 'insufficient' ? 402 : 503;
        res.status(status).json({ error: result.error, reason: result.reason, shortfallTokens: result.shortfallTokens });
        return;
      }
      res.json({ ok: true, plan: result.plan, charged: result.charged, tokenBalance: result.tokenBalance });
    } catch (e) {
      sendSafeError(res, 500, 'Could not complete the plan purchase.', e, 'managed-backend plan purchase');
    }
  });

  // ---- 3. deploy: {appId, files} → Neon DB (first time) → build → registry ----
  // Route-level parser: a project is bigger than the app-wide JSON limit; capped at the tier's max.
  app.post('/api/managed-backend/deploy', limiter, verifyFirebaseToken, enforceNotBanned(), express.json({ limit: '25mb' }), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      if (!featureGate(res)) return;
      if (!neonConfigured()) {
        res.status(503).json({ error: neonRequirement() });
        return;
      }

      const appId = String(req.body?.appId ?? '').trim();
      const rawFiles = req.body?.files;
      if (!appId || !rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) {
        res.status(400).json({ error: 'Send { appId, files: { "path": "content", … } }.' });
        return;
      }

      // Plan gate — deploys need an ACTIVE plan (grace only keeps existing traffic alive).
      const plan = await readBackendPlanStatus(getServerDb(), uid);
      if (!plan.active) {
        res.status(402).json({
          error: `Managed hosting needs the Managed Backend plan (₹${backendPlanPriceInr()}/${BACKEND_PLAN_DAYS} days).`,
          purchase: '/api/managed-backend/plan/purchase',
        });
        return;
      }

      const limits = limitsForPlan('managed_backend');
      const { kept, dropped } = stripForbiddenFiles(rawFiles as Record<string, string>);
      const size = checkSourceSize(kept, limits);
      if (!size.ok) {
        res.status(400).json({ error: size.reason });
        return;
      }

      const serviceId = serviceNameFor(uid, appId);
      const existing = await readManagedApp(serviceId);
      if (existing && existing.uid !== uid) {
        res.status(409).json({ error: 'This app name is taken — pick another app id.' });
        return;
      }
      if (!existing) {
        const count = (await listManagedAppsForUser(uid, MAX_APPS_PER_USER + 1)).length;
        if (count >= MAX_APPS_PER_USER) {
          res.status(400).json({ error: `You already run ${count} managed apps — the limit is ${MAX_APPS_PER_USER}. Delete one to add another.` });
          return;
        }
      }

      // Database + session secret exist ONCE per app; redeploys must never rotate them.
      let neonProjectId = existing?.neonProjectId ?? null;
      let dbConnectionUri = existing?.dbConnectionUri ?? null;
      const sessionSecret = existing?.sessionSecret ?? randomBytes(32).toString('hex');
      if (!dbConnectionUri) {
        const db = await provisionNeonDatabase({ projectName: serviceId });
        if (!db.ok) {
          res.status(502).json({ error: db.message });
          return;
        }
        neonProjectId = db.projectId;
        dbConnectionUri = db.connectionUri;
      }

      const tag = String(Date.now());
      const started = await startManagedDeploy({ serviceId, files: kept, appName: appId, tag });
      if (!started.ok) {
        res.status(502).json({ error: started.message, stage: started.stage });
        return;
      }

      const record: ManagedAppRecord = {
        serviceId,
        uid,
        appId,
        subdomain: subdomainFor(uid, appId),
        region: managedBackendConfig().region,
        url: existing?.url ?? null,
        state: 'deploying',
        buildId: started.buildId,
        image: started.image,
        tag,
        lastDeployError: null,
        neonProjectId,
        dbConnectionUri,
        sessionSecret,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!(await writeManagedApp(record))) {
        res.status(500).json({ error: 'The build started but its record could not be saved — poll status to continue, or retry.' });
        return;
      }

      res.json({
        ok: true, serviceId, buildId: started.buildId,
        subdomain: record.subdomain, appsUrl: appsUrlFor(record.subdomain),
        droppedFiles: dropped.length ? dropped : undefined,
        poll: `/api/managed-backend/apps/${serviceId}/status`,
      });
    } catch (e) {
      sendSafeError(res, 500, 'Could not start the deploy.', e, 'managed-backend deploy');
    }
  });

  // ---- 4. status poll — ADVANCES the deploy from reality (build → service → live) ----
  app.get('/api/managed-backend/apps/:serviceId/status', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      if (!featureGate(res)) return;
      const app_ = await ownedApp(req, res, uid);
      if (!app_) return;

      // No deploy in flight → report the service as it stands.
      if (!app_.buildId || !app_.image) {
        const probe = await probeService(app_.serviceId);
        if ('error' in probe) {
          res.status(502).json({ error: probe.error });
          return;
        }
        res.json({
          phase: probe.found && probe.ready ? 'live' : app_.state,
          url: probe.found ? probe.url : null, appsUrl: appsUrlFor(app_.subdomain), state: app_.state,
        });
        return;
      }

      const advanced = await advanceManagedDeploy({
        serviceId: app_.serviceId,
        buildId: app_.buildId,
        image: app_.image,
        limits: limitsForPlan('managed_backend'),
        appEnv: {
          NODE_ENV: 'production',
          DATABASE_URL: app_.dbConnectionUri ?? '',
          SESSION_SECRET: app_.sessionSecret,
        },
      });

      if (advanced.phase === 'live') {
        await writeManagedApp({ ...app_, url: advanced.url, state: 'active', buildId: null, image: null, lastDeployError: null });
        res.json({ phase: 'live', url: advanced.url, appsUrl: appsUrlFor(app_.subdomain), state: 'active' });
        return;
      }
      if (advanced.phase === 'failed') {
        await writeManagedApp({ ...app_, state: app_.url ? 'active' : 'deploying', buildId: null, image: null, lastDeployError: advanced.message });
        res.json({ phase: 'failed', error: advanced.message, logUrl: advanced.logUrl, appsUrl: appsUrlFor(app_.subdomain) });
        return;
      }
      res.json({ phase: advanced.phase, appsUrl: appsUrlFor(app_.subdomain), poll: true });
    } catch (e) {
      sendSafeError(res, 500, 'Could not read the deploy status.', e, 'managed-backend app status');
    }
  });

  // ---- 5. suspend / resume / delete ----
  app.post('/api/managed-backend/apps/:serviceId/suspend', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const app_ = await ownedApp(req, res, uid);
      if (!app_) return;
      await writeManagedApp({ ...app_, state: 'suspended' });
      res.json({ ok: true, state: 'suspended' });
    } catch (e) {
      sendSafeError(res, 500, 'Could not suspend the app.', e, 'managed-backend suspend');
    }
  });

  app.post('/api/managed-backend/apps/:serviceId/resume', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const app_ = await ownedApp(req, res, uid);
      if (!app_) return;
      await writeManagedApp({ ...app_, state: app_.url ? 'active' : 'deploying' });
      res.json({ ok: true, state: app_.url ? 'active' : 'deploying' });
    } catch (e) {
      sendSafeError(res, 500, 'Could not resume the app.', e, 'managed-backend resume');
    }
  });

  app.delete('/api/managed-backend/apps/:serviceId', limiter, verifyFirebaseToken, enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const uid = await requireUid(req, res);
      if (!uid) return;
      if (!featureGate(res)) return;
      const app_ = await ownedApp(req, res, uid);
      if (!app_) return;

      // Real deletion, honestly reported: Cloud Run first (stops billing), then the database
      // (destroys data — the client confirms with the user before calling), then the record.
      const svc = await deleteManagedService(app_.serviceId);
      if (!svc.ok) {
        res.status(502).json({ error: svc.message });
        return;
      }
      if (app_.neonProjectId) {
        const dbGone = await deleteNeonDatabase(app_.neonProjectId);
        if (!dbGone.ok) {
          // Service is gone but the DB is not — say EXACTLY that; a retry finishes the job.
          await writeManagedApp({ ...app_, url: null, state: 'suspended', lastDeployError: `Service deleted; database cleanup failed: ${dbGone.message}` });
          res.status(502).json({ error: `The app was taken down but its database could not be deleted yet — retry delete. (${dbGone.message})` });
          return;
        }
      }
      await writeManagedApp({ ...app_, state: 'deleted', url: null, dbConnectionUri: null });
      res.json({ ok: true, state: 'deleted' });
    } catch (e) {
      sendSafeError(res, 500, 'Could not delete the app.', e, 'managed-backend delete');
    }
  });
}
