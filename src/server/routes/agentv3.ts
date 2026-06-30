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
  fastBuildModel,
  opusModel,
  architectSystemPrompt,
  planSystemPrompt,
  editModePrefix,
  dateContextBlock,
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
import { BuildDiagnostics, type BuildDiagnosticsReport } from '../AgentV3/BuildDiagnostics';
import { runOneShot, classifyForOneShot, oneShotEnabled, parseFileBlocks } from '../AgentV3/OneShotBuilder';
import { runSimpleBuild, repairSystemPrompt, repairUserPrompt } from '../AgentV3/SimpleBuilder';
import { buildProjectContext, buildRunningSummary, formatPlanState, parsePlanState } from '../AgentV3/ProjectContext';
import { computePlanProgress } from '../AgentV3/PlanProgress';
import { withTimeout } from '../AgentV3/asyncUtils';
import { analyzePreviewHtml, buildPreviewRepairPrompt } from '../AgentV3/PreviewVerify';
import { billedAmountUsd } from '../AgentV3/pricing';
import OpenAI from 'openai';
import type { TurnRunner } from '../AgentV3/ClaudeClient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { redactPII } from '../AgentV3/SecretRedactor';
import { audit } from '../lib/audit';
import { userPreferenceStore } from '../AgentV3/UserPreferenceStore';
import { userLessonBrainStore } from '../AgentV3/UserLessonBrain';
import { extractEntities, entityRequirementsContext } from '../AgentV3/EntityExtractor';
import { chatResponseCache, chatCacheEnabled, hashKey } from '../AgentV3/PromptCache';
import { dialoguePhaseContext } from '../AgentV3/DialogueStateManager';
import { registerPrompt } from '../AgentV3/PromptRegistry';
import { buildRetrospective } from '../lib/BuildRetrospectiveEngine';
import { estimateBuildTime, complexityFromPrompt } from '../lib/BuildTimeEstimator';
import { incrementalBuildCache, hashFiles, diffHashes } from '../AppMakerLab/IncrementalBuildCache';
import { startBuildTrace } from '../telemetry/TracingManager';
import { DecisionTrace, persistDecisionTrace, getDecisionTrace } from '../AgentV3/DecisionTraceManager';
import { planAutoTests } from '../AgentV3/TestGenerationAgent';
import { locationTag } from '../AppMakerLab/intelligence/LogIntelligenceEngine';
import { estimateTokens, contextUsage } from '../AgentV3/TokenEstimator';
import { buildGroundedContext, tokenize as rerankTokenize } from '../AgentV3/ContextReranker';
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
import { classifyIntentSmart, wantsFreshStart } from '../AgentV3/IntentClassifier';
import { decidePlanning } from '../AgentV3/ComplexityClassifier';
import { analyzeRequest, type StartTier, type AnalysisResult } from '../AgentV3/RequestAnalyser';
import { agentV3CostTelemetry } from '../AgentV3/AgentV3CostTelemetry';
import { runWithEscalation, type GateVerdict } from '../AgentV3/EscalationOrchestrator';
import { reviewBuild, formatReview, hasReviewableSource } from '../AgentV3/ReviewerAgent';
import {
  saveWorkspaceMemory,
  restoreWorkspaceMemory,
  loadWorkspaceMemory,
} from '../AgentV3/FirestoreWorkspaceMemoryStore';
import { saveWorkspaceFiles, loadWorkspaceFiles, removeWorkspaceFiles, countWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { saveDiagnostics, loadDiagnostics } from '../AgentV3/DiagnosticsStore';
import { cssConsistencyError } from '../AgentV3/CssConsistency';
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
  // Durable chat history by DEFAULT — it survives a process restart, a redeploy, and
  // horizontal scaling across Cloud Run instances. Previously this was OFF unless
  // AGENTV3_PERSIST_FIRESTORE='true' was set, so the store fell back to IN-MEMORY: a
  // reload that landed on a different instance — or any redeploy — lost the whole
  // conversation ("reload pe data gayab"). Now Firestore is the default; opt out with
  // AGENTV3_PERSIST_FIRESTORE=false. Unit tests (VITEST) always use the in-memory store.
  const useFirestore = process.env.AGENTV3_PERSIST_FIRESTORE !== 'false' && !process.env.VITEST;
  if (useFirestore) {
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
 * (the agent looping when a broken preview can't be verified). Default 18 minutes — enough headroom
 * for a real multi-file app whose final "start dev server + verify it renders" step legitimately
 * takes a few extra minutes (dev-server startup ~20-40 s per attempt, plus restarts on a port
 * conflict). Cost is bounded SEPARATELY by AGENTV3_MAX_BUILD_USD, so this only guards wall-clock, not
 * spend. Admin-tunable via AGENTV3_MAX_BUILD_SECONDS; set to 0 to disable (not recommended).
 */
export function maxBuildSeconds(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_SECONDS);
  if (raw === 0) return 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 1080;
}

/**
 * Resolve `p`, but REJECT with a labelled error if it has not settled within `ms`. Used to bound the
 * request-setup calls (intent classify, plain chat, vision describe, monthly-cap) that run BEFORE the
 * build wall-clock deadline timer is armed — without this, a single stalled provider/Firestore call hangs
 * the whole HTTP request forever (the deadline never starts). Pure + exported for testing.
 */
export function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Read a workspace's files for the file explorer + in-browser preview. Tries the LIVE sandbox first
 * (freshest), but falls back to the DURABLE saved files (Firestore) when the sandbox is gone, empty,
 * or errors — e.g. "[not_found] lstat /home/user/workspace: no such file or directory" after the
 * sandbox was paused/reaped. The in-browser preview is meant to work WITHOUT a live sandbox, so it
 * must never fail just because one isn't running. Never throws.
 */
async function collectFilesWithSavedFallback(
  actuator: IEngineerActuator,
  workspaceId: string,
): Promise<{ files: Record<string, string>; skipped: string[]; source: 'live' | 'saved' }> {
  try {
    const live = await collectWorkspaceFiles(actuator, workspaceId);
    if (Object.keys(live.files).length > 0) return { files: live.files, skipped: live.skipped, source: 'live' };
  } catch { /* live sandbox gone/empty/errored — fall through to the durable saved files */ }
  const saved = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
  return { files: saved, skipped: [], source: 'saved' };
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
/** The most recent build's diagnostics report per build key (userId) — for download/endpoint. */
const lastDiagnostics = new Map<string, BuildDiagnosticsReport>();

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
 * The v3.0 BUILD turn-runner. Builds run on CLAUDE ONLY (Haiku → Sonnet → Opus) because only
 * Claude reliably does REAL tool-use (actually calls write_file). Gemini/Vertex HALLUCINATE in
 * the tool loop — they describe creating files but never call the tools, so the build finishes
 * with ZERO real files (and the model later says "I'm an AI, I have no file system"). That is
 * exactly the "file banane ka hallucination" the admin observed, and why the Anthropic dashboard
 * showed $0 spend: every build was silently running on Gemini/Vertex, never Claude.
 *
 * So the build chain is Claude(selected model) → Claude-Haiku backstop. Gemini/Vertex are kept
 * for cheap CHAT only, NOT builds. If Claude genuinely fails, the build errors HONESTLY with the
 * real Claude error (bad key / wrong model id / overload) instead of faking files on Gemini.
 * AGENTV3_BUILD_ALLOW_GEMINI=1 re-adds Vertex/Gemini as a last-resort build fallback.
 * Per the v3.0 constitution NavBharatAI pays the Claude cost; the user is billed the
 * Opus-equivalent markup. Models are env-overridable (AGENTV3_{HAIKU,SONNET,OPUS}_MODEL).
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

/** The dev-server port a framework's `npm run dev` listens on — used by the OneShot lane to
 *  publish the preview after a one-shot build. Pure + exported for testing. */
export function oneShotDevPort(framework: string): number {
  if (/next|nuxt|nest|express|fastify|node/i.test(framework)) return 3000;
  if (/angular/i.test(framework)) return 4200;
  if (/astro/i.test(framework)) return 4321;
  if (/static|vanilla/i.test(framework)) return 3000;
  if (/fastapi|flask|django|python/i.test(framework)) return 8000;
  return 5173; // vite-react / vue / svelte and the default
}

/**
 * Parse a cheap-floor model env into an ordered model LADDER (newest → 1-step-back). Accepts a
 * comma-separated list (`glm-4.7,glm-4.6`) so a retired/unresponsive latest model falls through to
 * the previous one before Claude — admin-requested resilience after `kimi-k2-0905-preview` was
 * discontinued (a single pinned id 404s on a valid key). A single id stays valid (list of 1, the
 * old behaviour). Blank/whitespace entries are dropped; an empty env → the provided default ladder.
 * Pure + exported for testing.
 */
export function parseModelLadder(env: string | undefined, fallback: string[]): string[] {
  const list = (env || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/**
 * NavBharatAI Pro v3.0 — optional CHEAP BUILD FLOOR (admin cost-down lever, DEFAULT OFF).
 *
 * Returns OpenAI-compatible build runners (GLM / Kimi) that LEAD the build chain ONLY when
 * `AGENTV3_CHEAP_FLOOR` names a provider AND that provider's key is present. Otherwise it
 * returns `[]`, so the build chain stays **byte-for-byte today's Claude path** — the instant,
 * no-redeploy rollback. These runners are tried FIRST; `buildTurnRunner` keeps Claude (+ the
 * forced-Haiku backstop) permanently after them, so a cheap-model failure NEVER breaks a build.
 *
 * MODEL LADDER (admin-requested): each provider emits ONE runner per model id in its ladder, newest
 * → 1-step-back, so a retired/unresponsive latest model (e.g. a 404 on a discontinued id, an outage,
 * a rate-limit) falls through to the previous cheap model — then Claude. The existing
 * `MultiProviderTurnRunner` already does error-based per-turn fallback, so this is just "more runners
 * prepended" — no new orchestration. (This covers "no response / unavailable"; it does NOT cover a
 * model that replies but builds badly — that stays the objective gate + Claude escalation's job.)
 * The ladder stays CHEAP coding models, NOT the flagship — escalation owns "go stronger".
 *
 * Mirrors `grokPlanRunner`: `OpenAiToolRunner` forces its own `opts.model`, so the cost-ladder /
 * `selectBuildModel` / `models.ts` are never touched — routing decides ORDER, the runner decides
 * MODEL. A missing key OR a misconfigured provider is skipped (Claude still backstops). The runner
 * name stays the provider (`GLM`/`KIMI`) so the PR4 `deliveredVia` cheap-vs-Claude split stays clean.
 * Pure-ish + flag-gated; exported for unit testing. Base URLs/models are env-overridable.
 */
export function cheapBuildFloorRunners(): NamedRunner[] {
  const floor = (process.env.AGENTV3_CHEAP_FLOOR || 'off').trim().toLowerCase();
  if (floor === 'off' || floor === '') return [];
  const runners: NamedRunner[] = [];
  const add = (name: string, apiKey: string | undefined, baseURL: string, models: string[]): void => {
    if (!apiKey) return; // no key → a second, independent off-switch
    for (const model of models) {
      try {
        const client = new OpenAI({ apiKey, baseURL, timeout: 60_000, maxRetries: 0 });
        runners.push({ name, runner: new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model }) });
      } catch { /* misconfigured model rung — skip; the next rung / Claude still backstops */ }
    }
  };
  if (floor === 'glm') {
    add('GLM', process.env.GLM_API_KEY, process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4', parseModelLadder(process.env.GLM_MODEL, ['glm-4.7', 'glm-4.6']));
  } else if (floor === 'kimi') {
    add('KIMI', process.env.KIMI_API_KEY, process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1', parseModelLadder(process.env.KIMI_MODEL, ['kimi-k2.7-code', 'kimi-k2.6']));
  }
  return runners;
}

/**
 * Whether the cheap build floor (GLM/Kimi) may LEAD a build for a given start tier. The floor is for
 * SIMPLE/MEDIUM apps (gemini/haiku tiers); a COMPLEX app (sonnet) or POWER build (opus) starts
 * directly on the strong model — "complex → seedha Sonnet" — so a likely-doomed cheap attempt is not
 * wasted before escalation. An unknown tier (cost-ladder off) is allowed (the admin opted in and
 * Claude still backstops). AGENTV3_CHEAP_FLOOR_ALL_TIERS=1 overrides → apply the floor to every tier.
 * Pure + exported for testing.
 */
export function cheapFloorAllowedForTier(startTier?: string): boolean {
  if (process.env.AGENTV3_CHEAP_FLOOR_ALL_TIERS === '1') return true;
  const tier = (startTier || '').toLowerCase();
  return tier === 'gemini' || tier === 'haiku' || tier === '';
}

/**
 * Account CANARY gate for the cheap build floor. `AGENTV3_CHEAP_FLOOR_USERS` is an optional
 * comma-separated allowlist of user ids AND/OR emails: when SET, the cheap floor leads ONLY for
 * those accounts (e.g. the admin's own) — everyone else stays on today's Claude path. When
 * EMPTY/unset (the default), the floor applies to all users (no change). This is the "flag-gated
 * to your account before all users" rollout step: enable the floor in production but limit blast
 * radius to yourself first, watch the `deliveredVia` telemetry, then widen by clearing the list.
 * A uid is matched exactly (Firebase uids are case-sensitive); an email is matched
 * case-insensitively (so `Admin@x.com` in the list matches `admin@x.com`). Pure + exported.
 */
export function cheapFloorAllowedForUser(userId: string | null | undefined, email?: string | null): boolean {
  const allow = (process.env.AGENTV3_CHEAP_FLOOR_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length === 0) return true; // no allowlist → every user (default, unchanged)
  if (userId && allow.includes(userId)) return true; // exact uid match (case-sensitive)
  if (email) { const mail = email.toLowerCase(); if (allow.some(a => a.toLowerCase() === mail)) return true; }
  return false;
}

/**
 * PR4 delivery telemetry — given per-provider turn counts gathered over a build (via the
 * `onProviderUsed` callback), return the provider that drove the MOST turns: the build's
 * dominant builder. AgentV3CostTelemetry records this as `deliveredVia`, so an admin can see
 * whether the cheap floor (GLM/KIMI) or Claude actually delivered — the rollback tripwire.
 * Ties keep the first-seen (leading) provider; an empty map → undefined (nothing recorded,
 * e.g. the non-agentic SimpleBuild/OneShot lanes). Pure + exported for testing.
 */
export function dominantProvider(turns: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestN = -1;
  for (const [name, n] of turns) {
    if (n > bestN) { best = name; bestN = n; }
  }
  return best;
}

function buildTurnRunner(opts?: { geminiModel?: string; claudeFirst?: boolean; allowCheapFloor?: boolean; onProviderError?: (name: string, err: unknown) => void; onProviderUsed?: (used: string, fellBackFrom: string[]) => void }): TurnRunner {
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
  // Optional cheap floor (GLM/Kimi) that LEADS the build chain — [] unless the caller OPTS IN
  // (allowCheapFloor: the FIRST build attempt for a non-complex app) AND AGENTV3_CHEAP_FLOOR names a
  // provider with its key present. Escalation / claudeFirst retries never opt in, so they stay on
  // Claude. Computed before the Claude-only early-return so the floor still applies in a Claude-only
  // env (no Vertex/Gemini configured).
  const floorRunners = opts?.allowCheapFloor ? cheapBuildFloorRunners() : [];
  if (cheap.length === 0 && floorRunners.length === 0) return makeResilientTurnRunner(new ClaudeClient(undefined, buildRetry)); // Claude-only env
  const claude: NamedRunner = { name: 'CLAUDE', runner: new ClaudeClient(undefined, buildRetry) };
  // P7 failover hardening: a final Claude-HAIKU backstop that FORCES the Haiku model
  // regardless of the turn's requested model. It only ever runs after every prior provider
  // (Vertex → Gemini → primary Claude) has thrown, so normal builds are unaffected — but if
  // Sonnet/Opus is overloaded or rate-limited, Haiku still completes the turn and the build
  // never breaks. Billing is unchanged (Opus-equivalent markup, D5/D6) regardless of which
  // model actually answers. AGENTV3_DISABLE_HAIKU_BACKSTOP=1 removes it if ever needed.
  const haikuBackstop: NamedRunner = { name: 'CLAUDE_HAIKU', runner: forceModelRunner(new ClaudeClient(undefined, buildRetry), haikuModel()) };
  const withBackstop = process.env.AGENTV3_DISABLE_HAIKU_BACKSTOP === '1' ? [] : [haikuBackstop];
  // Builds run on CLAUDE ONLY (Haiku/Sonnet/Opus do REAL tool-use → real files). Gemini/Vertex
  // HALLUCINATE in the tool-use loop — they reply describing files ("creating index.html…") but
  // never actually call write_file, so the build "succeeds" with ZERO real files and the model
  // later claims "I'm an AI, I have no file system". So they are EXCLUDED from the build chain
  // (they remain the cheap CHAT providers only). If Claude genuinely fails, the build errors
  // HONESTLY with the real Claude error (e.g. a bad key or model id) instead of silently making
  // fake files on Gemini. AGENTV3_BUILD_ALLOW_GEMINI=1 re-adds Vertex/Gemini as a last resort.
  const fallback = process.env.AGENTV3_BUILD_ALLOW_GEMINI === '1' ? cheap : [];
  const claudeFirst = resolveClaudeFirst(opts?.claudeFirst, process.env.AGENTV3_BUILD_CLAUDE_FIRST);
  const baseChain = claudeFirst ? [claude, ...fallback, ...withBackstop] : [...fallback, claude, ...withBackstop];
  // Cheap floor LEADS when active; [] → `[...[], ...baseChain]` is byte-for-byte today's chain.
  // Claude + Haiku backstop remain inside baseChain, so failures always fall back safely.
  const chain = [...floorRunners, ...baseChain];
  return makeMultiProviderTurnRunner(chain, {
    onProviderUsed: (used, from) => {
      if (from.length) console.log(`[AGENTV3] build turn via ${used} (after ${from.join(' → ')})`);
      // PR4 — surface EVERY delivered turn's provider (even with no fallback) so the caller can
      // measure which model actually drove the build (the cheap-floor-vs-Claude tripwire).
      opts?.onProviderUsed?.(used, from);
    },
    onProviderError: (name, err) => {
      console.log(`[AGENTV3] build ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      opts?.onProviderError?.(name, err);
    },
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
      // Resilient resume: also return the durably-saved plan/todos so a session reopened on a COLD
      // server instance (in-memory plan gone after a ~15-min idle recycle) repopulates its plan
      // panel from Firestore instead of resetting to 0/N. Best-effort — a failure here must never
      // fail the resume; the client simply shows no restored plan.
      let workspaceState: { todos: ReturnType<typeof parsePlanState> } | undefined;
      try {
        const wsId = rec && typeof (rec as { workspaceId?: unknown }).workspaceId === 'string'
          ? (rec as { workspaceId: string }).workspaceId
          : null;
        if (wsId) {
          const snap = await loadWorkspaceMemory(wsId).catch(() => null);
          const planNote = snap?.episodes?.slice().reverse().find(
            (e) => e.kind === 'note' && typeof e.text === 'string' && e.text.startsWith('PLAN_STATE'),
          );
          const todos = planNote ? parsePlanState(planNote.text) : [];
          if (todos.length > 0) workspaceState = { todos };
        }
      } catch { /* plan restore is best-effort — never blocks resume */ }
      res.json({ conversation: rec, workspaceState });
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

  // Build diagnostics — the structured issue report from the user's LAST build (every struggle
  // v3.0 hit: provider fallbacks, tool errors, "replied without building" nudges, readiness
  // blockers, sandbox problems). Owner-scoped (keyed by the caller's userId). The v3.0 panel's
  // "Download report" button reads this so the admin can hand the JSON to Claude for fixes.
  app.get('/api/agentv3/diagnostics', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    // Prefer the DURABLE (Firestore) copy keyed by workspaceId: it is the freshest authoritative copy
    // — it survives an instance rotation AND carries PREVIEW errors appended AFTER the build (the
    // in-memory copy, keyed only by userId, can be a stale earlier build or miss the preview append).
    // Fall back to the in-memory copy only when there is no workspaceId or no durable copy yet.
    let report: BuildDiagnosticsReport | null | undefined;
    if (workspaceId) report = await loadDiagnostics(workspaceId).catch(() => null);
    if (!report) report = lastDiagnostics.get(userId ?? 'anon');
    if (!report) { res.status(404).json({ error: 'No build diagnostics yet — run a build first.' }); return; }
    res.json({ diagnostics: report });
  });

  // P-AI.9 — explainability: the semantic decision trace from the user's LAST build for a workspace
  // (intent detected → tier/model selected → outcome), each with a short human reason. Owner-scoped
  // (gated by isAgentV3Enabled). Lets the admin/user see WHY the AI made each choice, not just timing.
  app.get('/api/agentv3/decision-trace', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    const decisions = await getDecisionTrace(workspaceId);
    if (!decisions || decisions.length === 0) { res.status(404).json({ error: 'No decision trace yet — run a build first.' }); return; }
    res.json({ decisions });
  });

  // Capture a PREVIEW failure (in-browser srcdoc / live runtime) reported by the client into the
  // build's diagnostics report — so a build that "succeeded" but doesn't actually render shows the
  // REAL preview error in the downloadable report (no separate screenshot needed). The build is
  // already finished, so we append to the durable (workspace-keyed) report and the in-memory copy.
  // Best-effort + owner-scoped; never throws.
  app.post('/api/agentv3/preview-error', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const source: 'in-browser' | 'live' = req.body?.source === 'live' ? 'live' : 'in-browser';
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 4000) : '';
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' }); return; }
    if (!workspaceId || !message) { res.status(400).json({ error: 'workspaceId and message are required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    try {
      const append = (report: BuildDiagnosticsReport): BuildDiagnosticsReport => {
        const rec = { ts: Date.now(), source, message };
        const last = report.previewErrors?.[report.previewErrors.length - 1];
        if (last && last.source === source && last.message === message) return report; // ignore immediate repeats
        const previewErrors = [...(report.previewErrors ?? []), rec].slice(-30);
        // P-AI.11 — enrich the recorded error with a parsed file:line:col + type hint (when
        // extractable) so the downloadable build report shows WHERE/WHAT, not just a raw blob.
        const issues = [...report.issues, { ts: rec.ts, phase: 'preview' as const, severity: 'error' as const, code: 'PREVIEW_ERROR', message: `${source} preview failed: ${message}${locationTag(message)}`.slice(0, 400), autoResolved: false }];
        return { ...report, previewErrors, issues, counts: { ...report.counts, total: issues.length, errors: report.counts.errors + 1, unresolved: report.counts.unresolved + 1 } };
      };
      // Update the in-memory copy (same instance) if present.
      const mem = lastDiagnostics.get(userId ?? 'anon');
      if (mem) lastDiagnostics.set(userId ?? 'anon', append(mem));
      // Update the durable copy so the download/copy reflects it even after an instance rotation.
      const durable = await loadDiagnostics(workspaceId).catch(() => null);
      if (durable) await saveDiagnostics(workspaceId, append(durable)).catch(() => {});
      res.json({ ok: true });
    } catch {
      res.json({ ok: false }); // best-effort — never break the client over a diagnostics append
    }
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
    // Keepalive: like the /chat stream, ping every 15 s so a RESUMED stream is never seen as
    // silent during a quiet build phase (a long model/one-shot call emits no events). Without
    // this the client watchdog would mis-detect a stall and reconnect in a loop ("restart from 0").
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ type: 'ping' }) + '\n');
      else clearInterval(heartbeatTimer);
    }, 15_000);
    req.on('close', () => { clearInterval(heartbeatTimer); rb.subscribers.delete(sub); });
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
      const { files, skipped } = await collectFilesWithSavedFallback(actuator, workspaceId);
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
      const { files } = await collectFilesWithSavedFallback(actuator, workspaceId);
      if (Object.keys(files).length === 0) {
        res.status(404).json({ error: 'No files to preview yet — build something first.' });
        return;
      }
      const vfs = VirtualFileSystem.fromRecord(files);
      // The client's own origin (sent in the body, validated to an http/https URL) is used to load
      // the self-hosted preview compiler via an absolute same-origin URL — a root-relative path
      // doesn't resolve inside the sandboxed <iframe srcDoc>, which produced "Could not load the
      // preview compiler". Falls back to a header-derived origin, then to no origin (relative).
      const bodyOrigin = typeof req.body?.origin === 'string' && /^https?:\/\/[^\s/]+$/i.test(req.body.origin) ? req.body.origin : '';
      const hdrHost = req.get('host');
      const hdrOrigin = hdrHost ? `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${hdrHost}` : '';
      const previewOrigin = bodyOrigin || hdrOrigin || undefined;
      const html = renderPreview(vfs, previewOrigin);
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

  // Delete files from the v3.0 workspace — keeps v3.0's known file set in sync when the user
  // deletes files in the IDE. Removes the paths from the durable WorkspaceFileStore (the
  // authoritative source for what files exist), so a fresh/restored session won't have them and
  // the file-guardian won't resurrect them. Ownership-checked. Body { workspaceId, userId, email,
  // paths: string[] }.
  app.post('/api/agentv3/delete-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter((p: any) => typeof p === 'string' && p) : null;
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!paths || paths.length === 0) {
      res.status(400).json({ error: 'paths (a non-empty string[]) is required.' });
      return;
    }
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    try {
      const deleted = await removeWorkspaceFiles(workspaceId, paths.slice(0, 5000));
      res.json({ deleted });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete the files.' });
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
    // P-AI.10 + P-PE.3 — adversarial/abuse detection. Every abusive prompt is recorded (audit +
    // ledger). Length/repetition NEVER block (they can be legitimate). The UNAMBIGUOUS jailbreak/
    // extraction kinds DO hard-block, but only after repeated attempts (≥3 within 1h) — the ledger
    // read is timeout-bounded and FAIL-OPEN, so a slow/degraded Firestore can never stall the build
    // or wrongly lock out a legitimate user. The downstream UntrustedContent fence + CommandGovernance
    // remain the always-on safety layers regardless of this gate.
    try {
      const { assessPrompt, evaluateAbuse, JAILBREAK_KINDS } = await import('../AgentV3/AbuseDetector');
      const abuse = assessPrompt(prompt);
      if (abuse.isAbusive) {
        const abuserUid = (req.body?.userId as string) || 'anon';
        const nowIso = new Date().toISOString();
        audit('ABUSE_DETECTED', { uid: abuserUid, score: abuse.score, signals: abuse.signals.map((s) => s.kind) }, 'warn');
        const isJailbreak = abuse.signals.some((s) => JAILBREAK_KINDS.has(s.kind));
        if (isJailbreak) {
          const evalResult = await raceTimeout(evaluateAbuse(abuserUid, abuse, nowIso), 3_000, 'evaluateAbuse').catch(() => null);
          if (evalResult?.blocked) {
            audit('ABUSE_HARD_BLOCK', { uid: abuserUid, violations: evalResult.violations }, 'warn');
            res.status(429).json({
              error:
                "This request was blocked. Repeated attempts to override or extract the assistant's " +
                'instructions were detected on your account. Use NavBharatAI Pro to build real apps — ' +
                'this block lifts automatically after a short period.',
            });
            return;
          }
        } else {
          // Non-jailbreak abuse (length/repetition): record for visibility, never block.
          evaluateAbuse(abuserUid, abuse, nowIso).catch(() => {});
        }
      }
    } catch { /* abuse detection is best-effort — never blocks the turn */ }
    // Per-user monthly spend ceiling (R1 §3.1). When the admin has set a cap and this user
    // has reached it this month, deny new builds with an honest, specific message (HTTP 402).
    // Disabled by default and fails open on a store error, so it never locks users out wrongly.
    // Bounded (5s) so a degraded Firestore can't stall the build at startup, before the deadline
    // timer is armed — fails OPEN on timeout, exactly like the store-error path.
    const monthly = await raceTimeout(checkMonthlyCap(userId), 5_000, 'checkMonthlyCap')
      .catch(() => ({ allowed: true, cap: 0, spent: 0 }));
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
    // FIRST-BYTE GUARANTEE — write one NDJSON event the instant the headers flush,
    // BEFORE any setup (intent classify, free-chat router, sandbox actuator, build
    // planning). Those steps can take several seconds, and a multi-second silent gap
    // right after the headers makes a proxy / CDN / Cloud Run ingress (or a cold start)
    // hand the browser an empty 200 — which the client reports as the misleading
    // "No response from the v3.0 engine … the backend may be unreachable, or v3.0 is
    // not enabled." This first byte forces the infra to commit to the stream and makes
    // the client register a real event immediately, so a later failure surfaces its
    // OWN honest terminal error instead of the bare "no response" message. A `ping` is
    // the contract-safe choice: the client already ignores the 15 s keepalive pings.
    send({ type: 'ping' });
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
        // Bounded (8s) — a stalled vision provider must not hang the request before the deadline
        // timer is armed; on timeout we proceed without the image description.
        const vis = await raceTimeout(describeVisionAttachments(rawAttachments, { useClaude: onlyOpus }), 8_000, 'describeVisionAttachments')
          .catch(() => '');
        const extractedRaw = [docs, vis].filter(Boolean).join('\n\n');
        // P-AI.6 — mask personal data (Aadhaar/PAN/phone/email/IFSC) in user-uploaded content
        // BEFORE it enters the transcript/model context. Best-effort; never throws.
        const extracted = redactPII(extractedRaw);
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
    // CONTEXT the gatekeeper needs to read INTENTION (not just wording): does a project already
    // exist in this session, and what did the user recently ask? Computed ONCE here (bounded), then
    // reused below for the deterministic safety-net so Firestore is read at most once. Best-effort.
    const intentWorkspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    const projectExists = (await raceTimeout(
      countWorkspaceFiles(intentWorkspaceId),
      4_000,
      'countWorkspaceFiles',
    ).catch(() => 0)) > 0;
    const recentRequests = (() => {
      try { return getWorkspaceMemory(intentWorkspaceId).recentRequests(3); } catch { return [] as string[]; }
    })();

    let intent = classifyIntent(prompt);
    try {
      const freeRouter = AIRouterManager.getRouter('free');
      // Bounded (6s) — this LLM upgrade runs before the deadline timer is armed; a stalled free
      // provider must not hang the request. On timeout the keyword classification (above) stands.
      // The smart classifier now reads INTENTION with project/conversation context, and only the
      // ambiguous (non-high-confidence) cases reach the LLM — clear greetings / explicit builds /
      // continuations stay instant.
      intent = await raceTimeout(
        classifyIntentSmart(
          prompt,
          (p) => freeRouter.route(p, 'You are a classifier. Reply with one word only.').then((r) => r.response.content),
          { projectExists, recentRequests },
        ),
        6_000,
        'classifyIntentSmart',
      );
    } catch { /* LLM upgrade is best-effort — keyword result stands */ }
    // DETERMINISTIC SAFETY-NET (kept from the workspace-aware fix): even if the LLM is down/slow and
    // the keyword fallback returned new_build, a build-intent turn on a NON-empty project — with no
    // explicit "start over" — is an EDIT, never a rebuild-from-scratch. The smart classifier usually
    // already returns edit; this guarantees it when the LLM didn't run.
    if (intent === 'new_build' && projectExists && !wantsFreshStart(prompt)) {
      intent = 'edit_existing';
    }
    const isPlainChatTurn = intent === 'chat';
    // Surgical edit mode: the user is modifying an existing app (fix/change/update/
    // refactor/…), not building from scratch. When true, the build loop reads the
    // current files and makes minimum targeted edits instead of rebuilding everything.
    const isEditMode = intent === 'edit_existing';
    if (isPlainChatTurn) {
      try {
        const chatPrompt = attachmentContext
          ? `${prompt}\n\nThe user attached file(s); here is the extracted content:\n\n${attachmentContext}`
          : prompt;
        // P-PE.1 — plain-chat response cache. This reply is a pure function of the current prompt (no
        // transcript/user data injected here), so identical prompts WITHOUT an attachment can be served
        // from an in-memory TTL+LRU cache: instant and free, no behaviour change. Build/edit turns never
        // reach this path, and attachment turns are skipped (their prompt is unique).
        const cacheable = !attachmentContext && chatCacheEnabled();
        const cacheKey = cacheable ? hashKey(['chatv1', prompt]) : '';
        let reply: string;
        const cachedReply = cacheable ? chatResponseCache.get(cacheKey) : undefined;
        if (cachedReply !== undefined) {
          reply = cachedReply;
        } else {
          const chatRouter = AIRouterManager.getRouter('free');
          // Bounded (30s) — the plain-chat reply runs on an early-exit path BEFORE the deadline timer
          // is armed; without this a stalled provider hangs the whole request forever. On timeout the
          // catch below falls through to the normal build path so the user still gets an answer.
          const { response } = await raceTimeout(
            chatRouter.route(
              chatPrompt,
              LANGUAGE_RULE + '\n\n' +
                "You are NavBharatAI's friendly assistant. Reply briefly and warmly, following the " +
                "LANGUAGE rule above (match the user's language; never default to Hindi). Do not " +
                "mention which model you are.\n\n" + CREATOR_IDENTITY,
            ),
            30_000,
            'chatRouter.route',
          );
          reply = response.content + providerDebugTag(response.provider);
          // Cache only a real, non-empty reply (never cache an empty/failed generation).
          if (cacheable && response.content && response.content.trim()) {
            chatResponseCache.set(cacheKey, reply);
          }
        }
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
    // Exposed to the finally so the LAST background checkpoint is flushed on every exit path
    // (success, error, abort). Held outside the try because `dispatcher` is block-scoped to it.
    let dispatcherForFlush: { flushCheckpoints: () => Promise<void> } | undefined;

    const events = new AgentEventStream();
    events.subscribe((e) => emit(e), false);
    const state = new WorkspaceState(events);

    const actuator = buildActuator();
    const workspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    const framework = typeof req.body?.framework === 'string' && req.body.framework ? req.body.framework : 'vite-react';
    const importUrl = typeof req.body?.importUrl === 'string' ? req.body.importUrl.trim() : '';
    // Held outside the try so a build CRASH (caught below) is still captured in the diagnostics report.
    let buildDiagRef: BuildDiagnostics | undefined;
    // The latest live preview URL the build published — used by the post-build PREVIEW SELF-CHECK to
    // actually open the running app in a browser and verify it rendered.
    let lastPreviewUrl = '';
    events.subscribe((e) => { if ((e as { type?: string }).type === 'preview') { const u = (e as { url?: unknown }).url; if (typeof u === 'string' && u) lastPreviewUrl = u; } }, false);

    // HARD WALL-CLOCK DEADLINE — guarantees the build can NEVER spin at "working…" forever.
    // If the build body hangs on an UN-abortable await (a stalled model HTTP call, a sandbox
    // command that never returns), the normal result/error/finally path is never reached, so no
    // terminal event is emitted and the client spinner runs indefinitely (the heartbeat keeps the
    // stream "alive", so the client stall-watchdog never trips either). This timer force-emits a
    // terminal result, aborts the run, frees the per-account slot, and ends the stream after the
    // cap. It is cleared in `finally` on normal completion — and because JS is single-threaded it
    // cannot interleave with the synchronous success/finally path, so it ONLY fires on a real overrun.
    const deadlineMs = maxBuildSeconds() * 1000;
    const deadlineTimer: ReturnType<typeof setTimeout> | undefined = deadlineMs > 0 ? setTimeout(() => {
      if (rb.ended) return;
      try { abort.abort(); } catch { /* best-effort */ }
      // SUCCESS-AWARE DEADLINE: if the build ALREADY produced a successful result (the app is built,
      // compiled and durably saved) and the deadline only fired during ADVISORY post-build work
      // (the quality review / preview-heal / console-autofix / memory persist), finalize as SUCCESS —
      // NOT a misleading "paused, type continue". The user's app is done; the advisory extras are
      // optional. This is the #1 cause of "Build paused at the time limit" appearing on a finished app.
      const ok = !!buildResultRef && buildResultRef.ok === true;
      let dl: BuildDiagnosticsReport | undefined;
      try {
        if (!ok) buildDiagRef?.record({ phase: 'build', severity: 'error', code: 'BUILD_TIMEOUT', message: `Build exceeded the ${Math.round(deadlineMs / 1000)}s wall-clock cap and was stopped.`, autoResolved: false });
        buildDiagRef?.finish(ok, ok ? buildResultRef?.summary : undefined);
        dl = buildDiagRef?.report();
        if (dl) {
          lastDiagnostics.set(buildKey, dl);
          saveDiagnostics(workspaceId, dl).catch(() => {}); // durable (survives instance rotation)
        }
      } catch { /* diagnostics are best-effort */ }
      if (ok && buildResultRef) {
        const billedUsd = typeof buildResultRef.billedUsd === 'number' ? buildResultRef.billedUsd : 0;
        emit({ type: 'result', ok: true, summary: buildResultRef.summary || 'Built your app — your files are saved.', steps: buildResultRef.steps ?? 0, billedUsd, billedInr: Math.round(billedUsd * usdInrRate() * 100) / 100, ...(dl ? { diagnostics: dl } : {}) });
      } else {
        emit({ type: 'narration', agent: 'architect', text: 'This build hit the time limit and was paused automatically — every file generated so far is saved. It was likely almost done; I will continue automatically and finish it.', ts: Date.now() });
        // P-Layer3 — mark this result RESUMABLE so the client can auto-continue (bounded) without the
        // user having to type "continue". A normal failure has no `resumable` flag, so it won't auto-retry.
        emit({ type: 'result', ok: false, resumable: true, summary: 'Build paused at the time limit — your files are saved. Continuing automatically…', steps: 0, billedUsd: 0, billedInr: 0, ...(dl ? { diagnostics: dl } : {}) });
      }
      activeBuilds.delete(buildKey);
      if (runningBuilds.get(buildKey) === rb) runningBuilds.delete(buildKey);
      endBuild(rb);
    }, deadlineMs) : undefined;
    // Visible to the deadline timer above so it can finalize a finished build as SUCCESS instead of
    // "paused". Set the moment a build lane produces a successful result (before advisory post-work).
    let buildResultRef: { ok: boolean; summary: string; steps?: number; billedUsd?: number } | null = null;

    // MINUTE-BY-MINUTE TIMELINE — record a "still working" heartbeat every 60 s so the build report
    // shows what the build was doing each minute (and names any in-flight/stuck tool) instead of a
    // blank gap during a long/slow step. Best-effort; cleared in `finally`.
    const diagHeartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (rb.ended) return;
      try { buildDiagRef?.heartbeat(); } catch { /* diagnostics are best-effort */ }
    }, 60_000);

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
      // Admin routing policy: small app → Haiku, complex app → Sonnet, power → Opus
      // (was always Sonnet). Gemini/Vertex remain the fallback in buildTurnRunner.
      const model = selectBuildModel(analysis?.startTier, onlyOpus);
      // BUILD DIAGNOSTICS — capture every struggle (provider fallback, tool error, "replied
      // without building" nudge, readiness blocker, sandbox issue) into a downloadable report,
      // so the admin can hand it to Claude and the rough edges get fixed in code.
      const buildDiag = new BuildDiagnostics({
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
        workspaceId, prompt, model, framework,
        // REAL-TIME: persist the report after every recorded issue, so "Build report" is never
        // empty mid-build and survives a crash/hang (the user can download it any time).
        onUpdate: (r) => { lastDiagnostics.set(buildKey, r); },
      });
      buildDiagRef = buildDiag; // expose to the outer catch so a build crash is captured too
      events.subscribe((e) => buildDiag.ingestEvent(e), false);
      // PR4 — delivery telemetry: count which provider drove each build turn across the WHOLE
      // build (first attempt + any escalation), so `deliveredVia` records the dominant builder
      // (GLM/KIMI/CLAUDE). This is the cheap-floor-vs-Claude rollback tripwire. Best-effort.
      const providerTurns = new Map<string, number>();
      const captureProvider = (used: string): void => { providerTurns.set(used, (providerTurns.get(used) ?? 0) + 1); };
      const client = buildTurnRunner({
        ...(analysis ? { geminiModel: tierToGeminiBuildModel(analysis.startTier) } : {}),
        // First attempt only opts the cheap floor in — and only for simple/medium apps (complex →
        // straight to the strong model) AND only for allowlisted users (canary; empty list = all).
        // Escalation builds below never pass this, so they stay Claude.
        allowCheapFloor: cheapFloorAllowedForTier(analysis?.startTier) && cheapFloorAllowedForUser(userId, email),
        onProviderUsed: captureProvider,
        onProviderError: (name, err) => buildDiag.record({
          phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK',
          message: `Provider ${name} failed — falling back to the next provider`,
          autoResolved: true, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        }),
      });
      // Build start time — used for cost-ladder telemetry duration (P2 measurement).
      const buildStartedAt = Date.now();
      // P-BRE.1 — open a distributed trace for this build (root span). Continues an inbound W3C
      // traceparent if the client sent one, so the build links into the caller's trace. Exported to
      // OTLP/Cloud Trace at the end when configured; otherwise the traceId is still surfaced for logs.
      const buildTrace = startBuildTrace('agentv3.build', { intent: String(intent), framework }, typeof req.headers?.traceparent === 'string' ? req.headers.traceparent : undefined);
      buildTrace.begin(buildStartedAt);
      // P-AI.9 — explainability: an append-only trace of the SEMANTIC decisions this build made
      // (intent → tier/model → outcome), each with a short human reason. Persisted per workspace
      // and surfaced via the owner-scoped GET /api/agentv3/decision-trace endpoint. Best-effort.
      const decisionTrace = new DecisionTrace(workspaceId);
      try {
        decisionTrace.record(
          'intent',
          String(intent),
          projectExists ? 'workspace already has files' : 'no existing files in workspace',
          new Date().toISOString(),
        );
      } catch { /* decision trace is best-effort — never affects the build */ }
      // P-PME.4 — show an up-front ETA for build/edit turns so the user sees a real estimate instead
      // of an open-ended spinner. Derived from the prompt's complexity (no blueprint yet). Best-effort
      // and additive — a failure just skips the ETA; chat turns already returned above.
      if (intent === 'new_build' || intent === 'edit_existing') {
        try {
          const est = estimateBuildTime(complexityFromPrompt(prompt));
          events.emit({ type: 'narration', agent: 'architect', text: `⏱️ Estimated build time: ~${est.etaText} (rough — it adapts as I go).`, ts: Date.now() });
        } catch { /* ETA is best-effort — never affects the build */ }
      }
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
        buildDiag.record({
          phase: 'sandbox', severity: 'error', code: 'SANDBOX_UNAVAILABLE',
          message: 'The build sandbox could not be set up — the build cannot create files.',
          autoResolved: false, detail: m.slice(0, 300),
        });
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
      // PLAN SYNC: drive the plan list's spinner + green ticks from REAL build activity, since the
      // model (Haiku especially) does not reliably call update_todo to advance statuses. Each file
      // written advances the progress; the build's final success marks every item done (below).
      let planSteps = 0;
      const onFileWrite = (path: string, content: string) => {
        writtenFiles.set(path, content);
        try {
          const cur = state.snapshot().todos;
          if (cur.length > 0) {
            planSteps += 1;
            state.setTodos(computePlanProgress(cur, planSteps, false));
          }
        } catch { /* plan progress is best-effort — never affects the build */ }
        if (_progressPersistTimer) clearTimeout(_progressPersistTimer);
        _progressPersistTimer = setTimeout(() => {
          if (writtenFiles.size > 0) {
            saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)).catch(() => {});
          }
        }, 3_000);
      };
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git, secondOpinion, consensus, webSearch, deploy, onFileWrite, framework,
        // AI Diagnosis Bundle #3 — capture every sandbox command's raw logs into the build report.
        (c) => { try { buildDiag.recordCommand(c); } catch { /* diagnostics are best-effort */ } });
      dispatcherForFlush = dispatcher; // let the finally flush the final checkpoint

      // Surgical edit mode (gold standard): when the user is editing an existing
      // app rather than building fresh, inject the CURRENT file tree and the
      // edit-mode prefix so the agent reads existing files and makes minimum,
      // targeted edit_file patches — never rebuilding everything from scratch.
      // Best-effort: a listFiles failure falls back to the edit prefix without a
      // tree, and a non-edit turn uses the normal architect prompt unchanged.
      let architectSystem = architectSystemPrompt(framework);
      // P-PE.2 — register the BASE architect prompt (pre per-turn injections) and capture its version
      // id for telemetry traceability. Best-effort — never affects the build.
      let architectPromptVersion = '';
      try { architectPromptVersion = registerPrompt('architect', architectSystem); } catch { /* best-effort */ }
      // P-PE.8 — inject the current date so the AI uses "today" (not a stale training-cutoff) when
      // reasoning about "latest" frameworks/versions. Injected AFTER registerPrompt so the registered
      // BASE prompt version stays stable. Additive + best-effort — never blocks the build.
      try {
        const dateBlock = dateContextBlock(new Date().toISOString());
        if (dateBlock) architectSystem = `${dateBlock}\n\n---\n\n${architectSystem}`;
      } catch { /* date context is best-effort */ }
      // P-AI.5 — Personalization: for a RETURNING user, inject their learned stack preferences
      // (inferred from past successful builds) as advisory defaults so the Architect leans toward
      // how this user likes to build when they don't specify a stack. Best-effort and additive —
      // returns '' (no change) for a new user or on any error; never blocks or alters the build.
      try {
        const prefContext = await userPreferenceStore.contextFor(userId);
        if (prefContext) architectSystem = `${prefContext}\n\n---\n\n${architectSystem}`;
      } catch { /* preference context is best-effort — a failure leaves the prompt unchanged */ }
      // Cross-Project Lesson Brain: inject the user's highest-confidence lessons learned across ALL
      // their PAST projects (proven fixes + reflections), so wisdom from project A helps project B.
      // Additive + best-effort — '' (no change) for a new user or on any error; never blocks a build.
      try {
        const brainContext = await userLessonBrainStore.contextFor(userId);
        if (brainContext) architectSystem = `${brainContext}\n\n---\n\n${architectSystem}`;
      } catch { /* brain context is best-effort — a failure leaves the prompt unchanged */ }
      // P-AI.4 — NLU: recognize the concrete services the user named in THIS prompt (Razorpay,
      // Supabase, Clerk, …) and inject them as explicit requirements so the agent wires those exact
      // choices instead of substituting its own defaults. Additive + best-effort — '' when nothing
      // was named, so plain prompts and the prompt-regression tests are unaffected.
      try {
        const entityContext = entityRequirementsContext(extractEntities(prompt));
        if (entityContext) architectSystem = `${entityContext}\n\n---\n\n${architectSystem}`;
      } catch { /* entity extraction is best-effort — a failure leaves the prompt unchanged */ }
      // P-AI.3 — Dialogue phase: give the agent a posture for this turn's lifecycle stage (debugging /
      // requirements / planning / deploy). hasExistingFiles ≈ isEditMode (an established project).
      // Additive + best-effort: '' for the baseline build phase, so existing turns are unchanged.
      try {
        const { guidance } = dialoguePhaseContext({ intent, prompt, hasExistingFiles: isEditMode, planning: planFirst });
        if (guidance) architectSystem = `${guidance}\n\n---\n\n${architectSystem}`;
      } catch { /* dialogue phase is best-effort — a failure leaves the prompt unchanged */ }
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
          // P-AI.2 — RAG grounding (dependency-free, BM25): rank the existing files against THIS request
          // and inject the most-relevant ones as a cited grounding block, so the agent reads/edits the
          // right files first. Bounded (≤14 candidate reads, selected by path-token overlap) + best-effort.
          try {
            const qTokens = new Set(rerankTokenize(prompt));
            const candidates = fileTree
              .filter((p) => /\.(t|j)sx?$|\.vue$|\.css$|\.html$/.test(p))
              .map((p) => ({ p, overlap: rerankTokenize(p).filter((t) => qTokens.has(t)).length }))
              .sort((a, b) => b.overlap - a.overlap)
              .slice(0, 14)
              .map((x) => x.p);
            const filesMap: Record<string, string> = {};
            for (const p of candidates) {
              const c = await actuator.readFile(workspaceId, p).catch(() => '');
              if (c) filesMap[p] = c;
            }
            const grounded = buildGroundedContext(filesMap, prompt, 3);
            if (grounded) architectSystem = `${grounded}\n\n---\n\n${architectSystem}`;
          } catch { /* grounding is best-effort — never blocks the build */ }
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
        // AI Diagnosis Bundle #4 — capture every model turn's I/O (truncation, failures, latency)
        // into the build report. Shared by the default build AND every escalated/retry/heal runner.
        onLlmCall: (c: Parameters<NonNullable<typeof buildDiag.recordLlmCall>>[0]) => {
          try { buildDiag.recordLlmCall(c); } catch { /* diagnostics are best-effort */ }
        },
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

      // MEMORY FIX 1 (Claude-level continuity): inject the current PROJECT CONTEXT — the real
      // file list + the project map + recent requests — so a follow-up like "continue" KNOWS what
      // it is building and resumes, instead of the amnesiac "what would you like me to continue
      // with?". The graph is hydrated from the real (durable, re-seeded) files first so the map is
      // accurate even on a fresh Cloud Run instance. Best-effort — never blocks the build.
      try {
        const ctxMem = getWorkspaceMemory(workspaceId);
        // MEMORY FIX 3 (cross-instance): hydrate the in-process memory from the DURABLE Firestore
        // snapshot first — episodes (the user's prior requests) + the project graph survive a Cloud
        // Run restart / a different instance. Previously this restore ran ONLY in edit mode, so a
        // "continue" that landed on a fresh instance lost the memory. Now it runs for every build.
        await restoreWorkspaceMemory(workspaceId, ctxMem).catch(() => {});
        const tree = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
        await warmIndexFiles(ctxMem, tree, (p) => actuator.readFile(workspaceId, p).catch(() => ''), { maxFiles: 200 });
        const ctxEpisodes = ctxMem.snapshot().episodes;
        const recentRequests = ctxEpisodes.filter((e) => e.kind === 'request').map((e) => e.text);
        // MEMORY FIX 4 (plan carry-over): surface the plan (todo statuses) the LAST build was
        // working through, persisted as a PLAN_STATE note. Without this a follow-up like "continue"
        // reset the plan to 0/N and re-scaffolded; now it resumes the unfinished items.
        const lastPlan = [...ctxEpisodes]
          .reverse()
          .find((e) => e.kind === 'note' && e.text.startsWith('PLAN_STATE'))
          ?.text.replace(/^PLAN_STATE\n?/, '');
        const projectCtx = buildProjectContext({ files: tree, projectMap: ctxMem.projectMap(), recentRequests, lastPlan });
        if (projectCtx) buildPrompt = `${projectCtx}\n\n---\n\n${buildPrompt}`;
      } catch { /* project context is best-effort — never blocks a build */ }

      // MEMORY FIX 2 (Claude-level conversation memory): load the most recent PRIOR build transcript
      // for THIS workspace from the durable conversation store and prepend a short "User: … / You: …"
      // recap, so the model remembers what was discussed/done (not just the files). This is what
      // turns "continue" from amnesia into a real resume. Best-effort — never blocks the build.
      try {
        const store = getConversationStore();
        const recent = await store.listByUser(userId ?? 'anon', 10);
        const prior = recent.find((r) => r.workspaceId === workspaceId);
        if (prior) {
          const full = await store.get(prior.id);
          // MEMORY FIX 6 (long sessions): a ROLLING summary — recent turns verbatim PLUS a condensed
          // digest of everything before them — so the early context (the original ask, what the app
          // is) is not silently dropped once the session grows past the recap window.
          const recap = buildRunningSummary(full?.messages ?? [], { recentTurns: 8 });
          if (recap) buildPrompt = `[CONVERSATION SO FAR — your memory of this session]\n${recap}\n\n---\n\n${buildPrompt}`;
        }
      } catch { /* conversation recall is best-effort — never blocks a build */ }

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

      // Cross-Project Lesson Brain watermark: capture the time BEFORE the build runs. On a resumed
      // build, restoreWorkspaceMemory replays every PRIOR build's episodes into memory (re-stamped
      // with a fresh ts), so promoting the whole snapshot later would re-promote old lessons and
      // falsely inflate their confidence/recency. We promote only episodes created AT/AFTER this
      // watermark — i.e. what THIS build actually produced.
      const brainBaselineTs = Date.now();

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

      // P-PE.4 — pre-call token estimate: warn the user when the assembled prompt (system + context +
      // request) is near the model's context window, so a near-overflow is visible instead of silently
      // truncating mid-build. Dependency-free heuristic; best-effort — never blocks the build.
      try {
        const estTokens = estimateTokens(architectSystem) + estimateTokens(buildPrompt);
        const usage = contextUsage(estTokens, model);
        if (usage.nearLimit) {
          events.emit({ type: 'narration', agent: 'architect', text: `⚠️ Large context: ~${estTokens.toLocaleString()} tokens (~${Math.round(usage.ratio * 100)}% of the model window). I'll keep responses focused; consider splitting very large requests.`, ts: Date.now() });
        }
      } catch { /* token estimate is best-effort — never blocks a build */ }

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
          // PLAN SYNC: put the spinner on the first item the moment the build starts (before the
          // first file is written), so the plan is never frozen at all-pending.
          state.setTodos(computePlanProgress(todos, 0, false));
        }
      }

      // Cost-ladder escalation (P3) — DORMANT unless AGENTV3_ESCALATION=on. When off,
      // this is exactly `await runner.run(buildPrompt)` (the start-tier build, once). When
      // on, the build runs cheap-first and climbs the analyser's escalation path ONLY when
      // the objective gate (build completed?) fails — the last tier is always delivered as a
      // best-effort backstop, so the build never "breaks". `deliveredTier` feeds telemetry.
      let result: Awaited<ReturnType<typeof runner.run>> | undefined;
      let deliveredTier: StartTier = analysis?.startTier ?? (onlyOpus ? 'opus' : 'gemini');

      // ── ONE-SHOT FAST LANE (additive, flag-gated; the agentic loop is untouched) ──
      // For a SIMPLE new-build app, try ONE cheap generation call first (no Architect, no
      // sub-agents, no per-file round-trips, no Opus, no rebuild loop). On success the build is
      // done. On ANY failure (no usable files / model error) it falls through to the agentic loop
      // below — the safety net — so behavior is NEVER worse than today. AGENTV3_ONESHOT=off disables.
      if (oneShotEnabled() && intent === 'new_build' && classifyForOneShot(analysis?.startTier)) {
        // Usage ACCUMULATES across every cheap call (manifest + each per-file call), so billing is honest.
        const osUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        const scaffold = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))
          .filter((p) => !/^(node_modules|\.git)\//.test(p)).slice(0, 80);
        // Shared side-effects for both fast lanes (Simple Builder + OneShot).
        const fastGenerate = async (system: string, user: string): Promise<string> => {
          // #2 — capture this fast-lane model call's I/O into the diagnosis bundle. The fast lane
          // (Simple Builder / OneShot) does NOT go through AgentRunner, so its model calls were a
          // blind spot — a truncated (max_tokens) per-file generation is exactly what produces broken
          // code. Now every manifest / per-file / repair call is recorded (success AND failure).
          const fbModel = fastBuildModel();
          const promptPreview = `${system}\n---\n${user}`;
          const startedAt = Date.now();
          let t;
          try {
            t = await new ClaudeClient(undefined, { maxRetries: 2 }).runTurn({
              // D — Sonnet (not Haiku) for the fast lane: per-file isolated generation needs cross-file
              // contract consistency; Haiku disagreed across calls → code didn't compile. Env-overridable.
              model: fbModel, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8000,
            });
          } catch (err) {
            try { buildDiag.recordLlmCall({ model: fbModel, provider: 'anthropic', promptPreview, promptChars: promptPreview.length, responsePreview: '', responseChars: 0, finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startedAt, ok: false, error: err instanceof Error ? err.message : String(err) }); } catch { /* diagnostics best-effort */ }
            throw err;
          }
          try { buildDiag.recordLlmCall({ model: fbModel, provider: 'anthropic', promptPreview, promptChars: promptPreview.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true }); } catch { /* diagnostics best-effort */ }
          osUsage.inputTokens += t.usage.inputTokens;
          osUsage.outputTokens += t.usage.outputTokens;
          osUsage.cacheCreationInputTokens += t.usage.cacheCreationInputTokens ?? 0;
          osUsage.cacheReadInputTokens += t.usage.cacheReadInputTokens ?? 0;
          return t.text;
        };
        const fastWrite = async (files: { path: string; content: string }[]): Promise<void> => {
          for (let i = 0; i < files.length; i++) {
            await dispatcher.dispatch({ id: `fast-w${i}`, name: 'write_file', input: { path: files[i].path, content: files[i].content } }, 'frontend');
          }
        };
        const fastPreview = async (): Promise<void> => {
          // Re-install when package.json is NEWER than node_modules (the generator added deps like
          // tailwindcss). The old `[ -d node_modules ] && "deps present"` skipped install on a
          // restored/scaffolded sandbox even after new deps were added → "Cannot find module
          // 'tailwindcss'" → dev server crash. This installs exactly when the dep set changed.
          await dispatcher.dispatch({ id: 'fast-install', name: 'bash', input: { command: 'if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install; else echo "deps present"; fi' } }, 'frontend');
          await dispatcher.dispatch({ id: 'fast-dev', name: 'bash', input: { command: 'npm run dev' } }, 'frontend');
          await dispatcher.dispatch({ id: 'fast-preview', name: 'update_preview', input: { port: oneShotDevPort(framework) } }, 'frontend');
        };
        // A — real compile check: install deps (idempotent) then type-check. tsc surfaces the exact
        // contract mismatch (e.g. a hook that doesn't return what a component destructures) that
        // separate per-file generation can produce. `|| true` keeps a clean run at exit 0; a real
        // type error is detected by the "error TSxxxx" marker. A throw → "couldn't verify" (non-blocking).
        const fastVerify = async (): Promise<{ ok: boolean; errors: string }> => {
          try {
            const r = await actuator.runCommand(workspaceId, 'if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install >/dev/null 2>&1; fi; npx --no-install tsc --noEmit 2>&1 | tail -200 || true');
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            const hasErrors = /error TS\d+/.test(out);
            if (hasErrors) {
              // #1 — capture the OFFENDING files into the diagnosis bundle so the exact mismatch is
              // visible in the report (no inference). Parse the file paths tsc names (e.g.
              // "src/Calculator.tsx(17,9): error TS2339" or "src/Calculator.tsx:17:9"), de-dupe, and
              // record each one's content from the captured writes. Best-effort — never blocks.
              try {
                const paths = new Set<string>();
                const re = /([\w./-]+\.[a-z0-9]{1,5})[(:]\d+/gi;
                let m: RegExpExecArray | null;
                while ((m = re.exec(out)) && paths.size < 12) paths.add(m[1].replace(/^\.\//, ''));
                for (const p of paths) {
                  const content = writtenFiles.get(p) ?? writtenFiles.get(`./${p}`);
                  if (content) buildDiag.recordFile({ path: p, content, note: 'referenced by a compile error' });
                }
              } catch { /* offending-file capture is best-effort */ }
            }
            if (hasErrors) return { ok: false, errors: out.slice(0, 6000) };
            // tsc is clean — but it CANNOT see a className-vs-CSS mismatch (class names are just
            // strings), which renders the app unstyled/broken (the DigitalWatch bug). Run the
            // deterministic CSS-consistency check and, on a real mismatch, fail verify so the SAME
            // auto-repair pass makes the components and stylesheet agree. Conservative (Tailwind-aware,
            // kebab-case only, thresholded) so a consistent app is never flagged.
            try {
              const cssErr = cssConsistencyError(Object.fromEntries(writtenFiles));
              if (cssErr) return { ok: false, errors: cssErr };
            } catch { /* css check is best-effort — never blocks on its own failure */ }
            return { ok: true, errors: '' };
          } catch {
            return { ok: true, errors: '' }; // could not verify → don't block (best-effort)
          }
        };
        const fastRepair = async (errors: string, currentFiles: { path: string; content: string }[]): Promise<{ path: string; content: string }[]> => {
          const text = await fastGenerate(repairSystemPrompt(framework), repairUserPrompt(prompt, errors, currentFiles));
          return parseFileBlocks(text).map((b) => ({ path: b.path, content: b.content }));
        };
        const fastLog = (msg: string) => events.emit({ type: 'narration', agent: 'architect', text: msg, ts: Date.now() });
        const fastResult = (summary: string, steps: number) => {
          result = { ok: true, summary, steps, usage: osUsage, billedUsd: billedAmountUsd({ inputTokens: osUsage.inputTokens, outputTokens: osUsage.outputTokens }, powerLevelReq) };
          deliveredTier = analysis?.startTier ?? 'haiku';
        };

        // 1) SIMPLE BUILDER (primary) — plan a file manifest, then generate EACH file in its own
        //    focused call. This beats the single-call OneShot's ~8k-token truncation that made
        //    multi-file apps produce "no files" and drop into the slow agentic loop.
        const sb = await runSimpleBuild({ prompt, framework, scaffoldPaths: scaffold, generate: fastGenerate, writeFiles: fastWrite, startPreview: fastPreview, verify: fastVerify, repair: fastRepair, log: fastLog });
        buildDiag.record({ phase: 'build', severity: 'info', code: sb.ok ? 'SIMPLE_BUILD_SUCCESS' : 'SIMPLE_BUILD_FALLBACK', message: sb.summary, autoResolved: true, detail: sb.reason });
        if (sb.ok) {
          fastResult(sb.summary, sb.filesWritten);
        } else {
          // 2) ONE-SHOT (secondary) — a single call still suits a TRIVIAL one-file app the manifest skips.
          const os = await runOneShot({ prompt, framework, scaffoldPaths: scaffold, generate: fastGenerate, writeFiles: fastWrite, startPreview: fastPreview, log: fastLog });
          buildDiag.record({ phase: 'build', severity: 'info', code: os.ok ? 'ONESHOT_SUCCESS' : 'ONESHOT_FALLBACK', message: os.summary, autoResolved: true, detail: os.reason });
          if (os.ok) fastResult(os.summary, os.filesWritten);
        }
        // C — BULLETPROOF PREVIEW: persist the produced files to the durable store SYNCHRONOUSLY the
        // moment the fast lane succeeds — not via the 3s debounce or the fire-and-forget end-of-flow
        // save, both of which can be cut off (the reviewer still running, a dropped stream, an
        // instance rotation), leaving the in-browser preview with "No files to preview yet" even
        // though files were written. Awaited + best-effort: a save error never blocks the build.
        if (result && writtenFiles.size > 0) {
          try { await saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* durable save is best-effort */ }
        }
      }

      if (!result && analysis && shouldEscalateBuild(analysis, onlyOpus)) {
        const esc = await runWithEscalation(analysis.escalationPath, {
          buildOnTier: async (tier, attempt) => {
            if (attempt === 1) return runner.run(buildPrompt); // reuse the start-tier runner
            // Escalated attempt: a stronger, Claude-first runner on the same workspace/stream.
            events.emit({ type: 'narration', agent: 'architect', text: `Escalating to a stronger model to finish the build…`, ts: Date.now() });
            const escRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ geminiModel: tierToGeminiBuildModel(tier), claudeFirst: true, onProviderUsed: captureProvider }),
              // Opus ONLY in power mode — a power-off escalation caps at Sonnet, never Opus
              // (admin rule 2026-06-28). Escalation only runs in normal mode anyway.
              model: resolveModel(tier === 'opus' && onlyOpus),
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
      } else if (!result) {
        // OneShot did not run or fell back → the full agentic loop (today's behavior).
        result = await runner.run(buildPrompt);
      }
      // result is always set here (OneShot, escalation, or the loop above).
      if (!result) result = await runner.run(buildPrompt);

      // PLAN SYNC: reconcile the plan list with the real outcome — a successful build means the
      // plan is accomplished, so mark every item done (green ticks); a failed/partial build keeps
      // the progress reached. Best-effort — never affects the build result.
      try {
        const finalTodos = state.snapshot().todos;
        if (finalTodos.length > 0) state.setTodos(computePlanProgress(finalTodos, planSteps, result.ok));
      } catch { /* plan progress is best-effort */ }

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
        buildDiag.record({
          phase: 'build', severity: 'warning', code: 'EMPTY_BUILD_RETRY',
          message: 'First attempt produced no files — retried the whole build on a stronger model (Sonnet in normal mode; Opus only in power mode).',
          autoResolved: false, // back-filled to true by finish() if the retry then succeeded
        });
        events.emit({ type: 'narration', agent: 'architect', text: 'The first attempt produced no files — rebuilding with a stronger model…', ts: Date.now() });
        // The "stronger model" for the retry: in POWER mode it's Opus; in NORMAL (power-off)
        // mode it is SONNET — Opus is NEVER used when power is off (admin rule 2026-06-28,
        // supersedes the 2026-06-27 "power-off Opus" rule). Since a simple app's first attempt
        // ran on Haiku, retrying on Sonnet is already a real step up, and it keeps a failed
        // build from ever burning the most-expensive model (the "$26 failed todo" driver).
        const retryRunner = new AgentRunner({
          ...baseRunnerOpts,
          client: buildTurnRunner({ claudeFirst: true }),
          model: resolveModel(onlyOpus), // Opus only in power mode; Sonnet in normal mode
          effort: onlyOpus ? (powerSpecResolved.effort ?? powerSpecResolved.ceilingEffort) : undefined,
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

      // PREVIEW SELF-CHECK + HEAL (default-on when a browser sandbox is available): v3.0 used to
      // claim "preview published" after only a port check (port-up ≠ the app rendered). Here it
      // actually OPENS the running app in a real browser, READS the rendered DOM + console, and
      // judges honestly whether it works — then makes ONE bounded repair pass if it didn't, and
      // re-verifies. This is what makes v3.0 AWARE of its own preview and able to fix what it sees.
      // Best-effort, time-budgeted, abortable — it can never break or hang the build. Disable with
      // AGENTV3_PREVIEW_VERIFY=off.
      if (
        process.env.AGENTV3_PREVIEW_VERIFY !== 'off' && result.ok && lastPreviewUrl && actuator.browseUrl
        && !abort.signal.aborted
        // Only if there's comfortable time left before the wall-clock cap (verify + a heal pass).
        && (maxBuildSeconds() === 0 || Date.now() - buildStartedAt < maxBuildSeconds() * 1000 - 90_000)
      ) {
        const healMax = autoFixEnabled() ? Math.max(1, autoFixMaxAttempts()) : 1; // ≥1 fix attempt
        for (let attempt = 0; attempt <= healMax && !abort.signal.aborted; attempt++) {
          let html = '';
          try {
            html = (await withTimeout(actuator.browseUrl(workspaceId, lastPreviewUrl), 35_000, 'browseUrl')).html;
          } catch { break; /* couldn't open the preview (no browser / timeout) — skip silently */ }
          const verdict = analyzePreviewHtml(html);
          let consoleErrs: string[] = [];
          try {
            if (actuator.getConsoleErrors) consoleErrs = filterActionableErrors((await actuator.getConsoleErrors(workspaceId, buildStartedAt)).errors).map((e) => e.text);
          } catch { /* console capture is best-effort */ }
          if (verdict.rendered && consoleErrs.length === 0) {
            events.emit({ type: 'narration', agent: 'architect', text: '✅ Preview verified — I opened the running app in a browser and it renders correctly.', ts: Date.now() });
            break;
          }
          const problems = [...verdict.problems, ...consoleErrs.map((e) => `console: ${e}`)];
          buildDiag.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: problems.slice(0, 4).join(' | ').slice(0, 500), autoResolved: false });
          // Out of repair budget OR the wall-clock cap is near → stop and report honestly.
          if (attempt >= healMax || abort.signal.aborted || (maxBuildSeconds() > 0 && Date.now() - buildStartedAt > maxBuildSeconds() * 1000 - 60_000)) {
            events.emit({ type: 'narration', agent: 'architect', text: `⚠️ I checked the live preview and it did not fully render: ${problems.slice(0, 3).join('; ')}. Your files are saved — send a follow-up and I'll fix it.`, ts: Date.now() });
            break;
          }
          events.emit({ type: 'narration', agent: 'architect', text: `🔍 I opened the preview and it didn't render correctly (${problems[0]}). Fixing it now…`, ts: Date.now() });
          try {
            const healRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ claudeFirst: true }),
              model: resolveModel(onlyOpus),
              persistence: { store: getConversationStore(), conversationId: randomUUID(), userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
            });
            const healed = await healRunner.run(buildPreviewRepairPrompt(verdict.problems, consoleErrs));
            if (healed.ok) result = healed;
          } catch (e) {
            console.log(`[AGENTV3] preview heal attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
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

      // The core build is now SETTLED (generation + verify/repair + heal + autofix). Everything below
      // — quality review, reflection, memory persist, git push — is ADVISORY. Expose the result to the
      // deadline timer NOW so that if the wall-clock cap fires during that advisory work, the build is
      // finalized as SUCCESS (the app is built + already durably saved), not "paused — type continue".
      if (result.ok) buildResultRef = { ok: true, summary: result.summary, steps: result.steps, billedUsd: result.billedUsd };

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
        // P-PME.5 — on a FAILED build, capture a structured retrospective (classified failure +
        // root-cause hint + reusable warning) and promote it into the SAME project memory the next
        // build recalls — so repeated failure patterns are learned, not re-hit. Best-effort.
        if (!result.ok) {
          const retro = buildRetrospective({
            framework,
            intent: prompt.slice(0, 120),
            finalError: result.summary,
            timeSpentMs: Math.max(0, Date.now() - buildStartedAt),
          });
          reflectMem.recordNote(`BUILD_RETROSPECTIVE\n${retro.warning}\n${retro.summary}`);
        }
      } catch { /* reflection/retrospective is best-effort — never affects the build result */ }

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
      // BOUNDED: the reviewer spawns a sub-agent that makes several model calls (read → evaluate →
      // second_opinion) and historically ran for MINUTES — long enough to push a finished build into
      // the wall-clock deadline ("paused at time limit"). It is purely advisory, so (a) skip it when
      // little deadline headroom remains, and (b) cap it with a hard timeout so it can never be the
      // reason a built app times out.
      const reviewHeadroomOk = maxBuildSeconds() === 0 || (Date.now() - buildStartedAt) < (maxBuildSeconds() * 1000 - 120_000);
      if (result.ok && reviewHeadroomOk) {
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
          const review = await raceTimeout(reviewBuild({
            userRequest: prompt,
            fileTree: rFiles,
            fileSample: rSample,
            spawn: spawnSubAgent,
          }), 90_000, 'post-build-review');
          const reviewText = formatReview(review);
          if (reviewText) {
            events.emit({ type: 'narration', agent: 'architect', text: reviewText, ts: Date.now() });
            // Capture the FULL review (every small problem it listed) into the report — the narration
            // above is truncated to a 400-char timeline line, this keeps the complete findings.
            try { buildDiag.recordReview(reviewText); } catch { /* best-effort */ }
          }
        } catch { /* reviewer is best-effort (incl. its 90s cap) — never affects the build result */ }
      }

      // P-AI.5 — Personalization: learn this user's revealed stack from the SUCCESSFUL build.
      // Inferred from the files that actually shipped (framework + deps + code) and the prompt —
      // never from explicit input. Feeds the next build's injected preference context above.
      // Best-effort and gated on real artifacts — never blocks or affects the build outcome.
      if (result.ok && userId && writtenFiles.size > 0) {
        userPreferenceStore
          .recordBuild(userId, { framework, files: Object.fromEntries(writtenFiles), prompt }, new Date().toISOString())
          .catch(() => {});
      }

      // Cross-Project Lesson Brain: promote THIS build's transferable lessons (proven fixes + the
      // reflection note recorded above) into the user's per-user brain so they carry to future
      // projects. Best-effort and gated on a successful build — never blocks or affects the outcome.
      if (result.ok && userId) {
        try {
          // Only THIS build's episodes (created at/after the pre-run watermark) — never the prior
          // builds' episodes that restoreWorkspaceMemory replayed, which would inflate confidence.
          const episodes = getWorkspaceMemory(workspaceId)
            .snapshot()
            .episodes.filter((e) => typeof e.ts === 'number' && e.ts >= brainBaselineTs);
          userLessonBrainStore.recordBuildLessons(userId, episodes, new Date().toISOString()).catch(() => {});
        } catch { /* brain promotion is best-effort */ }
      }

      // Level 9: Persist workspace memory to Firestore so the NEXT session (or build)
      // can restore file-list hints and episode history without re-reading all files.
      // Best-effort: Firestore unavailability must never affect the build outcome.
      try {
        // MEMORY FIX 4 (plan carry-over): record the final plan (todo statuses) as a durable
        // PLAN_STATE note BEFORE the snapshot is persisted, so the NEXT build / a "continue" can
        // resume the unfinished items instead of resetting the plan to 0/N. Best-effort.
        try {
          const planText = formatPlanState(state.snapshot().todos);
          if (planText) getWorkspaceMemory(workspaceId).recordNote(`PLAN_STATE\n${planText}`);
        } catch { /* plan-state capture is best-effort */ }
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
          // P-BRE.2 — incremental signal: compare this build's file hashes to the previous build's
          // (Firestore-cached per workspace), report how many files were UNCHANGED, and store the new
          // hashes for next time. Best-effort — never affects the build or the save above.
          try {
            const prevHashes = await incrementalBuildCache.getHashes(workspaceId);
            const currHashes = hashFiles(toSave);
            if (prevHashes) {
              const diff = diffHashes(prevHashes, currHashes);
              if (diff.unchanged.length > 0) {
                const total = Object.keys(currHashes).length;
                events.emit({ type: 'narration', agent: 'architect', text: `♻️ Incremental: ${diff.unchanged.length}/${total} file(s) unchanged since the last build (${diff.changed.length} changed, ${diff.added.length} new).`, ts: Date.now() });
              }
            }
            incrementalBuildCache.setHashes(workspaceId, currHashes, new Date().toISOString()).catch(() => {});
          } catch { /* incremental signal is best-effort */ }
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
          // P-PE.2 — record which architect prompt version produced this build.
          promptVersion: architectPromptVersion || undefined,
          // PR4 — the provider that drove most build turns (cheap-floor-vs-Claude tripwire).
          deliveredVia: dominantProvider(providerTurns),
        })
        .catch(() => {});

      // TEMP DEBUG: tag the build reply with the provider/model (Claude primary; the
      // resilient runner already self-labels in the text if it fell back to a free provider).
      const buildTag = providerDebugTag(`Claude (${model})`);
      if (buildTag) events.emit({ type: 'narration', agent: 'architect', text: buildTag.trim(), ts: Date.now() });
      // Finalize the build diagnostics and ship the report with the result so the client
      // can download it (JSON/text) and hand it to Claude. Also cached per session for the
      // GET /api/agentv3/diagnostics endpoint. Best-effort — never affects the build result.
      let diagnostics: BuildDiagnosticsReport | undefined;
      try {
        buildDiag.finish(result.ok, result.summary);
        diagnostics = buildDiag.report();
        lastDiagnostics.set(buildKey, diagnostics);
        // DURABLE: persist the final report keyed by workspaceId so the "Build report" download
        // survives a Cloud Run instance rotation / a page reload (the in-memory cache above is
        // per-instance and was the reason reports came back EMPTY). Awaited, best-effort.
        await saveDiagnostics(workspaceId, diagnostics).catch(() => {});
      } catch { /* diagnostics are best-effort */ }
      // P-BRE.1 — finalize the build trace: record the generate span + rich attributes, export to the
      // OTLP endpoint when one is configured (Cloud Trace), and surface the traceId for log↔trace
      // correlation. Best-effort — never affects the build result.
      try {
        const traceEnd = Date.now();
        buildTrace.addSpan('build.generate', buildStartedAt, traceEnd, {
          ok: result.ok,
          intent: String(intent),
          framework,
          tier: deliveredTier,
          files: writtenFiles.size,
          durationMs: Math.max(0, traceEnd - buildStartedAt),
        });
        await buildTrace.end(traceEnd);
        const traceTag = providerDebugTag(`trace ${buildTrace.traceId}`);
        if (traceTag) events.emit({ type: 'narration', agent: 'architect', text: traceTag.trim(), ts: Date.now() });
      } catch { /* tracing is best-effort — never affects the build */ }
      // P-AI.9 — record the final model/tier and outcome decisions, then persist the trace. Best-effort.
      try {
        const nowIso = new Date().toISOString();
        decisionTrace.record('model', `${deliveredTier} (${model})`, onlyOpus ? 'Only-Opus toggle on' : `analyzer chose ${analysis?.startTier ?? 'default'} start tier`, nowIso);
        decisionTrace.record('outcome', result.ok ? 'success' : 'incomplete', `${writtenFiles.size} file(s) written in ${Math.max(0, Date.now() - buildStartedAt)}ms`, nowIso);
        await persistDecisionTrace(decisionTrace, nowIso);
        // Surface the trace in chat when provider-debug is on (same gate as the trace-id tag), so the
        // admin can SEE why each choice was made. Normal users see nothing — explainability without noise.
        if (isProviderDebugOn()) {
          events.emit({ type: 'narration', agent: 'architect', text: `🧭 Decision trace:\n${decisionTrace.format()}`, ts: Date.now() });
        }
      } catch { /* decision trace is best-effort — never affects the build */ }
      // P-AI.7 — automatic post-build test scaffolding. After a SUCCESSFUL build/edit, deterministically
      // generate runnable Vitest skeletons for the top few built source files (ranked by how heavily their
      // exports are used) that don't already have a test. No extra LLM call/cost; honest skeletons (TODO
      // markers, no fake assertions); additive test files only, so it can never affect the app's runtime or
      // the build result. Best-effort — any failure is swallowed.
      try {
        if (result.ok && expectsArtifacts && writtenFiles.size > 0) {
          const sourceFiles = Array.from(writtenFiles.entries()).map(([path, content]) => ({ path, content }));
          const plan = planAutoTests(sourceFiles, { existingPaths: writtenFiles.keys(), limit: 3 });
          const scaffolded: string[] = [];
          for (const item of plan) {
            try {
              await actuator.writeFile(workspaceId, item.testPath, item.content);
              writtenFiles.set(item.testPath, item.content);
              try { getWorkspaceMemory(workspaceId).indexFile(item.testPath, item.content); } catch { /* index is best-effort */ }
              scaffolded.push(item.testPath);
            } catch { /* one test file failing must not block the rest */ }
          }
          if (scaffolded.length > 0) {
            await saveWorkspaceFiles(workspaceId, Object.fromEntries(scaffolded.map((p) => [p, writtenFiles.get(p) as string]))).catch(() => {});
            events.emit({ type: 'narration', agent: 'architect', text: `🧪 Scaffolded ${scaffolded.length} starter test${scaffolded.length > 1 ? 's' : ''} (${scaffolded.join(', ')}) — runnable Vitest skeletons with TODO markers for you to fill in real assertions.`, ts: Date.now() });
          }
        }
      } catch { /* auto-test scaffolding is best-effort — never affects the build result */ }
      // P-UX.7 — surface the build's token count to the client (in + out) for a usage badge. 0 → omitted.
      const totalTokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      emit({ type: 'result', ...result, billedUsd: effectiveBilledUsd, billedInr: Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100, ...(totalTokens > 0 ? { tokens: totalTokens } : {}), ...(diagnostics ? { diagnostics } : {}) });
    } catch (err) {
      // Capture the crash in the diagnostics report too (real-time onUpdate already persisted it).
      try {
        buildDiagRef?.record({ phase: 'build', severity: 'error', code: 'BUILD_EXCEPTION', message: err instanceof Error ? err.message : String(err), autoResolved: false });
        buildDiagRef?.finish(false);
      } catch { /* diagnostics are best-effort */ }
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      // Flush the LAST background checkpoint so the finished app is captured in History/restore.
      // Bounded (6s) + best-effort: checkpoints are off the hot path during the build, so this is
      // the ONLY place git is awaited, and the cap guarantees a slow/stuck git can never re-stall a
      // build the way the old per-write checkpoints did. Files are durably saved regardless, so even
      // if this is skipped the user never loses code — it only keeps History complete.
      if (dispatcherForFlush) {
        await raceTimeout(dispatcherForFlush.flushCheckpoints(), 6_000, 'flushCheckpoints').catch(() => {});
      }
      // Normal completion reached the finally synchronously → cancel the wall-clock deadline so it
      // can't fire after a clean finish (no double terminal event), and stop the heartbeat timer.
      if (deadlineTimer) clearTimeout(deadlineTimer);
      clearInterval(diagHeartbeatTimer);
      activeBuilds.delete(buildKey);
      // Only clear the registry slot if it is STILL this build — a Stop may have already
      // replaced it with a newer run. End every attached stream.
      if (runningBuilds.get(buildKey) === rb) runningBuilds.delete(buildKey);
      endBuild(rb);
    }
  });
}
