// User reports — one way in for the person, one way out for the admin.
//
// ADMIN 2026-08-21: "user pure app navbharatai me kahi bhi kuch bhi report kar sakta hai … admin
// pannel me ek alag page banao, yaha admin sabhi report read kar sakta hai … dono profile dekh sake."
//
// WHAT WAS THERE BEFORE, and why this replaces rather than joins it: the App Mart player had a report
// button that wrote to Firestore and that NOTHING EVER READ. No admin route, no screen. The user was
// told a person reviews every report; no person could. A second half-system beside it would have made
// that worse, so the write and the read ship together here.
//
// 🔒 THE ONE RULE THAT MATTERS FOR SAFETY: a reporter may say WHAT is wrong, never WHO it belongs to.
// The uid a report is filed against is resolved on the SERVER from the app id. If the client could
// name the accused, anyone could aim a pile of complaints at a competitor and get them looked at.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { requireAdmin } from '../lib/adminAuth';
import { rateLimiter } from '../lib/authMiddleware';
import {
  validateReport, validateReplyPayload, awaitingAdmin, newShotId, isShotId, type ReportContext,
} from '../../lib/userReport';
import {
  buildReport, saveReport, listReports, getReport, getReportScreenshot, setReportStatus,
  countReportsAgainst, listReportsByReporter, addReportMessage,
  saveReportMessageShot, getReportMessageShot,
} from '../lib/userReportStore';
import { saveNotification } from '../lib/AdminNotificationStore';
import { getWebApp } from '../lib/navStoreWeb';
import { resolveUserIdentities } from '../lib/adminUserLookup';
import { summariseBuilds, summarisePayments, accountFlags } from '../lib/adminUserAccount';
import { userBuildHistoryStore } from '../lib/UserBuildHistoryStore';
import { deploymentStore } from '../AgentV3/DeploymentStore';
import { getServerDb } from '../lib/serverDb';
import { audit } from '../lib/audit';
import { activeHostingTier } from '../lib/hostingPlan';
import { adultPreferenceFrom } from '../../lib/adultContent';
import { spendByFeature, featureLabel, isWalletFeature } from '../lib/walletFeature';
import { featureSpendStore, spendDayKey } from '../lib/FeatureSpendStore';
import { professionalPassStore } from '../professionals/ProfessionalPassStore';
import {
  fetchAuthMetadata, firebaseAuthBatch, resolveJoinedAt, resolveLastActiveAt,
  summariseAiActivity, summariseDevices, profileView,
} from '../lib/adminUserActivity';

/** The Firestore handle the identity lookup needs, or null so it degrades to ids rather than throwing. */
function identityDb() {
  try {
    return getServerDb() as never;
  } catch {
    return null;
  }
}

/**
 * Trim whatever the client sent about its own context — none of it is trusted, all of it is capped.
 *
 * ⚠️ EVERY FIELD IS BOUNDED, INCLUDING THE NEW ARRAYS, and that is not defensive habit: this object
 * goes straight into a Firestore document with a hard 1 MiB ceiling, so an unbounded list from a
 * client would not be a validation nicety but a way to make a report FAIL TO SAVE — the exact silent
 * dead end this whole feature exists to remove. The caps are chosen to stay far under it.
 *
 * A field that arrives malformed is DROPPED rather than rejected. The alternative is refusing a real
 * problem report over a diagnostic detail nobody typed, which trades the user's one channel for our
 * tidiness.
 */
export function readContext(raw: unknown): ReportContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const b = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const n = (v: unknown) => {
    const num = Number(v);
    return Number.isFinite(num) && num > 0 && num < 100 ? Math.round(num * 100) / 100 : undefined;
  };

  const overflowRaw = Array.isArray(o.overflow) ? o.overflow.slice(0, MAX_OVERFLOW_FINDINGS) : [];
  const overflow = overflowRaw
    .map((f) => {
      const row = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      const element = s(row.element, 80);
      const px = Number(row.overflowPx);
      return element && Number.isFinite(px) ? { element, overflowPx: Math.round(px) } : null;
    })
    .filter((f): f is { element: string; overflowPx: number } => f !== null);

  const errors = (Array.isArray(o.errors) ? o.errors.slice(0, MAX_ERROR_LINES) : [])
    .map((e) => s(e, 200))
    .filter((e): e is string => !!e);

  return {
    view: s(o.view, 60),
    build: s(o.build, 40),
    appBuild: s(o.appBuild, 20),
    platform: s(o.platform, 20),
    userAgent: s(o.userAgent, 300),
    viewport: s(o.viewport, 20),
    dpr: n(o.dpr),
    online: b(o.online),
    connection: s(o.connection, 20),
    language: s(o.language, 20),
    ...(overflow.length ? { overflow } : {}),
    overflowScanned: b(o.overflowScanned),
    ...(o.overflowTruncated === true ? { overflowTruncated: true } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

/** The client already caps these; the server caps them again because the client is not the authority. */
const MAX_OVERFLOW_FINDINGS = 5;
const MAX_ERROR_LINES = 8;

export function registerReportRoutes(app: Express): void {
  /**
   * File a report. Sign-in required — an anonymous complaint cannot be followed up, and a report
   * nobody can be asked about is worth very little to the person being complained about either.
   */
  app.post(
    '/api/report',
    // A report costs nothing to send and everything to ignore, so the limit is generous — it exists to
    // stop a script filling the admin's queue, not to ration a user with a real problem.
    rateLimiter({ name: 'report', authed: 30, anon: 5, noun: 'reports' }),
    async (req: Request, res: Response) => {
      const me = await verifyFirebaseIdentity(req);
      if (!me?.uid) return res.status(401).json({ error: 'Sign in to send a report.' });

      const parsed = validateReport({
        message: req.body?.message,
        targetKind: req.body?.targetKind,
        targetId: req.body?.targetId,
        screenshot: req.body?.screenshot,
        problemKind: req.body?.problemKind,
      });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });

      // WHO this is about is decided HERE, never by the sender. For an app we look up its real owner;
      // for a user report the named uid is the subject, and an admin sees who filed it either way.
      let ownerUid: string | undefined;
      if (parsed.kind === 'app' && parsed.targetId) {
        try {
          const found = await getWebApp(parsed.targetId);
          if (!found) return res.status(404).json({ error: 'That app is not on the store.' });
          ownerUid = found.uid;
        } catch {
          return res.status(502).json({ error: 'Could not check that app just now. Please try again.' });
        }
      } else if (parsed.kind === 'user' && parsed.targetId) {
        ownerUid = parsed.targetId;
      }

      const report = buildReport({
        reporterUid: me.uid,
        target: { kind: parsed.kind, ...(parsed.targetId ? { id: parsed.targetId } : {}), ...(ownerUid ? { ownerUid } : {}) },
        message: parsed.message,
        ...(parsed.problemKind ? { problemKind: parsed.problemKind } : {}),
        hasScreenshot: !!parsed.screenshot,
        context: readContext(req.body?.context),
      });

      try {
        await saveReport(report, parsed.screenshot);
        res.json({ ok: true, id: report.id });
      } catch {
        // Honest: the user pressed send and it did not save. Never a silent success.
        res.status(502).json({ error: 'Could not send your report. Please try again in a moment.' });
      }
    },
  );

  /**
   * THE REPORTS THIS PERSON FILED, AND THE CONVERSATION ON EACH.
   *
   * ADMIN 2026-09-12, the other half of *"jisse uski help ho sake"*. Slice 1 made a report legible;
   * without this the reporter still writes into a void — nobody can ask them "which page?", nobody
   * can tell them it is fixed, and they learn nothing from having written in. That is how a report
   * box becomes a suggestion box that people stop using.
   *
   * 🔒 SCOPED TO THE VERIFIED uid, never a parameter. A report carries device details and whatever
   * somebody typed while upset; a list endpoint that took a uid would hand that to anyone who could
   * guess one. The screenshot is deliberately NOT included — the reporter already has it, and
   * shipping images into a list is how a phone on a slow connection stops loading the page at all.
   */
  app.get('/api/report/mine', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to see your reports.' });
    const rows = await listReportsByReporter(me.uid, 20);
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        at: r.at,
        status: r.status,
        problemKind: r.problemKind,
        message: r.message,
        messages: r.messages ?? [],
      })),
    });
  });

  /**
   * The reporter answers. Only on their OWN report, and the ownership check happens inside the
   * store's transaction against the stored document — see `addReportMessage`.
   *
   * A reply REOPENS the report. A conversation whose last word is the user's must come back to the
   * top of the admin's queue rather than stay filed under whatever it was marked before — otherwise
   * answering a question is the same as being ignored.
   */
  app.post(
    '/api/report/:id/reply',
    rateLimiter({ name: 'report-reply', authed: 60, anon: 0, noun: 'replies' }),
    async (req: Request, res: Response) => {
      const me = await verifyFirebaseIdentity(req);
      if (!me?.uid) return res.status(401).json({ error: 'Sign in to reply.' });
      const parsed = validateReplyPayload(req.body?.text, req.body?.screenshot);
      if (parsed.ok !== true) return res.status(400).json({ error: parsed.error });

      const reportId = String(req.params.id || '');
      // ⚠️ THE IMAGE IS STORED FIRST, AND THE ORDER IS THE POINT. If the message were appended first
      // and the image write then failed, the thread would carry a handle to a picture that does not
      // exist — a broken attachment on somebody's bug report, which is worse than no attachment. This
      // way a failed image write simply means the reply goes as text, and it SAYS so.
      let shotId = '';
      if (parsed.screenshot) {
        const candidate = newShotId();
        if (await saveReportMessageShot(reportId, candidate, parsed.screenshot)) shotId = candidate;
      }

      const messages = await addReportMessage(
        reportId,
        { from: 'user', text: parsed.text, at: Date.now(), ...(shotId ? { shotId } : {}) },
        { expectReporterUid: me.uid, reopen: true },
      );
      // 🔒 ONE ANSWER FOR "not yours" AND "does not exist". Telling them apart would let anyone probe
      // which report ids are real, and a report id is a handle on somebody else's complaint.
      if (!messages) return res.status(404).json({ error: 'That report could not be found.' });
      res.json({ ok: true, messages, imageSaved: parsed.screenshot ? !!shotId : undefined });
    },
  );

  /**
   * One message's screenshot, for the REPORTER.
   *
   * 🔒 OWNERSHIP IS RE-CHECKED HERE. This is a different route from the reply, so it needs its own
   * proof — an image endpoint that trusted the caller's possession of an id would be an IDOR with a
   * picture at the end of it, and report ids are not secrets.
   *
   * It is a JSON route rather than an `<img src>` because an image tag sends no auth header, and the
   * alternative — a signed public URL — would put somebody's screenshot behind a link that leaks the
   * moment it is pasted anywhere.
   */
  app.get('/api/report/:id/shot/:shotId', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in first.' });
    const id = String(req.params.id || '');
    const shotId = String(req.params.shotId || '');
    if (!isShotId(shotId)) return res.status(404).json({ error: 'Not found.' });

    const report = await getReport(id);
    // One answer for "not yours" and "no such thing", exactly as the reply route does.
    if (!report || report.reporterUid !== me.uid) return res.status(404).json({ error: 'Not found.' });

    const dataUrl = await getReportMessageShot(id, shotId);
    if (!dataUrl) return res.status(404).json({ error: 'Not found.' });
    res.set('Cache-Control', 'private, no-store');
    res.json({ dataUrl });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * The admin answers a reporter — and the reporter is actually TOLD, through the bell they already
   * have. A reply nobody notices is the same as no reply.
   *
   * ⚠️ THE NOTIFICATION IS BEST-EFFORT AND THE REPLY IS NOT. The message is stored first; if the
   * notification fails the admin still gets `ok: true` with `notified: false`, because losing the
   * admin's typed answer to a bell failure would be the worse outcome by far — and a silent `ok`
   * that hid the failure would leave them believing the user had been told.
   *
   * 🔒 WHITE-LABEL LAW: the reporter sees this as NavBharatAI. Nothing here carries an admin name,
   * an email, or which person answered.
   */
  app.post('/api/admin/reports/:id/reply', requireAdmin, async (req: Request, res: Response) => {
    const parsed = validateReplyPayload(req.body?.text, req.body?.screenshot);
    if (parsed.ok !== true) return res.status(400).json({ error: parsed.error });
    const id = String(req.params.id || '');

    const report = await getReport(id);
    if (!report) return res.status(404).json({ error: 'That report could not be found.' });

    // Same order, same reason as the reporter's route: an image that failed to save must not leave a
    // handle pointing at nothing.
    let shotId = '';
    if (parsed.screenshot) {
      const candidate = newShotId();
      if (await saveReportMessageShot(id, candidate, parsed.screenshot)) shotId = candidate;
    }

    const messages = await addReportMessage(id, {
      from: 'admin', text: parsed.text, at: Date.now(), ...(shotId ? { shotId } : {}),
    });
    if (!messages) return res.status(502).json({ error: 'Could not save that reply. Please try again.' });

    let notified = false;
    try {
      const saved = await saveNotification({
        message: 'NavBharatAI replied to your problem report. Open "Report a problem" to read it and answer.',
        target: { type: 'user', userId: report.reporterUid },
        createdBy: 'reports',
      });
      notified = !!saved;
    } catch {
      notified = false;
    }

    audit('REPORT_REPLY', { id, notified });
    res.json({ ok: true, messages, notified, imageSaved: parsed.screenshot ? !!shotId : undefined });
  });

  /** The same image, for the admin. Separate route, separate authorisation. */
  app.get('/api/admin/reports/:id/shot/:shotId', requireAdmin, async (req: Request, res: Response) => {
    const shotId = String(req.params.shotId || '');
    if (!isShotId(shotId)) return res.status(404).json({ error: 'Not found.' });
    const dataUrl = await getReportMessageShot(String(req.params.id || ''), shotId);
    if (!dataUrl) return res.status(404).json({ error: 'Not found.' });
    res.set('Cache-Control', 'private, no-store');
    res.json({ dataUrl });
  });

  /**
   * WHICH FEATURE IS BEING USED — platform-wide, for one day (admin 2026-09-13).
   *
   * The per-user panel answers "where did this person's balance go"; this answers the product
   * question the admin asked next: which feature to strengthen, and which to invest more work in.
   *
   * ⚠️ IT COUNTS FEATURE USAGE, NOT REVENUE — so a hosting-PLAN purchase is deliberately absent.
   * Buying a plan is one click, not use of a feature, and folding a ₹499 purchase in beside a day of
   * assistant turns would make the tallest bar the one nobody actually used. Plan purchases are
   * already visible as payments and entitlements on the account panel.
   */
  app.get('/api/admin/feature-spend', requireAdmin, async (req: Request, res: Response) => {
    const raw = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : spendDayKey();
    const rows = await featureSpendStore.day(date);
    // 🔒 An empty day and an unreadable one must not look alike: the card says which.
    res.json({ date, rows, totalInr: Math.round(rows.reduce((s, r) => s + r.inr, 0) * 100) / 100 });
  });

  /** Every report, newest first. `?status=open` narrows it. */
  app.get('/api/admin/reports', requireAdmin, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = await listReports({
      status: status === 'open' || status === 'reviewed' || status === 'actioned' || status === 'dismissed' ? status : undefined,
      limit: Math.max(1, Math.min(200, Number(req.query.limit) || 100)),
    });

    // BOTH PEOPLE, NAMED. A list of uids is not something an admin can act on — that lesson is already
    // written into adminUserLookup, and this is the screen that needs it most.
    const uids = [...new Set(rows.flatMap((r) => [r.reporterUid, r.target.ownerUid].filter(Boolean) as string[]))];
    const people = await resolveUserIdentities(uids, identityDb());
    res.json({
      reports: rows.map((r) => ({
        ...r,
        reporter: people.get(r.reporterUid) ?? null,
        reported: r.target.ownerUid ? people.get(r.target.ownerUid) ?? null : null,
        // The one thing that makes a conversation survive: a report whose LAST word is the user's is
        // owed an answer, whatever it was marked before. Without this the admin asks a question, the
        // user answers, and the answer is filed under "reviewed" where nobody looks again.
        awaitingReply: awaitingAdmin(r.messages),
      })),
    });
  });

  /** One report, with its screenshot and how many other reports name the same person. */
  app.get('/api/admin/reports/:id', requireAdmin, async (req: Request, res: Response) => {
    const report = await getReport(String(req.params.id || ''));
    if (!report) return res.status(404).json({ error: 'No such report.' });
    const [screenshot, people, againstCount] = await Promise.all([
      report.hasScreenshot ? getReportScreenshot(report.id) : Promise.resolve(null),
      resolveUserIdentities([report.reporterUid, report.target.ownerUid].filter(Boolean) as string[], identityDb()),
      report.target.ownerUid ? countReportsAgainst(report.target.ownerUid) : Promise.resolve(0),
    ]);
    res.json({
      report,
      reporter: people.get(report.reporterUid) ?? null,
      reported: report.target.ownerUid ? people.get(report.target.ownerUid) ?? null : null,
      // A single complaint and a tenth complaint about the same account are different situations, and
      // the admin should not have to count rows by hand to tell them apart.
      reportsAgainstReported: againstCount,
      screenshot,
    });
  });

  /**
   * ONE PERSON'S WHOLE ACCOUNT — what an admin needs before deciding anything (admin 2026-08-21).
   *
   * It lives beside the reports because that is the actual journey: read a complaint, open the person,
   * decide. Making the admin leave the complaint and hunt through another tab is how reports stop
   * getting handled at all.
   *
   * 🔒 A NUMBER WE COULD NOT READ IS NOT ZERO. Every section reports whether it was genuinely read.
   * This screen ends in a suspension: "0 recharges" because a query failed would show an admin a
   * person who never paid us a rupee, and they would act on it.
   */
  app.get('/api/admin/users/:uid/account', requireAdmin, async (req: Request, res: Response) => {
    const uid = String(req.params.uid || '').trim();
    if (!uid) return res.status(400).json({ error: 'Which user?' });

    const db = identityDb() as { collection?: (n: string) => { where: (f: string, op: string, v: unknown) => { limit: (n: number) => { get: () => Promise<{ docs: Array<{ data: () => unknown }> }> } } } } | null;

    // 🔒 LOGGED, BECAUSE WE PROMISED IT WOULD BE. The Privacy Policy (§8) tells every user that
    // "production access is limited, logged, and need-based". This screen is that access, so opening
    // it writes an audit line with the admin who opened it — the promise made true rather than stated.
    audit('ADMIN_USER_ACCOUNT_VIEW', { uid, ip: req.ip });

    const [identityMap, buildRows, deployments, wallet, payments, profile, aiLogs, sessions, authMap, pass] = await Promise.all([
      resolveUserIdentities([uid], identityDb()),
      userBuildHistoryStore.list(uid, { limit: 500 }).then((r) => ({ ok: true, rows: r })).catch(() => ({ ok: false, rows: [] })),
      deploymentStore.listByUser(uid, 100).then((r) => ({ ok: true, rows: r })).catch(() => ({ ok: false, rows: [] })),
      (async () => {
        try {
          const snap = await (db as never as { collection: (n: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }> } } })
            .collection('user_token_wallets').doc(uid).get();
          return { ok: true, data: snap.exists ? snap.data() : {} };
        } catch { return { ok: false, data: {} as Record<string, unknown> }; }
      })(),
      (async () => {
        try {
          // Single equality on userId — no composite index, the rule this repo already paid for once.
          const snap = await (db as never as { collection: (n: string) => { where: (f: string, op: string, v: unknown) => { limit: (n: number) => { get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }> } } } })
            .collection('payment_transactions').where('userId', '==', uid).limit(300).get();
          return { ok: true, rows: snap.docs.map((d) => d.data()) };
        } catch { return { ok: false, rows: [] as Record<string, unknown>[] }; }
      })(),
      // The user's OWN profile, shown back to them read-only. This screen never writes.
      (async () => {
        try {
          const snap = await (db as never as { collection: (n: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }> } } })
            .collection('user_profiles').doc(uid).get();
          return { ok: true, data: snap.exists ? snap.data() : null };
        } catch { return { ok: false, data: null as Record<string, unknown> | null }; }
      })(),
      // 🔒 HOW MUCH AND WHEN — NEVER WHAT. `ai_usage_logs` holds a tier, a timestamp and a token
      // count; it holds no message text, and none is read from anywhere else either. The Privacy
      // Policy says in §3 that team access is "restricted to what is needed to run the service, fix a
      // defect you reported, or meet a legal duty", and §5 promises the clinical surface is used only
      // for the user's own case. A browsable transcript viewer would contradict both — and the
      // decisions this screen ends in (suspend, refund, believe a complaint) turn on volume and
      // recency, not on what somebody typed.
      (async () => {
        try {
          // Single equality on userId — no composite index, the rule this repo already paid for once.
          const snap = await (db as never as { collection: (n: string) => { where: (f: string, op: string, v: unknown) => { limit: (n: number) => { get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }> } } } })
            .collection('ai_usage_logs').where('userId', '==', uid).limit(500).get();
          return { ok: true, rows: snap.docs.map((d) => d.data()) };
        } catch { return { ok: false, rows: [] as Record<string, unknown>[] }; }
      })(),
      // Devices, counted. The stored UA/IP HASHES never leave summariseDevices — re-publishing them
      // would hand back a stable per-user tracking key for no decision-making benefit.
      (async () => {
        try {
          const snap = await (db as never as { collection: (n: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }> } } })
            .collection('user_sessions').doc(uid).get();
          const devices = snap.exists ? (snap.data() as { devices?: unknown }).devices : null;
          return { ok: true, rows: Array.isArray(devices) ? devices : [] };
        } catch { return { ok: false, rows: [] as unknown[] }; }
      })(),
      fetchAuthMetadata([uid], await firebaseAuthBatch()).catch(() => new Map()),
      professionalPassStore.getStatus(uid).then((p) => ({ ok: true, ...p })).catch(() => ({ ok: false, active: false, expiresAt: null, plan: null })),
    ]);

    const builds = summariseBuilds(buildRows.rows as never[]);
    const money = summarisePayments(payments.rows as never[]);
    const reportsAgainst = await countReportsAgainst(uid).catch(() => 0);
    const w = wallet.data as Record<string, unknown>;

    const authMeta = authMap.get(uid) ?? null;
    const ai = summariseAiActivity(aiLogs.rows as never[]);
    const joined = resolveJoinedAt(authMeta, w.createdAt);
    const lastActive = resolveLastActiveAt(authMeta, { walletUpdatedAt: w.updatedAt, activityAtMs: ai.lastAtMs });
    const tier = activeHostingTier(w);

    res.json({
      identity: identityMap.get(uid) ?? null,
      // How the account was created and when it was last used. Firestore answers neither properly —
      // see adminUserActivity.ts for why Auth is the source and the wallet only a labelled fallback.
      account: {
        ok: authMap.size > 0,
        joinedAt: joined.atMs,
        joinedAtSource: joined.source,
        lastActiveAt: lastActive.atMs,
        lastActiveAtSource: lastActive.source,
        emailVerified: authMeta?.emailVerified ?? null,
        /** Firebase Auth's own disable flag — separate from our `banned`, and worth seeing both. */
        authDisabled: authMeta?.disabled ?? null,
        signInMethods: authMeta?.providers ?? [],
        phone: authMeta?.phone || '',
      },
      // `present: false` is a DIFFERENT statement from `ok: false`: the first means the user never
      // filled anything in, the second that we could not read the row. An admin must not read one as
      // the other — that is the same "unread is not zero" rule the wallet card already follows.
      profile: (() => {
        const view = profileView(profile.data);
        const base = view ? { ok: profile.ok, present: true, ...view } : { ok: profile.ok, present: false };
        // The +18 setting belongs on the account sheet as well as the Security list: an admin who
        // opens ONE person should not have to cross-reference a separate screen to see it.
        return { ...base, adult: adultPreferenceFrom({ optedIn: (profile.data as Record<string, unknown> | null)?.adultOptIn, optedInAt: (profile.data as Record<string, unknown> | null)?.adultOptInAt }) };
      })(),
      activity: {
        ok: aiLogs.ok,
        aiRequests: ai.requests,
        aiLast30Days: ai.last30Days,
        aiLastAt: ai.lastAtMs,
        byTier: ai.byTier,
        devices: { ok: sessions.ok, ...summariseDevices(sessions.rows as never[]) },
      },
      entitlements: {
        hostingPlan: tier ? { id: tier.id, name: tier.name } : null,
        hostingPlanExpiresAt: (w.hostingPlan as { expiresAt?: string } | undefined)?.expiresAt ?? null,
        professionalPass: pass.ok ? { active: pass.active, expiresAt: pass.expiresAt, plan: pass.plan } : null,
      },
      wallet: {
        ok: wallet.ok,
        tokenBalance: Number(w.tokenBalance ?? 0),
        remainingBalanceInr: Number(w.remaining_balance ?? 0),
        totalSpentInr: Number(w.total_money_spent ?? 0),
        banned: w.banned === true,
        banReason: typeof w.banReason === 'string' ? w.banReason : '',
        // 🔴 WHERE THE BALANCE WENT (admin 2026-09-13). This route already READ the whole wallet
        // document — the ledger was in its hand the entire time and was thrown away before the
        // response, which is why an admin looking at a drained account could only see that it was
        // drained. Nothing new is fetched here; a field is simply no longer discarded.
        spend: spendByFeature(Array.isArray(w.walletLedger) ? (w.walletLedger as never[]) : []),
        // The raw lines, newest first — the answer to "what happened on this account" when the
        // per-feature totals are not enough. Bounded so one account cannot make the response huge.
        ledger: (Array.isArray(w.walletLedger) ? (w.walletLedger as Array<Record<string, unknown>>) : [])
          .slice(-60)
          .reverse()
          .map((e) => ({
            type: typeof e?.type === 'string' ? e.type : '',
            feature: isWalletFeature(e?.feature) ? e.feature : null,
            featureLabel: featureLabel(e?.feature) || null,
            description: typeof e?.description === 'string' ? e.description.slice(0, 200) : '',
            tokens: Number.isFinite(Number(e?.amountCoinsOrTokens)) ? Number(e.amountCoinsOrTokens) : 0,
            at: typeof e?.timestamp === 'string' ? e.timestamp : '',
          })),
      },
      builds: { ok: buildRows.ok, ...builds },
      publishedApps: {
        ok: deployments.ok,
        count: deployments.rows.length,
        rows: deployments.rows.slice(0, 20).map((d: { url?: string; workspaceId?: string; status?: string; updatedAt?: number }) => ({
          url: d.url, workspaceId: d.workspaceId, status: d.status ?? 'active', updatedAt: d.updatedAt,
        })),
      },
      payments: { ok: payments.ok, ...money },
      reportsAgainst,
      // Few on purpose: a long list of amber flags trains an admin to ignore all of them.
      flags: accountFlags({ builds, payments: money, reportsAgainst }),
      // Said on the screen, not just in a comment: an admin should know what this panel deliberately
      // does not show, so an absent section is never mistaken for a user who has done nothing.
      withheld: 'Chat, prompt and clinical content is deliberately not shown here — the Privacy Policy limits team access to what running the service requires. Counts and times are.',
    });
  });

  /** Mark a report handled, with the admin's own note kept as the record of the decision. */
  app.post('/api/admin/reports/:id/status', requireAdmin, async (req: Request, res: Response) => {
    const status = String(req.body?.status || '');
    if (!['open', 'reviewed', 'actioned', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Unknown status.' });
    }
    const ok = await setReportStatus(
      String(req.params.id || ''),
      status as 'open' | 'reviewed' | 'actioned' | 'dismissed',
      typeof req.body?.note === 'string' ? req.body.note : undefined,
    );
    if (!ok) return res.status(502).json({ error: 'Could not update that report.' });
    res.json({ ok: true, status });
  });
}
