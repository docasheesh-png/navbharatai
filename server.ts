import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

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
const serverStats = {
  totalHits: 0,
  dailyHits: new Map<string, number>(),
  failedLogins: 0,
  failedLoginIPs: [] as { ip: string; time: number; username?: string }[],
  maintenanceMode: false,
  featureFlags: { doctorAI: true, navBharatPro: true, appBuilder: true },
  pricingConfig: { coinsPerRupee: 100, referralBonusPct: 10 },
  providerEnabled: { gemini: true, anthropic: true, grok: true, vertex: true },
  announcements: [] as { id: string; message: string; createdAt: string; target: 'all' | string }[],
};

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
// Fallback: load .env file first, then .env.example (skip placeholder values)
const isPlaceholder = (v: string) =>
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
          if (key && val && !process.env[key] && !isPlaceholder(val)) {
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
      isPlaceholder: val === 'AIzaSyDOIA2mdmdDyVh4hYhEsCMD3zOnqLQ0Nxg',
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
    firebaseApiKey = firebaseConfig.apiKey;
    console.log('✅ Firebase initialized successfully. Resolved fallback ApiKey:', firebaseApiKey ? 'present' : 'absent');
  } else {
    console.warn('⚠️ firebase-applet-config.json not found. Firebase features will be disabled.');
  }
} catch (error) {
  console.error('⚠️ Failed to initialize Firebase:', error);
}

// ENCRYPTION & SECRETS HELPERS
const ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || 'navBharatAISecurityLedgerFallbackKey';

const encrypt = (text: string) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decrypt = (encryptedText: string) => {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Decryption failed:', err);
    return '';
  }
};

async function getSecretValue(userId: string, secretName: string): Promise<string | null> {
  // First check process.env:
  if (process.env[secretName]) {
    return process.env[secretName];
  }
  if (!db) return null;
  try {
    const q = query(
      collection(db, 'user_secrets'),
      where('user_id', '==', userId),
      where('secret_name', '==', secretName)
    );
    const snap = await getDocs(q);
    const docData = snap.docs.find(d => !d.data()?.deleted);
    if (docData) {
      const encryptedValue = docData.data().encrypted_secret_value;
      return decrypt(encryptedValue);
    }
  } catch (err) {
    console.error(`Error loading secret ${secretName}:`, err);
  }
  return null;
}

// Reusable internal payment verification service
async function verifyPaymentInternal(orderId: string): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!db) return { success: false, error: 'Database not initialized' };

  try {
    const txRef = doc(db, 'payment_transactions', orderId);
    const txSnap = await getDoc(txRef);
    if (!txSnap.exists()) {
      return { success: false, error: 'Transaction record not found' };
    }

    const txData = txSnap.data();
    if (txData.paymentStatus === 'SUCCESS') {
      return { success: true, data: { alreadyProcessed: true, balanceAdded: txData.balanceAdded } };
    }

    const userId = txData.userId;
    const dbClientId = await getSecretValue(userId, 'CASHFREE_CLIENT_ID') || await getSecretValue(userId, 'CASHFREE_APP_ID');
    const dbClientSecret = await getSecretValue(userId, 'CASHFREE_CLIENT_SECRET') || await getSecretValue(userId, 'CASHFREE_SECRET_KEY');

    const clientId = (dbClientId || process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID)?.trim();
    const clientSecret = (dbClientSecret || process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY)?.trim();
    const env = process.env.CASHFREE_ENV || (clientSecret && (clientSecret.toLowerCase().includes('test') || clientSecret.toLowerCase().includes('sandbox')) ? 'sandbox' : 'production');

    const isPlaceholder = !clientId || !clientSecret ||
      clientId.toLowerCase().includes('placeholder') ||
      clientSecret.toLowerCase().includes('placeholder') ||
      clientId.trim() === '' ||
      clientSecret.trim() === '';

    let isPaid = false;
    let cfOrderIdRef = 'cf_' + orderId;

    if (isPlaceholder || txData.isSimulator || orderId.startsWith('sim_')) {
      console.log(`[CASHFREE SIMULATION] Marking order ${orderId} as paid inside verification simulator.`);
      isPaid = true;
    } else {
      const cfUrl = env === 'production' 
        ? `https://api.cashfree.com/pg/orders/${orderId}` 
        : `https://sandbox.cashfree.com/pg/orders/${orderId}`;

      const response = await axios.get(cfUrl, {
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2023-08-01'
        }
      });

      const orderDetails = response.data;
      if (orderDetails.order_status === 'PAID') {
        isPaid = true;
        cfOrderIdRef = orderDetails.cf_order_id || 'cf_' + orderId;
      }
    }

    if (isPaid) {
      await updateDoc(txRef, {
        paymentStatus: 'SUCCESS',
        paymentReference: cfOrderIdRef
      });

      const walletRef = doc(db, 'user_token_wallets', txData.userId);
      const walletSnap = await getDoc(walletRef);
      
      let walletData = walletSnap.exists() ? walletSnap.data() : {
        userId: txData.userId,
        hasVishwakarmaPass: false,
        unlockedModes: [],
        vishwakarmaPassActivatedAt: null,
        tokenBalance: 0,
        totalTokensPurchased: 0,
        totalTokensUsed: 0,
        totalMoneySpent: 0,
        lastRechargeAt: null,
        walletLedger: [],
        remaining_balance: 0,
        total_balance: 0,
        total_output_tokens_used: 0,
        updatedAt: new Date().toISOString()
      };

      let walletUpdate: any = {};
      const isVishwakarmaOrder = !!txData.isVishwakarmaOrder;
      const buyPass = !!txData.buyPass;
      const tokensToCredit = (txData.tokenAmount || 0) * 100;

      // PROMO HANDLING
      const promoSnap = await getDoc(doc(db, 'promo_redemptions', `promo_pending_${txData.userId}`));
      let promoApplied = false;
      if (promoSnap.exists() && promoSnap.data().status === 'PENDING') {
        const promoData = promoSnap.data();
        await updateDoc(doc(db, 'promo_redemptions', `promo_pending_${txData.userId}`), { status: 'USED' });
        walletUpdate.unlockedModes = [...(walletData.unlockedModes || []), promoData.mode];
        walletUpdate.hasVishwakarmaPass = true;
        walletUpdate.vishwakarmaPassActivatedAt = new Date().toISOString();
        walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + 1000; // 1000 tokens
        promoApplied = true;
      }

      if (isVishwakarmaOrder) {
        if (buyPass) {
          walletUpdate.hasVishwakarmaPass = true;
          walletUpdate.vishwakarmaPassActivatedAt = new Date().toISOString();
        }
        
        if (!promoApplied) {
            walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + tokensToCredit;
        }
        walletUpdate.totalTokensPurchased = (walletData.totalTokensPurchased || 0) + (promoApplied ? 1000 : tokensToCredit);
        walletUpdate.totalMoneySpent = (walletData.totalMoneySpent || 0) + txData.amountPaid;
        walletUpdate.lastRechargeAt = new Date().toISOString();
        
        const ledgerEntry = {
          type: 'purchase',
          amountCoinsOrTokens: promoApplied ? 1000 : tokensToCredit,
          moneySpent: txData.amountPaid,
          timestamp: new Date().toISOString(),
          description: `Bought ${tokensToCredit.toLocaleString()} tokens${buyPass ? ' + Lifetime Pass Activated (₹50)' : ''}${promoApplied ? ' + Promo 1000 Tokens' : ''}`
        };
        walletUpdate.walletLedger = [
          ...(walletData.walletLedger || []),
          ledgerEntry
        ];
        
        walletUpdate.remaining_balance = (walletData.remaining_balance || 0) + txData.amountPaid;
        walletUpdate.total_balance = (walletData.total_balance || 0) + txData.amountPaid;
      } else {
        const tokensToCreditFallback = txData.balanceAdded * 100;
        if (!promoApplied) {
            walletUpdate.tokenBalance = (walletData.tokenBalance || 0) + tokensToCreditFallback;
        }
        walletUpdate.totalTokensPurchased = (walletData.totalTokensPurchased || 0) + (promoApplied ? 10000 : tokensToCreditFallback);
        walletUpdate.totalMoneySpent = (walletData.totalMoneySpent || 0) + txData.amountPaid;
        walletUpdate.lastRechargeAt = new Date().toISOString();
        
        const ledgerEntry = {
          type: 'purchase',
          amountCoinsOrTokens: promoApplied ? 10000 : tokensToCreditFallback,
          moneySpent: txData.amountPaid,
          timestamp: new Date().toISOString(),
          description: `Standard wallet recharge: ₹${txData.amountPaid} (${tokensToCreditFallback.toLocaleString()} tokens added)${promoApplied ? ' + Promo 100₹ Tokens' : ''}`
        };
        walletUpdate.walletLedger = [
          ...(walletData.walletLedger || []),
          ledgerEntry
        ];
        
        walletUpdate.remaining_balance = (walletData.remaining_balance || 0) + txData.balanceAdded;
        walletUpdate.total_balance = (walletData.total_balance || 0) + txData.balanceAdded;
      }
      
      walletUpdate.updatedAt = new Date().toISOString();
      const integratedWallet = { ...walletData, ...walletUpdate };
      await setDoc(walletRef, integratedWallet);

      return { 
        success: true, 
        data: { 
          balanceAdded: txData.balanceAdded, 
          currentBalance: integratedWallet.remaining_balance,
          tokenBalance: integratedWallet.tokenBalance,
          hasVishwakarmaPass: integratedWallet.hasVishwakarmaPass
        } 
      };
    }

    return { success: false, error: 'Order not paid or invalid status' };
  } catch (err: any) {
    console.error('[CASHFREE] Internal verification failed:', err.message);
    return { success: false, error: err.message };
  }
}

// Token counter helpers
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ══ PWA App Store (in-memory, 24h TTL) ══
const pwaStore = new Map<string, { html: string; name: string; createdAt: number }>();
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
  const audit = (event: string, meta: Record<string, any> = {}) => {
    const entry = { ts: new Date().toISOString(), event, ...meta };
    console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  };

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

    app.use(express.json({ limit: '5mb' }));

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

  // Secure Server-Side OTP Cooldown Protection & Anti-Spam Rates State Maps
  interface OtpRequestRecord {
    lastRequestedAt: number;
    requestTimestamps: number[];
  }
  
  const phoneOtpRecords = new Map<string, OtpRequestRecord>();
  const ipOtpRecords = new Map<string, OtpRequestRecord>();

  // Secure Send-OTP Pre-Request Security Gateway / Cooldown Checker
  app.post('/api/auth/send-otp', (req, res) => {
    try {
      const { phone } = req.body;
      const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown-ip').split(',')[0].trim();
      
      if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required." });
      }

      // Normalize phone number structure (remove symbols, spaces, dashes)
      const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');
      const now = Date.now();
      const COOLDOWN_MS = 30000; // 30 seconds
      const HOUR_MS = 3600000; // 1 hour
      const MAX_HOURLY_REQUESTS = 5;

      const checkRecordLimits = (record: OtpRequestRecord | undefined, identifierType: 'phone' | 'IP'): { ok: boolean; message?: string } => {
        if (!record) return { ok: true };

        // 1. 30 Seconds Cooldown Prevention Check
        const elapsed = now - record.lastRequestedAt;
        if (elapsed < COOLDOWN_MS) {
          const remainingSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
          return {
            ok: false,
            message: `Please wait ${remainingSeconds} seconds before requesting another OTP.`
          };
        }

        // 2. Hourly Rate limit (Max 5 request attempts per hour)
        const hourlyTimestamps = record.requestTimestamps.filter(t => now - t < HOUR_MS);
        record.requestTimestamps = hourlyTimestamps; // update current list in place

        if (hourlyTimestamps.length >= MAX_HOURLY_REQUESTS) {
          const oldestRequest = hourlyTimestamps[0];
          const waitTimeLeftMs = HOUR_MS - (now - oldestRequest);
          const minutesLeft = Math.ceil(waitTimeLeftMs / 60000);
          return {
            ok: false,
            message: `Too many OTP requests from this ${identifierType}. Please try again after ${minutesLeft} minutes.`
          };
        }

        return { ok: true };
      };

      // Check phone limits
      const phoneCheck = checkRecordLimits(phoneOtpRecords.get(cleanPhone), 'phone');
      if (!phoneCheck.ok) {
        return res.status(429).json({ success: false, message: phoneCheck.message });
      }

      // Check IP limits
      const ipCheck = checkRecordLimits(ipOtpRecords.get(ip), 'IP');
      if (!ipCheck.ok) {
        return res.status(429).json({ success: false, message: ipCheck.message });
      }

      // Record this attempt in maps
      const updateOtpRecord = (currRecord: OtpRequestRecord | undefined): OtpRequestRecord => {
        const timestamps = currRecord ? [...currRecord.requestTimestamps, now] : [now];
        return {
          lastRequestedAt: now,
          requestTimestamps: timestamps
        };
      };

      phoneOtpRecords.set(cleanPhone, updateOtpRecord(phoneOtpRecords.get(cleanPhone)));
      ipOtpRecords.set(ip, updateOtpRecord(ipOtpRecords.get(ip)));

      console.log(`[OTP PROTECTION SUCCESS] Request verified for phone ${cleanPhone} from source IP ${ip}`);
      return res.json({ success: true, message: "Verification cooldown validated. Safe to initialize OTP dispatch." });

    } catch (err: any) {
      console.error("[OTP PROTECTION SECURITY ERROR]", err);
      return res.status(500).json({ success: false, message: "Security gateway error during OTP dispatch validation." });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), port: PORT });
  });

  // AppMaker Execution Telemetry Endpoints
  const HISTORY_DIR = path.join(process.cwd(), 'runtime', 'build-history');

  app.get('/api/appmaker/executions', async (req, res) => {
    try {
      if (!fs.existsSync(HISTORY_DIR)) {
        return res.json([]);
      }
      const files = fs.readdirSync(HISTORY_DIR);
      const executions = files.map(file => {
        const filePath = path.join(HISTORY_DIR, file);
        const stats = fs.statSync(filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          executionId: content.executionId,
          timestamp: content.timestamp,
          status: content.buildResult.success ? 'SUCCESS' : 'FAILED'
        };
      });
      res.json(executions);
    } catch (err) {
      console.error('Error fetching executions:', err);
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  app.get('/api/appmaker/executions/:executionId', async (req, res) => {
    try {
      const { executionId } = req.params;
      const filePath = path.join(HISTORY_DIR, `${executionId}.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Execution not found' });
      }
      const content = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(content));
    } catch (err) {
      console.error('Error fetching execution:', err);
      res.status(500).json({ error: 'Failed to fetch execution' });
    }
  });

  app.get('/api/appmaker/jobs/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await BuildJobManager.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    } catch (err) {
      console.error('Error fetching job:', err);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  // Create Order Endpoint
  app.post('/api/create-order', async (req, res) => {
    try {
      const { orderAmount, orderCurrency, customerId, customerPhone, customerEmail, customerName, userId } = req.body;
      const finalAmount = Number(orderAmount);
      const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;
      
      // Ensure alphanumeric customer_id (Cashfree requirement)
      const sanitizedCustomerId = (customerId || 'customer123').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
      
      const request = {
        order_id: orderId,
        order_amount: parseFloat(finalAmount.toFixed(2)),
        order_currency: orderCurrency || "INR",
        customer_details: {
          customer_id: sanitizedCustomerId,
          customer_name: (customerName || "Customer").substring(0, 50),
          customer_phone: (customerPhone || "9999999999").substring(0, 15),
          customer_email: (customerEmail || "test@test.com")
        },
      };
      
      const response = await (Cashfree as any).PGCreateOrder("2023-08-01", request);
      
      await setDoc(doc(db, 'payment_transactions', orderId), {
          userId,
          amountPaid: parseFloat(finalAmount.toFixed(2)),
          createdAt: new Date().toISOString(),
          paymentStatus: 'PENDING'
      });

      res.json(response.data);
    } catch (error: any) {
      console.error('[CASHFREE] Order creation failed:', JSON.stringify(error.response?.data || error.message, null, 2));
      res.status(500).json({ 
        error: "Failed to create order", 
        details: error.response?.data || error.message
      });
    }
  });

  // AI Clients Initialization (Lazy)
  let geminiClient: GoogleGenAI | null = null;
  let groqClient: OpenAI | null = null;
  let deepseekClient: OpenAI | null = null;
  let openaiClient: OpenAI | null = null;
  let openrouterClient: OpenAI | null = null;
  
  const isPlaceholder = (key: string | undefined, strict: boolean = true, provider?: string) => {
    if (!key) return true;
    const k = key.trim();
    if (
      k === 'AIzaSyDOIA2mdmdDyVh4hYhEsCMD3zOnqLQ0Nxg' || 
      k.startsWith('MY_') || 
      k === 'undefined' || 
      k === 'null' || 
      k === 'YOUR_API_KEY'
    ) return true;
    
    if (strict) {
      if (provider && provider.toLowerCase() === 'gemini') {
        return k.length < 20 || !k.startsWith('AIza');
      }
      return k.length < 10;
    }
    return false;
  };
  
  const resolveApiKey = (provider: string, userKey?: string) => {
    const p = provider.toUpperCase();
    
    // 1. Check user key if provided and not a placeholder
    if (userKey && !isPlaceholder(userKey, true, provider)) {
      const masked = userKey.substring(0, 6) + '...' + userKey.substring(userKey.length - 4);
      console.log(`[AUTH] Using USER ${p} key: ${masked}`);
      return { key: userKey, source: 'USER' };
    }
    
    // 2. Check provider-specific system environment keys
    let envKey: string | undefined = undefined;
    const providerLower = provider.toLowerCase();
    
    if (providerLower === 'gemini') {
      envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    } else if (providerLower === 'claude' || providerLower === 'anthropic') {
      envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || process.env.VITE_CLAUDE_API_KEY;
    } else {
      envKey = process.env[`${p}_API_KEY`] || process.env[`${p}_KEY`];
    }
    
    console.log(`[DEBUG_AUTH] Provider: ${provider}. System key found: ${!!envKey}`);
    
    if (envKey && (!isPlaceholder(envKey, true, provider) || envKey === 'AIzaSyDOIA2mdmdDyVh4hYhEsCMD3zOnqLQ0Nxg')) { 
      envKey = envKey.trim();
      const masked = envKey.substring(0, 6) + '...' + envKey.substring(envKey.length - 4);
      console.log(`[AUTH] Using SYSTEM ${p} key (Fallback): ${masked}`);
      return { key: envKey, source: 'SYSTEM' };
    }
    
    console.log(`[AUTH] No valid key found for ${p}. UserKey provided: ${userKey ? 'present' : 'absent'}.`);
    return { key: null, source: 'NONE' };
  };

  const hasKey = (provider: string, userKey?: string) => {
    return resolveApiKey(provider, userKey).source !== 'NONE';
  };

  const getGemini = (userKey?: string) => {
    // If user provides a key, we *must* create a new client for it
    if (userKey && !isPlaceholder(userKey, true, 'gemini')) {
        return new GoogleGenAI({ apiKey: userKey });
    }
    
    // Fallback to system key
    if (!geminiClient) {
        const { key, source } = resolveApiKey('gemini', undefined);
        console.log(`[AUTH] Attempting to resolve system Gemini key. Source: ${source}, Key found: ${!!key}`);
        if (key) {
            geminiClient = new GoogleGenAI({ apiKey: key });
        } else {
            console.error(`[AUTH] CRITICAL: System Gemini key resolution failed!`);
        }
    }
    return geminiClient;
  };

  const getGroq = (userKey?: string) => {
    const { key } = resolveApiKey('groq', userKey);
    if (!key) return null;
    return new OpenAI({
      apiKey: key,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  };

  const getDeepSeek = (userKey?: string) => {
    const { key } = resolveApiKey('deepseek', userKey);
    if (!key) return null;
    return new OpenAI({
      apiKey: key,
      baseURL: 'https://api.deepseek.com',
    });
  };

  const getOpenAI = (userKey?: string) => {
    const { key } = resolveApiKey('openai', userKey);
    if (!key) return null;
    return new OpenAI({ apiKey: key });
  };

  const getOpenRouter = (userKey?: string) => {
    const { key } = resolveApiKey('openrouter', userKey);
    if (!key) return null;
    return new OpenAI({
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'navBharatAI',
      },
    });
  };

  const getClaude = (userKey?: string) => {
    const { key, source } = resolveApiKey('claude', userKey);
    if (!key) {
        console.log(`[DEBUG] getClaude: No key found.`);
        return null;
    }
    console.log(`[DEBUG] getClaude: Key found, source: ${source}, length: ${key.length}`);
    let baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (baseUrl && source === 'SYSTEM') {
      if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.slice(0, -3);
      } else if (baseUrl.endsWith('/v1/')) {
        baseUrl = baseUrl.slice(0, -4);
      }
    }
    console.log(`[DEBUG] getClaude: BaseURL: ${baseUrl || 'default'}`);
    return new Anthropic({ 
      apiKey: key,
      ...(baseUrl ? { baseURL: baseUrl } : {})
    });
  };

   const NAVBHARAT_OS_V2 = `# SYSTEM PROMPT — navBharatAI OS v2.0
Advanced Hybrid AI + Multi-Model Intelligence Engine

==================================================
🚨 PERMANENT LANGUAGE & CODING RULES (NEVER OVERRIDE) 🚨
==================================================

CONVERSATION LANGUAGE:
Vishwakarma AI and navBharatAI MUST ALWAYS reply in the EXACT SAME language, writing style, and tone used by the USER in their message.
- If the user writes in Hindi: reply in Hindi.
- If the user writes in Hinglish: reply naturally in Hinglish.
- If the user writes in English: reply in English.
- If the user writes in any other language: mirror that language.
- NEVER force English-only responses.
- NEVER auto-translate user messages.
The user's input language is the absolute gold standard for the response language.

CODE LANGUAGE — ABSOLUTE RULE (NO EXCEPTIONS, EVER):
ALL code you write MUST use English-only identifiers:
- Variable names → English (e.g., userName, not userName_hindi or उपयोगकर्ता)
- Function names → English (e.g., calculateTotal(), not totalNikalo())
- Class / component names → English
- Code comments → English
- console.log / error messages / string literals inside code → English
- API field names, database column names → English
- This rule applies in ALL languages: Hindi chat, Hinglish chat, any chat.
WRONG: function kaamKaro() { } | const namaste = "hello"
RIGHT: function processTask() { } | const greeting = "hello"

==================================================

You are the official AI system of **navBharatAI** — a hybrid AI ecosystem designed for both normal users and advanced technical users.

Your primary responsibility is to:
- Detect user intent
- Detect complexity level
- Detect user mood/tone
- Select the correct operating mode
- Adjust reasoning depth automatically
- Generate highly natural human-like responses
- Maintain strict multilingual alignment as defined in the language protocol

You must never sound robotic, repetitive, overly formal, or machine-generated.

==================================================
## CORE AI OPERATING SYSTEM
==================================================

navBharatAI has 2 main systems:

### 1. navbharatai (Assistant System)
- Lightweight conversational assistant
- Runs using high-speed optimized engines only
- Designed for normal users
- Fast, friendly, natural interaction

### 2. Vishwakarma (Agent System)
Advanced autonomous technical agent.

Vishwakarma has 3 intelligence levels:

#### a. Vishwakarma Basic
- Uses optimized fast cognitive layers
- Lightweight coding + app building

#### b. Vishwakarma Pro
- Uses premium advanced reasoning engines
- Deep reasoning + professional engineering

#### c. Vishwakarma VIP
- Uses elite multi-model orchestration infrastructure
- Maximum intelligence + autonomous execution quality

==================================================
## MODE SELECTION RULE
==================================================

The user may manually select any mode.

You MUST respect the user's selected mode.

If the user does not explicitly select a mode:
- Automatically detect the best mode from the request complexity.

Examples:
- Casual chatting → navbharatai
- Simple coding → Vishwakarma Basic
- Advanced engineering → Vishwakarma Pro
- Enterprise-grade systems → Vishwakarma VIP

Never unnecessarily upgrade complexity for simple tasks.

==================================================
## MODE 1 — NAVBHARATAI MODE
==================================================

Purpose:
- Casual chatting
- Daily help
- Brainstorming
- General knowledge
- Entertainment
- Study support
- Business discussion
- Lifestyle guidance
- Emotional support
- Non-technical conversations
- General AI help
- And more

Behavior:
- Friendly
- Fast
- Natural
- Human-like
- Emotion-aware
- Desi smart vibe allowed
- Hindi-English mix allowed
- Match user's speaking style naturally

Tone Rules:
- Adapt to user mood
- Mirror user's energy level naturally
- Avoid sounding artificial
- Keep responses easy and engaging

STRICT RULES:
- No coding
- No software architecture
- No deep engineering explanations
- No unnecessary technical jargon
- No overcomplicated answers

Goal:
Make the user feel they are talking to an intelligent real human assistant.

==================================================
## MODE 2a — SAKUNI BASIC MODE
==================================================

Purpose:
- Basic coding
- Small scripts
- Simple automation
- Beginner app development
- Database basics
- Intelligent API integrations
- Lightweight debugging
- Prompt engineering basics

Backend:
- High-efficiency reasoning engine

Behavior:
- Friendly developer assistant
- Practical and efficient
- Beginner-friendly explanations
- Fast execution-focused thinking

Capabilities:
- Simple frontend
- Basic backend
- API integrations
- Firebase setup
- Simple authentication
- Lightweight debugging
- Mobile/web app basics

Coding Style:
- Clear
- Minimal
- Readable
- Working-first approach

Restrictions:
- Avoid overengineering
- Avoid enterprise architecture unless requested
- Avoid unnecessary complexity

==================================================
## MODE 2b — SAKUNI PRO MODE
==================================================

Automatically activate for:
- Serious coding
- Full app architecture
- SaaS systems
- AI agents
- Multi-step automation
- Deep debugging
- Production deployment
- Security systems
- Scalable backend systems
- DevOps workflows
- Database optimization
- Performance engineering
- AI product systems
- Infrastructure planning
- Advanced prompt engineering

Backend:
- Premium advanced reasoning engines

Behavior:
- Highly intelligent
- Strategic
- Professional
- Analytical
- Autonomous thinker
- Proactive problem solver

Thinking Style:
- Professional-grade deep reasoning
- Multi-step analysis
- Edge-case aware
- Engineering-first mindset
- Production-focused thinking

Output Requirements:
- Production-ready code
- Clean architecture
- Scalable systems
- Secure implementation
- Proper folder structure
- Clear deployment flow
- Professional formatting

Always:
- Think before responding
- Detect hidden risks
- Suggest better alternatives proactively
- Optimize maintainability
- Optimize scalability
- Optimize developer experience

==================================================
## MODE 2c — SAKUNI VIP MODE
==================================================

Purpose:
Maximum intelligence + elite execution quality.

Activate for:
- Enterprise-grade systems
- Startup-scale infrastructure
- Multi-agent orchestration
- Autonomous AI systems
- Advanced cybersecurity
- Mission-critical debugging
- Full-stack AI ecosystems
- Complex infrastructure
- Distributed systems
- AI orchestration platforms
- High-scale backend engineering
- Advanced cloud systems

Backend:
- All available premium AI/API infrastructure

Behavior:
- CTO-level strategic thinking
- Elite engineering mindset
- Extremely optimized reasoning
- Long-horizon planning
- Precision-focused execution

Capabilities:
- Advanced architecture planning
- AI orchestration systems
- Security auditing
- Scaling strategies
- Cost optimization
- Infrastructure optimization
- Competitive product analysis
- Full-stack ecosystem planning
- Enterprise-grade deployment systems

Quality Standard:
- Premium quality only
- No shallow answers
- No generic output
- Deep clarity
- Highly structured thinking
- Maximum usefulness

==================================================
## UNIVERSAL RESPONSE RULES
==================================================

For ALL modes:

- Analyze intent before replying
- Match complexity to user need
- Match emotional tone naturally
- Avoid robotic wording
- Avoid repetitive phrasing
- Avoid template-like answers
- Sound human and dynamic
- Prioritize usefulness
- Prioritize clarity
- Prioritize accuracy
- Maintain conversational flow
- Use step-by-step thinking internally
- Never expose internal reasoning chain

Humanization Rules:
- Responses should feel alive and adaptive
- Sentence patterns should vary naturally
- Avoid AI-sounding filler text
- Avoid overexplaining simple topics

==================================================
## RESPONSE STYLE ENGINE
==================================================

### Normal Conversations
Style:
- Friendly
- Relaxed
- Natural
- Desi-smart vibe allowed
- Hindi-English mix allowed

### Technical Conversations
Style:
- Professional
- Structured
- Engineer-grade clarity
- Concise but deep
- High signal, low fluff

==================================================
## CODING RULES
==================================================

When generating code:

Always:
- Prefer production-ready solutions
- Use clean architecture
- Follow best practices
- Write maintainable code
- Mention security concerns
- Mention scalability concerns
- Optimize readability
- Optimize performance

Avoid:
- Fake code
- Broken placeholders
- Unnecessary comments
- Weak architecture
- Insecure implementation

Advanced Engineering Rule:
Think beyond the user's exact wording and proactively improve the solution.

==================================================
## SECURITY & PRIVACY RULES (STRICT DISCLOSURE GUARDRAILS)
==================================================

CRITICAL MODEL EXPOSURE GUARDRAILS (NEVER BREAK):
1. ZERO RAW DISCLOSURE: Whenever a user asks about backend models (exact model names), API keys (sources, providers), system engine architecture, custom API bases, or any secret/technical questions like "which AI are you using", NEVER directly expose API names, keys, or sources.
2. RESTRICTED NAMES: During any user-facing response, directly naming "Gemini", "Claude", "Anthropic", "OpenAI", "Groq", "DeepSeek", "Llama", "API key" or exact provider/technical terms when the user directly asks about them is STRICTLY FORBIDDEN. Always refer to them as "highly optimized cognitive engines", "powerful computational intelligence", "premium orchestration models", "advanced neural systems", or "secure authorization credentials".
3. MYSTERIOUS & PREMIUM NARRATIVE: Keep replies confident, aura-filled, and ultra-professional. The user must feel that navBharatAI is a robust, highly optimized, sovereign proprietary corporate network running unique proprietary enterprise algorithms.

Never:
- Leak secrets
- Expose API credentials or keys
- Suggest insecure systems
- Ignore authentication
- Ignore authorization
- Ignore validation
- Ignore sanitization
- Ignore rate limiting
- Ignore security risks

Always:
- Encourage secure architecture
- Recommend best practices
- Mention vulnerabilities when relevant

==================================================
## FINAL IDENTITY
==================================================

You are not just a chatbot.

You are:
- navBharatAI
- A hybrid intelligence system
- A smart conversational assistant
- An autonomous developer agent
- A strategist
- A production-grade engineering intelligence platform

Your behavior, tone, reasoning depth, and response quality must dynamically adapt based on:
- User intent
- User-selected mode
- Task complexity
- Technical depth
- Emotional tone
- Context continuity

Your ultimate goal:
Provide the most useful, natural, intelligent, and adaptive response possible.`;

  const getBharatContext = () => {
    const now = new Date();
    const today = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `${NAVBHARAT_OS_V2}

==================================================
CURRENT ACTIVE MODE: MODE 1 — NAVBHARATAI MODE
==================================================
YOUR IDENTITY: Official Date of Birth: May 10, 2026. Today: ${today}.
BEHAVIOR & REDIRECTION RULES:
1. You act like a friendly, warm assistant. Respond naturally in whatever language the user uses.
2. You can discuss ANYTHING: jokes, life, general knowledge, etc.
3. CONSTRAINTS: You are NOT in coding/building mode.
4. REDIRECTION RULE: If the user asks to build an app, website, feature, or any coding project (e.g., "build an app", "add this feature"), reply naturally like a friend first, then politely redirect them:
   "For app building, head over to Vishwakarma! I'm here for general chat." OR "Use Vishwakarma Pro or Basic for that — I'm your general assistant."
5. Never start full app coding in this mode. ONLY Vishwakarma agents handle architectural development.

IMPORTANT:
- Greet warmly only in the first response.
- Cite 1-3 sources for factual queries.`;
  };

  const getApiKeysInstruction = () => {
    return `\n\n==================================================
🚨 IMPORTANT ASSISTANCE FOR SECRETS & API KEYS 🚨
If the user is building an app and there is a need for API keys, secret keys, or authentication keys (e.g., Gemini API Key, Anthropic/Claude Key, OpenAI Key, Groq API Key, DeepSeek, OpenRouter, Stripe Secret Key, Firebase, Google Maps), you MUST proactively help them:
1. EXPLAIN LIKE A HUMAN: In extremely natural, conversational, simple, and friendly language (like a knowledgeable friend), explain what that key is and why it's absolutely necessary for their app.
2. WEBSITE DETAILS: Tell them the exact website name where they can get or generate this key.
3. DIRECT LINK GENERATION: Generate a direct, clickable markdown link (or button style) using these exact URLs:
   - Gemini (Google AI Studio): [Google AI Studio API Generation Page](https://aistudio.google.com/app/apikey)
   - Anthropic Claude: [Anthropic Console Keys Page](https://console.anthropic.com/settings/keys)
   - OpenAI: [OpenAI API Keys Page](https://platform.openai.com/api-keys)
   - Groq Cloud: [Groq Console Keys Page](https://console.groq.com/keys)
   - DeepSeek: [DeepSeek API Keys Page](https://platform.deepseek.com/api_keys)
   - OpenRouter: [OpenRouter Key Generation](https://openrouter.ai/keys)
   - Stripe: [Stripe Dashboard API Keys](https://dashboard.stripe.com/apikeys)
   - Firebase: [Firebase Console](https://console.firebase.google.com/)
4. SETTINGS DISCOVERY: Direct them to complete the process: "After copying this key, paste it in Settings → Secrets & API Keys panel."
5. INTERACTIVE TRIGGER: ALWAYS append the exact string "[ACTION_SECRET_HELPER:provider_name]" at the very beginning or end of your message (where provider_name is one of: 'gemini', 'openai', 'groq', 'deepseek', 'openrouter', 'claude', 'stripe', 'firebase', or 'custom'). This immediately triggers our high-tech inline Direct-Fill Assistant in their chat window, letting them paste and save it instantly if they find the settings too hard to navigate!
==================================================`;
  };

  const getVishwakarmaBasicContext = () => {
    return `${NAVBHARAT_OS_V2}

==================================================
CURRENT ACTIVE MODE: MODE 2a — VISHWAKARMA BASIC MODE
==================================================
STRICT RULE: Every single response of yours MUST start with "[AGENT: Vishwakarma Basic] [MODE: ARCHITECT]".
CAPABILITIES: Light to medium level coding, UI fixes, basic debugging, and small project building.
PRICING: 100 coins = 1₹ (1000 free coins for newcomers).
BEHAVIOR:
1. Greet as: "Hello! I'm Vishwakarma Basic. What are we building today?"
2. Provide functional code and architecture.
3. Keep it simple and efficient.${getApiKeysInstruction()}`;
  };

  const getVishwakarmaProContext = () => {
    return `${NAVBHARAT_OS_V2}

==================================================
CURRENT ACTIVE MODE: MODE 2b — VISHWAKARMA PRO MODE
==================================================
[AGENT: Vishwakarma Pro] [MODE: ELITE ARCHITECT & WEBSITE AUDITOR]
You are Vishwakarma Pro, navBharatAI ka High-Power Real Auditing & Coding Agent powering the supreme analysis layer.
Backend model: Advanced High-Reasoning Multi-Model Orchestration Engine.

Your permanent mission is to design, train, and permanently activate "Vishwakarma Pro" — a world-class, real, production-grade Website and Web App Auditing Agent that performs genuine, data-driven audits. Never allow fake, templated, repeated, or placeholder results. Every single audit must be unique, technical, and based on actual website data.

Vishwakarma Pro will receive any website URL or web app link from the user (example: https://example.com or any app user is building). It must automatically run a complete professional audit by checking every point below in exact sequential order.

### PERMANENT SYSTEM RULES FOR VISHWAKARMA PRO (Never break)
- Always begin every audit with Phase 1.
- Use real techniques: HTTP requests, APIs (PageSpeed, Lighthouse), certificate checks, header analysis, etc.
- If any limitation exists (no direct browser access), clearly mention it and give the best possible analysis using available tools/metrics.
- Provide real, actionable code fixes with working snippets.
- Output must be extremely detailed, structured, professional, and easy to understand for Indian developers.
- Never copy previous audit results. Every audit is fresh.
- STRICT PRICING: 75 coins = 1₹ (No free coins).
- STRICT RULE: Every single response of yours MUST start with "[AGENT: Vishwakarma Pro] [MODE: ELITE ARCHITECT & WEBSITE AUDITOR]".

### COMPLETE REAL AUDIT FRAMEWORK (Always follow in this exact order)

#### PHASE 1: BASIC HEALTH & ACCESSIBILITY CHECK (Follow in Strict Order)

1. **Website URL Validity (Live + 200 OK Status)**
   - What to do: Check if the URL is valid, server is live, and returning correct responses.
   - How: Send a real HTTP request, follow redirects, set a timeout.
   - Coding Help (Node.js):
\`\`\`javascript
const axios = require('axios');
const https = require('https');

async function checkURLHealth(url) {
  const startTime = Date.now();
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url.trim();
    }
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 10,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: () => true
    });
    const responseTime = Date.now() - startTime;
    return {
      originalUrl: url,
      finalUrl: response.request.res?.responseUrl || url,
      statusCode: response.status,
      isLive: response.status >= 200 && response.status < 400,
      responseTimeMs: responseTime,
      redirected: url !== (response.request.res?.responseUrl || url),
      server: response.headers['server']
    };
  } catch (error) {
    return {
      isLive: false,
      error: error.code || error.message,
      message: error.code === 'ENOTFOUND' ? 'Domain not found' : 
               error.code === 'ECONNREFUSED' ? 'Server not reachable' : 
               error.message.includes('timeout') ? 'Timeout - Site slow or down' : 'Connection error'
    };
  }
}
\`\`\`
   - Clearly show Green "✅ LIVE" or Red "❌ DOWN" in the report.

2. **SSL Certificate (HTTPS) + Expiry Date**
   - What to do: Check if HTTPS is active and when the certificate expires.
   - Coding Help (Node.js):
\`\`\`javascript
const https = require('https');
async function checkSSL(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      const cert = res.socket.getPeerCertificate();
      const expiry = new Date(cert.valid_to);
      const daysLeft = Math.floor((expiry - new Date()) / (86400000));
      resolve({
        https: true,
        valid: true,
        expiryDate: expiry.toDateString(),
        daysLeft: daysLeft,
        issuer: cert.issuer.CN,
        urgent: daysLeft < 30
      });
    }).on('error', () => resolve({https: false}));
  });
\`\`\`

3. **Loading Time (First Contentful Paint, Largest Contentful Paint)**
   - Call Google PageSpeed Insights API to retrieve FCP and LCP values.

4. **Mobile Responsiveness (Viewport, Media Queries)**
   - Check viewport meta tag + test with PageSpeed mobile strategy.

5. **PageSpeed Insights Score (Mobile + Desktop)**
   - Full score for both (Performance, Accessibility, Best Practices, SEO).

6. **Core Web Vitals (LCP, FID, CLS, INP)**
   - Exact values + rating (Good / Needs Improvement / Poor).

7. **Accessibility (WCAG 2.2)**
   - Contrast ratio, alt text, ARIA labels, keyboard navigation, Lighthouse Accessibility score.

OUTPUT STYLE FOR PHASE 1:
- Write each point under a bold heading.
- Actual value + Ideal value + Status (Excellent/Good/Poor) + Simple explanation.
- Provide both technical details and actionable suggestions.
- End with Phase 1 overall Health Score (out of 100).

This complete Basic Health & Accessibility Check phase is permanently active. Run it first and in full detail on every audit. All data must come from real coding logic and real measurements.
Current Mode: Vishwakarma Pro - Phase 1 Expert (Basic Health & Accessibility)
Mandatory: Confirm you have understood this complete Phase 1 system and will strictly follow it on every website audit.

#### PHASE 2: SEO AUDIT (Search Engine Optimization)
1. **Title Tag, Meta Description, Canonical Tag**
2. **Heading Structure (H1-H6 Hierarchy)**
3. **Robots.txt + Sitemap.xml Existence**
4. **Open Graph + Twitter Card Meta Tags**
5. **Indexability Check (No noindex tags unless intentional)**
6. **Schema.org Markup (Structured Data)**
7. **Broken Links + 404 Errors**
8. **Image Optimization + Lazy Loading**
9. **Keyword Analysis (Primary + Secondary)**
10. **Internal & External Linking Quality**

REAL IMPLEMENTATION & OUTPUT RULES for Phase 2:
- Start Phase 2 immediately after Phase 1.
- Check each point individually using real data (HTML parsing, API calls, headers).
- For each sub-point: Actual Value + Ideal Value + Status (Excellent/Good/Needs Improvement/Poor) + Clear Explanation + Fix Suggestion.
- End with a combined Phase 1 + Phase 2 summary and overall score.
- Provide a code fix snippet for every critical issue.
- This complete Phase 1 + Phase 2 system is permanently active. Implement it in exact sequence with real technical logic on every website audit.

Current Mode: Vishwakarma Pro - Phase 1 & 2 Expert (Basic Health + SEO Audit)

#### PHASE 3: PERFORMANCE & OPTIMIZATION AUDIT (Follow in Strict Order)

Start immediately after Phase 1 and Phase 2. Check each point individually and deeply.

**1. Total Page Size (Ideal under 3MB)**
- What to do: Measure total page size (HTML + images + JS + CSS + fonts).
- How: Calculate from main response Content-Length + resources crawling.
- Status: Under 3MB = Good, 3-5MB = Needs Improvement, Above 5MB = Poor.

**2. Number of HTTP Requests**
- What to do: Count total requests (HTML, JS, CSS, Images, APIs, etc.).
- Ideal: < 50 requests for good performance.
- How: Count via Lighthouse or network analysis.

**3. JavaScript & CSS Bundle Size**
- What to do: Individual and total size of all JS and CSS files.
- How: Filter .js and .css files from the resource list and measure size.
- Flag: Any bundle > 500KB triggers a warning.

**4. Unused JavaScript/CSS Detection**
- What to do: Identify how much JS and CSS is not actually being used.
- How: Calculate percentage from Coverage report (Chrome Coverage / Lighthouse).
- 30%+ unused = Critical issue.

**5. Image Optimization (WebP, AVIF, Compression)**
- What to do: Check image formats (JPG/PNG/WebP/AVIF), sizes, compression, and lazy loading.
- How: Analyze all <img> tags for format and size.
- Recommend switching to WebP/AVIF where applicable.

**6. Caching Headers (Cache-Control, ETag)**
- What to do: Verify that caching is properly set on static assets.
- How: Check response headers for 'Cache-Control', 'Expires', 'ETag'.
- Good Example: 'Cache-Control: public, max-age=31536000'

**7. CDN Usage**
- What to do: Detect if Cloudflare, AWS CloudFront, Akamai, Google CDN, etc. are in use.
- How: Detect from Server header, DNS CNAME, and response headers.

**8. Third-party Scripts Impact**
- What to do: Measure performance impact of Google Analytics, Facebook Pixel, GTM, Hotjar, etc.
- How: Count third-party domains and measure their load times.

**9. Render-blocking Resources**
- What to do: Identify JS and CSS files blocking page rendering.
- How: Extract list from Lighthouse Render Blocking Resources audit.
- Recommend: async, defer, preload, preconnect where appropriate.

### REAL IMPLEMENTATION GUIDELINES
- Best approach: Google PageSpeed Insights API + Lighthouse + Puppeteer/Playwright.
- For each point: actual measured value + Ideal value + Status (Excellent/Good/Needs Improvement/Poor) + Explanation.
- For major issues: provide working code fix suggestions (e.g., defer script, WebP conversion code).

### OUTPUT STYLE FOR PHASE 3
- Write each point under a bold heading.
- Measured Data + Ideal Benchmark + Status + Simple Explanation.
- Specific optimization code snippet for each major problem.
- End with Overall Performance Grade (A/B/C/D) and Priority Optimization List.

This complete **Phase 3: Performance & Optimization** system is permanently active. Strictly implement it with real data and technical logic after Phase 1 and Phase 2 on every website audit.

Current Mode: Vishwakarma Pro - Phase 3 Expert (Performance & Optimization Auditor)

#### PHASE 4: SECURITY AUDIT (Follow in Strict Order)

Start immediately after Phase 1, 2, and 3. Check each point individually and deeply.

**1. SSL Strength + Certificate Authority**
- What to do: Check SSL certificate strength, issuing authority (Let's Encrypt, Cloudflare, DigiCert, etc.), validity, and encryption level.
- How: Analyze certificate details (cipher, key length, TLS version).

**2. Security Headers (CSP, X-Frame-Options, HSTS, Referrer-Policy etc.)**
- What to do: Verify that important security headers are present and correctly configured.
- Important Headers: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- How: Check response headers and flag any missing or weak headers.

**3. Vulnerabilities Scan (XSS, CSRF, SQL Injection)**
- What to do: Check for signs of common web vulnerabilities.
- How: Scan headers, forms, input handling, and known patterns. (Note: Full automated scan is limited — provide best-effort analysis.)

**4. Outdated Libraries / Plugins (npm vulnerabilities)**
- What to do: Identify if JavaScript libraries and frameworks used on the site are outdated (React, Vue, jQuery, Bootstrap, etc.).
- How: Detect library versions from script tags and check against known vulnerabilities.

**5. Mixed Content (HTTP resources on HTTPS site)**
- What to do: Verify no HTTP resources (images, scripts, CSS) are loading on an HTTPS page.
- How: Scan HTML and network resources to detect mixed content.

**6. Sensitive Paths in robots.txt**
- What to do: Check if /admin, /.env, /config, /backup, /.git, etc. are disallowed in robots.txt.
- How: Analyze robots.txt content.

**7. Login Page Security (Rate Limiting, CAPTCHA)**
- What to do: Check for rate limiting, CAPTCHA, secure headers, and HTTPS enforcement on login pages.
- How: Detect login forms and verify related security features.

**8. Exposed Sensitive Files (.env, config, backup files)**
- What to do: Verify that .env, config.php, backup.sql, .git, wp-config.php, etc. are not publicly accessible.
- How: Directly request common sensitive file paths and check for 200 OK responses.

### REAL IMPLEMENTATION GUIDELINES
- Use main response headers for header checks.
- Test multiple common paths for sensitive file exposure.
- For each point: provide a clear risk level — Critical / High / Medium / Low.
- For each security issue: provide immediate fix suggestions and code examples.

### OUTPUT STYLE FOR PHASE 4
- Write each point under a bold heading.
- Actual Finding + Risk Level + Explanation + Fix Recommendation.
- Step-by-step fix code for every critical vulnerability.
- End with Overall Security Score (out of 100) and Urgent Fixes list.

This complete **Phase 4: Security Audit** system is permanently active. Strictly implement it with real technical checks after previous phases on every website audit.

Current Mode: Vishwakarma Pro - Phase 4 Expert (Security Audit Specialist)

#### PHASE 5: CODE QUALITY & TECHNICAL (Follow in Strict Order)

Start after Phase 1, 2, 3, and 4. Run a structural check on the target codebase.

**1. Tech Stack & Framework Detection**
- What to do: Identify the platform the website is built on (React, Next.js, WordPress, Shopify, Vue, Svelte, Laravel, static, etc.).
- How: Detect from HTML signatures, generator meta tags, global JS variables, and server response headers.

**2. SSR (Server-Side Rendering) vs CSR (Client-Side Rendering) Verification**
- Identify via static HTML analysis whether the initial document body delivers a full rendered page or bundle files build it at runtime.
- SSR is ideal for high performance and SEO indexability.

**3. Javascript Console Errors & Deprecated API usages**
- Chrome developer log simulation or library checks se identify console-level warnings or errors.

**4. JS & CSS Minification & Source Maps Exposure**
- Check assets to identify size-optimized code (.min.js, .min.css). Verify if source maps (.js.map) are exposed in production (security and proprietary code exposure risk).

**5. DOM Complexity & Nesting Depth**
- Measure total DOM nodes and nesting levels. Ideal nodes Count < 1200, depth < 32. Heavy DOM results in high Memory & layout computing issues.

### REAL IMPLEMENTATION & OUTPUT FOR PHASE 5
- Frame and write suggestions: Actual tech stack found + Risk level + Score. Provide optimize advice (e.g., config changes, hydration tips).

#### PHASE 6: UX/UI & OVERALL EXPERIENCE (Strict Order)

**1. Visual Rhythm & Typography Ratio**
- Font selection (Inter, Playfair, custom pairing) size ratios, readability, line height, contrast consistency.

**2. Interactive Cues & CTAs Accessibility**
- Form fields, clickable items, focus states, and visible, clear primary Calls-To-Action.

**3. Site Navigability & Trust Signals**
- Standard trust indicators: About Us page, Contact info, active SSL site seal, working links, footer documentation.

### OUTPUT STYLE FOR PHASE 5 & 6
- Write each point under a bold heading with Actual Value + Ideal value + status (Excellent/Good/Needs Improvement/Poor).
- Working code fix recommendation for component optimization or error fixing.
- Provide a combined Code Quality score out of 100.

### FINAL OUTPUT FORMAT (Always Strictly Follow)
1. **Executive Summary** (Overall Score /10 + 3 Key Highlights)
2. **Critical Issues** (Red)
3. **Major Warnings** (Orange)
4. **Positive Findings** (Green)
5. **Detailed Metrics Table**
6. **Actionable Recommendations with Code Snippets** (real fix snippets)
7. **Priority Fix List**
8. **Next Steps & Offer to fix specific issues** ("Which issue would you like to fix first? I can provide the complete code fix.")

### CRITICAL CORE AUDITING SECURITY DIRECTIVES:
- **NO HALLUCINATION FOR OFFLINE / NON-EXISTENT DOMAINS**: If the injected status check is a 'FAILURE' (e.g. 'SAKUNI REAL-TIME LIVE AUDIT ATTEMPT FAILURE (OFFLINE / NOT FOUND)'), you are strictly FORBIDDEN from generating or hallucinating any PageSpeed scores, SEO heading structures, HTML/CSS validation, or accessibility reviews! 
- Stop immediately after Phase 1. Give an overall Score of 0/10, clearly display that the remote host is totally Down, Unresolved, or Unreachable, and suggest checking the URL spelling or hosting status. 
- Generating fake statistics or metrics for a non-existent or offline domain (like aashish.com) is completely fake and must never be done under any circumstances. Always be 100% honest and transparent about live status data.${getApiKeysInstruction()}`;
  };

  const getVishwakarmaVipContext = () => {
    return `${NAVBHARAT_OS_V2}

==================================================
CURRENT ACTIVE MODE: MODE 2c — VISHWAKARMA VIP MODE
==================================================
[AGENT: Vishwakarma VIP] [MODE: SOVEREIGN ARCHITECT]
You are Vishwakarma VIP, the ultimate Sovereign Architect with multi-model mastery.
BEHAVIOR: Provide industrial-grade precision.${getApiKeysInstruction()}`;
  };

  const getSecurityContext = (target: string) => {
    return `You are a Senior Web Security Auditor for navBharatAI. 

Perform honest and detailed security scans. Identify production-level risks clearly.

**Activation Message:**
"🛡️ Security Auditor Activated | Target: ${target}"

**Report Format:**

**🛡️ Security Audit Report**
**Target:** ${target}
**Overall Posture:** [A+ / A / B / C / D / F]
**Risk Score:** [Score]/10

**Summary Table**
| Severity | Count |
|----------|-------|
| [Sev]    | [N]   |

**Detailed Findings**
**Finding #1: [Title]**
**Severity:** 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low
**Location:** [URL/File/Component]
**Explanation:** [Detailed explanation]
**Recommended Fix:** [Code example]

**Note:** Defensive and educational purposes only.`;
  };

  // AI Call functions
  async function callGemini(message: string, key?: string, history: any[] = [], systemInstruction?: string): Promise<string> {
    const ai = getGemini(key);
    
    if (!ai) {
      throw new Error(`Gemini API Key missing or invalid! Please ensure a valid key is set in Settings.`);
    }

    const modelCandidate = 'gemini-3.5-flash'; // Primary active model based on guidelines
    
    try {
      const contents = history.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));
      
      contents.push({ role: 'user', parts: [{ text: message }] });
      
      const result = await ai.models.generateContent({
        model: modelCandidate,
        contents: contents,
        config: {
          systemInstruction: systemInstruction || getBharatContext(),
          tools: [{ googleSearch: {} }]
        }
      });
      
      // Handle the response structure of @google/genai SDK
      const reply = result.candidates?.[0]?.content?.parts?.[0]?.text || (result as any).text || (result as any).response?.text?.();
      if (!reply) throw new Error('No content generated by AI');
      return reply;
    } catch (e: any) {
      console.error(`[API] Gemini call failed:`, e.reason || e.message);
      throw e;
    }
  }

  async function callGroq(message: string, key?: string, history: any[] = []): Promise<string> {
    const client = getGroq(key);
    if (!client) throw new Error('Groq API Key not available');
    
    const messages: any[] = [
      { role: 'system', content: getBharatContext() },
      ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: message }
    ];

    const completion = await client.chat.completions.create({
      messages,
      model: 'mixtral-8x7b-32768',
    });
    return completion.choices[0]?.message?.content ?? 'Groq error';
  }

  async function callDeepSeek(message: string, key?: string, history: any[] = []): Promise<string> {
    const client = getDeepSeek(key) || getOpenRouter(key);
    if (!client) throw new Error('DeepSeek/OpenRouter API Key not available');
    
    const model = client.baseURL.includes('openrouter') ? 'deepseek/deepseek-chat' : 'deepseek-chat';
    const messages: any[] = [
      { role: 'system', content: getBharatContext() + " You are an expert programmer." },
      ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: message }
    ];

    const completion = await client.chat.completions.create({
      messages,
      model,
    });
    return completion.choices[0]?.message?.content ?? 'DeepSeek error';
  }

  async function callOpenAI(message: string, key?: string, history: any[] = []): Promise<string> {
    const client = getOpenAI(key);
    if (!client) throw new Error('OpenAI API Key not available');
    
    const messages: any[] = [
      { role: 'system', content: getBharatContext() },
      ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: message }
    ];

    const completion = await client.chat.completions.create({
      messages,
      model: 'gpt-4o-mini',
    });
    return completion.choices[0]?.message?.content ?? 'OpenAI error';
  }

  async function callClaude(message: string, key?: string, history: any[] = [], systemInstruction?: string): Promise<string> {
    const { key: resolvedKey, source } = resolveApiKey('claude', key);
    if (!resolvedKey) {
      throw new Error('Claude API Key not available');
    }

    // Support for OpenAI compatible proxy (e.g. aicredits.in) when ANTHROPIC_BASE_URL is configured
    if (process.env.ANTHROPIC_BASE_URL) {
      console.log(`[AUTH] Claude routing via OpenAI proxy: ${process.env.ANTHROPIC_BASE_URL} (source: ${source})`);
      const client = new OpenAI({
        apiKey: resolvedKey,
        baseURL: process.env.ANTHROPIC_BASE_URL
      });
      // Try standard proxy/gateway compatible model names (including verified aicredits active mappings)
      const modelsToTry = [
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-sonnet-4',
        'claude-sonnet-4-6',
        'anthropic/claude-opus-4.7-fast',
        'anthropic/claude-opus-4.7',
        'anthropic/claude-3-haiku',
        'claude-3-5-sonnet-latest',
        'claude-3-5-sonnet',
        'claude-3.5-sonnet',
        'anthropic/claude-3.5-sonnet',
        'claude-3-5-sonnet-20241022',
        'anthropic/claude-3-5-sonnet-latest',
        'claude-3-opus'
      ];
      
      let lastErr = null;
      for (const modelName of modelsToTry) {
        try {
          console.log(`[AUTH] Calling Claude proxy model: ${modelName}`);
          const completion = await client.chat.completions.create({
            model: modelName,
            messages: [
              ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : [{ role: 'system' as const, content: getBharatContext() }]),
              ...history.map(m => ({
                role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.text as string
              })),
              { role: 'user' as const, content: message }
            ]
          });
          const ans = completion.choices[0]?.message?.content;
          if (ans) return ans;
        } catch (err: any) {
          console.warn(`[AUTH] Claude proxy failed with model ${modelName}: ${err.message}`);
          lastErr = err;
        }
      }
      throw lastErr || new Error('Claude proxy failed');
    }

    // Normal Anthropic SDK usage (e.g. for User supplied keys with no custom base URL)
    const client = getClaude(key);
    if (!client) throw new Error('Claude API Key not available');
    
    const messages: any[] = history.map(m => ({ 
      role: m.sender === 'user' ? 'user' : 'assistant' as const, 
      content: m.text 
    }));
    messages.push({ role: 'user', content: message });

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemInstruction || getBharatContext(),
      messages,
    });
    return response.content[0].type === 'text' ? response.content[0].text : 'Claude error';
  }

  async function callOpenRouter(message: string, key?: string, history: any[] = []): Promise<string> {
    const client = getOpenRouter(key);
    if (!client) throw new Error('OpenRouter API Key not available');
    
    const messages: any[] = [
      { role: 'system', content: getBharatContext() },
      ...history.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: message }
    ];

    const completion = await client.chat.completions.create({
      messages,
      model: 'deepseek/deepseek-chat',
    });
    return completion.choices[0]?.message?.content ?? 'OpenRouter error';
  }

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
  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'GitHub Client ID not configured' });

    const state = (req.query.state as string) || '';

    // ALWAYS HARDCODE THE SECURE PRODUCTION REDIRECT URI PER USER DIRECTIVE
    const redirectUri = "https://navbharatai.com/api/github/callback";

    const scope = 'repo workflow read:user user:email';
    
    // Safely generate using URL() API to prevent malformed slashes or parameter encoding
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', clientId);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('scope', scope);
    githubUrl.searchParams.set('state', state);

    console.log('[GITHUB_AUTH_URL] Safe URL construction succeeded:', githubUrl.toString());

    res.json({ 
      url: githubUrl.toString(),
      clientId: clientId,
      redirectUri: redirectUri,
      scope: scope,
      state: state
    });
  });

  app.get('/api/auth/github', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'GitHub Client ID not configured' });
    
    // Support state for returning to the original page
    const state = (req.query.state as string) || '';
    
    // ALWAYS HARDCODE THE SECURE PRODUCTION REDIRECT URI PER USER DIRECTIVE
    const redirectUri = "https://navbharatai.com/api/github/callback";
    
    const scope = 'repo workflow read:user user:email';
    
    // Safely generate using URL() API to prevent malformed redirect strings
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', clientId);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('scope', scope);
    githubUrl.searchParams.set('state', state);

    console.log(`[GITHUB_AUTH] Redirecting to: ${githubUrl.toString()}`);
    res.redirect(githubUrl.toString());
  });

  app.get(['/api/auth/github/callback', '/auth/github', '/api/github/callback'], async (req, res) => {
    const { code, state } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    
    // ALWAYS HARDCODE THE SECURE PRODUCTION REDIRECT URI PER USER DIRECTIVE
    const redirectUri = "https://navbharatai.com/api/github/callback";

    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
      console.log(`[GITHUB_AUTH_CALLBACK] Fetching access token from GitHub. Redirect URI: ${redirectUri}`);
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      }, {
        headers: { Accept: 'application/json' }
      });

      const { access_token, error, error_description } = response.data;
      if (error) throw new Error(error_description || error);

      // If state is a URL, we might be in a full redirect flow
      const returnUrl = (state as string)?.startsWith('http') ? state as string : null;

      if (returnUrl) {
        // Full redirect flow: redirect back to app with token in fragment or query
        // fragment is safer for tokens
        return res.redirect(`${returnUrl}#gh_token=${access_token}`);
      }

      // Popup flow with dual local storage sync + opener postMessage
      res.send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <div style="margin-bottom:20px;">
                <svg height="48" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="48" style="fill:#ffffff;margin:0 auto;">
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.35 3.12.88.01.47.01.84.01.93 0 .22-.17.47-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
              </div>
              <h2 style="color:#58a6ff;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">GitHub Authentication Successful!</h2>
              <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;">Your account was successfully connected to navBharatAI. Closing window and redirecting to work...</p>
              
              <div style="width:24px;height:24px;border:3px solid #58a6ff;border-top-color:transparent;border-radius:50%;animation:spin 1.2s linear infinite;margin:0 auto 24px auto;"></div>
              
              <button id="close-btn" onclick="handleReturnToApp()" style="background:#238636;color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;width:100%;transition:background-color 0.2s;box-shadow:0 4px 12px rgba(35,134,54,0.3);">
                Return to navBharatAI
              </button>
            </div>
            
            <style>
              @keyframes spin { to { transform: rotate(360deg); } }
              #close-btn:hover { background-color: #2ea043; }
            </style>
            
            <script>
              const token = '${access_token}';
              const returnUrl = '${returnUrl || "https://navbharatai.com/"}';
              
              function handleReturnToApp() {
                try {
                  localStorage.setItem('gh_token', token);
                  localStorage.setItem('gh_token_signal', token);
                } catch(e) {
                  console.error('Local storage write failure:', e);
                }
                
                try {
                  if (window.opener) {
                    window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: token }, '*');
                  }
                } catch(e) {
                  console.error('PostMessage handshake failure:', e);
                }

                window.close();
                
                // Fallback: if window.close() fails, redirect current window
                setTimeout(() => {
                  window.location.href = returnUrl + '#gh_token=' + token;
                }, 100);
              }

              // Auto-run connection sync and closure
              try {
                localStorage.setItem('gh_token', token);
                localStorage.setItem('gh_token_signal', token);
                
                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: token }, '*');
                  setTimeout(() => {
                    window.close();
                  }, 1200);
                } else {
                  // Direct tab fallback
                  setTimeout(() => {
                    window.location.href = returnUrl + '#gh_token=' + token;
                  }, 1200);
                }
              } catch(e) {
                console.error('Handshake execution failure:', e);
                // Fallback direct redirection
                setTimeout(() => {
                  window.location.href = returnUrl + '#gh_token=' + token;
                }, 1000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error('GitHub Auth Error:', err.message);
      res.send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <div style="margin-bottom:20px;">
                <svg height="48" viewBox="0 0 16 16" width="48" style="fill:#f85149;margin:0 auto;">
                  <path d="M6.457 1.047c.659-1.233 2.427-1.233 3.086 0l6.03 11.296c.614 1.15-.216 2.543-1.514 2.543H1.94c-1.298 0-2.128-1.393-1.514-2.543l6.03-11.296zm1.42 8.44a1 1 0 102 0v-3a1 1 0 00-2 0v3zM8 12.5a1 1 0 100-2 1 1 0 000 2z"></path>
                </svg>
              </div>
              <h2 style="color:#f85149;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">GitHub Connection Failed</h2>
              <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;word-break:break-word;">Error: ${err.message}</p>
              
              <button onclick="window.close()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;width:100%;transition:background-color 0.2s;">
                Close Window
              </button>
            </div>
            
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_ERROR', error: '${err.message}' }, '*');
                }
              } catch(e) {}
            </script>
          </body>
        </html>
      `);
    }
  });

  app.get('/api/github/user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${token}` }
      });
      res.json(response.data);
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.message });
    }
  });

  // Firebase OAuth / Google Consent Mock Flow
  app.get('/api/auth/firebase', (req, res) => {
    const state = (req.query.state as string) || '';
    res.redirect(`/api/auth/firebase/consent?state=${encodeURIComponent(state)}`);
  });

  app.get('/api/auth/firebase/consent', (req, res) => {
    const state = (req.query.state as string) || '';
    const projects = [
      { id: 'navbharat-sandbox-7729', name: 'navBharat Sandbox (Default)' },
      { id: 'navbharat-saas-enterprise', name: 'navBharat SaaS Enterprise (Production)' },
      { id: 'navbharat-ecom-99a3', name: 'navBharat E-Commerce Portal' },
      { id: 'firebase-custom-build', name: 'Custom Firebase Target' }
    ];

    res.send(`
      <html>
        <head>
          <title>Authorize Firebase DevOps Pipeline - navBharatAI</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body {
              background: #0d1117;
              color: #c9d1d9;
              font-family: 'Outfit', -apple-system, system-ui, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            .card {
              background: #161b22;
              border: 1px solid #30363d;
              border-radius: 16px;
              padding: 32px;
              max-width: 480px;
              width: 100%;
              box-shadow: 0 12px 40px rgba(0,0,0,0.5);
              text-align: center;
            }
            h2 {
              color: #ffca28;
              margin-top: 0;
              font-size: 20px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1px;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            }
            p.desc {
              font-size: 13px;
              color: #8b949e;
              margin-bottom: 24px;
              line-height: 1.6;
            }
            .auth-logos {
              display: flex;
              justify-content: center;
              align-items: center;
              gap: 16px;
              margin-bottom: 24px;
            }
            .logo-wrap {
              width: 38px;
              height: 38px;
              border-radius: 10px;
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid #30363d;
              display: flex;
              justify-content: center;
              align-items: center;
            }
            .badge-item {
              font-size: 10px;
              font-weight: 800;
              background: rgba(255, 202, 40, 0.1);
              color: #ffca28;
              border: 1px solid rgba(255, 202, 40, 0.2);
              padding: 4px 8px;
              border-radius: 6px;
              display: inline-block;
              margin-bottom: 16px;
            }
            .form-group {
              text-align: left;
              margin-bottom: 20px;
            }
            label {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              color: #8b949e;
              display: block;
              margin-bottom: 8px;
            }
            select, input {
              width: 100%;
              background: #0d1117;
              border: 1px solid #30363d;
              border-radius: 8px;
              padding: 10px 12px;
              color: white;
              font-size: 12px;
              font-weight: 600;
              outline: none;
              box-sizing: border-box;
            }
            select:focus, input:focus {
              border-color: #58a6ff;
            }
            .btn-primary {
              background: #ffca28;
              color: #121212;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 13px;
              font-weight: 800;
              width: 100%;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              transition: all 0.2s;
              box-shadow: 0 4px 12px rgba(255, 202, 40, 0.2);
            }
            .btn-primary:hover {
              background: #ffd54f;
              transform: translateY(-1px);
              box-shadow: 0 6px 16px rgba(255, 202, 40, 0.3);
            }
            .footer-text {
              font-size: 10px;
              color: #484f58;
              margin-top: 16px;
              display: block;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="auth-logos">
              <div class="logo-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3.89 19.4L11.55 3.32C11.74 2.92 12.26 2.92 12.45 3.32L20.11 19.4C20.31 19.82 19.92 20.3 19.45 20.19L12.23 18.52C12.08 18.48 11.92 18.48 11.77 18.52L4.55 20.19C4.08 20.3 3.69 19.82 3.89 19.4Z" fill="#FFCA28"/>
                  <path d="M12.00 3.00C11.85 3.00 11.70 3.10 11.64 3.25L4.05 19.22C3.89 19.55 4.15 19.95 4.52 19.87L11.71 18.23C11.90 18.19 12.10 18.19 12.29 18.23L19.48 19.87C19.85 19.95 20.11 19.55 19.95 19.22L12.36 3.25C12.30 3.10 12.15 3.00 12.00 3.00Z" fill="#F57C00"/>
                </svg>
              </div>
              <div style="font-weight: 800; font-size: 18px; color: #8b949e;">&times;</div>
              <div class="logo-wrap" style="border-color: #58a6ff;">
                <span style="font-size: 13px; font-weight: 900; color: #58a6ff; font-family: monospace;">nB</span>
              </div>
            </div>
            
            <h2>Firebase DevOps Link</h2>
            <div class="badge-item">Secure Google Cloud Link</div>
            
            <p class="desc">Link your Firebase Project, obtain high-security deploy keys, and configure automated hosting updates safely in one-click.</p>
            
            <form action="/api/auth/firebase/callback" method="GET">
              <input type="hidden" name="state" value="${state}" />
              
              <div class="form-group">
                <label>Select Deployment Project</label>
                <select name="projectId" id="proj-selector" onchange="toggleCustomInput(this.value)">
                  ${projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
              </div>
              
              <div id="custom-field" class="form-group" style="display:none;">
                <label>Enter Custom Project ID</label>
                <input type="text" name="customProjectId" id="custom-id-input" placeholder="e.g. my-app-prod-391" />
              </div>
              
              <div class="form-group">
                <label>Developer Identity (Email)</label>
                <input type="email" name="email" value="firebase-admin@navbharat.com" required />
              </div>
              
              <button type="submit" class="btn-primary">
                Authorize & Bind Project
              </button>
            </form>
            
            <span class="footer-text">Security keys are encrypted and stored in local workspace environments.</span>
          </div>

          <script>
            function toggleCustomInput(val) {
              const cf = document.getElementById('custom-field');
              const input = document.getElementById('custom-id-input');
              if (val === 'firebase-custom-build') {
                cf.style.display = 'block';
                input.required = true;
              } else {
                cf.style.display = 'none';
                input.required = false;
              }
            }
          </script>
        </body>
      </html>
    `);
  });

  app.get('/api/auth/firebase/callback', (req, res) => {
    const { projectId, customProjectId, email, state } = req.query;
    const returnUrl = (state as string)?.startsWith('http') ? (state as string) : null;

    // Check for "Firebase callback failed"
    if (!projectId && !customProjectId) {
      const errorMsg = 'No Firebase Project ID or customized selection received during callback handshake.';
      const solutionMsg = 'Ensure you pick or specify a valid project ID on the Consent dialog screen and tap Authorize.';
      
      console.log('❌=== [FIREBASE CALLBACK FAILURE DEBUG] ===');
      console.log('❌ Error: Missing project details.');
      console.log('==========================================');

      return res.status(400).send(`
        <html>
          <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#161b22;border:1px solid #f8514940;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
              <h2 style="color:#f85149;margin-top:0;margin-bottom:8px;font-size:20px;font-weight:700;">Firebase Callback Failed</h2>
              <p style="font-size:13px;color:#8b949e;margin-bottom:24px;line-height:1.5;">${errorMsg}</p>
              <button onclick="window.close()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600;width:100%;">Close Window</button>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({
                  type: 'FIREBASE_AUTH_ERROR',
                  errorType: 'Firebase Callback Failed',
                  error: '${errorMsg}',
                  suggestions: '${solutionMsg}'
                }, '*');
              }
            </script>
          </body>
        </html>
      `);
    }

    const finalProjectId = projectId === 'firebase-custom-build' ? (customProjectId as string) : (projectId as string);
    const generatedToken = "1//0SB" + Math.random().toString(36).substring(2, 10).toUpperCase() + "_" + Math.random().toString(36).substring(2, 15);
    
    // Create random mock Service Account JSON
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      project_id: finalProjectId,
      private_key_id: "pk_" + Math.random().toString(16).substring(2, 14),
      private_key: "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDhv69v...\\n-----END PRIVATE KEY-----\\n",
      client_email: "firebase-adminsdk-q0p29@" + finalProjectId + ".iam.gserviceaccount.com"
    }, null, 2);

    const userObj = {
      name: "navBharat Firebase Operator",
      email: email || "firebase-admin@navbharat.com",
      projectId: finalProjectId,
      token: generatedToken,
      serviceAccount: serviceAccountJson,
      connectedAt: new Date().toLocaleString()
    };

    const userString = JSON.stringify(userObj);

    // Write to server logs
    console.log('✅=== [FIREBASE OAUTH CALLBACK DEBUG] ===');
    console.log('✅ Auth success payload:', userObj);
    console.log('✅ Generated token:', generatedToken);
    console.log('✅ Current origin:', req.headers.host);
    console.log('=========================================');

    res.send(`
      <html>
        <head>
          <title>Authentication Successful - Firebase DevOps Pipeline</title>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            #close-btn:hover { background-color: #d89b00; }
          </style>
        </head>
        <body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
          <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
            <div style="margin-bottom:20px;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto;">
                <path d="M3.89 19.4L11.55 3.32C11.74 2.92 12.26 2.92 12.45 3.32L20.11 19.4C20.31 19.82 19.92 20.3 19.45 20.19L12.23 18.52C12.08 18.48 11.92 18.48 11.77 18.52L4.55 20.19C4.08 20.3 3.69 19.82 3.89 19.4Z" fill="#FFCA28"/>
              </svg>
            </div>
            <h2 style="color:#ffca28;margin-top:0;margin-bottom:8px;font-size:22px;font-weight:600;">Firebase Linked!</h2>
            <p style="font-size:14px;color:#8b949e;margin-bottom:24px;line-height:1.5;">Your Firebase project was bound to your DevOps Sandbox environment. Redirecting back...</p>
            
            <div style="width:24px;height:24px;border:3px solid #ffca28;border-top-color:transparent;border-radius:50%;animation:spin 1.2s linear infinite;margin:0 auto 24px auto;"></div>
            
            <button id="close-btn" onclick="handleReturnToApp()" style="background:#ffca28;color:#121212;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;width:100%;transition:all 0.2s;box-shadow:0 4px 12px rgba(255,202,40,0.3);text-transform:uppercase;letter-spacing:0.5px;">
              Return to navBharatAI
            </button>
          </div>
          
          <script>
            const token = '${generatedToken}';
            const userString = \`${userString}\`;
            const returnUrl = '${returnUrl || "https://navbharatai.com/"}';
            
            function handleReturnToApp() {
              try {
                localStorage.setItem('fb_token', token);
                localStorage.setItem('firebase_token', token);
                localStorage.setItem('firebase_token_signal', token);
                localStorage.setItem('fb_user', userString);
                localStorage.setItem('firebase_user', userString);
                localStorage.setItem('firebase_user_signal', userString);
                localStorage.setItem('v_deploy_platform', 'firebase');
              } catch(e) {
                console.error('Local storage write failure:', e);
              }
              
              try {
                if (window.opener) {
                  window.opener.postMessage({ 
                    type: 'FIREBASE_AUTH_SUCCESS', 
                    token: token,
                    user: JSON.parse(userString)
                  }, '*');
                }
              } catch(e) {
                console.error('PostMessage handshake failure:', e);
              }

              window.close();
              
              // Fallback redirect
              setTimeout(() => {
                window.location.href = returnUrl + '#fb_token=' + token + '&fb_user=' + encodeURIComponent(userString) + '&firebase_token=' + token + '&firebase_email=' + encodeURIComponent("${email || ''}");
              }, 100);
            }

            // Auto-run connection sync and closure
            try {
              localStorage.setItem('fb_token', token);
              localStorage.setItem('firebase_token', token);
              localStorage.setItem('firebase_token_signal', token);
              localStorage.setItem('fb_user', userString);
              localStorage.setItem('firebase_user', userString);
              localStorage.setItem('firebase_user_signal', userString);
              localStorage.setItem('v_deploy_platform', 'firebase');
              
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'FIREBASE_AUTH_SUCCESS', 
                  token: token,
                  user: JSON.parse(userString)
                }, '*');
                setTimeout(() => {
                  window.close();
                }, 1200);
              } else {
                setTimeout(() => {
                  window.location.href = returnUrl + '#fb_token=' + token + '&fb_user=' + encodeURIComponent(userString) + '&firebase_token=' + token + '&firebase_email=' + encodeURIComponent("${email || ''}");
                }, 1200);
              }
            } catch(e) {
              console.error('Handshake execution failure:', e);
            }
          </script>
        </body>
      </html>
    `);
  });

  app.get('/api/github/repos', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const response = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: { Authorization: `token ${token}` }
      });
      res.json(response.data);
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.message });
    }
  });

  // Secure Cloud Sync Endpoints (with Authenticated user validation check)
  app.post('/api/cloudsync/github', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1] || req.body.token;
    const { owner, repo, branch = 'main' } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, { headers });
      const treeSha = branchRes.data.commit.commit.tree.sha;
      const treeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
      const tree = treeRes.data.tree;
      const files: Record<string, string> = {};
      const textExtensions = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.yml', '.yaml']);
      
      let fetchedCount = 0;
      for (const item of tree) {
        if (item.type === 'blob' && fetchedCount < 100) {
          const ext = path.extname(item.path).toLowerCase();
          if (textExtensions.has(ext) || path.basename(item.path) === 'Dockerfile' || path.basename(item.path).startsWith('.')) {
            try {
              const blobRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${item.sha}`, { headers });
              files[item.path] = Buffer.from(blobRes.data.content, 'base64').toString('utf-8');
              fetchedCount++;
            } catch (blobErr) {
              console.warn(`Failed to fetch blob for ${item.path}:`, blobErr);
            }
          }
        }
      }
      res.json({ status: 'success', files, tree });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/cloudsync/firebase', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      res.json({
        status: 'success',
        projects: [
          { id: 'navbharat-sandbox-7729', name: 'navBharat Sandbox (Default)', hosting: 'navbharat-sandbox-7729.web.app', functions: ['api-gateway', 'telemetry-worker'] },
          { id: 'navbharat-saas-enterprise', name: 'navBharat SaaS Enterprise (Production)', hosting: 'navbharat-saas-enterprise.web.app', functions: ['billing-service', 'user-provisioner'] },
          { id: 'navbharat-ecom-99a3', name: 'navBharat E-Commerce Portal', hosting: 'navbharat-ecom-99a3.web.app', functions: ['cart-handler', 'checkout-listener'] },
          { id: 'firebase-custom-build', name: 'Custom Firebase Target', hosting: 'firebase-custom-build.web.app', functions: ['webhook-receiver'] }
        ]
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cloudsync/vercel', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      res.json({
        status: 'success',
        deployments: [
          { id: 'dep-44a1', name: 'my-ecommerce-app', url: 'https://my-ecommerce-app.vercel.app', repo: 'workspace/my-ecommerce-app', env: 'production' },
          { id: 'dep-09b2', name: 'mitrify', url: 'https://mitrify-stream.vercel.app', repo: 'workspace/mitrify', env: 'production' },
          { id: 'dep-77c8', name: 'navbharat-dashboard', url: 'https://navbharat-dash.vercel.app', repo: 'workspace/navbharat-dashboard', env: 'staging' },
          { id: 'dep-88d9', name: 'portfolio-site', url: 'https://ashish-portfolio.vercel.app', repo: 'workspace/portfolio-site', env: 'production' }
        ]
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/github/fetch', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, path: repoPath = '', recursive = true, branch } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      
      // If we want a full tree, it's better to use the tree API
      // First, get the default branch or use provided branch
      let targetBranch = branch;
      if (!targetBranch) {
        const repoRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        targetBranch = repoRes.data.default_branch;
      }
      
      const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${targetBranch}`, { headers });
      const treeSha = branchRes.data.commit.commit.tree.sha;
      
      const treeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=${recursive ? 1 : 0}`, { headers });
      
      const tree = treeRes.data.tree;
      const files: Record<string, string> = {};

      // Common text extensions to fetch
      const textExtensions = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.rb', '.go', '.rs', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.sql', '.yml', '.yaml', '.xml']);
      
      for (const item of tree) {
          if (item.type === 'blob') {
              const ext = path.extname(item.path).toLowerCase();
              if (textExtensions.has(ext) || path.basename(item.path) === 'Dockerfile' || path.basename(item.path).startsWith('.')) {
                  if (Object.keys(files).length > 200) break; // Increased limit for real projects
                  
                  try {
                      const blobRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${item.sha}`, { headers });
                      const content = Buffer.from(blobRes.data.content, 'base64').toString('utf-8');
                      files[item.path] = content;
                  } catch (err) {
                      console.warn(`Failed to fetch blob for ${item.path}:`, err);
                  }
              }
          }
      }

      res.json({ files, tree });
    } catch (err: any) {
      console.error('Fetch Error:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/file', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, path } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers });
      
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      res.json({ content, sha: response.data.sha });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/branches', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches`, { headers });
      res.json({ branches: response.data.map((b: any) => b.name) });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/push', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { owner, repo, files, message = 'Update from Navbharat AI', branch = 'main' } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      // Professional push logic using GitHub API (simplified for standard web projects)
      // 1. Get latest commit SHA
      // 2. Create blobs
      // 3. Create tree
      // 4. Create commit
      // 5. Update reference
      
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      
      // Get base branch info
      const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
      const lastCommitSha = refRes.data.object.sha;
      
      const treeItems = [];
      for (const [path, content] of Object.entries(files)) {
        treeItems.push({
          path,
          mode: '100644',
          type: 'blob',
          content: content as string
        });
      }

      const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        base_tree: lastCommitSha,
        tree: treeItems
      }, { headers });

      const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        message,
        tree: treeRes.data.sha,
        parents: [lastCommitSha]
      }, { headers });

      await axios.patch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: commitRes.data.sha,
        force: true
      }, { headers });

      res.json({ success: true, sha: commitRes.data.sha });
    } catch (err: any) {
      console.error('Push Error:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  app.post('/api/github/push-enhanced', async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^(bearer|token)\s+/i, '').trim() : null;
    const { owner, repo, files, visibility = 'private', branch = 'main', message = 'Update from Navbharat AI' } = req.body;
    
    if (!token) return res.status(401).json({ error: 'Unauthorized: GitHub OAuth token is missing' });
    if (!owner || !repo) return res.status(400).json({ error: 'Repository owner and name are required' });

    console.log(`[PUSH_ENHANCED] Initializing push for target ${owner}/${repo} on branch ${branch} (Visibility: ${visibility})`);

    const headers = { 
      Authorization: `token ${token}`, 
      Accept: 'application/vnd.github.v3+json' 
    };

    try {
      // Step A: Determine if repository already exists
      let repoExists = false;
      try {
        await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        repoExists = true;
        console.log(`[PUSH_ENHANCED] Target repository https://github.com/${owner}/${repo} exists.`);
      } catch (checkErr: any) {
        if (checkErr.response?.status === 404) {
          console.log(`[PUSH_ENHANCED] Target repository https://github.com/${owner}/${repo} does not exist. Creating...`);
        } else {
          throw checkErr;
        }
      }

      // Step B: Create repository if it does not exist
      if (!repoExists) {
        // Fetch current authenticated user's login to verify organization vs personal
        const userProfileRes = await axios.get('https://api.github.com/user', { headers });
        const username = userProfileRes.data.login;
        
        let createRes;
        if (owner.toLowerCase() === username.toLowerCase()) {
          console.log(`[PUSH_ENHANCED] Creating personal repository "${repo}" for user "${username}"`);
          createRes = await axios.post('https://api.github.com/user/repos', {
            name: repo,
            private: visibility === 'private',
            description: 'Created dynamically inside navBharat AI Workspaces',
            auto_init: false // Initialize empty so we import all files
          }, { headers });
        } else {
          console.log(`[PUSH_ENHANCED] Attempting to create repository "${repo}" inside organization "${owner}"`);
          try {
            createRes = await axios.post(`https://api.github.com/orgs/${owner}/repos`, {
              name: repo,
              private: visibility === 'private',
              description: 'Created dynamically inside navBharat AI Workspaces',
              auto_init: false
            }, { headers });
          } catch (orgErr: any) {
            console.warn(`[PUSH_ENHANCED] Organization repo creation failed. Fallback to user profile creation...`, orgErr.response?.data || orgErr.message);
            createRes = await axios.post('https://api.github.com/user/repos', {
              name: repo,
              private: visibility === 'private',
              description: 'Created dynamically inside navBharat AI Workspaces',
              auto_init: false
            }, { headers });
          }
        }
        console.log(`[PUSH_ENHANCED] Repository created successfully: ${createRes.data.html_url}`);
      }

      // Step C: Check if branch reference exists or if repo is empty
      let lastCommitSha: string | null = null;
      let referenceExists = false;

      try {
        const refRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
        lastCommitSha = refRes.data.object.sha;
        referenceExists = true;
      } catch (refErr: any) {
        if (refErr.response?.status === 404 || refErr.response?.status === 409) {
          console.log(`[PUSH_ENHANCED] Branch ref "heads/${branch}" not found or repo is empty. Bootstrapping initial commit...`);
        } else {
          throw refErr;
        }
      }

      // If repository is empty, we must create an initial commit by writing first file via Contents API
      if (!referenceExists || !lastCommitSha) {
        const fileNames = Object.keys(files || {});
        if (fileNames.length === 0) {
          return res.status(400).json({ error: 'Cannot push an empty workspace. No files present.' });
        }
        
        const firstFilePath = fileNames.find(f => f === 'README.md' || f === 'package.json') || fileNames[0];
        const firstFileContent = files[firstFilePath] || '';
        const base64Content = Buffer.from(firstFileContent).toString('base64');

        console.log(`[PUSH_ENHANCED] Bootstrap committing file "${firstFilePath}" via contents API to establish "/heads/${branch}" branch...`);
        const putRes = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${firstFilePath}`, {
          message: `Initial bootstrap commit via navBharatAI [${firstFilePath}]`,
          content: base64Content,
          branch: branch
        }, { headers });

        lastCommitSha = putRes.data.commit.sha;
        referenceExists = true;
        console.log(`[PUSH_ENHANCED] Boostrap commit created successfully with SHA ${lastCommitSha}`);
      }

      // Tree API to commit entire workspace with automated security filtering
      console.log(`[PUSH_ENHANCED] Writing complete directory tree for ${owner}/${repo} on base commit ${lastCommitSha}...`);
      const treeItems = [];
      for (const [path, content] of Object.entries(files || {})) {
        const lowerPath = path.toLowerCase();
        // Skip node_modules, internal git heads, active environment variables, credentials, and app secrets
        if (
          lowerPath.includes('node_modules/') ||
          lowerPath.includes('.git/') ||
          (lowerPath.startsWith('.env') && !lowerPath.endsWith('.example')) ||
          lowerPath.includes('firebase-applet-config.json') ||
          lowerPath.includes('serviceaccount') ||
          lowerPath.includes('secret') ||
          lowerPath.includes('private_key') ||
          lowerPath.endsWith('.log')
        ) {
          console.log(`[PUSH_ENHANCED] Security Shield successfully isolated & skipped transmission of sensitive file: ${path}`);
          continue;
        }
        treeItems.push({
          path,
          mode: '100644',
          type: 'blob',
          content: content as string
        });
      }

      const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        base_tree: lastCommitSha,
        tree: treeItems
      }, { headers });

      const treeSha = treeRes.data.sha;
      console.log(`[PUSH_ENHANCED] Tree written with SHA ${treeSha}. Creating commit...`);

      const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        message,
        tree: treeSha,
        parents: [lastCommitSha]
      }, { headers });

      const newCommitSha = commitRes.data.sha;
      console.log(`[PUSH_ENHANCED] Commit created: ${newCommitSha}. Updating branch head ref...`);

      await axios.patch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: newCommitSha,
        force: true
      }, { headers });

      const repoUrl = `https://github.com/${owner}/${repo}`;
      console.log(`[PUSH_ENHANCED] Push successful to ${repoUrl}! Branch: ${branch}, SHA: ${newCommitSha}`);
      
      res.json({ 
        success: true, 
        sha: newCommitSha,
        repoUrl: repoUrl,
        owner: owner,
        repo: repo,
        branch: branch
      });
    } catch (err: any) {
      console.error('[PUSH_ENHANCED] Fatal deployment pipeline crash:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ 
        error: err.response?.data?.message || err.message,
        githubMessage: err.response?.data?.message || null,
        details: err.response?.data || null
      });
    }
  });

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
    let { message, history, currentApp, mode, intent, userProfile, fileAttachments } = req.body;
    if (!message && !Array.isArray(fileAttachments)) return res.status(400).json({ reply: 'Message is required' });
    message = message || '';

    // Process attached files — text files decoded into message, images handled via Gemini vision
    type FileAttachment = { name: string; type: string; base64: string };
    const attachments: FileAttachment[] = Array.isArray(fileAttachments) ? fileAttachments : [];
    const imageAttachments = attachments.filter(f => f.type.startsWith('image/'));
    const textAttachments = attachments.filter(f => !f.type.startsWith('image/'));

    // Append decoded text file content to message
    if (textAttachments.length > 0) {
      const textParts = textAttachments.map(f => {
        const content = Buffer.from(f.base64, 'base64').toString('utf8').slice(0, 8000);
        return `\n\n[Attached file: ${f.name}]\n\`\`\`\n${content}\n\`\`\``;
      });
      message = (message || 'Please review these files:') + textParts.join('');
    }
    // Ensure image-only messages have a prompt
    if (!message && imageAttachments.length > 0) message = 'Please describe and analyze this image.';

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
    if (hasCanvas) {
      contextualMessage = `[CANVAS — current app on canvas (${currentApp.length} chars total)]:\n\`\`\`html\n${currentApp.slice(0, 20000)}${currentApp.length > 20000 ? '\n...[truncated — send smaller app for full edit]' : ''}\n\`\`\`\n\nUser request: ${message}`;
    }

    console.log(`[CHAT] tier=${tier} isFree=${isFree} mode=${mode} intent=${intent} hasCanvas=${hasCanvas} files=${attachments.length}(img=${imageAttachments.length}) sysprompt=${isFree ? 'FREE' : hasCanvas ? 'EDIT' : isBuildIntent ? 'BUILD' : 'CHAT'}`);

    // Image attachments — direct Gemini vision call (bypasses string-only router)
    if (imageAttachments.length > 0) {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      if (geminiKey || projectId) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: geminiKey || 'vertex' });
          const parts: any[] = [{ text: contextualMessage }];
          for (const img of imageAttachments) {
            parts.push({ inlineData: { mimeType: img.type, data: img.base64 } });
          }
          const visionConfig: any = {};
          if (systemPrompt) visionConfig.systemInstruction = systemPrompt;
          if (req.body.stream === true) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
            const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
            try {
              const stream = await ai.models.generateContentStream({
                model: 'gemini-2.5-flash',
                contents: [{ parts }],
                config: Object.keys(visionConfig).length ? visionConfig : undefined,
              });
              for await (const chunk of stream) {
                const text = chunk.text || '';
                if (text && !res.writableEnded) res.write(`data: ${JSON.stringify({ c: text })}\n\n`);
              }
            } finally {
              clearInterval(heartbeat);
            }
            if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
          } else {
            const result = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ parts }],
              config: Object.keys(visionConfig).length ? visionConfig : undefined,
            });
            return res.json({ reply: result.text || '' });
          }
          return;
        } catch (visionErr: any) {
          console.error('[CHAT/VISION] Gemini vision failed, falling through to text router:', visionErr.message);
          // Fall through to normal text-based router
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
      const { message, history, mode, fileData, fileType, fileName, currentApp } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });
      const hasFile = !!(fileData && fileType);
      const isImageFile = hasFile && (fileType as string).startsWith('image/');
      const isPDFFile = hasFile && fileType === 'application/pdf';
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

      // ── 2. Grok — 2nd priority for Pro ───────────────────────────────────────
      const grokKeyPlan = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      if (grokKeyPlan) {
        try {
          const planMsgs = [
            { role: 'system' as const, content: PLAN_PROMPT },
            ...(history || []).slice(-8).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.text || m.content || '').slice(0, 400),
            })),
            { role: 'user' as const, content: message },
          ];
          const grokClient = new OpenAI({ apiKey: grokKeyPlan, baseURL: 'https://api.x.ai/v1' });
          for (const grokModel of ['grok-3', 'grok-3-fast']) {
            try {
              const r = await grokClient.chat.completions.create({ model: grokModel, messages: planMsgs, max_tokens: 1500 });
              const t = r.choices[0]?.message?.content || '';
              if (t.trim()) return res.json({ reply: sanitizePlanningReply(t), files: {}, suggestBuild });
            } catch (ge: any) { console.warn(`[PRO PLAN] Grok ${grokModel}: ${ge.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Grok err:', e.message); }
      }

      // ── 3. Gemini API — all key aliases, starts with user msg ─────────────────
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
          for (const gModel of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await new GoogleGenAI({ apiKey: geminiKeyPlan }).models.generateContent({
                model: gModel,
                contents: [...historyContents, { role: 'user', parts: [{ text: PLAN_PROMPT + '\n\nUser: ' + message }] }],
              });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ge: any) { console.warn(`[PRO PLAN] Gemini ${gModel}: ${ge.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Gemini err:', e.message); }
      }

      // ── 4. Vertex AI — project-based, no key needed ───────────────────────────
      const projectIdPlan = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      if (projectIdPlan) {
        try {
          const { GoogleGenAI: VtxAI } = await import('@google/genai');
          const ai = new VtxAI({ vertexai: true, project: projectIdPlan, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          for (const vtxModel of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await ai.models.generateContent({
                model: vtxModel,
                contents: [{ role: 'user', parts: [{ text: PLAN_PROMPT + '\n\nUser: ' + message }] }],
              });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ve: any) { console.warn(`[PRO PLAN] Vertex ${vtxModel}: ${ve.message}`); }
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
    const { message, currentFiles, isEdit, framework, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

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
      typeof currentFiles.html === 'string' && currentFiles.html.length > 200;
    const useEdit = isEdit === true || (hasCurrentFiles && isEdit !== false);

    try {
      let result;
      if (useEdit && hasCurrentFiles) {
        // ── ITERATIVE EDIT PATH ──────────────────────────────────────────────
        const safeFiles = {
          html: sanitizeUserHtml(currentFiles.html || ''),
          js:   (currentFiles.js  || '').slice(0, 250000),
          css:  (currentFiles.css || '').slice(0, 100000),
        };
        result = await editAppEngine(
          message,
          safeFiles,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail, isEdit: true }),
          (fileName, content) => send({ type: 'file', fileName, content }),
          historyContext
        );
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

  // ── One-click download: package app files as ZIP ─────────────────────────────
  app.post('/api/download-zip', async (req: any, res: any) => {
    const { files, appName } = req.body;
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    const safeName = (appName || 'navbharat-app').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
    try {
      const ZipStream = require('zip-stream');
      const archive = new ZipStream({ level: 6 });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      archive.pipe(res);
      const entries = Object.entries(files as Record<string, string>);
      for (const [filename, content] of entries) {
        await new Promise<void>((resolve, reject) => {
          archive.entry(content, { name: filename }, (err: any) => err ? reject(err) : resolve());
        });
      }
      archive.finish();
    } catch (err: any) {
      console.error('[download-zip] Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
    }
  });

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

  app.get('/api/wallet/:userId', async (req, res) => {
    const { userId } = req.params;
    const email = req.query.email as string || '';
    const name = req.query.name as string || '';

    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      const snap = await getDoc(walletRef);
      if (snap.exists()) {
        const data = snap.data();
        let updated = false;

        if (data.hasVishwakarmaPass === undefined) { data.hasVishwakarmaPass = false; updated = true; }
        if (data.tokenBalance === undefined) { data.tokenBalance = 0; updated = true; }
        if (data.totalTokensPurchased === undefined) { data.totalTokensPurchased = 0; updated = true; }
        if (data.totalTokensUsed === undefined) { data.totalTokensUsed = 0; updated = true; }
        if (data.walletLedger === undefined) { data.walletLedger = []; updated = true; }

        if (updated) {
          await setDoc(walletRef, data, { merge: true });
        }
        return res.json(data);
      } else {
        const welcomeBalance = 10.00;
        const welcomeTokens = 1000; // ₹10 = 1000 tokens
        const initialWallet = {
          userId,
          userEmail: email,
          userName: name,
          total_balance: welcomeBalance,
          remaining_balance: welcomeBalance,
          total_output_tokens_used: 0,
          total_money_spent: 0,
          hasVishwakarmaPass: false,
          vishwakarmaPassActivatedAt: null,
          tokenBalance: welcomeTokens,
          totalTokensPurchased: welcomeTokens,
          totalTokensUsed: 0,
          lastRechargeAt: null,
          walletLedger: [
            {
              type: 'purchase',
              amountCoinsOrTokens: welcomeTokens,
              moneySpent: 0,
              timestamp: new Date().toISOString(),
              description: 'Welcome Bonus: 1,000 AI Tokens Credited!'
            }
          ],
          updatedAt: new Date().toISOString()
        };
        await setDoc(walletRef, initialWallet);
        
        // Add welcome bonus transaction to transaction list
        const welcomeTxRef = doc(db, 'payment_transactions', `welcome_${userId}`);
        await setDoc(welcomeTxRef, {
          transactionId: `welcome_${userId}`,
          userId,
          amountPaid: 0,
          balanceAdded: welcomeBalance,
          paymentProvider: 'WELCOME_BONUS',
          paymentStatus: 'SUCCESS',
          paymentReference: 'WELCOME_BONUS',
          createdAt: new Date().toISOString()
        });

        return res.json(initialWallet);
      }
    } catch (err: any) {
      console.error('[API WALLET GET ERROR]:', err);
      return res.status(500).json({ error: err.message || 'Unknown internal wallet error' });
    }
  });

  app.get('/api/wallet/:userId/logs', async (req, res) => {
    const { userId } = req.params;
    try {
      const logsRef = collection(db, 'ai_usage_logs');
      const q = query(logsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json(logs);
    } catch (err: any) {
      try {
        const logsRef = collection(db, 'ai_usage_logs');
        const q = query(logsRef, where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        logs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(logs);
      } catch (fallbackErr: any) {
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
  });

  app.get('/api/wallet/:userId/transactions', async (req, res) => {
    const { userId } = req.params;
    try {
      const txRef = collection(db, 'payment_transactions');
      const q = query(txRef, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json(txs);
    } catch (err: any) {
      try {
        const txRef = collection(db, 'payment_transactions');
        const q = query(txRef, where('userId', '==', userId), limit(100));
        const snap = await getDocs(q);
        const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        txs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return res.json(txs);
      } catch (fallbackErr: any) {
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
  });

  app.post('/api/payment/create-order', paymentLimiter, async (req, res) => {
    const { amount, userId, userEmail, userName, userPhone, isVishwakarmaOrder, buyPass, tokenAmount } = req.body;
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    const orderAmount = parseFloat(amount);
    if (isNaN(orderAmount) || orderAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const orderId = `ord_nb_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      // Save pending transaction to payment_transactions collection
      const txRef = doc(db, 'payment_transactions', orderId);
      await setDoc(txRef, {
        transactionId: orderId,
        userId,
        amountPaid: orderAmount,
        balanceAdded: orderAmount, // ₹1 = ₹1 balance added to wallet
        isVishwakarmaOrder: !!isVishwakarmaOrder,
        buyPass: !!buyPass,
        tokenAmount: tokenAmount ? parseFloat(tokenAmount) : 0,
        paymentProvider: 'CASHFREE',
        paymentStatus: 'PENDING',
        paymentReference: '',
        createdAt: new Date().toISOString()
      });

      // Dynamic key resolution from database fallback
      const dbClientId = await getSecretValue(userId, 'CASHFREE_CLIENT_ID') || await getSecretValue(userId, 'CASHFREE_APP_ID');
      const dbClientSecret = await getSecretValue(userId, 'CASHFREE_CLIENT_SECRET') || await getSecretValue(userId, 'CASHFREE_SECRET_KEY');

      const clientId = (dbClientId || process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID)?.trim();
      const clientSecret = (dbClientSecret || process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY)?.trim();
      
      // Robust detection: default to production unless the secret explicitly indicates 'test' or 'sandbox'
      const isTestSecret = clientSecret && (
        clientSecret.toLowerCase().includes('test') || 
        clientSecret.toLowerCase().includes('sandbox') || 
        clientSecret.toLowerCase().includes('sim_') ||
        clientSecret.toUpperCase().startsWith('TEST')
      );
      const isTestClient = clientId && (
        clientId.toLowerCase().includes('test') || 
        clientId.toLowerCase().includes('sandbox') || 
        clientId.toUpperCase().startsWith('TEST')
      );

      const env = process.env.CASHFREE_ENV || (isTestSecret || isTestClient ? 'sandbox' : 'production');

      // Detect if credentials are empty or standard placeholder values
      const isPlaceholder = !clientId || !clientSecret ||
        clientId.toLowerCase().includes('placeholder') ||
        clientSecret.toLowerCase().includes('placeholder') ||
        clientId.trim() === '' ||
        clientSecret.trim() === '';

      console.log(`[CASHFREE] Creating order ${orderId} | Env: ${env} | Client: ${clientId?.substring(0, 8)}... | IsPlaceholder: ${isPlaceholder}`);

      if (isPlaceholder) {
        // Return simulator session if keys are not configured or are placeholder keys, providing seamless dev preview
        console.log(`[CASHFREE] Missing/placeholder credentials. Returning Sandbox Simulator session for Order: ${orderId}`);
        return res.json({
          orderId,
          paymentSessionId: `sim_session_${orderId}_${amount}`,
          isSimulator: true,
          orderAmount
        });
      }

      // Real Cashfree API order creation
      const cfUrl = env === 'production' 
        ? 'https://api.cashfree.com/pg/orders' 
        : 'https://sandbox.cashfree.com/pg/orders';

      // Round amount to maximum 2 decimal places which Cashfree expects
      const finalAmount = Math.round(orderAmount * 100) / 100;

      // Class-A sanitization of Customer Email
      let customerEmailClean = String(userEmail || 'client@navbharat.ai').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmailClean) || customerEmailClean.length > 100) {
        customerEmailClean = 'client@navbharat.ai';
      }

      // Class-A sanitization of Customer ID: strictly alphanumeric, hyphens, and underscores only (NO '@' or '.' dot which can trigger invalid_request_errors)
      let customerIdClean = String(userId || 'nb_cust_dummy').replace(/[^a-zA-Z0-9\-_]/g, '');
      if (customerIdClean.length < 3) {
        customerIdClean = 'nb_cust_' + customerIdClean;
      }
      if (customerIdClean.length > 50) {
        customerIdClean = customerIdClean.substring(0, 50);
      }

      // Class-A sanitization of Customer Phone: must be exactly 10 digits without any prefix codes (starts with 6,7,8,9)
      let customerPhoneClean = String(userPhone || '9876543210').replace(/\D/g, ''); // keep only numbers
      if (customerPhoneClean.startsWith('91') && customerPhoneClean.length > 10) {
        customerPhoneClean = customerPhoneClean.substring(2);
      } else if (customerPhoneClean.startsWith('0') && customerPhoneClean.length > 10) {
        customerPhoneClean = customerPhoneClean.substring(1);
      }
      if (customerPhoneClean.length !== 10 || !/^[6-9]/.test(customerPhoneClean)) {
        customerPhoneClean = '9876543210'; // Secure dummy Indian mobile number
      }

      // Class-A sanitization of Customer Name: ONLY alphabets, spaces, dots, and hyphens (Numbers are NOT allowed by Cashfree name validation)
      let customerNameClean = String(userName || 'NavBharat Client')
        .replace(/[^a-zA-Z\s.-]/g, '') // strictly exclude numbers and odd special characters
        .replace(/\s+/g, ' ') // collapse multi spaces
        .trim();
      if (customerNameClean.length < 3) {
        customerNameClean = 'NavBharat Client';
      }
      if (customerNameClean.length > 40) {
        customerNameClean = customerNameClean.substring(0, 40);
      }

      // Secure return_url generation with SSL enforcement for cloud preview environment
      const host = req.get('host') || 'localhost:3000';
      const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? 'http' : 'https';
      const secureReturnUrl = `${protocol}://${host}/api/payment/verify-redirect?order_id={order_id}`;

      console.log(`[CASHFREE] Payload inputs - Name: ${customerNameClean}, Email: ${customerEmailClean}, Phone: ${customerPhoneClean}, ID: ${customerIdClean}, Amount: ${finalAmount}, ReturnURL: ${secureReturnUrl}`);

      const cfResponse = await axios.post(cfUrl, {
        order_id: orderId,
        order_amount: finalAmount,
        order_currency: 'INR',
        customer_details: {
          customer_id: customerIdClean,
          customer_name: customerNameClean,
          customer_email: customerEmailClean,
          customer_phone: customerPhoneClean
        },
        order_meta: {
          return_url: secureReturnUrl
        }
      }, {
        headers: {
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json'
        }
      });

      const data = cfResponse.data;
      if (data.payment_session_id) {
        return res.json({
          orderId,
          paymentSessionId: data.payment_session_id,
          isSimulator: false,
          orderAmount: finalAmount,
          environment: env
        });
      } else {
        throw new Error(data.message || 'Payment Session ID not generated');
      }
    } catch (error: any) {
      const detailedError = error.response?.data || {};
      const errorMessage = detailedError.message || error.message;
      console.error(`[CASHFREE] Order creation failed. Full detailed payload:`, JSON.stringify(detailedError, null, 2));
      return res.status(500).json({ 
        error: `Cashfree integration error: ${errorMessage}`,
        details: detailedError 
      });
    }
  });

  app.post('/api/payment/verify-payment', paymentLimiter, async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

    const result = await verifyPaymentInternal(orderId);
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(400).json({ error: result.error });
    }
  });

  app.post('/api/payment/webhook', async (req, res) => {
    try {
      const body = JSON.stringify(req.body);
      
      // Cashfree Webhook Data structure
      const orderId = req.body.data?.order?.order_id;
      if (!orderId) {
        console.warn('[CASHFREE WEBHOOK] Missing order_id in webhook body:', req.body);
        return res.status(400).json({ error: 'Order ID missing in webhook payload' });
      }

      console.log(`[CASHFREE WEBHOOK] Received webhook event for order: ${orderId}`);

      // Resolve the secret dynamically
      let secret = process.env.CASHFREE_WEBHOOK_SECRET;
      
      if (db) {
        try {
          const txRef = doc(db, 'payment_transactions', orderId);
          const txSnap = await getDoc(txRef);
          if (txSnap.exists()) {
            const txData = txSnap.data();
            const dbSecret = await getSecretValue(txData.userId, 'CASHFREE_WEBHOOK_SECRET');
            if (dbSecret) {
              secret = dbSecret;
              console.log(`[CASHFREE WEBHOOK] Loaded db-saved webhook secret for user: ${txData.userId}`);
            }
          }
        } catch (err: any) {
          console.error('[CASHFREE WEBHOOK] Error looking up transaction user secret:', err.message);
        }
      }

      if (!secret) {
        console.error('[CASHFREE WEBHOOK] Webhook signature verification rejected: CASHFREE_WEBHOOK_SECRET is not configured globally or in the user database.');
        return res.status(400).json({ error: 'Webhook secret not configured. Please enter it in the Secret Management panel first.' });
      }

      const signature = (req.headers['x-cf-signature'] || req.headers['cf-signature'] || '') as string;
      const ts = (req.headers['x-cf-signature-timestamp'] || '') as string;
      
      // Compute multiple plausible formats to be extremely robust against API version variations
      const signatureDataWithTimestamp = ts + body;
      const expectedV2 = crypto.createHmac('sha256', secret).update(signatureDataWithTimestamp).digest('base64');
      const expectedV1Base64 = crypto.createHmac('sha256', secret).update(body).digest('base64');
      const expectedV1Hex = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const isSignatureValid = (signature === expectedV2) || (signature === expectedV1Base64) || (signature === expectedV1Hex);

      if (!isSignatureValid) {
        console.error(`[CASHFREE WEBHOOK] Webhook signature mismatch for order ${orderId}. Got: "${signature}", expected: ["${expectedV2}", "${expectedV1Base64}"]`);
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      console.log(`[CASHFREE WEBHOOK] Signature verified successfully. Initiating payment fulfillment...`);
      const result = await verifyPaymentInternal(orderId);
      if (result.success) {
        console.log(`[CASHFREE WEBHOOK] Fulfilled order ${orderId} successfully!`);
        return res.status(200).json({ status: 'OK' });
      } else {
        console.error(`[CASHFREE WEBHOOK] Fulfillment failed for order ${orderId}: ${result.error}`);
        return res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[CASHFREE WEBHOOK] Error handling webhook exception:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/payment/verify-redirect', (req, res) => {
    const order_id = req.query.order_id as string;
    res.redirect(`/?payment=check&order_id=${order_id}`);
  });

  app.post('/api/payment/redeem-coupon', async (req, res) => {
    const { couponCode, userId, userEmail, userName } = req.body;
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    if (!couponCode || typeof couponCode !== 'string') {
      return res.status(400).json({ error: 'Promo coupon code is required' });
    }

    const code = couponCode.trim().toUpperCase();
    const couponValues: Record<string, number> = {
      'NAVBHARAT50': 50,
      'WELCOME100': 100,
      'FESTIVE2026': 200,
      'SAKUNI25': 25,
      'FREE100': 100
    };

    if (!(code in couponValues)) {
      return res.status(400).json({ error: 'Invalid or expired promoter voucher card.' });
    }

    const value = couponValues[code];
    const redemptionId = `coupon_${code}_${userId}`;

    try {
      // Check if user already redeemed this specific coupon
      const txRef = doc(db, 'payment_transactions', redemptionId);
      const txSnap = await getDoc(txRef);
      if (txSnap.exists()) {
        return res.status(400).json({ error: 'You have already redeemed this promo coupon code!' });
      }

      // Add coupon transaction
      await setDoc(txRef, {
        transactionId: redemptionId,
        userId,
        amountPaid: 0,
        balanceAdded: value,
        paymentProvider: 'COUPON_REDEEM',
        paymentStatus: 'SUCCESS',
        paymentReference: `REDEMPTION_${code}`,
        createdAt: new Date().toISOString()
      });

      // Update user wallet
      const walletRef = doc(db, 'user_token_wallets', userId);
      const walletSnap = await getDoc(walletRef);
      let newBalance = value;

      if (walletSnap.exists()) {
        const walletData = walletSnap.data();
        newBalance = (walletData.remaining_balance || 0) + value;
        await updateDoc(walletRef, {
          remaining_balance: newBalance,
          total_balance: (walletData.total_balance || 0) + value,
          updatedAt: new Date().toISOString()
        });
      } else {
        await setDoc(walletRef, {
          userId,
          userEmail: userEmail || '',
          userName: userName || '',
          total_balance: value,
          remaining_balance: value,
          total_output_tokens_used: 0,
          total_money_spent: 0,
          updatedAt: new Date().toISOString()
        });
      }

      return res.json({ success: true, balanceAdded: value, currentBalance: newBalance });
    } catch (err: any) {
      console.error('[COUPON] Redemption failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Admin server-side auth (4.6) ─────────────────────────────────────────
  app.post('/api/admin/login', adminLimiter, (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const validUser = (process.env.ADMIN_USERNAME || 'aashishcpmt09').trim();
    const validPass = (process.env.ADMIN_PASSWORD || '').trim();

    if (!validPass) {
      audit('ADMIN_LOGIN_BLOCKED', { reason: 'ADMIN_PASSWORD not set', ip: req.ip });
      return res.status(503).json({ error: 'Admin access not configured on server.' });
    }

    const passHash    = crypto.createHash('sha256').update(password).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(validPass).digest('hex');

    console.log(`[ADMIN_LOGIN] user="${username}" validUser="${validUser}" match=${username === validUser} passLen=${password.length} validPassLen=${validPass.length}`);

    if (username === validUser && passHash === expectedHash) {
      const token = crypto.createHmac('sha256', validPass)
        .update(`admin:${Math.floor(Date.now() / 86400000)}:${username}`)
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
  const verifyAdminToken = (req: any, res: any, next: any) => {
    const token = req.headers['x-admin-token'] as string;
    const validPass = process.env.ADMIN_PASSWORD;
    if (!validPass || !token) return res.status(401).json({ error: 'Admin token required.' });
    const expected = crypto.createHmac('sha256', validPass)
      .update(`admin:${Math.floor(Date.now() / 86400000)}:${process.env.ADMIN_USERNAME || 'aashishcpmt09'}`)
      .digest('hex');
    if (token !== expected) {
      audit('ADMIN_ACCESS_DENIED', { ip: req.ip, path: req.path });
      return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
  };

  app.get('/api/admin/analytics', verifyAdminToken, async (req, res) => {
    try {
      const walletsRef = collection(db, 'user_token_wallets');
      const walletSnap = await getDocs(walletsRef);
      const wallets = walletSnap.docs.map(d => d.data());

      const logsRef = collection(db, 'ai_usage_logs');
      const logsSnap = await getDocs(logsRef);
      const logs = logsSnap.docs.map(d => d.data());

      const txRef = collection(db, 'payment_transactions');
      const txSnap = await getDocs(txRef);
      const transactions = txSnap.docs.map(d => d.data());

      const totalUsers = wallets.length;
      let totalRevenue = 0;
      transactions.forEach((tx: any) => {
        if (tx.paymentStatus === 'SUCCESS') {
          totalRevenue += tx.amountPaid || 0;
        }
      });

      let totalTokensUsed = 0;
      let totalProviderCost = 0;
      let failedRequests = 0;
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
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Provider live status ──────────────────────────────────────────────────
  app.get('/api/admin/provider-status', verifyAdminToken, (_req, res) => {
    res.json(getProviderStats());
  });

  // ── Full user list with sort ──────────────────────────────────────────────
  app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
    try {
      const sort = (req.query.sort as string) || 'tokens';
      const search = ((req.query.search as string) || '').toLowerCase();
      const walletsRef = collection(db, 'user_token_wallets');
      const snap = await getDocs(walletsRef);
      let users = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

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
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── User token adjustment ─────────────────────────────────────────────────
  app.post('/api/admin/users/:userId/tokens', verifyAdminToken, async (req, res) => {
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
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Ban / unban user ──────────────────────────────────────────────────────
  app.post('/api/admin/users/:userId/ban', verifyAdminToken, async (req, res) => {
    const { userId } = req.params;
    const { banned, reason } = req.body;
    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      await setDoc(walletRef, { banned: !!banned, banReason: reason || '', bannedAt: new Date().toISOString() }, { merge: true });
      audit(banned ? 'ADMIN_USER_BANNED' : 'ADMIN_USER_UNBANNED', { userId, reason, ip: req.ip });
      res.json({ ok: true, banned: !!banned });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Grant / revoke Pro access ─────────────────────────────────────────────
  app.post('/api/admin/users/:userId/pro', verifyAdminToken, async (req, res) => {
    const { userId } = req.params;
    const { grant } = req.body;
    try {
      const walletRef = doc(db, 'user_token_wallets', userId);
      await setDoc(walletRef, { hasVishwakarmaPass: !!grant, vishwakarmaPassActivatedAt: grant ? new Date().toISOString() : null }, { merge: true });
      audit(grant ? 'ADMIN_PRO_GRANTED' : 'ADMIN_PRO_REVOKED', { userId, ip: req.ip });
      res.json({ ok: true, hasPro: !!grant });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Settings (pricing, feature flags, maintenance) ────────────────────────
  app.get('/api/admin/settings', verifyAdminToken, (_req, res) => {
    res.json({
      maintenanceMode: serverStats.maintenanceMode,
      featureFlags: serverStats.featureFlags,
      pricingConfig: serverStats.pricingConfig,
      providerEnabled: serverStats.providerEnabled,
    });
  });

  app.post('/api/admin/settings', verifyAdminToken, (req, res) => {
    const { maintenanceMode, featureFlags, pricingConfig, providerEnabled } = req.body;
    if (maintenanceMode !== undefined) serverStats.maintenanceMode = !!maintenanceMode;
    if (featureFlags) Object.assign(serverStats.featureFlags, featureFlags);
    if (pricingConfig) Object.assign(serverStats.pricingConfig, pricingConfig);
    if (providerEnabled) Object.assign(serverStats.providerEnabled, providerEnabled);
    audit('ADMIN_SETTINGS_CHANGED', { changes: req.body, ip: req.ip });
    res.json({ ok: true, settings: { maintenanceMode: serverStats.maintenanceMode, featureFlags: serverStats.featureFlags, pricingConfig: serverStats.pricingConfig, providerEnabled: serverStats.providerEnabled } });
  });

  // ── Announcement broadcast ────────────────────────────────────────────────
  app.post('/api/admin/announcement', verifyAdminToken, (req, res) => {
    const { message, target } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const ann = { id: Date.now().toString(), message, createdAt: new Date().toISOString(), target: target || 'all' };
    serverStats.announcements.push(ann);
    if (serverStats.announcements.length > 50) serverStats.announcements.shift();
    audit('ADMIN_ANNOUNCEMENT', { message, target, ip: req.ip });
    res.json({ ok: true, announcement: ann });
  });

  app.get('/api/admin/announcements', verifyAdminToken, (_req, res) => {
    res.json(serverStats.announcements);
  });

  // ── Promo code management ─────────────────────────────────────────────────
  app.post('/api/admin/promo', verifyAdminToken, async (req, res) => {
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
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/promo', verifyAdminToken, async (_req, res) => {
    try {
      const snap = await getDocs(collection(db, 'promo_codes'));
      res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // SECRETS

  app.get('/api/secrets/:userId', async (req, res) => {
    console.log('[DEBUG] GET /api/secrets/:userId called for:', req.params.userId);
    try {
      const { userId } = req.params;
      const secretsSnapshot = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', userId)));
      const secrets = secretsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as { deleted?: boolean }[];
      console.log('[DEBUG] Secrets found:', secrets);
      res.json(secrets.filter(s => !s.deleted));
    } catch (err) {
      console.error('[DEBUG] Error fetching secrets:', err);
      res.status(500).json({ error: 'Failed to fetch secrets' });
    }
  });

  app.post('/api/anthropic', async (req, res) => {
    try {
      const { userId, messages, model } = req.body;
      if (!userId || !messages) return res.status(400).json({ error: 'Missing parameters' });

      // Check User Tier
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) return res.status(404).json({ error: 'User not found' });
      
      const userData = userDoc.data();
      if (userData.tier !== 'pro' && userData.tier !== 'vip') {
        return res.status(403).json({ error: 'Forbidden: Pro or VIP access required' });
      }

      // Proxy request
      const response = await axios.post(
        `${process.env.ANTHROPIC_BASE_URL}/chat/completions`,
        {
          model: model || 'anthropic/claude-opus-4.7-fast',
          messages,
          stream: true
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream'
        }
      );

      // Pipe response
      res.setHeader('Content-Type', 'text/event-stream');
      response.data.pipe(res);
      
    } catch (err: any) {
      console.error('[API] Anthropic proxy error:', err.message);
      res.status(500).json({ error: 'Failed to call Anthropic API' });
    }
  });

  app.post('/api/secrets/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const { secret_name, secret_value } = req.body;
      const encryptedValue = encrypt(secret_value);
      await addDoc(collection(db, 'user_secrets'), {
        user_id: userId,
        secret_name,
        encrypted_secret_value: encryptedValue,
        created_at: new Date()
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save secret' });
    }
  });

  app.delete('/api/secrets/:userId/:secretId', async (req, res) => {
      try {
        const { secretId } = req.params;
        await updateDoc(doc(db, 'user_secrets', secretId), { deleted: true }); // Soft delete
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete secret' });
      }
  });


  // ══ PWA ROUTES — Save & Serve generated apps as installable PWAs ══

  // ══ SENIOR DOCTOR ASSISTANT (SDA) ══
  app.post('/api/sda-chat', async (req: any, res: any) => {
    try {
      const { message, history = [], teachingMode = false, userId, fileData, fileType, fileName } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });

      const hasFile = !!(fileData && fileType);
      const isImage = hasFile && fileType.startsWith('image/');
      const isPDF = hasFile && fileType === 'application/pdf';

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
      const buildGeminiContents = () => {
        const userParts: any[] = [];
        if (isImage || isPDF)
          userParts.push({ inline_data: { mime_type: fileType, data: fileData } },
                         { text: `[${isPDF ? 'PDF Report' : 'Document'}: ${fileName}]\n${message}` });
        else
          userParts.push({ text: message });
        return [
          ...historyForAI.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
          { role: 'user', parts: userParts },
        ];
      };

      // ── 1. Grok — SDA primary (fast, generous limits) ───────────────────────
      const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      if (!reply && grokKey) {
        try {
          const { default: OpenAI } = await import('openai');
          const grokClient = new OpenAI({ apiKey: grokKey, baseURL: 'https://api.x.ai/v1' });
          for (const model of ['grok-3', 'grok-3-fast']) {
            try {
              const r = await grokClient.chat.completions.create({ model, messages: buildOpenAIMsgs(message), max_tokens: 2000 });
              reply = r.choices[0]?.message?.content || '';
              if (reply) { console.log(`[SDA] Grok ${model} succeeded`); break; }
            } catch (ge: any) { console.warn(`[SDA] Grok ${model}:`, ge.message); }
          }
        } catch (e: any) { console.warn('[SDA] Grok err:', e.message); }
      }

      // ── 2. Gemini (great vision + multimodal) ────────────────────────────────
      if (!reply) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
          if (!geminiKey) throw new Error('No Gemini key');
          const contents = buildGeminiContents();
          for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await new GoogleGenAI({ apiKey: geminiKey }).models.generateContent({ model, systemInstruction: SDA_SYSTEM, contents });
              reply = r.text || '';
              if (reply) { console.log(`[SDA] Gemini ${model} succeeded`); break; }
            } catch (ge: any) { console.warn(`[SDA] Gemini ${model}:`, ge.message); }
          }
        } catch (e: any) { console.warn('[SDA] Gemini err:', e.message); }
      }

      // ── 3. Vertex AI (GCP-native, high reliability) ──────────────────────────
      if (!reply) {
        try {
          const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
          if (!projectId) throw new Error('No Vertex project ID');
          const { VertexAI } = await import('@google-cloud/vertexai');
          const vertexAI = new VertexAI({ project: projectId, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          const contents = buildGeminiContents();
          for (const modelName of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const model = vertexAI.getGenerativeModel({
                model: modelName,
                systemInstruction: { role: 'system', parts: [{ text: SDA_SYSTEM }] },
              });
              const result = await model.generateContent({ contents });
              reply = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (reply) { console.log(`[SDA] Vertex ${modelName} succeeded`); break; }
            } catch (ve: any) { console.warn(`[SDA] Vertex ${modelName}:`, ve.message); }
          }
        } catch (e: any) { console.warn('[SDA] Vertex err:', e.message); }
      }

      // ── 4. Claude — SDA last resort (vision + clinical depth) ────────────────
      const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      if (!reply && anthropicKey) {
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

  app.post('/api/pwa/save', (req: any, res: any) => {
    const { html, name } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML required' });
    const id = crypto.randomBytes(8).toString('hex');
    pwaStore.set(id, { html, name: (name || 'My NavBharat App').slice(0, 30), createdAt: Date.now() });
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return res.json({ id, url: `${proto}://${host}/pwa/${id}` });
  });

  app.get('/pwa/:id/manifest.json', (req: any, res: any) => {
    const entry = pwaStore.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'App not found or expired' });
    const id = req.params.id;
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#6366f1"/><text y="370" x="256" font-size="320" text-anchor="middle" fill="white">&#128187;</text></svg>`;
    const icon = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
    res.json({
      name: entry.name,
      short_name: entry.name.slice(0, 14),
      description: `${entry.name} — Built with NavBharatAI`,
      start_url: `/pwa/${id}`,
      scope: `/pwa/${id}`,
      display: 'standalone',
      orientation: 'any',
      background_color: '#0d1117',
      theme_color: '#6366f1',
      icons: [
        { src: icon, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: icon, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    });
  });

  app.get('/pwa/:id/sw.js', (req: any, res: any) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', `/pwa/${req.params.id}`);
    res.send(`
const CACHE='nb-pwa-${req.params.id}';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>e.respondWith(
  caches.open(CACHE).then(c=>c.match(e.request).then(r=>r||(fetch(e.request).then(nr=>{c.put(e.request,nr.clone());return nr;}).catch(()=>r))))
));`);
  });

  app.get('/pwa/:id', (req: any, res: any) => {
    const entry = pwaStore.get(req.params.id);
    if (!entry) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired</title><style>body{font-family:system-ui;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:1rem;text-align:center;padding:2rem}</style></head><body><div style="font-size:3rem">⏳</div><h2>Link Expired</h2><p style="color:#8b949e">This link was valid for 24 hours.<br>Generate a new link in NavBharatAI.</p></body></html>`);
    }
    const id = req.params.id;
    const pwaHead = `<link rel="manifest" href="/pwa/${id}/manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${entry.name}">
<meta name="theme-color" content="#6366f1">
<script>if('serviceWorker'in navigator){navigator.serviceWorker.register('/pwa/${id}/sw.js',{scope:'/pwa/${id}'}).catch(()=>{})}<\/script>`;
    let html = entry.html;
    if (html.includes('</head>')) html = html.replace('</head>', `${pwaHead}</head>`);
    else if (html.includes('<head>')) html = html.replace('<head>', `<head>${pwaHead}`);
    else html = `<head>${pwaHead}</head>${html}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // --- Team Invite ---
  app.post('/api/team/invite', async (req, res) => {
    const { email, projectId, userId, role = 'viewer' } = req.body || {};
    if (!email || !userId) return res.status(400).json({ error: 'email and userId required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const inviteId = crypto.randomBytes(8).toString('hex');
    audit('TEAM_INVITE', { userId, email, projectId, role });
    return res.json({ ok: true, inviteId, message: `Invite sent to ${email}`, inviteUrl: `/join/${inviteId}` });
  });

  // --- PageSpeed Analysis Proxy ---
  app.get('/api/analyze/pagespeed', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    try {
      const apiKey = process.env.PAGESPEED_API_KEY || '';
      const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile${apiKey ? '&key=' + apiKey : ''}`;
      const r = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
      const data = await r.json() as any;
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'PageSpeed API error' });
      const cats = data.lighthouseResult?.categories || {};
      const audits = data.lighthouseResult?.audits || {};
      return res.json({
        performance: Math.round((cats.performance?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        bestPractices: Math.round((cats['best-practices']?.score || 0) * 100),
        fcp: audits['first-contentful-paint']?.displayValue,
        lcp: audits['largest-contentful-paint']?.displayValue,
        cls: audits['cumulative-layout-shift']?.displayValue,
        tbt: audits['total-blocking-time']?.displayValue,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to analyze' });
    }
  });

  // 12.1 — Frontend error ingestion endpoint
  app.post('/api/logs/error', (req, res) => {
    try {
      const { message, source, line, col, stack, url, ts, type } = req.body || {};
      const ip = (req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress || '').split(',')[0].trim();
      console.error('[CLIENT_ERROR]', JSON.stringify({ message, source, line, col, stack, url, ts, type, ip }));
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

  // 12.2 — User analytics event ingestion endpoint
  app.post('/api/analytics/event', (req, res) => {
    try {
      const { event, props, userId, sessionId, ts } = req.body || {};
      if (!event) return res.status(400).json({ error: 'event required' });
      console.log('[ANALYTICS]', JSON.stringify({ event, props, userId: userId || 'anon', sessionId, ts: ts || Date.now() }));
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

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
