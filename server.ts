import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import crypto from 'crypto';
import net from 'net';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { LEGACY_EMBEDDED_API_KEY, isPlaceholder, resolveApiKey, hasKey, getGemini, getGroq, getDeepSeek, getOpenAI, getOpenRouter, getClaude } from './src/server/lib/aiClients';
import { registerPwaRoutes, type PwaStore } from './src/server/routes/pwa';
import { registerTelemetryRoutes } from './src/server/routes/telemetry';
import { registerTeamRoutes } from './src/server/routes/team';
import { registerShareRoutes } from './src/server/routes/share';
import { audit } from './src/server/lib/audit';
import { adaptiveGuard } from './src/server/lib/adaptiveRateLimit';
import { securityHeadersConfig } from './src/server/lib/securityHeaders';
import { setDb as setSharedDb } from './src/server/lib/db';
import { registerWalletRoutes } from './src/server/routes/wallet';
import { registerSecretsRoutes } from './src/server/routes/secrets';
import { registerSbomRoutes } from './src/server/routes/sbom';
import { registerBuildAnalyticsRoutes } from './src/server/routes/buildAnalytics';
import { registerNavigateRoutes } from './src/server/routes/navigate';
import { registerWebhookRoutes } from './src/server/routes/webhooks';
import { registerChangelogRoutes } from './src/server/routes/changelog';
import { registerTechDebtRoutes } from './src/server/routes/techDebt';
import { registerVersionRoutes } from './src/server/routes/version';
import { registerHallucinationRoutes } from './src/server/routes/hallucination';
import { getSecretValue } from './src/server/lib/secrets';
import { verifyPaymentInternal } from './src/server/lib/payments';
import { registerPaymentRoutes } from './src/server/routes/payment';
import { registerGithubRoutes } from './src/server/routes/github';
import { registerCloudsyncRoutes } from './src/server/routes/cloudsync';
// RETIRED — AppMaker telemetry routes (old engine). Unregistered in the v3.0 cutover; no frontend uses them.
// import { registerAppmakerRoutes } from './src/server/routes/appmaker';
import { registerAuthRoutes } from './src/server/routes/auth';
import { registerGithubAuthRoutes } from './src/server/routes/githubAuth';
import { registerFirebaseAuthRoutes } from './src/server/routes/firebaseAuth';
import { registerCreateOrderRoute } from './src/server/routes/createOrder';
import { getSecurityContext, NAVBHARAT_OS_V2, getBharatContext, getApiKeysInstruction, getVishwakarmaBasicContext, getVishwakarmaProContext, getVishwakarmaVipContext } from './src/server/lib/prompts';
import { callGemini, callGroq, callDeepSeek, callOpenAI, callClaude, callOpenRouter } from './src/server/lib/aiCalls';
import { generateOfflineResponse } from './src/server/lib/offlineResponse';
import { aiRouter } from './src/server/lib/aiRouter';
import { registerAuditRoutes } from './src/server/routes/audit';
import { registerChatRoutes } from './src/server/routes/chat';
import { registerProRoutes } from './src/server/routes/pro';
import { registerSdaRoutes } from './src/server/routes/sda';
import { registerProfessionalsRoutes } from './src/server/routes/professionals';
import { registerRepoAnalystRoutes } from './src/server/routes/repoAnalyst';
// RETIRED — Engineer AI routes (/api/engineer-*). Unregistered in the v3.0 cutover so the old
// Engineer AI engine can NEVER run (no route → no invocation → no file creation). Replaced by Pro v3.0.
// import { registerEngineerRoutes } from './src/server/routes/engineer';
import { registerAgentV3Routes } from './src/server/routes/agentv3';
import { registerDomainsRoutes } from './src/server/routes/domains';
import { registerZipRoutes } from './src/server/routes/zip';
import { registerPreviewRoutes } from './src/server/routes/preview';
import { registerBuildRoutes } from './src/server/routes/build';
import { getPreviewService } from './src/server/runtime/PreviewService';
import { serverStats } from './src/server/lib/serverStats';
import { registerAdminRoutes } from './src/server/routes/admin';
import { registerSyncRoutes } from './src/server/routes/sync';
import { registerProfileRoutes } from './src/server/routes/profile';
import { apiVersionMiddleware } from './src/server/routes/apiVersion';
import { tracer, parseCloudTraceContext } from './src/server/observability/Tracer';
import { registerObservabilityRoutes } from './src/server/routes/observability';
import { registerReleaseNotesRoutes } from './src/server/routes/releaseNotes';
import { registerConventionRoutes } from './src/server/routes/convention';
import { registerBuildEstimateRoutes } from './src/server/routes/buildEstimate';
import { registerDocsRoutes } from './src/server/routes/docs';
import { registerOpenApiRoutes } from './src/server/routes/openapi';
import { registerRetrospectiveRoutes } from './src/server/routes/retrospective';
import { registerTestGenRoutes } from './src/server/routes/testgen';
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
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import https from 'https';
import * as cheerio from 'cheerio';
import fs from 'fs';
import { AIRuntimeManager } from './src/server/AI/AIRuntimeManager';
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter';
import { getProviderStats, recordProviderLatency } from './src/server/AI/Router/AIRouter';
import { auditEnv } from './src/server/audit_env';
import { BuildJobManager } from './src/server/AppMakerLab/jobs/BuildJobManager';
import { buildApp as buildAppEngine, editApp as editAppEngine, buildReactApp as buildReactAppEngine } from './src/server/AppMakerLab/AppEngine';

auditEnv();

// ── In-memory server stats ─────────────────────────────────────────────────
// serverStats singleton — extracted to src/server/lib/serverStats.ts (Phase 1).

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
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
  const proxyFirebaseAuth = (req: any, res: any) => {
    const upstream = https.request(
      {
        hostname: FIREBASE_AUTH_HOST,
        port: 443,
        path: req.originalUrl,
        method: req.method,
        headers: { ...req.headers, host: FIREBASE_AUTH_HOST },
      },
      (pres) => {
        res.writeHead(pres.statusCode || 502, pres.headers);
        pres.pipe(res, { end: true });
      },
    );
    upstream.on('error', () => { if (!res.headersSent) res.status(502).end('Auth proxy error'); });
    req.pipe(upstream, { end: true });
  };
  app.use('/__/auth', proxyFirebaseAuth);
  app.use('/__/firebase', proxyFirebaseAuth);

  async function initializeServer() {

    // Vite integration
    if (process.env.NODE_ENV !== 'production') {
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
        if (
          req.path.startsWith('/api/') ||
          req.path.startsWith('/preview-app/') ||
          req.path.startsWith('/preview/')
        ) {
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

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), port: PORT });
  });

  // P2.4 — DR: liveness (/api/live), readiness (/api/ready), and the admin Firestore
  // backup trigger (/api/admin/backup/firestore).
  registerHealthRoutes(app);

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
  // RETIRED — Engineer AI (/api/engineer-*) is unregistered in the v3.0 cutover. With no route
  // the old engine can never be invoked → can never run or create files. Replaced by Pro v3.0.
  // registerEngineerRoutes(app);

  // AgentV3 (Vargen 3.0) — v3.0 agent engine, strangler-fig P0 skeleton.
  // Flag-gated (AGENTV3_ENABLED, default OFF); imports nothing from the live
  // build paths, so it cannot affect the live app until explicitly enabled.
  registerAgentV3Routes(app);

  // Custom-domain connect (Cloudflare for SaaS).
  registerDomainsRoutes(app);

  // Wallet / sync / payment / admin / secrets / anthropic / zip routes (Phase 1 extractions).
  registerWalletRoutes(app);
  registerSyncRoutes(app);
  registerPaymentRoutes(app, paymentLimiter);
  registerAdminRoutes(app, adminLimiter);
  // P2.1 — observability: recent distributed traces + live metrics (admin-gated).
  registerObservabilityRoutes(app);
  // P-PME.2 — release-notes generator (stateless blueprint-diff → structured notes).
  registerReleaseNotesRoutes(app);
  // P-CGE.3 — convention & naming check (stateless file/identifier/import analysis).
  registerConventionRoutes(app);
  // P-PME.4 — build-time estimate / deadline prediction (stateless complexity+history → ETA).
  registerBuildEstimateRoutes(app);
  // P-CGE.2 — documentation generators (stateless blueprint/routes/signatures → README/API/TSDoc).
  registerDocsRoutes(app);
  // P-CGE.5 — OpenAPI generator (stateless route specs → OpenAPI 3.0.3 document).
  registerOpenApiRoutes(app);
  // P-PME.5 — build retrospective engine (stateless failed-build → classification + warnings).
  registerRetrospectiveRoutes(app);
  // P-CGE.4 — test scaffold generator (stateless function/route/mock defs → Vitest skeletons).
  registerTestGenRoutes(app);
  // P-DESIGN.5 — AI design pass (real multi-model FREE router): suggestions + palette/type-scale.
  registerDesignRoutes(app);
  // P-CGE.9 — deploy artifact generator (stateless → Dockerfile / compose / CI workflow).
  registerDeployArtifactsRoutes(app);
  registerSecretsRoutes(app);
  registerSbomRoutes(app);
  registerBuildAnalyticsRoutes(app);
  registerNavigateRoutes(app);
  registerWebhookRoutes(app);
  registerChangelogRoutes(app);
  registerTechDebtRoutes(app);
  registerVersionRoutes(app);
  registerHallucinationRoutes(app);
  registerZipRoutes(app, chatLimiter);
  // Preview routes (Phase 3 — hybrid runtime preview via PreviewService).
  registerPreviewRoutes(app, chatLimiter);
  // Engine-backed build route (Phase 4 — VFS + EditEngine + Verifier + RepairLoop + preview).
  registerBuildRoutes(app);

  // User profile (My Profile page: display name, photo, build history, budget).
  registerProfileRoutes(app);

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
    });

    // WebSocket / HMR reverse proxy for live previews. The HTTP side is handled
    // by routes/preview.ts, but WebSocket upgrades never reach Express route
    // handlers — they must be forwarded at the raw-socket level here. Without
    // this, a previewed Vite/Next dev server's HMR client fails in the browser
    // with "WebSocket connection error" and hot reload never connects.
    server.on('upgrade', (req, clientSocket, head) => {
      const url = req.url || '';
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
  } catch (startupError: any) {
    console.error('❌ FATAL: Server failed to start:', startupError);
    process.exit(1);
  }
})();
