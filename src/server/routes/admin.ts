import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  appleDomainAssociation, appleDomainAssociationSource, APPLE_DOMAIN_ASSOCIATION_PATH,
} from '../lib/appleDomainAssociation';
import { diagnoseAppleSignIn, type AppleSelfFetch } from '../lib/appleSignInDiagnosis';
import { APPLE_SERVICE_ID, APPLE_WEB_RETURN_URL } from '../../components/socialSignInPolicy';
import { needsRealServer, builtAServer, tallyServerNecessity, necessityHeadline } from '../AgentV3/serverNecessity';
import type { Express, Request, Response, NextFunction } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Admin panel reads/writes admin_mfa +
// aggregates user_token_wallets / ai_usage_logs / payment_transactions (all server-side).
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, runTransaction, getServerDb as getDb } from '../lib/serverDb';
import { audit } from '../lib/audit';
import { TOKENS_PER_RUPEE } from '../lib/payments';
import { mergeWallets } from '../lib/accountMerge';
import { serverStats } from '../lib/serverStats';
import { getProviderStats } from '../AI/Router/AIRouter';
import { getMetrics } from '../lib/metrics';
import { metricsStore } from '../lib/metricsStore';
import { metricsTimeline } from '../lib/metricsTimeline';
import { usdInrRate } from '../lib/UsdInrRate';
import { agentV3CostTelemetry, buildUsageReport } from '../AgentV3/AgentV3CostTelemetry';
import { assistantSpendStore } from '../lib/AssistantSpendStore';
import { summarizeBuildFailures } from '../AgentV3/buildFailureAnalytics';
import { listAdminBuildReports, getAdminBuildReport, markAdminBuildReport, deleteAdminBuildReport, deleteAllAdminBuildReports } from '../AgentV3/AdminBuildReportStore';
import { listAllDiagnostics, listBuildFacts, listDiagnosticsHistory, getDiagnosticsHistoryItem, loadDiagnostics } from '../AgentV3/DiagnosticsStore';
import { resolveUserIdentities, identityFrom, identityLabel } from '../lib/adminUserLookup';
import { parseStatusFilter, parseDateFilter, sinceMsFor, buildMatchesFilters, statusCounts, usersInBuilds } from '../lib/buildListFilter';
import { sandboxStore } from '../AgentV3/SandboxStore';
import { tallyHandover, projectHandover, handoverHeadline, handoverSample } from '../AgentV3/sandboxHandover';
import { capSessionReports } from '../AgentV3/BuildDiagnostics';
import { firstPassStatsFromMeta, firstPassHeadline, FIRST_PASS_TARGET } from '../../lib/firstPassQuality';
import { builderScorecard, scorecardHeadline } from '../../lib/builderMetrics';
import { selectStaleDevices, canBroadcast, cohortSummary, updateBroadcastPayload } from '../lib/updateBroadcast';
import { deviceTokenStore } from '../lib/DeviceTokenStore';
import { sendPushToUser } from '../lib/PushNotificationService';

/**
 * The last update broadcast, so a second one for the same version is blocked as a misclick.
 * In-memory on purpose: it only has to survive long enough to stop a double-tap, and an instance
 * restart making the guard forgiving is far better than a persisted record making it wrong.
 */
let lastUpdateBroadcast: { versionCode: number | null; at: number; devices: number } | null = null;
import { saveNotification, normalizeTarget } from '../lib/AdminNotificationStore';
import { sonnetEquivalentUsd } from '../AgentV3/pricing';
import { evaluateAlerts } from '../lib/metricsAlerts';
import { computeHealthScore } from '../lib/HealthScore';
import { analyzeFinOps } from '../lib/FinOpsAdvisor';
import { generateInsights, generateOpsReport, answerMetricQuery } from '../lib/AiInsights';
import { assessDeployRisk, analyzeIncident } from '../AppMakerLab/deployment/DeployRiskAdvisor';
import { releaseGateStore } from '../lib/ReleaseGateStore';
import { normalizeGateConfig } from '../lib/ReleaseGate';
import { aggregateProviderLatency, type SpanLike } from '../lib/Percentiles';
import { tracer } from '../observability/Tracer';
import { analyzeSeries, type Point } from '../lib/AnomalyDetector';
import { logStore } from '../lib/logStore';
import { eventStore } from '../lib/eventStore';
import { rotateAllSecrets, getLatestKeyVersion, encrypt, decrypt } from '../lib/secrets';
import { generateTotpSecret, verifyTotp, totpAuthUri } from '../lib/totp';
import { deploymentStore, type DeploymentStatus } from '../AgentV3/DeploymentStore';
import { FirebaseHostingDeployer } from '../AgentV3/Deployment';
import { classifyChannels, channelCeilingVerdict, channelCap } from '../AgentV3/channelInventory';
import { adminLockoutEnabled, checkAdminLock, recordAdminFail, recordAdminSuccess } from '../lib/adminLoginGuard';

/**
 * Admin dashboard routes extracted from the server.ts monolith (Phase 1).
 * Behavior unchanged. All routes are gated by the HMAC day-token middleware.
 */
/** Constant-time comparison for secret material (sha256/HMAC hex digests, tokens). */
// The admin auth primitives live in lib/adminAuth (audit finding #3) so any route can import the
// REAL gate instead of hand-rolling a weaker one. Re-exported here because existing callers and tests
// import them from this module.
export {
  adminTokenTtlMs,
  mintAdminToken,
  verifyAdminTokenValue,
  adminCredential,
  safeStrEqual,
} from '../lib/adminAuth';
import {
  adminTokenTtlMs,
  mintAdminToken,
  verifyAdminTokenValue,
  adminCredential,
  safeStrEqual,
  adminUsername,
  adminPassword,
} from '../lib/adminAuth';

// ── P-SEC.3 — Admin TOTP MFA ───────────────────────────────────────────────
// Second factor for admin-panel access. The active secret resolves from either an
// env override (`ADMIN_TOTP_SECRET`, zero-config, always-on) OR a self-service
// enrolment stored ENCRYPTED in Firestore `admin_mfa/config`. When a secret is
// active, `/api/admin/login` requires a valid 6-digit code in addition to the
// password. Backward-compatible: with no env var and no enrolment, MFA is simply
// off and login behaves exactly as before.
const ADMIN_MFA_DOC = 'admin_mfa';
const ADMIN_MFA_ID = 'config';

interface AdminMfaState { enabled: boolean; secret: string | null; envManaged: boolean }

/** Resolve the ACTIVE admin TOTP state (env override wins; else Firestore enrolment). */
async function getAdminMfa(): Promise<AdminMfaState> {
  const env = (process.env.ADMIN_TOTP_SECRET || '').trim();
  if (env) return { enabled: true, secret: env, envManaged: true };
  const db = getDb() as any;
  if (!db) return { enabled: false, secret: null, envManaged: false };
  try {
    const snap = await getDoc(doc(db, ADMIN_MFA_DOC, ADMIN_MFA_ID));
    const data = snap.exists() ? snap.data() : null;
    if (data?.enabled && data?.encrypted_secret) {
      const secret = decrypt(data.encrypted_secret);
      if (secret) return { enabled: true, secret, envManaged: false };
    }
  } catch (err) {
    console.error('[ADMIN_MFA] state read failed:', err);
  }
  return { enabled: false, secret: null, envManaged: false };
}

export function registerAdminRoutes(app: Express, adminLimiter: RateLimitRequestHandler): void {
  // Admin server-side login — issues the daily HMAC token used by verifyAdminToken.
  app.post('/api/admin/login', adminLimiter, async (req: Request, res: Response) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const totpCode = String(req.body?.totp || '').trim();
    const validUser = adminUsername();
    const validPass = adminPassword();
    const clientIp = String(req.ip || 'unknown');

    // SEC (admin 2026-07-19) — escalating brute-force lockout ON TOP of the 5/min IP rate limiter.
    // Once an IP crosses the failure threshold, each further attempt is refused for a window that
    // grows with the failure count (1m → 2m → 4m … capped at 30m). A correct login clears it, and
    // it is per-IP so an attacker can only lock their OWN IP, never the real admin's account.
    if (adminLockoutEnabled()) {
      const lock = checkAdminLock(clientIp);
      if (lock.locked) {
        const retryAfterSec = Math.ceil(lock.retryAfterMs / 1000);
        audit('ADMIN_LOGIN_LOCKED', { ip: clientIp, retryAfterSec });
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ error: 'Too many failed attempts. Try again later.', retryAfterSec });
      }
    }

    if (!validPass) {
      audit('ADMIN_LOGIN_BLOCKED', { reason: 'ADMIN_PASSWORD not set', ip: req.ip });
      return res.status(503).json({ error: 'Admin access not configured on server.' });
    }

    const passHash    = crypto.createHash('sha256').update(password).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(validPass).digest('hex');

    // Do NOT log the admin username or password length — both narrow a brute-force search.
    console.log('[ADMIN_LOGIN] login attempt received');

    if (username === validUser && safeStrEqual(passHash, expectedHash)) {
      // P-SEC.3 — second factor: if MFA is active, require a valid TOTP code BEFORE the
      // token is issued. A correct password alone is not enough once MFA is enrolled.
      const mfa = await getAdminMfa();
      if (mfa.enabled && mfa.secret) {
        if (!totpCode) {
          audit('ADMIN_LOGIN_MFA_REQUIRED', { username, ip: req.ip });
          return res.status(401).json({ error: 'Authenticator code required.', mfaRequired: true });
        }
        if (!verifyTotp(mfa.secret, totpCode)) {
          audit('ADMIN_LOGIN_MFA_FAILED', { username, ip: req.ip });
          serverStats.failedLogins++;
          // A correct password with a wrong TOTP is still a failed attempt — count it toward the
          // lockout so TOTP guessing (1M codes) also gets throttled, not just password guessing.
          if (adminLockoutEnabled()) recordAdminFail(clientIp);
          return res.status(401).json({ error: 'Invalid authenticator code.', mfaRequired: true });
        }
      }
      // Full success (password + MFA if enabled) — clear this IP's failure history immediately so a
      // legitimate admin who mistyped earlier is never left waiting out a lock.
      if (adminLockoutEnabled()) recordAdminSuccess(clientIp);
      // SEC Phase 5 (F8): a TIME-STAMPED token with a 30-day TTL (was a static, never-expiring HMAC).
      // The issued-at is signed in, so a leaked token now expires instead of granting permanent access.
      const token = mintAdminToken(validPass, username, Date.now());
      audit('ADMIN_LOGIN_SUCCESS', { username, ip: req.ip, mfa: mfa.enabled });
      return res.json({ ok: true, token });
    }

    audit('ADMIN_LOGIN_FAILED', { username, ip: req.ip });
    serverStats.failedLogins++;
    serverStats.failedLoginIPs.push({ ip: String(req.ip), time: Date.now(), username });
    if (serverStats.failedLoginIPs.length > 100) serverStats.failedLoginIPs.shift();
    if (adminLockoutEnabled()) recordAdminFail(clientIp);
    return res.status(401).json({ error: 'Invalid credentials.' });
  });

  // Admin token verification middleware
  const verifyAdminToken = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['x-admin-token'] as string;
    const validPass = adminPassword();
    if (!validPass || !token) return res.status(401).json({ error: 'Admin token required.' });
    // SEC Phase 5 (F8): verify the signature AND the TTL — an expired/legacy/forged token is rejected
    // (the admin re-logs in; their password still works). A 401 (not 403) on expiry so the client
    // knows to prompt for login rather than treat it as a permissions error.
    if (!verifyAdminTokenValue(token, validPass, adminUsername(), Date.now(), adminTokenTtlMs(process.env.ADMIN_TOKEN_TTL_HOURS))) {
      audit('ADMIN_ACCESS_DENIED', { ip: req.ip, path: req.path });
      return res.status(401).json({ error: 'Admin session expired — please log in again.' });
    }
    next();
  };

  // ── P-SEC.3 — Admin MFA management (TOTP enrol / verify / disable / status) ──
  // All require a valid admin session (verifyAdminToken). Self-service enrolment
  // stores the secret ENCRYPTED in Firestore; an env-managed secret is read-only here.

  app.get('/api/admin/mfa/status', verifyAdminToken, async (_req: Request, res: Response) => {
    const mfa = await getAdminMfa();
    res.json({ enabled: mfa.enabled, envManaged: mfa.envManaged });
  });

  // Begin enrolment: generate a fresh secret, store it as PENDING (encrypted), return the
  // otpauth URI + the base32 key (for the user to add to their authenticator app). Not yet
  // active until /verify confirms the user can produce a valid code.
  app.post('/api/admin/mfa/enroll', verifyAdminToken, async (_req: Request, res: Response) => {
    const mfa = await getAdminMfa();
    if (mfa.envManaged) {
      return res.status(409).json({ error: 'MFA is managed by ADMIN_TOTP_SECRET on the server and cannot be re-enrolled here.' });
    }
    const db = getDb() as any;
    if (!db) return res.status(503).json({ error: 'Database unavailable — cannot enrol MFA.' });
    const secret = generateTotpSecret();
    const label = `NavBharatAI:${adminUsername()}`;
    try {
      await setDoc(doc(db, ADMIN_MFA_DOC, ADMIN_MFA_ID), {
        enabled: false,
        encrypted_pending: encrypt(secret),
        updated_at: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      console.error('[ADMIN_MFA] enrol write failed:', err);
      return res.status(500).json({ error: 'Failed to start MFA enrolment.' });
    }
    res.json({ secret, otpauthUri: totpAuthUri(secret, label, 'NavBharatAI') });
  });

  // Confirm enrolment (or rotation): a valid code against the PENDING secret promotes it to
  // the ACTIVE secret and turns MFA on.
  app.post('/api/admin/mfa/verify', verifyAdminToken, async (req: Request, res: Response) => {
    const code = String(req.body?.code || '').trim();
    const db = getDb() as any;
    if (!db) return res.status(503).json({ error: 'Database unavailable.' });
    try {
      const snap = await getDoc(doc(db, ADMIN_MFA_DOC, ADMIN_MFA_ID));
      const data = snap.exists() ? snap.data() : null;
      const pending = data?.encrypted_pending ? decrypt(data.encrypted_pending) : '';
      if (!pending) return res.status(400).json({ error: 'No pending enrolment. Start enrolment first.' });
      if (!verifyTotp(pending, code)) {
        audit('ADMIN_MFA_VERIFY_FAILED', { ip: req.ip });
        return res.status(401).json({ error: 'Invalid code. Try again.' });
      }
      await setDoc(doc(db, ADMIN_MFA_DOC, ADMIN_MFA_ID), {
        enabled: true,
        encrypted_secret: encrypt(pending),
        encrypted_pending: '',
        enrolled_at: new Date().toISOString(),
      }, { merge: true });
      audit('ADMIN_MFA_ENABLED', { ip: req.ip });
      res.json({ ok: true, enabled: true });
    } catch (err) {
      console.error('[ADMIN_MFA] verify failed:', err);
      res.status(500).json({ error: 'Failed to verify MFA.' });
    }
  });

  // Disable MFA: requires a valid CURRENT code (so a hijacked session can't silently strip it).
  app.post('/api/admin/mfa/disable', verifyAdminToken, async (req: Request, res: Response) => {
    const code = String(req.body?.code || '').trim();
    const mfa = await getAdminMfa();
    if (mfa.envManaged) {
      return res.status(409).json({ error: 'MFA is managed by ADMIN_TOTP_SECRET on the server and cannot be disabled here.' });
    }
    if (!mfa.enabled || !mfa.secret) return res.json({ ok: true, enabled: false });
    if (!verifyTotp(mfa.secret, code)) {
      audit('ADMIN_MFA_DISABLE_FAILED', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid code — cannot disable MFA.' });
    }
    const db = getDb() as any;
    if (!db) return res.status(503).json({ error: 'Database unavailable.' });
    try {
      await setDoc(doc(db, ADMIN_MFA_DOC, ADMIN_MFA_ID), {
        enabled: false, encrypted_secret: '', encrypted_pending: '',
        disabled_at: new Date().toISOString(),
      }, { merge: true });
      audit('ADMIN_MFA_DISABLED', { ip: req.ip });
      res.json({ ok: true, enabled: false });
    } catch (err) {
      console.error('[ADMIN_MFA] disable failed:', err);
      res.status(500).json({ error: 'Failed to disable MFA.' });
    }
  });

  // Observability: live token-usage/cost + build-success metrics (Phase 5, item 28).
  // Phase 4.3 — include triggered alerts (error rate / preview rate / latency) so
  // the admin panel surfaces health issues, not just raw numbers.
  app.get('/api/admin/metrics', verifyAdminToken, (_req: Request, res: Response) => {
    const snapshot = getMetrics().snapshot();
    res.json({ ...snapshot, alerts: evaluateAlerts(snapshot) });
  });

  // P-MON.4 — composite Health / Reliability / Risk score (0–100) from REAL live signals:
  // build success rate (metrics registry), aggregate provider error rate + latency
  // (AIRouter circuit stats), and process uptime. Honest by construction — any signal
  // with no real data drops out (reported in `missing`); none is fabricated.
  app.get('/api/admin/health-score', verifyAdminToken, (_req: Request, res: Response) => {
    const snap = getMetrics().snapshot();
    const provider = getProviderStats();

    // Aggregate provider error rate + request-weighted average latency from real counters.
    let totalReq = 0;
    let totalErr = 0;
    let latencyWeighted = 0;
    for (const s of Object.values(provider)) {
      totalReq += s.requestCount || 0;
      totalErr += s.errorCount || 0;
      latencyWeighted += (s.avgLatencyMs || 0) * (s.requestCount || 0);
    }
    const inputs = {
      // Build success rate is real only once at least one build has run.
      successRatePct: snap.builds.total > 0 ? snap.builds.successRate * 100 : null,
      // Provider error rate + latency are real only once at least one AI call has run.
      errorRatePct: totalReq > 0 ? (totalErr / totalReq) * 100 : null,
      avgLatencyMs: totalReq > 0 ? latencyWeighted / totalReq : null,
      uptimeSeconds: process.uptime(),
    };
    res.json({
      score: computeHealthScore(inputs),
      inputs,
      sources: {
        successRatePct: 'metrics.builds (live build outcomes)',
        errorRatePct: 'AIRouter provider circuit stats',
        avgLatencyMs: 'AIRouter provider circuit stats (request-weighted)',
        uptimeSeconds: 'process.uptime()',
      },
      generatedAt: Date.now(),
    });
  });

  // P-MON.3 — admin "AI Observability" view: per-provider inference-latency percentiles
  // (p50/p90/p95/p99) + error rate, from the REAL `ai.provider.*` trace spans. Mirrors the
  // /api/observability/llm data on the x-admin-token scheme the dashboard uses.
  app.get('/api/admin/llm-latency', verifyAdminToken, (req: Request, res: Response) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const traces = tracer.recentTraces(limit);
    const spans: SpanLike[] = [];
    for (const tr of traces) {
      for (const s of tr.spans) spans.push({ name: s.name, durationMs: s.durationMs, status: s.status, attributes: s.attributes });
    }
    const providers = aggregateProviderLatency(spans);
    res.json({
      tracesScanned: traces.length,
      providerSampleCount: providers.reduce((a, p) => a + p.latency.count, 0),
      providers,
      generatedAt: Date.now(),
    });
  });

  // P-MON.2 — latency anomaly/trend watch over the REAL recent per-trace durations
  // (z-score + EWMA anomalies, linear trend, short forecast). x-admin-token scheme for the dashboard.
  app.get('/api/admin/anomaly/latency', verifyAdminToken, (req: Request, res: Response) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const series: Point[] = tracer.recentTraces(limit).map((tr) => ({ t: tr.startMs, v: tr.durationMs }));
    res.json({ source: 'trace-latency', sampleCount: series.length, ...analyzeSeries(series), generatedAt: Date.now() });
  });

  // P-MON.6 — FinOps recommendations derived from the REAL live metrics snapshot
  // (spend on failed builds, low preview rate, repair-loop cost, provider concentration,
  // per-request cost outliers). No hardcoded prices, no projections — observed waste only.
  app.get('/api/admin/finops', verifyAdminToken, (_req: Request, res: Response) => {
    res.json({ ...analyzeFinOps(getMetrics().snapshot()), generatedAt: Date.now() });
  });

  // P-MON.5 — AI insights + ops report, deterministically derived from the real MetricsSnapshot
  // (no hallucination, no projections). Honest "no telemetry yet" when nothing has been recorded.
  app.get('/api/admin/insights', verifyAdminToken, (req: Request, res: Response) => {
    const snap = getMetrics().snapshot();
    const period = typeof req.query.period === 'string' ? req.query.period : 'current window';
    res.json({
      insights: generateInsights(snap),
      report: generateOpsReport(snap, period),
      generatedAt: Date.now(),
    });
  });

  // P-MON.5 — natural-language telemetry query. Recognized-intent resolver over the real snapshot;
  // an unrecognized question returns matched:false with an honest capability list (never a guess).
  app.post('/api/admin/insights/query', verifyAdminToken, (req: Request, res: Response) => {
    const question = typeof req.body?.question === 'string' ? req.body.question : '';
    if (!question.trim()) return res.status(400).json({ error: 'A "question" string is required.' });
    res.json({ ...answerMetricQuery(getMetrics().snapshot(), question), generatedAt: Date.now() });
  });

  // P-DEPLOY.3 — AIOps: deterministic pre-deploy risk score from real change signals.
  app.post('/api/admin/deploy-risk', verifyAdminToken, (req: Request, res: Response) => {
    const b = req.body ?? {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    res.json({
      ...assessDeployRisk({
        filesChanged: num(b.filesChanged), linesAdded: num(b.linesAdded), linesRemoved: num(b.linesRemoved),
        criticalFilesTouched: num(b.criticalFilesTouched), testFilesChanged: num(b.testFilesChanged),
        ciGreen: typeof b.ciGreen === 'boolean' ? b.ciGreen : undefined,
      }),
      generatedAt: Date.now(),
    });
  });

  // P-DEPLOY.3 — AIOps: incident/RCA analysis correlating deploy + error events.
  app.post('/api/admin/incident-analysis', verifyAdminToken, (req: Request, res: Response) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    res.json({ ...analyzeIncident(events), generatedAt: Date.now() });
  });

  // P-DEPLOY.5 — read/update the release freeze/approval gate (admin-gated).
  app.get('/api/admin/release-gate', verifyAdminToken, async (_req: Request, res: Response) => {
    res.json({ config: await releaseGateStore.get(), generatedAt: Date.now() });
  });
  app.post('/api/admin/release-gate', verifyAdminToken, async (req: Request, res: Response) => {
    const config = normalizeGateConfig({ ...(req.body ?? {}), updatedAtMs: Date.now(), updatedBy: 'admin' });
    const ok = await releaseGateStore.set(config);
    if (!ok) return res.status(503).json({ error: 'Could not persist the release gate (storage unavailable).' });
    res.json({ ok: true, config });
  });

  // ── MONITOR (2026-08-23) — the admin home page's single data call. ────────────────────────────
  //
  // WHY ONE ENDPOINT. The Monitor is the first screen the admin sees, and it needs the live snapshot,
  // the alerts, the health score, the FinOps waste findings, the provider circuit state AND the
  // time-series all at once. Ten separate round trips on page load is a slow home page; one call is
  // a fast one.
  //
  // WHY IT DUPLICATES NOTHING. Every field below is produced by the SAME shared function the
  // dedicated endpoint uses (getMetrics / evaluateAlerts / computeHealthScore / analyzeFinOps /
  // getProviderStats). This route composes, it does not re-implement — so the Monitor and the
  // detailed tabs can never tell the admin two different stories about one number.
  //
  // HONESTY. `timeline.available:false` means the time-series store could not be read; the client
  // MUST show that as unknown rather than drawing a flat zero line. A section that throws is
  // returned as null with its reason, so one broken panel never blanks the whole page.
  app.get('/api/admin/monitor', verifyAdminToken, async (req: Request, res: Response) => {
    const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? '6'), 10) || 6, 1), 168);
    const snapshot = getMetrics().snapshot();

    // Each section is independently guarded: a failure in one must not blank the whole home page.
    const guard = <T>(fn: () => T): { value: T | null; error: string | null } => {
      try { return { value: fn(), error: null }; } catch (err: any) {
        return { value: null, error: err?.message || 'unavailable' };
      }
    };

    const timeline = await metricsTimeline.series(hours).catch(() => null);

    // LIVE SANDBOXES — the number that answers "what is running right now", and the one that is
    // actually costing money this second (a running E2B VM bills by wall-clock; a paused one does not).
    //
    // Read from the DURABLE sandbox records, not from the in-process active-build map: that map lives
    // in one Cloud Run instance's memory, so a tile built on it would show a different number depending
    // on which instance answered the request — worse than no tile, because it looks authoritative.
    // null (not 0) when the store cannot be read, so the UI shows "—" rather than a confident zero.
    const liveSandboxes = await sandboxStore.listRecent(200)
      .then((records) => records.filter((r) => !r.pausedAt).length)
      .catch(() => null);
    const providerStats = guard(() => getProviderStats());

    // The same composite health inputs the dedicated /health-score endpoint reports, from the same
    // real signals. Kept identical on purpose — two health numbers would be worse than none.
    const health = guard(() => {
      const provider = providerStats.value ?? {};
      let totalReq = 0;
      let totalErr = 0;
      let latencyWeighted = 0;
      for (const st of Object.values(provider) as any[]) {
        totalReq += st.requestCount || 0;
        totalErr += st.errorCount || 0;
        latencyWeighted += (st.avgLatencyMs || 0) * (st.requestCount || 0);
      }
      const inputs = {
        successRatePct: snapshot.builds.total > 0 ? snapshot.builds.successRate * 100 : null,
        errorRatePct: totalReq > 0 ? (totalErr / totalReq) * 100 : null,
        avgLatencyMs: totalReq > 0 ? latencyWeighted / totalReq : null,
        uptimeSeconds: process.uptime(),
      };
      return { score: computeHealthScore(inputs), inputs };
    });

    res.json({
      generatedAt: Date.now(),
      windowHours: hours,
      // The live conversion rate, so the client shows ₹ from one shared source instead of hardcoding
      // a rate that would silently drift away from what the user is actually billed.
      usdInr: usdInrRate(),
      // Cumulative since THIS instance booted — labelled as such by the client, because a Cloud Run
      // deploy resets it and a number that silently restarts at zero reads as an outage.
      snapshot,
      instanceUptimeSeconds: Math.round(process.uptime()),
      liveSandboxes,
      alerts: guard(() => evaluateAlerts(snapshot)).value ?? [],
      health: health.value,
      healthError: health.error,
      finops: guard(() => analyzeFinOps(snapshot)).value,
      insights: guard(() => generateInsights(snapshot)).value ?? [],
      providers: providerStats.value ?? {},
      providersError: providerStats.error,
      timeline: timeline ?? {
        available: false, hasData: false, bucketMs: 0, from: 0, to: 0,
        points: [], summary: null, providers: {},
      },
    });
  });

  // G2 — daily metrics history (last N days of persisted MetricsSnapshots).
  app.get('/api/admin/metrics/history', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 90);
      const history = await metricsStore.list(days);
      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read metrics history.' });
    }
  });

  // AgentV3 cost-ladder telemetry (P2 measurement): per-day cost & quality broken
  // down by task type and start tier, so cheap-tier savings + success rate are
  // visible (the P8 cutover gate needs this). Read-only aggregates; admin-only.
  app.get('/api/admin/agentv3/cost-telemetry', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
      const history = await agentV3CostTelemetry.list(days);
      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read AgentV3 cost telemetry.' });
    }
  });

  // ASSISTANT SPEND — what the Professionals / Doctor AI / Other-AI tools cost us, and the free-model
  // share that is the early warning behind it. The rupee total moves with traffic and so says little;
  // the SHARE is flat at ~100% while the free tier-1 leader carries turns and collapses the day it
  // stops, which is a vendor decision we do not control and that breaks nothing visible when it lands.
  // Admin-only: the payload names models and providers (White-Label Law §3 — never a user surface).
  app.get('/api/admin/assistant-spend', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '14'), 10) || 14, 1), 365);
      res.json(await assistantSpendStore.summary(days));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read assistant spend.' });
    }
  });

  // Billing Phase 3 — per-provider usage report: tokens per provider, Sonnet-equivalent real-cost
  // baseline, revenue billed, and the achieved margin. Admin-only (never exposes per-provider costs to
  // users). The baseline OVER-states cheap-provider cost, so real margin is at least what's shown.
  app.get('/api/admin/agentv3/usage-report', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
      const history = await agentV3CostTelemetry.list(days);
      res.json(buildUsageReport(history, sonnetEquivalentUsd));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build AgentV3 usage report.' });
    }
  });

  // T1-admin-dashboard — build-FAILURE analytics: per-day failure rate + upward spike dates, from the
  // same daily cost-telemetry aggregates. Surfaces the reliability half of "build/cost/failure".
  app.get('/api/admin/agentv3/build-analytics', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
      const history = await agentV3CostTelemetry.list(days);
      res.json(summarizeBuildFailures(history));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build AgentV3 failure analytics.' });
    }
  });

  // Billing Phase 3 — losses: builds that spent real provider tokens but were zeroed (empty build /
  // unrendered preview / free onboarding), so NavBharatAI absorbed the cost. Per-day loss count +
  // Sonnet-equivalent cost eaten, so the admin can see the price of the "preview is EARNED" policy.
  app.get('/api/admin/agentv3/losses', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
      const history = await agentV3CostTelemetry.list(days);
      const perDay = history.map(d => ({ date: d.date, lossBuilds: d.lossBuilds ?? 0, lossRealCostUsd: d.lossRealCostUsd ?? 0 }));
      const totalLossBuilds = perDay.reduce((s, d) => s + d.lossBuilds, 0);
      const totalLossRealCostUsd = Math.round(perDay.reduce((s, d) => s + d.lossRealCostUsd, 0) * 1_000_000) / 1_000_000;
      res.json({ totalLossBuilds, totalLossRealCostUsd, perDay });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read AgentV3 losses.' });
    }
  });

  // Build Reports inbox (admin 2026-07-29): the reports users submit via the single "Report" button.
  // Admin-only — the user never sees report content; this is where the admin reads/downloads it.
  app.get('/api/admin/build-reports', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      const reports = await listAdminBuildReports(limit);
      res.json({ reports });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load build reports.' });
    }
  });

  // FIRST-PASS QUALITY (ROADMAP #1 Phase 0.2) — the one number that says whether the ENGINE is getting
  // better, not just whether the heals are. Per the fifth absolute rule's 50/50 law a self-heal is a RED
  // FLAG, so the headline is the CLEAN rate (builds that needed zero repairs), never the delivered rate.
  // `topHealCodes` is the actionable half: each entry is an upstream bug to prevent so that heal becomes
  // dead code. Admin-only — this is internal engine quality, never a user-facing surface.
  app.get('/api/admin/first-pass-quality', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);
      /**
       * IT WAS MEASURING COMPLAINTS, NOT BUILDS (admin screenshot 2026-08-12, showing 4.3%).
       *
       * This endpoint's own comment above calls it "the one number that says whether the ENGINE is
       * getting better" — and it read `listAdminBuildReports`, which is the inbox of reports USERS
       * SUBMITTED by pressing "Report". People press Report when something went WRONG. So the sample
       * was self-selected for failure, and the headline read as an engine-wide rate.
       *
       * "4.3% of builds are right first time" and "4.3% of the builds people complained about were
       * right first time" are different sentences, and only the second one was ever true. This is the
       * same defect class as TIME_TO_FIRST_CALL blaming setup for a model's latency: a number measured
       * off the wrong source, presented with total confidence.
       *
       * ALL BUILDS is now the headline, read from the engine's own durable record of every build by
       * every user — no submit needed. The reported-only figure is kept ALONGSIDE it rather than
       * deleted, because the GAP between the two is itself the signal: complaints far below the
       * engine-wide rate is healthy self-selection; the two being equal would mean users are reporting
       * a fair sample, which is much worse news.
       */
      const [allBuilds, reports] = await Promise.all([
        listAllDiagnostics(limit).catch(() => []),
        listAdminBuildReports(limit).catch(() => []),
      ]);
      /**
       * THE TWO SOURCES SPEAK DIFFERENT SHAPES, AND THE MISMATCH IS SILENT.
       *
       * `firstPassStatsFromMeta` reads the ADMIN-REPORT projection (`healCount` / `unresolvedCount`);
       * the engine's own build record carries the same two numbers under `counts.autoResolved` /
       * `counts.unresolved`. Passing the second straight in type-checks — every field is optional — and
       * then classifies EVERY delivered build as "legacy, no counts recorded", leaving only the
       * `ok === false` rows to be counted. The card would have read close to 100% failed.
       *
       * That would have been a worse lie than the one being fixed here, and it would have looked just
       * as confident. Mapped explicitly, at the one place the two vocabularies meet.
       */
      const stats = firstPassStatsFromMeta(allBuilds.map((b) => ({
        ok: b.ok,
        healCount: b.counts?.autoResolved,
        unresolvedCount: b.counts?.unresolved,
      })));
      const reported = firstPassStatsFromMeta(reports);
      res.json({
        ...stats,
        headline: firstPassHeadline(stats),
        source: 'all-builds',
        // Named for what it is. A field called `reported` sitting beside the headline is what stops
        // the next reader from quietly assuming the two were ever the same population.
        reported: { ...reported, headline: firstPassHeadline(reported) },
        target: FIRST_PASS_TARGET,
        window: limit,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to compute first-pass quality.' });
    }
  });

  // UPDATE BROADCAST (admin 2026-08-11) — tell the users who are actually BEHIND that a new build is
  // on Play. The in-app banner (#2279) only reaches someone who opens the app; this reaches the person
  // who has not opened it in three weeks, which is exactly the person who needs telling.
  //
  // IT IS NOT A BLAST TO EVERYONE, and that is the whole design. Notifying people who already updated
  // is how a notification channel dies: tell someone on the newest build to "please update" once and
  // they stop reading the next one. Targeting lives in updateBroadcast.ts and is unit-tested.
  //
  // Two routes on purpose: PREVIEW is safe to call and tells the admin exactly who would be reached
  // and who is excluded; SEND requires that same count back, so a stale dashboard cannot fire at a
  // cohort the admin never saw.
  app.get('/api/admin/update-broadcast/preview', verifyAdminToken, async (_req: Request, res: Response) => {
    try {
      const latest = Number.parseInt(String(process.env.ANDROID_LATEST_VERSION_CODE ?? '').trim(), 10);
      const latestVersionCode = Number.isFinite(latest) && latest > 0 ? latest : null;
      const { rows, truncated } = await deviceTokenStore.listAllTokens();
      const cohort = selectStaleDevices(rows, latestVersionCode);
      res.json({
        latestVersionCode,
        versionName: (process.env.ANDROID_LATEST_VERSION_NAME || '').trim() || null,
        targetCount: cohort.targets.length,
        upToDate: cohort.upToDate,
        unknownVersion: cohort.unknownVersion,
        wrongPlatform: cohort.wrongPlatform,
        // An honest reach, not an implied one: say when the device scan hit its cap.
        truncated,
        summary: cohortSummary(cohort, latestVersionCode),
        lastBroadcast: lastUpdateBroadcast,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not compute the update cohort.' });
    }
  });

  app.post('/api/admin/update-broadcast/send', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const latest = Number.parseInt(String(process.env.ANDROID_LATEST_VERSION_CODE ?? '').trim(), 10);
      const latestVersionCode = Number.isFinite(latest) && latest > 0 ? latest : null;
      const confirmRaw = (req.body || {}).confirmCount;
      const confirmCount = typeof confirmRaw === 'number' && Number.isFinite(confirmRaw) ? confirmRaw : null;

      const { rows } = await deviceTokenStore.listAllTokens();
      const cohort = selectStaleDevices(rows, latestVersionCode);
      const gate = canBroadcast({
        targetCount: cohort.targets.length,
        confirmCount,
        latestVersionCode,
        lastBroadcastVersionCode: lastUpdateBroadcast?.versionCode ?? null,
        lastBroadcastAt: lastUpdateBroadcast?.at ?? null,
        now: Date.now(),
      });
      if (!gate.allowed) { res.status(409).json({ sent: 0, blocked: true, reason: gate.reason }); return; }

      const payload = updateBroadcastPayload((process.env.ANDROID_LATEST_VERSION_NAME || '').trim() || null);
      // Grouped by user because sendPushToUser owns the dead-token pruning for that user's tokens.
      const byUser = new Map<string, number>();
      for (const t of cohort.targets) byUser.set(t.uid, (byUser.get(t.uid) ?? 0) + 1);
      let sentUsers = 0;
      for (const uid of byUser.keys()) {
        await sendPushToUser(uid, payload);
        sentUsers += 1;
      }
      lastUpdateBroadcast = { versionCode: latestVersionCode, at: Date.now(), devices: cohort.targets.length };
      res.json({ sent: cohort.targets.length, users: sentUsers, versionCode: latestVersionCode });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not send the update broadcast.' });
    }
  });

  // BUILDER SCORECARD — the numbers that say where the ENGINE actually stands.
  //
  // WHY (2026-08-11): an 84-point "Vision 10/10" directive was cross-checked against the codebase and
  // nearly every capability it asked for already existed — ~280 modules. Measurement was one of the two
  // things that genuinely did not. Every autopsy this platform runs ends the same way: a fix ships and
  // nobody can say whether the engine got better. A ₹566.96 build looked normal until someone added up
  // its tokens.
  //
  // Computed from the build reports ALREADY stored — never from a benchmark app. The directive itself
  // forbids gaming a benchmark (§53), and a curated "500-edit test" is exactly the thing that gets
  // nursed; grouping real workspaces answers the same question about projects users actually keep.
  // Admin-only: internal engine quality, never a user-facing surface.
  app.get('/api/admin/builder-scorecard', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);
      const reports = await listAdminBuildReports(limit);
      // healCount rides along so the scorecard can state the 50/50 law as a number: how often the
      // builder had to repair its OWN output. It is already on every stored report's meta.
      const card = builderScorecard(reports);
      res.json({ ...card, headline: scorecardHeadline(card), window: limit, reportsRead: reports.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to compute the builder scorecard.' });
    }
  });

  // ALL BUILDS browser (admin 2026-08-06: "koi bhi user kuch bhi app banaye — admin apne panel se
  // puri 0→100% build report download kar sake, user ke send kiye bina"). Every build's report is
  // already durably recorded (workspace latest doc + per-build history, including in-progress
  // upserts); these routes are the missing ADMIN-ONLY global window over it. Full provider detail —
  // this is the forensic surface; nothing here is ever user-reachable (verifyAdminToken on each).

  app.get('/api/admin/all-builds', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      const q = String(req.query.q ?? '').trim();
      const status = parseStatusFilter(req.query.status);
      const dateFilter = parseDateFilter(req.query.date);
      const uid = String(req.query.uid ?? '').trim() || null;

      // The date bound goes into the QUERY (see listAllDiagnostics) so a "last 30 days" view is not
      // secretly "the newest 500 rows". Status and user are applied below, in memory, because `ok`
      // and the owner live inside the stored report and cannot be queried.
      const all = await listAllDiagnostics(limit, sinceMsFor(dateFilter));

      // Names in ONE round trip. A per-row lookup would be 100 sequential reads on a screen the admin
      // refreshes constantly; a failure here degrades to ids rather than emptying the list.
      const identities = await resolveUserIdentities(all.map((b) => b.ownerUid), getDb() as never);

      const builds = all
        .filter((b) => buildMatchesFilters(b, {
          status, uid, query: q,
          identity: b.ownerUid ? identities.get(String(b.ownerUid).trim()) ?? null : null,
        }))
        .map((b) => {
          const identity = b.ownerUid ? identities.get(String(b.ownerUid).trim()) ?? null : null;
          const resolved = identity ?? identityFrom(b.ownerUid, null);
          return { ...b, owner: { ...resolved, label: identityLabel(resolved) } };
        });

      // The counts describe the FETCHED set (before status/user narrowing), so the chips can show how
      // much each choice would hide -- and `total` is stated separately so the panel never implies it
      // is looking at more than the fetch limit.
      res.json({
        builds,
        counts: statusCounts(all),
        users: usersInBuilds(all, identities).map((u) => ({
          uid: u.uid,
          count: u.count,
          label: identityLabel(u.identity ?? identityFrom(u.uid, null)),
        })),
        fetched: all.length,
        limit,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list builds.' });
    }
  });

  app.get('/api/admin/all-builds/:workspaceId', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const workspaceId = String(req.params.workspaceId || '');
      const [latest, history] = await Promise.all([
        loadDiagnostics(workspaceId).catch(() => null),
        listDiagnosticsHistory(workspaceId).catch(() => []),
      ]);
      if (!latest && history.length === 0) { res.status(404).json({ error: 'No build reports recorded for this workspace.' }); return; }
      res.json({ workspaceId, latest, history });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load the workspace reports.' });
    }
  });

  // Download: ?build=<historyId> → that ONE build's full report; no build param → the whole 0→100%
  // session (every recorded build, oldest → newest, byte-capped exactly like the user-side stitch so
  // the download always actually loads — omissions are counted, never silent).
  app.get('/api/admin/all-builds/:workspaceId/download', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const workspaceId = String(req.params.workspaceId || '');
      const buildId = typeof req.query.build === 'string' ? req.query.build : '';
      if (buildId) {
        const report = await getDiagnosticsHistoryItem(workspaceId, buildId);
        if (!report) { res.status(404).json({ error: 'No report recorded for that build.' }); return; }
        res.setHeader('Content-Disposition', `attachment; filename="build-${workspaceId}-${buildId}.json"`);
        res.json({ workspaceId, report });
        return;
      }
      const meta = await listDiagnosticsHistory(workspaceId, 20).catch(() => []);
      const full = (await Promise.all(meta.map((h) => getDiagnosticsHistoryItem(workspaceId, h.id).catch(() => null)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getDiagnosticsHistoryItem>>>[];
      const latest = await loadDiagnostics(workspaceId).catch(() => null);
      const byStart = new Map<number, (typeof full)[number]>();
      for (const r of full) byStart.set(r.startedAt, r);
      if (latest) byStart.set(latest.startedAt, latest);
      const ordered = [...byStart.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      if (ordered.length === 0) { res.status(404).json({ error: 'No build reports recorded for this workspace.' }); return; }
      const { kept, omitted } = capSessionReports(ordered);
      res.setHeader('Content-Disposition', `attachment; filename="build-session-${workspaceId}.json"`);
      res.json({ workspaceId, session: { builds: kept, count: ordered.length, omittedBuilds: omitted } });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to download the report.' });
    }
  });

  app.get('/api/admin/build-reports/:id', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const record = await getAdminBuildReport(String(req.params.id));
      if (!record) { res.status(404).json({ error: 'Build report not found.' }); return; }
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load the build report.' });
    }
  });

  // TRIAGE MARKS (admin request 2026-08-12: "download kar le to build report par koi tag lag jaye").
  //
  // TWO marks, not one — see reportTriage.ts. `downloaded` is set automatically by the panel's Download
  // button (a fact about the admin's action); `fixed` is only ever set by a person clicking it (a fact
  // about the work). Collapsing them would have shown this session's own report as "fixed" from the
  // first minute, while nine of its ten defects were still shipping.
  //
  // It returns the MERGED marks so the panel renders what was actually persisted — a badge drawn from
  // an optimistic local guess would show "fixed" on a write that silently failed.
  app.post('/api/admin/build-reports/:id/mark', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { downloaded?: unknown; fixed?: unknown; note?: unknown };
      const triage = await markAdminBuildReport(String(req.params.id), {
        downloaded: body.downloaded === true,
        // Tri-state on purpose: absent leaves the mark alone, true sets it, false CLEARS it. The admin
        // will tick one by mistake, and a mark that cannot be undone silently buries a real bug.
        fixed: typeof body.fixed === 'boolean' ? body.fixed : undefined,
        note: typeof body.note === 'string' ? body.note : null,
      });
      if (!triage) { res.status(404).json({ error: 'Build report not found (or the mark could not be saved).' }); return; }
      res.json({ ok: true, triage });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to mark the build report.' });
    }
  });

  // DELETE a reported build (admin 2026-08-16: "build report delete karne ka option do — agar space kha
  // rahi ho"). Each inbox record can be ~1 MB (it carries the whole session), so a handled report is
  // pure stored cost once its bug is fixed. Deleting the inbox copy does NOT touch the user's own
  // workspace diagnostics — different collection, different purpose.
  app.delete('/api/admin/build-reports/:id', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const ok = await deleteAdminBuildReport(String(req.params.id));
      if (!ok) { res.status(404).json({ error: 'Build report not found (or it could not be deleted).' }); return; }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete the build report.' });
    }
  });

  // CLEAR THE WHOLE INBOX in one action (admin 2026-08-16). Guarded by an explicit `confirm: true` in the
  // body so a stray request can never wipe the inbox — this is irreversible.
  app.post('/api/admin/build-reports/clear', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      if ((req.body ?? {}).confirm !== true) {
        res.status(400).json({ error: 'Pass { confirm: true } to clear all reports — this cannot be undone.' });
        return;
      }
      const deleted = await deleteAllAdminBuildReports();
      res.json({ ok: true, deleted });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to clear the build reports.' });
    }
  });

  /**
   * SERVER NECESSITY (admin 2026-08-12) — the ONE number that decides whether the browser-native plan
   * is worth building: how many past apps were given a Node server they never needed?
   *
   * Every such app is one that could have skipped the E2B sandbox entirely — no VM for the preview, no
   * VM for the verification. The dukaan stock app is the example: Express + Postgres + bcrypt + multer
   * for a login, a list, a search box, a photo and a total, every one of which a browser can do
   * directly against a hosted database.
   *
   * Measured, not estimated, and read-only: it changes nothing about how builds run. If the gap turns
   * out to be small, the plan should not proceed — which is exactly why this endpoint exists BEFORE
   * any of it.
   */
  app.get('/api/admin/server-necessity', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);
      const builds = await listBuildFacts(limit);
      const tally = tallyServerNecessity(builds);
      // The sample is returned so the admin can spot-check the classifier against builds they remember,
      // rather than trusting a percentage produced by a regex they have never seen.
      const sample = builds.slice(0, 25).map((b) => {
        const n = needsRealServer(b.prompt);
        return {
          workspaceId: b.workspaceId,
          prompt: (b.prompt ?? '').slice(0, 160),
          neededServer: n.needed,
          reasons: n.reasons,
          builtServer: builtAServer(b.paths),
        };
      });
      res.json({ headline: necessityHeadline(tally), tally, window: limit, sample });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to measure server necessity.' });
    }
  });

  /**
   * SANDBOX HANDOVER (Phase 0 of IN_BROWSER_PREVIEW_PLAN.md) — where does a sandbox's billed life go?
   *
   * The plan's §0 corrects my own framing using arithmetic on a monthly total: the idle lever is nearly
   * spent, so hardening the in-browser preview cannot be a cost project. This endpoint replaces that
   * arithmetic with a per-build MEASUREMENT of the one window Phase 3 could reclaim — how long a
   * sandbox stayed billable AFTER its build finished, and how much of that belonged to a frontend-only
   * app the browser could have served itself.
   *
   * Joins two records that already exist, so no new telemetry and no waiting for data: the build report
   * (start/end/paths) and the durable sandbox record (last activity / pause stamp). Read-only — it
   * changes nothing about how builds run, exactly like the server-necessity endpoint beside it.
   *
   * If the reclaimable share turns out to be small, Phase 3 is a RELIABILITY change and must not be
   * sold as a cost one. That is a real possible outcome of this endpoint, and the headline says so.
   */
  app.get('/api/admin/sandbox-handover', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);
      const [builds, sandboxes] = await Promise.all([listBuildFacts(limit), sandboxStore.listRecent(limit)]);
      const byWorkspace = new Map(sandboxes.map((s) => [s.workspaceId, s]));
      const rows = builds.map((b) => {
        const sb = byWorkspace.get(b.workspaceId);
        return {
          workspaceId: b.workspaceId,
          prompt: (b.prompt ?? '').slice(0, 160),
          startedAt: b.startedAt,
          endedAt: b.endedAt,
          paths: b.paths,
          sandboxUpdatedAt: sb?.updatedAt,
          sandboxPausedAt: sb?.pausedAt,
        };
      });
      const tally = tallyHandover(rows);
      const projection = projectHandover(tally);
      // The same spot-check discipline as server-necessity: a percentage the admin cannot audit against
      // builds they remember is a percentage they have to take on trust.
      const sample = rows.slice(0, 25).map((r) => {
        const s = handoverSample(r);
        return {
          workspaceId: r.workspaceId,
          prompt: r.prompt,
          known: s.known,
          why: s.known ? undefined : s.why,
          buildMinutes: s.known ? Math.round(s.buildMs / 60_000) : undefined,
          heldAfterMinutes: s.known ? Math.round(s.heldAfterMs / 60_000) : undefined,
          frontendOnly: s.known ? s.frontendOnly : undefined,
        };
      });
      res.json({ headline: handoverHeadline(tally, projection), tally, projection, window: limit, sample });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to measure sandbox handover.' });
    }
  });

  // G2 — structured server log query endpoint.
  app.get('/api/admin/logs', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const level = ['info', 'warn', 'error'].includes(String(req.query.level)) ? req.query.level as 'info' | 'warn' | 'error' : undefined;
      const event = typeof req.query.event === 'string' ? req.query.event : undefined;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const since = req.query.since ? Number(req.query.since) : undefined;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      const entries = await logStore.query({ level, event, workspaceId, since, limit });
      res.json({ entries });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read logs.' });
    }
  });

  // G1 — build/agent event log (audit trail + replay surface). Persisted to
  // Firestore; falls back to the in-memory ring when Firestore is unavailable.
  app.get('/api/admin/events', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const correlationId = typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
      const events = await eventStore.query({ workspaceId, correlationId, limit });
      res.json({ events });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read events.' });
    }
  });

  app.get('/api/admin/analytics', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const walletsRef = collection(db, 'user_token_wallets');
      const walletSnap = await getDocs(walletsRef);
      const wallets = walletSnap.docs.map((d: any) => d.data());

      const logsRef = collection(db, 'ai_usage_logs');
      const logsSnap = await getDocs(logsRef);
      const logs = logsSnap.docs.map((d: any) => d.data());

      const txRef = collection(db, 'payment_transactions');
      const txSnap = await getDocs(txRef);
      const transactions = txSnap.docs.map((d: any) => d.data());

      const totalUsers = wallets.length;
      let totalRevenue = 0;
      transactions.forEach((tx: any) => {
        if (tx.paymentStatus === 'SUCCESS') {
          totalRevenue += tx.amountPaid || 0;
        }
      });

      let totalTokensUsed = 0;
      let totalProviderCost = 0;
      const modelWise: any = {};
      const providerWise: any = {};

      logs.forEach((log: any) => {
        totalTokensUsed += log.outputTokens || 0;
        totalProviderCost += log.estimated_provider_cost || 0;

        const model = log.modelName || 'unknown-model';
        modelWise[model] = (modelWise[model] || 0) + (log.outputTokens || 0);

        const provider = log.providerName || 'unknown-provider';
        providerWise[provider] = (providerWise[provider] || 0) + (log.outputTokens || 0);
      });

      const clientIdSample = (process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID)?.trim();
      const clientSecretSample = (process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY)?.trim();
      const isPlaceholderSample = !clientIdSample || !clientSecretSample ||
        clientIdSample.toLowerCase().includes('placeholder') ||
        clientSecretSample.toLowerCase().includes('placeholder') ||
        clientIdSample === '' ||
        clientSecretSample === '';

      const cashfreeStatus = {
        clientId: (clientIdSample && !isPlaceholderSample) ? 'Configured ✅' : 'Missing (Simulator active) 🛠️',
        // Robust detection: default to production unless the secret explicitly indicates 'test' or 'sandbox'
        env: process.env.CASHFREE_ENV || (clientSecretSample && (clientSecretSample.toLowerCase().includes('test') || clientSecretSample.toLowerCase().includes('sandbox') || clientSecretSample.toLowerCase().includes('sim_')) ? 'sandbox' : 'production')
      };

      const expensiveUsers = [...wallets]
        .sort((a: any, b: any) => (b.total_output_tokens_used || 0) - (a.total_output_tokens_used || 0))
        .slice(0, 10)
        .map((w: any) => ({
          userId: w.userId,
          email: w.userEmail || 'unknown@example.com',
          name: w.userName || 'NavBharat user',
          remaining_balance: w.remaining_balance || 0,
          tokens_used: w.total_output_tokens_used || 0,
          money_spent: w.total_money_spent || 0
        }));

      // New stats additions
      const today2 = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const todayHits = serverStats.dailyHits.get(today2) || 0;
      const yesterdayHits = serverStats.dailyHits.get(yesterday) || 0;

      // New users today (wallets created today)
      const newUsersToday = wallets.filter((w: any) => {
        const created = w.updatedAt || w.createdAt || '';
        return created.startsWith(today2);
      }).length;

      // Active users last 24h (from usage logs)
      const cutoff24h = new Date(Date.now() - 86400000).toISOString();
      const activeUserIds = new Set(logs.filter((l: any) => (l.createdAt || '') > cutoff24h).map((l: any) => l.userId));
      const activeUsers24h = activeUserIds.size;

      // Provider ranking by request count
      const providerRequestCount: any = {};
      const providerLatencySum: any = {};
      const providerLatencyCount: any = {};
      logs.forEach((log: any) => {
        const p = log.providerName || 'unknown';
        providerRequestCount[p] = (providerRequestCount[p] || 0) + 1;
        if (log.latencyMs) {
          providerLatencySum[p] = (providerLatencySum[p] || 0) + log.latencyMs;
          providerLatencyCount[p] = (providerLatencyCount[p] || 0) + 1;
        }
      });
      const providerRanking = Object.entries(providerRequestCount)
        .map(([name, count]: any) => ({
          name,
          requests: count,
          avgLatencyMs: providerLatencyCount[name] ? Math.round(providerLatencySum[name] / providerLatencyCount[name]) : 0,
          tokensUsed: providerWise[name.toLowerCase()] || 0,
        }))
        .sort((a: any, b: any) => b.requests - a.requests);

      // Token purchases
      const successfulPurchases = transactions.filter((tx: any) => tx.paymentStatus === 'SUCCESS' && tx.paymentProvider !== 'WELCOME_BONUS');
      const tokenPurchaseCount = successfulPurchases.length;
      const recentPurchases = [...successfulPurchases]
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
        .map((tx: any) => ({ userId: tx.userId, amount: tx.amountPaid, tokens: tx.tokenAmount || 0, date: tx.createdAt }));

      // Live provider stats from AIRouter
      const liveProviderStats = getProviderStats();

      return res.json({
        totalUsers, totalRevenue, totalTokensUsed, totalProviderCost,
        estimatedProfit: totalRevenue - totalProviderCost,
        failedRequests: serverStats.failedLogins,
        expensiveUsers, modelWise, providerWise, cashfreeStatus, burnRate: totalProviderCost / Math.max(1, logs.length),
        // New fields
        websiteHitsToday: todayHits, websiteHitsYesterday: yesterdayHits,
        websiteHitsTotal: serverStats.totalHits,
        newUsersToday, activeUsers24h,
        providerRanking, tokenPurchaseCount, recentPurchases,
        liveProviderStats,
        maintenanceMode: serverStats.maintenanceMode,
        featureFlags: serverStats.featureFlags,
        pricingConfig: serverStats.pricingConfig,
        providerEnabled: serverStats.providerEnabled,
        failedLoginAttempts: serverStats.failedLoginIPs.slice(-20),
      });
    } catch (err: any) {
      console.error('[ADMIN] Internal error:', err?.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // ── Provider live status ──────────────────────────────────────────────────
  app.get('/api/admin/provider-status', verifyAdminToken, (_req: Request, res: Response) => {
    res.json(getProviderStats());
  });

  // ── Full user list with sort ──────────────────────────────────────────────
  app.get('/api/admin/users', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const sort = (req.query.sort as string) || 'tokens';
      const search = ((req.query.search as string) || '').toLowerCase();
      const walletsRef = collection(db, 'user_token_wallets');
      const snap = await getDocs(walletsRef);
      let users = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];

      if (search) {
        users = users.filter((u: any) =>
          (u.userEmail || '').toLowerCase().includes(search) ||
          (u.userName || '').toLowerCase().includes(search)
        );
      }

      if (sort === 'alpha') users.sort((a: any, b: any) => (a.userEmail || '').localeCompare(b.userEmail || ''));
      else if (sort === 'tokens') users.sort((a: any, b: any) => (b.tokenBalance || 0) - (a.tokenBalance || 0));
      else if (sort === 'ai_per_day') users.sort((a: any, b: any) => (b.total_output_tokens_used || 0) - (a.total_output_tokens_used || 0));
      else if (sort === 'recent') users.sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

      res.json(users.map((u: any) => ({
        userId: u.userId || u.id,
        email: u.userEmail || '–',
        name: u.userName || 'NavBharat User',
        tokenBalance: u.tokenBalance || 0,
        totalTokensUsed: u.total_output_tokens_used || 0,
        remainingBalance: u.remaining_balance || 0,
        moneySpent: u.total_money_spent || 0,
        hasPro: u.hasVishwakarmaPass || false,
        banned: u.banned || false,
        createdAt: u.updatedAt || u.createdAt || '',
      })));
    } catch (e: any) {
      // Admin-only endpoint: surface the REAL failure reason (Firestore error / timeout) so the panel can
      // show WHY the list didn't load instead of a misleading "no users found". (Not a user-facing surface,
      // so the raw detail is fine here — the white-label law covers END-USER surfaces only.)
      console.error('[ADMIN] /users failed:', e?.message);
      res.status(500).json({ error: 'Failed to load users', detail: e?.message || String(e) });
    }
  });

  // ── User token adjustment ─────────────────────────────────────────────────
  app.post('/api/admin/users/:userId/tokens', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    const { delta, reason } = req.body;
    if (!delta || typeof delta !== 'number') return res.status(400).json({ error: 'delta (number) required' });
    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      const snap = await getDoc(walletRef);
      if (!snap.exists()) return res.status(404).json({ error: 'User not found' });
      const data = snap.data();
      const newBalance = Math.max(0, (data.tokenBalance || 0) + delta);
      await updateDoc(walletRef, {
        tokenBalance: newBalance,
        // ROOT-CAUSE FIX (gift-token bug, admin 2026-08-03: "₹0 + 50,000 tokens → app building off"). The
        // affordability gate reads `remaining_balance` (₹); this path used to bump ONLY tokenBalance, so a
        // gifted user showed ₹0 and could not build despite the tokens. Keep the ₹ MIRROR in sync (same
        // rate the welcome bonus + purchases use), so the balance is consistent for the gate AND the UI.
        remaining_balance: TOKENS_PER_RUPEE > 0 ? newBalance / TOKENS_PER_RUPEE : 0,
        walletLedger: [...(data.walletLedger || []), { type: 'admin_adjustment', amountCoinsOrTokens: delta, reason: reason || 'Admin adjustment', timestamp: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      });
      audit('ADMIN_TOKEN_ADJUST', { userId, delta, reason, ip: req.ip });
      res.json({ ok: true, newBalance });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  // ── Merge a duplicate account's wallet INTO another (one person = one wallet) ──────────────
  // Admin-triggered ONLY: the admin PROVES the two accounts are the same person by choosing them —
  // identity is never inferred, and merely fetching someone's GitHub repo can NEVER move a wallet.
  // Uses the tested, pure mergeWallets: debt carries (a negative balance is NOT escaped), the welcome
  // bonus counts ONCE (no farming), and real purchases all carry. Atomic + idempotent: the source
  // wallet is zeroed and stamped `mergedInto` so it can never be spent again or double-merged.
  app.post('/api/admin/users/:userId/merge', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;             // the account to KEEP (merge INTO)
    const fromUserId = req.body?.fromUserId;   // the duplicate account to merge and retire
    if (!fromUserId || typeof fromUserId !== 'string') return res.status(400).json({ error: 'fromUserId (string) required' });
    if (fromUserId === userId) return res.status(400).json({ error: 'Cannot merge an account into itself' });
    try {
      const intoRef = doc(db, 'user_token_wallets', userId);
      const fromRef = doc(db, 'user_token_wallets', fromUserId);
      const out = await runTransaction(db, async (tx: any) => {
        const intoSnap = await tx.get(intoRef);
        const fromSnap = await tx.get(fromRef);
        if (!fromSnap.exists()) throw new Error('Source account has no wallet to merge');
        const fromData = fromSnap.data();
        if (fromData.mergedInto) throw new Error(`Source account was already merged into ${fromData.mergedInto}`);
        const intoData = intoSnap.exists()
          ? intoSnap.data()
          : { userId, tokenBalance: 0, totalTokensUsed: 0, totalTokensPurchased: 0, total_output_tokens_used: 0, total_money_spent: 0, remaining_balance: 0, walletLedger: [] };
        const nowIso = new Date().toISOString();
        const { wallet: merged, audit: mergeAudit } = mergeWallets(intoData, fromData, nowIso);
        tx.set(intoRef, merged);
        // Retire the source: zero its balance and flag it merged so it can never be spent or re-merged.
        tx.set(fromRef, { ...fromData, tokenBalance: 0, remaining_balance: 0, total_balance: 0, mergedInto: userId, mergedAt: nowIso, updatedAt: nowIso });
        return { newBalance: merged.tokenBalance, mergeAudit };
      });
      audit('ADMIN_WALLET_MERGE', { into: userId, from: fromUserId, newBalance: out.newBalance, ...out.mergeAudit, ip: req.ip });
      res.json({ ok: true, into: userId, from: fromUserId, newBalance: out.newBalance, audit: out.mergeAudit });
    } catch (e: any) {
      console.error('[ADMIN] wallet merge failed:', e?.message);
      res.status(500).json({ error: 'Merge failed', detail: e?.message || String(e) });
    }
  });

  // ── Ban / unban user ──────────────────────────────────────────────────────
  app.post('/api/admin/users/:userId/ban', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    const { banned, reason } = req.body;
    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      await setDoc(walletRef, { banned: !!banned, banReason: reason || '', bannedAt: new Date().toISOString() }, { merge: true });
      audit(banned ? 'ADMIN_USER_BANNED' : 'ADMIN_USER_UNBANNED', { userId, reason, ip: req.ip });
      res.json({ ok: true, banned: !!banned });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  // ── Hosting registry + takedown (Phase 0 abuse guard) ─────────────────────
  // List published apps for moderation. Optional ?status=active|held|taken_down and ?userId=.
  app.get('/api/admin/deployments', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === 'string' ? (req.query.status as DeploymentStatus) : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
      const deployments = userId
        ? await deploymentStore.listByUser(userId, limit)
        : await deploymentStore.list({ status, limit });
      res.json({ deployments });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  // Take a live app down: delete its real Firebase Hosting channel, then mark it taken_down so it can
  // never republish (the deploy choke point re-checks status). Honest — reports the real result.
  app.post('/api/admin/deployments/:workspaceId/takedown', verifyAdminToken, async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { reason } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    try {
      // Delete the live channel FIRST (real unpublish); idempotent (404 = already gone). If it throws
      // (e.g. missing IAM role), surface it honestly and do NOT claim the app was taken down.
      await new FirebaseHostingDeployer().deleteChannel(workspaceId);
      const marked = await deploymentStore.setStatus(workspaceId, 'taken_down');
      audit('ADMIN_APP_TAKEDOWN', { workspaceId, reason: reason || '', ip: req.ip });
      res.json({ ok: true, workspaceId, status: 'taken_down', registryUpdated: marked });
    } catch (e: any) {
      console.error('[ADMIN] Takedown error:', e?.message);
      res.status(502).json({ error: 'Takedown failed — the live site was NOT confirmed removed.', detail: e?.message || String(e) });
    }
  });

  // ── THE PUBLISH CEILING — see how full it is, and reclaim what is wasted (ROADMAP §10) ─────
  //
  // Every published app holds ONE Firebase Hosting channel and the pool is capped per site. Past the
  // cap, publishing stops for EVERY user at once — and nothing on our side could see it coming,
  // because our registry counts apps we know about while the cap counts channels that EXIST. This
  // reconciles the two. Read-only; it changes nothing.
  /**
   * WHY IS APPLE SIGN-IN FAILING? — one call, one answer (admin 2026-08-21).
   *
   * The server fetches its OWN public association URL, which is precisely what Apple fetches, and
   * compares it with what it believes it is serving. That comparison is the whole point: from a
   * browser, "file missing", "something in front of us answered instead", "stale copy" and "our side is
   * fine, the problem is in Apple's portal" all look like the same closed sheet. See
   * appleSignInDiagnosis.ts.
   *
   * Reveals no secret: the association file is a PUBLIC file by design — Apple requires the whole
   * internet to be able to read it — and the response carries no key, no token, and no credential.
   */
  app.get('/api/admin/apple-signin', verifyAdminToken, async (req: Request, res: Response) => {
    const readRepoFile = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    const served = appleDomainAssociation(process.env, readRepoFile);
    const source = appleDomainAssociationSource(process.env, readRepoFile);
    const url = `${(process.env.PUBLIC_BASE_URL || 'https://navbharatai.com').replace(/\/$/, '')}${APPLE_DOMAIN_ASSOCIATION_PATH}`;

    // Bounded, and a failure to ASK is reported as a failure to ask — never as a bad answer.
    let selfFetch: AppleSelfFetch | null = null;
    if (served) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8_000);
        try {
          const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
          const body = await r.text();
          selfFetch = {
            status: r.status,
            body: body.trim().slice(0, 4096),
            contentType: String(r.headers.get('content-type') || '').toLowerCase(),
          };
        } finally { clearTimeout(timer); }
      } catch (e: any) {
        selfFetch = { status: null, body: '', contentType: '', error: e?.message || String(e) };
      }
    }

    // WHAT THE BROWSER SAW, when the admin has it (`?code=auth/invalid-credential`). Optional, and
    // bounded — it only ever narrows the FINAL "our side is correct" answer toward the right portal,
    // and it can never turn a real our-side fault into a clean verdict. Without it this endpoint
    // answers exactly as it did before.
    const observedCode = String((req.query as any)?.code || '').trim().slice(0, 64) || null;
    const diagnosis = diagnoseAppleSignIn({ served, source, selfFetch, observedCode });
    res.json({
      ...diagnosis,
      observedCode,
      url,
      configured: !!served,
      source,
      // Lengths rather than contents: enough to spot a truncated paste or stray wrapper, without
      // printing a long file into a console nobody will read.
      servedLength: served ? served.length : 0,
      fetchedLength: selfFetch?.body.length ?? null,
      fetchedStatus: selfFetch?.status ?? null,
      fetchedContentType: selfFetch?.contentType ?? null,
      fetchError: selfFetch?.error ?? null,
      serviceId: APPLE_SERVICE_ID,
      returnUrl: APPLE_WEB_RETURN_URL,
    });
  });

  app.get('/api/admin/hosting/channels', verifyAdminToken, async (_req: Request, res: Response) => {
    try {
      // BOTH sides carry completeness now, because this screen REASONS ABOUT ABSENCE — a channel with
      // no record is called orphaned waste and gets a delete button. That inference is only valid if
      // the registry was genuinely read in full; when it was not, `classifyChannels` returns
      // 'indeterminate' and nothing is offered for reclaim. See the 2026-08-21 note on ChannelState.
      const [chan, reg] = await Promise.all([
        new FirebaseHostingDeployer().listChannelsWithCompleteness(),
        deploymentStore.listWithCompleteness({ limit: 500 }),
      ]);
      const classified = classifyChannels(chan.channels, reg.records, reg.complete);
      res.json({
        verdict: channelCeilingVerdict(classified),
        channels: classified,
        registryComplete: reg.complete,
        channelsComplete: chan.complete,
        ...(reg.complete && chan.complete ? {} : {
          warning: 'This inventory is INCOMPLETE, so nothing is offered for reclaim: a channel missing '
            + 'a record here may simply be a record we could not read. Reload before acting.',
        }),
      });
    } catch (e: any) {
      // Honest: an unreadable list is NOT "zero channels in use". Reporting a made-up all-clear on
      // the one number this endpoint exists for would be worse than reporting nothing.
      console.error('[ADMIN] Channel inventory error:', e?.message);
      res.status(502).json({
        error: 'Could not read the hosting channel list, so the ceiling is UNKNOWN — not clear.',
        detail: e?.message || String(e),
        cap: channelCap(),
      });
    }
  });

  // Reclaim ONE wasted channel by its id.
  //
  // Addressed by CHANNEL id because that is the only handle these have left: a purge before
  // `markOrphaned` (2026-08-21) deleted the deployment record and never the channel, so the app is
  // still serving with no workspaceId anywhere to derive it from.
  //
  // ⚠️ It REFUSES a 'live' channel. Reclaim exists for waste; taking a working app down belongs to
  // its owner (Unpublish) or to a deliberate takedown, which also marks the registry so it cannot
  // silently republish. A tool that could do both would eventually do the wrong one.
  app.post('/api/admin/hosting/channels/:channelId/reclaim', verifyAdminToken, async (req: Request, res: Response) => {
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });
    try {
      const [chan, reg] = await Promise.all([
        new FirebaseHostingDeployer().listChannelsWithCompleteness(),
        deploymentStore.listWithCompleteness({ limit: 500 }),
      ]);
      // Re-derived here rather than trusted from the client, and re-checked for completeness for the
      // same reason: this call DELETES, and a delete decided from a half-read registry is how a live
      // app disappears. An incomplete read refuses rather than guessing.
      const target = classifyChannels(chan.channels, reg.records, reg.complete).find((c) => c.channelId === channelId);
      if (!target) return res.status(404).json({ error: 'No such channel on this hosting site.' });
      if (!reg.complete) {
        return res.status(409).json({
          error: 'The deployment registry could not be read in full, so it is impossible to tell whether '
            + 'this channel is waste or a live app whose record we simply did not see. Nothing was deleted.',
          state: target.state,
        });
      }
      if (!target.reclaimable) {
        return res.status(409).json({
          error: 'That channel is a LIVE app. Use takedown for a live app — it also blocks republish; reclaim is only for channels no live app is using.',
          workspaceId: target.workspaceId,
        });
      }
      await new FirebaseHostingDeployer().deleteChannelById(channelId);
      audit('ADMIN_CHANNEL_RECLAIMED', { channelId, state: target.state, workspaceId: target.workspaceId || '', ip: req.ip });
      res.json({ ok: true, channelId, state: target.state });
    } catch (e: any) {
      console.error('[ADMIN] Channel reclaim error:', e?.message);
      res.status(502).json({ error: 'Reclaim failed — the channel was NOT confirmed removed.', detail: e?.message || String(e) });
    }
  });

  // Restore a held/taken-down app to active (reverses an over-eager takedown/hold). Does NOT
  // re-publish — the owner must redeploy; this only clears the registry block.
  app.post('/api/admin/deployments/:workspaceId/restore', verifyAdminToken, async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    try {
      const ok = await deploymentStore.setStatus(workspaceId, 'active');
      audit('ADMIN_APP_RESTORED', { workspaceId, ip: req.ip });
      res.json({ ok, workspaceId, status: 'active' });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  // ── Grant / revoke Pro access ─────────────────────────────────────────────
  app.post('/api/admin/users/:userId/pro', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    const { grant } = req.body;
    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      await setDoc(walletRef, { hasVishwakarmaPass: !!grant, vishwakarmaPassActivatedAt: grant ? new Date().toISOString() : null }, { merge: true });
      audit(grant ? 'ADMIN_PRO_GRANTED' : 'ADMIN_PRO_REVOKED', { userId, ip: req.ip });
      res.json({ ok: true, hasPro: !!grant });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  // ── Settings (pricing, feature flags, maintenance) ────────────────────────
  app.get('/api/admin/settings', verifyAdminToken, (_req: Request, res: Response) => {
    res.json({
      maintenanceMode: serverStats.maintenanceMode,
      featureFlags: serverStats.featureFlags,
      pricingConfig: serverStats.pricingConfig,
      providerEnabled: serverStats.providerEnabled,
    });
  });

  app.post('/api/admin/settings', verifyAdminToken, (req: Request, res: Response) => {
    const { maintenanceMode, featureFlags, pricingConfig, providerEnabled } = req.body;
    if (maintenanceMode !== undefined) serverStats.maintenanceMode = !!maintenanceMode;
    if (featureFlags) Object.assign(serverStats.featureFlags, featureFlags);
    if (pricingConfig) Object.assign(serverStats.pricingConfig, pricingConfig);
    if (providerEnabled) Object.assign(serverStats.providerEnabled, providerEnabled);
    audit('ADMIN_SETTINGS_CHANGED', { changes: req.body, ip: req.ip });
    // P-PME.8 — persist feature flags to Firestore so they survive Cloud Run restarts (in-memory
    // serverStats alone reset on every deploy). Best-effort: a persistence failure never fails the toggle.
    if (featureFlags) {
      import('../FeatureFlagManager')
        .then(({ saveFlagConfig }) => saveFlagConfig({ flags: { ...serverStats.featureFlags } }))
        .catch(() => { /* persistence is best-effort */ });
    }
    res.json({ ok: true, settings: { maintenanceMode: serverStats.maintenanceMode, featureFlags: serverStats.featureFlags, pricingConfig: serverStats.pricingConfig, providerEnabled: serverStats.providerEnabled } });
  });

  // P-PME.8 — runtime feature-flag config (incl. percentage rollout + per-user overrides), persisted
  // in Firestore. GET returns the full persisted config; POST replaces it. Admin-only.
  app.get('/api/admin/feature-flags', verifyAdminToken, async (_req: Request, res: Response) => {
    const { loadFlagConfig } = await import('../FeatureFlagManager');
    const config = (await loadFlagConfig()) || { flags: { ...serverStats.featureFlags } };
    res.json(config);
  });

  app.post('/api/admin/feature-flags', verifyAdminToken, async (req: Request, res: Response) => {
    const { saveFlagConfig } = await import('../FeatureFlagManager');
    const body = req.body || {};
    const config = {
      flags: body.flags && typeof body.flags === 'object' ? body.flags : { ...serverStats.featureFlags },
      ...(body.rollout && typeof body.rollout === 'object' ? { rollout: body.rollout } : {}),
      ...(body.overrides && typeof body.overrides === 'object' ? { overrides: body.overrides } : {}),
    };
    const saved = await saveFlagConfig(config);
    if (config.flags) Object.assign(serverStats.featureFlags, config.flags); // keep in-memory cache in sync
    audit('ADMIN_FEATURE_FLAGS_CHANGED', { ip: req.ip, persisted: saved });
    res.json({ ok: true, persisted: saved, config });
  });

  // ── P-SEC.5: Encryption key rotation ──────────────────────────────────────
  // Re-encrypts ALL user_secrets under the latest key version (SECRET_KEY_V<N>).
  // Set the new key in Cloud Run env, then call this once to migrate existing data.
  app.post('/api/admin/rotate-keys', verifyAdminToken, async (req: Request, res: Response) => {
    try {
      const result = await rotateAllSecrets();
      audit('ADMIN_KEY_ROTATION', { ...result, ip: req.ip }, 'notice');
      res.json({ ok: true, ...result });
    } catch (err: any) {
      audit('ADMIN_KEY_ROTATION_FAILED', { error: err?.message, ip: req.ip }, 'error');
      res.status(500).json({ error: 'Key rotation failed', detail: err?.message });
    }
  });

  // Report the current latest key version (for the admin Security tab).
  app.get('/api/admin/key-version', verifyAdminToken, (_req: Request, res: Response) => {
    res.json({ latestKeyVersion: getLatestKeyVersion() });
  });

  // ── Announcement / user notification ──────────────────────────────────────
  // Admin 2026-07-30: this now DELIVERS to users for real. Besides the in-memory admin list (kept for
  // the admin's own recent-announcements view), it persists a durable notification targeted at ALL
  // users or a SPECIFIC user (by email/userId), which the user's app fetches via /api/notifications.
  app.post('/api/admin/announcement', verifyAdminToken, async (req: Request, res: Response) => {
    const { message, target, email, userId } = req.body ?? {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });
    const normalizedTarget = normalizeTarget({ target, email, userId });
    if (normalizedTarget.type === 'user' && !normalizedTarget.userId && !normalizedTarget.email) {
      return res.status(400).json({ error: 'For a single-user message, provide the user’s email (or user id).' });
    }
    // Durable, user-delivered notification.
    const note = await saveNotification({ message: String(message), target: normalizedTarget, createdBy: 'admin' });
    // In-memory admin recent-list (unchanged behaviour for the admin's own view).
    const ann = { id: note?.id ?? Date.now().toString(), message, createdAt: new Date().toISOString(), target: target || 'all' };
    serverStats.announcements.push(ann);
    if (serverStats.announcements.length > 50) serverStats.announcements.shift();
    audit('ADMIN_ANNOUNCEMENT', { message, target: normalizedTarget.type, ip: req.ip });
    res.json({ ok: true, announcement: ann, delivered: normalizedTarget.type });
  });

  app.get('/api/admin/announcements', verifyAdminToken, (_req: Request, res: Response) => {
    res.json(serverStats.announcements);
  });

  // ── Promo code management ─────────────────────────────────────────────────
  app.post('/api/admin/promo', verifyAdminToken, async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { code, discountPct, freeTokens, maxUses, expiresAt } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    try {
      const promoRef = doc(db, 'promo_codes', code.toUpperCase());
      await setDoc(promoRef, {
        code: code.toUpperCase(), discountPct: discountPct || 0, freeTokens: freeTokens || 0,
        maxUses: maxUses || 1, usedCount: 0, expiresAt: expiresAt || null,
        active: true, createdAt: new Date().toISOString(),
      });
      audit('ADMIN_PROMO_CREATED', { code, ip: req.ip });
      res.json({ ok: true });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });

  app.get('/api/admin/promo', verifyAdminToken, async (_req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const snap = await getDocs(collection(db, 'promo_codes'));
      res.json(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
  });
}
