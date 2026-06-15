import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { LEGACY_EMBEDDED_API_KEY, isPlaceholder, resolveApiKey, hasKey, getGemini, getGroq, getDeepSeek, getOpenAI, getOpenRouter, getClaude } from './src/server/lib/aiClients';
import { registerPwaRoutes, type PwaStore } from './src/server/routes/pwa';
import { registerTelemetryRoutes } from './src/server/routes/telemetry';
import { registerTeamRoutes } from './src/server/routes/team';
import { audit } from './src/server/lib/audit';
import { setDb as setSharedDb } from './src/server/lib/db';
import { registerWalletRoutes } from './src/server/routes/wallet';
import { registerSecretsRoutes } from './src/server/routes/secrets';
import { getSecretValue } from './src/server/lib/secrets';
import { verifyPaymentInternal } from './src/server/lib/payments';
import { registerPaymentRoutes } from './src/server/routes/payment';
import { registerGithubRoutes } from './src/server/routes/github';
import { registerCloudsyncRoutes } from './src/server/routes/cloudsync';
import { registerAppmakerRoutes } from './src/server/routes/appmaker';
import { registerAuthRoutes } from './src/server/routes/auth';
import { registerAnthropicRoutes } from './src/server/routes/anthropic';
import { registerGithubAuthRoutes } from './src/server/routes/githubAuth';
import { registerFirebaseAuthRoutes } from './src/server/routes/firebaseAuth';
import { registerCreateOrderRoute } from './src/server/routes/createOrder';
import { getSecurityContext, NAVBHARAT_OS_V2, getBharatContext, getApiKeysInstruction, getVishwakarmaBasicContext, getVishwakarmaProContext, getVishwakarmaVipContext } from './src/server/lib/prompts';
import { callGemini, callGroq, callDeepSeek, callOpenAI, callClaude, callOpenRouter } from './src/server/lib/aiCalls';
import { generateOfflineResponse } from './src/server/lib/offlineResponse';
import { aiRouter } from './src/server/lib/aiRouter';
import { registerAuditRoutes } from './src/server/routes/audit';
import { registerChatRoutes } from './src/server/routes/chat';
import { registerZipRoutes } from './src/server/routes/zip';
import { serverStats } from './src/server/lib/serverStats';
import { registerAdminRoutes } from './src/server/routes/admin';
import { registerSyncRoutes } from './src/server/routes/sync';


// Traceability Infrastructure
export interface TraceContext {
  requestId: string;
  sessionId: string;
  conversationId: string;
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
  
  console.log(`[TRACE][API ENTRY] RID:${requestId} SID:${sessionId} CID:${conversationId} Path:${req.path}`);
  next();
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

(async () => {
  const app = express();
  app.use(traceMiddleware);

  // ── Rate Limiters (4.3) ──────────────────────────────────────────────────
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,   // 20 req/min per user — generous for normal chat, tight for abuse
    keyGenerator: (req) => (req.headers['x-user-id'] as string) || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment before sending again.' },
  });

  const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many payment requests. Please slow down.' },
  });

  const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => ipKeyGenerator(req),
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

  const PORT = Number(process.env.PORT || 8080);
  // aiRouter — shared singleton from src/server/lib/aiRouter.ts (Phase 1, AI-core).

  // Trust proxy for correct req.protocol and req.get('host') behind reverse proxies
  app.set('trust proxy', true);

    app.use(express.json({ limit: '30mb' }));  // room for vision attachments (images/PDFs as base64)

  // Hit counter middleware
  app.use((req: any, _res: any, next: any) => {
    serverStats.totalHits++;
    const today = new Date().toISOString().slice(0, 10);
    serverStats.dailyHits.set(today, (serverStats.dailyHits.get(today) || 0) + 1);
    next();
  });

  // Cashfree Configuration
  if (process.env.CASHFREE_APP_ID) (Cashfree as any).XClientId = process.env.CASHFREE_APP_ID;
  if (process.env.CASHFREE_SECRET_KEY) (Cashfree as any).XClientSecret = process.env.CASHFREE_SECRET_KEY;
  (Cashfree as any).XEnvironment = 'PRODUCTION';
  
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
          // HTML must always revalidate (never cache)
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (/\.(js|css|woff2|woff|ttf|otf)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (/\.(png|jpg|jpeg|svg|ico|webp)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week for images
          }
        }
      }));
      app.get('*', (req, res) => {
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

  // AppMaker telemetry/job routes — extracted to src/server/routes/appmaker.ts (Phase 1).
  registerAppmakerRoutes(app);

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

  // Legacy /api/chat route has been deprecated. Users should use /api/chat/:tier endpoints.
/*
app.post('/api/chat', async (req, res) => {
  return res.status(403).json({
    error: 'DEPRECATED_ROUTE',
    message: 'This endpoint is deprecated. Please use /api/chat/:tier endpoints.'
  });
});
*/

  // ── Proxy-aware Claude helper ─────────────────────────────────────────────
  // Cloud Run has ANTHROPIC_BASE_URL set to an OpenAI-compatible proxy.
  // Proxies expect "Authorization: Bearer <key>" (OpenAI format).
  // The Anthropic SDK sends "x-api-key: <key>" — rejected with 401.
  // This helper routes to OpenAI SDK (proxy) or Anthropic SDK (direct) correctly.
  async function callClaudePro(
    apiKey: string,
    systemPrompt: string,
    msgs: { role: 'user' | 'assistant'; content: any }[],
    maxTokens: number,
  ): Promise<string> {
    const rawBaseURL = process.env.ANTHROPIC_BASE_URL;
    const baseURL = rawBaseURL?.replace(/\/v1\/?$/, '');

    if (baseURL) {
      // OpenAI-compatible proxy path — sends Authorization: Bearer
      const proxyMsgs = [{ role: 'system' as const, content: systemPrompt }, ...msgs];
      const client = new OpenAI({ apiKey, baseURL });
      const models = [
        'anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6',
        'anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet-20241022',
      ];
      let lastErr: any;
      for (const model of models) {
        try {
          const r = await client.chat.completions.create({ model, messages: proxyMsgs, max_tokens: maxTokens });
          const text = r.choices[0]?.message?.content;
          if (text) return text;
        } catch (e: any) {
          console.warn(`[PRO-PROXY] model ${model} failed: ${e.message}`);
          lastErr = e;
        }
      }
      throw lastErr || new Error('All proxy models failed');
    }

    // Direct Anthropic SDK path — sends x-api-key
    const A = (await import('@anthropic-ai/sdk')).default;
    const r = await new A({ apiKey }).messages.create({
      model: 'claude-3-5-sonnet-20241022', max_tokens: maxTokens,
      system: systemPrompt, messages: msgs,
    });
    return (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
  }

  app.post('/api/pro-chat', async (req, res) => {
    console.log("=== HIT /api/pro-chat ===");
    try {
      let { message, history, mode, fileData, fileType, fileName, currentApp, memorySummary } = req.body;
      if (!message && !fileData) return res.status(400).json({ error: 'Message required' });
      message = message || '';
      if (memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20) {
        message = `[CONVERSATION MEMORY — summary of earlier discussion:\n${memorySummary.trim().slice(0, 2000)}]\n\nCurrent message: ${message}`;
      }
      const hasFile = !!(fileData && fileType);
      const isImageFile = hasFile && (fileType as string).startsWith('image/');
      const isPDFFile = hasFile && fileType === 'application/pdf';
      const isTextDoc = hasFile && !isImageFile && !isPDFFile;

      // Decode text/code files and prepend to message so all providers can use them
      if (isTextDoc && fileData) {
        try {
          const decoded = Buffer.from(fileData, 'base64').toString('utf-8').slice(0, 8000);
          message = `[Attached document: ${fileName}]\n\`\`\`\n${decoded}\n\`\`\`\n\n${message}`;
        } catch { /* keep original */ }
      }
      // Ensure file-only messages have a prompt
      if (!message.trim() && hasFile) message = isImageFile ? 'Please analyze this image in detail.' : isPDFFile ? 'Please analyze this document.' : 'Please review the attached file.';

      // currentApp context for planning mode
      const canvasContext = currentApp && typeof currentApp === 'string' && currentApp.length > 200
        ? `\n\n### CURRENT APP ON CANVAS (${currentApp.length} chars):\n\`\`\`html\n${currentApp.slice(0, 3000)}\n\`\`\`\nUser is discussing modifications/additions to THIS app.`
        : '';

      // ══ BUILDING MODE — Use AppEngine to generate real app ══
      if (mode === 'building') {
        console.log('[PRO] Building mode — AppEngine starting');
        const result = await buildAppEngine(message);

        if (result.success && Object.keys(result.files).length > 0) {
          console.log('[PRO] Build success:', Object.keys(result.files));
          return res.json({
            reply: result.reply,
            files: result.files,
            previewHtml: result.previewHtml,
            appName: result.appName,
            validationReport: result.validationReport,
            deploymentGuide: result.deploymentGuide,
          });
        } else {
          // AppEngine failed — fallback to direct Claude JSON build
          console.warn('[PRO] AppEngine failed, using direct build fallback');
          const BUILD_PROMPT = `You are the world's best AI app builder. Output ONLY JSON.
{"reply":"what was built","files":{"index.html":"complete html with inline css and js","style.css":"complete css","script.js":"complete js"}}
Write complete working code. Beautiful dark UI. No placeholders. Output ONLY the JSON.`;

          function extractJSON(raw: string): any | null {
            try { const p = JSON.parse(raw.trim()); if (p.files) return p; } catch {}
            const m1 = raw.match(/\`\`\`(?:json)?\s*([\s\S]+?)\s*\`\`\`/);
            if (m1) { try { const p = JSON.parse(m1[1].trim()); if (p.files) return p; } catch {} }
            const m2 = raw.match(/\{[\s\S]+\}/);
            if (m2) { try { const p = JSON.parse(m2[0]); if (p.files) return p; } catch {} }
            return null;
          }

          try {
            const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
            if (key) {
              const raw = await callClaudePro(key, BUILD_PROMPT, [{ role: 'user', content: message }], 8000);
              const parsed = extractJSON(raw);
              if (parsed) return res.json({ reply: parsed.reply || 'App ready!', files: parsed.files });
            }
          } catch (e: any) { console.warn('[PRO] Fallback Claude err:', e.message); }

          return res.status(500).json({ error: result.error || 'Build failed. Check API keys.' });
        }
      }

      // ══ CONVERSATION MODE — Friendly chat in Build Mode (greetings, questions) ══
      if (mode === 'conversation') {
        const CONV_SYS = `You are NavBharatAI Pro's friendly assistant. The user is in Build Mode — they can describe any app and you will build it instantly.

LANGUAGE RULE: Reply in the EXACT same language the user writes in. Hindi → Hindi, English → English, Hinglish → Hinglish.

Your role:
- Respond warmly to greetings, small talk, and casual messages
- If they ask what you can do: explain you can build any web app (games, social apps, tools, dashboards, quizzes, etc.) — just describe it
- If they ask about a feature or concept: explain briefly and helpfully
- Keep responses SHORT (2-4 sentences max)
- End with a gentle nudge: ask them to describe their app idea if they haven't yet
- NEVER write code`;

        try {
          const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
          if (!key) return res.json({ reply: 'Hello! Describe your app idea and I will build it for you! 🚀', files: {} });
          const msgs = [
            ...(history || []).slice(-6).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.text || m.content || '').slice(0, 400),
            })),
            { role: 'user' as const, content: message },
          ];
          const reply = await callClaudePro(key, CONV_SYS, msgs, 300);
          return res.json({ reply: reply || 'Hello! Tell me what app you want to build! 🚀', files: {} });
        } catch (e: any) {
          return res.json({ reply: 'Hello! Describe your app idea and I will build it! 🚀', files: {} });
        }
      }

      // ══ AUTO MODE — Human-like: chat, clarify, plan, or trigger build ══
      if (mode === 'auto' || mode === 'auto_plan' || mode === 'auto_build') {
        const isAutoPlan  = mode === 'auto_plan';
        const isAutoBuild = mode === 'auto_build';

        const AUTO_SYS = `You are NavBharatAI, a friendly expert who helps people build web apps. Talk like a real human — warm, natural, conversational. No corporate speak, no robotic tone.

LANGUAGE RULE: Always reply in the EXACT language the user writes in. Hindi → Hindi. Hinglish → Hinglish. English → English.

${isAutoPlan ? `MODE: PLAN THEN BUILD
The user wants to build something complex. Write a clear, friendly plan covering:
- What will be built (1-2 lines)
- Key features (bullets)
- UI/screens overview

Keep it concise — not a formal document. Then at the very end of your reply (on its own line), add exactly: __AUTO_PLAN__
This tells the frontend to show a "Build Now" button. Do NOT explain the marker.` : ''}

${isAutoBuild ? `MODE: DIRECT BUILD
The user wants something simple built. Respond in 1-2 friendly lines confirming what you'll make, then at the very end add exactly: __AUTO_BUILD__
This triggers the actual build. Do NOT explain the marker. Keep the human text very short.` : ''}

${mode === 'auto' ? `MODE: CONVERSATION
The user is asking a question, discussing something, or their intent is unclear.
- If they ask a question: answer naturally and helpfully
- If they mention an app vaguely: ask ONE simple clarifying question ("Banau kya? Koi features chahiye?")
- If they say "coding nahi" or similar: just talk, don't mention building
- Keep responses SHORT (2-5 sentences usually enough)
- Be helpful and warm` : ''}

NEVER write any code or HTML in your response.`;

        try {
          const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
          if (!key) return res.json({ reply: isAutoPlan ? 'Plan ready! __AUTO_PLAN__' : 'Theek hai, bana raha hun! __AUTO_BUILD__', files: {} });
          const msgs = [
            ...(history || []).slice(-10).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.text || m.content || '').slice(0, 800),
            })),
            { role: 'user' as const, content: message },
          ];
          const maxTokens = isAutoBuild ? 200 : isAutoPlan ? 500 : 400;
          const reply = await callClaudePro(key, AUTO_SYS, msgs, maxTokens);
          return res.json({ reply: reply || 'Haan, batao!', files: {} });
        } catch (e: any) {
          const fallback = isAutoBuild ? 'Theek hai, bana raha hun! __AUTO_BUILD__' : isAutoPlan ? 'Plan ready! __AUTO_PLAN__' : 'Haan, batao kya chahiye?';
          return res.json({ reply: fallback, files: {} });
        }
      }

      // ══ PLANNING MODE — No code, architecture discussion only ══

      // Detect build intent to flag frontend (no hard-block — AI still responds with plan)
      const BUILD_INTENT_PATTERN = /\b(bana[odo]*|banado|likhna|likho|likh do|create|make|build|generate|code karo|code kar|code do|implement|develop|app bana)\b/i;
      const suggestBuild = BUILD_INTENT_PATTERN.test(message);

      const PLAN_PROMPT = `You are NavBharatAI Pro's PLANNING EXPERT. Your job is to plan app blueprints — writing code is NOT your job.${canvasContext}

LANGUAGE RULE (MANDATORY):
- Detect the language/tone the user writes in and reply in EXACTLY the same language and tone
- Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi — whatever the user uses, you mirror it
- Match their emotion and formality level too

IRON RULES:
1. ABSOLUTELY NO CODE — not a single line of HTML, CSS, JS, Python, or anything. ZERO.
2. No code blocks (\`\`\`...\`\`\`) ever. If you need to mention a function/component, just write its name in plain text.
3. If user asks to "build", "create", "code" — immediately say: "This is Planning Mode. Switch to Build Mode to generate the app! 🔨"
4. Only discuss: feature list, user stories, UI sections, tech stack names (names only), architecture (text boxes/arrows only).

Response Format:
## 📱 App Concept
(1-2 line summary)

## ✨ Key Features
(bullet points — feature names only, no code)

## 🎨 UI/UX Design
(describe screens and layout in words)

## ⚙️ Tech Stack
(technology names only, no code)

## 🗺️ Architecture Overview
(text-based diagram only)

---
🔨 Ready? Switch to **Build Mode** — I'll generate the complete working app!`;

      // Strip any code blocks that slip through AI response
      const sanitizePlanningReply = (text: string): string => {
        return text
          .replace(/```[\s\S]*?```/g, '\n> ⚠️ *[Code removed — switch to Build Mode for actual code]*\n')
          .replace(/^\s{4,}.+$/gm, '') // strip indented code blocks
          .trim();
      };

      try {
        const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (key) {
          // Build user content — with optional vision attachment (images/PDFs only work on direct Anthropic path)
          let userContent: any = message;
          if (isImageFile) {
            userContent = [
              { type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } },
              { type: 'text', text: `[Image attached: ${fileName}]\n${message}` },
            ];
          } else if (isPDFFile) {
            userContent = [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } },
              { type: 'text', text: `[PDF attached: ${fileName}]\n${message}` },
            ];
          }
          const msgs = [
            ...(history || []).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user'|'assistant',
              content: String(m.text || m.content || '')
            })),
            { role: 'user' as const, content: userContent }
          ];
          const rawReply = await callClaudePro(key, PLAN_PROMPT, msgs, 1500);
          return res.json({ reply: sanitizePlanningReply(rawReply), files: {}, suggestBuild });
        }
      } catch (e: any) { console.warn('[PRO PLAN] Claude err:', e.message); }

      // ── Race 2: Claude + Grok simultaneously for planning ─────────────────
      const grokKeyPlan = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      const claudeKeyPlan = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      type PlanRacerFn = (signal: AbortSignal) => Promise<string>;
      const planRacers: PlanRacerFn[] = [];

      // Build the last user message content — include file for vision providers
      const buildRaceUserContent = (supportsImages: boolean): any => {
        if (!hasFile || !supportsImages) return message;
        if (isImageFile) return [
          { type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } },
          { type: 'text', text: `[Image: ${fileName}]\n${message}` },
        ];
        // PDFs: fallback to text label (OpenAI-format race doesn't support PDF natively)
        return `[PDF attached: ${fileName}]\n${message}`;
      };

      const planHistoryMsgs = (history || []).slice(-8).map((m: any) => ({
        role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: String(m.text || m.content || '').slice(0, 400),
      }));

      const planMsgsText = [
        { role: 'system' as const, content: PLAN_PROMPT },
        ...planHistoryMsgs,
        { role: 'user' as const, content: message },
      ];

      // NOTE: Claude race attempt — separate from the sequential attempt above
      if (claudeKeyPlan) planRacers.push(async (signal) => {
        const rawBase = process.env.ANTHROPIC_BASE_URL;
        const base = rawBase?.replace(/\/v1\/?$/, '');
        if (!base) throw new Error('No proxy for race');
        const c = new OpenAI({ apiKey: claudeKeyPlan, baseURL: base });
        const claudeMsgs = [
          { role: 'system' as const, content: PLAN_PROMPT },
          ...planHistoryMsgs,
          { role: 'user' as const, content: buildRaceUserContent(true) },
        ];
        for (const m of ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6']) {
          try {
            const r = await c.chat.completions.create({ model: m, messages: claudeMsgs, max_tokens: 1500 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; }
        }
        throw new Error('Claude plan race: empty');
      });

      if (grokKeyPlan) planRacers.push(async (signal) => {
        const c = new OpenAI({ apiKey: grokKeyPlan, baseURL: 'https://api.x.ai/v1' });
        // Use vision model for images, text model for everything else
        const grokModels = (hasFile && isImageFile) ? ['grok-2-vision-1212', 'grok-2-mini-vision-1212'] : ['grok-3', 'grok-3-fast'];
        const grokMsgs = [
          { role: 'system' as const, content: PLAN_PROMPT },
          ...planHistoryMsgs,
          { role: 'user' as const, content: buildRaceUserContent(!isPDFFile) },
        ];
        for (const gm of grokModels) {
          try {
            const r = await c.chat.completions.create({ model: gm, messages: grokMsgs, max_tokens: 1500 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; }
        }
        throw new Error('Grok plan race: empty');
      });

      if (planRacers.length > 0) {
        const planAcs = planRacers.map(() => new AbortController());
        try {
          const planWinner = await Promise.any(
            planRacers.map((fn, i) => fn(planAcs[i].signal).then(text => {
              planAcs.forEach((ac, j) => { if (j !== i && !ac.signal.aborted) ac.abort(); });
              console.log(`[PRO PLAN] Race won by ${i === 0 ? 'Claude' : 'Grok'}`);
              return text;
            }))
          );
          if (planWinner?.trim()) return res.json({ reply: sanitizePlanningReply(planWinner), files: {}, suggestBuild });
        } catch { console.warn('[PRO PLAN] Race both failed → Gemini/Vertex'); }
      }

      // ── Sequential fallback: Gemini → Vertex (both support images + PDFs via inlineData) ──
      // Build user parts with optional vision content
      const buildGeminiPlanParts = (): any[] => {
        const parts: any[] = [];
        if (hasFile && (isImageFile || isPDFFile)) {
          parts.push({ inlineData: { mimeType: fileType, data: fileData } });
          parts.push({ text: `[${isPDFFile ? 'PDF' : 'Image'}: ${fileName}]\n${PLAN_PROMPT}\n\nUser: ${message}` });
        } else {
          parts.push({ text: PLAN_PROMPT + '\n\nUser: ' + message });
        }
        return parts;
      };

      const geminiKeyPlan = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
      if (geminiKeyPlan) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const rawHistory = (history || []).slice(-10).filter((m: any) => String(m.text || m.content || '').trim().length > 0);
          let historyContents: any[] = rawHistory.map((m: any) => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: String(m.text || m.content || '').slice(0, 600) }]
          }));
          while (historyContents.length > 0 && historyContents[0].role !== 'user') historyContents.shift();
          for (const gm of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await new GoogleGenAI({ apiKey: geminiKeyPlan }).models.generateContent({
                model: gm,
                contents: [...historyContents, { role: 'user', parts: buildGeminiPlanParts() }],
              });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ge: any) { console.warn(`[PRO PLAN] Gemini ${gm}: ${ge.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Gemini err:', e.message); }
      }

      const projectIdPlan = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      if (projectIdPlan) {
        try {
          const { GoogleGenAI: VtxAI } = await import('@google/genai');
          const ai = new VtxAI({ vertexai: true, project: projectIdPlan, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          for (const vm of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await ai.models.generateContent({ model: vm, contents: [{ role: 'user', parts: buildGeminiPlanParts() }] });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ve: any) { console.warn(`[PRO PLAN] Vertex ${vm}: ${ve.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Vertex err:', e.message); }
      }

      return res.status(500).json({ error: 'All AI providers unavailable. Please check API keys in Cloud Run console.' });

    } catch (error: any) {
      console.error('Pro Chat Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ══ SSE STREAMING BUILD ENDPOINT — Live progress to frontend ══
  // ── Shared sanitizer for user-supplied HTML ─────────────────────────────────
  const sanitizeUserHtml = (html: string): string => html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\bignore\b.*\bprevious\b/gi, '')
    .replace(/\bsystem\s*prompt\b/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<script>[removed]</script>')
    .slice(0, 18000);

  app.post('/api/pro-build', async (req: any, res: any) => {
    let { message, currentFiles, isEdit, framework, history, fileAttachments, allFiles } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Process file attachments: text files decoded and prepended; images described via vision AI
    if (Array.isArray(fileAttachments) && fileAttachments.length > 0) {
      type FA = { name: string; type: string; base64: string };
      const fas: FA[] = fileAttachments;
      const textParts: string[] = [];
      const visionFas = fas.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      const textFas = fas.filter(f => !f.type.startsWith('image/') && f.type !== 'application/pdf');

      // Decode text/code files and prepend
      for (const f of textFas) {
        try {
          const decoded = Buffer.from(f.base64, 'base64').toString('utf8').slice(0, 6000);
          textParts.push(`\n\n[Reference file: ${f.name}]\n\`\`\`\n${decoded}\n\`\`\``);
        } catch { /* skip corrupt */ }
      }

      // For images/PDFs: use Gemini vision to get a description, inject into build prompt
      for (const f of visionFas) {
        try {
          const gemKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
          if (gemKey) {
            const { GoogleGenAI } = await import('@google/genai');
            const visionAI = new GoogleGenAI({ apiKey: gemKey });
            const descResult = await visionAI.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ parts: [
                { inlineData: { mimeType: f.type, data: f.base64 } },
                { text: 'Describe this image/document in detail for a developer building a web app: layout, colors, components, text, UI elements. Be precise and comprehensive.' },
              ]}],
            });
            const desc = descResult.text?.trim();
            if (desc) textParts.push(`\n\n[Reference ${f.type.startsWith('image/') ? 'image' : 'document'}: ${f.name}]\n${desc}`);
          } else {
            textParts.push(`\n\n[Reference ${f.type.startsWith('image/') ? 'image' : 'document'}: ${f.name} — vision AI unavailable, build based on the text description]`);
          }
        } catch (ve: any) {
          console.warn(`[PRO-BUILD] Vision description failed for ${f.name}: ${ve.message}`);
          textParts.push(`\n\n[Reference file: ${f.name} — use this as design inspiration]`);
        }
      }

      if (textParts.length > 0) message = message + textParts.join('');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Build conversation context string from history array
    const historyContext = Array.isArray(history) && history.length > 0
      ? history.map((m: any) => `${m.role === 'user' ? 'User' : 'AI'}: ${String(m.content || '').slice(0, 600)}`).join('\n')
      : '';

    // Detect edit mode: explicit flag OR has currentFiles with substantial content
    const hasCurrentFiles = currentFiles &&
      (typeof currentFiles.html === 'string' && currentFiles.html.length > 50) ||
      (allFiles && typeof allFiles === 'object' && Object.keys(allFiles).length > 0);
    const useEdit = isEdit === true || (hasCurrentFiles && isEdit !== false);

    // Build allFiles context string so edit engine knows full workspace
    let allFilesContext = '';
    if (allFiles && typeof allFiles === 'object') {
      const fileNames = Object.keys(allFiles);
      if (fileNames.length > 0) {
        const fileSnippets = fileNames.slice(0, 40).map(name => {
          const content = String(allFiles[name] || '').slice(0, 3000);
          return `\n\n### ${name}\n\`\`\`\n${content}${String(allFiles[name] || '').length > 3000 ? '\n...[truncated]' : ''}\n\`\`\``;
        }).join('');
        allFilesContext = `\n\n[WORKSPACE — ${fileNames.length} files total. Edit ONLY what the user requested; all other files will be preserved automatically]${fileSnippets}`;
      }
    }

    try {
      let result;
      if (useEdit && hasCurrentFiles) {
        // ── ITERATIVE EDIT PATH ──────────────────────────────────────────────
        const safeFiles = {
          html: sanitizeUserHtml((currentFiles?.html || allFiles?.['index.html'] || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.endsWith('.html')) || ''] || '')),
          js:   ((currentFiles?.js  || allFiles?.['script.js'] || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.match(/\.(js|ts|jsx|tsx)$/) && !k.endsWith('.d.ts')) || ''] || '')).slice(0, 250000),
          css:  ((currentFiles?.css || allFiles?.['style.css']  || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.match(/\.(css|scss)$/)) || ''] || '')).slice(0, 100000),
        };

        // ── TypeScript/React source workspace: file-level editing ──────────────
        // When allFiles has .tsx/.ts source files, the workspace is a framework app.
        // editAppEngine expects single-file {html,css,js} — it can't handle TSX.
        // Instead: ask AI which specific file(s) to change, edit them directly.
        const tsxSourceFiles = allFiles
          ? Object.keys(allFiles).filter((k: string) => /\.(tsx|ts|jsx)$/.test(k) && !k.includes('node_modules') && !k.endsWith('.d.ts'))
          : [];
        const isTsxSourceWorkspace = tsxSourceFiles.length > 0;

        if (isTsxSourceWorkspace) {
          send({ type: 'progress', stage: 'Analyzing workspace', step: 1, total: 3, detail: `${tsxSourceFiles.length} TypeScript files found` });

          // Step 1: AI identifies which file(s) to edit
          const fileListStr = tsxSourceFiles.slice(0, 60).join('\n');
          let targets: string[] = [];
          try {
            const planRaw = await aiRouter.route(
              `User request: "${message.slice(0, 500)}"\n\nFiles:\n${fileListStr}\n\nWhich 1-2 files to edit? JSON only: {"targets":["path"]}`,
              [], 'free', undefined,
              'TypeScript architect. Return only valid JSON {"targets":["path/to/file.tsx"]}.'
            );
            const parsed = JSON.parse(planRaw.replace(/```json?|```/g, '').trim());
            targets = ((parsed.targets || []) as string[]).filter((f: string) => allFiles?.[f]);
          } catch {}
          if (targets.length === 0) targets = [tsxSourceFiles[0]]; // fallback to first TS file

          send({ type: 'progress', stage: 'Editing source files', step: 2, total: 3, detail: `Updating ${targets.join(', ')}` });

          // Step 2: Edit each target file
          const updatedFiles: Record<string, string> = {};
          for (const filePath of targets.slice(0, 2)) {
            const original = String(allFiles?.[filePath] || '').slice(0, 20000);
            try {
              const updated = await aiRouter.route(
                `Edit this TypeScript/React file.\n\nUSER REQUEST: "${message.slice(0, 500)}"${historyContext ? `\nHISTORY:\n${historyContext.slice(0, 600)}` : ''}\n\nFILE: ${filePath}\n\n${original}\n\nReturn ONLY the complete updated file. No markdown.`,
                [], 'free', undefined,
                'TypeScript/React expert. Return ONLY the complete updated file content. No markdown fences, no explanation.'
              );
              updatedFiles[filePath] = updated;
              send({ type: 'file', fileName: filePath, content: updated });
            } catch (e: any) {
              console.warn(`[TSX-EDIT] ${filePath}:`, e.message);
            }
          }

          result = {
            success: true,
            reply: Object.keys(updatedFiles).length > 0
              ? `Updated ${Object.keys(updatedFiles).join(', ')}`
              : `Could not identify which files to edit — please be more specific about what to change.`,
            files: updatedFiles,
            fileList: Object.entries(updatedFiles).map(([p, c]) => ({ path: p, content: c, description: p })),
            previewHtml: '',
            appName: 'Updated App',
            validationReport: null,
            followUpSuggestions: [],
          };

        } else {
        // Server-side guard: if the existing HTML is too short/placeholder AND message looks
        // like a full new build, route to buildApp instead of editApp to avoid broken rewrites.
        // Only treat as placeholder if allFiles is also small (Vite HTML is < 400 chars but has many source files).
        const hasSubstantialWorkspace = allFiles ? Object.keys(allFiles).length > 5 : false;
        const isPlaceholderWorkspace = safeFiles.html.length < 400 && !hasSubstantialWorkspace;
        const looksFreshBuild = /\b(build|create|make|generate)\b/i.test(message) &&
          /\b(app|game|website|tool|dashboard|calculator|quiz|generator)\b/i.test(message);
        if (isPlaceholderWorkspace && looksFreshBuild) {
          console.log('[PRO-BUILD] Placeholder workspace + fresh-build request detected → routing to buildApp');
          const buildMsg = historyContext ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}` : message;
          result = await buildAppEngine(
            buildMsg,
            (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
            (fileName, content) => send({ type: 'file', fileName, content })
          );
        } else {
        const editMessage = allFilesContext ? message + allFilesContext : message;
        result = await editAppEngine(
          editMessage,
          safeFiles,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail, isEdit: true }),
          (fileName, content) => send({ type: 'file', fileName, content }),
          historyContext
        );
        } // end else (non-placeholder edit path)
        } // end else (non-TSX workspace)
      } else if (framework === 'react') {
        // ── REACT BUILD PATH ─────────────────────────────────────────────────
        const reactMessage = historyContext
          ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}`
          : message;
        result = await buildReactAppEngine(
          reactMessage,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
          (fileName, content) => send({ type: 'file', fileName, content })
        );
      } else {
        // ── FULL BUILD PATH ──────────────────────────────────────────────────
        const buildMessage = historyContext
          ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}`
          : message;
        result = await buildAppEngine(
          buildMessage,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
          (fileName, content) => send({ type: 'file', fileName, content })
        );
      }

      send({
        type: 'complete',
        files: result.files,
        reply: result.reply,
        appName: result.appName,
        previewHtml: result.previewHtml,
        success: result.success,
        error: result.error,
        validationReport: result.validationReport,
        deploymentGuide: result.deploymentGuide,
        followUpSuggestions: result.followUpSuggestions,
      });
    } catch (err: any) {
      const msg: string = err?.message || 'Unknown build error';
      let userFriendly = 'App build failed. Please try again.';
      let suggestion = 'Try simplifying your request or breaking it into smaller steps.';
      if (msg.includes('temporarily unavailable') || msg.includes('overloaded')) {
        userFriendly = 'AI service is temporarily busy.';
        suggestion = 'Wait 30 seconds and try again.';
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        userFriendly = 'Rate limit reached.';
        suggestion = 'Please wait 1 minute before building again.';
      } else if (msg.includes('token') || msg.includes('length') || msg.includes('too long')) {
        userFriendly = 'App request is too complex for one build.';
        suggestion = 'Break it into phases: first build the basic structure, then add features one by one.';
      } else if (msg.includes('API key') || msg.includes('auth') || msg.includes('401')) {
        userFriendly = 'AI provider authentication error.';
        suggestion = 'Contact support — API key may need renewal.';
      }
      send({ type: 'error', message: userFriendly, detail: msg, suggestion });
    }
    res.end();
  });

  // ── ZIP Import: streaming upload → yauzl entry-by-entry → SSE to frontend ───
  // Architecture:
  //   1. Frontend sends raw binary (Content-Type: application/octet-stream) → no base64, no JSON
  //   2. Server pipes req directly to disk → no memory buffer, handles any size
  //   3. yauzl reads ZIP entry-by-entry (skips node_modules/dist etc. without extracting them)
  //   4. SSE sends each file as it's read → frontend loads into Code Studio in real-time
  //   5. Preview updates live as HTML/CSS/JS arrive
  // ZIP import/export routes — extracted to src/server/routes/zip.ts (Phase 1).
  registerZipRoutes(app);

  /*
  if (walletSnap.exists()) {
    walletData = walletSnap.data();
    
    let updated = false;
    if (walletData.hasVishwakarmaPass === undefined) { walletData.hasVishwakarmaPass = false; updated = true; }
    if (walletData.tokenBalance === undefined) { walletData.tokenBalance = 0; updated = true; }
    if (walletData.totalTokensPurchased === undefined) { walletData.totalTokensPurchased = 0; updated = true; }
    if (walletData.totalTokensUsed === undefined) { walletData.totalTokensUsed = 0; updated = true; }
    if (walletData.walletLedger === undefined) { walletData.walletLedger = []; updated = true; }
    if (updated) {
      await setDoc(walletRef, walletData, { merge: true });
    }
  } else {
    // ... welcome bonus logic
  }

  // Auto-recharge only for non-Vishwakarma queries
  if (!isVishwakarmaAgent && walletData.remaining_balance <= 0) {
    // ... auto-recharge logic
  }
  */

  /*
    // STRICT SECURE ACTIVE SERVICE VERIFICATION GATEWAY
    if (isVishwakarmaAgent) {
      if (!userId) {
        return res.status(401).json({ 
          error: 'AUTHENTICATION_REQUIRED', 
          message: 'Login is required to access Agent Vishwakarma / AVS Chat.'
        });
      }

      // RESTRICT VISHWAKARMA VIP AGENT
      if (agent === 'vishwakarma_vip') {
        const isUserAdmin = userEmail === 'doc.asheesh@icloud.com' || req.headers['x-admin-auth'] === 'true';
        if (!isUserAdmin) {
          return res.status(403).json({
            error: 'VIP_ENTRY_DENIED',
            message: '🚫 Entry Denied / Permission Denied / Not Allowed. Vishwakarma VIP is private and administrator restricted only.'
          });
        }
        return res.status(403).json({
          error: 'VIP_CHAT_RESTRICTED',
          message: '🚫 Chatting is not allowed inside VIP mode bhrata. Only entry verification with backend console permission is supported.'
        });
      }

      const isProMode = agent === 'vishwakarma_pro';
      const passPrice = isProMode ? 100 : 50;

      if (!walletData || !walletData.hasVishwakarmaPass) {
        return res.status(402).json({
          error: 'PASS_ACTIVATION_REQUIRED',
          requirePass: true,
          passPrice: passPrice,
          message: `🔥 Unlock Agent Vishwakarma: Dynamic Vishwakarma access ke liye ₹${passPrice}/- ka Lifetime Entry Pass anivarya hai.`
        });
      }

      if (!walletData.tokenBalance || walletData.tokenBalance <= 0) {
        return res.status(402).json({
          error: 'TOKEN_BALANCE_EXHAUSTED',
          requireTokens: true,
          message: '🪙 Token balance exhausted! Agent Vishwakarma cannot reply without tokens. Please purchase new tokens.'
        });
      }
    }
  */


  // =============================================
  // WALLET & PAYMENT BILLING SYSTEM ENDPOINTS
  // =============================================

  // Wallet read routes — extracted to src/server/routes/wallet.ts (Phase 1).
  registerWalletRoutes(app);

  // ─── Cloud Sync: chat sessions + last generated app (cross-device) ──────────
  // Stored in Firestore `user_workspaces/{userId}` so a user's work follows them
  // to any device and never gets lost when browser storage is cleared.
  // Cloud sync routes — extracted to src/server/routes/sync.ts (Phase 1).
  registerSyncRoutes(app);

  // Payment routes — extracted to src/server/routes/payment.ts (Phase 1).
  registerPaymentRoutes(app, paymentLimiter);

  // Admin dashboard routes — extracted to src/server/routes/admin.ts (Phase 1).
  registerAdminRoutes(app, adminLimiter);
  // SECRETS

  // Secrets CRUD routes — extracted to src/server/routes/secrets.ts (Phase 1).
  registerSecretsRoutes(app);

  // Anthropic proxy route — extracted to src/server/routes/anthropic.ts (Phase 1).
  registerAnthropicRoutes(app);

  // ══ SENIOR DOCTOR ASSISTANT (SDA) ══
  app.post('/api/sda-chat', async (req: any, res: any) => {
    try {
      let { message, history = [], teachingMode = false, userId, fileData, fileType, fileName } = req.body;
      if (!message && !fileData) return res.status(400).json({ error: 'Message required' });
      message = message || 'Please analyze this medical document and extract all relevant clinical findings.';

      const hasFile = !!(fileData && fileType);
      const isImage = hasFile && fileType.startsWith('image/');
      const isPDF = hasFile && fileType === 'application/pdf';
      const isTextDoc = hasFile && !isImage && !isPDF &&
        (fileType === 'text/plain' || fileType === 'text/csv' || fileType === 'text/html' || fileType === 'application/json');

      // For plain-text documents: decode base64 → prepend content to message (works with all providers)
      if (isTextDoc && fileData) {
        try {
          const docText = Buffer.from(fileData, 'base64').toString('utf-8').slice(0, 10000);
          message = `[Document: ${fileName}]\n\n${docText}\n\n---\nDoctor's question: ${message}`;
        } catch { /* keep original message */ }
      }

      const SDA_SYSTEM = `You are the Senior Doctor Assistant (SDA) — a Clinical Decision Support AI inside NavBharatAI, designed exclusively for qualified doctors (MBBS, residents, consultants, specialists).

CORE IDENTITY:
- You are NOT a patient-facing chatbot, symptom checker, or general AI.
- You behave like an experienced senior consultant conducting a bedside case discussion with a junior doctor.
- You assist, you never replace. Final decisions always belong to the treating physician.
- Always communicate that you are assisting, not replacing, the doctor.

THE SINGLE MOST IMPORTANT RULE:
ASK ONLY ONE QUESTION AT A TIME. Never ask multiple questions. Never present questionnaires. Each question must follow from the previous answer. This is non-negotiable.

WORKFLOW SEQUENCE:
1. Demographics first: Age, Sex, Weight, Pregnancy status (if female, reproductive age), Current medications, Allergies, Chronic illnesses
2. Chief Complaint — ask for the single most important complaint
3. History of Present Illness — complaint-specific, dynamic questioning:
   - Fever pathway: duration, pattern, max temp, chills/rigors, rash, travel, mosquito exposure, sick contacts
   - Chest pain pathway: onset, location, radiation, severity, sweating, breathlessness, palpitations, syncope, cardiac risk factors
   - Abdominal pain pathway: location (use anatomical regions), character, radiation, bowel symptoms, food relation
   - Neuro pathway: consciousness, focal deficits, seizures, weakness, speech, headache features
   - Adapt pathway to whatever complaint is presented
4. Past Medical/Surgical/Medication/Allergy/Family/Social History
5. General Physical Examination: Temp, Pulse, BP, RR, SpO2, Pallor, Icterus, Cyanosis, Clubbing, Edema, Lymphadenopathy
6. Systemic Examination: relevant systems only based on complaint
7. Investigation review if provided

QUESTIONING RULES:
- Always provide structured answer options when clinically useful (e.g., pain location as anatomical regions, severity as 0-10 scale)
- Reject vague answers: if doctor says "SpO2 normal" respond "Please provide exact SpO2 value (e.g., 94%, 98%)"
- Validate every response before proceeding
- Adapt next question entirely based on previous answer

RED FLAG DETECTION (always active):
Screen continuously for: Shock, Sepsis, Respiratory failure, ACS, Stroke, Meningitis, Severe dehydration, Status epilepticus, GI bleed, Severe anemia, DKA, Obstetric emergencies, Pediatric emergencies.
If detected: IMMEDIATELY alert the doctor prominently before continuing.

DIFFERENTIAL DIAGNOSIS:
- Never anchor on one diagnosis. Always maintain ranked differentials.
- For each differential: supporting evidence, contradicting evidence, confirming investigations
- State uncertainty clearly when evidence is insufficient

MEDICATION SAFETY:
- Always check: age, weight, pregnancy, breastfeeding, renal/hepatic disease, allergies, drug interactions
- Never suggest a medication without evaluating available safety data

${teachingMode ? `TEACHING MODE ACTIVE: After each question, briefly explain WHY you are asking it and what clinical reasoning it serves. Help the doctor learn to think like a senior clinician.` : ''}

SPECIAL POPULATIONS:
- Pediatric: collect birth history, gestational age, immunization, development, feeding, growth
- Geriatric: focus on polypharmacy, frailty, fall risk, cognitive impairment
- Pregnant: trimester, fetal risk, medication safety

RESPONSE FORMAT:
- Be concise and clinical. No unnecessary padding.
- Use markdown for structure when generating summaries or differentials.
- For case summaries: include Demographics, CC, HPI, PMH, Examination, Investigations, Impression, Differentials, Red Flags, Safety notes, Next steps.
- For "What am I missing?": review entire case for missing history, examination gaps, investigation gaps, alternative diagnoses, cognitive biases.

CLINICAL TOOLS (when doctor requests via Quick Tools or in conversation):
- CLINICAL SCORES: Calculate SOFA, qSOFA, GCS, CURB-65, Wells PE/DVT, NIHSS, Killip — show step-by-step calculation, score value, mortality risk, and recommended action tier.
- DRUG INTERACTIONS: Systematically check every drug-drug pair and drug-disease interaction. Grade severity (mild/moderate/severe/contraindicated), explain mechanism, state clinical consequence, and give management (avoid/monitor/dose adjust).
- LAB INTERPRETATION: For each value: reference range, patient value, abnormality grade, clinical significance in this patient's context, and diagnostic implication. Flag critically abnormal values requiring immediate action.
- PEDIATRIC DOSING: Provide mg/kg dose, calculated total dose for patient weight, frequency, route, max dose, and any renal/hepatic adjustments. Reference BNF for Children / Harriet Lane.
- EMERGENCY PROTOCOLS: ABCDE approach, triage priority, immediate interventions, resuscitation medications with exact doses, which bundles to activate (Sepsis-6, STEMI protocol, stroke pathway, DKA protocol, anaphylaxis etc.), escalation criteria to ICU.
- ANTIBIOTIC STEWARDSHIP: Suspect organism, first-line drug (dose/frequency/route/duration), allergy alternative, empirical vs targeted, de-escalation strategy, when to narrow based on cultures.
- PREGNANCY SAFETY: For each drug — FDA category (A/B/C/D/X), trimester-specific risks, breast milk transfer, neonatal effects, safer alternatives, dose adjustments in pregnancy.
- REFERRAL DECISION: Referral yes/no with clear criteria, specialty, urgency (emergency/urgent/routine/elective), what to include in referral letter, pre-referral workup, escalation triggers.

END-OF-CASE SIGNAL: When you provide a final diagnosis, treatment plan, management summary, or discharge advice — conclude your response with this exact line on its own:
[CASE_COMPLETE]

LANGUAGE: Primarily English medical terminology. Can use Hinglish for brief clarifications if needed.

IMPORTANT: You are assisting a doctor. Responses must be clinically rigorous, evidence-based, and respectful of physician authority.`;

      // Extract structured data from response (simple heuristic)
      const extractPatientUpdate = (text: string, msg: string): Record<string, any> => {
        const update: Record<string, any> = {};
        const ageSexMatch = msg.match(/(\d+)\s*[-–]?\s*year[- ]?old\s*(male|female|m|f)/i);
        if (ageSexMatch) {
          update.age = ageSexMatch[1] + ' years';
          update.sex = ageSexMatch[2].toLowerCase().startsWith('m') ? 'Male' : 'Female';
        }
        const weightMatch = msg.match(/(\d+)\s*kg/i);
        if (weightMatch) update.weight = weightMatch[1] + ' kg';
        return update;
      };

      const detectRedFlags = (text: string): string[] => {
        const flags: string[] = [];
        const patterns: [RegExp, string][] = [
          [/\bshock\b/i, 'Shock'],
          [/\bsepsis\b/i, 'Sepsis'],
          [/spo2.{0,10}[0-8]\d%?|oxygen.{0,10}[0-8]\d/i, 'Low SpO2'],
          [/\brespiratory failure\b/i, 'Respiratory Failure'],
          [/\bchest pain\b.{0,30}\bsweating\b|\bdiaphoresis\b/i, 'Possible ACS'],
          [/\bstroke\b|\bfacial droop\b|\barm weakness\b/i, 'Stroke Signs'],
          [/\bmeningitis\b|\bneck stiffness\b.*fever/i, 'Meningitis Signs'],
          [/\bgi bleed\b|\bmelena\b|\bhematemesis\b/i, 'GI Bleeding'],
          [/\bdka\b|\bdiabetic ketoacidosis\b/i, 'DKA'],
          [/bp.{0,10}[0-7]\d\/|hypotension/i, 'Hypotension'],
        ];
        for (const [pattern, label] of patterns) {
          if (pattern.test(text) || pattern.test(message)) flags.push(label);
        }
        return flags;
      };

      const historyForAI = history.slice(-20).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || ''),
      }));

      let reply = '';

      // ── Shared helpers ───────────────────────────────────────────────────────
      // Build OpenAI-format message list (used by Claude proxy and Grok)
      const buildOpenAIMsgs = (userContent: any) => [
        { role: 'system' as const, content: SDA_SYSTEM },
        ...historyForAI,
        { role: 'user' as const, content: userContent },
      ];

      // Build Gemini/Vertex contents array (with optional file attachment)
      // NOTE: @google/genai SDK uses camelCase: inlineData/mimeType (NOT inline_data/mime_type)
      const buildGeminiContents = () => {
        const userParts: any[] = [];
        if ((isImage || isPDF) && fileData)
          userParts.push(
            { inlineData: { mimeType: fileType, data: fileData } },
            { text: `[${isPDF ? 'PDF Report' : 'Image'}: ${fileName}]\n${message}` }
          );
        else
          userParts.push({ text: message });
        return [
          ...historyForAI.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
          { role: 'user', parts: userParts },
        ];
      };

      // ── Race: Grok + Gemini simultaneously (SDA primary pair) ──────────────
      const sdaGrokKey   = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      const sdaGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

      type SdaRacerFn = (signal: AbortSignal) => Promise<string>;
      const sdaRacers: SdaRacerFn[] = [];

      // Grok supports images via vision models but NOT PDFs — skip Grok for PDF files
      if (sdaGrokKey && !isPDF) sdaRacers.push(async (signal) => {
        const { default: OpenAI } = await import('openai');
        const c = new OpenAI({ apiKey: sdaGrokKey, baseURL: 'https://api.x.ai/v1' });

        // For images: use Grok vision model with image_url format
        // For text: use standard Grok-3 models
        const models = isImage ? ['grok-2-vision-1212', 'grok-2-mini-vision-1212'] : ['grok-3', 'grok-3-fast'];
        const userContent: any = isImage && fileData
          ? [
              { type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } },
              { type: 'text', text: `[Image: ${fileName}]\n${message}` },
            ]
          : message;

        for (const m of models) {
          try {
            const r = await c.chat.completions.create({ model: m, messages: buildOpenAIMsgs(userContent), max_tokens: 2000 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; console.warn(`[SDA] Grok ${m}: ${e.message}`); }
        }
        throw new Error('Grok SDA: empty');
      });

      if (sdaGeminiKey) sdaRacers.push(async (signal) => {
        const { GoogleGenAI } = await import('@google/genai');
        const contents = buildGeminiContents();
        for (const m of ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']) {
          try {
            const r = await new GoogleGenAI({ apiKey: sdaGeminiKey }).models.generateContent({ model: m, systemInstruction: SDA_SYSTEM, contents, config: { thinkingConfig: { thinkingBudget: 0 } } });
            const t = r.text || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; console.warn(`[SDA] Gemini ${m}: ${e.message}`); }
        }
        throw new Error('Gemini SDA: empty');
      });

      if (sdaRacers.length > 0) {
        const sdaAcs = sdaRacers.map(() => new AbortController());
        try {
          const sdaWinner = await Promise.any(
            sdaRacers.map((fn, i) => fn(sdaAcs[i].signal).then(text => {
              sdaAcs.forEach((ac, j) => { if (j !== i && !ac.signal.aborted) ac.abort(); });
              console.log(`[SDA] Race won by ${i === 0 ? 'Grok' : 'Gemini'}`);
              return text;
            }))
          );
          if (sdaWinner?.trim()) reply = sdaWinner;
        } catch { console.warn('[SDA] Race (Grok+Gemini) both failed → Vertex/Claude'); }
      }

      // ── Sequential fallback: Vertex → Claude ─────────────────────────────
      if (!reply) {
        try {
          const sdaProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
          if (!sdaProjectId) throw new Error('No Vertex project ID');
          const { VertexAI } = await import('@google-cloud/vertexai');
          const vertexAI = new VertexAI({ project: sdaProjectId, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          const contents = buildGeminiContents();
          for (const modelName of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const model = vertexAI.getGenerativeModel({ model: modelName, systemInstruction: { role: 'system', parts: [{ text: SDA_SYSTEM }] } });
              const result = await model.generateContent({ contents });
              reply = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (reply) { console.log(`[SDA] Vertex ${modelName} succeeded`); break; }
            } catch (ve: any) { console.warn(`[SDA] Vertex ${modelName}:`, ve.message); }
          }
        } catch (e: any) { console.warn('[SDA] Vertex err:', e.message); }
      }

      if (!reply) {
        const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (anthropicKey) {
          try {
            const rawBaseURL = process.env.ANTHROPIC_BASE_URL;
            const baseURL = rawBaseURL?.replace(/\/v1\/?$/, '');
            if (baseURL) {
              const { default: OpenAI } = await import('openai');
              const client = new OpenAI({ apiKey: anthropicKey, baseURL });
              const userContent = isImage
                ? [{ type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } }, { type: 'text', text: `[Document: ${fileName}]\n${message}` }]
                : isPDF ? `[PDF attached: ${fileName}]\n${message}` : message;
              for (const model of ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6', 'anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet-20241022']) {
                try {
                  const r = await client.chat.completions.create({ model, messages: buildOpenAIMsgs(userContent), max_tokens: 2000 });
                  reply = r.choices[0]?.message?.content || '';
                  if (reply) { console.log(`[SDA] Claude proxy ${model} succeeded`); break; }
                } catch (e: any) { console.warn(`[SDA] Claude proxy ${model}:`, e.message); }
              }
            } else {
              const A = (await import('@anthropic-ai/sdk')).default;
              const userContent = isImage
                ? [{ type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } }, { type: 'text', text: `[Document: ${fileName}]\n${message}` }]
                : isPDF
                ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } }, { type: 'text', text: `[PDF Report: ${fileName}]\n${message}` }]
                : message;
              const r = await new A({ apiKey: anthropicKey }).messages.create({
                model: 'claude-3-5-sonnet-20241022', max_tokens: 2000, system: SDA_SYSTEM,
                messages: [...historyForAI, { role: 'user', content: userContent }],
              });
              reply = (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
              if (reply) console.log('[SDA] Claude direct succeeded');
            }
          } catch (e: any) { console.warn('[SDA] Claude err:', e.message); }
        }
      }

      if (!reply) {
        console.error('[SDA] All AI providers failed — returning 503');
        return res.status(503).json({ error: 'AI service unavailable. Please check API keys.' });
      }

      // Strip [CASE_COMPLETE] marker from reply before sending to client
      const suggestPDF = reply.includes('[CASE_COMPLETE]');
      const cleanReply = reply.replace(/\[CASE_COMPLETE\]\s*/g, '').trim();

      const redFlags = detectRedFlags(cleanReply);
      const patientUpdate = extractPatientUpdate(cleanReply, message);
      const redFlagDetected = redFlags.length > 0 || /\bRED FLAG\b|\bEMERGENCY\b|\bURGENT\b/i.test(cleanReply);

      return res.json({ reply: cleanReply, redFlagDetected, redFlags, patientUpdate, fileAnalyzed: hasFile ? fileName : null, suggestPDF });

    } catch (err: any) {
      console.error('[SDA] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PWA "App Store" routes — extracted to src/server/routes/pwa.ts (Phase 1).
  registerPwaRoutes(app, pwaStore);

  // Team collaboration routes — extracted to src/server/routes/team.ts (Phase 1).
  registerTeamRoutes(app);

  // Telemetry / analysis routes — extracted to src/server/routes/telemetry.ts (Phase 1).
  registerTelemetryRoutes(app);

  // Final diagnostic and server start

  try {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (startupError: any) {
    console.error('❌ FATAL: Server failed to start:', startupError);
    process.exit(1);
  }
})();
