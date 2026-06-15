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
  const aiRouter = new UniversalAIRouter();

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

  function generateOfflineResponse(message: string, history: any[] = [], systemInstruction?: string): string {
    const msgLower = message.toLowerCase();
    
    // Clean titles & metadata
    const warningText = `### 📡 navBharatAI — Sovereign Heuristic Engine Active

We detected that your Cloud AI access keys are currently unconfigured, have placeholder values, or are restricted by GCP service policies (such as Firebase Web keys blocking generative content).

To ensure you can continue building **completely uninterrupted**, our local **Sovereign Heuristic Coder & Consultant** is now running. I can generate gorgeous, production-grade responsive templates and design layouts corresponding to your requests in real time!

**To unlock full cloud features:** Open the **Settings Panel** (Gear icon on bottom-left) and paste your active **Gemini, Claude, or OpenAI API key**.

---

`;

    // 1. Identify intent & template matching
    let resolvedProjectName = 'Smart Tool';
    let htmlCode = '';
    
    // Keyword mapping for specific widgets
    if (msgLower.includes('calc') || msgLower.includes('calculator') || msgLower.includes('hisaab') || msgLower.includes('ganit')) {
      resolvedProjectName = 'Glassmorphic Neon Calculator';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Glassmorphic Calculator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background: radial-gradient(circle at top right, #1e1b4b, #09090b);
    }
    .glass {
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
  </style>
</head>
<body class="min-h-screen text-slate-100 flex items-center justify-center p-4">
  <div class="w-full max-w-[360px] p-6 rounded-3xl glass shadow-2xl relative overflow-hidden">
    <!-- Neon Accent Glows -->
    <div class="absolute -top-12 -left-12 w-24 h-24 bg-violet-600/20 blur-2xl rounded-full"></div>
    <div class="absolute -bottom-12 -right-12 w-24 h-24 bg-indigo-600/20 blur-2xl rounded-full"></div>

    <div class="flex items-center justify-between mb-6 shrink-0 relative z-10">
      <div class="flex items-center space-x-2">
        <div class="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse"></div>
        <span class="text-[10px] tracking-widest font-bold uppercase text-violet-400">GANIT v1.0</span>
      </div>
      <span class="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">DEG</span>
    </div>

    <!-- Display -->
    <div class="mb-6 relative z-10 text-right">
      <div id="equation" class="text-xs font-mono text-slate-400 h-5 overflow-x-auto truncate mb-1"></div>
      <div id="output" class="text-4xl font-light font-mono tracking-tight text-white truncate h-12">0</div>
    </div>

    <!-- Keypad -->
    <div class="grid grid-cols-4 gap-3 relative z-10">
      <button onclick="clearAll()" class="col-span-2 py-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium text-sm transition-all border border-rose-500/20 active:scale-95">AC</button>
      <button onclick="backspace()" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-sm transition-all border border-white/5 active:scale-95">DEL</button>
      <button onclick="append('/')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&divide;</button>

      <button onclick="append('7')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">7</button>
      <button onclick="append('8')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">8</button>
      <button onclick="append('9')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">9</button>
      <button onclick="append('*')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&times;</button>

      <button onclick="append('4')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">4</button>
      <button onclick="append('5')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">5</button>
      <button onclick="append('6')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">6</button>
      <button onclick="append('-')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">&minus;</button>

      <button onclick="append('1')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">1</button>
      <button onclick="append('2')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">2</button>
      <button onclick="append('3')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">3</button>
      <button onclick="append('+')" class="py-4 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-bold text-sm transition-all border border-indigo-500/20 active:scale-95">+</button>

      <button onclick="append('0')" class="col-span-2 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">0</button>
      <button onclick="append('.')" class="py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/5 active:scale-95">.</button>
      <button onclick="calculate()" class="py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-md transition-all shadow-lg active:scale-95">=</button>
    </div>
  </div>

  <script>
    let expr = '';
    const equationDiv = document.getElementById('equation');
    const outputDiv = document.getElementById('output');

    function append(val) {
      if (expr === '0' && !isNaN(val)) {
        expr = val;
      } else {
        expr += val;
      }
      updateDisplay();
    }

    function clearAll() {
      expr = '';
      updateDisplay();
    }

    function backspace() {
      expr = expr.slice(0, -1);
      updateDisplay();
    }

    function calculate() {
      if (!expr) return;
      try {
        let sanitized = expr.replace(/[^-()\\d/*+.]/g, '');
        let result = eval(sanitized);
        equationDiv.textContent = expr + ' =';
        expr = String(result);
        if (expr === 'undefined' || expr === 'NaN') {
          expr = 'Error';
        }
        updateDisplay();
      } catch (err) {
        outputDiv.textContent = 'Error';
        expr = '';
      }
    }

    function updateDisplay() {
      outputDiv.textContent = expr || '0';
      if (!expr) {
        equationDiv.textContent = '';
      }
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('todo') || msgLower.includes('task') || msgLower.includes('list') || msgLower.includes('kam') || msgLower.includes('kaam')) {
      resolvedProjectName = 'TaskMaster Personal Board';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TaskMaster Personal Board</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0f19; }
    .neon-border { box-shadow: 0 0 15px rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.2); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-start">
  <div class="w-full max-w-xl bg-[#111827]/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 neon-border shadow-2xl">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">TaskMaster Board</h1>
        <p class="text-xs text-slate-400 mt-1">Organize your daily workflows, goals, and checklists</p>
      </div>
      <div class="bg-indigo-500/10 px-3 py-1.5 rounded-2xl border border-indigo-500/20 text-center">
        <div id="streak-cnt" class="text-sm font-bold text-indigo-400">🔥 0</div>
        <div class="text-[8px] uppercase text-slate-400 font-medium">Daily Streak</div>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="grid grid-cols-3 gap-3 mb-6">
      <div class="bg-slate-800/40 p-3 rounded-2xl border border-white/5 text-center">
        <span class="block text-xs text-slate-400">Total</span>
        <span id="stat-total" class="font-bold text-lg text-white">0</span>
      </div>
      <div class="bg-indigo-500/5 p-3 rounded-2xl border border-indigo-500/10 text-center">
        <span class="block text-xs text-slate-400">Active</span>
        <span id="stat-active" class="font-bold text-lg text-indigo-400">0</span>
      </div>
      <div class="bg-emerald-500/5 p-3 rounded-2xl border border-emerald-500/10 text-center">
        <span class="block text-xs text-slate-400">Completed</span>
        <span id="stat-done" class="font-bold text-lg text-emerald-400">0</span>
      </div>
    </div>

    <!-- Input Area -->
    <form id="todo-form" onsubmit="addTodo(event)" class="flex gap-2 mb-6">
      <input id="todo-input" type="text" placeholder="I want to build a feature today..." required
        class="flex-1 bg-slate-900 border border-slate-700/60 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white placeholder-slate-500">
      <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 transition-colors text-white px-5 rounded-2xl font-medium text-sm flex items-center gap-1 active:scale-95">Add</button>
    </form>

    <!-- Filters -->
    <div class="flex gap-2 mb-6">
      <button onclick="setFilter('all')" id="filter-all" class="px-3 py-1 rounded-full text-xs font-medium transition-all bg-indigo-600 text-white">All</button>
      <button onclick="setFilter('active')" id="filter-active" class="px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white">Active</button>
      <button onclick="setFilter('done')" id="filter-done" class="px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white">Done</button>
    </div>

    <!-- Tasks List -->
    <div id="todo-list" class="space-y-3 max-h-[350px] overflow-y-auto pr-1">
      <!-- Dynamic list loaded via localStorage -->
    </div>
  </div>

  <script>
    let todos = JSON.parse(localStorage.getItem('off_todos') || '[]');
    let currentFilter = 'all';

    function save() {
      localStorage.setItem('off_todos', JSON.stringify(todos));
      render();
    }

    function addTodo(e) {
      e.preventDefault();
      const input = document.getElementById('todo-input');
      const text = input.value.trim();
      if (!text) return;
      
      todos.push({
        id: Date.now(),
        text,
        done: false,
        createdAt: new Date().toISOString()
      });
      input.value = '';
      
      let streak = parseInt(localStorage.getItem('off_streak') || '0');
      if (todos.length === 1) {
        streak += 1;
        localStorage.setItem('off_streak', String(streak));
        document.getElementById('streak-cnt').textContent = '🔥 ' + streak;
      }
      
      save();
    }

    function toggleTodo(id) {
      todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
      save();
    }

    function deleteTodo(id) {
      todos = todos.filter(t => t.id !== id);
      save();
    }

    // Set filter
    function setFilter(filter) {
      currentFilter = filter;
      ['all', 'active', 'done'].forEach(f => {
        const btn = document.getElementById('filter-' + f);
        if (f === filter) {
          btn.className = 'px-3 py-1 rounded-full text-xs font-medium transition-all bg-indigo-600 text-white';
        } else {
          btn.className = 'px-3 py-1 rounded-full text-xs font-medium transition-all text-slate-400 hover:text-white';
        }
      });
      render();
    }

    function render() {
      const container = document.getElementById('todo-list');
      container.innerHTML = '';
      
      let filtered = todos;
      if (currentFilter === 'active') filtered = todos.filter(t => !t.done);
      if (currentFilter === 'done') filtered = todos.filter(t => t.done);

      const total = todos.length;
      const doneValue = todos.filter(t => t.done).length;
      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-active').textContent = total - doneValue;
      document.getElementById('stat-done').textContent = doneValue;

      if (filtered.length === 0) {
        container.innerHTML = \`<div class="text-center py-10 opacity-40 text-xs">No tasks found. Try adding a goal above!</div>\`;
        return;
      }

      filtered.forEach(todo => {
        const div = document.createElement('div');
        div.className = \`flex items-center justify-between p-4 rounded-2xl border transition-all \${todo.done ? 'bg-slate-900/40 border-slate-800 text-slate-400' : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'}\`;
        
        div.innerHTML = \`
          <div class="flex items-center gap-3 flex-1">
            <input type="checkbox" \${todo.done ? 'checked' : ''} onchange="toggleTodo(\${todo.id})"
              class="w-4 h-4 rounded-md bg-transparent border border-slate-600 border-2 checked:bg-indigo-600 text-indigo-600 focus:ring-0 cursor-pointer">
            <span class="text-sm \${todo.done ? 'line-through opacity-70' : 'text-slate-200 font-medium'}" style="word-break: break-all;">\${todo.text}</span>
          </div>
          <button onclick="deleteTodo(\${todo.id})" class="text-slate-500 hover:text-rose-400 transition-colors p-1" title="Delete">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        \`;
        container.appendChild(div);
      });
    }

    const streak = parseInt(localStorage.getItem('off_streak') || '0');
    document.getElementById('streak-cnt').textContent = '🔥 ' + streak;
    render();
  </script>
</body>
</html>`;
    } else if (msgLower.includes('weather') || msgLower.includes('mausam') || msgLower.includes('hawa')) {
      resolvedProjectName = 'Horizon Weather Studio';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Horizon Weather Station</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #0c101d; }
    .station-panel { background: radial-gradient(circle at bottom left, #1c233c, #111528); border: 1px solid rgba(255, 255, 255, 0.05); }
    .neon-pulse { box-shadow: 0 0 25px rgba(56, 189, 248, 0.2); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-center">
  <div class="w-full max-w-md station-panel rounded-3xl p-6 shadow-2xl overflow-hidden relative">
    
    <!-- Header Controls -->
    <div class="flex items-center gap-2 mb-6">
      <input id="city-input" type="text" placeholder="Search City (e.g. Mumbai, New York, Tokyo)" 
        class="flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 transition-all">
      <button onclick="searchCity()" class="bg-sky-500 hover:bg-sky-400 text-slate-900 font-bold px-4 rounded-2xl text-xs py-2.5 transition-all active:scale-95">Go</button>
    </div>

    <!-- Active Weather Display -->
    <div class="text-center py-6 relative">
      <span id="label-city" class="text-xl font-bold tracking-tight">Mumbai</span>
      <span id="label-time" class="block text-[10px] text-slate-400 uppercase tracking-widest mt-1">Local Time: Sunny Outlook</span>
      
      <div class="my-6 flex justify-center">
        <!-- Sun icon with pulse -->
        <div id="icon-weather" class="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center neon-pulse text-amber-400">
          <svg class="w-10 h-10 animate-spin" style="animation-duration: 10s;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" />
          </svg>
        </div>
      </div>

      <div class="flex items-start justify-center">
        <span id="label-temp" class="text-6xl font-light tracking-tighter">32</span>
        <span class="text-sky-400 text-lg font-bold ml-1">&deg;C</span>
      </div>
      <p id="label-desc" class="text-xs text-sky-400 bg-sky-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium">Warm & Sunny</p>
    </div>

    <!-- Details Card Grid -->
    <div class="grid grid-cols-2 gap-3 mt-6">
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Wind Velocity</span>
        <span id="val-wind" class="text-sm font-semibold text-slate-200 mt-1 block">14 km/h</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Relative Humidity</span>
        <span id="val-humidity" class="text-sm font-semibold text-slate-200 mt-1 block">65%</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">Precipitation Chance</span>
        <span id="val-precip" class="text-sm font-semibold text-slate-200 mt-1 block">5%</span>
      </div>
      <div class="bg-slate-900/60 p-3 rounded-2xl border border-white/5">
        <span class="block text-[10px] uppercase font-bold text-slate-500">UV Index Rating</span>
        <span id="val-uv" class="text-sm font-semibold text-slate-200 mt-1 block">9 (High)</span>
      </div>
    </div>
  </div>

  <script>
    const database = {
      mumbai: { temp: "32", desc: "Warm & Sunny", wind: "14 km/h", humidity: "65%", precip: "5%", uv: "9 (High)", bg: "amber" },
      delhi: { temp: "38", desc: "Hot & Smoggy", wind: "8 km/h", humidity: "30%", precip: "0%", uv: "11 (Extreme)", bg: "orange" },
      london: { temp: "14", desc: "Cool & Drizzle", wind: "22 km/h", humidity: "90%", precip: "80%", uv: "2 (Low)", bg: "sky" },
      tokyo: { temp: "22", desc: "Partly Overcast", wind: "12 km/h", humidity: "50%", precip: "15%", uv: "5 (Moderate)", bg: "teal" },
      newyork: { temp: "18", desc: "Crisp Breeze", wind: "19 km/h", humidity: "45%", precip: "10%", uv: "4 (Moderate)", bg: "indigo" },
    };

    function searchCity() {
      const input = document.getElementById('city-input');
      const val = input.value.trim().toLowerCase().replace(/\\s+/g, '');
      if (!val) return;

      const record = database[val] || {
        temp: String(Math.floor(Math.random() * 15) + 18),
        desc: "Mild Clouds",
        wind: "10 km/h",
        humidity: "55%",
        precip: "20%",
        uv: "6 (High)",
        bg: "teal"
      };

      document.getElementById('label-city').textContent = input.value;
      document.getElementById('label-temp').textContent = record.temp;
      document.getElementById('label-desc').textContent = record.desc;
      document.getElementById('val-wind').textContent = record.wind;
      document.getElementById('val-humidity').textContent = record.humidity;
      document.getElementById('val-precip').textContent = record.precip;
      document.getElementById('val-uv').textContent = record.uv;

      const icon = document.getElementById('icon-weather');
      const desc = record.desc.toLowerCase();

      if (desc.includes('sun') || desc.includes('hot')) {
        icon.className = "w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center neon-pulse text-amber-400";
        icon.innerHTML = \`<svg class="w-10 h-10 animate-spin" style="animation-duration: 10s;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-amber-400 bg-amber-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      } else if (desc.includes('cloud') || desc.includes('overcast') || desc.includes('breeze')) {
        icon.className = "w-20 h-20 bg-sky-500/10 rounded-full flex items-center justify-center neon-pulse text-sky-400";
        icon.innerHTML = \`<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-sky-400 bg-sky-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      } else {
        icon.className = "w-20 h-20 bg-teal-500/10 rounded-full flex items-center justify-center neon-pulse text-teal-400";
        icon.innerHTML = \`<svg class="w-10 h-10 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3" /></svg>\`;
        document.getElementById('label-desc').className = "text-xs text-teal-400 bg-teal-500/10 px-3 py-1 mt-3 rounded-full inline-block font-medium";
      }
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('clock') || msgLower.includes('stopwatch') || msgLower.includes('pomodoro') || msgLower.includes('timer') || msgLower.includes('time') || msgLower.includes('ghadi')) {
      resolvedProjectName = 'Swiss-Chronology Focus Hub';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swiss ChronologyFocus Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #07090e; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .swiss-card { background: rgba(13, 17, 24, 0.85); border: 1px solid rgba(255, 255, 255, 0.05); }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8 flex justify-center items-center">
  <div class="w-full max-w-sm swiss-card rounded-3xl p-6 shadow-2xl relative overflow-hidden">
    <!-- Glow -->
    <div class="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 blur-2xl rounded-full"></div>

    <!-- Mode Selector tabs -->
    <div class="flex bg-slate-900 rounded-2xl p-1 mb-8">
      <button onclick="setMode('clock')" id="tab-clock" class="flex-1 py-2 rounded-xl text-xs font-medium bg-rose-600 text-white transition-all">Clock</button>
      <button onclick="setMode('lap')" id="tab-lap" class="flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all">Stopwatch</button>
      <button onclick="setMode('pomo')" id="tab-pomo" class="flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all">Pomodoro</button>
    </div>

    <!-- CLOCK INTERFACE -->
    <div id="p-clock" class="text-center py-6">
      <div id="clock-display" class="text-5xl font-light font-mono text-white tracking-widest my-8">00:00:00</div>
      <p id="clock-date" class="text-[10px] tracking-widest text-slate-500 uppercase h-5 font-bold">THURSDAY, MAY 21</p>
    </div>

    <!-- STOPWATCH INTERFACE -->
    <div id="p-lap" class="hidden text-center py-6">
      <div id="lap-display" class="text-4xl font-light font-mono tracking-widest my-4">00:00.00</div>
      <div class="flex gap-2 justify-center my-4">
        <button onclick="toggleLap()" id="btn-lap-start" class="bg-rose-600 hover:bg-rose-500 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Start</button>
        <button onclick="recordLap()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Lap</button>
        <button onclick="resetLap()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Reset</button>
      </div>
      <div id="lap-records" class="text-left py-2 font-mono text-[10px] text-slate-400 space-y-1 h-20 overflow-y-auto mt-4 px-1">
        <!-- Lap records go here -->
      </div>
    </div>

    <!-- POMODORO INTERFACE -->
    <div id="p-pomo" class="hidden text-center py-6">
      <div id="pomo-display" class="text-5xl font-light font-mono tracking-widest my-4">25:00</div>
      <div class="flex gap-2 justify-center my-4">
        <button onclick="togglePomo()" id="btn-pomo-start" class="bg-rose-600 hover:bg-rose-500 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Start</button>
        <button onclick="resetPomo()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Reset</button>
      </div>
    </div>

  </div>

  <script>
    let activeMode = 'clock';

    setInterval(() => {
      const now = new Date();
      if (activeMode === 'clock') {
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        document.getElementById('clock-display').textContent = \`\${h}:\${m}:\${s}\`;
        
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        document.getElementById('clock-date').textContent = now.toLocaleDateString('en-IN', dateOptions);
      }
    }, 1000);

    function setMode(mode) {
      activeMode = mode;
      ['clock', 'lap', 'pomo'].forEach(m => {
        const pane = document.getElementById('p-' + m);
        const tab = document.getElementById('tab-' + m);
        if (m === mode) {
          pane.classList.remove('hidden');
          tab.className = 'flex-1 py-2 rounded-xl text-xs font-medium bg-rose-600 text-white transition-all';
        } else {
          pane.classList.add('hidden');
          tab.className = 'flex-1 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-all';
        }
      });
    }

    let lapStart = 0;
    let lapInterval = null;
    let lapElapsed = 0;
    let lapCount = 1;

    function toggleLap() {
      const btn = document.getElementById('btn-lap-start');
      if (lapInterval) {
        clearInterval(lapInterval);
        lapInterval = null;
        btn.textContent = 'Start';
      } else {
        lapStart = Date.now() - lapElapsed;
        lapInterval = setInterval(() => {
          lapElapsed = Date.now() - lapStart;
          updateLapDisplay();
        }, 10);
        btn.textContent = 'Pause';
      }
    }

    function updateLapDisplay() {
      const ms = String(Math.floor((lapElapsed % 1000) / 10)).padStart(2, '0');
      const s = String(Math.floor((lapElapsed / 1000) % 60)).padStart(2, '0');
      const m = String(Math.floor(lapElapsed / 60000)).padStart(2, '0');
      document.getElementById('lap-display').textContent = \`\${m}:\${s}.\${ms}\`;
    }

    function recordLap() {
      if (!lapElapsed) return;
      const records = document.getElementById('lap-records');
      const timeStr = document.getElementById('lap-display').textContent;
      const div = document.createElement('div');
      div.className = "flex justify-between border-b border-white/5 pb-1";
      div.innerHTML = \`<span>LAP \${lapCount++}</span><span>\${timeStr}</span>\`;
      records.prepend(div);
    }

    function resetLap() {
      if (lapInterval) toggleLap();
      lapElapsed = 0;
      lapCount = 1;
      updateLapDisplay();
      document.getElementById('lap-records').innerHTML = '';
    }

    let pomoSeconds = 1500;
    let pomoInterval = null;

    function togglePomo() {
      const btn = document.getElementById('btn-pomo-start');
      if (pomoInterval) {
        clearInterval(pomoInterval);
        pomoInterval = null;
        btn.textContent = 'Start';
      } else {
        pomoInterval = setInterval(() => {
          if (pomoSeconds > 0) {
            pomoSeconds--;
            updatePomoDisplay();
          } else {
            clearInterval(pomoInterval);
            pomoInterval = null;
            btn.textContent = 'Start';
            alert('Timer Finished! Take a break.');
          }
        }, 1000);
        btn.textContent = 'Pause';
      }
    }

    function updatePomoDisplay() {
      const m = String(Math.floor(pomoSeconds / 60)).padStart(2, '0');
      const s = String(pomoSeconds % 60).padStart(2, '0');
      document.getElementById('pomo-display').textContent = \`\${m}:\${s}\`;
    }

    function resetPomo() {
      if (pomoInterval) togglePomo();
      pomoSeconds = 1500;
      updatePomoDisplay();
    }
  </script>
</body>
</html>`;
    } else if (msgLower.includes('note') || msgLower.includes('sticky') || msgLower.includes('bento') || msgLower.includes('board') || msgLower.includes('likh')) {
      resolvedProjectName = 'Bento Slate Sticky Notes';
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bento Sticky Notes</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0c0f17; }
    .heading { font-family: 'Outfit', sans-serif; }
  </style>
</head>
<body class="min-h-screen text-slate-100 p-4 md:p-8">
  <div class="w-full max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="heading text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span class="w-3 h-3 bg-amber-400 rounded-full"></span> Bento Notes
        </h1>
        <p class="text-xs text-slate-400 mt-1">Scribble quick thoughts, ideas and items in a neat visual grid</p>
      </div>
      
      <button onclick="createNewNote()" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-2xl text-xs tracking-wide transition-all active:scale-95 flex items-center gap-1">
        + Create Sticky Note
      </button>
    </div>

    <!-- Notes Container Grid -->
    <div id="notes-grid" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      <!-- Notes loaded dynamically -->
    </div>
  </div>

  <script>
    let notes = JSON.parse(localStorage.getItem('off_notes') || JSON.stringify([
      { id: 1, title: "Meeting Quick Notes", content: "Plan standard UI architecture modules for Next.js, make sure to write clean CSS, and check for responsive borders.", color: "amber" },
      { id: 2, title: "Fintech App Architecture", content: "Use PostgreSQL, auth via Firebase, double accounting LEDGER entries, state metrics cached inside Redis.", color: "indigo" },
      { id: 3, title: "Marketing Strategy Guidelines", content: "Draft nice scannable display cards, pair Space Grotesk with Inter fonts, and use absoluteNEGATIVE margins.", color: "rose" }
    ]));

    function save() {
      localStorage.setItem('off_notes', JSON.stringify(notes));
      render();
    }

    function createNewNote() {
      const titles = ["New Idea", "Daily Checklist", "Research Goals", "Quick Tasklist"];
      const colors = ["amber", "indigo", "rose", "emerald", "sky"];
      notes.push({
        id: Date.now(),
        title: titles[Math.floor(Math.random() * titles.length)],
        content: "Click to edit this custom sticky note content...",
        color: colors[Math.floor(Math.random() * colors.length)]
      });
      save();
    }

    function deleteNote(id) {
      notes = notes.filter(n => n.id !== id);
      save();
    }

    function updateNote(id, key, val) {
      notes = notes.map(n => n.id === id ? { ...n, [key]: val } : n);
      localStorage.setItem('off_notes', JSON.stringify(notes));
    }

    function render() {
      const grid = document.getElementById('notes-grid');
      grid.innerHTML = '';

      if (notes.length === 0) {
        grid.innerHTML = \`<div class="col-span-full text-center py-20 opacity-30 text-xs">Empty Workspace. Click '+ Create Sticky Note' above to add!</div>\`;
        return;
      }

      notes.forEach(note => {
        const item = document.createElement('div');
        const colorClasses = {
          amber: "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 focus-within:border-amber-500",
          indigo: "border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 focus-within:border-indigo-500",
          rose: "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 focus-within:border-rose-500",
          emerald: "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 focus-within:border-emerald-500",
          sky: "border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 focus-within:border-sky-500",
        }[note.color] || "border-slate-800 bg-slate-950 hover:bg-slate-900";

        const textHeaderColor = {
          amber: "text-amber-400",
          indigo: "text-indigo-400",
          rose: "text-rose-400",
          emerald: "text-emerald-400",
          sky: "text-sky-400",
        }[note.color] || "text-white";

        item.className = \`p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col \  colorClasses}\`;
        item.style.minHeight = "160px";
        item.innerHTML = \`
          <div class="flex items-center justify-between mb-3">
            <input type="text" value="\${note.title}" oninput="updateNote(\${note.id}, 'title', this.value)"
              class="bg-transparent font-bold tracking-tight text-sm focus:outline-none focus:underline \${textHeaderColor} w-full truncate mr-4">
            <button onclick="deleteNote(\${note.id})" class="text-slate-500 hover:text-red-400 transition-colors p-1" title="DeleteNote">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
          <textarea oninput="updateNote(\${note.id}, 'content', this.value)"
            class="bg-transparent text-xs leading-relaxed text-slate-300 focus:outline-none resize-none flex-1 w-full" placeholder="Type notes content here...">\${note.content}</textarea>
        \`;
        grid.appendChild(item);
      });
    }

    render();
  </script>
</body>
</html>`;
    } else {
      const capitalizedName = message.replace(/[^a-zA-Z0-9\\s]/g, '').trim().split(' ').slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Cloud Portal';
      resolvedProjectName = capitalizedName;
      htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${capitalizedName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; background-color: #080a10; }
    .mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="min-h-screen text-slate-100 flex flex-col">
  <header class="border-b border-slate-800 bg-[#0c0f17]/90 backdrop-blur px-6 py-4 flex items-center justify-between shrink-0 top-0 sticky z-50">
    <div class="flex items-center space-x-2">
      <div class="w-3 h-3 bg-indigo-500 rounded-full animate-pulse"></div>
      <h1 class="font-extrabold tracking-tight text-white text-md">${capitalizedName}</h1>
    </div>
    <div class="flex items-center space-x-3 text-xs">
      <span class="text-slate-400 inline-flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Heuristic Fallback App</span>
    </div>
  </header>

  <main class="flex-1 p-6 md:p-8 max-w-5xl mx-auto w-full space-y-6">
    <div class="p-6 rounded-2xl bg-indigo-950/20 border border-indigo-500/20 shadow-xl flex flex-col md:flex-row items-start gap-4">
      <div class="bg-indigo-600/10 p-3 rounded-2xl text-indigo-400 shrink-0">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
      </div>
      <div>
        <h2 class="font-bold text-sm tracking-tight text-indigo-300">Sovereign Proportional Mode Active</h2>
        <p class="text-xs text-slate-400 leading-relaxed mt-1">If your workspace API endpoints are missing, we dynamically compile high-speed functional interactive prototypes. You can create, edit and query records directly inside the sandbox locally.</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-slate-900/40 border border-slate-800 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Workspace Database</span>
        <span id="badge-records" class="block font-mono text-3xl font-extrabold text-white mt-1">4 Records</span>
        <p class="text-[10px] text-slate-400 mt-2">Active records persisted locally inside client sessionStorage</p>
      </div>
      <div class="bg-indigo-500/5 border border-indigo-500/10 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Request Latency</span>
        <span class="block font-mono text-3xl font-extrabold text-indigo-400 mt-1">0 ms</span>
        <p class="text-[10px] text-slate-400 mt-2">Cached response processed natively on the sovereign container</p>
      </div>
      <div class="bg-emerald-500/5 border border-emerald-500/10 p-5 rounded-2xl">
        <span class="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Engine Efficiency</span>
        <span class="block font-mono text-3xl font-extrabold text-emerald-400 mt-1">100%</span>
        <p class="text-[10px] text-slate-400 mt-2">Safe Sandbox Environment active, avoiding external token expenditure</p>
      </div>
    </div>

    <div class="bg-slate-900/20 border border-slate-800 p-6 rounded-2xl">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 class="font-bold text-sm tracking-tight text-slate-100">Functional Records Console</h3>
          <p class="text-xs text-slate-400 mt-0.5">Persist dynamic items dynamically below</p>
        </div>
        
        <form onsubmit="addRecord(event)" class="flex gap-2 w-full md:w-auto">
          <input id="rec-input" type="text" placeholder="Entry Label..." required
            class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-all text-white max-w-[150px]">
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs tracking-wide transition-all active:scale-95">Add Node</button>
        </form>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs text-slate-300">
          <thead>
            <tr class="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
              <th class="py-3 px-4">Node ID</th>
              <th class="py-3 px-4">Entry Name</th>
              <th class="py-3 px-4">Operational Status</th>
              <th class="py-3 px-4 text-right">Settings</th>
            </tr>
          </thead>
          <tbody id="rec-table-body" class="divide-y divide-slate-800/40">
            <!-- Loaded dynamically -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    let records = JSON.parse(sessionStorage.getItem('off_recs') || JSON.stringify([
      { id: "NODE_1024", name: "${capitalizedName} Starter Frame", status: "Active" },
      { id: "NODE_2048", name: "System Pipeline Hook", status: "Connected" },
      { id: "NODE_4096", name: "Dynamic Token Guard", status: "Neutral" }
    ]));

    function save() {
      sessionStorage.setItem('off_recs', JSON.stringify(records));
      render();
    }

    function addRecord(e) {
      e.preventDefault();
      const input = document.getElementById('rec-input');
      const val = input.value.trim();
      if (!val) return;

      records.push({
        id: "NODE_" + Math.floor(Math.random() * 8999 + 1000),
        name: val,
        status: "Active"
      });
      input.value = '';
      save();
    }

    function deleteRecord(id) {
      records = records.filter(r => r.id !== id);
      save();
    }

    function render() {
      document.getElementById('badge-records').textContent = records.length + " Records";
      const body = document.getElementById('rec-table-body');
      body.innerHTML = '';

      if (records.length === 0) {
        body.innerHTML = \`<tr><td colspan="4" class="py-8 text-center text-slate-500">No active nodes in session ledger. Add some above!</td></tr>\`;
        return;
      }

      records.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/20";
        tr.innerHTML = \`
          <td class="py-3.5 px-4 font-mono text-[10px] text-slate-400">\0r.id}</td>
          <td class="py-3.5 px-4 font-medium text-slate-100">\0r.name}</td>
          <td class="py-3.5 px-4">
            <span class="inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full text-[10px] font-semibold">
              <span class="w-1 h-1 bg-indigo-400 rounded-full"></span> \0r.status}
            </span>
          </td>
          <td class="py-3.5 px-4 text-right">
            <button onclick="deleteRecord('\0r.id}')" class="text-rose-500/80 hover:text-rose-400 font-bold transition-all">Remove</button>
          </td>
        \`;
        body.appendChild(tr);
      });
    }

    render();
  </script>
</body>
</html>`.replace(/\\0r/g, '${r');
    }

    const finalResponse = warningText + `I have generated a fully realized, responsive single-screen application for your request: **` + resolvedProjectName + `**.

Here is the code block that has been successfully deployed to your sandbox:

\`\`\`html
` + htmlCode + `
\`\`\`

You can preview and interact with this template immediately in the **Live Preview Panel**! Let me know if you would like me to modify any visual layout, elements, spacing, or actions.`;

    return finalResponse;
  }

  // Pipeline/Routing logic
  async function routeRequest(message: string, userKeys: any, preferredModel: string = 'gemini', history: any[] = [], systemInstruction?: string): Promise<{ text: string, model: string }> {
    const callMap: Record<string, (msg: string, key?: string, hist?: any[], systemInstr?: string) => Promise<string>> = {
      gemini: (msg, k, h, s) => callGemini(msg, k, h, s || systemInstruction),
      groq: (msg, k, h) => callGroq(msg, k, h),
      deepseek: (msg, k, h) => callDeepSeek(msg, k, h),
      openai: (msg, k, h) => callOpenAI(msg, k, h),
      claude: (msg, k, h, s) => callClaude(msg, k, h, s || systemInstruction),
      openrouter: (msg, k, h) => callOpenRouter(msg, k, h),
    };

    // Determine target model
    let targetModel = preferredModel;
    if (preferredModel === 'auto') {
      if (hasKey('claude', userKeys.claude)) {
        targetModel = 'claude';
      } else if (hasKey('openai', userKeys.openai)) {
        targetModel = 'openai';
      } else if (hasKey('gemini', userKeys.gemini)) {
        targetModel = 'gemini';
      } else if (hasKey('deepseek', userKeys.deepseek)) {
        targetModel = 'deepseek';
      } else if (hasKey('groq', userKeys.groq)) {
        targetModel = 'groq';
      } else if (hasKey('openrouter', userKeys.openrouter)) {
        targetModel = 'openrouter';
      } else {
        targetModel = 'gemini';
      }
    }

    console.log(`[ROUTER] Target model chosen: ${targetModel}. Preferred: ${preferredModel}`);

    // Try target model
    try {
      const userKey = userKeys[targetModel as keyof typeof userKeys];
      const modelFunc = callMap[targetModel];
      if (modelFunc) {
        if (targetModel === 'gemini') {
          const text = await callGemini(message, userKeys.gemini, history, systemInstruction);
          return { text, model: 'gemini' };
        } else {
          if (!hasKey(targetModel, userKey)) {
            throw new Error(`Authentication/API Key missing for ${targetModel}`);
          }
          const text = await modelFunc(message, userKey, history, systemInstruction);
          return { text, model: targetModel };
        }
      }
    } catch (err: any) {
      console.warn(`[ROUTER] Primary model ${targetModel} call failed: ${err.message}. Initializing resilient fallback chain...`);
    }

    // Fallback Candidates
    const fallbackCandidates = ['claude', 'openai', 'gemini', 'deepseek', 'groq', 'openrouter'].filter(m => m !== targetModel);

    for (const model of fallbackCandidates) {
      try {
        const userKey = userKeys[model as keyof typeof userKeys];
        const isKeyPresent = hasKey(model, userKey);
        if (isKeyPresent) {
          console.log(`[ROUTER_FALLBACK] Attempting fallback model: ${model}...`);
          if (model === 'gemini') {
            const text = await callGemini(message, userKeys.gemini, history, systemInstruction);
            return { text, model: 'gemini' };
          } else {
            const text = await callMap[model](message, userKeys[model as keyof typeof userKeys], history, systemInstruction);
            return { text, model };
          }
        }
      } catch (fallbackErr: any) {
        console.warn(`[ROUTER_FALLBACK] Fallback to ${model} also failed: ${fallbackErr.message}`);
      }
    }

    // Tier 3: Sovereign System-Level Ultimate Fallbacks (Ignores bad userKeys and calls with system keys)
    console.log(`[ROUTER_SYSTEM_FALLBACK] Initiating system-level ultimate fallback...`);
    const systemFallbackModels = ['claude', 'gemini', 'openai', 'deepseek', 'groq', 'openrouter'];
    for (const model of systemFallbackModels) {
      try {
        const resolved = resolveApiKey(model, undefined);
        if (resolved.source === 'SYSTEM' && resolved.key) {
          console.log(`[ROUTER_SYSTEM_FALLBACK] Attempting system fallback with model: ${model}...`);
          if (model === 'gemini') {
            const text = await callGemini(message, undefined, history, systemInstruction);
            return { text, model: 'gemini' };
          } else if (model === 'claude') {
            const text = await callClaude(message, undefined, history, systemInstruction);
            return { text, model: 'claude' };
          } else {
            const text = await callMap[model](message, undefined, history, systemInstruction);
            return { text, model };
          }
        }
      } catch (sysErr: any) {
        console.warn(`[ROUTER_SYSTEM_FALLBACK] System fallback for ${model} also failed: ${sysErr.message}`);
      }
    }

    try {
      console.log('[HEURISTIC_SOVEREIGN_ENGINE] All LLM endpoints failed or keys are blocked. Initiating local heuristic recovery compiler...');
      const fallbackText = generateOfflineResponse(message, history, systemInstruction);
      return { text: fallbackText, model: 'local-heuristic' };
    } catch (localErr) {
      console.error('[HEURISTIC_SOVEREIGN_ENGINE] Critical failure executing heuristic backup code:', localErr);
      throw new Error('All primary and fallback AI models failed to respond. Please make sure your API key is correctly saved in settings page.');
    }
  }

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

  app.post('/api/security/scan', async (req, res) => {
    const { target, files } = req.body;
    const userKeys = {
      gemini: req.headers['x-gemini-key'] as string,
    };

    if (!target) return res.status(400).json({ error: 'Target is required' });

    try {
      const prompt = `Perform a deep security scan on the following target: ${target}. 
Current Project Files (if applicable): ${JSON.stringify(files || {})}
Analyze the target for any vulnerabilities, configuration issues, or exposed secrets.`;

      const reply = await callGemini(prompt, userKeys.gemini, [], getSecurityContext(target));
      res.json({ reply });
    } catch (error: any) {
      console.error('Security scan failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // REAL WEBSITE AUDIT ENGINE ENDPOINT
  app.post('/api/audit/full', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
      // const report = await fullWebsiteAudit(url);
      const report = { status: 'audit_not_available' }; // Placeholder
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // New Isolated Chat Endpoints
  const LANGUAGE_RULE = `
LANGUAGE RULE (MANDATORY):
- Detect the language/tone/style the user is writing in
- Reply in EXACTLY the same language, tone, and emotion — Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi, or any other language
- If user writes casually → you write casually; if formally → formally; if with emojis → with emojis
- EXCEPTION: All code (variable names, comments, function names, strings) must ALWAYS be in professional English regardless of conversation language`;

  const SYSTEM_PROMPT_EDIT = `You are NavBharatAI — world's best AI App Editor.
${LANGUAGE_RULE}

CURRENT TASK: Fix/edit/extend the EXISTING app shown in [CANVAS] above.

═══ IRON RULES ═══
1. Read the existing code COMPLETELY — understand every function, ID, and feature
2. Make ONLY the changes the user asked for — nothing more, nothing less
3. PRESERVE every existing feature, style, animation, and working button
4. Return the COMPLETE updated HTML — full file, nothing truncated

BUTTON/NAVIGATION FIX (if user reports broken buttons):
- Find every <button>, <a>, and clickable element
- Ensure each has a working addEventListener or onclick
- Multi-page navigation: use show/hide pattern — document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display='none'); then show target page

OUTPUT FORMAT (MANDATORY):
1-2 lines what changed.
\`\`\`html
[complete updated HTML — every existing line preserved + your changes]
\`\`\``;

  // Dynamic build prompt — injects template hints based on detected app type
  function buildDynamicPrompt(message: string): string {
    const m = message.toLowerCase();
    const isGame      = /\b(game|play|cricket|chess|snake|tetris|puzzle|quiz|arcade|ludo|card game|flappy|pacman|shooter|platformer)\b/.test(m);
    const isCanvasGame = /\b(snake|tetris|pacman|flappy|shooter|arcade|cricket|football|space|asteroid|runner)\b/.test(m);
    const isDashboard = /\b(dashboard|analytics|chart|graph|report|admin|stats|metric|monitor)\b/.test(m);
    const isSocial    = /\b(social|feed|post|like|comment|share|follow|profile|tweet|community)\b/.test(m);

    const cdnTags = [
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">',
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">',
      ...(isDashboard ? ['<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>'] : []),
    ].join('\n  ');

    let templateHint = '';
    if (isCanvasGame) {
      templateHint = `GAME (Canvas) RULES:
• <canvas id="game-canvas"> as main surface + HUD strip + overlay divs for start/pause/gameover
• requestAnimationFrame game loop: function gameLoop(ts) { update(ts); draw(ctx); requestAnimationFrame(gameLoop); }
• Game state machine: const STATE = {IDLE,PLAYING,PAUSED,GAMEOVER}; let state = STATE.IDLE;
• Keyboard: document.addEventListener('keydown', handleKey) — arrow keys / WASD / space
• All game objects: { x, y, w, h, vx, vy } — AABB collision detection`;
    } else if (isGame) {
      templateHint = `GAME (Logic/Board) RULES:
• Board as CSS grid, every cell has data-row + data-col attributes
• Game state object: let gs = { board:[], currentPlayer:1, scores:{}, moveCount:0 }
• Win check after every move, AI opponent for single-player
• Event delegation: board.addEventListener('click', e => e.target.closest('[data-row]'))
• Animate moves: .animate-move class with CSS @keyframes`;
    } else if (isDashboard) {
      templateHint = `DASHBOARD RULES:
• Sidebar nav + main content area with multiple sections
• Chart.js loaded via CDN — use: new Chart(ctx, { type:'bar', data:{...}, options:{ responsive:true, plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{ticks:{color:'#aaa'}},y:{ticks:{color:'#aaa'}}} } })
• Sample data tables, stat cards, filter controls
• Section switching via showSection(id) function`;
    } else if (isSocial) {
      templateHint = `SOCIAL APP RULES:
• Feed with post cards (like/comment/share buttons)
• renderPosts(posts) function — builds cards from data array
• Event delegation on feed container for like/comment
• localStorage to persist posts and user data`;
    } else {
      templateHint = `APP RULES:
• Input validation before processing
• Result display area, copy to clipboard button
• localStorage for persistence
• Step-by-step flow if multi-stage`;
    }

    return `You are NavBharatAI — India's most powerful AI App Builder.
${LANGUAGE_RULE}

Build a COMPLETE, FULLY FUNCTIONAL app — NOT just a home page.

INCLUDE THESE CDN TAGS IN <head> (copy verbatim):
  ${cdnTags}

${templateHint}

═══ UNIVERSAL RULES — ALL MANDATORY ═══

1. EVERY BUTTON MUST WORK:
   Every <button> has addEventListener('click',...) — NO exceptions
   href="#" is BANNED. Every click navigates or triggers real action.

2. MULTI-PAGE NAVIGATION:
   function showPage(id) {
     document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display='none');
     document.getElementById(id).style.display='block';
   }
   Every page is <div id="page-*"> — JS shows/hides them.

3. NO PLACEHOLDERS:
   No TODO, no empty functions, no "coming soon" — 100% complete.

4. TECHNICAL:
   Single HTML file — all CSS and JS inline.
   :root { --bg:#0a0a0f; --accent:#6366f1; --accent-rgb:99,102,241; font-family:'Inter',sans-serif; }
   DOMContentLoaded wraps all JS. Responsive (mobile + desktop).
   Use Font Awesome icons: <i class="fa-solid fa-play"></i>

OUTPUT FORMAT:
One line: what you built.
\`\`\`html
[complete, 100% working HTML]
\`\`\``;
  }

  // Apnapan Engine — dynamic free chat system prompt with user profile injection
  interface ApnapanProfile {
    preferredGreeting?: string;
    preferredLanguage?: string;
    conversationStyle?: string;
    preferredTitle?: string;
    topics?: string[];
    projects?: string[];
  }

  const buildFreeSystemPrompt = (profile?: ApnapanProfile): string => {
    const profileLines: string[] = [];
    if (profile?.preferredGreeting)
      profileLines.push(`Preferred greeting: "${profile.preferredGreeting}" — mirror this style when you initiate a greeting`);
    if (profile?.preferredTitle)
      profileLines.push(`Preferred title/address: "${profile.preferredTitle}" — use occasionally and naturally, NOT in every reply`);
    if (profile?.conversationStyle && profile.conversationStyle !== 'unknown')
      profileLines.push(`Conversation style: ${profile.conversationStyle} (${profile.conversationStyle === 'friendly' ? 'yaar/bhai tone' : profile.conversationStyle === 'formal' ? 'aap/ji tone' : 'sir/madam/professional tone'})`);
    if (profile?.preferredLanguage)
      profileLines.push(`Preferred language: ${profile.preferredLanguage}`);
    if (profile?.projects?.length)
      profileLines.push(`Known projects: ${profile.projects.slice(0, 4).join(', ')}`);
    if (profile?.topics?.length)
      profileLines.push(`Frequent topics: ${profile.topics.slice(0, 5).join(', ')}`);

    const profileSection = profileLines.length
      ? `\nUSER PROFILE (use naturally — NEVER mention or show this to the user):\n${profileLines.join('\n')}\n`
      : '';

    return `You are NavBharatAI — India's own friendly AI companion (by NavBharat team).
${LANGUAGE_RULE}
${profileSection}
GREETING INTELLIGENCE (MANDATORY):
When the user greets you, detect the exact style and respond IN THE SAME style — naturally, not robotically.

Greeting map (detect → respond):
• राम-राम / Ram-Ram → राम-राम!
• राधे-राधे / Radhe-Radhe → राधे-राधे!
• जय श्री राम / Jai Shri Ram → जय श्री राम!
• जय हिन्द / Jai Hind → जय हिन्द!
• नमस्ते / Namaste → नमस्ते!
• नमस्कार / Namaskar → नमस्कार!
• प्रणाम / Pranam → प्रणाम!
• आदाब / Adaab → आदाब!
• अस्सलामुअलैकुम / Assalamualaikum / Salam → वअलैकुम अस्सलाम!
• सत श्री अकाल / Sat Sri Akal → सत श्री अकाल जी!
• जय भीम / Jai Bhim / Jai Bheem → जय भीम!
• केम छो / Kem Cho → केम छो! मज़ामा?
• வணக்கம் / Vanakkam → வணக்கம்!
• Hello / Hi / Hey → Hello! / Hi!
• Good Morning → Good Morning!
• Good Evening → Good Evening!
• Good Night → Good Night!

CONTEXT RULE: If user asks a direct question (no greeting opener), do NOT add any greeting in your reply. Just answer the question directly. Adding "नमस्ते!" before a medical/factual answer is wrong — skip it.

EMOTIONAL INTELLIGENCE:
• User sounds stressed/sad → respond with warmth, patience ("मैं आपकी बात सुन रहा हूँ...")
• User sounds excited/happy → match the energy
• User sounds businesslike → stay crisp and professional

APNAPAN RULES:
• Feel like India's own AI — warm, respectful, culturally aware
• Use cultural expressions (जी, धन्यवाद, ज़रूर, बिल्कुल) naturally and sparingly
• Do NOT mention your memory or profile system — ever
• Do NOT repeat the same opening phrase every reply
• Do NOT be overly dramatic or emotional

HARD LIMITS:
• Do NOT build apps, generate code, or produce HTML/CSS/JS
• If asked to build an app: "App building is available in NavBharatAI Pro — try it out!"
• Answer quality is always the top priority — personalization must never reduce quality
• Safety rule: never infer religion, caste, political views, or social identity from any greeting`;
  };

  const SYSTEM_PROMPT_CHAT = `You are NavBharatAI — India's best AI assistant and app builder (by NavBharat team).
${LANGUAGE_RULE}
Be helpful, concise, and accurate. If the user wants to build an app, guide them.`;

  const chatHandler = async (req: any, res: any, tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip') => {
    let { message, history, currentApp, mode, intent, userProfile, fileAttachments, memorySummary } = req.body;
    if (!message && !Array.isArray(fileAttachments)) return res.status(400).json({ reply: 'Message is required' });
    message = message || '';

    // Process attached files
    // Images + PDFs → Gemini vision (inlineData); text/code files → decode to message text
    type FileAttachment = { name: string; type: string; base64: string };
    const attachments: FileAttachment[] = Array.isArray(fileAttachments) ? fileAttachments : [];
    const visionAttachments = attachments.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    const textAttachments = attachments.filter(f => !f.type.startsWith('image/') && f.type !== 'application/pdf');

    // Append decoded text file content to message
    if (textAttachments.length > 0) {
      const textParts = textAttachments.map(f => {
        const content = Buffer.from(f.base64, 'base64').toString('utf8').slice(0, 8000);
        return `\n\n[Attached file: ${f.name}]\n\`\`\`\n${content}\n\`\`\``;
      });
      message = (message || 'Please review these files:') + textParts.join('');
    }
    // Ensure file-only messages have a prompt
    if (!message && visionAttachments.length > 0) message = visionAttachments[0].type === 'application/pdf' ? 'Please analyze this PDF and extract all relevant information.' : 'Please describe and analyze this image.';

    const isFree = tier === 'navbharat';
    // Free tier: always conversational — ignore canvas and build intent completely
    const hasCanvas = !isFree && !!(currentApp && typeof currentApp === 'string' && currentApp.length > 200);
    const buildIntents = ['create', 'build', 'generate', 'edit', 'fix', 'add', 'modify', 'update', 'change'];
    const isBuildIntent = !isFree && (mode === 'build' || (intent && buildIntents.includes(String(intent).toLowerCase())));

    // Pick system prompt based on tier + context
    let systemPrompt: string;
    if (isFree) {
      systemPrompt = buildFreeSystemPrompt(userProfile || undefined);
    } else if (hasCanvas) {
      systemPrompt = SYSTEM_PROMPT_EDIT;
    } else if (isBuildIntent) {
      systemPrompt = buildDynamicPrompt(message); // Phase 9: template-aware dynamic prompt
    } else {
      systemPrompt = SYSTEM_PROMPT_CHAT;
    }

    // Build contextual message with canvas app prepended (Pro/VIP only)
    let contextualMessage = message;
    if (memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20) {
      contextualMessage = `[CONVERSATION MEMORY — summary of earlier discussion:\n${memorySummary.trim().slice(0, 2000)}]\n\nCurrent message: ${message}`;
    }
    if (hasCanvas) {
      contextualMessage = `[CANVAS — current app on canvas (${currentApp.length} chars total)]:\n\`\`\`html\n${currentApp.slice(0, 20000)}${currentApp.length > 20000 ? '\n...[truncated — send smaller app for full edit]' : ''}\n\`\`\`\n\nUser request: ${memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20 ? `[MEMORY: ${memorySummary.trim().slice(0, 500)}]\n\n` : ''}${message}`;
    }

    console.log(`[CHAT] tier=${tier} isFree=${isFree} mode=${mode} intent=${intent} hasCanvas=${hasCanvas} files=${attachments.length}(vision=${visionAttachments.length}) sysprompt=${isFree ? 'FREE' : hasCanvas ? 'EDIT' : isBuildIntent ? 'BUILD' : 'CHAT'}`);

    // Vision attachments (images + PDFs) — Gemini/Vertex multimodal call
    if (visionAttachments.length > 0) {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      if (geminiKey || projectId) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: geminiKey || 'vertex' });
          const parts: any[] = [{ text: contextualMessage }];
          for (const f of visionAttachments) {
            parts.push({ inlineData: { mimeType: f.type, data: f.base64 } });
          }
          const visionConfig: any = {};
          if (systemPrompt) visionConfig.systemInstruction = systemPrompt;
          // gemini-2.0-flash: fast vision, no thinking delay (2.5-flash can take 5-10 min on images)
          const VISION_MODEL = 'gemini-2.0-flash';
          const visionCfg: any = { ...visionConfig, thinkingConfig: { thinkingBudget: 0 } };
          if (req.body.stream === true) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
            const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
            const visionAc = new AbortController();
            const visionTimeout = setTimeout(() => visionAc.abort(), 28000); // 28s hard cap
            req.on('close', () => visionAc.abort());
            try {
              const stream = await ai.models.generateContentStream({
                model: VISION_MODEL,
                contents: [{ parts }],
                config: Object.keys(visionCfg).length ? visionCfg : undefined,
              });
              for await (const chunk of stream) {
                if (visionAc.signal.aborted) break;
                const text = chunk.text || '';
                if (text && !res.writableEnded) res.write(`data: ${JSON.stringify({ c: text })}\n\n`);
              }
            } finally {
              clearTimeout(visionTimeout);
              clearInterval(heartbeat);
            }
            if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
          } else {
            const visionAc2 = new AbortController();
            const t2 = setTimeout(() => visionAc2.abort(), 28000);
            try {
              const result = await ai.models.generateContent({
                model: VISION_MODEL,
                contents: [{ parts }],
                config: Object.keys(visionCfg).length ? visionCfg : undefined,
              });
              return res.json({ reply: result.text || '' });
            } finally { clearTimeout(t2); }
          }
          return;
        } catch (visionErr: any) {
          console.error('[CHAT/VISION] Gemini vision failed, trying Grok vision:', visionErr.message);
          // Grok fallback for images (Grok doesn't support PDFs)
          const imageOnly = visionAttachments.filter(f => f.type.startsWith('image/'));
          if (imageOnly.length > 0) {
            const grokVisionKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
            if (grokVisionKey) {
              try {
                const grokVision = new OpenAI({ apiKey: grokVisionKey, baseURL: 'https://api.x.ai/v1' });
                const grokContent: any[] = [
                  ...imageOnly.map(f => ({ type: 'image_url', image_url: { url: `data:${f.type};base64,${f.base64}` } })),
                  { type: 'text', text: contextualMessage },
                ];
                const grokMsgsV: any[] = [
                  ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                  { role: 'user', content: grokContent },
                ];
                for (const gm of ['grok-2-vision-1212', 'grok-2-mini-vision-1212']) {
                  try {
                    const r = await grokVision.chat.completions.create({ model: gm, messages: grokMsgsV, max_tokens: 1500 });
                    const gText = r.choices[0]?.message?.content?.trim();
                    if (gText) {
                      if (!res.headersSent && req.body.stream === true) {
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');
                        res.setHeader('X-Accel-Buffering', 'no');
                        res.flushHeaders();
                      }
                      if (req.body.stream === true) {
                        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ c: gText })}\n\n`);
                        if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
                      } else {
                        res.json({ reply: gText });
                      }
                      return;
                    }
                  } catch (ge: any) { console.warn(`[CHAT/VISION] Grok ${gm}: ${ge.message}`); }
                }
              } catch (grokVisionErr: any) { console.warn('[CHAT/VISION] Grok vision failed:', grokVisionErr.message); }
            }
          }
          // All vision providers failed — fall through to text router
        }
      }
    }

    try {
      if (req.body.stream === true) {
        // SSE stream — proper format so proxies/load balancers don't drop idle connections
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders(); // send headers immediately, don't buffer

        const controller = new AbortController();

        // Keepalive ping every 20s — prevents proxy/LB from closing idle connection
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 20000);

        // Cancel upstream AI call when client disconnects (saves quota)
        req.on('close', () => {
          controller.abort();
          clearInterval(heartbeat);
        });

        try {
          await aiRouter.routeStream(
            contextualMessage, history, tier, systemPrompt,
            (chunk: string) => {
              if (!res.writableEnded) {
                // JSON-encode each chunk so newlines/special chars are safe in SSE
                res.write(`data: ${JSON.stringify({ c: chunk })}\n\n`);
              }
            },
            controller.signal,
          );
        } finally {
          clearInterval(heartbeat);
        }
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        const aiResponse = await aiRouter.route(contextualMessage, history, tier, undefined, systemPrompt);
        // Fire-and-forget usage logging
        const userId2 = req.body?.userId || req.body?.uid || 'anonymous';
        addDoc(collection(db, 'ai_usage_logs'), {
          userId: userId2, tier, latencyMs: 0, outputTokens: Math.round((aiResponse.length || 0) / 4),
          modelName: 'auto', providerName: 'auto', estimated_provider_cost: 0,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
        res.json({ reply: aiResponse });
      }
    } catch(e: any) {
      console.error(`Error for tier ${tier}:`, e.message);
      if (!res.headersSent) {
        res.status(500).json({ reply: 'Backend AI inference failed', error: e.message });
      }
    }
  };

  app.post('/api/chat/navbharat',       chatLimiter, (req, res) => chatHandler(req, res, 'navbharat'));
  app.post('/api/chat/navbharatai',     chatLimiter, (req, res) => chatHandler(req, res, 'navbharat'));
  app.post('/api/chat/vishwakarma-basic', chatLimiter, (req, res) => chatHandler(req, res, 'vishwakarma-basic'));
  app.post('/api/chat/vishwakarma-pro', chatLimiter, (req, res) => chatHandler(req, res, 'vishwakarma-pro'));
  app.post('/api/chat/vip',             chatLimiter, (req, res) => chatHandler(req, res, 'vip'));

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
