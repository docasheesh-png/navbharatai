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
import { registerProRoutes } from './src/server/routes/pro';
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

  // Pro engine routes (pro-chat + pro-build + callClaudePro) — extracted to src/server/routes/pro.ts (Phase 1, AI-core step d).
  registerProRoutes(app);
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
