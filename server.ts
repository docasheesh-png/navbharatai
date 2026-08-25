import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import crypto from 'crypto';
import net from 'net';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { LEGACY_EMBEDDED_API_KEY } from './src/server/lib/aiClients';
import { corsMiddleware } from './src/server/lib/cors';
import { registerPwaRoutes, type PwaStore } from './src/server/routes/pwa';
import { spaFallbackShouldDefer } from './src/server/lib/spaFallback';
import { registerTelemetryRoutes } from './src/server/routes/telemetry';
import { registerTeamRoutes } from './src/server/routes/team';
import { registerShareRoutes } from './src/server/routes/share';
import { audit } from './src/server/lib/audit';
import { adaptiveGuard } from './src/server/lib/adaptiveRateLimit';
import { securityHeadersConfig } from './src/server/lib/securityHeaders';
import { setDb as setSharedDb } from './src/server/lib/db';
import { registerWalletRoutes } from './src/server/routes/wallet';
import { registerSecretsRoutes } from './src/server/routes/secrets';
import { registerPushRoutes } from './src/server/routes/push';
import { registerSbomRoutes } from './src/server/routes/sbom';
import { registerBuildAnalyticsRoutes } from './src/server/routes/buildAnalytics';
import { registerSupabaseIntegrationRoutes } from './src/server/routes/supabaseIntegration';
import { verifyFirebaseToken as verifyFirebaseTokenForIntegrations } from './src/server/lib/authMiddleware';
import { registerNavigateRoutes } from './src/server/routes/navigate';
import { registerWebhookRoutes } from './src/server/routes/webhooks';
import { registerBotRoutes } from './src/server/routes/bots';
import { registerChangelogRoutes } from './src/server/routes/changelog';
import { registerTechDebtRoutes } from './src/server/routes/techDebt';
import { registerVersionRoutes } from './src/server/routes/version';
import { registerHallucinationRoutes } from './src/server/routes/hallucination';
import { registerHooksCheckRoutes } from './src/server/routes/hooksCheck';
import { registerImportCheckRoutes } from './src/server/routes/importCheck';
import { registerJsxCheckRoutes } from './src/server/routes/jsxCheck';
import { registerScaleCheckRoutes } from './src/server/routes/scaleCheck';
import { registerGalleryRoutes } from './src/server/routes/gallery';
import { registerWorkspaceHealthRoutes } from './src/server/routes/healthCheck';
import { registerUndefinedHookCheckRoutes } from './src/server/routes/undefinedHookCheck';
import { registerDepConstraintCheckRoutes } from './src/server/routes/depConstraintCheck';
import { registerReleaseGateRoutes } from './src/server/routes/releaseGate';
import { registerTeamLibraryRoutes } from './src/server/routes/teamLibrary';
import { registerTraceabilityRoutes } from './src/server/routes/traceability';
import { registerExplainCodeRoutes } from './src/server/routes/explainCode';
import { registerDebugRoutes } from './src/server/routes/debug';
import { registerAppDebugRoutes } from './src/server/routes/appDebug';
import { registerImageGenRoutes } from './src/server/routes/imageGen';
import { registerDevtoolsProxyRoutes } from './src/server/routes/devtoolsProxy';
import { registerScreenshotToPromptRoutes } from './src/server/routes/screenshotToPrompt';
import { registerFigmaProxyRoutes } from './src/server/routes/figmaProxy';
import { registerCodeReviewRoutes } from './src/server/routes/codeReview';
import { registerPaymentRoutes } from './src/server/routes/payment';
import { registerGithubRoutes } from './src/server/routes/github';
import { registerMobileShipRoutes } from './src/server/routes/mobileShip';
import { registerMinifyRoutes } from './src/server/routes/minify';
import { registerWorkspaceFileRoutes } from './src/server/routes/workspaceFiles';
import { registerMobileSetupRoutes } from './src/server/routes/mobileSetup';
import { registerNavStoreRoutes } from './src/server/routes/navStore';
import { registerReportRoutes } from './src/server/routes/reports';
import { registerCloudsyncRoutes } from './src/server/routes/cloudsync';
// RETIRED — AppMaker telemetry routes (old engine). Unregistered in the v3.0 cutover; no frontend uses them.
// import { registerAppmakerRoutes } from './src/server/routes/appmaker';
import { registerAuthRoutes } from './src/server/routes/auth';
import { registerGithubAuthRoutes } from './src/server/routes/githubAuth';
import { registerFirebaseAuthRoutes } from './src/server/routes/firebaseAuth';
import { registerCreateOrderRoute } from './src/server/routes/createOrder';
import { registerAuditRoutes } from './src/server/routes/audit';
import { registerChatRoutes } from './src/server/routes/chat';
import { registerProRoutes } from './src/server/routes/pro';
import { registerSdaRoutes } from './src/server/routes/sda';
import { registerProfessionalsRoutes } from './src/server/routes/professionals';
import { registerRepoAnalystRoutes } from './src/server/routes/repoAnalyst';
import { registerAppReviewRoutes } from './src/server/routes/appReview';
import { registerNotificationRoutes } from './src/server/routes/notifications';
// DELETED — Engineer AI routes (/api/engineer-*) were unregistered in the v3.0 cutover and the
// dead files (routes/engineer.ts, EngineerAIChat.tsx, EngineerRouterFactory, WebAgentLoop, legacy
// LocalActuator) were removed on 2026-07-09. Replaced by Pro v3.0. NOTE: the rest of
// src/server/EngineerAI/ (ProEngineRunner + agent loop + actuators) is still LIVE — it powers the
// legacy /api/build pipeline (routes/build.ts) and must not be deleted with it.
import { registerAgentV3Routes } from './src/server/routes/agentv3';
import { registerDomainsRoutes } from './src/server/routes/domains';
import { registerNbaiDomainsRoutes } from './src/server/routes/nbaiDomains';
import { registerZipRoutes } from './src/server/routes/zip';
import { registerZipUploadRoutes } from './src/server/routes/zipUpload';
import { registerPreviewRoutes } from './src/server/routes/preview';
import { registerEsmMirrorRoutes } from './src/server/routes/esmMirror';
import { registerBuildRoutes } from './src/server/routes/build';
import { getPreviewService } from './src/server/runtime/PreviewService';
import { handleSonicUpgrade } from './src/server/sonic/sonicWs';
import { registerSonicRoutes } from './src/server/sonic/sonicRoute';
import { serverStats } from './src/server/lib/serverStats';
import { registerAdminRoutes } from './src/server/routes/admin';
import { attachMetricsTimeline } from './src/server/lib/metricsTimeline';
import { serverLoad } from './src/server/lib/serverLoad';
import { registerSyncRoutes } from './src/server/routes/sync';
import { registerProfileRoutes } from './src/server/routes/profile';
import { registerExportRoutes } from './src/server/routes/export';
import { registerApiContractRoutes } from './src/server/lib/apiContract';
import { registerKnowledgeDocsRoutes } from './src/server/lib/KnowledgeDocs';
import { registerApiKeyRoutes } from './src/server/routes/apiKeys';
import { apiVersionMiddleware } from './src/server/routes/apiVersion';
import { tracer, parseCloudTraceContext } from './src/server/observability/Tracer';
import { registerObservabilityRoutes } from './src/server/routes/observability';
import { registerReleaseNotesRoutes } from './src/server/routes/releaseNotes';
import { registerBuildEstimateRoutes } from './src/server/routes/buildEstimate';
import { registerRetrospectiveRoutes } from './src/server/routes/retrospective';
import { registerDesignRoutes } from './src/server/routes/design';
import { registerDeployArtifactsRoutes } from './src/server/routes/deployArtifacts';
import { errorTracker, installGlobalErrorHandlers } from './src/server/observability/ErrorTracker';
import { registerHealthRoutes, markServerReady } from './src/server/routes/health';
import { registerWarmRoute } from './src/server/routes/warm';
import { cacheControlFor } from './src/server/lib/staticCache';


// Traceability Infrastructure
export interface TraceContext {
  requestId: string;
  sessionId: string;
  conversationId: string;
  /** P2.1 — the distributed-trace id for this request (W3C 32-hex). */
  traceId?: string;
}

declare global {
  namespace Express {
    interface Request {
      traceContext: TraceContext;
    }
  }
}

const traceMiddleware = (req: any, res: any, next: any) => {
  const requestId = crypto.randomUUID();
  const sessionId = (req.headers['x-session-id'] as string) || crypto.randomUUID();
  const conversationId = (req.headers['x-conversation-id'] as string) || crypto.randomUUID();

  req.traceContext = { requestId, sessionId, conversationId };

  // P2.1 — start a ROOT request span. Join the platform trace from Cloud Run's
  // `X-Cloud-Trace-Context` header when present, so our spans correlate into Cloud Trace.
  const cloudCtx = parseCloudTraceContext(req.headers['x-cloud-trace-context'] as string | undefined);
  const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
    traceId: cloudCtx?.traceId,
    parentSpanId: cloudCtx?.parentSpanId,
    attributes: { 'http.method': req.method, 'http.path': req.path, requestId },
  });
  req.traceContext.traceId = span.data.traceId;
  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    span.setStatus(res.statusCode >= 500 ? 'error' : 'ok');
    span.end();
  });

  console.log(`[TRACE][API ENTRY] RID:${requestId} SID:${sessionId} CID:${conversationId} TID:${span.data.traceId} Path:${req.path}`);
  // Keep the span's context active for everything awaited downstream (so the AI provider
  // call attaches a child span to THIS request's trace).
  tracer.runInSpan(span, () => next());
};

import { Cashfree } from 'cashfree-pg';
import path from 'path';
import https from 'https';
import fs from 'fs';
import { appleDomainAssociation, APPLE_DOMAIN_ASSOCIATION_PATH } from './src/server/lib/appleDomainAssociation';
import { rewriteProxyHeaders } from './src/server/lib/authProxyCookies';
import { canonicalHostRedirect, canonicalHostFromEnv } from './src/server/lib/canonicalHost';
import { auditEnv } from './src/server/audit_env';

auditEnv();

// ── In-memory server stats ─────────────────────────────────────────────────
// serverStats singleton — extracted to src/server/lib/serverStats.ts (Phase 1).

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
// Fallback: load .env file first, then .env.example (skip placeholder values)
const isEnvPlaceholder = (v: string) =>
  v.startsWith('your_') || v.endsWith('_here') || v === '' || v === 'undefined';

const loadEnvFile = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (key && val && !process.env[key] && !isEnvPlaceholder(val)) {
            process.env[key] = val;
          }
        }
      });
    }
  } catch (e) {
    console.error(`Error loading env file ${filePath}:`, e);
  }
};

loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(process.cwd(), '.env.example'));

// Generate the debug dump
try {
  const envSummary: Record<string, any> = {
    _timestamp: new Date().toISOString(),
    _all_keys: Object.keys(process.env)
  };
  Object.keys(process.env).forEach(k => {
    const val = process.env[k];
    envSummary[k] = {
      exists: !!val,
      length: val ? val.length : 0,
      isPlaceholder: val === LEGACY_EMBEDDED_API_KEY,
      prefix: val ? val.substring(0, Math.min(6, val.length)) : ''
    };
  });
  fs.writeFileSync(path.join(process.cwd(), 'test_environment_debug.json'), JSON.stringify(envSummary, null, 2));
} catch (dumpErr: any) {
  try {
    fs.writeFileSync(path.join(process.cwd(), 'test_environment_debug.json'), JSON.stringify({ error: dumpErr?.message || String(dumpErr) }, null, 2));
  } catch (fErr) {}
}

// Initialize Firebase SDK for Node process (Backend Database Sync)
let firebaseApp: any;
let db: any;
let firebaseApiKey: string | undefined = undefined;

try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    setSharedDb(db); // share the handle with extracted route modules (Phase 1)
    firebaseApiKey = firebaseConfig.apiKey;
    console.log('✅ Firebase initialized successfully. Resolved fallback ApiKey:', firebaseApiKey ? 'present' : 'absent');
    // P-PME.8 — hydrate persisted feature flags into the in-memory cache so admin toggles survive
    // restarts. Best-effort + non-blocking: a load failure leaves the hardcoded defaults in place.
    import('./src/server/FeatureFlagManager')
      .then(({ loadFlagConfig }) => loadFlagConfig())
      .then((cfg) => { if (cfg?.flags) Object.assign(serverStats.featureFlags, cfg.flags); })
      .catch(() => { /* feature-flag hydration is best-effort */ });
  } else {
    console.warn('⚠️ firebase-applet-config.json not found. Firebase features will be disabled.');
  }
} catch (error) {
  console.error('⚠️ Failed to initialize Firebase:', error);
}

// Encryption & secrets helpers — extracted to src/server/lib/secrets.ts (Phase 1).


// Token counter helpers
// ══ PWA App Store (in-memory, 24h TTL) ══
const pwaStore: PwaStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, entry] of pwaStore.entries()) {
    if (entry.createdAt < cutoff) pwaStore.delete(id);
  }
}, 60 * 60 * 1000);

// ══ SDA Clinical Store (in-memory, 24h TTL) ══
interface SdaClinicalEntry {
  patientData: Record<string, any>;
  redFlags: string[];
  stage: string;
  createdAt: number;
  updatedAt: number;
}
const sdaClinicalStore = new Map<string, SdaClinicalEntry>();
const sdaRecentMessages = new Map<string, Array<{ role: 'user' | 'assistant'; content: string; ts: number }>>();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, entry] of sdaClinicalStore.entries()) {
    if (entry.updatedAt < cutoff) sdaClinicalStore.delete(id);
  }
  for (const [id, msgs] of sdaRecentMessages.entries()) {
    if (!sdaClinicalStore.has(id)) sdaRecentMessages.delete(id);
  }
}, 60 * 60 * 1000);

(async () => {
  // P2.2 — install process-level error handlers ASAP so nothing goes unreported
  // (best-effort capture to Cloud Error Reporting; report-and-continue, never crash).
  installGlobalErrorHandlers();

  const app = express();
  // P-TQA.10 — HTTP security headers. The exact policy (CSP directives, COOP, etc.) lives in
  // src/server/lib/securityHeaders.ts so it can be unit-tested; see that file for why each
  // directive is shaped the way it is (Firebase Auth popups, live-preview iframes, OAuth opener).
  app.use(helmet(securityHeadersConfig));
  app.use(traceMiddleware);

  // Bundled native shell CORS + OPTIONS preflight (Capacitor): for native shells (Android/iOS app)
  // whose WebView runs locally (https://localhost, capacitor://localhost), every API call is cross-origin.
  // This middleware sets CORS headers for allowlisted native origins and short-circuits OPTIONS
  // preflights with 204 + reflected request headers. For same-origin web traffic (no Origin header),
  // it is a pure no-op.
  // SERVER LOAD — count in-flight requests. Mounted FIRST so the count covers every request, not
  // only the ones that survive the middleware below it; an "how busy is it" number that silently
  // excludes rejected or redirected traffic would understate exactly the load worth seeing.
  serverLoad.start();
  app.use(serverLoad.middleware);
  app.use(corsMiddleware());

  // ── Rate Limiters (4.3) ──────────────────────────────────────────────────
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,   // 20 req/min per IP — generous for normal chat, tight for abuse
    // Key on IP only. The client-supplied x-user-id header is spoofable — rotating it let an
    // attacker bypass the limit entirely and burn NavBharatAI's own AI budget.
    keyGenerator: (req) => ipKeyGenerator(req as any),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment before sending again.' },
  });

  const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => ipKeyGenerator(req as any),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many payment requests. Please slow down.' },
  });

  const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => ipKeyGenerator(req as any),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many admin requests.' },
  });

  // ── ONE CANONICAL HOST (admin's console, 2026-08-22: `POST https://www.navbharatai.com/... 401`) ──
  //
  // The site answered on BOTH `navbharatai.com` and `www.navbharatai.com`, and auth works on only one:
  // `authDomain` is a SINGLE value, chosen so the auth handler is SAME-ORIGIN with the app. On `www.`
  // that property is gone — the session is partitioned away from the page and every request goes out
  // without a token, so a user who has just signed in successfully is 401 everywhere. It looked like
  // every provider broke at once, with no error, because from the browser's side nothing failed.
  //
  // Mounted FIRST so nothing else can answer on the wrong host, and narrow by construction: it moves
  // only the `www.` twin of the configured host and is OFF entirely unless CANONICAL_HOST is set.
  const CANONICAL_HOST = canonicalHostFromEnv();
  app.use((req: any, res: any, next: any) => {
    const d = canonicalHostRedirect({ host: req.headers?.host, originalUrl: req.originalUrl || req.url || '/', canonical: CANONICAL_HOST });
    if (!d.redirectTo) { next(); return; }
    res.redirect(d.status, d.redirectTo);
  });

  // ── Structured Audit Logger (4.7) ────────────────────────────────────────
  // ── Security Middleware: Block malware scanner paths ─────────────────────
  app.use((req, res, next) => {
    const maliciousPaths = ['/wp-admin', '/wp-content', '/wp-includes', '/.env', '/config.php'];
    if (maliciousPaths.some(path => req.path.startsWith(path))) {
      audit('BLOCKED_SCAN', { ip: req.ip, path: req.path });
      return res.status(403).send('Forbidden');
    }
    next();
  });

  // ── P-SEC.8 — Adaptive bot detection + progressive backoff ───────────────
  // Behavioural layer in FRONT of the static per-IP limiters below: bot-UA + burst
  // fingerprinting with an escalating slow-down, then a short hard block for repeat
  // offenders. Scoped to the /api/ surface (the expensive, abuse-prone endpoints).
  app.use(adaptiveGuard());

  const PORT = Number(process.env.PORT || 8080);
  // aiRouter — shared singleton from src/server/lib/aiRouter.ts (Phase 1, AI-core).

  // Trust proxy for correct req.protocol and req.get('host') behind reverse proxies
  app.set('trust proxy', true);

    app.use(express.json({
      limit: '30mb',  // room for vision attachments (images/PDFs as base64)
      // Stash the raw bytes so the /preview-app reverse proxy can forward POST
      // bodies verbatim to the previewed dev server (Bug: rawBody was read but
      // never populated → all proxied POSTs sent an empty body).
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }));

  // Hit counter middleware
  app.use((req: any, _res: any, next: any) => {
    serverStats.totalHits++;
    const today = new Date().toISOString().slice(0, 10);
    serverStats.dailyHits.set(today, (serverStats.dailyHits.get(today) || 0) + 1);
    next();
  });

  // P1.1 — API Versioning. Mounted before route matching so `/api/v1/...` is
  // internally rewritten to the existing `/api/...` handlers (canonical), while
  // bare `/api/...` keeps working as a deprecated shim (Deprecation + Link headers).
  app.use(apiVersionMiddleware);

  // Cashfree Configuration
  if (process.env.CASHFREE_APP_ID) (Cashfree as any).XClientId = process.env.CASHFREE_APP_ID;
  if (process.env.CASHFREE_SECRET_KEY) (Cashfree as any).XClientSecret = process.env.CASHFREE_SECRET_KEY;
  (Cashfree as any).XEnvironment = 'PRODUCTION';
  
  // Firebase Auth helper proxy. With authDomain pointed at our own domain (so
  // signInWithRedirect returns SIGNED-IN and the Google consent screen reads
  // "continue to navbharatai.com"), the browser requests the sign-in helper code
  // from OUR origin. We reverse-proxy those `/__/auth/*` and `/__/firebase/*`
  // requests to the project's Firebase host, which serves the real handler/iframe.
  // Registered before the SPA catch-all so it isn't swallowed and returned as
  // index.html. Streams the request/response untouched (any method).
  const FIREBASE_AUTH_HOST = 'gen-lang-client-0866594388.firebaseapp.com';
  // Keep-alive agent: the sign-in handler pulls several sub-resources back-to-back; reusing one warm
  // TLS connection removes a fresh handshake per request (a big chunk of the perceived login latency).
  const firebaseAuthAgent = new https.Agent({ keepAlive: true, maxSockets: 64, timeout: 15000 });
  // A stalled upstream must FAIL FAST, never hang. Node's https.request has NO default timeout, so a
  // stuck socket could leave the login popup waiting minutes (the exact "Google login takes 5–7 min"
  // symptom). Cap it at 15s → the browser retries a fresh request instead of hanging on a dead one.
  const AUTH_PROXY_TIMEOUT_MS = 15000;
  const proxyFirebaseAuth = (req: any, res: any) => {
    const upstream = https.request(
      {
        hostname: FIREBASE_AUTH_HOST,
        port: 443,
        path: req.originalUrl,
        method: req.method,
        headers: { ...req.headers, host: FIREBASE_AUTH_HOST },
        agent: firebaseAuthAgent,
        timeout: AUTH_PROXY_TIMEOUT_MS,
      },
      (pres) => {
        // 🔒 COOKIES MUST BIND TO *OUR* HOST (admin 2026-08-22 — the Apple redirect login loop).
        // The upstream sets its cookies for `*.firebaseapp.com`; arriving from navbharatai.com the
        // browser MUST reject those, so the handler believed it stored its state, the browser dropped
        // it, the return leg found nothing, and the app loaded logged out — with no error anywhere,
        // because nothing actually failed. Google was unaffected: the popup flow hands its result back
        // by postMessage and never needs a cookie to survive a cross-site return. See authProxyCookies.
        const host = String(req.headers?.host || '').split(':')[0];
        res.writeHead(pres.statusCode || 502, rewriteProxyHeaders(pres.headers as Record<string, unknown>, host));
        pres.pipe(res, { end: true });
      },
    );
    // timeout fires on an idle socket (connect or response stall) — abort so the client fails fast.
    upstream.on('timeout', () => { upstream.destroy(new Error('auth proxy upstream timeout')); });
    upstream.on('error', () => { if (!res.headersSent) res.status(504).end('Auth proxy timeout'); });
    req.pipe(upstream, { end: true });
  };
  // APPLE DOMAIN VERIFICATION (admin 2026-08-21) — mounted BEFORE the static handler, whose `dotfiles`
  // default is 'ignore' and would skip a `.well-known` directory even if the file were on disk. See
  // lib/appleDomainAssociation.ts for why Apple's own authorize endpoint 403s without this.
  app.get(APPLE_DOMAIN_ASSOCIATION_PATH, (_req: any, res: any) => {
    const body = appleDomainAssociation(process.env, (f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8'));
    if (!body) {
      // Honest 404, never an empty 200 — Apple would read an empty body as a MISMATCHED file, and the
      // admin would be debugging the wrong thing.
      res.status(404).type('text/plain').send('Apple domain association file is not configured.');
      return;
    }
    res.type('text/plain').send(body);
  });

  app.use('/__/auth', proxyFirebaseAuth);
  app.use('/__/firebase', proxyFirebaseAuth);

  // Sonic Chat status (GET) — registered BEFORE the SPA catch-all (app.get('*')) so the dev
  // Vite middleware doesn't swallow it and return index.html. Experimental, flag+creds gated.
  registerSonicRoutes(app);

  async function initializeServer() {

    // Vite integration.
    //
    // Imported LAZILY, inside the dev-only branch. Vite is a DEV bundler — production serves the
    // pre-built dist/ below and never calls this. A top-level `import ... from 'vite'` nevertheless
    // loaded the whole bundler into every production boot, which is why vite had to be a runtime
    // dependency, which is why its nested esbuild Go binary shipped to Cloud Run and answered for 14
    // HIGH CVEs in a container that never bundles anything (Trivy, 2026-08-04).
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      // Robust production path resolution
      const distPath = path.join(process.cwd(), 'dist');
      console.log(`[PRODUCTION] Serving static files from: ${distPath}`);
      // 12.7 — CDN-friendly Cache-Control headers for static assets
      app.use(express.static(distPath, {
        maxAge: '1y',          // JS/CSS hashed by Vite → safe to cache 1 year
        immutable: true,
        setHeaders: (res, filePath) => {
          // P3.4 — CDN/edge cache policy (single source of truth in staticCache.ts).
          const cc = cacheControlFor(filePath);
          if (cc) res.setHeader('Cache-Control', cc);
          if (filePath.endsWith('.html')) {
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        }
      }));
      app.get('*', (req, res, next) => {
        // The SPA fallback is registered (inside initializeServer) BEFORE the API
        // and preview routes below. Because app.get('*') matches every GET, it
        // would otherwise swallow GET routes registered afterwards (live preview,
        // GET APIs) and return index.html with a 200 — which is exactly why the
        // preview silently "worked" in audits but showed the main app. Let those
        // paths fall through to their real handlers.
        // ONE source of truth for this decision (src/server/lib/spaFallback.ts). The list used to live
        // inline here and drifted twice: the live preview once, and then DEPLOYED USER APPS (/pwa/<id>)
        // — a user's deployed app link opened NavBharatAI instead of their own app, because /pwa/ was
        // never added. A test now reads the real route modules and fails if any server route is missing
        // from the list, so the next added route cannot silently return index.html.
        if (spaFallbackShouldDefer(req.path)) {
          return next();
        }
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
    
   }
  
  await initializeServer();

  // Auth routes (OTP gateway) — extracted to src/server/routes/auth.ts (Phase 1).
  registerAuthRoutes(app);

  // Health/liveness/readiness + the public status page + admin Firestore backup trigger all live in
  // registerHealthRoutes. U-15 made GET /api/health a DEEP report (status + real uptime/memory/version
  // + per-dependency checks); it still returns status:'ok' when healthy, so existing probes keep working.
  // The old inline shallow /api/health ({status,uptime,port}) was removed so it can't shadow the deep one.
  registerHealthRoutes(app);
  // User reports (admin 2026-08-21): one submit route for everyone, and the admin routes that READ them
  // — deliberately registered together, because a report nobody can read is what this replaced.
  registerReportRoutes(app);

  // P3.3 — keep-warm: GET /api/warm pre-warms the heavy PRO/SDA singletons. Hit by an
  // external Cloud Scheduler so min-instances=0 stays (see docs/SCALABILITY.md).
  registerWarmRoute(app);

  // RETIRED — AppMaker telemetry/job routes (old engine). Unregistered in the v3.0 cutover.
  // registerAppmakerRoutes(app);

  // Create Order Endpoint
  // Create-order route — extracted to src/server/routes/createOrder.ts (Phase 1).
  registerCreateOrderRoute(app);

  // AI clients + key resolution — extracted to src/server/lib/aiClients.ts (Phase 1, AI-core step a).

  // NAVBHARAT_OS_V2 system prompt — extracted to src/server/lib/prompts.ts (Phase 1, AI-core step b0).

  // Mode/agent context builders — extracted to src/server/lib/prompts.ts (Phase 1, AI-core step b0).

  // AI Call functions
  // AI call functions (callGemini/Groq/DeepSeek/OpenAI/Claude/OpenRouter) — extracted to src/server/lib/aiCalls.ts (Phase 1, AI-core step b).

  // generateOfflineResponse — extracted to src/server/lib/offlineResponse.ts (Phase 1, AI-core step b2).

  // API Endpoints
  // GitHub OAuth Flow
  // GitHub OAuth routes — extracted to src/server/routes/githubAuth.ts (Phase 1).
  registerGithubAuthRoutes(app);

  // Firebase OAuth / Google Consent Mock Flow
  // Firebase auth (mock) routes — extracted to src/server/routes/firebaseAuth.ts (Phase 1).
  registerFirebaseAuthRoutes(app);

  // Secure Cloud Sync Endpoints (with Authenticated user validation check)
  // Cloud-sync provider routes — extracted to src/server/routes/cloudsync.ts (Phase 1).
  registerCloudsyncRoutes(app);

  // GitHub data-API routes — extracted to src/server/routes/github.ts (Phase 1).
  registerGithubRoutes(app);

  // Ship-to-stores: generate a real GitHub Actions build pipeline for a user's app (signed .aab +
  // .ipa → TestFlight) and dispatch it. See src/server/lib/mobileShipKit.ts for why the binary is
  // built on GitHub's runners rather than here.
  registerMobileShipRoutes(app);

  // Code Minifier — real AST minification (esbuild) of the user's OWN app files, with a verified
  // restore point before anything is overwritten. See src/server/routes/minify.ts for why the
  // checkpoint and the write are both read back rather than trusted.
  registerMinifyRoutes(app);

  // The shared "read and change one of my apps" API behind every Design & Build tool. Its writes go
  // through the same verified-restore-point sequence the Minifier uses — see lib/workspaceEdit.ts.
  registerWorkspaceFileRoutes(app);

  // "Set up my app for the stores" — assembles a user's v5 app into a GitHub repo whose workflows
  // build a genuine signed .aab/.ipa on GitHub's runners. See routes/mobileSetup.ts for who does what.
  registerMobileSetupRoutes(app);

  // Nav App Store — user-published Android apps. Every upload is inspected and malware-scanned, and
  // NOTHING becomes public without an explicit admin approval. See routes/navStore.ts.
  registerNavStoreRoutes(app);

  // Security scan + website audit routes — extracted to src/server/routes/audit.ts (Phase 1, AI-core step e).
  registerAuditRoutes(app);

  // New Isolated Chat Endpoints
  // Chat routes (general + Vishwakarma tiers) — extracted to src/server/routes/chat.ts (Phase 1, AI-core step c).
  registerChatRoutes(app, chatLimiter);

  // Pro engine routes (pro-chat + pro-build + callClaudePro) — extracted to src/server/routes/pro.ts (Phase 1, AI-core step d).
  registerProRoutes(app);
  // Senior Doctor Assistant (SDA) chat route — extracted to src/server/routes/sda.ts (Phase 1, AI-core step e).
  registerSdaRoutes(app);
  registerProfessionalsRoutes(app);
  registerRepoAnalystRoutes(app);
  // Connect-App code review (/api/app-review/review) — real AI review of a connected
  // NavBharatAI app or GitHub repo, from the AI Code Review tool's "Connect App" flow.
  registerAppReviewRoutes(app);
  registerNotificationRoutes(app);
  // DELETED — Engineer AI (/api/engineer-*) was unregistered in the v3.0 cutover and its dead
  // files were removed on 2026-07-09 (see the import-block note above). Replaced by Pro v3.0.

  // AgentV3 (Vargen 3.0) — v3.0 agent engine, strangler-fig P0 skeleton.
  // Flag-gated (AGENTV3_ENABLED, default OFF); imports nothing from the live
  // build paths, so it cannot affect the live app until explicitly enabled.
  registerAgentV3Routes(app);

  // Custom-domain connect (Cloudflare for SaaS).
  registerDomainsRoutes(app);
  // Firebase-native custom-domain connect (Slice 2; gated by AGENTV3_FIREBASE_CUSTOM_DOMAINS).
  registerNbaiDomainsRoutes(app);

  // Wallet / sync / payment / admin / secrets / anthropic / zip routes (Phase 1 extractions).
  registerWalletRoutes(app);
  registerSyncRoutes(app);
  registerPaymentRoutes(app, paymentLimiter);
  registerAdminRoutes(app, adminLimiter);
  // MONITOR — point the shared metrics registry at the time-series store, ONCE. Every existing
  // getMetrics().recordBuild/recordModelCall call site then feeds the admin Monitor's charts with no
  // change at those call sites (see metricsTimeline.ts for why it is a sink and not a direct import).
  attachMetricsTimeline();
  // P2.1 — observability: recent distributed traces + live metrics (admin-gated).
  registerObservabilityRoutes(app);
  // P-PME.2 — release-notes generator (stateless blueprint-diff → structured notes).
  registerReleaseNotesRoutes(app);
  // P-PME.4 — build-time estimate / deadline prediction (stateless complexity+history → ETA).
  registerBuildEstimateRoutes(app);
  // P-PME.5 — build retrospective engine (stateless failed-build → classification + warnings).
  registerRetrospectiveRoutes(app);
  // P-DESIGN.5 — AI design pass (real multi-model FREE router): suggestions + palette/type-scale.
  registerDesignRoutes(app);
  // P-CGE.9 — deploy artifact generator (stateless → Dockerfile / compose / CI workflow).
  registerDeployArtifactsRoutes(app);
  registerSecretsRoutes(app);
  registerPushRoutes(app); // Push-notification device-token registration (native mobile app)
  registerSbomRoutes(app);
  registerBuildAnalyticsRoutes(app);
  // ROADMAP #1 Phase 1 — one-click database (connect the user's OWN Supabase account).
  registerSupabaseIntegrationRoutes(app, verifyFirebaseTokenForIntegrations);
  registerNavigateRoutes(app);
  registerWebhookRoutes(app);
  registerBotRoutes(app); // Hosted chat bots — real Telegram/WhatsApp connectors for the Bot Builder
  registerChangelogRoutes(app);
  registerTechDebtRoutes(app);
  registerVersionRoutes(app);
  registerHallucinationRoutes(app);
  registerHooksCheckRoutes(app); // AgentV3 — React Rules-of-Hooks check (POST /api/workspace/hooks-check)
  registerImportCheckRoutes(app); // AgentV3 — import/export consistency check (POST /api/workspace/import-check)
  registerJsxCheckRoutes(app); // AgentV3 — JSX undefined-component check (POST /api/workspace/jsx-check)
  registerScaleCheckRoutes(app); // AgentV3 — scaling check (POST /api/workspace/scale-check)
  registerGalleryRoutes(app); // Community gallery / remix — publish gate + admin-only approval
  registerWorkspaceHealthRoutes(app); // AgentV3 — one-call build-health aggregate (POST /api/workspace/health-check)
  // (registerSonicRoutes is registered earlier, before the SPA catch-all — see above.)
  registerUndefinedHookCheckRoutes(app); // AgentV3 — undefined-hook-call check (POST /api/workspace/hook-resolution-check)
  registerDepConstraintCheckRoutes(app); // P-AI.14 — dependency version-constraint check (POST /api/workspace/dependency-check)
  registerReleaseGateRoutes(app); // P-DEPLOY.5 — public release freeze/approval gate status (GET /api/release/gate)
  registerTeamLibraryRoutes(app); // P-COLLAB.4 — team-scoped shared library (prompts/templates/components)
  registerTraceabilityRoutes(app); // P-PME.12 — requirement→file→test traceability matrix (POST/GET /api/workspace/traceability)
  registerExplainCodeRoutes(app); // P-DEV.10 — deterministic code explanation (POST /api/workspace/explain)
  registerDebugRoutes(app); // AI Debugger — real free-tier AI error analysis (POST /api/debug)
  registerAppDebugRoutes(app); // Full-App Debugger — whole-codebase scan (GET /api/app-debug/sources, POST /api/app-debug/run)
  registerImageGenRoutes(app); // AI Image Gen — real image generation on our own key (POST /api/image/generate)
  registerDevtoolsProxyRoutes(app); // API Tester — SSRF-guarded server proxy (POST /api/devtools/proxy)
  registerScreenshotToPromptRoutes(app); // Screenshot→Code — vision → build prompt (POST /api/screenshot/to-prompt)
  registerFigmaProxyRoutes(app); // Figma Import — server-side Figma fetch (POST /api/figma/proxy)
  registerCodeReviewRoutes(app); // P-DEV.11 — inline code review comments (/api/workspace/:workspaceId/review)
  registerZipRoutes(app, chatLimiter);
  // Chunked zip import — the only path a project larger than one HTTP request can take (see zipUpload.ts).
  registerZipUploadRoutes(app);
  // Preview routes (Phase 3 — hybrid runtime preview via PreviewService).
  registerPreviewRoutes(app, chatLimiter);
  // Same-origin npm mirror for the in-browser preview — immutable-cached, host-pinned to esm.sh.
  // Deliberately NOT rate-limited: one preview legitimately requests dozens of modules in a burst,
  // and a 429 here would blank it; the LRU + entry caps are the resource bound.
  registerEsmMirrorRoutes(app);
  // Engine-backed build route (Phase 4 — VFS + EditEngine + Verifier + RepairLoop + preview).
  registerBuildRoutes(app);

  // User profile (My Profile page: display name, photo, build history, budget).
  registerProfileRoutes(app);
  registerExportRoutes(app); // P-DATA.7 — user data export (build history + usage as CSV/JSON/Excel)
  registerApiContractRoutes(app); // P-DATA.5 — OpenAPI 3.0.3 contract at /api/openapi.json + /api/docs viewer
  registerKnowledgeDocsRoutes(app); // U-9 — docs site at /guide + machine-readable /api/knowledge-base
  registerApiKeyRoutes(app); // U-7 — public API keys (/api/keys) + key-gated /api/v1/me

  // PWA "App Store" routes — extracted to src/server/routes/pwa.ts (Phase 1).
  registerPwaRoutes(app, pwaStore);

  // Team collaboration routes — extracted to src/server/routes/team.ts (Phase 1).
  registerTeamRoutes(app);

  // Client / stakeholder read-only share portal + feedback (P-COLLAB.3).
  registerShareRoutes(app);

  // Telemetry / analysis routes — extracted to src/server/routes/telemetry.ts (Phase 1).
  registerTelemetryRoutes(app);

  // P2.2 — Express error-handling middleware (must be LAST, after all routes). Captures
  // any error thrown/forwarded by a route into Cloud Error Reporting + the admin view,
  // correlated with the request's trace, and returns a clean 500 (no internals leaked).
  app.use((err: any, req: any, res: any, _next: any) => {
    errorTracker.capture(err, {
      source: 'middleware',
      httpMethod: req.method,
      httpUrl: req.originalUrl || req.url,
      httpStatus: 500,
    });
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  // Final diagnostic and server start

  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      // P2.4 — the server is initialized and listening → readiness probe goes green.
      markServerReady();
      // P-BRE.6 — recover build jobs orphaned by a previous instance's restart/crash: any job left
      // in a non-terminal status with a stale heartbeat is honestly marked FAILED (never silently
      // stuck). Fire-and-forget + self-guarded so it can never delay or crash startup.
      import('./src/server/AppMakerLab/jobs/BuildJobManager')
        .then(({ BuildJobManager }) => BuildJobManager.recoverStaleJobs())
        .then((ids) => { if (ids.length) console.log(`[P-BRE.6] recovered ${ids.length} orphaned build job(s):`, ids.join(', ')); })
        .catch(() => { /* best-effort — recovery must never affect boot */ });

      // P-ORCH.1 — start the shared scheduled-jobs engine and register recurring internal jobs through
      // it (instead of hand-rolled setInterval timers). Runs while this instance is alive; a guaranteed
      // cron surviving scale-to-0 needs Cloud Scheduler (honest follow-up).
      import('./src/server/lib/ScheduledJobs')
        .then(({ scheduler }) => {
          // P-DATA.4 — TTL retention purge, OPT-IN (DATA_RETENTION_PURGE_ENABLED=true) so no automated
          // deletion runs in production without explicit admin sign-off. Daily @ 03:00 UTC + once at boot.
          if (process.env.DATA_RETENTION_PURGE_ENABLED === 'true') {
            const runPurge = () => import('./src/server/lib/DataRetentionManager')
              .then(({ getRetentionDb, purgeExpired }) => {
                const db = getRetentionDb();
                return db ? purgeExpired(db, Date.now()) : null;
              })
              .then((r) => { if (r && r.totalDeleted) console.log(`[P-DATA.4] retention purge removed ${r.totalDeleted} expired record(s)`); })
              .catch(() => { /* best-effort — purge must never affect the server */ });
            scheduler.register({ id: 'retention-purge', schedule: { kind: 'dailyAtUtc', hour: 3, minute: 0 }, handler: runPurge });
            runPurge(); // once at boot
          }
          // MONITOR ALERTS — the admin is TOLD when build success, preview rate or build time leaves
          // its normal range, instead of finding out by happening to open the panel. Every 15 minutes;
          // the sweep itself decides what is worth saying (new / still-firing-after-a-cooldown /
          // recovered) and says NOTHING when the window cannot be judged. Kill switch: MONITOR_ALERTS=off.
          scheduler.register({
            id: 'monitor-alerts',
            schedule: { kind: 'everyMs', ms: 15 * 60_000 },
            handler: async () => {
              await import('./src/server/lib/monitorAlerts')
                .then(({ runMonitorAlertSweep }) => runMonitorAlertSweep())
                .catch(() => { /* monitoring must never affect the server */ });
            },
          });
          scheduler.start();
        })
        .catch(() => { /* best-effort — the scheduler must never affect boot */ });
    });

    // WebSocket / HMR reverse proxy for live previews. The HTTP side is handled
    // by routes/preview.ts, but WebSocket upgrades never reach Express route
    // handlers — they must be forwarded at the raw-socket level here. Without
    // this, a previewed Vite/Next dev server's HMR client fails in the browser
    // with "WebSocket connection error" and hot reload never connects.
    server.on('upgrade', (req, clientSocket, head) => {
      const url = req.url || '';
      // Sonic Chat (Nova Sonic voice) — isolated, flag+creds gated. Owns the upgrade for its
      // own path only; returns false (falls through to preview) for everything else.
      if (handleSonicUpgrade(req, clientSocket, head)) return;
      const m = url.match(/^\/preview-app\/([^/?]+)(\/[^?]*)?(\?.*)?$/);
      if (!m) { clientSocket.destroy(); return; }
      const target = getPreviewService().serverTarget(m[1]);
      if (!target) { clientSocket.destroy(); return; }

      const rest = (m[2] || '/') + (m[3] || '');
      const upstream = net.connect(target.port, target.host, () => {
        // Replay the upgrade handshake to the dev server with the
        // /preview-app/:sessionId prefix stripped, then pipe both ways.
        const lines = [`${req.method} ${rest} HTTP/1.1`];
        for (const [key, val] of Object.entries(req.headers)) {
          if (Array.isArray(val)) for (const v of val) lines.push(`${key}: ${v}`);
          else if (val !== undefined) lines.push(`${key}: ${val}`);
        }
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });

    // VAJRA V4-1c (NIRMAN Phase A, server half) — graceful drain on a deploy/rotation. Cloud Run
    // sends SIGTERM ~10s before killing the instance; without this, in-flight AgentV3 builds die
    // abruptly. Here we signal every live build honestly ("restarting — resumes automatically") and
    // abort it so its own finally (durable file + diagnostics save) runs, then close the HTTP server.
    // Fully bounded + catch-all: a hard timer force-exits so shutdown can NEVER hang the platform.
    let draining = false;
    const gracefulShutdown = (signal: string) => {
      if (draining) return; // a second signal must not re-run the drain
      draining = true;
      try {
        void import('./src/server/routes/agentv3')
          .then(({ drainRunningBuilds, shutdownGraceMs }) => {
            let n = 0;
            try { n = drainRunningBuilds(); } catch { /* best-effort */ }
            const grace = shutdownGraceMs(n);
            if (n) console.log(`[VAJRA V4-1c] ${signal}: draining ${n} in-flight build(s), grace ${grace}ms`);
            setTimeout(() => { try { server.close(); } catch { /* already closing */ } process.exit(0); }, grace).unref();
          })
          .catch(() => { try { server.close(); } catch { /* noop */ } process.exit(0); });
      } catch { process.exit(0); }
      // Absolute backstop: never let shutdown hang past the platform's grace window.
      setTimeout(() => process.exit(0), 9_000).unref();
    };
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (startupError: any) {
    console.error('❌ FATAL: Server failed to start:', startupError);
    process.exit(1);
  }
})();
