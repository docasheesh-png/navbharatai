// Resell routes — a server or a database from NavBharatAI, charged only after it is real.
//
// The Billing "Add" button cannot sell these. This is the only door. The database that starts is
// configured one: a dedicated Supabase project when the managed default is enabled, otherwise
// the legacy shared data API. Existing shared databases keep their removal controls. An extra
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
import { platformSupabaseDefault, approvedProjectLimit, organizationProjectCount, acquirePlatformAdmission, platformAppLabel } from '../lib/platformSupabaseAdmission';
import { deleteProject } from '../lib/supabaseProvision';
import { saveUserSecrets } from '../lib/supabaseProvisionFlow';
import { executeDatabaseResell, executeServerResell, type ChargeResult } from '../lib/resellExecute';
import { quoteDatabaseResell, quoteServerResell, projectRefFromDatabaseProof, stableResellRef, workspaceIdFromServerProof } from '../lib/resellQuote';
import { dataClientSource } from '../lib/sharedData';
import { createSharedDatabase, destroySharedDatabase, markSharedReady, type SharedDb } from '../lib/sharedDataStore';
import type { ServerPublishInput, ServerPublishResult } from '../AgentV3/serverPublish';
import { doc, getDoc } from '../lib/serverDb';
import { resellDuplicateGuardEnabled, resellAutoRenewEnabled } from '../lib/purchaseAuditFlags';
import { setResellAutoRenew } from '../lib/hostingAddonLedger';
import { resellAutoRenewTerm, privateDbCostPlusTerm } from '../../lib/hostingAddons';
import { privateDbCostPlusEnabled, privateDbCostMultiplier } from '../lib/privateDbCostPlus';
import { isDeliveredRow } from '../lib/resellLifecycle';

/**
 * RESELL_DUPLICATE_GUARD: the ref of an EXPIRED private-database row for this app that was never
 * removed, or null. Reads the raw rows because `readHostingAddons` drops expired ones. Fails open to
 * null (= old behaviour) — the guard only ever prevents a create, it never blocks a refund.
 */
async function lapsedDedicatedRef(uid: string, workspaceId: string, nowMs: number): Promise<string | null> {
  if (!resellDuplicateGuardEnabled() && !platformSupabaseDefault()) return null;
  try {
    const db = getServerDb();
    if (!db) {
      if (platformSupabaseDefault()) throw new Error('Database ledger unavailable.');
      return null;
    }
    const snap = await getDoc(doc(db as any, 'user_token_wallets', uid));
    const rows = snap.exists() ? (snap.data() as any)?.hostingAddons : null;
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((r: unknown) => isDeliveredRow(r)
      && r.addonId === 'dedicated_db'
      && String(r.proof || '').startsWith(`db:${workspaceId}:`)
      && Date.parse(r.expiresAt) <= nowMs
      && !(r as any).deletedAt);
    return hit ? hit.ref : null;
  } catch {
    if (platformSupabaseDefault()) throw new Error('Database ledger unavailable.');
    return null;
  }
}

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
  autoRenew = false,
): Promise<ChargeResult> {
  const result = await chargeDeliveredHostingAddon(getServerDb(), uid, addonId, {
    agreedToTerms: true,
    clientRef,
    proof,
    // RESELL_AUTO_RENEW: recorded only when the flag is on, so the ticked terms included the renewal line.
    autoRenew: autoRenew && resellAutoRenewEnabled(),
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
    const platformPurchasesReady = !platformSupabaseDefault() || approvedProjectLimit() !== null;
    const useDefaultSupabase = platformSupabaseDefault() && sharedPay.active !== null && !sharedPay.active.some((row) => String(row.proof || '').startsWith(`db:${workspaceId}:`));
    const database = quoteDatabaseResell({
      product: useDefaultSupabase ? 'dedicated' : 'shared',
      plansOn,
      configured: useDefaultSupabase ? platformSupabaseConfig() !== null && platformPurchasesReady : getServerDb() !== null,
      workspaceId,
      active: useDefaultSupabase ? dedicatedPay.active : sharedPay.active,
      canPay: useDefaultSupabase ? dedicatedPay.canPay : sharedPay.canPay,
      lapsedRef: useDefaultSupabase ? await lapsedDedicatedRef(who.uid, workspaceId, now) : null,
    });
    const dedicated = quoteDatabaseResell({
      product: 'dedicated',
      plansOn,
      configured: platformSupabaseConfig() !== null && platformPurchasesReady,
      workspaceId,
      active: dedicatedPay.active,
      canPay: dedicatedPay.canPay,
      lapsedRef: await lapsedDedicatedRef(who.uid, workspaceId, now),
    });
    const serverSpec = addonById('server');
    const sharedSpec = addonById('shared_db');
    const dbSpec = addonById('dedicated_db');
    // RESELL_AUTO_RENEW: the renewal sentence is part of what is ticked, and each paid row says
    // whether it renews, so Publish can show the switch to turn it off.
    const renewOn = resellAutoRenewEnabled();
    const termsFor = (spec: ReturnType<typeof addonById>) => (spec
      ? [...addonAgreementTerms(spec), ...(renewOn ? [resellAutoRenewTerm(spec)] : []),
        ...(spec.id === 'dedicated_db' && privateDbCostPlusEnabled() ? [privateDbCostPlusTerm(privateDbCostMultiplier())] : [])]
      : []);
    const menuRows = renewOn ? (await readHostingAddons(getServerDb(), who.uid).catch(() => ({ active: [] as any[] }))).active : [];
    const renewInfo = (stopRef: string | null) => {
      if (!renewOn || !stopRef) return undefined;
      const row = menuRows.find((r: any) => r.ref === stopRef);
      return row ? { on: row.autoRenew === true && !!row.autoRenewAgreedAt, ref: stopRef, expiresAt: row.expiresAt } : undefined;
    };
    return res.json({
      ok: true,
      charged: false,
      autoRenewAvailable: renewOn,
      server: { ...server, terms: termsFor(serverSpec), autoRenew: renewInfo(server.stopRef) },
      database: { ...database, purchasePath: useDefaultSupabase ? '/api/agentv3/resell/database/dedicated' : '/api/agentv3/resell/database', terms: termsFor(useDefaultSupabase ? dbSpec : sharedSpec), autoRenew: renewInfo(database.stopRef) },
      dedicated: useDefaultSupabase ? undefined : { ...dedicated, terms: termsFor(dbSpec), autoRenew: renewInfo(dedicated.stopRef) },
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
      charge: (clientRef, proof) => asCharge(who.uid, 'server', clientRef, proof, req.body?.autoRenew !== false),
      teardown: (service) => deps.teardownServer(workspaceId, service),
    });
    return res.status(outcome.status).json(outcome.body);
  });

  /** RESELL_AUTO_RENEW: switch auto-renew for ONE paid server/database on this app. Charges nothing. */
  app.post('/api/agentv3/resell/auto-renew', async (req: Request, res: Response) => {
    if (!resellAutoRenewEnabled()) return noCharge(res, 404, 'Auto-renew is not switched on yet. Nothing was changed.');
    const who = await caller(req);
    if (!who) return noCharge(res, 401, 'Please sign in. Nothing was changed.');
    const blocked = await appLockBlocks(req, who.uid, 'hosting-plan-auto-renew');
    if (blocked) return res.status(blocked.status).json({ ...blocked.body, charged: false });
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ref = typeof req.body?.ref === 'string' ? req.body.ref : '';
    const on = req.body?.autoRenew;
    if (typeof on !== 'boolean') return noCharge(res, 400, 'autoRenew must be true or false. Nothing was changed.');
    if (!ownedByVerifiedUid(who.uid, workspaceId)) return noCharge(res, 403, 'This app is not on your account. Nothing was changed.');
    const menu = await readHostingAddons(getServerDb(), who.uid);
    const row = menu.active.find((a) => a.ref === ref && (a.addonId === 'server' || a.addonId === 'shared_db' || a.addonId === 'dedicated_db'));
    const proofWs = row ? (/^(?:ws|db):([^:]{8,}):/.exec(String(row.proof || '')) || [])[1] : null;
    if (!row || proofWs !== workspaceId) return noCharge(res, 404, 'That server or database was not found on this app. Nothing was changed.');
    const r = await setResellAutoRenew(getServerDb(), who.uid, ref, on, req.body?.agreedToTerms === true);
    if (!r.ok) {
      const status = r.reason === 'agreement_required' ? 400 : r.reason === 'not_found' ? 404 : 503;
      const error = r.reason === 'agreement_required'
        ? 'Tick the auto-renew terms to switch it on. Nothing was changed.'
        : 'Could not change auto-renew right now. Nothing was changed.';
      return res.status(status).json({ ok: false, charged: false, error });
    }
    return res.json({
      ok: true, charged: false, autoRenew: on,
      message: on
        ? 'Auto-renew is on. It renews from your wallet every 30 days; you get reminders first.'
        : `Auto-renew is off. It stays until ${row.expiresAt.slice(0, 10)} and then simply ends. Nothing more will be charged.`,
    });
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
    // Old tabs accepted the shared-product price. Never silently substitute a paid Supabase order.
    if (platformSupabaseDefault()) return noCharge(res, 409, 'The default database has changed. Refresh Publish and review the current terms. Nothing was charged.');
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
      charge: (clientRef, proof) => asCharge(who.uid, 'shared_db', clientRef, proof, req.body?.autoRenew !== false),
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
    const managedDefault = platformSupabaseDefault();
    if (managedDefault && (!cfg || !getServerDb() || approvedProjectLimit() === null)) return noCharge(res, 503, 'Database setup is awaiting production activation. Nothing was charged.');
    const admission = managedDefault && cfg ? await acquirePlatformAdmission(getServerDb(), { orgId: cfg.orgId, workspaceId }) : null;
    if (managedDefault && !admission) return noCharge(res, 409, 'Database provisioning is busy or awaiting reconciliation. Nothing new was started.');
    let settled = true; // No provider create has started yet.
    let providerStarted = false;
    try {
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
          lapsedRef: await lapsedDedicatedRef(who.uid, workspaceId, now),
        },
        create: async () => {
          if (!cfg) return { ok: false, message: 'A database from NavBharatAI is not switched on yet.', cleaned: true };
          if (managedDefault) {
            const limit = approvedProjectLimit();
            if (limit === null || await organizationProjectCount(cfg.token, cfg.orgId) >= limit) {
              return { ok: false, cleaned: true, message: 'Database capacity needs an administrator review. Nothing was charged.' };
            }
          }
          settled = false;
          providerStarted = true;
          const made = await createPlatformDatabase({
            token: cfg.token,
            orgId: cfg.orgId,
            region: cfg.region,
            appLabel: platformAppLabel(workspaceId, typeof req.body?.appName === 'string' ? req.body.appName : ''),
            onCreated: admission ? (ref) => admission.noteProject(ref) : undefined,
          });
          if (!made.ok) settled = made.cleaned;
          return made;
        },
        save: (env) => saveUserSecrets(who.uid, env, workspaceId),
        charge: (clientRef, proof) => asCharge(who.uid, 'dedicated_db', clientRef, proof, req.body?.autoRenew !== false),
        destroy: async (projectRef) => {
          if (!cfg) return { ok: false };
          const gone = await deleteProject(cfg.token, projectRef);
          settled = gone.ok === true;
          return { ok: gone.ok === true };
        },
        refund: async (clientRef) => {
          const removed = await removeHostingAddon(getServerDb(), who.uid, clientRef, 0, 0);
          return { ok: removed.ok };
        },
      });
      if (outcome.body.ok === true) settled = true;
      const body = { ...outcome.body };
      delete (body as { env?: unknown }).env;
      return res.status(outcome.status).json(body);
    } catch {
      return res.status(503).json({ ok: false, charged: providerStarted ? null : false, paymentStatus: providerStarted ? 'unknown' : 'not-started', error: 'Database provisioning could not be confirmed. Review Publish before retrying; reconciliation may be needed.' });
    } finally {
      // A failed release safely leaves a hold. No timeout can turn an uncertain paid create into another.
      if (settled) await admission?.release().catch(() => undefined);
    }
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
    let row = menu.active.find((a) => a.ref === ref && (a.addonId === 'shared_db' || a.addonId === 'dedicated_db'));
    // An EXPIRED private database is still a real project holding the user's data. Without this its
    // row was invisible here, so it could never be removed (guard flag only; refund is ₹0 when expired).
    if (!row && (await lapsedDedicatedRef(who.uid, workspaceId, Date.now())) === ref) {
      row = { ref, addonId: 'dedicated_db', proof: undefined } as any;
      const snap = await getDoc(doc(getServerDb() as any, 'user_token_wallets', who.uid)).catch(() => null);
      const raw = (snap && snap.exists() ? (snap.data() as any)?.hostingAddons : []) || [];
      const full = raw.find((r: any) => r && r.ref === ref);
      if (full) row = full;
    }
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
