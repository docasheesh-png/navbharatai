import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { audit } from '../lib/audit';
import { serverStats } from '../lib/serverStats';
import { getProviderStats } from '../AI/Router/AIRouter';
import { getMetrics } from '../lib/metrics';
import { metricsStore } from '../lib/metricsStore';
import { agentV3CostTelemetry } from '../AgentV3/AgentV3CostTelemetry';
import { evaluateAlerts } from '../lib/metricsAlerts';
import { computeHealthScore } from '../lib/HealthScore';
import { analyzeFinOps } from '../lib/FinOpsAdvisor';
import { logStore } from '../lib/logStore';
import { eventStore } from '../lib/eventStore';

/**
 * Admin dashboard routes extracted from the server.ts monolith (Phase 1).
 * Behavior unchanged. All routes are gated by the HMAC day-token middleware.
 */
/** Constant-time comparison for secret material (sha256/HMAC hex digests, tokens). */
function safeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Normalise an admin credential read from the environment. Cloud Run / console /
 * gcloud frequently store a value with a trailing newline, stray whitespace, or
 * wrapping quotes; if login and token-verification disagree on that, login can
 * succeed while every subsequent dashboard call 403s (they'd HMAC different keys).
 * Trimming + stripping a single layer of surrounding quotes on BOTH sides keeps
 * the issued token and the verifier consistent.
 */
export function adminCredential(raw: string | undefined, fallback = ''): string {
  const norm = (v: string): string => v.trim().replace(/^['"]([\s\S]*)['"]$/, '$1').trim();
  return norm(String(raw ?? '')) || norm(fallback);
}
const adminUsername = (): string => adminCredential(process.env.ADMIN_USERNAME, 'aashishcpmt09');
const adminPassword = (): string => adminCredential(process.env.ADMIN_PASSWORD, '');

export function registerAdminRoutes(app: Express, adminLimiter: RateLimitRequestHandler): void {
  // Admin server-side login — issues the daily HMAC token used by verifyAdminToken.
  app.post('/api/admin/login', adminLimiter, (req: Request, res: Response) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const validUser = adminUsername();
    const validPass = adminPassword();

    if (!validPass) {
      audit('ADMIN_LOGIN_BLOCKED', { reason: 'ADMIN_PASSWORD not set', ip: req.ip });
      return res.status(503).json({ error: 'Admin access not configured on server.' });
    }

    const passHash    = crypto.createHash('sha256').update(password).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(validPass).digest('hex');

    // Do NOT log the admin username or password length — both narrow a brute-force search.
    console.log('[ADMIN_LOGIN] login attempt received');

    if (username === validUser && safeStrEqual(passHash, expectedHash)) {
      // Static token — no daily rotation so sessions don't break at midnight UTC.
      const token = crypto.createHmac('sha256', validPass)
        .update(`admin:static:${username}`)
        .digest('hex');
      audit('ADMIN_LOGIN_SUCCESS', { username, ip: req.ip });
      return res.json({ ok: true, token });
    }

    audit('ADMIN_LOGIN_FAILED', { username, ip: req.ip });
    serverStats.failedLogins++;
    serverStats.failedLoginIPs.push({ ip: String(req.ip), time: Date.now(), username });
    if (serverStats.failedLoginIPs.length > 100) serverStats.failedLoginIPs.shift();
    return res.status(401).json({ error: 'Invalid credentials.' });
  });

  // Admin token verification middleware
  const verifyAdminToken = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['x-admin-token'] as string;
    const validPass = adminPassword();
    if (!validPass || !token) return res.status(401).json({ error: 'Admin token required.' });
    const expected = crypto.createHmac('sha256', validPass)
      .update(`admin:static:${adminUsername()}`)
      .digest('hex');
    if (!safeStrEqual(token, expected)) {
      audit('ADMIN_ACCESS_DENIED', { ip: req.ip, path: req.path });
      return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
  };

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

  // P-MON.6 — FinOps recommendations derived from the REAL live metrics snapshot
  // (spend on failed builds, low preview rate, repair-loop cost, provider concentration,
  // per-request cost outliers). No hardcoded prices, no projections — observed waste only.
  app.get('/api/admin/finops', verifyAdminToken, (_req: Request, res: Response) => {
    res.json({ ...analyzeFinOps(getMetrics().snapshot()), generatedAt: Date.now() });
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
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
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
        walletLedger: [...(data.walletLedger || []), { type: 'admin_adjustment', amountCoinsOrTokens: delta, reason: reason || 'Admin adjustment', timestamp: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      });
      audit('ADMIN_TOKEN_ADJUST', { userId, delta, reason, ip: req.ip });
      res.json({ ok: true, newBalance });
    } catch (e: any) { console.error('[ADMIN] Internal error:', e?.message); res.status(500).json({ error: 'Internal server error.' }); }
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
    res.json({ ok: true, settings: { maintenanceMode: serverStats.maintenanceMode, featureFlags: serverStats.featureFlags, pricingConfig: serverStats.pricingConfig, providerEnabled: serverStats.providerEnabled } });
  });

  // ── Announcement broadcast ────────────────────────────────────────────────
  app.post('/api/admin/announcement', verifyAdminToken, (req: Request, res: Response) => {
    const { message, target } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const ann = { id: Date.now().toString(), message, createdAt: new Date().toISOString(), target: target || 'all' };
    serverStats.announcements.push(ann);
    if (serverStats.announcements.length > 50) serverStats.announcements.shift();
    audit('ADMIN_ANNOUNCEMENT', { message, target, ip: req.ip });
    res.json({ ok: true, announcement: ann });
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
