// P3.3 — Scalability/HA: a real keep-warm endpoint.
//
// `GET /api/warm` pre-initializes the EXPENSIVE lazy singletons that otherwise make the
// FIRST real user request after a cold start slow — especially the PRO and SDA/professional
// universes. It is designed to be hit periodically by an external Cloud Scheduler job (see
// docs/SCALABILITY.md), which keeps a Cloud Run instance warm while still allowing
// `min-instances=0` (no idle billing). An in-app self-ping would be WRONG: with
// min-instances=0 it would keep an instance alive 24/7 (defeating the budget) and still
// not help the truly-cold first request — the external scheduler is the correct mechanism.
//
// HARD RULE (constitution): warming constructs CLIENT OBJECTS only — it NEVER makes a real
// billed model call (no Anthropic/Vertex/Gemini "ping"), which would spend NavBharatAI's own
// account on warm-only traffic. Every step is best-effort and the handler ALWAYS returns 200
// (a warm endpoint that 500s makes Cloud Scheduler retry/alert noisily). Per-step failures are
// reported honestly — never faked.

import type { Express, Request, Response } from 'express';
import { AIRouterManager } from '../AI/AIRouterManager';
import { retrieveClinicalKnowledge, formatKnowledgeForPrompt } from '../lib/clinical/knowledgeBase';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import { getGemini } from '../lib/aiClients';
import { userCostStore } from '../lib/UserCostStore';
import { providerStateStore } from '../AgentV3/ProviderStateStore';
import { logStore } from '../lib/logStore';
import { metricsStore } from '../lib/metricsStore';
import { isServerReady } from './health';

export interface WarmStep { step: string; ok: boolean; ms: number; error?: string }
export interface WarmReport {
  warm: true;
  serverReady: boolean;
  uptimeSec: number;
  totalMs: number;
  steps: WarmStep[];
  okCount: number;
  failCount: number;
}

/** Run one warm step, timing it; NEVER throws — a thrown step is reported as ok:false. */
export async function warmStep(step: string, fn: () => unknown | Promise<unknown>): Promise<WarmStep> {
  const t0 = Date.now();
  try {
    await fn();
    return { step, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { step, ok: false, ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * Pre-warm the expensive lazy singletons. Steps run concurrently; each is independently
 * guarded so one failure never blocks the rest. Returns an honest per-step report.
 */
export async function runWarmup(): Promise<WarmReport> {
  const t0 = Date.now();
  const steps = await Promise.all([
    // AI router universes — synchronous build + env-only health (no network, no billing).
    warmStep('router:free', () => AIRouterManager.getRouter('free')),
    warmStep('router:pro', () => AIRouterManager.getRouter('pro')),
    warmStep('router:professional', () => AIRouterManager.getRouter('professional')),
    warmStep('health:free', () => AIRouterManager.getRouter('free').hasHealthyProvider()),
    warmStep('health:pro', () => AIRouterManager.getRouter('pro').hasHealthyProvider()),
    warmStep('health:professional', () => AIRouterManager.getRouter('professional').hasHealthyProvider()),
    // SDA/professional first-request cost: clinical knowledge base + app-context index.
    warmStep('clinicalKB', () => formatKnowledgeForPrompt(retrieveClinicalKnowledge('warmup'))),
    warmStep('appContext:sda', () => AppContextInjector.getRelevantContext('warmup', 'sda_chat')),
    // Gemini SDK singleton (module-cached client; no network at construction).
    warmStep('gemini:singleton', () => getGemini()),
    // Firestore singletons — one read pays the admin client init; the rest come back warm.
    warmStep('firestore:userCost', () => userCostStore.get('__warmup__')),
    warmStep('firestore:providerState', () => providerStateStore.get('__warmup__', 'netlify')),
    warmStep('firestore:logStore', () => logStore.query({ limit: 1 })),
    warmStep('firestore:metrics', () => metricsStore.list(1)),
  ]);
  const okCount = steps.filter((s) => s.ok).length;
  return {
    warm: true,
    serverReady: isServerReady(),
    uptimeSec: Math.round(process.uptime()),
    totalMs: Date.now() - t0,
    steps,
    okCount,
    failCount: steps.length - okCount,
  };
}

export function registerWarmRoute(app: Express): void {
  app.get('/api/warm', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.status(200).json(await runWarmup());
    } catch (e) {
      // Defensive: the handler must ALWAYS return 200 so the scheduler doesn't alert.
      res.status(200).json({
        warm: true, serverReady: isServerReady(), uptimeSec: Math.round(process.uptime()),
        totalMs: 0, steps: [], okCount: 0, failCount: 0, error: String((e as Error)?.message ?? e).slice(0, 200),
      });
    }
  });
}
