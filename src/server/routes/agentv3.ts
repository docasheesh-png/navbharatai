import type { Express, Request, Response } from 'express';
import { buildRateLimiter, workspaceRateLimiter, verifyFirebaseToken } from '../lib/authMiddleware';
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
  makeWebSearch,
  type OpinionRouter,
  resolveModel,
  toPowerLevel,
  powerSpec,
  haikuModel,
  sonnetModel,
  opusModel,
  architectSystemPrompt,
  planSystemPrompt,
  editModePrefix,
  LANGUAGE_RULE,
  awaitApproval,
  resolveApproval,
  GitManager,
  GitRepoSync,
  GitHubAppClient,
  UserGitHubClient,
  githubConfigFromEnv,
  githubStorageActive,
  githubPrMode,
  mergeViaPullRequest,
  repoNameForProject,
  type RepoInfo,
  type PrCapableClient,
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
import type { IEngineerActuator } from '../AgentV3/sandbox/EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../AgentV3/sandbox/EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../AgentV3/sandbox/EngineerAI/actuators/DockerActuator';
import { userCostStore } from '../lib/UserCostStore';
import { onboardingCreditStore, freeOnboardingLimit } from '../lib/OnboardingCreditStore';
import { usdInrRate } from '../lib/UsdInrRate';
import { makeResilientTurnRunner } from './agentv3Resilient';
import { GoogleGenAI } from '@google/genai';
import { GeminiToolRunner, type GeminiGenAiClient } from '../AgentV3/providers/GeminiToolRunner';
import { makeMultiProviderTurnRunner, forceModelRunner, type NamedRunner } from '../AgentV3/providers/MultiProviderTurnRunner';
import { OpenAiToolRunner, type OpenAiChatClient } from '../AgentV3/providers/OpenAiToolRunner';
import OpenAI from 'openai';
import type { TurnRunner } from '../AgentV3/ClaudeClient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { fenceUntrusted } from '../AgentV3/UntrustedContent';
import { autoFixEnabled, autoFixMaxAttempts, filterActionableErrors, buildRepairPrompt, autoFixWarning, type RuntimeError } from '../AgentV3/AutoFix';
/** Hard per-session cost cap (USD). Prevents runaway retry spirals ($26 todo app problem).
 *  Set SESSION_COST_CAP_USD in env to override. Default: $5. */
function sessionCostCapUsd(): number {
  const v = parseFloat(process.env.SESSION_COST_CAP_USD ?? '');
  return Number.isFinite(v) && v > 0 ? v : 5.0;
}
import { deploymentStore, withDeploymentPersistence } from '../AgentV3/DeploymentStore';
import { getDeployProvider, DEFAULT_DEPLOY_PROVIDER, deployProviderStatus } from '../AgentV3/DeployProviders';
// Side-effect imports: each provider self-registers into the DeployProviders registry on load.
import '../AgentV3/VercelProvider';
import '../AgentV3/NetlifyProvider';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { planAnalysisSummary } from '../AgentV3/PlanIntelligence';
import { collectWorkspaceFiles, writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { VirtualFileSystem } from '../project/ProjectModel';
import { renderPreview } from '../runtime/renderPreview';
import { isReactProject } from '../runtime/ReactPreview';
import { isVueProject } from '../runtime/VuePreview';
import { CREATOR_IDENTITY } from '../lib/prompts';
import { classifyIntentSmart } from '../AgentV3/IntentClassifier';
import { decidePlanning } from '../AgentV3/ComplexityClassifier';
import { analyzeRequest, type StartTier, type AnalysisResult } from '../AgentV3/RequestAnalyser';
import { agentV3CostTelemetry } from '../AgentV3/AgentV3CostTelemetry';
import { runWithEscalation, type GateVerdict } from '../AgentV3/EscalationOrchestrator';
import { reviewBuild, formatReview, hasReviewableSource } from '../AgentV3/ReviewerAgent';
import {
  saveWorkspaceMemory,
  restoreWorkspaceMemory,
} from '../AgentV3/FirestoreWorkspaceMemoryStore';
import { saveWorkspaceFiles, loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { planFileGuardian } from '../AgentV3/FileGuardian';
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
/**
 * Ownership guard for the workspaceId-bearing endpoints (IDOR fix). A workspaceId is always
 * `agentv3-{uid}-{sessionId}` (see deriveWorkspaceId), so a workspace belongs to a user iff the id
 * carries that user's uid. We prefer a SERVER-VERIFIED uid (Firebase ID token) — spoof-proof — and
 * fall back to the request's claimed userId for callers without a token (the synthetic admin user,
 * and anonymous sessions, which also rely on the unguessable random sessionId). Returns false for a
 * malformed id or a uid mismatch, so one user can never read/write another user's workspace.
 */
async function assertWorkspaceOwner(req: Request, workspaceId: string): Promise<boolean> {
  if (!workspaceId || !workspaceId.startsWith('agentv3-')) return false;
  const verifiedUid = await verifyFirebaseToken(req);
  // Claimed id may come from the JSON body (POST) or the query string (GET). The verified token
  // always takes precedence over either, so this only widens the token-less admin/anon fallback.
  const claimedUid =
    (typeof req.body?.userId === 'string' ? req.body.userId : null) ??
    (typeof req.query?.userId === 'string' ? req.query.userId : null);
  const id = verifiedUid ?? claimedUid;
  const uid = id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : 'anon';
  return workspaceId.startsWith(`agentv3-${uid}-`);
}

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

/**
 * Per-user monthly spend ceiling (R1, roadmap §3.1). The hard per-BUILD cap
 * (maxBuildBudgetUsd) stops one runaway build; this caps a user's TOTAL billed
 * spend across the calendar month so a single user can never run the platform's
 * D2 (NavBharatAI-pays) exposure to the moon. Returns 0 (disabled) unless the admin
 * sets AGENTV3_USER_MONTHLY_CAP_USD to a positive number, so existing behaviour is
 * unchanged until it is opted into.
 */
export function userMonthlyCapUsd(): number {
  const raw = Number(process.env.AGENTV3_USER_MONTHLY_CAP_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * R2 §1.1 — the mandatory end-of-build readiness gate is ON by default; the admin can disable
 * it with AGENTV3_READINESS_GATE=off (a safe escape hatch should it ever over-block). When on,
 * a top-level build that finished with unresolved-import / secret-leak / fake-code / can't-run
 * blockers is reported as NOT a clean success (ok:false) instead of a fake "done".
 */
export function readinessGateEnabled(): boolean {
  return process.env.AGENTV3_READINESS_GATE !== 'off';
}

/**
 * WATCHDOG — hard wall-clock cap (seconds) on a single build, so it can NEVER hang for 20-30 minutes
 * (the agent looping when a broken preview can't be verified). Default 12 minutes; admin-tunable via
 * AGENTV3_MAX_BUILD_SECONDS. Set to 0 to disable (not recommended).
 */
export function maxBuildSeconds(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_SECONDS);
  if (raw === 0) return 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 720;
}

/**
 * Check whether a user is at or over their monthly spend ceiling. Returns the cap and
 * the current monthly total so the caller can return an honest, specific message.
 * Best-effort: a Firestore read failure (or no userId) NEVER blocks a build — we fail
 * OPEN so a transient store outage cannot lock every user out (the per-build cap still
 * bounds the blast radius). Disabled (cap<=0) → always allowed.
 */
export async function checkMonthlyCap(userId: string | null): Promise<{ allowed: boolean; cap: number; spent: number }> {
  const cap = userMonthlyCapUsd();
  if (cap <= 0 || !userId) return { allowed: true, cap, spent: 0 };
  try {
    const usage = await userCostStore.get(userId);
    const spent = usage?.totalCostUsd ?? 0;
    return { allowed: spent < cap, cap, spent };
  } catch {
    return { allowed: true, cap, spent: 0 };
  }
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
 * The v3.0 BUILD turn-runner. Per the v3.0 constitution, v3.0 runs on NavBharatAI's own
 * Claude/Anthropic account (NavBharatAI pays the Claude cost; the user is billed the
 * Opus-equivalent markup). So CLAUDE LEADS each turn by default — builds use the reliable,
 * strong tool-use model and actually COMPLETE — with Vertex → Gemini → Claude-Haiku as the
 * fallback chain so a Claude throttle never breaks a build.
 *
 * Why the default flipped (2026-06-28): the old cheap-first order (Gemini/Vertex lead) meant
 * Claude was never reached on a normal build, AND Gemini's quota/rate/output limits broke
 * builds mid-run (the multi-provider runner returns the first NON-THROWING result, so a
 * truncated Gemini turn is accepted and the loop stalls instead of falling through to Claude).
 * Set AGENTV3_BUILD_CLAUDE_FIRST=0 to revert to the old cheap-first ladder if ever needed.
 * If no Gemini/Vertex provider is configured, falls back to the Claude-only resilient runner.
 * Build models are env-overridable (AGENTV3_{VERTEX,GEMINI}_BUILD_MODEL).
 */
/**
 * Decide whether the v3.0 build chain leads with Claude. Pure + exported for unit testing.
 * Explicit opts (escalation passes `true`) win; otherwise Claude-first by default, with
 * AGENTV3_BUILD_CLAUDE_FIRST=0 / "off" as the opt-out to the old cheap-first ladder.
 */
export function resolveClaudeFirst(optsClaudeFirst: boolean | undefined, env: string | undefined): boolean {
  if (typeof optsClaudeFirst === 'boolean') return optsClaudeFirst;
  return env !== '0' && env !== 'off';
}
/**
 * Cost-ladder (P2): map the analyser's start tier to the cheapest CAPABLE Gemini
 * build model. Trivial/simple work (greeting, calculator, todo) starts on Gemini
 * Flash — a fraction of Pro's cost; anything the analyser scored as real coding or
 * a complex/architecture app keeps gemini-2.5-pro, with the Claude backstop intact.
 * Billing is UNCHANGED (Opus-equivalent × 2.5 / × 5) — this lowers ONLY NavBharatAI's
 * own provider cost, so the margin is strictly wider. Exported for unit testing.
 */
export function tierToGeminiBuildModel(tier: StartTier): string {
  return tier === 'gemini' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
}

/**
 * Admin build-routing policy (2026-06-28): choose the Claude model that LEADS the build
 * by app complexity, so cost matches the work without compromising quality:
 *   • POWER mode (Only-Opus / power level on) → Opus (premium).
 *   • Complex app (analyser start tier 'sonnet'/'opus') → Sonnet.
 *   • Small/simple app ('gemini'/'haiku'/none) → Haiku (cheap, reliable tool-use).
 * Gemini/Vertex stay as the fallback in buildTurnRunner if the chosen Claude model
 * throttles, so a build never breaks. Billing is unchanged (Opus-equivalent markup,
 * D5/D6) regardless of which model runs — margin only widens on the cheaper tiers.
 * Pure + exported for unit testing.
 */
export function selectBuildModel(tier: StartTier | undefined, powerOn: boolean): string {
  if (powerOn) return opusModel();
  if (tier === 'sonnet' || tier === 'opus') return sonnetModel();
  return haikuModel();
}

function buildTurnRunner(opts?: { geminiModel?: string; claudeFirst?: boolean }): TurnRunner {
  // Explicit env overrides always win; absent them the cost-ladder tier model
  // (when supplied) is preferred over the fixed gemini-2.5-pro default.
  const buildModel = (envName: string): string =>
    process.env[envName] || process.env.AGENTV3_BUILD_MODEL || opts?.geminiModel || 'gemini-2.5-pro';
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
  // Bound Claude's retry ladder on the BUILD hot path. Claude now LEADS every build turn
  // (claudeFirst), so the default 5× exponential backoff (≈30-60s) would stall each turn
  // when the Anthropic account is overloaded — looking like "stuck midway / infinite
  // loading". 2 retries falls through to Gemini/Vertex in a few seconds instead.
  // AGENTV3_BUILD_CLAUDE_RETRIES overrides.
  const buildRetry = { maxRetries: Math.max(0, parseInt(process.env.AGENTV3_BUILD_CLAUDE_RETRIES || '', 10) || 2) };
  if (cheap.length === 0) return makeResilientTurnRunner(new ClaudeClient(undefined, buildRetry)); // Claude-only env
  const claude: NamedRunner = { name: 'CLAUDE', runner: new ClaudeClient(undefined, buildRetry) };
  // P7 failover hardening: a final Claude-HAIKU backstop that FORCES the Haiku model
  // regardless of the turn's requested model. It only ever runs after every prior provider
  // (Vertex → Gemini → primary Claude) has thrown, so normal builds are unaffected — but if
  // Sonnet/Opus is overloaded or rate-limited, Haiku still completes the turn and the build
  // never breaks. Billing is unchanged (Opus-equivalent markup, D5/D6) regardless of which
  // model actually answers. AGENTV3_DISABLE_HAIKU_BACKSTOP=1 removes it if ever needed.
  const haikuBackstop: NamedRunner = { name: 'CLAUDE_HAIKU', runner: forceModelRunner(new ClaudeClient(undefined, buildRetry), haikuModel()) };
  const withBackstop = process.env.AGENTV3_DISABLE_HAIKU_BACKSTOP === '1' ? [] : [haikuBackstop];
  // Claude-first by default (v3.0 runs on Claude — see the doc comment above); Vertex/Gemini
  // remain as fallback. Escalation passes claudeFirst:true; AGENTV3_BUILD_CLAUDE_FIRST=0 reverts.
  const claudeFirst = resolveClaudeFirst(opts?.claudeFirst, process.env.AGENTV3_BUILD_CLAUDE_FIRST);
  const chain = claudeFirst ? [claude, ...cheap, ...withBackstop] : [...cheap, claude, ...withBackstop];
  return makeMultiProviderTurnRunner(chain, {
    onProviderUsed: (used, from) => { if (from.length) console.log(`[AGENTV3] build turn via ${used} (after ${from.join(' → ')})`); },
    onProviderError: (name, err) => console.log(`[AGENTV3] build ${name} failed: ${err instanceof Error ? err.message : String(err)}`),
  });
}

/**
 * Admin routing policy: the PLAN phase runs on GROK (xAI) — strong, cheap reasoning for
 * the short plan/todo step. Grok speaks the OpenAI function-calling API, so the existing
 * OpenAiToolRunner drives it (the plan uses the update_todo tool). Returns a multi-provider
 * runner [Grok → Claude] so a Grok outage/limit falls back to a cheap Claude (Haiku) and the
 * plan never breaks; the Claude fallback model is the params.model passed by the caller
 * (Grok ignores it and forces grok-3 via opts.model). Returns null when no Grok/xAI key is
 * configured, so the caller keeps using the normal build client. AGENTV3_GROK_PLAN_MODEL
 * overrides the model; AGENTV3_PLAN_GROK=0 disables Grok planning (revert to Claude).
 */
/** Whether the PLAN phase should run on Grok: a Grok/xAI key is set and not disabled.
 *  Pure + exported for unit testing. */
export function planGrokEnabled(apiKey: string | undefined, disableFlag: string | undefined): boolean {
  return !!apiKey && disableFlag !== '0' && disableFlag !== 'off';
}

function grokPlanRunner(): TurnRunner | null {
  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!planGrokEnabled(apiKey, process.env.AGENTV3_PLAN_GROK)) return null;
  try {
    const client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1', timeout: 60_000, maxRetries: 0 });
    const model = process.env.AGENTV3_GROK_PLAN_MODEL || 'grok-3';
    const grok: NamedRunner = { name: 'GROK', runner: new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model }) };
    const claudeFallback: NamedRunner = { name: 'CLAUDE', runner: new ClaudeClient(undefined, { maxRetries: 2 }) };
    return makeMultiProviderTurnRunner([grok, claudeFallback], {
      onProviderError: (name, err) => console.log(`[AGENTV3] plan ${name} failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  } catch {
    return null; // misconfigured — caller falls back to the normal build client
  }
}

/**
 * Cost-ladder escalation (P3) — DORMANT by default. Wiring exists but the rebuild-on-
 * gate-fail loop only activates when AGENTV3_ESCALATION=on (the design doc's "behind the
 * rollout flag" instruction). With it OFF, the build runs exactly once on the start tier —
 * byte-identical to pre-P3 behaviour. Exported pure for unit testing.
 */
export function escalationEnabled(): boolean {
  return process.env.AGENTV3_ESCALATION === 'on';
}

/**
 * Whether THIS build should run through the escalation orchestrator. Only when: the flag is
 * on, we have an analyser verdict, it is NOT power/Only-Opus mode (power bypasses the ladder),
 * and the escalation path actually has a higher tier to climb to. Otherwise the single-build
 * fast path is used (and stays identical to today).
 */
export function shouldEscalateBuild(analysis: AnalysisResult | undefined, onlyOpus: boolean): boolean {
  if (!escalationEnabled()) return false;
  if (!analysis || onlyOpus) return false;
  return (analysis.escalationPath?.length ?? 0) > 1;
}

/**
 * Objective build gate: a build that did not complete (ok=false) fails the gate and triggers
 * escalation; a completed build passes. Deterministic, free, no LLM call — the honest signal
 * the AgentRunner already computes. (Richer 22-dimension gating can replace this later.)
 */
export function escalationGate(ok: boolean): GateVerdict {
  return ok
    ? { pass: true, score: 100, reason: 'build completed' }
    : { pass: false, score: 0, reason: 'build did not complete — escalate to a stronger tier' };
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
 * Non-secret diagnosis of the SANDBOX + live-preview configuration — pinpoints why the
 * "Live server" (E2B) preview tab is missing. The tab needs a real cloud sandbox (E2B/Docker);
 * with no E2B_API_KEY the engine falls back to LocalActuator, which has NO live preview, so only
 * the in-browser tab shows. Also flags a custom E2B_PREVIEW_DOMAIN, which silently breaks every
 * preview URL unless wildcard DNS is configured.
 */
export function sandboxDiag(): {
  actuator: 'e2b' | 'docker' | 'local';
  e2bKeySet: boolean;
  dockerEnabled: boolean;
  /** False when the active actuator cannot serve a live preview (Local) — the "Live server" tab won't appear. */
  livePreviewAvailable: boolean;
  previewDomain: string;
  previewDomainIsCustom: boolean;
  /** Set when a custom preview domain is configured — a reminder it needs wildcard DNS, else previews 404. */
  previewDomainWarning: string | null;
} {
  const e2bKeySet = !!(process.env.E2B_API_KEY && process.env.E2B_API_KEY.trim());
  const dockerEnabled = process.env.DOCKER_ENABLED === 'true';
  const actuator: 'e2b' | 'docker' | 'local' = e2bKeySet ? 'e2b' : dockerEnabled ? 'docker' : 'local';
  const domain = (process.env.E2B_PREVIEW_DOMAIN || '').trim() || 'e2b.app';
  const previewDomainIsCustom = domain !== 'e2b.app';
  return {
    actuator,
    e2bKeySet,
    dockerEnabled,
    livePreviewAvailable: actuator !== 'local',
    previewDomain: domain,
    previewDomainIsCustom,
    previewDomainWarning: previewDomainIsCustom
      ? `Preview URLs are rewritten to *.${domain}; this ONLY resolves if ${domain} is an E2B custom domain with a wildcard *.${domain} DNS record. If previews 404/blank, set E2B_PREVIEW_DOMAIN=e2b.app (raw host, always works).`
      : null,
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
    const diag = { ...agentV3KeyDiag(), sandbox: sandboxDiag() };
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

  // Public, lightweight preview-capability probe — ONLY the sandbox diagnosis (no
  // provider-key info). The preview surface calls this to explain, honestly, WHY the
  // "Live server" tab has no URL: either the cloud sandbox isn't configured on this
  // deployment (LocalActuator → no live preview), or a custom preview domain needs DNS.
  app.get('/api/agentv3/preview-status', (_req: Request, res: Response) => {
    res.json(sandboxDiag());
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
  app.post('/api/agentv3/restore', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const ok = await restoreSession(workspaceId, sha, userId ?? undefined);
    res.json({ ok });
  });

  // R5 §5.1 — return a workspace's latest LIVE deployment URL (durable, survives reconnect).
  // Lets the UI restore the "Live site" link after a refresh/new session instead of losing it
  // with the build stream. Ownership-checked; null url when the app has never been deployed.
  app.get('/api/agentv3/deployment', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const rec = await deploymentStore.get(workspaceId);
    res.json({ url: rec?.url ?? null, fileCount: rec?.fileCount ?? 0, updatedAt: rec?.updatedAt ?? null });
  });

  // R5 §5.1 — list the available deploy providers and which are configured right now (no lock-in).
  // Honest status: a provider whose API token is missing reports configured:false with what to set,
  // so the UI can show "available — add token" instead of faking a deploy target.
  app.get('/api/agentv3/deploy-providers', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    // hasGithub is a boolean hint only — never accept a token in a GET query string.
    const hasGithub = req.query.hasGithub === 'true' || req.query.hasGithub === '1';
    res.json({
      providers: deployProviderStatus({ userId, githubToken: hasGithub ? 'present' : undefined }),
      default: DEFAULT_DEPLOY_PROVIDER,
    });
  });

  // §12.2 — deploy/git support: return the built app's source files as a
  // path→content map. This is exactly the shape the EXISTING deploy + git routes
  // accept (`/api/pro/deploy`, `/api/github/push-enhanced`), so v3.0 reuses that
  // backend for durable deploy + GitHub push instead of rebuilding any of it.
  // Read-only; never returns node_modules / build output / live .env secrets.
  app.post('/api/agentv3/workspace-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
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

  // DUAL PREVIEW (Phase 5) — in-browser preview. Builds ONE self-contained HTML document from the
  // workspace files (static HTML/CSS/JS inlined, or React/Vue bundled in-browser via the existing
  // runtime renderers) and returns it for the client to render in an <iframe srcdoc>. This needs NO
  // running dev server, so it works even when the E2B sandbox preview is unavailable (the "Blocked
  // request" / sandbox-down case) — the second of the two preview paths the builder offers.
  app.post('/api/agentv3/inbrowser-preview', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    try {
      const actuator = buildActuator();
      const { files } = await collectWorkspaceFiles(actuator, workspaceId);
      if (Object.keys(files).length === 0) {
        res.status(404).json({ error: 'No files to preview yet — build something first.' });
        return;
      }
      const vfs = VirtualFileSystem.fromRecord(files);
      const html = renderPreview(vfs);
      // Detect the renderer used so the client can label the mode honestly.
      const kind = isReactProject(vfs) ? 'react' : isVueProject(vfs) ? 'vue' : 'static';
      res.json({ html, kind, count: Object.keys(files).length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build the in-browser preview.' });
    }
  });

  // §12.2 — import an existing project (e.g. fetched from GitHub via the existing
  // `/api/github/fetch` route, or any source) into the v3.0 sandbox so the agent can
  // edit/update and then deploy/push it back. Path-safe (no traversal/absolute), and
  // never imports node_modules / .git / live .env secrets.
  app.post('/api/agentv3/import-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
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

  // "Restore all files" (History / Files tab) — a REAL restore, no fake. Brings the user's whole
  // project back into the workspace and returns the actual file list:
  //   • If the sandbox is warm and already has the files, return them (nothing to do).
  //   • Otherwise load the last durably-saved files (Firestore WorkspaceFileStore) and WRITE them
  //     back into the sandbox, so the restored project is genuinely there — buildable, previewable
  //     and deployable — not just shown.
  // Ownership-checked. Honest source flag ('sandbox' | 'saved' | 'none') + count.
  app.post('/api/agentv3/restore-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    try {
      const actuator = buildActuator();
      // 'import' type starts EMPTY (no scaffold), so a cold sandbox doesn't mask "no files".
      try { await actuator.ensureWorkspace(workspaceId, 'import'); } catch { /* reuse existing */ }
      // If the sandbox already holds the project (warm session), those are the freshest files.
      const current = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] as string[] }));
      if (Object.keys(current.files).length > 0) {
        res.json({ files: Object.keys(current.files), count: Object.keys(current.files).length, restored: false, source: 'sandbox' });
        return;
      }
      // Cold sandbox → genuinely restore the last durably-saved files into it.
      const saved = await loadWorkspaceFiles(workspaceId);
      if (saved && Object.keys(saved).length > 0) {
        const { written } = await writeWorkspaceFiles(actuator, workspaceId, saved);
        res.json({ files: written, count: written.length, restored: true, source: 'saved' });
        return;
      }
      res.json({ files: [], count: 0, restored: false, source: 'none' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to restore the workspace files.' });
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
    // Per-user monthly spend ceiling (R1 §3.1). When the admin has set a cap and this user
    // has reached it this month, deny new builds with an honest, specific message (HTTP 402).
    // Disabled by default and fails open on a store error, so it never locks users out wrongly.
    const monthly = await checkMonthlyCap(userId);
    if (!monthly.allowed) {
      res.status(402).json({
        error: `Monthly usage limit reached (≈$${monthly.spent.toFixed(2)} of $${monthly.cap.toFixed(2)}). ` +
          `Your limit resets at the start of next month.`,
      });
      return;
    }
    const buildKey = userId ?? 'anon';
    if (activeBuilds.has(buildKey)) {
      res.status(409).json({ error: 'A build is already running for this account. Stop it before starting another.', resumable: isBuildRunning(buildKey) });
      return;
    }
    activeBuilds.add(buildKey);
    // Power level (admin override 2026-06-27): 'off' | 'mini' (5×) | 'medium' (10×) |
    // 'max' (20×). Accepts the new `powerLevel` field; falls back to the legacy `onlyOpus`
    // boolean (→ 'mini'). `onlyOpus` below stays a boolean (true for any Opus power level)
    // so every existing boolean call site — vision, cost-ladder, escalation — is unchanged.
    const powerLevelReq = toPowerLevel(req.body?.powerLevel ?? (req.body?.onlyOpus === true));
    const powerSpecResolved = powerSpec(powerLevelReq);
    const onlyOpus = powerSpecResolved.powerMode;
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
    // SSE keepalive: send a ping every 15 s so Chrome never throttles/drops the
    // connection when the tab is backgrounded or minimised. Cleared on response end.
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ type: 'ping' }) + '\n');
      else clearInterval(heartbeatTimer);
    }, 15_000);
    res.on('close', () => clearInterval(heartbeatTimer));

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
        const extracted = [docs, vis].filter(Boolean).join('\n\n');
        // Prompt-injection defense (R1 §3.3): the user may have innocently uploaded a document
        // or repo that carries an injection payload. Fence the extracted content as untrusted
        // DATA so the agent reads it but never executes instructions hidden inside it.
        attachmentContext = fenceUntrusted('attached files', extracted);
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
          LANGUAGE_RULE + '\n\n' +
            "You are NavBharatAI's friendly assistant. Reply briefly and warmly, following the " +
            "LANGUAGE rule above (match the user's language; never default to Hindi). Do not " +
            "mention which model you are.\n\n" + CREATOR_IDENTITY,
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
    const framework = typeof req.body?.framework === 'string' && req.body.framework ? req.body.framework : 'vite-react';
    const importUrl = typeof req.body?.importUrl === 'string' ? req.body.importUrl.trim() : '';
    try {
      // Native Claude for real tool-use, with a multi-provider text fallback
      // (Vertex → Gemini → Grok) so chat never dies if Claude is down/misconfigured.
      // Multi-provider build engine: Vertex/Gemini do the REAL build (function-calling),
      // Claude is the backstop — so builds work even when Claude is out of credits.
      // Cost-ladder routing (P2): the deterministic request analyser picks the
      // cheapest capable START model so a simple app (calculator/todo) builds on
      // Gemini Flash instead of Pro. Active within v3.0 (itself flag-gated); set
      // AGENTV3_COST_LADDER=off to fall back to the fixed model. Billing is
      // unchanged (Opus-equivalent markup) — this only trims real provider cost.
      // No provider name is surfaced to the user (kept to server telemetry only).
      const costLadderOn = process.env.AGENTV3_COST_LADDER !== 'off';
      const analysis = costLadderOn
        ? analyzeRequest({ prompt, powerMode: onlyOpus })
        : undefined;
      if (analysis) {
        console.log(
          `[AGENTV3] cost-ladder: ${analysis.reasoning} → build model ${tierToGeminiBuildModel(analysis.startTier)}`,
        );
      }
      const client = buildTurnRunner(
        analysis ? { geminiModel: tierToGeminiBuildModel(analysis.startTier) } : undefined,
      );
      // Admin routing policy: small app → Haiku, complex app → Sonnet, power → Opus
      // (was always Sonnet). Gemini/Vertex remain the fallback in buildTurnRunner.
      const model = selectBuildModel(analysis?.startTier, onlyOpus);
      // Build start time — used for cost-ladder telemetry duration (P2 measurement).
      const buildStartedAt = Date.now();
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
      // Git-native storage (Phase 2, flag-gated OFF by default): when active, the user's project
      // lives in a real private repo in the platform GitHub org — the durable, ~free source of
      // truth. We clone it into the (empty) sandbox at start and push it back at end. These stay
      // unset when storage is dormant, so every line below is a no-op on the live build path.
      let repoSync: GitRepoSync | undefined;
      let repoAuthedUrl = '';
      let repoBranch = 'main';
      // The PR/CI/merge client for build-end: the USER'S own GitHub (when they signed in with
      // GitHub) or the platform App (org storage). Either implements PrCapableClient.
      let prClient: PrCapableClient | undefined;
      let repoNameRef = '';
      try {
        // Emit an immediate status so the NDJSON stream is never silent while the
        // sandbox is being created (E2B VM setup can take several seconds). A long
        // silent gap after the headers is what trips Cloud Run / mobile-Safari
        // request timeouts and surfaces as a bare "Load failed" on the client.
        events.emit({ type: 'narration', agent: 'architect', text: 'Setting up your workspace…', ts: Date.now() });
        await actuator.ensureWorkspace(workspaceId, framework);
        // GIT-NATIVE HYDRATE: when storage is active, ensure the project repo exists and seed the
        // sandbox from it BEFORE the Firestore fallback. Best-effort — any failure here leaves the
        // build on the existing (Firestore) durability path, never blocking it.
        if (githubStorageActive()) {
          const projectId = typeof req.body?.sessionId === 'string' && req.body.sessionId ? req.body.sessionId : workspaceId;
          const repoName = repoNameForProject(userId, projectId);
          const userToken = typeof req.body?.githubToken === 'string' && req.body.githubToken ? req.body.githubToken : '';
          // PREFER THE USER'S OWN GITHUB: when the user signed in with GitHub, store the project in a
          // repo under THEIR account (their code, no lock-in) and run PR/CI/merge there. Best-effort —
          // any failure falls through to the platform-org store below.
          if (userToken) {
            try {
              const userClient = new UserGitHubClient(userToken);
              const login = await userClient.getLogin();
              const repo = await userClient.ensureRepo(repoName);
              repoAuthedUrl = userClient.authedCloneUrl(repoName, login);
              repoBranch = repo.defaultBranch || 'main';
              prClient = userClient;
              repoNameRef = repoName;
              repoSync = new GitRepoSync(actuator, workspaceId);
              const h = await repoSync.hydrateFromRepo(repoAuthedUrl);
              // Surface the repo so the UI can offer a "View on GitHub" link (full app control).
              if (repo.htmlUrl) events.emit({ type: 'repo', url: repo.htmlUrl, fullName: repo.fullName || `${login}/${repoName}`, ts: Date.now() });
              events.emit({
                type: 'narration', agent: 'architect',
                text: h.hydrated
                  ? `Loaded your project from your GitHub (${login}/${repoName}).`
                  : `Connected to your GitHub — this build will be saved to ${login}/${repoName}.`,
                ts: Date.now(),
              });
            } catch { repoSync = undefined; prClient = undefined; /* fall through to the platform store */ }
          }
          // PLATFORM-ORG STORE (Email/Phone users, or if the user-token path failed): the invisible
          // durable repo in the platform GitHub org via the App installation token.
          if (!repoSync) {
            try {
              const cfg = githubConfigFromEnv();
              if (cfg) {
                const ghClient = new GitHubAppClient(cfg);
                const repo: RepoInfo = await ghClient.ensureRepo(repoName);
                const token = await ghClient.getInstallationToken();
                repoAuthedUrl = ghClient.authedCloneUrl(repoName, token);
                repoBranch = repo.defaultBranch || 'main';
                prClient = ghClient;
                repoNameRef = repoName;
                repoSync = new GitRepoSync(actuator, workspaceId);
                const h = await repoSync.hydrateFromRepo(repoAuthedUrl);
                if (repo.htmlUrl) events.emit({ type: 'repo', url: repo.htmlUrl, fullName: repo.fullName || repoName, ts: Date.now() });
                if (h.hydrated) {
                  events.emit({ type: 'narration', agent: 'architect', text: 'Loaded your project from its GitHub repo.', ts: Date.now() });
                }
              }
            } catch { /* git-native is best-effort — fall back to Firestore durability below */ }
          }
        }
        // GITHUB IMPORT: if the user specified an existing repo URL, clone it now (before
        // durable-restore and git-native hydrate, so the import takes priority). Best-effort —
        // any failure emits a friendly narration and falls through to the normal empty workspace.
        if (importUrl) {
          try {
            events.emit({ type: 'narration', agent: 'architect', text: `Importing your project from ${importUrl}…`, ts: Date.now() });
            const existing = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
            if (Object.keys(existing.files).length === 0) {
              const importSync = new GitRepoSync(actuator, workspaceId);
              const githubToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
              const cloneUrl = githubToken ? importUrl.replace('https://', `https://${githubToken}@`) : importUrl;
              const h = await importSync.hydrateFromRepo(cloneUrl);
              if (h.hydrated) {
                events.emit({ type: 'narration', agent: 'architect', text: `Imported your project files from the repository. I'll analyze and improve this project.`, ts: Date.now() });
              }
            }
          } catch (importErr) {
            const m = importErr instanceof Error ? importErr.message : String(importErr);
            events.emit({ type: 'narration', agent: 'architect', text: `Could not import the repository (${m}). Starting with an empty workspace instead.`, ts: Date.now() });
          }
        }
        // FILE GUARDIAN: the files v3.0 created must STAY. The sandbox is ephemeral, so at the start
        // of every turn we compare what's in it against the durable history (WorkspaceFileStore) and
        // AUTO-RECOVER anything that went missing — a one-off deleted file is re-added, and a fully
        // recycled sandbox is restored whole (overwriting bare scaffold placeholders). It runs BEFORE
        // the agent edits anything, so it can only recover loss, never clobber legitimate new work.
        try {
          const saved = await loadWorkspaceFiles(workspaceId);
          const existing = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
          const plan = planFileGuardian(saved, existing.files);
          if (plan.count > 0) {
            await writeWorkspaceFiles(actuator, workspaceId, plan.restore);
            events.emit({
              type: 'narration',
              agent: 'architect',
              text: plan.mode === 'full'
                ? `🛡️ Your project looked lost from the sandbox, so I restored all ${plan.count} file(s) from history.`
                : `🛡️ Recovered ${plan.count} file(s) that were missing — pulled back from history.`,
              ts: Date.now(),
            });
          }
        } catch { /* best-effort — the guardian never blocks a build */ }
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
      // Web search (ported from Engineer AI): the Architect can look up package versions,
      // framework docs, and error meanings (Brave if BRAVE_API_KEY set, else DuckDuckGo).
      const webSearch = makeWebSearch();
      // Real persistent deploy (Firebase Hosting, ported from Engineer AI): publish the built app
      // to a permanent public URL. Uses ADC (Cloud Run service account); honest error if missing.
      // R5 §5.1 — deploy through the multi-provider registry (no lock-in). Defaults to Firebase
      // Hosting today; as Netlify/Vercel/etc. land, the chosen provider routes here. Wrapped so every
      // successful publish is durably recorded (DeploymentStore) and recoverable after a reconnect.
      const githubTokenForDeploy = typeof req.body?.githubToken === 'string' ? req.body.githubToken : undefined;
      // Honor the user's chosen hosting provider (no lock-in). Falls back to the default when the
      // choice is absent or unknown; an unconfigured choice still routes there and returns an honest
      // "configure <PROVIDER>" error rather than silently deploying somewhere else.
      const chosenProviderId = typeof req.body?.deployProvider === 'string' ? req.body.deployProvider : DEFAULT_DEPLOY_PROVIDER;
      const deployProvider = getDeployProvider(chosenProviderId) ?? getDeployProvider(DEFAULT_DEPLOY_PROVIDER) ?? getDeployProvider('firebase')!;
      const deploy = withDeploymentPersistence(
        (ws, files) => deployProvider.deploy(ws, files, { userId, githubToken: githubTokenForDeploy }),
        userId,
      );
      // DURABLE FILE CAPTURE: record the exact content of every file the agent writes (reliable —
      // straight from the write op, not a later listFiles that can come back empty). Persisted to
      // Firestore at build end so the source survives a sandbox loss and restores next session.
      const writtenFiles = new Map<string, string>();
      // Fix 2 — PROGRESSIVE SERVER PERSISTENCE: save every written file to Firestore
      // within 3 s of each write. If the client connection drops mid-build (tab close,
      // network hiccup), the files already written are safely on the server. The final
      // save at build-end (below) is still the authoritative snapshot; this is the
      // mid-build safety net. GitHub push still happens only after 100% completion.
      let _progressPersistTimer: ReturnType<typeof setTimeout> | null = null;
      const onFileWrite = (path: string, content: string) => {
        writtenFiles.set(path, content);
        if (_progressPersistTimer) clearTimeout(_progressPersistTimer);
        _progressPersistTimer = setTimeout(() => {
          if (writtenFiles.size > 0) {
            saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)).catch(() => {});
          }
        }, 3_000);
      };
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git, secondOpinion, consensus, webSearch, deploy, onFileWrite, framework);

      // Surgical edit mode (gold standard): when the user is editing an existing
      // app rather than building fresh, inject the CURRENT file tree and the
      // edit-mode prefix so the agent reads existing files and makes minimum,
      // targeted edit_file patches — never rebuilding everything from scratch.
      // Best-effort: a listFiles failure falls back to the edit prefix without a
      // tree, and a non-edit turn uses the normal architect prompt unchanged.
      let architectSystem = architectSystemPrompt(framework);
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

      // Base runner options — shared by the default build AND any escalated rebuild (P3).
      // Only client/model/conversationId vary per tier; everything else is identical so the
      // escalated build streams to the same surfaces and writes to the same workspace.
      // A new build or an edit MUST produce files — tell the runner so it reports a no-tool
      // "I'm preparing a plan…" reply as a FAILED build (ok:false) instead of a fake success.
      const expectsArtifacts = intent === 'new_build' || intent === 'edit_existing';
      const baseRunnerOpts = {
        dispatcher,
        state,
        events,
        system: architectSystem,
        tools: catalogForTools(roleConfig('architect').tools),
        onlyOpus,
        powerLevel: powerLevelReq,
        effort: powerSpecResolved.effort,
        thinking,
        maxBudgetUsd: budget,
        maxSteps,
        toolConcurrency,
        agentRole: 'architect' as const,
        signal: abort.signal,
        expectsArtifacts,
        // R2 §1.1 — top-level build runners (which spread baseRunnerOpts) get the mandatory
        // readiness gate; sub-agents (SubAgent.ts, separate opts) never do.
        readinessGate: readinessGateEnabled(),
        // WATCHDOG — hard wall-clock cap so a build can never hang for 20-30 min (0 = disabled).
        maxBuildMs: maxBuildSeconds() * 1000,
      };
      const runner = new AgentRunner({
        ...baseRunnerOpts,
        client,
        model,
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
        // Admin policy: planning runs on GROK (cheap, strong reasoning) with a Claude
        // fallback if Grok is down. When no Grok key is set, use the normal build client.
        // The plan's Claude fallback model stays cheap (Haiku) — Grok ignores it (forces
        // grok-3); only the fallback path uses it.
        const planGrok = grokPlanRunner();
        const planRunner = new AgentRunner({
          client: planGrok ?? client,
          dispatcher: new ToolDispatcher(actuator, workspaceId, state, events),
          state,
          events,
          model: planGrok ? haikuModel() : model,
          system: planSystemPrompt(),
          tools: catalogForTools(['update_todo']),
          onlyOpus,
          powerLevel: powerLevelReq,
          effort: powerSpecResolved.effort,
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

      // Cost-ladder escalation (P3) — DORMANT unless AGENTV3_ESCALATION=on. When off,
      // this is exactly `await runner.run(buildPrompt)` (the start-tier build, once). When
      // on, the build runs cheap-first and climbs the analyser's escalation path ONLY when
      // the objective gate (build completed?) fails — the last tier is always delivered as a
      // best-effort backstop, so the build never "breaks". `deliveredTier` feeds telemetry.
      let result: Awaited<ReturnType<typeof runner.run>>;
      let deliveredTier: StartTier = analysis?.startTier ?? (onlyOpus ? 'opus' : 'gemini');
      if (analysis && shouldEscalateBuild(analysis, onlyOpus)) {
        const esc = await runWithEscalation(analysis.escalationPath, {
          buildOnTier: async (tier, attempt) => {
            if (attempt === 1) return runner.run(buildPrompt); // reuse the start-tier runner
            // Escalated attempt: a stronger, Claude-first runner on the same workspace/stream.
            events.emit({ type: 'narration', agent: 'architect', text: `Escalating to a stronger model to finish the build…`, ts: Date.now() });
            const escRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ geminiModel: tierToGeminiBuildModel(tier), claudeFirst: true }),
              model: resolveModel(tier === 'opus'),
              persistence: {
                store: getConversationStore(),
                conversationId: randomUUID(),
                userId: userId ?? 'anon',
                workspaceId,
                title: deriveTitle(prompt),
              },
            });
            return escRunner.run(buildPrompt);
          },
          gate: async (build) => escalationGate(build.ok),
          onAttempt: (tier, attempt) => console.log(`[AGENTV3] escalation attempt ${attempt} on tier ${tier}`),
          onEscalate: (from, to, reason) => console.log(`[AGENTV3] escalate ${from} → ${to}: ${reason}`),
        });
        result = esc.build;
        deliveredTier = esc.tier;
        if (esc.escalations > 0) {
          console.log(`[AGENTV3] delivered tier=${esc.tier} after ${esc.escalations} escalation(s), gatePassed=${esc.gatePassed}`);
        }
      } else {
        result = await runner.run(buildPrompt);
      }

      // SAFETY NET (the "fake build" fix): if a build/edit was expected to produce files but
      // produced ZERO — the cheap model replied ("I'm preparing a plan…") instead of building —
      // retry ONCE with a Claude-first runner. Claude reliably uses the build tools, so this
      // turns a fake "done" into a real app. Always on for this hard failure, independent of the
      // P3 quality-escalation flag. Skipped if the user already stopped the build.
      // COST CAP: if the first attempt already exceeded the per-session cap, skip the retry
      // so a failed todo app never silently spirals to $26. An honest error is emitted instead.
      const costAfterFirstAttempt = result.billedUsd;
      const capUsd = sessionCostCapUsd();
      if (expectsArtifacts && writtenFiles.size === 0 && costAfterFirstAttempt > capUsd) {
        events.emit({
          type: 'narration', agent: 'architect',
          text: `⚠️ Build stopped: session cost ($${costAfterFirstAttempt.toFixed(2)}) reached the $${capUsd.toFixed(0)} cap. No files were produced — you will not be charged. Try again with a simpler prompt or contact support.`,
          ts: Date.now(),
        });
      }
      if (expectsArtifacts && writtenFiles.size === 0 && !abort.signal.aborted && costAfterFirstAttempt <= capUsd) {
        events.emit({ type: 'narration', agent: 'architect', text: 'The first attempt produced no files — rebuilding with a stronger model…', ts: Date.now() });
        // The "stronger model" is the power-OFF ceiling: Opus at its LOWEST effort
        // (admin rule 2026-06-27 — "power off me Opus ka sabse lower version"). In a
        // power-ON build it's already Opus at the selected effort; here we force Opus
        // for the retry even in normal mode, at the ceiling effort. Billing is unchanged
        // (normal mode still bills Sonnet×3.5 via baseRunnerOpts.powerLevel) — no surprise.
        const retryRunner = new AgentRunner({
          ...baseRunnerOpts,
          client: buildTurnRunner({ claudeFirst: true }),
          model: resolveModel(true), // Opus
          effort: powerSpecResolved.effort ?? powerSpecResolved.ceilingEffort,
          persistence: {
            store: getConversationStore(),
            conversationId: randomUUID(),
            userId: userId ?? 'anon',
            workspaceId,
            title: deriveTitle(prompt),
          },
        });
        try {
          const retry = await retryRunner.run(buildPrompt);
          if (retry.ok || writtenFiles.size > 0) { result = retry; deliveredTier = 'sonnet'; }
        } catch (e) {
          console.log(`[AGENTV3] empty-build Claude retry failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // R4 §2.3 — RUNTIME-ERROR AUTO-FIX LOOP (opt-in: AGENTV3_AUTOFIX=on). A build can compile
      // and even render yet still throw runtime errors the browser captured (an undefined call, a
      // failed fetch, a React render crash). Feed those captured errors back into a bounded,
      // Claude-first repair pass that fixes → reloads → re-verifies, then WARN honestly if any
      // remain. Best-effort and budget-capped per attempt — it can never break or hang the build.
      if (autoFixEnabled() && expectsArtifacts && result.ok && !abort.signal.aborted && actuator.getConsoleErrors) {
        const maxAttempts = autoFixMaxAttempts();
        // Advancing window: each capture only considers errors NEWER than the previous fix attempt,
        // so a repaired error logged before the fix is never re-detected and we cannot loop on it.
        let sinceMs = Date.now() - 180_000;
        for (let attempt = 1; attempt <= maxAttempts && !abort.signal.aborted; attempt++) {
          let captured: RuntimeError[] = [];
          try {
            captured = filterActionableErrors((await actuator.getConsoleErrors!(workspaceId, sinceMs)).errors);
          } catch { break; /* console capture needs a real sandbox — skip silently */ }
          if (captured.length === 0) break; // ran clean — nothing to fix
          events.emit({ type: 'narration', agent: 'architect', text: `🔧 Detected ${captured.length} runtime error(s) — auto-fixing (attempt ${attempt}/${maxAttempts})…`, ts: Date.now() });
          const fixStart = Date.now();
          const fixRunner = new AgentRunner({
            ...baseRunnerOpts,
            client: buildTurnRunner({ claudeFirst: true }),
            model: resolveModel(onlyOpus),
            persistence: { store: getConversationStore(), conversationId: randomUUID(), userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
          });
          try {
            const fix = await fixRunner.run(buildRepairPrompt(captured));
            if (fix.ok) result = fix;
          } catch (e) {
            console.log(`[AGENTV3] auto-fix attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
          sinceMs = fixStart; // next check only sees errors from the post-fix reload
        }
        // Honest final check: if errors remain after the repair budget is spent, WARN — never claim clean.
        try {
          const remaining = filterActionableErrors((await actuator.getConsoleErrors!(workspaceId, sinceMs)).errors);
          if (remaining.length) events.emit({ type: 'narration', agent: 'architect', text: autoFixWarning(remaining), ts: Date.now() });
        } catch { /* best-effort */ }
      }

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
          let rFiles = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
          // If sandbox listFiles came back empty but the build wrote real files, use the
          // captured write-time paths as a fallback so the reviewer is never skipped after
          // a successful build due to a transient sandbox read hiccup.
          if (!hasReviewableSource(rFiles) && writtenFiles.size > 0) {
            rFiles = [...writtenFiles.keys()];
          }
          const rSample = await Promise.all(
            rFiles.slice(0, 5).map(async (p) => ({
              path: p,
              content: writtenFiles.has(p)
                ? (writtenFiles.get(p) ?? '')
                : await actuator.readFile(workspaceId, p).catch(() => ''),
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

      // DURABLE FILE SAVE: persist the build's source so it never vanishes. Start from the files
      // we captured at write-time (reliable), then supplement with a sandbox scan (catches sub-
      // agent writes when listFiles works). Skip if BOTH are empty so a read hiccup never
      // overwrites a previously-good saved set with nothing. Best-effort — never blocks the build.
      try {
        const toSave: Record<string, string> = {};
        try {
          const scanned = await collectWorkspaceFiles(actuator, workspaceId);
          Object.assign(toSave, scanned.files);
        } catch { /* listFiles can be flaky — the captured writes below are the reliable source */ }
        for (const [p, c] of writtenFiles) toSave[p] = c; // captured writes win (freshest, reliable)
        if (Object.keys(toSave).length > 0) {
          saveWorkspaceFiles(workspaceId, toSave).catch(() => {});
        }
      } catch { /* file persist is best-effort */ }

      // GIT-NATIVE PUSH: when storage is active, commit + push the sandbox back to the project's
      // GitHub repo so it is the durable source of truth for next session. Best-effort and only
      // when files were actually produced — never blocks or fails the build.
      if (repoSync && repoAuthedUrl && writtenFiles.size > 0) {
        try {
          const msg = `NavBharatAI build: ${deriveTitle(prompt)}`;
          // PR MODE (Phase 3, opt-in GITHUB_PR_MODE): push to a build branch, open a PR, and merge
          // it ONLY when CI is green (Claude-Code-style). Default mode force-pushes straight to the
          // project's default branch. Both best-effort — never block or fail the build.
          if (githubPrMode() && prClient && repoNameRef) {
            const buildBranch = `nbi/build-${Date.now()}`;
            const pushed = await repoSync.pushAll(repoAuthedUrl, buildBranch, msg);
            if (pushed.pushed) {
              const flow = await mergeViaPullRequest(prClient, repoNameRef, {
                head: buildBranch, base: repoBranch, title: msg,
                body: 'Automated build by NavBharatAI Pro v3.0.',
              });
              if (flow.note) {
                events.emit({ type: 'narration', agent: 'architect', text: flow.note, ts: Date.now() });
              }
            }
          } else {
            const pushed = await repoSync.pushAll(repoAuthedUrl, repoBranch, msg);
            if (pushed.pushed) {
              events.emit({ type: 'narration', agent: 'architect', text: 'Saved your project to its GitHub repo.', ts: Date.now() });
            }
          }
        } catch { /* git-native push is best-effort */ }
      }

      // P9 — new-user free onboarding builds (DORMANT unless AGENTV3_FREE_ONBOARDING_BUILDS>0).
      // For an eligible new user, a SUCCESSFUL build is on the house: nothing is recorded and
      // the user sees ₹0. Only consumed on result.ok (a failed build never burns a free credit),
      // and fail-safe — any error leaves the user billed normally. effectiveBilledUsd flows into
      // both the cost record AND the result event so the customer-facing amount matches.
      let effectiveBilledUsd = result.billedUsd;
      // NEVER charge for a build that produced nothing. If the user asked for an app/edit and
      // zero files were created (even after the Claude retry), the build failed — bill ₹0.
      // "Preview is EARNED" cuts both ways: no artifacts, no charge.
      if (expectsArtifacts && writtenFiles.size === 0) {
        effectiveBilledUsd = 0;
      }
      if (userId && result.ok && effectiveBilledUsd > 0 && freeOnboardingLimit() > 0) {
        const isFree = await onboardingCreditStore
          .consumeFreeBuild(userId, freeOnboardingLimit())
          .catch(() => false);
        if (isFree) {
          effectiveBilledUsd = 0;
          events.emit({ type: 'narration', agent: 'architect', text: '🎁 This build is on us — welcome to NavBharatAI Pro!', ts: Date.now() });
        }
      }

      // Bill the user the marked-up cost (D5/D6), recorded in the same place the
      // platform records every build's cost. Best-effort — never blocks the run.
      // Internal accounting stays in USD (currency-stable); the customer-facing amount
      // is shown in INR (billedInr = billedUsd × the real-time USD→INR rate).
      if (userId && effectiveBilledUsd > 0) {
        userCostStore.record(userId, effectiveBilledUsd).catch(() => {});
      }

      // Cost-ladder telemetry (P2 measurement): record this build's task type, start
      // tier, billed amount, tokens, success, and duration so the savings AND the
      // per-tier quality are MEASURABLE (the P8 cutover gate needs this data). Best-
      // effort — never blocks the run. Recorded for every build, signed-in or not.
      agentV3CostTelemetry
        .record({
          taskType: analysis?.taskType ?? 'unknown',
          // Record the tier the build was actually DELIVERED on (after any P3 escalation),
          // so per-tier success rates reflect what really ran, not just the start tier.
          startTier: deliveredTier,
          billedUsd: result.billedUsd,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          ok: result.ok,
          powerMode: onlyOpus,
          durationMs: Math.max(0, Date.now() - buildStartedAt),
        })
        .catch(() => {});

      // TEMP DEBUG: tag the build reply with the provider/model (Claude primary; the
      // resilient runner already self-labels in the text if it fell back to a free provider).
      const buildTag = providerDebugTag(`Claude (${model})`);
      if (buildTag) events.emit({ type: 'narration', agent: 'architect', text: buildTag.trim(), ts: Date.now() });
      emit({ type: 'result', ...result, billedUsd: effectiveBilledUsd, billedInr: Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100 });
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
