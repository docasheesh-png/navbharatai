// Resell routes — a server or a database from NavBharatAI, charged only after it is real.
//
// The Billing "Add" button cannot sell these. This is the only door. The database that starts is
// the small one: a namespace on the Firestore we already run, plus the data API on this server.
// A private Supabase project stays a second door, and only when that org is configured. An extra
// Cloud Run server stays the door it already was. Own hosting and the user's own Supabase stay ₹0.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { appLockBlocks } from '../lib/appLockEnforce';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { isAdminEmail } from '../lib/adminEmails';
import { identityGrantEmail } from '../AgentV3/featureFlag';
import { hostingAvailability } from '../AgentV3/hostApp';
import { hostingPlansEnabled, probeHostingPlan } from '../lib/hostingPlan';
import { readHostingTierForQuota } from '../lib/HostingQuota';
import { getServerDb } from '../lib/serverDb';
import {
  chargeDeliveredHostingAddon, previewDeliveredCharge, readHostingAddons, removeHostingAddon,
} from '../lib/hostingAddonLedger';
import { addonAgreementTerms, addonById } from '../../lib/hostingAddons';
import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { createPlatformDatabase, platformSupabaseConfig } from '../lib/platformDatabase';
import { deleteProject } from '../lib/supabaseProvision';
import { saveUserSecrets } from '../lib/supabaseProvisionFlow';
import { executeDatabaseResell, executeServerResell, type ChargeResult } from '../lib/resellExecute';
import { quoteDatabaseResell, quoteServerResell, projectRefFromDatabaseProof, stableResellRef, workspaceIdFromServerProof } from '../lib/resellQuote';
import { dataClientSource } from '../lib/sharedData';
import { createSharedDatabase, destroySharedDatabase, markSharedReady, type SharedDb } from '../lib/sharedDataStore';
import type { ServerPublishInput, ServerPublishResult } from '../AgentV3/serverPublish';

export interface ResellRouteDeps {
  /** Deploy with the server cap already lifted for this one paid extra. The quote decided it was allowed. */
  publishServer: (input: ServerPublishInput) => Promise<ServerPublishResult>;
  liveServerWorkspaces: (userId: string) => Promise<string[] | null>;
  teardownServer: (workspaceId: string, service: string | undefined) => Promise<{ ok: boolean }>;
}

function noCharge(res: Response, status: number, error: string) {
  return res.status(status).json({ ok: false, charged: false, error });
}

async function caller(req: Request): Promise<{ uid: string; isAdmin: boolean } | null> {
  const identity = await verifyFirebaseIdentity(req).catch(() => null);
  if (!identity?.uid) return null;
  return { uid: identity.uid, isAdmin: isAdminEmail(identityGrantEmail(identity)) };
}

async function asCharge(
  uid: string,
  addonId: 'server' | 'dedicated_db' | 'shared_db',
  clientRef: string,
  proof: string,
): Promise<ChargeResult> {
  const result = await chargeDeliveredHostingAddon(getServerDb(), uid, addonId, {
    agreedToTerms: true,
    clientRef,
    proof,
  });
  if (!result.ok) return { ok: false, error: result.error, active: false };
  const exp = Date.parse(result.addon.expiresAt);
  return { ok: true, charged: result.charged, active: Number.isFinite(exp) && exp > Date.now() };
}

export function registerResellHostingRoutes(app: Express, deps: ResellRouteDeps): void {
  app.get('/api/agentv3/resell/options', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was charged.');
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. Nothing was charged.');
    }
    const now = Date.now();
    const [serverPay, sharedPay, dedicatedPay, plan, live, tier] = await Promise.all([
      previewDeliveredCharge(getServerDb(), who.uid, 'server', stableResellRef('server', workspaceId, now)),
      previewDeliveredCharge(getServerDb(), who.uid, 'shared_db', stableResellRef('shared', workspaceId, now)),
      previewDeliveredCharge(getServerDb(), who.uid, 'dedicated_db', stableResellRef('database', workspaceId, now)),
      probeHostingPlan(who.uid).catch(() => ({ active: false, known: false as const })),
      deps.liveServerWorkspaces(who.uid),
      readHostingTierForQuota(who.uid).catch(() => null),
    ]);
    const plansOn = hostingPlansEnabled();
    let cloudAvailable = false;
    let cloudMessage = 'App hosting on NavBharatAI is not open yet.';
    if (!plan.known && !who.isAdmin) {
      cloudMessage = 'We could not check your hosting plan just now, so an extra server was not offered.';
    } else {
      const cloud = hostingAvailability({ isAdmin: who.isAdmin, hasPlan: plan.active === true });
      cloudAvailable = cloud.available;
      if (cloud.message) cloudMessage = cloud.message;
    }
    const planBackendApps = plan.active && !tier ? 0 : (tier?.backendApps ?? 0);
    const liveIds = plan.active && !tier ? null : live;
    const server = quoteServerResell({
      plansOn,
      cloudAvailable,
      cloudMessage,
      isAdmin: who.isAdmin,
      planBackendApps,
      liveWorkspaceIds: liveIds,
      workspaceId,
      active: serverPay.active,
      canPay: serverPay.canPay,
    });
    const database = quoteDatabaseResell({
      product: 'shared',
      plansOn,
      configured: getServerDb() !== null,
      workspaceId,
      active: sharedPay.active,
      canPay: sharedPay.canPay,
    });
    const dedicated = quoteDatabaseResell({
      product: 'dedicated',
      plansOn,
      configured: platformSupabaseConfig() !== null,
      workspaceId,
      active: dedicatedPay.active,
      canPay: dedicatedPay.canPay,
    });
    const serverSpec = addonById('server');
    const sharedSpec = addonById('shared_db');
    const dbSpec = addonById('dedicated_db');
    return res.json({
      ok: true,
      charged: false,
      server: { ...server, terms: serverSpec ? addonAgreementTerms(serverSpec) : [] },
      database: { ...database, terms: sharedSpec ? addonAgreementTerms(sharedSpec) : [] },
      dedicated: { ...dedicated, terms: dbSpec ? addonAgreementTerms(dbSpec) : [] },
      own: {
        hosting: 'Hosting it yourself stays free from us.',
        database: 'Connecting your own Supabase stays free from us.',
      },
    });
  });

  app.post('/api/agentv3/resell/server', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was charged.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-addon-purchase');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. Nothing was started and nothing was charged.');
    }
    const now = Date.now();
    const pay = await previewDeliveredCharge(getServerDb(), who.uid, 'server', stableResellRef('server', workspaceId, now));
    const plan = await probeHostingPlan(who.uid).catch(() => ({ active: false, known: false as const }));
    const tier = await readHostingTierForQuota(who.uid).catch(() => null);
    const live = await deps.liveServerWorkspaces(who.uid);
    let cloudAvailable = false;
    let cloudMessage = 'App hosting on NavBharatAI is not open yet.';
    if (!plan.known && !who.isAdmin) {
      cloudMessage = 'We could not check your hosting plan just now, so an extra server was not started.';
    } else {
      const cloud = hostingAvailability({ isAdmin: who.isAdmin, hasPlan: plan.active === true });
      cloudAvailable = cloud.available;
      if (cloud.message) cloudMessage = cloud.message;
    }
    const files = await loadWorkspaceFiles(workspaceId).catch(() => ({}));
    const outcome = await executeServerResell({
      agreedToTerms: req.body?.agreedToTerms === true,
      workspaceId,
    }, {
      nowMs: now,
      quoteInput: {
        plansOn: hostingPlansEnabled(),
        cloudAvailable,
        cloudMessage,
        isAdmin: who.isAdmin,
        planBackendApps: plan.active && !tier ? 0 : (tier?.backendApps ?? 0),
        liveWorkspaceIds: plan.active && !tier ? null : live,
        workspaceId,
        active: pay.active,
        canPay: pay.canPay,
      },
      publish: async () => {
        if (Object.keys(files).length === 0) {
          return {
            status: 422, live: false, ready: false,
            body: { error: 'There are no app files to host yet. Nothing was started and nothing was charged.', code: 'needs-server-hosting' },
          };
        }
        return deps.publishServer({
          workspaceId,
          ownerUid: who.uid,
          isAdmin: who.isAdmin,
          appName: null,
          files,
        });
      },
      charge: (clientRef, proof) => asCharge(who.uid, 'server', clientRef, proof),
      teardown: (service) => deps.teardownServer(workspaceId, service),
    });
    return res.status(outcome.status).json(outcome.body);
  });

  app.post('/api/agentv3/resell/server/stop', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was refunded.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-addon-remove');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ref = typeof req.body?.ref === 'string' ? req.body.ref : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. Nothing was refunded.');
    }
    const menu = await readHostingAddons(getServerDb(), who.uid);
    const row = menu.active.find((a) => a.ref === ref && a.addonId === 'server');
    if (!row || workspaceIdFromServerProof(row.proof) !== workspaceId) {
      return noCharge(res, 404, 'That server was not found on this app. Nothing was refunded.');
    }
    const down = await deps.teardownServer(workspaceId, undefined);
    if (!down.ok) {
      return res.status(409).json({ ok: false, charged: false, error: 'The server could not be confirmed down, so nothing was refunded. It is still yours.' });
    }
    const removed = await removeHostingAddon(getServerDb(), who.uid, ref, 0, 0);
    if (!removed.ok) {
      return res.status(503).json({ ok: false, charged: false, error: 'The server is down, but the unused days could not be returned. Try again — nothing will be charged.' });
    }
    return res.json({ ok: true, charged: false, creditedInr: removed.creditedInr });
  });

function dataOrigin(req: Request): string {
  const env = (process.env.PUBLIC_BASE_URL || process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[A-Za-z0-9._:-]+$/.test(env) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env)) return env;
  const host = req.get('host') || '';
  if (/^[A-Za-z0-9._:-]+$/.test(host)) {
    const proto = req.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
    return `${proto}://${host}`;
  }
  return 'https://navbharatai.com';
}

  app.post('/api/agentv3/resell/database', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was charged.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-addon-purchase');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. No database was created and nothing was charged.');
    }
    const now = Date.now();
    const pay = await previewDeliveredCharge(getServerDb(), who.uid, 'shared_db', stableResellRef('shared', workspaceId, now));
    const days = addonById('shared_db')?.days ?? 30;
    const outcome = await executeDatabaseResell({
      agreedToTerms: req.body?.agreedToTerms === true,
      workspaceId,
    }, {
      nowMs: now,
      quoteInput: {
        product: 'shared',
        plansOn: hostingPlansEnabled(),
        configured: getServerDb() !== null,
        workspaceId,
        active: pay.active,
        canPay: pay.canPay,
      },
      create: async () => {
        const db = getServerDb();
        if (!db) return { ok: false, message: 'A database from NavBharatAI is not switched on yet. Nothing was charged.', cleaned: true };
        const made = await createSharedDatabase(db as unknown as SharedDb, {
          workspaceId,
          ownerUid: who.uid,
          expiresAtMs: now + days * 24 * 60 * 60 * 1000,
          nowMs: now,
        });
        if (!made.ok) return { ok: false, message: made.message, cleaned: made.cleaned };
        const url = `${dataOrigin(req)}/api/v1/data/${workspaceId}`;
        return {
          ok: true,
          projectRef: made.publicRef,
          url,
          env: {
            VITE_NBAI_DATA_URL: url,
            VITE_NBAI_DATA_KEY: made.key,
            NBAI_DATA_KEY: made.key,
          },
        };
      },
      save: async (env) => {
        const db = getServerDb();
        if (!db) return false;
        const file = await mergeWorkspaceFiles(workspaceId, { 'src/nbai-data.js': dataClientSource() });
        if (file.status !== 'saved') return false;
        const secretsOk = await saveUserSecrets(who.uid, env, workspaceId);
        if (!secretsOk) return false;
        return markSharedReady(db as unknown as SharedDb, workspaceId, now);
      },
      charge: (clientRef, proof) => asCharge(who.uid, 'shared_db', clientRef, proof),
      destroy: async () => {
        const db = getServerDb();
        if (!db) return { ok: false };
        return destroySharedDatabase(db as unknown as SharedDb, workspaceId);
      },
      refund: async (clientRef) => {
        const removed = await removeHostingAddon(getServerDb(), who.uid, clientRef, 0, 0);
        return { ok: removed.ok };
      },
    });
    const body = { ...outcome.body };
    delete (body as { env?: unknown }).env;
    return res.status(outcome.status).json(body);
  });

  app.post('/api/agentv3/resell/database/dedicated', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was charged.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-addon-purchase');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. No database was created and nothing was charged.');
    }
    const cfg = platformSupabaseConfig();
    const now = Date.now();
    const pay = await previewDeliveredCharge(getServerDb(), who.uid, 'dedicated_db', stableResellRef('database', workspaceId, now));
    const outcome = await executeDatabaseResell({
      agreedToTerms: req.body?.agreedToTerms === true,
      workspaceId,
    }, {
      nowMs: now,
      quoteInput: {
        product: 'dedicated',
        plansOn: hostingPlansEnabled(),
        configured: cfg !== null,
        workspaceId,
        active: pay.active,
        canPay: pay.canPay,
      },
      create: async () => {
        if (!cfg) return { ok: false, message: 'A database from NavBharatAI is not switched on yet.', cleaned: true };
        return createPlatformDatabase({
          token: cfg.token,
          orgId: cfg.orgId,
          region: cfg.region,
          appLabel: typeof req.body?.appName === 'string' ? req.body.appName : null,
        });
      },
      save: (env) => saveUserSecrets(who.uid, env, workspaceId),
      charge: (clientRef, proof) => asCharge(who.uid, 'dedicated_db', clientRef, proof),
      destroy: async (projectRef) => {
        if (!cfg) return { ok: false };
        const gone = await deleteProject(cfg.token, projectRef);
        return { ok: gone.ok === true };
      },
      refund: async (clientRef) => {
        const removed = await removeHostingAddon(getServerDb(), who.uid, clientRef, 0, 0);
        return { ok: removed.ok };
      },
    });
    const body = { ...outcome.body };
    delete (body as { env?: unknown }).env;
    return res.status(outcome.status).json(body);
  });

  app.post('/api/agentv3/resell/database/stop', async (req: Request, res: Response) => {
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was refunded.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-addon-remove');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ref = typeof req.body?.ref === 'string' ? req.body.ref : '';
    if (!ownedByVerifiedUid(who.uid, workspaceId)) {
      return noCharge(res, 403, 'This app is not on your account. Nothing was refunded.');
    }
    const menu = await readHostingAddons(getServerDb(), who.uid);
    const row = menu.active.find((a) => a.ref === ref && (a.addonId === 'shared_db' || a.addonId === 'dedicated_db'));
    if (!row || !String(row.proof || '').startsWith(`db:${workspaceId}:`)) {
      return noCharge(res, 404, 'That database was not found on this app. Nothing was refunded.');
    }
    if (row.addonId === 'shared_db') {
      const db = getServerDb();
      if (!db) return noCharge(res, 503, 'The database could not be reached, so it was left in place and nothing was refunded.');
      const gone = await destroySharedDatabase(db as unknown as SharedDb, workspaceId);
      if (!gone.ok) {
        return res.status(409).json({ ok: false, charged: false, error: 'The database could not be confirmed deleted, so nothing was refunded. It is still yours.' });
      }
    } else {
      const cfg = platformSupabaseConfig();
      const projectRef = projectRefFromDatabaseProof(row.proof);
      if (!cfg || !projectRef) return noCharge(res, 503, 'The database could not be reached, so it was left in place and nothing was refunded.');
      const gone = await deleteProject(cfg.token, projectRef);
      if (!gone.ok) {
        return res.status(409).json({ ok: false, charged: false, error: 'The database could not be confirmed deleted, so nothing was refunded. It is still yours.' });
      }
    }
    const removed = await removeHostingAddon(getServerDb(), who.uid, ref, 0, 0);
    if (!removed.ok) {
      return res.status(503).json({ ok: false, charged: false, error: 'The database is deleted, but the unused days could not be returned. Try again — nothing will be charged.' });
    }
    return res.json({ ok: true, charged: false, creditedInr: removed.creditedInr });
  });
}
