// Resell routes — a server or a database from NavBharatAI, charged only after it is real.
//
// The Billing "Add" button cannot sell these. This is the only door, and it refuses before any
// Cloud Build minute or Supabase project when the account cannot pay. Own hosting and the user's
// own Supabase are not touched here; those paths stay ₹0.

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
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { createPlatformDatabase, platformSupabaseConfig } from '../lib/platformDatabase';
import { deleteProject } from '../lib/supabaseProvision';
import { saveUserSecrets } from '../lib/supabaseProvisionFlow';
import { executeDatabaseResell, executeServerResell, type ChargeResult } from '../lib/resellExecute';
import { quoteDatabaseResell, quoteServerResell, projectRefFromDatabaseProof, stableResellRef, workspaceIdFromServerProof } from '../lib/resellQuote';
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
  addonId: 'server' | 'dedicated_db',
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
    const [serverPay, dbPay, plan, live, tier] = await Promise.all([
      previewDeliveredCharge(getServerDb(), who.uid, 'server', stableResellRef('server', workspaceId, now)),
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
    const configured = platformSupabaseConfig() !== null;
    const database = quoteDatabaseResell({
      plansOn,
      configured,
      workspaceId,
      active: dbPay.active,
      canPay: dbPay.canPay,
    });
    const serverSpec = addonById('server');
    const dbSpec = addonById('dedicated_db');
    return res.json({
      ok: true,
      charged: false,
      server: { ...server, terms: serverSpec ? addonAgreementTerms(serverSpec) : [] },
      database: { ...database, terms: dbSpec ? addonAgreementTerms(dbSpec) : [] },
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

  app.post('/api/agentv3/resell/database', async (req: Request, res: Response) => {
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
    const cfg = platformSupabaseConfig();
    if (!cfg) return noCharge(res, 503, 'The database could not be reached, so it was left in place and nothing was refunded.');
    const menu = await readHostingAddons(getServerDb(), who.uid);
    const row = menu.active.find((a) => a.ref === ref && a.addonId === 'dedicated_db');
    const projectRef = projectRefFromDatabaseProof(row?.proof);
    if (!row || !projectRef || !String(row.proof).startsWith(`db:${workspaceId}:`)) {
      return noCharge(res, 404, 'That database was not found on this app. Nothing was refunded.');
    }
    const gone = await deleteProject(cfg.token, projectRef);
    if (!gone.ok) {
      return res.status(409).json({ ok: false, charged: false, error: 'The database could not be confirmed deleted, so nothing was refunded. It is still yours.' });
    }
    const removed = await removeHostingAddon(getServerDb(), who.uid, ref, 0, 0);
    if (!removed.ok) {
      return res.status(503).json({ ok: false, charged: false, error: 'The database is deleted, but the unused days could not be returned. Try again — nothing will be charged.' });
    }
    return res.json({ ok: true, charged: false, creditedInr: removed.creditedInr });
  });
}
