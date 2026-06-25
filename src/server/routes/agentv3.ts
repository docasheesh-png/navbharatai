import type { Express, Request, Response } from 'express';
import { buildRateLimiter } from '../lib/authMiddleware';
import {
  isAgentV3Enabled,
  agentV3Status,
  AgentEventStream,
  WorkspaceState,
  ToolDispatcher,
  ClaudeClient,
  sanitizeApiKey,
  AgentRunner,
  catalogForTools,
  roleConfig,
  makeSubAgentSpawn,
  makeSecondOpinion,
  makeConsensus,
  type OpinionRouter,
  resolveModel,
  architectSystemPrompt,
  planSystemPrompt,
  editModePrefix,
  awaitApproval,
  resolveApproval,
  GitManager,
  registerSession,
  restoreSession,
  agentLifecycle,
  getWorkspaceMemory,
  warmIndexFiles,
  reflectOnBuild,
  reflectionNote,
  summarizeProject,
  formatRecalledLessons,
  detectLanguageHint,
  classifyIntent,
} from '../AgentV3';
import { randomUUID } from 'crypto';
import {
  InMemoryConversationStore,
  deriveTitle,
  type ConversationStore,
} from '../AgentV3/ConversationStore';
import { FirestoreConversationStore } from '../AgentV3/FirestoreConversationStore';
import type { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../EngineerAI/actuators/DockerActuator';
import { userCostStore } from '../lib/UserCostStore';
import { usdInrRate } from '../lib/UsdInrRate';
import { makeResilientTurnRunner } from './agentv3Resilient';
import { GoogleGenAI } from '@google/genai';
import { GeminiToolRunner, type GeminiGenAiClient } from '../AgentV3/providers/GeminiToolRunner';
import { makeMultiProviderTurnRunner, type NamedRunner } from '../AgentV3/providers/MultiProviderTurnRunner';
import type { TurnRunner } from '../AgentV3/ClaudeClient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { planAnalysisSummary } from '../AgentV3/PlanIntelligence';
import { collectWorkspaceFiles, writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { CREATOR_IDENTITY } from '../lib/prompts';
import { classifyIntentSmart } from '../AgentV3/IntentClassifier';
import { decidePlanning } from '../AgentV3/ComplexityClassifier';
import { reviewBuild, formatReview } from '../AgentV3/ReviewerAgent';
import {
  saveWorkspaceMemory,
  restoreWorkspaceMemory,
} from '../AgentV3/FirestoreWorkspaceMemoryStore';
import { VertexProvider } from '../AI/Router/providers/VertexProvider';
import { GeminiProvider } from '../AI/Router/providers/GeminiProvider';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';

/**
 * AgentV3 (Vargen 3.0) routes.
 *
 * Flag-gated (AGENTV3_ENABLED, default OFF) + allowlist (admin-only now → all
 * logged-in users at GA, D8). The AgentV3 *module* imports nothing from the live
 * Pro/Engineer agent loops; this route is the composition root that wires the
 * v3.0 engine to the shared sandbox actuator (reused infra, not the live loop).
 *
 * POST /api/agentv3/chat streams the build as NDJSON: one AgentEvent per line
 * (tool_call / tool_result / file_changed / diff / todo_updated / narration /
 * done), then a final {type:'result',...}. Honest throughout — failures and
 * budget/step stops are reported as-is, never a fake success.
 */

/**
 * Hybrid sandbox selection (D4): E2B for real builds, Docker/Local fallbacks.
 *
 * Cached as a process-level singleton so the actuator's per-workspace sandbox map
 * survives across requests — that is what lets consecutive messages in the same
 * session reuse the SAME sandbox (and its files, node_modules and dev server),
 * enabling iterative building ("add a login page" after "build a todo app").
 */
let sharedActuator: IEngineerActuator | null = null;
function buildActuator(): IEngineerActuator {
  if (sharedActuator) return sharedActuator;
  if (process.env.E2B_API_KEY) sharedActuator = new E2BActuator();
  else if (process.env.DOCKER_ENABLED === 'true') sharedActuator = new DockerActuator();
  else sharedActuator = new LocalActuator();
  return sharedActuator;
}

// ── Conversation persistence (D7) ──────────────────────────────────────────────
let sharedConversationStore: ConversationStore | null = null;
/**
 * The durable transcript store: Firestore when explicitly enabled (real cross-instance
 * durability in Cloud Run), otherwise the in-memory store (dev/CI, and a safe default so a
 * missing-credentials environment never errors). Singleton. Gated on AGENTV3_PERSIST_FIRESTORE
 * so CI/local stay on the in-memory store, matching the cautious v3.0 flag-gating.
 */
function getConversationStore(): ConversationStore {
  if (sharedConversationStore) return sharedConversationStore;
  if (process.env.AGENTV3_PERSIST_FIRESTORE === 'true') {
    try {
      sharedConversationStore = new FirestoreConversationStore();
    } catch {
      sharedConversationStore = new InMemoryConversationStore();
    }
  } else {
    sharedConversationStore = new InMemoryConversationStore();
  }
  return sharedConversationStore;
}

/**
 * Access decision for fetching a single conversation. PURE & testable: a build is only
 * readable by the user who owns it (no userId, or a mismatch, is forbidden).
 */
export function conversationAccess(
  rec: { userId: string } | null,
  userId: string | null,
): 'ok' | 'not-found' | 'forbidden' {
  if (!rec) return 'not-found';
  if (!userId || rec.userId !== userId) return 'forbidden';
  return 'ok';
}

/** A client-supplied session id must be a safe, bounded token (it becomes part of
 *  the workspace id, which is interpolated into sandbox paths/commands). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Derive the workspace id for a request. A stable `sessionId` → a stable workspace
 * (reused across messages = iterative building). No/invalid sessionId → a fresh,
 * timestamped one-shot workspace (the previous behaviour).
 */
export function deriveWorkspaceId(userId: string | null, sessionId: unknown): string {
  const uid = userId && /^[A-Za-z0-9_-]{1,64}$/.test(userId) ? userId : 'anon';
  if (typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)) {
    return `agentv3-${uid}-${sessionId}`;
  }
  return `agentv3-${uid}-${Date.now()}`;
}

function maxBuildBudgetUsd(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 25;
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

// ── TEMPORARY DEBUG (admin test) ────────────────────────────────────────────────
// When AGENTV3_DEBUG_PROVIDER is enabled, every v3.0 reply is tagged with the
// provider/model that produced it, so the admin can verify WHERE each reply came
// from (e.g. confirm Vertex is answering). It is OFF by default, so users never see
// it; turn it ON by setting the env var on Cloud Run, and OFF again by unsetting it —
// no code change, no leak. Remove this helper and its call sites once testing is done.
function isProviderDebugOn(): boolean {
  const v = process.env.AGENTV3_DEBUG_PROVIDER;
  return v === '1' || v === 'true';
}
export function providerDebugTag(label: string): string {
  return isProviderDebugOn() && label ? `\n\n_[debug · replied via ${label}]_` : '';
}

/** One concurrent build per account — guards against runaway cost / abuse. */
const activeBuilds = new Set<string>();
const MAX_PROMPT_LEN = 20_000;

// ── Resumable / stoppable builds ────────────────────────────────────────────────
// A running BUILD's events are buffered and fanned out to subscribers, so the user can
// (a) RE-ATTACH to a build whose original connection was lost ("Resume"), and
// (b) actually STOP it server-side ("Stop") — not just abort their own local fetch.
interface BuildSubscriber { write: (e: unknown) => void; end: () => void; }
interface RunningBuild {
  abort: AbortController;
  buffer: unknown[];
  subscribers: Set<BuildSubscriber>;
  ended: boolean;
  startedTs: number;
}
const runningBuilds = new Map<string, RunningBuild>();
const MAX_BUILD_BUFFER = 4000;

/** Push an event into a build's replay buffer and fan it out to every subscriber. */
function broadcastBuild(rb: RunningBuild, e: unknown): void {
  if (rb.buffer.length < MAX_BUILD_BUFFER) rb.buffer.push(e);
  for (const s of rb.subscribers) { try { s.write(e); } catch { /* drop a dead subscriber */ } }
}
/** End every subscriber stream for a finished/stopped build. */
function endBuild(rb: RunningBuild): void {
  rb.ended = true;
  for (const s of rb.subscribers) { try { s.end(); } catch { /* already closed */ } }
  rb.subscribers.clear();
}
/** Is a build currently running for this account? */
function isBuildRunning(buildKey: string): boolean {
  const rb = runningBuilds.get(buildKey);
  return !!rb && !rb.ended;
}

/**
 * The v3.0 BUILD turn-runner. Multi-provider cost-routing: the cheap function-calling
 * builders (Vertex → Gemini, REAL tool-use) take each turn first, with Claude as the
 * guaranteed backstop — so builds keep WORKING (and NavBharatAI's Claude cost stays
 * minimal) even when Claude is throttled or out of credits. Set
 * AGENTV3_BUILD_CLAUDE_FIRST=1 to prefer Claude (with Vertex/Gemini as the fallback);
 * if no Gemini/Vertex provider is configured, falls back to the Claude-only resilient
 * runner. Build models are env-overridable (AGENTV3_{VERTEX,GEMINI}_BUILD_MODEL).
 */
function buildTurnRunner(): TurnRunner {
  const buildModel = (envName: string): string =>
    process.env[envName] || process.env.AGENTV3_BUILD_MODEL || 'gemini-2.5-pro';
  const cheap: NamedRunner[] = [];
  // Vertex (function-calling, via the Cloud Run service account / ADC).
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (project) {
    try {
      const vertex = new GoogleGenAI({ vertexai: true, project, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
      cheap.push({ name: 'VERTEX', runner: new GeminiToolRunner(vertex as unknown as GeminiGenAiClient, { model: buildModel('AGENTV3_VERTEX_BUILD_MODEL') }) });
    } catch { /* not constructable in this env — skip */ }
  }
  // Gemini direct (GEMINI_API_KEY).
  if (process.env.GEMINI_API_KEY) {
    try {
      const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      cheap.push({ name: 'GEMINI', runner: new GeminiToolRunner(gemini as unknown as GeminiGenAiClient, { model: buildModel('AGENTV3_GEMINI_BUILD_MODEL') }) });
    } catch { /* skip */ }
  }
  if (cheap.length === 0) return makeResilientTurnRunner(new ClaudeClient()); // Claude-only env
  const claude: NamedRunner = { name: 'CLAUDE', runner: new ClaudeClient() };
  const chain = process.env.AGENTV3_BUILD_CLAUDE_FIRST === '1' ? [claude, ...cheap] : [...cheap, claude];
  return makeMultiProviderTurnRunner(chain, {
    onProviderUsed: (used, from) => { if (from.length) console.log(`[AGENTV3] build turn via ${used} (after ${from.join(' → ')})`); },
    onProviderError: (name, err) => console.log(`[AGENTV3] build ${name} failed: ${err instanceof Error ? err.message : String(err)}`),
  });
}

/**
 * Non-secret diagnosis of the Claude provider configuration. Surfaces ONLY what
 * is needed to tell whether the wrong key is set — never the secret itself. The
 * key prefix (e.g. "sk-ant-") is a public scheme marker, not sensitive; if it is
 * anything other than "sk-ant-" the configured ANTHROPIC_API_KEY is not a real
 * Anthropic key (e.g. a leftover proxy key), which is why direct calls 401 and
 * the engine silently falls back to Vertex/Gemini/Grok.
 */
export function agentV3KeyDiag(): {
  anthropicKeySet: boolean;
  anthropicKeyPrefix: string | null;
  anthropicKeyLength: number;
  looksLikeAnthropicKey: boolean;
  keyHadSurroundingWhitespaceOrQuotes: boolean;
  agentv3OverrideBaseUrlSet: boolean;
  sharedProxyBaseUrlSet: boolean;
  sonnetModel: string;
  opusModel: string;
  // FREE-router (cheap chat) provider configuration — presence only, never values.
  // If all three are false on live, a plain "hi" cannot be answered cheaply and the
  // request falls through to the heavy build loop (a known "Load failed" trigger).
  vertexConfigured: boolean;
  geminiKeySet: boolean;
  grokKeySet: boolean;
} {
  const raw = process.env.ANTHROPIC_API_KEY ?? '';
  const key = sanitizeApiKey(raw) ?? '';
  return {
    anthropicKeySet: key.length > 0,
    anthropicKeyPrefix: key ? key.slice(0, 7) : null,
    anthropicKeyLength: key.length,
    looksLikeAnthropicKey: key.startsWith('sk-ant-'),
    // If the raw value differed from the sanitized one, the key in Cloud Run had
    // stray whitespace/quotes — a common cause of a 401 on an otherwise valid key.
    keyHadSurroundingWhitespaceOrQuotes: raw.length > 0 && raw !== key,
    agentv3OverrideBaseUrlSet: !!process.env.AGENTV3_ANTHROPIC_BASE_URL,
    sharedProxyBaseUrlSet: !!process.env.ANTHROPIC_BASE_URL,
    sonnetModel: resolveModel(false),
    opusModel: resolveModel(true),
    vertexConfigured: !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID),
    geminiKeySet: !!process.env.GEMINI_API_KEY,
    grokKeySet: !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY),
  };
}

/**
 * Live health probe of the FREE-router providers (Vertex / Gemini / Grok). Makes
 * one tiny real call per provider and reports ok/error for each, so an admin can
 * tell — on the live environment — whether Vertex and Gemini are actually WORKING
 * (not merely configured). Each provider failure is caught and reported, never
 * thrown. Admin-only (real calls cost money).
 */
async function probeFreeProviders(): Promise<Array<{ name: string; ok: boolean; latencyMs?: number; error?: string }>> {
  const factories: Array<{ name: string; make: () => { execute: (p: string, s?: unknown, m?: string, sys?: string) => Promise<{ content: string; latencyMs: number }> } }> = [
    { name: 'VERTEX', make: () => new VertexProvider() },
    { name: 'GEMINI', make: () => new GeminiProvider() },
    { name: 'GROK', make: () => new GrokProvider() },
  ];
  const results: Array<{ name: string; ok: boolean; latencyMs?: number; error?: string }> = [];
  for (const f of factories) {
    try {
      const provider = f.make();
      const r = await provider.execute('Reply with exactly one word: pong', undefined, undefined, 'You are a health check. Reply with a single word.');
      results.push({ name: f.name, ok: !!r.content, latencyMs: r.latencyMs });
    } catch (err) {
      const e = err as { message?: string };
      results.push({ name: f.name, ok: false, error: (e?.message ? String(e.message) : String(err)).slice(0, 300) });
    }
  }
  return results;
}

/** Throttle the public live-probe so it can't be abused for cost (one per 30s). */
let lastDiagProbeTs = 0;

export function registerAgentV3Routes(app: Express): void {
  // Capability probe — lets the frontend decide whether to show the v3.0 toggle.
  app.get('/api/agentv3/status', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    // buildRunning lets the UI detect an orphaned build (started elsewhere / lost its
    // connection) and offer "Resume" + "Stop".
    res.json({ enabled: isAgentV3Enabled(userId, email), buildRunning: isBuildRunning(userId ?? 'anon'), ...agentV3Status(), team: agentLifecycle.snapshot() });
  });

  // D7 — list a user's persisted builds (most-recently-updated first) so the client can
  // reload one after a refresh/reconnect. Metadata only (no transcript) for a cheap list.
  app.get('/api/agentv3/conversations', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }
    try {
      const list = await getConversationStore().listByUser(userId, 50);
      res.json({
        conversations: list.map((c) => ({
          id: c.id, title: c.title, status: c.status, workspaceId: c.workspaceId,
          billedUsd: c.billedUsd, createdAt: c.createdAt, updatedAt: c.updatedAt,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // D7 — load one persisted build (full transcript) for resume. Owner-only.
  app.get('/api/agentv3/conversations/:id', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    try {
      const rec = await getConversationStore().get(req.params.id);
      const access = conversationAccess(rec, userId);
      if (access === 'not-found') {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      if (access === 'forbidden') {
        res.status(403).json({ error: 'This build belongs to another account.' });
        return;
      }
      res.json({ conversation: rec });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Provider diagnosis — confirms whether a real Anthropic key is configured.
  // Returns no secrets (only the public "sk-ant-" scheme prefix + lengths), so a
  // wrong/leftover key is visible without exposing it. Optional ?test=1 makes one
  // tiny real Claude call and reports the exact outcome (success or the precise
  // error), gated by the admin password so it can't be abused for cost.
  app.get('/api/agentv3/diag', async (req: Request, res: Response) => {
    const diag = agentV3KeyDiag();
    const wantsTest = req.query.test === '1';
    const adminOk =
      !!process.env.ADMIN_PASSWORD && req.query.admin === process.env.ADMIN_PASSWORD;
    // The live probe makes ONE tiny real Claude call. Admins can run it anytime;
    // otherwise it's throttled to one every 30s globally so it can't be abused.
    const now = Date.now();
    const throttled = now - lastDiagProbeTs < 30_000;
    if (!wantsTest) {
      res.json(diag);
      return;
    }
    if (!adminOk && throttled) {
      res.json({ ...diag, live: { ok: false, error: 'Live probe is throttled — try again in ~30s.' } });
      return;
    }
    lastDiagProbeTs = now;
    // Live probe: one minimal, real Claude call to surface the exact error.
    let live: { ok: boolean; model?: string; error?: string; status?: number };
    try {
      const client = new ClaudeClient();
      const turn = await client.runTurn({
        model: resolveModel(false),
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 16,
        cache: false,
      });
      live = { ok: true, model: resolveModel(false), error: turn.text ? undefined : 'empty response' };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      live = { ok: false, status: e?.status, error: e?.message ? String(e.message).slice(0, 300) : String(err).slice(0, 300) };
    }
    // Admin-only: also probe the FREE-router providers (Vertex / Gemini / Grok) with
    // one tiny real call each, so the admin sees which of them actually WORK on live.
    const freeProviders = adminOk ? await probeFreeProviders() : undefined;
    res.json({ ...diag, live, freeProviders });
  });

  // Approve/reject a pending gate (plan mode / permission prompt, P4).
  app.post('/api/agentv3/respond', (req: Request, res: Response) => {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
    const approved = req.body?.approved === true;
    if (!requestId) {
      res.status(400).json({ error: 'requestId is required.' });
      return;
    }
    res.json({ ok: resolveApproval(requestId, approved) });
  });

  // Stop the running build for this account — aborts the agent loop (between turns),
  // ends every attached stream, and frees the slot so a fresh build can start.
  app.post('/api/agentv3/stop', (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const buildKey = userId ?? 'anon';
    const rb = runningBuilds.get(buildKey);
    const wasRunning = !!rb && !rb.ended;
    if (rb) {
      rb.abort.abort();                                         // loop stops between turns
      endBuild(rb);                                             // close all attached streams now
      if (runningBuilds.get(buildKey) === rb) runningBuilds.delete(buildKey);
    }
    activeBuilds.delete(buildKey);                              // unblock a fresh start immediately
    res.json({ stopped: wasRunning });
  });

  // Resume: re-attach to a running build whose original connection was lost. Replays the
  // buffered events so the UI catches up, then streams live ones — same NDJSON contract.
  app.post('/api/agentv3/attach', (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const buildKey = userId ?? 'anon';
    const rb = runningBuilds.get(buildKey);
    if (!rb || rb.ended) {
      res.status(404).json({ error: 'No running build to resume.' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sub: BuildSubscriber = {
      write: (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n'); },
      end: () => { if (!res.writableEnded) res.end(); },
    };
    for (const e of rb.buffer) sub.write(e);                   // replay so the UI catches up to "now"
    rb.subscribers.add(sub);
    req.on('close', () => { rb.subscribers.delete(sub); });
  });

  // History → restore: roll the workspace back to a checkpoint commit (P-git).
  app.post('/api/agentv3/restore', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const sha = typeof req.body?.sha === 'string' ? req.body.sha : '';
    if (!workspaceId || !sha) {
      res.status(400).json({ error: 'workspaceId and sha are required.' });
      return;
    }
    const ok = await restoreSession(workspaceId, sha, userId ?? undefined);
    res.json({ ok });
  });

  // §12.2 — deploy/git support: return the built app's source files as a
  // path→content map. This is exactly the shape the EXISTING deploy + git routes
  // accept (`/api/pro/deploy`, `/api/github/push-enhanced`), so v3.0 reuses that
  // backend for durable deploy + GitHub push instead of rebuilding any of it.
  // Read-only; never returns node_modules / build output / live .env secrets.
  app.post('/api/agentv3/workspace-files', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    try {
      const actuator = buildActuator();
      const { files, skipped } = await collectWorkspaceFiles(actuator, workspaceId);
      res.json({ files, count: Object.keys(files).length, skipped: skipped.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read the workspace files.' });
    }
  });

  // §12.2 — import an existing project (e.g. fetched from GitHub via the existing
  // `/api/github/fetch` route, or any source) into the v3.0 sandbox so the agent can
  // edit/update and then deploy/push it back. Path-safe (no traversal/absolute), and
  // never imports node_modules / .git / live .env secrets.
  app.post('/api/agentv3/import-files', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const files = req.body?.files;
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      res.status(400).json({ error: 'files (a path→content object) is required.' });
      return;
    }
    try {
      const actuator = buildActuator();
      // Best-effort: make sure the sandbox exists (an unknown type starts empty, so an
      // imported repo lands cleanly without scaffolded template files mixed in).
      try { await actuator.ensureWorkspace(workspaceId, 'import'); } catch { /* reuse existing sandbox */ }
      const { written, skipped } = await writeWorkspaceFiles(actuator, workspaceId, files as Record<string, string>);
      res.json({ imported: written.length, skipped: skipped.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to import the files.' });
    }
  });

  // Build entry — runs the native tool-use loop and streams events as NDJSON.
  app.post('/api/agentv3/chat', buildRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'AgentV3 requires ANTHROPIC_API_KEY to be configured.' });
      return;
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'A non-empty "prompt" is required.' });
      return;
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      res.status(400).json({ error: `Prompt is too long (max ${MAX_PROMPT_LEN} chars).` });
      return;
    }
    const buildKey = userId ?? 'anon';
    if (activeBuilds.has(buildKey)) {
      res.status(409).json({ error: 'A build is already running for this account. Stop it before starting another.', resumable: isBuildRunning(buildKey) });
      return;
    }
    activeBuilds.add(buildKey);
    const onlyOpus = req.body?.onlyOpus === true;
    // Smart planning gate: skip for simple apps (todo, calculator, etc.) to save
    // 2-3 min. planFirst=false from the client always wins (explicit user skip).
    // planFirst=true (or absent) defers to the complexity classifier — a simple
    // prompt skips planning even when the client hasn't explicitly disabled it.
    const planFirstRequested = req.body?.planFirst !== false;
    const planFirst = planFirstRequested && decidePlanning(prompt) !== 'skip';
    const thinking = req.body?.thinking === true; // adaptive thinking, off by default

    // NDJSON stream (mirrors the Engineer route's streaming contract).
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (obj: unknown): void => {
      if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    };

    // Intelligent cost routing (additive): a plain conversational turn — a
    // greeting, thanks, "who are you", small-talk — does NOT need the premium
    // Claude native-tool-use build loop (₹12–20/message). Answer those cheaply
    // via the existing NON-Claude free router (Vertex → Gemini → Grok) and skip
    // the whole build loop. CRITICAL: the reply carries NO provider attribution,
    // so the user can't tell which model answered — it reads as a normal reply.
    //
    // Conservative gate (any doubt → fall through to the real build path):
    //  • classifyIntent must say 'chat' (defaults to a build intent on any ambiguity), and
    //  • plan-mode must not be forcing a plan (a plain conversational turn).
    // A file attachment no longer forces the build path — it is pre-read into text
    // (below) so "read this file" can be answered cheaply via the chat path too.
    //
    // Attachments (images, PDFs, Word/Excel/PowerPoint, ZIP, text/code). Turn them
    // into TEXT the agent can read BEFORE any routing: documents are extracted on
    // the server for free, and images/PDFs are described by the cheap vision
    // providers (Gemini → Grok) by default — Claude is used to read them ONLY in
    // Power / Only-Opus mode (onlyOpus). This keeps file reading cheap and means a
    // file + a plain question can still take the cheap chat path below.
    const rawAttachments: Array<{ name: string; type: string; base64: string }> =
      Array.isArray(req.body?.attachments)
        ? req.body.attachments.filter(
            (a: any) => a && typeof a.base64 === 'string' && a.base64 && typeof a.type === 'string',
          )
        : [];
    let attachmentContext = '';
    if (rawAttachments.length > 0) {
      send({ type: 'narration', agent: 'architect', text: `📎 Reading ${rawAttachments.length} file(s)…`, ts: Date.now() });
      try {
        const docs = await buildDocumentContext(rawAttachments);
        const vis = await describeVisionAttachments(rawAttachments, { useClaude: onlyOpus });
        attachmentContext = [docs, vis].filter(Boolean).join('\n\n');
      } catch { /* best-effort — a bad file never blocks the turn */ }
    }

    // A clearly-conversational turn (greeting, thanks, small-talk) has NOTHING to
    // plan, so it takes the cheap chat path EVEN when plan-mode is on. classifyIntent
    // is conservative (defaults to a build intent on any doubt), so a real build request is
    // unaffected. This keeps a "hi" cheap AND avoids running the heavy build loop
    // (E2B sandbox + Claude) for small-talk — that heavy path sat silent during
    // sandbox setup and could reset the stream on Cloud Run / mobile Safari ("Load
    // failed") instead of just replying.
    // Level 1 (LLM intent): fast keyword classification first; if confidence is
    // low, upgrade with a cheap LLM call via the free router (never blocks — any
    // LLM failure falls back to the keyword result). Best-effort, no await on the
    // hot path: we fire the upgrade async and fall through immediately.
    let intent = classifyIntent(prompt);
    try {
      const freeRouter = AIRouterManager.getRouter('free');
      intent = await classifyIntentSmart(
        prompt,
        (p) => freeRouter.route(p, 'You are a classifier. Reply with one word only.').then((r) => r.response.content),
      );
    } catch { /* LLM upgrade is best-effort — keyword result stands */ }
    const isPlainChatTurn = intent === 'chat';
    // Surgical edit mode: the user is modifying an existing app (fix/change/update/
    // refactor/…), not building from scratch. When true, the build loop reads the
    // current files and makes minimum targeted edits instead of rebuilding everything.
    const isEditMode = intent === 'edit_existing';
    if (isPlainChatTurn) {
      try {
        const chatRouter = AIRouterManager.getRouter('free');
        const chatPrompt = attachmentContext
          ? `${prompt}\n\nThe user attached file(s); here is the extracted content:\n\n${attachmentContext}`
          : prompt;
        const { response } = await chatRouter.route(
          chatPrompt,
          "You are NavBharatAI's friendly assistant. Reply briefly and warmly in " +
            "the user's language. Do not mention which model you are.\n\n" + CREATOR_IDENTITY,
        );
        const reply = response.content + providerDebugTag(response.provider);
        // Record the turn in project memory so iterative context is preserved
        // (mirrors the build path's recordRequest). Best-effort.
        try {
          getWorkspaceMemory(deriveWorkspaceId(userId, req.body?.sessionId)).recordRequest(prompt);
        } catch { /* memory is best-effort — never blocks a reply */ }
        // Surface the reply EXACTLY like a normal build narration — no provider
        // name, no note — then close out the stream the same way a build does.
        const chatEvents = new AgentEventStream();
        chatEvents.subscribe((e) => send(e), false);
        chatEvents.emit({ type: 'narration', agent: 'architect', text: reply, ts: Date.now() });
        chatEvents.emit({ type: 'done', ok: true, summary: reply, ts: Date.now() });
        // billedUsd: 0 — the cheap free router is not billed to the user as a build.
        send({ type: 'result', ok: true, summary: reply, steps: 0, billedUsd: 0, billedInr: 0 });
        activeBuilds.delete(buildKey);
        if (!res.writableEnded) res.end();
        return;
      } catch {
        // The free router failed — do NOT error out. Fall through to the normal
        // build path so the user always gets an answer. (No return here.)
      }
    }

    // Register this build so it can be STOPPED and RE-ATTACHED to ("Resume") after the
    // original connection is lost. The client's response is the first subscriber; if it
    // disconnects we keep the build alive (still buffering) so the user can resume it.
    const abort = new AbortController();
    const rb: RunningBuild = { abort, buffer: [], subscribers: new Set(), ended: false, startedTs: Date.now() };
    const primary: BuildSubscriber = {
      write: (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n'); },
      end: () => { if (!res.writableEnded) res.end(); },
    };
    rb.subscribers.add(primary);
    runningBuilds.set(buildKey, rb);
    req.on('close', () => { rb.subscribers.delete(primary); });
    const emit = (e: unknown): void => broadcastBuild(rb, e);

    const events = new AgentEventStream();
    events.subscribe((e) => emit(e), false);
    const state = new WorkspaceState(events);

    const actuator = buildActuator();
    const workspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    try {
      // Native Claude for real tool-use, with a multi-provider text fallback
      // (Vertex → Gemini → Grok) so chat never dies if Claude is down/misconfigured.
      // Multi-provider build engine: Vertex/Gemini do the REAL build (function-calling),
      // Claude is the backstop — so builds work even when Claude is out of credits.
      const client = buildTurnRunner();
      const model = resolveModel(onlyOpus);
      const budget = maxBuildBudgetUsd();
      const maxSteps = envInt('AGENTV3_MAX_STEPS', 80);
      const subAgentMaxSteps = envInt('AGENTV3_SUBAGENT_MAX_STEPS', 40);
      // How many parallel-safe tools / review sub-agents may run at once in a turn (rate-limit
      // safe default; lower it if Anthropic concurrency limits are hit).
      const toolConcurrency = envInt('AGENTV3_TOOL_CONCURRENCY', 4);

      // Sandbox + git setup is best-effort: a plain chat (e.g. "hello") must still
      // get a reply even when no sandbox is available (no E2B key, or a read-only
      // filesystem). If setup fails we tell the user honestly and keep chatting —
      // the build tools will report the real sandbox error only if the user asks
      // to build. This is what makes v3.0 conversational like Claude Code.
      let git: GitManager | undefined;
      try {
        // Emit an immediate status so the NDJSON stream is never silent while the
        // sandbox is being created (E2B VM setup can take several seconds). A long
        // silent gap after the headers is what trips Cloud Run / mobile-Safari
        // request timeouts and surfaces as a bare "Load failed" on the client.
        events.emit({ type: 'narration', agent: 'architect', text: 'Setting up your workspace…', ts: Date.now() });
        await actuator.ensureWorkspace(workspaceId, 'react');
        // Real git repo → real checkpoints/History/restore (best-effort on
        // sandboxes without a shell).
        git = new GitManager(actuator, workspaceId);
        await git.ensureRepo();
        registerSession(workspaceId, git, userId ?? undefined);
        events.emit({ type: 'workspace', workspaceId, ts: Date.now() });
      } catch (setupErr) {
        const m = setupErr instanceof Error ? setupErr.message : String(setupErr);
        git = undefined;
        events.emit({
          type: 'narration',
          agent: 'architect',
          text: `Note: the build sandbox isn't available right now (${m}). I can still chat, but I won't be able to build until it's back.`,
          ts: Date.now(),
        });
      }

      // Remember the build request in project memory (episodic — the team can
      // recall what was asked for during the build).
      getWorkspaceMemory(workspaceId).recordRequest(prompt);

      // The Architect can delegate to specialist sub-agents via the task tool.
      const spawnSubAgent = makeSubAgentSpawn({
        client, actuator, workspaceId, state, events, model, onlyOpus,
        maxBudgetUsd: budget, maxSteps: subAgentMaxSteps, checkpointer: git,
      });
      // Layer 84 (Multi-Model Ensemble): the Architect can call second_opinion to
      // get an independent cross-model review from the NON-Claude free router
      // (Vertex → Gemini → Grok). Adapt the real AIRouter to the OpinionRouter
      // port (its route(prompt, system) already returns { response: { content,
      // provider } }). Never throws — the tool itself degrades gracefully.
      const opinionRouter = AIRouterManager.getRouter('free') as unknown as OpinionRouter;
      const secondOpinion = makeSecondOpinion(opinionRouter);
      // Layer 49 (Collective Intelligence): the Architect can call consensus to
      // convene a multi-perspective panel (correctness, security, UX) on a hard
      // decision, using the SAME non-Claude free router. Never throws.
      const consensus = makeConsensus(opinionRouter);
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git, secondOpinion, consensus);

      // Surgical edit mode (gold standard): when the user is editing an existing
      // app rather than building fresh, inject the CURRENT file tree and the
      // edit-mode prefix so the agent reads existing files and makes minimum,
      // targeted edit_file patches — never rebuilding everything from scratch.
      // Best-effort: a listFiles failure falls back to the edit prefix without a
      // tree, and a non-edit turn uses the normal architect prompt unchanged.
      let architectSystem = architectSystemPrompt();
      if (isEditMode) {
        let fileTree: string[] = [];
        try {
          fileTree = await actuator.listFiles(workspaceId);
        } catch { /* listing is best-effort — fall through to the normal build prompt */ }
        // Engage surgical-edit mode ONLY when there are real files to patch. On an
        // empty or failed workspace there is nothing to edit, so the normal build
        // prompt (which freely creates files) is the correct, non-misleading default.
        if (fileTree.length > 0) {
          events.emit({
            type: 'narration',
            agent: 'architect',
            text: `✏️ Editing your existing app (${fileTree.length} file${fileTree.length === 1 ? '' : 's'}) — I'll make targeted changes, not rebuild it.`,
            ts: Date.now(),
          });
          architectSystem = editModePrefix(fileTree) + '\n\n---\n\n' + architectSystem;
          // Warm the project graph from the PERSISTED sandbox files when memory is
          // cold (process restarted but the sandbox survived). This makes the agent's
          // recall / evaluate tools see the existing codebase immediately on a resumed
          // edit session, instead of only after it manually re-reads files. Best-effort,
          // capped, and a no-op when memory is already warm — never blocks the build.
          try {
            // Level 9: restore persisted memory snapshot before warming from files —
            // episodes and file-list hints survive server restarts this way.
            const wsMem = getWorkspaceMemory(workspaceId);
            await restoreWorkspaceMemory(workspaceId, wsMem).catch(() => {});
            await warmIndexFiles(wsMem, fileTree, (p) => actuator.readFile(workspaceId, p));
          } catch { /* warming is best-effort — never blocks a build */ }
        }
      }

      const runner = new AgentRunner({
        client,
        dispatcher,
        state,
        events,
        model,
        system: architectSystem,
        tools: catalogForTools(roleConfig('architect').tools),
        onlyOpus,
        thinking,
        maxBudgetUsd: budget,
        maxSteps,
        toolConcurrency,
        agentRole: 'architect',
        signal: abort.signal,
        // D7: persist the build transcript so it survives a reconnect/refresh. Best-effort —
        // a store failure never breaks the build (see AgentRunner). Reloadable via the
        // GET /api/agentv3/conversations endpoints below.
        persistence: {
          store: getConversationStore(),
          conversationId: randomUUID(),
          userId: userId ?? 'anon',
          workspaceId,
          title: deriveTitle(prompt),
        },
      });

      let buildPrompt = prompt;

      // Continual learning (Layer 79): recall the relevant lessons recorded by
      // the Layer 57 reflection of earlier builds in this session (and any past
      // error/fix episodes) and prepend them as guidance, so iterative builds
      // actually apply what was learned. Best-effort — recall can NEVER block a
      // build, and the current request is not echoed back (request episodes are
      // excluded by formatRecalledLessons).
      try {
        const lessonsMem = getWorkspaceMemory(workspaceId);
        const hits = lessonsMem.recall(prompt, 8);
        const lessons = formatRecalledLessons(hits);
        if (lessons) buildPrompt = `${lessons}\n\n---\n\n${buildPrompt}`;
      } catch { /* recall is best-effort — never blocks a build */ }

      // Universal Language (Layer 73): build in the user's language. If the
      // request is written in a distinctive non-Latin script we name the
      // language explicitly; otherwise we instruct Claude to mirror whatever
      // language the request used. Best-effort — NEVER blocks a build.
      try {
        const hint = detectLanguageHint(prompt);
        const langInstruction = hint
          ? `Language: the user is writing in ${hint.name}. Generate ALL user-facing text in the app (labels, buttons, headings, placeholders, messages) in ${hint.name}. Keep code identifiers and comments in English.`
          : `Language: generate all user-facing text in the app in the SAME language the user used in this request (default to English if it is English). Keep code identifiers and comments in English.`;
        buildPrompt = `${langInstruction}\n\n${buildPrompt}`;
      } catch { /* best-effort — never blocks a build */ }

      // Attachments: prepend the extracted file content/description so the build
      // loop can act on the uploaded file(s). Computed earlier (cheap vision /
      // free document extraction); empty when there were no attachments.
      if (attachmentContext) {
        buildPrompt = `The user attached file(s); here is the extracted content:\n\n${attachmentContext}\n\n---\n\n${buildPrompt}`;
      }

      // Plan mode (P4): plan first, then block for the user's approval before
      // building. A real gate — the build does not start until the user answers.
      if (planFirst) {
        const planRunner = new AgentRunner({
          client,
          dispatcher: new ToolDispatcher(actuator, workspaceId, state, events),
          state,
          events,
          model,
          system: planSystemPrompt(),
          tools: catalogForTools(['update_todo']),
          onlyOpus,
          thinking,
          maxBudgetUsd: budget,
          maxSteps: 4,
          agentRole: 'architect',
          signal: abort.signal,
        });
        await planRunner.run(prompt);

        // Strategic Intelligence (Layer 54): review the proposed plan for gaps
        // (no verification step, no setup, missing deploy, under-scoped, vague)
        // and surface them next to the plan BEFORE the user approves. Best-effort —
        // a review failure must never block the approval gate.
        try {
          const planTodos = state.snapshot().todos;
          if (planTodos.length > 0) {
            events.emit({
              type: 'narration',
              agent: 'architect',
              text: planAnalysisSummary(planTodos, prompt),
              ts: Date.now(),
            });
          }
        } catch { /* plan review is advisory — never blocks the gate */ }

        const requestId = randomUUID();
        events.emit({
          type: 'permission_request',
          agent: 'architect',
          action: 'Approve this plan to start building',
          callId: requestId,
          ts: Date.now(),
        });
        const approved = await awaitApproval(requestId);
        if (!approved) {
          const summary = 'Plan was not approved — build cancelled.';
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          emit({ type: 'result', ok: false, summary, steps: 0, billedUsd: 0, billedInr: 0 });
          return;
        }
        const todos = state.snapshot().todos;
        if (todos.length > 0) {
          buildPrompt = `${prompt}\n\nApproved plan:\n${todos.map((t) => `- ${t.title}`).join('\n')}`;
        }
      }

      const result = await runner.run(buildPrompt);

      // Build Reflection (Layer 57, seed): derive a short reflection from what
      // happened this build (errors hit, fixes applied, outcome) and store it
      // back into project memory so the NEXT build in this session can recall
      // those lessons. Best-effort — wrapped so it can NEVER affect the build.
      try {
        const reflectMem = getWorkspaceMemory(workspaceId);
        const reflection = reflectOnBuild({
          ok: result.ok,
          summary: result.summary,
          steps: result.steps,
          episodes: reflectMem.snapshot().episodes,
        });
        reflectMem.recordNote(reflectionNote(reflection));
      } catch { /* reflection is best-effort — never affects the build result */ }

      // Project Summary (Layer 27, "What I built"): on a SUCCESSFUL build, emit a
      // short, friendly recap of what was created (stack, files/components/routes,
      // how to run) as a final narration so it shows as the last chat message.
      // Best-effort — wrapped so it can NEVER affect the build result.
      if (result.ok) {
        try {
          const summaryText = summarizeProject(getWorkspaceMemory(workspaceId).graph(), prompt);
          if (summaryText) events.emit({ type: 'narration', agent: 'architect', text: summaryText, ts: Date.now() });
        } catch { /* summary is best-effort — never affects the build */ }
      }

      // Level 8: Post-build multi-agent quality review — independent agent checks the
      // produced code for real defects, anti-patterns and missed requirements.
      // Only fires on successful builds; result is advisory narration, never blocks.
      if (result.ok) {
        try {
          const rFiles = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
          const rSample = await Promise.all(
            rFiles.slice(0, 5).map(async (p) => ({
              path: p,
              content: await actuator.readFile(workspaceId, p).catch(() => ''),
            })),
          );
          const review = await reviewBuild({
            userRequest: prompt,
            fileTree: rFiles,
            fileSample: rSample,
            spawn: spawnSubAgent,
          });
          const reviewText = formatReview(review);
          if (reviewText) {
            events.emit({ type: 'narration', agent: 'architect', text: reviewText, ts: Date.now() });
          }
        } catch { /* reviewer is best-effort — never affects the build result */ }
      }

      // Level 9: Persist workspace memory to Firestore so the NEXT session (or build)
      // can restore file-list hints and episode history without re-reading all files.
      // Best-effort: Firestore unavailability must never affect the build outcome.
      try {
        saveWorkspaceMemory(workspaceId, getWorkspaceMemory(workspaceId).snapshot()).catch(() => {});
      } catch { /* memory persist is best-effort */ }

      // Bill the user the marked-up cost (D5/D6), recorded in the same place the
      // platform records every build's cost. Best-effort — never blocks the run.
      // Internal accounting stays in USD (currency-stable); the customer-facing amount
      // is shown in INR (billedInr = billedUsd × the real-time USD→INR rate).
      if (userId && result.billedUsd > 0) {
        userCostStore.record(userId, result.billedUsd).catch(() => {});
      }

      // TEMP DEBUG: tag the build reply with the provider/model (Claude primary; the
      // resilient runner already self-labels in the text if it fell back to a free provider).
      const buildTag = providerDebugTag(`Claude (${model})`);
      if (buildTag) events.emit({ type: 'narration', agent: 'architect', text: buildTag.trim(), ts: Date.now() });
      emit({ type: 'result', ...result, billedInr: Math.round(result.billedUsd * usdInrRate() * 100) / 100 });
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      activeBuilds.delete(buildKey);
      // Only clear the registry slot if it is STILL this build — a Stop may have already
      // replaced it with a newer run. End every attached stream.
      if (runningBuilds.get(buildKey) === rb) runningBuilds.delete(buildKey);
      endBuild(rb);
    }
  });
}
