import type { Express, Request, Response } from 'express';
import { buildRateLimiter, workspaceRateLimiter, verifyFirebaseToken, verifyFirebaseIdentity, verifyFirebaseIdentityDiag } from '../lib/authMiddleware';
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
  sanitizeRepoUrl,
  GitHubAppClient,
  UserGitHubClient,
  githubConfigFromEnv,
  githubStorageActive,
  githubPrMode,
  mergeViaPullRequest,
  planRevert,
  repoNameForProject,
  resolveStorageTarget,
  ownRepoStorageEnabled,
  parseGitHubRepo,
  WORK_BRANCH,
  perWorkspaceLockEnabled,
  maxConcurrentBuilds,
  buildLockKey,
  countActiveBuildsForUser,
  acquireDecision,
  type RepoInfo,
  type PrCapableClient,
  type OwnRepoTarget,
  registerSession,
  restoreSession,
  gitStatusForSession,
  execInSession,
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
import { loadQueue, mutateQueue } from '../AgentV3/BuildQueueStore';
import { enqueue as enqueueCommand, cancelItem as cancelQueueItem, claimNext as claimNextQueued, completeRunning as completeQueuedRunning, pendingItems as pendingQueueItems, runningItem as runningQueueItem, queueSummary, type QueueItem, type QueueItemSource } from '../AgentV3/BuildQueue';
import {
  InMemoryConversationStore,
  deriveTitle,
  upsertConversationTurn,
  type ConversationStore,
} from '../AgentV3/ConversationStore';
import { createTimelineRecorder, sessionRecallContextLine } from '../AgentV3/SessionTimeline';
import { isZipAttachment, extractZipProject, validateImportedProject, droppedDetailNote, envTemplateNote } from '../AgentV3/ProjectImport';
import { detectNeedsDatabase, envVarNames, buildDevEnvContent, externalServiceNote, conjurableSecrets } from '../AgentV3/ImportPreview';
import { countEditableSourceFiles } from '../AgentV3/fileClassification';
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
import { scanGeneratedCode, formatCodeScanReport } from '../AgentV3/CodeSafetyScanner';
import { GeminiToolRunner, type GeminiGenAiClient } from '../AgentV3/providers/GeminiToolRunner';
import { makeMultiProviderTurnRunner, forceModelRunner, type NamedRunner } from '../AgentV3/providers/MultiProviderTurnRunner';
import { OpenAiToolRunner, type OpenAiChatClient } from '../AgentV3/providers/OpenAiToolRunner';
import { BuildDiagnostics, renderDiagnosticsText, renderSessionDiagnosticsText, type BuildDiagnosticsReport } from '../AgentV3/BuildDiagnostics';
import { runOneShot, classifyForOneShot, oneShotEnabled, parseFileBlocks } from '../AgentV3/OneShotBuilder';
import { runSimpleBuild, repairSystemPrompt, repairUserPrompt, manifestSystemPrompt, manifestUserPrompt, parseFileManifest, contractSystemPrompt, contractUserPrompt, blueprintAdvisoryBlock } from '../AgentV3/SimpleBuilder';
import { hasTscErrors, looksLikeTscHelpOutput } from '../AgentV3/TscGate';
import { judgeBuild, judgeRepairPrompt, type JudgeRunTurn } from '../AgentV3/BuildJudge';
import { nextReviewAction, selectReviewer, cheapBounceCap } from '../AgentV3/CheapFloorReview';
import { buildLessonFromDiagnostics } from '../AgentV3/BuildLessons';
import { buildProjectContext, buildRunningSummary, formatPlanState, parsePlanState } from '../AgentV3/ProjectContext';
import { computePlanProgress } from '../AgentV3/PlanProgress';
// Software Project Mode (SPM-2) — module-decomposed mega-builds, flag-gated AGENTV3_PROJECT_MODE=on.
import { projectModeEnabled, detectMegaProject, isContinuationMessage, parsePlannedModules, createProjectPlan, nextBuildableModule, planComplete, planBlockedReason, markModuleStatus, planProgressLine, projectPlanTodos, moduleBuildContext, projectPlanSystemPrompt, projectPlanUserPrompt, MIN_PROJECT_MODULES, type ProjectPlan, type ProjectModule } from '../AgentV3/ProjectPlan';
import { saveProjectPlan, loadProjectPlan } from '../AgentV3/ProjectPlanStore';
import { withTimeout, mapWithConcurrency } from '../AgentV3/asyncUtils';
import { analyzePreviewHtml, buildPreviewRepairPrompt } from '../AgentV3/PreviewVerify';
import { billedAmountUsd } from '../AgentV3/pricing';
import OpenAI from 'openai';
import type { TurnRunner } from '../AgentV3/ClaudeClient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { redactPII } from '../AgentV3/SecretRedactor';
import { audit } from '../lib/audit';
import { notePersistenceFailure, persistenceHealth } from '../lib/persistenceHealth';
import { userPreferenceStore } from '../AgentV3/UserPreferenceStore';
import { userLessonBrainStore } from '../AgentV3/UserLessonBrain';
import { liveChannel, liveEventsAllowedFor } from '../AgentV3/LiveChannel';
import { extractEntities, entityRequirementsContext } from '../AgentV3/EntityExtractor';
import { chatResponseCache, chatCacheEnabled, hashKey } from '../AgentV3/PromptCache';
import { dialoguePhaseContext } from '../AgentV3/DialogueStateManager';
import { registerPrompt } from '../AgentV3/PromptRegistry';
import { buildRetrospective } from '../lib/BuildRetrospectiveEngine';
import { estimateBuildTime, complexityFromPrompt, formatEta } from '../lib/BuildTimeEstimator';
import { resolvePipelineDepth, scaleBuildSeconds, type PipelineDepth } from '../AgentV3/PipelineDepth';
import { incrementalBuildCache, hashFiles, diffHashes } from '../AppMakerLab/IncrementalBuildCache';
import { startBuildTrace } from '../telemetry/TracingManager';
import { DecisionTrace, persistDecisionTrace, getDecisionTrace } from '../AgentV3/DecisionTraceManager';
import { planAutoTests } from '../AgentV3/TestGenerationAgent';
import { locationTag } from '../AppMakerLab/intelligence/LogIntelligenceEngine';
import { estimateTokens, contextUsage } from '../AgentV3/TokenEstimator';
import { buildGroundedContext, contentSearchTerms, selectGroundingCandidates } from '../AgentV3/ContextReranker';
import { fenceUntrusted } from '../AgentV3/UntrustedContent';
import { autoFixEnabled, autoFixMaxAttempts, filterActionableErrors, buildRepairPrompt, autoFixWarning, type RuntimeError } from '../AgentV3/AutoFix';
/** Hard per-session cost cap (USD). Prevents runaway retry spirals ($26 todo app problem).
 *  Set SESSION_COST_CAP_USD in env to override. Default: $5. */
function sessionCostCapUsd(): number {
  const v = parseFloat(process.env.SESSION_COST_CAP_USD ?? '');
  return Number.isFinite(v) && v > 0 ? v : 5.0;
}
import { deploymentStore, withDeploymentPersistence } from '../AgentV3/DeploymentStore';
import { sandboxStore, sandboxResumeEnabled } from '../AgentV3/SandboxStore';
import { getDeployProvider, DEFAULT_DEPLOY_PROVIDER, deployProviderStatus } from '../AgentV3/DeployProviders';
// Side-effect imports: each provider self-registers into the DeployProviders registry on load.
import '../AgentV3/VercelProvider';
import '../AgentV3/NetlifyProvider';
import '../AgentV3/CloudflareProvider';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { planAnalysisSummary } from '../AgentV3/PlanIntelligence';
import { collectWorkspaceFiles, writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { VirtualFileSystem } from '../project/ProjectModel';
import { applyPreviewDomain } from '../AgentV3/PreviewDomain';
import { validateProjectForPreview, devScriptPort } from '../AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { classifyPreviewHealth, previewHealthContextLine } from '../AgentV3/PreviewHealth';
import { findMissingDependencies } from '../AgentV3/DependencyReconciler';
import { renderPreview } from '../runtime/renderPreview';
import { isReactProject } from '../runtime/ReactPreview';
import { isVueProject } from '../runtime/VuePreview';
import { CREATOR_IDENTITY } from '../lib/prompts';
import { classifyIntentSmart, classifyIntentWithConfidence, wantsFreshStart } from '../AgentV3/IntentClassifier';
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
import { saveWorkspaceFiles, mergeWorkspaceFiles, loadWorkspaceFiles, removeWorkspaceFiles, countWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { saveWorkspaceAssets, materializeAssets, restoreWorkspaceAssets } from '../AgentV3/WorkspaceAssetStore';
import { recordManualEdits, consumeManualEdits, manualEditContext, manualEditNarration } from '../AgentV3/ManualEditTracker';
import { saveCheckpoint, loadCheckpoints, dormantGitStatusFromCheckpoints } from '../AgentV3/CheckpointStore';
import { buildPromptAudit, savePromptAudit } from '../AgentV3/PromptAuditStore';
import { saveDiagnostics, loadDiagnostics, saveDiagnosticsHistory, listDiagnosticsHistory, getDiagnosticsHistoryItem, saveLatestForUser, loadLatestForUser, compactReportForRecord } from '../AgentV3/DiagnosticsStore';
import { cssConsistencyError } from '../AgentV3/CssConsistency';
import { planFileGuardian } from '../AgentV3/FileGuardian';
import { applyVisualTextEdit } from '../AgentV3/VisualEditPatcher';
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

/**
 * SECURITY (audit A2 — defense-in-depth for C2): should a BUILD be refused because no isolated
 * sandbox is configured? In production, a build with neither E2B nor Docker would fall back to
 * LocalActuator (host execution) — the avenue that let the importUrl injection reach the host. Pure +
 * exported so it's unit-testable; the /chat build path calls this AFTER the plain-chat early-exit
 * (chat needs no sandbox). Non-prod (dev/CI/VITEST) is allowed — LocalActuator is intended there.
 */
export function buildSandboxUnavailableInProd(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && !env.E2B_API_KEY && env.DOCKER_ENABLED !== 'true';
}

/**
 * SECURITY (audit C1 / architecture A1) — resolve the caller's identity for a build. Identity comes
 * ONLY from the VERIFIED Firebase token (`verifiedUid`), never a client-supplied body field
 * (`claimedUid`), because the build path keys allowlist, cost, monthly-cap AND workspace access off
 * it — a spoofable id let anyone read another user's workspace, bypass the cap, and spend
 * NavBharatAI's own model budget under any account. Pure + exported + unit-tested.
 *
 * Rules (admin-approved 2026-07-02, revised — "graceful degrade, never hard-block"):
 *  • verified token present but a DIFFERENT claimed id → reject `mismatch` (a genuine spoof: the caller
 *    PROVED they are user A yet asks to act as user B).
 *  • claim present but NO verified token → do NOT reject. The claim is simply NOT trusted: identity
 *    degrades to anonymous (`userId=null`), so the build runs in the shared-anon workspace and can never
 *    read/write the claimed user's data. This preserves C1's anti-spoof property (a claim alone never
 *    grants an identity) WITHOUT hard-blocking the chat when a signed-in user's token is briefly absent
 *    (auth-state race, synthetic/local admin, transient verify failure). The earlier "reject & ask
 *    refresh" rule assumed a refresh always restores the token; in practice it does not always, and a
 *    hard error that stops the app dead is worse than a functional anonymous session (safeguard: the
 *    app must never break). The client also force-refreshes its token on the chat path to self-heal a
 *    stale/expired token.
 *  • otherwise ok; `userId` is the verified uid, or null for a genuinely anonymous caller.
 */
export type BuildIdentity =
  | { ok: true; userId: string | null }
  | { ok: false; code: 'reauth' | 'mismatch'; error: string };

export function resolveBuildIdentity(verifiedUid: string | null, claimedUid: string | null): BuildIdentity {
  if (verifiedUid && claimedUid && claimedUid !== verifiedUid) {
    return { ok: false, code: 'mismatch', error: 'Identity mismatch — the signed-in account does not match the requested user.' };
  }
  // A claim without a verified token is NOT trusted — it degrades to anonymous (userId=null) rather
  // than granting the claimed identity, so no cross-user access is possible and the chat still works.
  return { ok: true, userId: verifiedUid };
}

/**
 * SECURITY (C1 fast-follow) — verified identity for READ/mutate v3.0 routes that take the caller from
 * the request (conversation list/get/delete, etc.). Returns the uid+email from the VERIFIED Firebase
 * token — never the spoofable query/body `userId` (which let one account read/delete another's build
 * transcripts). Under VITEST the route handlers aren't token-authed, so it falls back to the request
 * params so the existing route tests still exercise the ownership logic. The client already sends the
 * Bearer token on all of these calls (authJsonHeaders), so this is non-breaking.
 */
/**
 * PURE read-identity resolution: the VERIFIED Firebase identity when the token verified, else a
 * fallback to the request's CLAIMED (query/body) userId+email. Extracted + exported so the
 * regression contract behind the "history opens to '0 messages'" fix is locked by a unit test.
 *
 * WHY THE FALLBACK EXISTS (do not revert to verified-only): the 3 conversation routes (list /
 * get-one / delete) were the ONLY v3.0 reads gated on a verified token ALONE. Every OTHER v3.0 route
 * resolves identity as `verifiedUid ?? claimedUid` (workspaceOwnershipOk) — that is how file
 * CONTENTS, memory and the build report all read today. `verifyIdToken` returns null on a TRANSIENT
 * failure for a genuinely signed-in user (a just-expired/again-refreshed token, an admin-SDK
 * cert-fetch hiccup, a cold-start init race). Verified-only then returned userId=null, so the LIST
 * route 400'd (transcripts vanished from History) and the GET route could not build the real
 * `agentv3-{uid}-{sid}` candidate (404) — the client fell back to the session-switch-erased
 * chat_sessions copy and showed "saved copy has 0 messages" on EVERY item, while files/memory stayed
 * fine. The claimed-userId fallback aligns these reads with the rest of v3.0; access is still gated
 * downstream by conversationAccess (the record's userId must match this identity, or be the
 * shared-anon bucket), and opening a single conversation additionally requires its UNGUESSABLE id.
 * The verified token ALWAYS takes precedence when present — the fallback only widens the token-less
 * path, it never overrides a token.
 */
export function resolveIdentityWithFallback(
  verified: { uid: string; email: string | null } | null,
  claimedUserId: string | null,
  claimedEmail: string | null,
): { userId: string | null; email: string | null } {
  if (verified) return { userId: verified.uid, email: verified.email };
  return { userId: claimedUserId, email: claimedEmail };
}

export async function resolveReadIdentity(req: Request): Promise<{ userId: string | null; email: string | null }> {
  const claimedUserId = typeof req.query.userId === 'string' ? req.query.userId
    : (typeof req.body?.userId === 'string' ? req.body.userId : null);
  const claimedEmail = typeof req.query.email === 'string' ? req.query.email
    : (typeof req.body?.email === 'string' ? req.body.email : null);
  // Unit tests never reach real Firebase — treat them as the token-less (fallback) path, which
  // returns exactly the claimed query/body identity the tests already rely on.
  const verified = process.env.VITEST ? null : await verifyFirebaseIdentity(req);
  return resolveIdentityWithFallback(verified, claimedUserId, claimedEmail);
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
    } catch (e) {
      // Durable chat history is UNAVAILABLE — the in-memory fallback means transcripts vanish on any
      // redeploy / instance rotation. Surface it (throttled) so this isn't a silent prod degradation.
      notePersistenceFailure('conversation_store', 'init', e);
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
  // ANON EXEMPTION (mirrors workspaceOwnershipOk, #829): a record saved under the literal 'anon'
  // bucket has NO real owner to protect — it exists because the build path degraded a briefly
  // token-less (but genuinely signed-in) caller to anonymous. Its unguessable random id/workspace
  // is the capability. Without this, the user's OWN build transcript (saved as anon) was
  // 'forbidden' to them → opening that chat restored an EMPTY thread.
  if (rec.userId === 'anon') return 'ok';
  if (!userId || rec.userId !== userId) return 'forbidden';
  return 'ok';
}

/**
 * Candidate conversation-store ids for a history entry the client asked to open. A `v3_<sessionId>`
 * entry (from chat_sessions) has no server record under that literal id — but the SAME session's
 * server transcript exists under its workspace id (#837: conversationId = workspaceId), which is
 * `agentv3-{uid}-{sessionId}` — or `agentv3-anon-{sessionId}` when the build ran identity-degraded.
 * Trying these in order lets a v3_ entry open its FULL server transcript instead of falling back to
 * the (possibly corrupted/empty) chat_sessions copy. Pure + exported for testing.
 */
export function candidateConversationIds(id: string, verifiedUid: string | null): string[] {
  const out = [id];
  if (id.startsWith('v3_')) {
    const sid = id.slice(3);
    if (sid) {
      if (verifiedUid && /^[A-Za-z0-9_-]{1,64}$/.test(verifiedUid)) out.push(`agentv3-${verifiedUid}-${sid}`);
      out.push(`agentv3-anon-${sid}`);
    }
  }
  return out;
}

/**
 * True when NO conversation record for this workspace was touched during (or after) this build's
 * own start — meaning only the fast lane (SimpleBuilder/OneShot) ran, which never persists to
 * ConversationStore itself (only the agentic AgentRunner does, via its own `persistence` option
 * inside run()). Without a fallback record in that case, a reload's "restore the most recent
 * build" finds nothing for this workspace — the chat/session looks wiped even though the
 * generated files were saved separately. PURE & testable.
 */
export function needsFallbackConversationPersist(
  recentForUser: readonly { workspaceId: string; updatedAt: number }[],
  workspaceId: string,
  buildStartedAt: number,
): boolean {
  return !recentForUser.some((r) => r.workspaceId === workspaceId && r.updatedAt >= buildStartedAt);
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
/**
 * PURE ownership decision for a workspaceId, extracted so it can be unit-tested without an Express
 * request. A workspaceId is `agentv3-{uid}-{sessionId}` (deriveWorkspaceId).
 *
 * ANON EXEMPTION (fixes the "Forbidden: this workspace does not belong to you" bug):
 * an `agentv3-anon-*` workspace has NO real owner to protect — it is the shared-anon bucket, scoped
 * only by its unguessable random sessionId (exactly what this guard's own doc describes). The build
 * path (resolveBuildIdentity) degrades a signed-in user whose token is briefly unverifiable to
 * `anon`, creating `agentv3-anon-{session}` — but every OTHER call (preview/files) resolves that same
 * user to their REAL uid, so the strict uid-match rejected the user from their OWN build. Treating an
 * anon-prefixed workspace as always-accessible resolves that mismatch WITHOUT widening access to any
 * real user's workspace (`agentv3-{realuid}-*` still requires the uid to match). No IDOR is opened:
 * a real workspace is still uid-gated, and an anon workspace was already reachable by anyone holding
 * its random sessionId.
 */
export function workspaceOwnershipOk(verifiedUid: string | null, claimedUid: string | null, workspaceId: string): boolean {
  if (!workspaceId || !workspaceId.startsWith('agentv3-')) return false;
  // The shared-anon bucket carries no real identity to protect (sessionId-scoped only).
  if (workspaceId.startsWith('agentv3-anon-')) return true;
  // The verified token always takes precedence over the claimed id (only widens the token-less
  // admin/anon fallback). A real workspace requires the resolved uid to match its id.
  const id = verifiedUid ?? claimedUid;
  const uid = id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : 'anon';
  return workspaceId.startsWith(`agentv3-${uid}-`);
}

async function assertWorkspaceOwner(req: Request, workspaceId: string): Promise<boolean> {
  const verifiedUid = await verifyFirebaseToken(req);
  // Claimed id may come from the JSON body (POST) or the query string (GET).
  const claimedUid =
    (typeof req.body?.userId === 'string' ? req.body.userId : null) ??
    (typeof req.query?.userId === 'string' ? req.query.userId : null);
  return workspaceOwnershipOk(verifiedUid, claimedUid, workspaceId);
}

export function deriveWorkspaceId(userId: string | null, sessionId: unknown): string {
  const uid = userId && /^[A-Za-z0-9_-]{1,64}$/.test(userId) ? userId : 'anon';
  if (typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)) {
    return `agentv3-${uid}-${sessionId}`;
  }
  return `agentv3-${uid}-${Date.now()}`;
}

/**
 * The STABLE durable-conversation id for a session's workspace — one conversation record per session,
 * NOT per build/message.
 *
 * THE BUG this fixes: every build minted `conversationId: randomUUID()`, and a single build can spin up
 * to FIVE runners (main + escalation + retry + preview-heal + auto-fix) — so one session's many messages
 * (and even one message's retries) each became a SEPARATE conversation document → the history menu
 * showed every message as its own "chat", and reopening/continuing landed on a fragmented transcript
 * (so v3.0 behaved like a fresh session on each message and couldn't edit coherently). Deriving the id
 * from the (session-stable) workspaceId makes all of them share ONE conversation: the first build
 * creates it, every later runner/build appends its turns, and the history shows ONE entry per session
 * with all its messages in order. Pure + exported for testing.
 */
export function conversationIdForWorkspace(workspaceId: string): string {
  return workspaceId;
}

/**
 * Hard per-build cost cap (USD) — stops one runaway build from spending unbounded money.
 * TEMPORARILY DISABLED (admin decision, 2026-07-01): while build-pipeline bugs are still being found
 * and fixed, a build must be allowed to run to completion rather than being cut off mid-repair — the
 * cap was firing on genuine, still-productive debugging sessions (e.g. "Budget reached ($25.83 of
 * $25.00). Stopped." while the agent was actively fixing a real API mismatch). Re-enable later by
 * setting AGENTV3_MAX_BUILD_USD to a positive number — no code change needed. 0/unset = disabled.
 */
export function maxBuildBudgetUsd(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * The workspace-awareness line appended to a PLAIN CHAT turn's system prompt when the project
 * already has real, durably-saved files. Without this, a chat question like "kितni files hai?"
 * had zero workspace context (the chat lane never loaded any) — the model could only guess or
 * admit it doesn't know, even though the real count was one cheap Firestore read away. Empty
 * string for a brand-new/empty workspace — nothing honest to add. Pure + exported for testing.
 */
export function chatWorkspaceContextLine(fileCount: number): string {
  if (!Number.isFinite(fileCount) || fileCount <= 0) return '';
  return `\n\n[Current project: ${fileCount} file(s) saved in this session's workspace. If asked how many files exist or what has been built, answer with this REAL number — never guess.]`;
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
  // Default raised 1080s (18 min) → 1800s (30 min): a genuinely complex full-stack app (auth + DB +
  // multiple pages + install + dev-server verify) legitimately needs more than 18 min, and the flat
  // cap was cutting big builds off mid-work with only partial files. The build stops the moment it is
  // DONE — this ceiling only ever gives long builds more headroom, it never slows a quick build.
  // Admin-tunable via AGENTV3_MAX_BUILD_SECONDS; set 0 to disable (not recommended).
  return Number.isFinite(raw) && raw > 0 ? raw : 1800;
}

/**
 * Per-turn MAX OUTPUT TOKENS for the agentic build runner. Previously the runner never set this, so
 * every architect turn fell back to ClaudeClient's 8192 default — which truncated large multi-file
 * writes and big components mid-output (stopReason 'max_tokens'), the single biggest reason complex
 * apps came out incomplete. 32000 is a safe, valid ceiling for every current Claude 4.x model
 * (Sonnet/Opus/Haiku all support ≥ 32k output) and 4× the old cap, so a large file no longer gets
 * cut off in one turn. Admin-tunable via AGENTV3_MAX_TOKENS_PER_TURN (hard-capped at 64000 to stay
 * within model limits).
 */
export function buildMaxTokensPerTurn(): number {
  const raw = Number(process.env.AGENTV3_MAX_TOKENS_PER_TURN);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 64000) : 32000;
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
  opts?: { liveTimeoutMs?: number },
): Promise<{ files: Record<string, string>; skipped: string[]; source: 'live' | 'saved' }> {
  try {
    // READ paths (preview / files tab / visual edit) pass a short bound: on a COLD workspace the
    // live collect first has to reconnect/create an E2B sandbox, which can take 10-30s before it
    // fails — the whole reason "preview loading me bahut time lag raha hai". The durable saved
    // files are written on every build/edit and are equally correct for reads, so when the live
    // side isn't answering quickly we serve them instead. A WARM sandbox still answers well
    // within the bound, so fresh mid-build files keep winning.
    const live = opts?.liveTimeoutMs
      ? await withTimeout(collectWorkspaceFiles(actuator, workspaceId), opts.liveTimeoutMs, 'collectFiles-live')
      : await collectWorkspaceFiles(actuator, workspaceId);
    if (Object.keys(live.files).length > 0) return { files: live.files, skipped: live.skipped, source: 'live' };
  } catch { /* live sandbox gone/empty/slow/errored — fall through to the durable saved files */ }
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
export interface RunningBuild {
  abort: AbortController;
  buffer: unknown[];
  subscribers: Set<BuildSubscriber>;
  ended: boolean;
  startedTs: number;
  /** The channel key (userId) — used to mirror events to the cross-device LiveChannel. Stays the
   *  ACCOUNT key even under per-workspace locking, so the cross-device mirror is unchanged. */
  key?: string;
  /** The owning account (userId ?? 'anon') — lets the per-account concurrency cap count this account's
   *  live builds even when the registry Map is keyed by workspace (per-workspace locking). */
  userId?: string | null;
  /** Which v3.0 session/project this build belongs to (agentv3-{uid}-{sessionId}). One account can
   *  have several DIFFERENT chat sessions; `runningBuilds` is keyed by userId only (one account can
   *  only build one thing at a time), but the auto-resume/attach and live-mirror paths must still
   *  verify the running build is actually the CALLER's session before replaying/mirroring it — else a
   *  build genuinely still running in session A silently bleeds into a freshly-opened session B under
   *  the same account (root-caused 2026-07-01: "+ New chat" showing an unrelated build's progress). */
  workspaceId?: string;
}
const runningBuilds = new Map<string, RunningBuild>();
const MAX_BUILD_BUFFER = 4000;
/** The most recent build's diagnostics report per build key (userId) — for download/endpoint. */
const lastDiagnostics = new Map<string, BuildDiagnosticsReport>();

/** Push an event into a build's replay buffer and fan it out to every subscriber. */
function broadcastBuild(rb: RunningBuild, e: unknown): void {
  if (rb.buffer.length < MAX_BUILD_BUFFER) rb.buffer.push(e);
  for (const s of rb.subscribers) { try { s.write(e); } catch { /* drop a dead subscriber */ } }
  // Mirror to the cross-device LiveChannel (throttled, best-effort) so a SECOND device — even on a
  // different server instance — can watch this build's activity live. Never affects the build.
  // Stamped with the build's workspaceId so readers can refuse a DIFFERENT session's events —
  // cross-instance too, where the runningBuilds map can't help (see /api/agentv3/live below).
  if (rb.key) { try { liveChannel.publish(rb.key, [e], rb.workspaceId); } catch { /* best-effort */ } }
}
/** End every subscriber stream for a finished/stopped build. */
function endBuild(rb: RunningBuild): void {
  rb.ended = true;
  for (const s of rb.subscribers) { try { s.end(); } catch { /* already closed */ } }
  rb.subscribers.clear();
  if (rb.key) { try { liveChannel.close(rb.key); } catch { /* best-effort */ } }
}
/** Is a build currently running for this account? (Account-wide — unscoped by session. Kept for
 *  callers that only care "is this account building anything", e.g. the /chat route's own
 *  reconnect-on-drop, which is always reconnecting to a build IT started, so it can't attach to the
 *  wrong session by construction.) */
function isBuildRunning(buildKey: string): boolean {
  const rb = runningBuilds.get(buildKey);
  return !!rb && !rb.ended;
}
/** Is a build running for this account AND does it belong to `workspaceId`? Use this (not
 *  `isBuildRunning`) for any path that might auto-attach to a build the caller didn't itself start —
 *  otherwise a build genuinely still running in a DIFFERENT v3.0 session under the same account gets
 *  silently replayed/mirrored into whatever session is currently open. `workspaceId: null` (unknown)
 *  falls back to the account-wide check for backward compatibility with callers that don't have one.
 *  Takes the `RunningBuild` directly (not a `buildKey` lookup) so it's a pure, unit-testable function —
 *  callers pass `runningBuilds.get(buildKey)`. */
export function isBuildRunningForWorkspace(rb: RunningBuild | undefined, workspaceId: string | null): boolean {
  if (!rb || rb.ended) return false;
  if (!workspaceId) return true;
  return rb.workspaceId === workspaceId;
}

/**
 * Should a NEW build request RECLAIM the account's build lock instead of being 409'd? (Root-cause fix,
 * 2026-07-04.) The `activeBuilds` account lock is released by the build handler's `finally` — but if a
 * network blip leaves the build body stuck on an un-abortable await, that `finally` never runs and the
 * lock is only released at the long wall-clock deadline, TRAPPING the account for minutes with a
 * dead-end 409. Reclaim when the existing build is a ZOMBIE (no live registry entry — a crash cleared
 * `runningBuilds` but not the lock) or ABANDONED (its client dropped, so it has NO attached subscriber,
 * and it has been running past the stall window). A build with a live watcher, or a freshly-started one,
 * is genuinely active → keep the honest 409 (the client re-attaches, or the user Stops it). Pure + tested. */
export function shouldReclaimBuildLock(existing: RunningBuild | undefined, now: number, staleMs = 30_000): boolean {
  if (!existing || existing.ended) return true;
  return existing.subscribers.size === 0 && now - existing.startedTs > staleMs;
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
export function selectBuildModel(tier: StartTier | undefined, powerOn: boolean, largeProject = false): string {
  if (powerOn) return opusModel();
  // LARGE existing project → Sonnet DIRECTLY (admin decision 2026-07-05: "badi apps direct Sonnet").
  // The analyser tiers by the PROMPT's complexity — but on a big imported app even a simple ask
  // ("survey my app") carries a huge context, which Haiku + the cheap floor handled by timing out
  // 8× and then falling to Claude anyway (Mitrify autopsy). Route the turn where it will end up.
  if (largeProject) return sonnetModel();
  if (tier === 'sonnet' || tier === 'opus') return sonnetModel();
  return haikuModel();
}

/**
 * Is this an existing project big enough that the cheap floor + Haiku reliably struggle (huge
 * per-turn context)? Threshold env-tunable via AGENTV3_LARGE_PROJECT_FILES (default 100 files —
 * Mitrify-scale imports are ~300+, fresh v3.0 builds are ~15-60). Pure + exported for testing.
 */
export function isLargeExistingProject(fileCount: number): boolean {
  const threshold = Math.max(1, parseInt(process.env.AGENTV3_LARGE_PROJECT_FILES || '', 10) || 100);
  return fileCount >= threshold;
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
 * Parse the E2BActuator's own dev-server health-check line out of `runCommand('npm run dev')`'s
 * combined stdout+stderr (see E2BActuator.runCommand's long-running-command branch, which ALWAYS
 * appends one of these two exact lines). Reused by the "Diagnose" preview button so it reports
 * the REAL boot outcome (installed deps, pre-kill, start, port-wait, one retry) instead of a guess.
 * Pure + exported for testing.
 */
export function parseDevServerHealthCheck(combined: string): { up: boolean; port: number | null } {
  const upMatch = /dev server is UP on port (\d+)/.exec(combined);
  if (upMatch) return { up: true, port: Number(upMatch[1]) };
  const downMatch = /dev server did not come up on port (\d+)/.exec(combined);
  if (downMatch) return { up: false, port: Number(downMatch[1]) };
  return { up: false, port: null };
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
 * `AGENTV3_CHEAP_FLOOR` is not "off" AND at least one provider's key is present. Otherwise it
 * returns `[]`, so the build chain stays **byte-for-byte today's Claude path** — the instant,
 * no-redeploy rollback. These runners are tried FIRST; `buildTurnRunner` keeps Claude (+ the
 * forced-Haiku backstop) permanently after them, so a cheap-model failure NEVER breaks a build.
 *
 * GLM AND KIMI ARE "FRIENDS" (admin decision, 2026-07-01): both are included whenever the floor is
 * on, one after the other — GLM's own ladder first, then KIMI's — so a GLM outage/rate-limit/slowness
 * falls through to KIMI instead of jumping straight to the (more expensive) Claude tier, and vice
 * versa. `AGENTV3_CHEAP_FLOOR=glm` or `=kimi` still pin to ONE ONLY (kept for explicit single-
 * provider testing/rollback); any OTHER non-"off" value (e.g. `on`, `both`) enables both. Each
 * provider independently no-ops if its own API key is missing — the other still works alone.
 *
 * MODEL LADDER (admin-requested): each provider emits ONE runner per model id in its ladder, newest
 * → 1-step-back, so a retired/unresponsive latest model (e.g. a 404 on a discontinued id, an outage,
 * a rate-limit) falls through to the previous cheap model — then the other provider — then Claude.
 * The existing `MultiProviderTurnRunner` already does error-based per-turn fallback, so this is just
 * "more runners prepended" — no new orchestration. (This covers "no response / unavailable"; it does
 * NOT cover a model that replies but builds badly — that stays the objective gate + Claude escalation's
 * job.) The ladder stays CHEAP coding models, NOT the flagship — escalation owns "go stronger".
 *
 * TIMEOUT (admin decision, 2026-07-01): 25s per call, down from 60s — a real build report showed a
 * single stuck GLM call took 131s before the multi-provider runner's own retry/fallback even got a
 * chance to act, wasting most of a build's wall-clock budget on one slow cheap-floor attempt. 25s is
 * generous for a genuinely-working fast/cheap model turn while failing over to the next provider (or
 * Claude) far sooner when one is stuck or degraded.
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
        const client = new OpenAI({ apiKey, baseURL, timeout: 25_000, maxRetries: 0 });
        runners.push({ name, runner: new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model }) });
      } catch { /* misconfigured model rung — skip; the next rung / Claude still backstops */ }
    }
  };
  // Explicit ALLOWLIST (not just "anything but off") so a stray/unrecognized value (a typo, an old
  // config left over from a different provider name) stays a safe no-op instead of silently turning
  // on paid GLM/KIMI calls. 'glm'/'kimi' still pin to ONE (explicit single-provider testing/rollback);
  // 'both'/'on' enable the "friends" pair.
  if (floor === 'glm' || floor === 'both' || floor === 'on') {
    add('GLM', process.env.GLM_API_KEY, process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4', parseModelLadder(process.env.GLM_MODEL, ['glm-4.7', 'glm-4.6']));
  }
  if (floor === 'kimi' || floor === 'both' || floor === 'on') {
    add('KIMI', process.env.KIMI_API_KEY, process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1', parseModelLadder(process.env.KIMI_MODEL, ['kimi-k2.7-code', 'kimi-k2.6']));
  }
  return runners;
}

/**
 * The REVIEWER for a cheap-floor (GLM/KIMI) build — admin plan 2026-07-05: review with GROK, not
 * Sonnet. Grok is cheaper than Sonnet AND an independent model family (less correlated blind spots),
 * and it keeps Claude out of the review step entirely — Claude is then spent ONLY on the final repair.
 *
 * Returns the `JudgeRunTurn` + model id `judgeBuild()` needs. GROK is used when a Grok/xAI key is
 * present and `AGENTV3_REVIEWER` is not 'sonnet'; otherwise it SAFELY falls back to the Sonnet judge
 * (today's behaviour) — so an unconfigured env, or a Grok outage, never changes or breaks a build.
 * Grok speaks the OpenAI-compatible API (same client the GLM/KIMI floor uses), so no new infra.
 */
function selectReviewJudge(): { runTurn: JudgeRunTurn; modelId: string; kind: 'grok' | 'sonnet' } {
  const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const kind = selectReviewer({ reviewer: process.env.AGENTV3_REVIEWER, grokKey });
  if (kind === 'grok') {
    try {
      const client = new OpenAI({ apiKey: grokKey, baseURL: process.env.GROK_BASE_URL || 'https://api.x.ai/v1', timeout: 30_000, maxRetries: 1 });
      const runTurn: JudgeRunTurn = async ({ model, system, messages, maxTokens }) => {
        const r = await client.chat.completions.create({
          model,
          messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: 'user' as const, content: m.content }))],
          max_tokens: maxTokens,
        });
        return { text: r.choices?.[0]?.message?.content ?? '' };
      };
      return { runTurn, modelId: process.env.GROK_JUDGE_MODEL || 'grok-3', kind: 'grok' };
    } catch { /* client not constructable → fall through to Sonnet */ }
  }
  const runTurn: JudgeRunTurn = (a) => new ClaudeClient(undefined, { maxRetries: 1 }).runTurn(a).then((t) => ({ text: t.text }));
  return { runTurn, modelId: sonnetModel(), kind: 'sonnet' };
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
  // SMART CHEAP-FIRST (admin 2026-07-03): when ESCALATION is on, EVERY app — simple OR complex —
  // tries the cheap floor (GLM/Kimi) FIRST, because a weak cheap build is caught by the mandatory
  // readiness gate (it downgrades ok:false) and RETRIED on Sonnet. So all apps get the cheap-first
  // cost saving AND the Sonnet safety net. WITHOUT escalation there is no stronger retry, so we keep
  // the conservative split (complex → strong directly) — a complex app must never ship a weak cheap
  // build with no way to escalate. This makes "all apps cheap-first → gate → Sonnet-on-fail" the
  // behaviour precisely when it is safe.
  if (escalationEnabled()) return true;
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
  // Builds run on CLAUDE FIRST (Haiku/Sonnet/Opus do REAL tool-use → real files). Gemini/Vertex CAN
  // hallucinate in the tool-use loop — reply describing files ("creating index.html…") without ever
  // calling write_file — which is why they were EXCLUDED entirely from the build chain until now.
  //
  // Wired as the TRUE LAST RESORT (admin request, 2026-07-01: "Claude fail to vertex/gemini") — only
  // after Claude's primary model AND its forced-Haiku backstop have BOTH thrown. Kept as an OPT-IN
  // flag (AGENTV3_BUILD_ALLOW_GEMINI=1), NOT the new default: the exclusion above documents a REAL
  // past incident (every build silently running on Gemini/Vertex with ZERO real files, $0 Claude
  // spend on the dashboard) — not a theoretical risk. Safety nets built since (the empty-build
  // retry-on-stronger-model net, the mandatory readiness gate, the G3 tsc verification gate) likely
  // catch a repeat of that today, but "likely" isn't the bar for silently flipping a fix for an
  // incident the admin personally hit — that decision needs an explicit, informed go-ahead first.
  const fallback = process.env.AGENTV3_BUILD_ALLOW_GEMINI === '1' ? cheap : [];
  const claudeFirst = resolveClaudeFirst(opts?.claudeFirst, process.env.AGENTV3_BUILD_CLAUDE_FIRST);
  // NOTE: fallback (Vertex/Gemini) sits AFTER withBackstop in the claudeFirst branch — Claude and its
  // forced-Haiku backstop are exhausted FIRST, Vertex/Gemini is the absolute last resort, matching the
  // requested chain "CLAUDE_HAIKU/sonnet (by complexity) -> vertex/gemini". The claudeFirst===false
  // branch is a DIFFERENT, separately-opted-into cost strategy (try the cheap model before Claude) —
  // left unchanged; the admin's chain applies to the default (claudeFirst===true) path.
  const baseChain = claudeFirst ? [claude, ...withBackstop, ...fallback] : [...fallback, claude, ...withBackstop];
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
    // 25s timeout matches the cheap-floor decision: a stalled plan call should fail FAST to the Claude
    // fallback, not burn a flat 60s in front of the user-visible approval gate. Overridable via env.
    const timeoutMs = Number(process.env.AGENTV3_GROK_PLAN_TIMEOUT_MS) || 25_000;
    const client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1', timeout: timeoutMs, maxRetries: 0 });
    // Default to a current FAST xAI tier ('grok-4-fast-non-reasoning') instead of the older/slower
    // grok-3 — the plan is a single update_todo tool call, so a fast non-reasoning model is ideal.
    // Overridable via AGENTV3_GROK_PLAN_MODEL; the Claude-Haiku fallback guards any model regression.
    const model = process.env.AGENTV3_GROK_PLAN_MODEL || 'grok-4-fast-non-reasoning';
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
    // `workspaceId` is OPTIONAL (older/other callers that only care "is this account building
    // anything" keep working unchanged). When the caller DOES pass one (the v3.0 panel's
    // auto-resume check), `buildRunningHere` answers "is a build running for THIS session" —
    // the account-wide `buildRunning` stays as-is for backward compatibility, but auto-resume
    // must key off `buildRunningHere`, or a build genuinely still running in a DIFFERENT v3.0
    // session bleeds its progress into whatever session the user currently has open.
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    // Under per-workspace locking (FIX #3) the registry is keyed by workspace, so scope the lookups
    // accordingly: `buildRunningHere` looks up THIS session's key; the account-wide `buildRunning`
    // counts any of the account's live builds. Flag OFF → both use the account key (today's behaviour).
    const perWs = perWorkspaceLockEnabled();
    const hereKey = buildLockKey(userId, workspaceId, perWs);
    const buildRunning = perWs ? countActiveBuildsForUser(runningBuilds.values(), userId) > 0 : isBuildRunning(userId ?? 'anon');
    res.json({
      enabled: isAgentV3Enabled(userId, email),
      buildRunning,
      buildRunningHere: isBuildRunningForWorkspace(runningBuilds.get(hereKey), workspaceId),
      ...agentV3Status(),
      team: agentLifecycle.snapshot(),
    });
  });

  // D7 — list a user's persisted builds (most-recently-updated first) so the client can
  // reload one after a refresh/reconnect. Metadata only (no transcript) for a cheap list.
  app.get('/api/agentv3/conversations', async (req: Request, res: Response) => {
    const { userId, email } = await resolveReadIdentity(req); // SECURITY (C1 follow-up): verified token, not query.userId
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
    const { userId, email } = await resolveReadIdentity(req); // SECURITY (C1 follow-up): verified token, not query.userId
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    try {
      // A v3_<sessionId> history entry has no server record under that literal id, but the SAME
      // session's full transcript lives under its workspace id — agentv3-{uid}-{sid}, or
      // agentv3-anon-{sid} when the build ran identity-degraded. Try the candidates in order so
      // opening such an entry restores the REAL transcript instead of an empty local copy.
      const store = getConversationStore();
      let rec: Awaited<ReturnType<typeof store.get>> = null;
      for (const cid of candidateConversationIds(req.params.id, userId)) {
        // This is THE reopen path — the one consumer that renders the evidence layer, so it alone
        // asks for the timeline (hot-path get() calls elsewhere skip those reads).
        rec = await store.get(cid, { includeTimeline: true }).catch(() => null);
        if (rec) break;
      }
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

  // Delete one persisted build (history-menu "delete" action). Owner-only — the same
  // conversationAccess() ownership check as the GET-one route above. The underlying store's
  // remove() is a no-op if the id doesn't exist, so this is safe to call twice (double-click).
  app.delete('/api/agentv3/conversations/:id', async (req: Request, res: Response) => {
    const { userId, email } = await resolveReadIdentity(req); // SECURITY (C1 follow-up): verified token, not query.userId
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' });
      return;
    }
    try {
      const store = getConversationStore();
      // Resolve the SAME candidate ids the GET route uses (v3_<sid> → agentv3-<uid>-<sid> →
      // agentv3-anon-<sid>) and remove EVERY accessible match — a history row deleted by its
      // legacy v3_ id must actually delete the underlying server record(s), not silently no-op
      // and reappear on the next list (the "ghost row" bug).
      let removed = false;
      let forbidden = false;
      for (const cid of candidateConversationIds(req.params.id, userId)) {
        const rec = await store.get(cid).catch(() => null);
        const access = conversationAccess(rec, userId);
        if (access === 'ok') {
          await store.remove(cid);
          removed = true;
        } else if (access === 'forbidden') {
          forbidden = true;
        }
      }
      if (!removed && forbidden) {
        res.status(403).json({ error: 'This build belongs to another account.' });
        return;
      }
      res.json({ ok: true }); // removed, or already gone — idempotent
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
    // History list (P-REPORT.4): "the report vanished when the next build started" — past builds'
    // reports are kept in a bounded per-workspace history, independent of whichever build most
    // recently overwrote the "latest" doc below. Metadata only (cheap); fetch one in full via buildId.
    if (req.query.history === '1') {
      if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
      const history = await listDiagnosticsHistory(workspaceId).catch(() => []);
      res.json({ history });
      return;
    }
    // FULL SESSION report (scope=session): stitch EVERY settled build of this session together, oldest
    // → newest, instead of only the latest. Each build's report is overwritten in the "latest" doc but
    // durably retained in the per-workspace history; here we aggregate that history so the download/copy
    // carries the whole "0 → last" record ("pura kaccha chittha"). Read-only — no build path touched.
    if (req.query.scope === 'session') {
      if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
      const meta = await listDiagnosticsHistory(workspaceId, 20).catch(() => []);
      const full = (await Promise.all(meta.map((h) => getDiagnosticsHistoryItem(workspaceId, h.id).catch(() => null)))).filter(Boolean) as BuildDiagnosticsReport[];
      // Include the current "latest" doc too, in case the newest build hasn't landed in history yet, and
      // dedup by startedAt so a build present in both is not shown twice.
      const latest = await loadDiagnostics(workspaceId).catch(() => null);
      const byStart = new Map<number, BuildDiagnosticsReport>();
      for (const r of full) if (r) byStart.set(r.startedAt, r);
      if (latest) byStart.set(latest.startedAt, latest);
      const ordered = [...byStart.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      if (ordered.length === 0) { res.status(404).json({ error: 'No build diagnostics yet — run a build first.' }); return; }
      if (req.query.format === 'text') {
        res.type('text/plain').send(renderSessionDiagnosticsText(ordered));
        return;
      }
      res.json({ session: { builds: ordered, count: ordered.length } });
      return;
    }
    // Resolve the report: a SPECIFIC past build (buildId) or the latest one — shared by both the
    // JSON response and the plain-text render below, so `?format=text` works on either.
    let report: BuildDiagnosticsReport | null | undefined;
    if (typeof req.query.buildId === 'string' && req.query.buildId) {
      if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
      report = await getDiagnosticsHistoryItem(workspaceId, req.query.buildId).catch(() => null);
      if (!report) { res.status(404).json({ error: 'No diagnostics found for that build.' }); return; }
    } else {
      // Prefer the DURABLE (Firestore) copy keyed by workspaceId: it is the freshest authoritative
      // copy — it survives an instance rotation AND carries PREVIEW errors appended AFTER the build
      // (the in-memory copy, keyed only by userId, can be a stale earlier build or miss the preview
      // append). Fall back to the in-memory copy only when there is no workspaceId or no durable copy.
      if (workspaceId) report = await loadDiagnostics(workspaceId).catch(() => null);
      if (!report) report = lastDiagnostics.get(userId ?? 'anon');
      // Durable per-USER fallback (P-REPORT.5): the workspaceId-keyed doc can be missing (a fresh
      // session mints a NEW workspaceId with no report yet) and the in-memory map is wiped by every
      // cold start. This Firestore doc keyed by userId alone holds the user's LAST settled build
      // report across cold starts / instance rotation / reloads / new sessions — so the "Build report"
      // never vanishes after a real build.
      if (!report) report = await loadLatestForUser(userId).catch(() => null);
      if (!report) { res.status(404).json({ error: 'No build diagnostics yet — run a build first.' }); return; }
    }
    // Human/Claude-readable plain-text render — root cause first, problems only, full AI Diagnosis
    // Bundle (sandbox commands, LLM I/O, preview errors, the reviewer's complete findings). Previously
    // built but reachable from nowhere; wired here so "Text report" can actually download it.
    if (req.query.format === 'text') {
      res.type('text/plain').send(renderDiagnosticsText(report));
      return;
    }
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
      if (durable) {
        const withPreviewError = append(durable);
        await saveDiagnostics(workspaceId, withPreviewError).catch(() => {});
        // Refresh the SAME history entry (same startedAt → same id) with the late-arriving preview
        // error, so a build's history record isn't missing evidence captured after it settled.
        await saveDiagnosticsHistory(workspaceId, withPreviewError).catch(() => {});
        // Keep the durable per-USER "latest report" in sync too, so a preview error that arrives after
        // the build settled still reaches the userId-keyed copy the report UI falls back to — but ONLY
        // when this workspace IS the user's latest build (same/newer startedAt). This prevents a late
        // preview error from an OLDER workspace regressing the per-user copy to a stale build.
        const perUser = await loadLatestForUser(userId).catch(() => null);
        if (!perUser || (withPreviewError.startedAt ?? 0) >= (perUser.startedAt ?? 0)) {
          await saveLatestForUser(userId, withPreviewError).catch(() => {});
        }
      }
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

  // Persistence health (C3) — a one-URL admin check for "why did my chat/files/memory vanish on
  // reload?". Returns whether any Firestore write/init has silently failed this process (the
  // free-tier daily write-quota case, or a mis-pointed FIRESTORE_DATABASE_ID). `healthy:true` with
  // 0 failures means persistence is working; a non-zero `failures` with the last scope/op/error is
  // the smoking gun that data is silently NOT being saved. Unauthenticated like preview-status
  // (diagnostic only — it exposes no user data, just a failure count + the last error message).
  app.get('/api/agentv3/persistence-status', (_req: Request, res: Response) => {
    res.json(persistenceHealth());
  });

  // "Diagnose" button (Live server empty state) — reuses the EXACT same real boot sequence the
  // build loop uses (E2BActuator.runCommand's long-running-command branch: stale-deps install,
  // pre-kill any stale process on the port, start the dev server, poll the port, one automatic
  // restart on failure) instead of a separate speculative check, so what the user sees is the
  // real internal outcome — not a guess. On success it also resolves + returns the live URL so
  // the client can restore the preview immediately, without waiting for the agent to republish it.
  app.post('/api/agentv3/preview-diagnose', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const framework = typeof req.body?.framework === 'string' ? req.body.framework : 'vite-react';
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' }); return; }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    // STREAMED PROGRESS (opt-in via body.stream) — the boot legitimately takes 30-90s on a cold
    // sandbox, and a single silent POST gave the user no way to tell "loading" from "stuck". The
    // stream emits REAL stage events (stage-count-based percentages — never a fake time-based bar)
    // plus a seconds heartbeat during the long install/boot stage, then the same terminal payload
    // the JSON mode returns. Non-stream callers keep the original single-JSON contract.
    const wantsStream = req.body?.stream === true;
    let streaming = false;
    const sendStage = (label: string, pct: number): void => {
      if (streaming && !res.writableEnded) res.write(JSON.stringify({ type: 'stage', label, pct }) + '\n');
    };
    const finish = (payload: Record<string, unknown>, status = 200): void => {
      if (streaming) {
        if (!res.writableEnded) {
          res.write(JSON.stringify({ type: 'result', ...payload }) + '\n');
          res.end();
        }
        return;
      }
      res.status(status).json(payload);
    };
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streaming = true;
    }
    const diag = sandboxDiag();
    if (!diag.livePreviewAvailable) {
      finish({ ok: false, portListening: false, reason: 'Live server preview isn\'t available on this deployment — no cloud sandbox (E2B) is configured. Use the In-browser preview instead.', detail: '' });
      return;
    }
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const actuator = buildActuator();
      const expectedPort = oneShotDevPort(framework);
      // COLD-SANDBOX HYDRATION (fixes the bogus "No package.json found" on a perfectly-saved project):
      // the Diagnose button is used precisely when the Live-server preview is empty — i.e. when the
      // sandbox has idle-paused / expired / been recycled. Without this, getSandbox() spins up a FRESH
      // EMPTY sandbox, the readFile('package.json') below fails, and we wrongly tell the user their
      // intact project has no files. Resume the user's own sandbox and re-seed the durable files first,
      // exactly like the chat build path (deriveWorkspaceId → ensureWorkspace(resumeSandboxId) → hydrate).
      // Best-effort: on any failure we fall through to the structure check — never worse than today.
      sendStage('Restoring your project into the sandbox', 6);
      try {
        const resumeSandboxId = sandboxResumeEnabled()
          ? (await sandboxStore.get(workspaceId).catch(() => null)) ?? undefined
          : undefined;
        await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId);
        const saved = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
        if (Object.keys(saved).length > 0) await writeWorkspaceFiles(actuator, workspaceId, saved);
        // Re-materialize durable binary assets (logo/icons/fonts) into the re-seeded sandbox.
        await restoreWorkspaceAssets(actuator, workspaceId).catch(() => 0);
      } catch { /* hydration is best-effort — the structure check below still runs */ }
      // STRUCTURE VALIDATION FIRST — before spending 90 s trying to boot a server that CAN'T run.
      // Read package.json and confirm the project is actually runnable (valid JSON + a dev/start/serve
      // script). A missing/broken package.json is reported as a clear structural issue instead of the
      // mystery "Closed Port Error: no service on port 5173" the admin hit.
      sendStage('Checking the project structure', 10);
      const pkgRaw = await actuator.readFile(workspaceId, 'package.json').catch(() => null);
      const structure = validateProjectForPreview(pkgRaw);
      // PORT TRUTH: the app's own dev script beats the framework guess — a real imported app
      // declared `--port 5173 --strictPort` while the framework guess waited on 3000, so a
      // healthy boot could never be seen as up (admin evidence, 2026-07-04).
      const scriptPort = devScriptPort(pkgRaw);
      const effectivePort = scriptPort ?? expectedPort;
      if (!structure.ok) {
        finish({ ok: false, portListening: false, reason: structure.issues.join(' '), detail: '' });
        return;
      }
      // 90s — matches the SimpleBuilder fastPreview default (deps install + start + port-wait +
      // one retry can legitimately take that long on a cold sandbox; a shorter cap would report a
      // false "could not reach the sandbox" for an install that's simply still running).
      sendStage('Installing dependencies & starting the dev server', 35);
      const bootStartedAt = Date.now();
      if (streaming) {
        heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(JSON.stringify({ type: 'tick', seconds: Math.round((Date.now() - bootStartedAt) / 1000) }) + '\n');
          else if (heartbeat) clearInterval(heartbeat);
        }, 5_000);
      }
      const result = await withTimeout(actuator.runCommand(workspaceId, 'npm run dev'), 90_000, 'preview-diagnose');
      if (heartbeat) clearInterval(heartbeat);
      sendStage('Running the health check', 85);
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      const { up, port } = parseDevServerHealthCheck(combined);
      const boundPort = port ?? effectivePort;
      if (up) {
        sendStage('Resolving the public preview URL', 95);
        let previewUrl: string | undefined;
        try { previewUrl = applyPreviewDomain(await withTimeout(actuator.getPortUrl(workspaceId, boundPort), 10_000, 'preview-diagnose-url')); } catch { /* URL resolution best-effort — the boot itself already succeeded */ }
        finish({
          ok: true,
          portListening: true,
          port: boundPort,
          previewUrl,
          reason: previewUrl ? `Dev server is up on port ${boundPort} — preview restored.` : `Dev server is up on port ${boundPort}, but the public URL could not be resolved yet. Try again in a few seconds.`,
          detail: combined.slice(-4000),
        });
        return;
      }
      finish({
        ok: false,
        portListening: false,
        port: boundPort,
        reason: `The dev server did not come up on port ${boundPort} after installing dependencies and one restart attempt. The exact cause is in the detail log below (a crash on boot, a missing dependency, or a port conflict).`,
        detail: combined.slice(-4000),
      });
    } catch (err) {
      if (heartbeat) clearInterval(heartbeat);
      finish({ ok: false, portListening: false, reason: err instanceof Error ? err.message : 'Could not reach the sandbox to diagnose the preview.', detail: '' }, 500);
    }
  });

  // PREVIEW HEALTH — v3.0's self-awareness of whether the preview is actually running. Gathers REAL
  // signals (durable file count → the app survives years; live backend configured?; a warm sandbox's
  // port probe) and classifies the true state: live / sleeping (idle-recycled — reboots on demand) /
  // crashed / inbrowser_only / empty. Deliberately does NOT create a sandbox just to check (that would
  // be wasteful and slow) — a cold workspace reports `sleeping` (rebootable from saved files), which is
  // exactly the "reopen an old chat years later" case: files are safe, the live preview boots on demand.
  app.post('/api/agentv3/preview-health', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const framework = typeof req.body?.framework === 'string' ? req.body.framework : 'vite-react';
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v3.0 is not available for this account.' }); return; }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    try {
      // hasFiles is DURABLE (Firestore) — true even years later on a long-dead sandbox.
      const fileCount = await raceTimeout(countWorkspaceFiles(workspaceId), 4_000, 'previewHealthFiles').catch(() => 0);
      const diag = sandboxDiag();
      // Only probe the live port when a sandbox is ALREADY warm — never spin one up just to check.
      let livePortUp: boolean | null = null;
      if (diag.livePreviewAvailable) {
        try {
          const actuator = buildActuator();
          const sandboxId = actuator.getSandboxId ? await raceTimeout(actuator.getSandboxId(workspaceId), 4_000, 'previewHealthSandbox').catch(() => null) : null;
          if (sandboxId) {
            const port = oneShotDevPort(framework);
            const probe = await raceTimeout(
              actuator.runCommand(workspaceId, `curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:${port} 2>/dev/null || echo 000`),
              8_000, 'previewHealthProbe',
            ).catch(() => ({ stdout: '000', stderr: '', exitCode: -1 }));
            livePortUp = /\b(?:200|301|302|304)\b/.test(probe.stdout || '');
          }
        } catch { /* probe is best-effort — a failure just means "not currently up" (null/false) */ }
      }
      const health = classifyPreviewHealth({
        hasFiles: fileCount > 0,
        liveBackend: diag.livePreviewAvailable,
        livePortUp,
        everPublished: fileCount > 0, // files exist ⇒ a build ran ⇒ a preview was attempted
        lastError: null,             // a specific crash error only comes from a live boot (Diagnose)
        booting: false,
      });
      res.json({ ...health, fileCount });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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

  // Stop the running build — aborts the agent loop (between turns), ends every attached stream, and
  // frees the slot so a fresh build can start. Under per-workspace locking (FIX #3) the client passes
  // `workspaceId` so Stop targets THIS app's build (not the whole account); flag OFF → the account key.
  app.post('/api/agentv3/stop', (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const stopWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    const buildKey = buildLockKey(userId, stopWorkspaceId, perWorkspaceLockEnabled());
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

  // ── Command QUEUE (FIX #4.2): durable per-app queue the serial executor drains one at a time ──
  // Every endpoint is workspace-owner-gated (a user can only touch THEIR app's queue) and best-effort.

  /** Enqueue a command for THIS app. `source`: 'user' (typed) | 'planner' | 'advisor' (a non-writing
   *  chat handing work to the executor). Returns the updated queue + summary. */
  app.post('/api/agentv3/queue/enqueue', async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Not your workspace.' }); return; }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) { res.status(400).json({ error: 'A non-empty prompt is required.' }); return; }
    if (prompt.length > MAX_PROMPT_LEN) { res.status(400).json({ error: `Prompt is too long (max ${MAX_PROMPT_LEN} chars).` }); return; }
    const source: QueueItemSource = req.body?.source === 'planner' || req.body?.source === 'advisor' ? req.body.source : 'user';
    let added = true; let reason: string | undefined;
    const queue = await mutateQueue(workspaceId, (q) => {
      const r = enqueueCommand(q, { id: randomUUID(), prompt, source, createdTs: Date.now() });
      added = r.added; reason = r.reason; return r.queue;
    });
    res.json({ added, reason: added ? undefined : reason, summary: queueSummary(queue), items: queue.items });
  });

  /** Read THIS app's queue (items + summary) — for the queue UI and the executor's idle check. */
  app.get('/api/agentv3/queue', async (req: Request, res: Response) => {
    const workspaceId = typeof req.query?.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Not your workspace.' }); return; }
    const queue = await loadQueue(workspaceId);
    res.json({ summary: queueSummary(queue), items: queue.items });
  });

  /** Cancel a PENDING command (a running one must be Stopped via the build). */
  app.post('/api/agentv3/queue/cancel', async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Not your workspace.' }); return; }
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) { res.status(400).json({ error: 'An item id is required.' }); return; }
    const queue = await mutateQueue(workspaceId, (q) => cancelQueueItem(q, id));
    res.json({ summary: queueSummary(queue), items: queue.items });
  });

  /** Atomically CLAIM the next pending command (→ 'running') for the serial executor. Returns the
   *  claimed item, or `claimed:null` when one is already running or nothing is pending. The client-driven
   *  executor calls this when the app goes idle, submits the returned prompt as a build, then calls
   *  /queue/complete when that build settles. */
  app.post('/api/agentv3/queue/next', async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Not your workspace.' }); return; }
    // Cheap short-circuit: a cached read tells us if there's anything to claim. When the queue is empty
    // or one is already running (the common case — most builds are not queued), return WITHOUT a
    // transaction/write, so the client-driven executor's per-settle probe costs ~nothing for non-queue users.
    const current = await loadQueue(workspaceId);
    if (pendingQueueItems(current).length === 0 || runningQueueItem(current)) {
      res.json({ claimed: null, summary: queueSummary(current), items: current.items });
      return;
    }
    let claimed: QueueItem | null = null;
    const queue = await mutateQueue(workspaceId, (q) => { const r = claimNextQueued(q); claimed = r.claimed; return r.queue; });
    res.json({ claimed, summary: queueSummary(queue), items: queue.items });
  });

  /** Mark the currently-running queued command done/failed (with an honest note) once its build settles.
   *  A failure PAUSES the queue client-side (the user decides retry/skip/stop) — recorded here honestly. */
  app.post('/api/agentv3/queue/complete', async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Not your workspace.' }); return; }
    const ok = req.body?.ok === true;
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;
    const queue = await mutateQueue(workspaceId, (q) => completeQueuedRunning(q, ok, note));
    res.json({ summary: queueSummary(queue), items: queue.items });
  });

  // SHIP TO MAIN (own-repo working-branch storage, slice 2): merge the user's `navbharatai/work`
  // branch into their repo's default branch via a PR — but ONLY when CI is green (or the repo has no
  // checks). Honest: a red/pending PR is left OPEN with a clear note, never force-merged. The user's
  // OWN GitHub token is the authority (only their own repos are writable), so this can never touch
  // another account's repo. `main` changes ONLY here, on the user's explicit click.
  app.post('/api/agentv3/ship', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    if (!ownRepoStorageEnabled()) {
      res.status(400).json({ error: 'Shipping to your own repo is not enabled yet.' });
      return;
    }
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const token = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
    if (!repo || !token) {
      res.status(400).json({ error: 'Sign in with GitHub and open a build on your own repo to ship it.' });
      return;
    }
    try {
      const client = new UserGitHubClient(token);
      // The token's own login is the repo owner (UserGitHubClient uses login-as-owner), and we verify
      // write access — so a caller can only ever ship a repo they personally own and can push to.
      const access = await client.getRepoAccess(repo);
      if (!access.exists || !access.canPush) {
        res.status(403).json({ error: 'You do not have write access to that repository (or it no longer exists).' });
        return;
      }
      // Open-or-reuse the work→default PR, read its CI, and merge ONLY when green/none (Claude-Code
      // style). A red/pending PR is returned OPEN with an honest note — never force-merged.
      const flow = await mergeViaPullRequest(client, repo, {
        head: WORK_BRANCH,
        base: access.defaultBranch,
        title: `NavBharatAI: ship ${repo}`,
        body: `Merging \`${WORK_BRANCH}\` into \`${access.defaultBranch}\` — reviewed & shipped from NavBharatAI Pro v3.0.`,
      });
      res.json({
        merged: flow.merged,
        opened: flow.opened,
        prNumber: flow.prNumber,
        prUrl: flow.prUrl,
        ci: flow.ci,
        base: access.defaultBranch,
        note: flow.note || (flow.merged ? `Merged into ${access.defaultBranch}.` : 'Nothing to merge yet — make an edit first.'),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // REVERT LAST MERGE (own-repo storage, slice 2b): undo the most recent change to the user's default
  // branch by snapshotting it back to the previous state as a NEW commit (never a force-push — history
  // is preserved and the revert is itself revertible). Only a single-parent head (the shape a squash
  // "Ship to main" produces) is auto-revertible; a true merge / root commit is refused honestly and the
  // user is pointed at GitHub's own Revert. The user's own token is the authority (own repos only).
  app.post('/api/agentv3/revert', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    if (!ownRepoStorageEnabled()) {
      res.status(400).json({ error: 'Own-repo revert is not enabled yet.' });
      return;
    }
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const token = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
    if (!repo || !token) {
      res.status(400).json({ error: 'Sign in with GitHub and open a build on your own repo to revert it.' });
      return;
    }
    try {
      const client = new UserGitHubClient(token);
      const access = await client.getRepoAccess(repo);
      if (!access.exists || !access.canPush) {
        res.status(403).json({ error: 'You do not have write access to that repository (or it no longer exists).' });
        return;
      }
      const base = access.defaultBranch;
      const head = await client.getBranchHeadCommit(repo, base);
      const plan = planRevert(head);
      if (!plan.canRevert || !plan.parentSha || !head) {
        res.json({ reverted: false, note: plan.reason ?? 'This change can’t be auto-reverted — use GitHub’s Revert button.' });
        return;
      }
      // Snapshot base back to the parent's tree as a NEW commit on top of the current head (no force).
      const parentTree = await client.getCommitTreeSha(repo, plan.parentSha);
      if (!parentTree) {
        res.json({ reverted: false, note: 'Could not read the previous state to revert to.' });
        return;
      }
      const firstLine = (head.message.split('\n')[0] || 'last change').slice(0, 120);
      const revertSha = await client.createCommit(repo, `Revert "${firstLine}"\n\nReverted from NavBharatAI Pro v3.0.`, parentTree, [head.sha]);
      if (!revertSha) {
        res.json({ reverted: false, note: 'Could not create the revert commit.' });
        return;
      }
      const updated = await client.updateBranchRef(repo, base, revertSha);
      if (!updated) {
        res.json({ reverted: false, note: 'Could not update the branch — someone may have pushed to it. Revert from GitHub instead.' });
        return;
      }
      res.json({ reverted: true, sha: revertSha, base, note: `Reverted the last change on ‘${base}’ — restored to the previous state (a new revert commit, undoable).` });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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
    // `workspaceId` is OPTIONAL for back-compat, but the panel's auto-resume ALWAYS sends the session
    // it's asking about. Under per-workspace locking (FIX #3) the registry is keyed by workspace, so we
    // look the build up by THAT key directly; flag OFF → the account key (today). The workspaceId
    // cross-check below stays as defense-in-depth either way.
    const requestedWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    const buildKey = buildLockKey(userId, requestedWorkspaceId, perWorkspaceLockEnabled());
    const rb = runningBuilds.get(buildKey);
    if (!rb || rb.ended) {
      res.status(404).json({ error: 'No running build to resume.' });
      return;
    }
    // Refuse to attach when the running build belongs to a DIFFERENT session under the same account, so
    // a build genuinely still running elsewhere never gets silently replayed into the session currently
    // open (the account-keyed path relies on this; the workspace-keyed path already can't mismatch).
    if (requestedWorkspaceId && rb.workspaceId && rb.workspaceId !== requestedWorkspaceId) {
      res.status(404).json({ error: 'No running build to resume for this session.' });
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

  // CROSS-DEVICE LIVE SYNC (poll): a SECOND device watching the same account's build polls this for
  // events newer than its cursor. Unlike /attach (in-memory, one instance), this reads the shared
  // LiveChannel, so it works even when the build runs on a DIFFERENT Cloud Run instance. Server-only
  // DB access (admin SDK) — the client never touches Firestore. Returns {events, seq, gap, running}.
  app.get('/api/agentv3/live', async (req: Request, res: Response) => {
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
    const sinceSeq = Number.parseInt(typeof req.query.sinceSeq === 'string' ? req.query.sinceSeq : '0', 10) || 0;
    // `workspaceId` is OPTIONAL for back-compat with older clients. When THIS instance is the one
    // actually running the build (the common case — same-instance), its in-memory `rb.workspaceId`
    // is authoritative: if it's for a DIFFERENT session than the caller asked about, report nothing —
    // otherwise a build genuinely still running in session A bleeds its progress into session B's
    // live-mirror poll.
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    const localRb = runningBuilds.get(userId);
    if (workspaceId && localRb && !localRb.ended && localRb.workspaceId && localRb.workspaceId !== workspaceId) {
      res.json({ events: [], seq: sinceSeq, gap: false, running: false });
      return;
    }
    try {
      const { events, seq, gap, workspaceId: eventsWorkspaceId } = await liveChannel.readSince(userId, sinceSeq);
      // CROSS-INSTANCE workspace scoping (closes the gap the #804 fix documented): the LiveChannel
      // now stamps events with the workspaceId of the build that produced them, so even when THIS
      // instance has no local record of the build (it runs — or ran — on a different Cloud Run
      // instance), a DIFFERENT session's events are refused instead of replayed into whatever chat
      // the caller has open. Unstamped events (a pre-upgrade ghost doc — exactly the stale tail that
      // made one stuck chat reappear everywhere, forever) are refused too when the caller asked for
      // a specific session: conservative deny, matching isBuildRunningForWorkspace's principle.
      if (!liveEventsAllowedFor(workspaceId, eventsWorkspaceId)) {
        res.json({ events: [], seq, gap: false, running: false });
        return;
      }
      // `running` lets the watcher stop polling once the build is done on this instance; the durable
      // result then syncs via the normal conversation reload.
      res.json({ events, seq, gap, running: isBuildRunning(userId) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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

  // Phase G1 — git as the third organ: return a workspace's DURABLE checkpoint history (newest first).
  // v3.0 builds make real git commits; this surfaces the persisted timeline so the IDE shows the full
  // history even across sessions / devices / sandbox recycles (not just the current session's RAM).
  // Ownership-checked; empty list when the workspace has no checkpoints yet.
  app.get('/api/agentv3/checkpoints', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    res.json({ checkpoints: await loadCheckpoints(workspaceId) });
  });

  // Phase G2 — wire git STATUS into the sync body: the real working-tree state from the live sandbox
  // (`git status --porcelain`) so the IDE can show "clean / N uncommitted change(s)" tied to the same
  // workspace the build + the editor share. `available:false` is the honest answer when the sandbox
  // isn't warm in this session (cold/recycled) — never a faked "clean". Ownership-checked.
  app.get('/api/agentv3/git-status', workspaceRateLimiter(), async (req: Request, res: Response) => {
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
    const status = await gitStatusForSession(workspaceId, userId ?? undefined);
    if (status) { res.json({ available: true, live: true, ...status }); return; }
    // Cold session (sandbox recycled): surface the last DURABLE checkpoint as a dormant-but-valid
    // working tree so the panel shows continuity ("Last saved … on <sha>") instead of the scary
    // "not active in this session" dead-end. Falls through to honest "not available" if no history.
    const dormant = dormantGitStatusFromCheckpoints(await loadCheckpoints(workspaceId).catch(() => []));
    res.json(dormant ?? { available: false, live: false, clean: false, changed: 0, head: '' });
  });

  // REAL Code Studio terminal: run ONE bounded command in the user's own warm v3.0 sandbox. Each
  // command runs under a hard timeout with capped output (see execInSession) — no persistent shell,
  // no runaway processes. available:false when the sandbox isn't warm (honest, never faked output).
  // Ownership-checked + rate-limited.
  app.post('/api/agentv3/exec', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const execResult = await execInSession(workspaceId, command, userId ?? undefined);
    // Honest dormant state (never faked output): when the live sandbox isn't warm (Cloud Run cold
    // start / idle recycle), tell the terminal whether this is a real project that just needs waking
    // ('dormant' — durable files exist) versus one that was never built ('not_started'). The UI shows
    // the same non-scary "send a message to bring it online" copy the git panel uses.
    if (execResult.available === false) {
      const fileCount = await countWorkspaceFiles(workspaceId).catch(() => 0);
      res.json({
        ...execResult,
        reason: fileCount > 0 ? 'dormant' : 'not_started',
        savedFileCount: fileCount,
      });
      return;
    }
    res.json(execResult);
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
      const { files, skipped } = await collectFilesWithSavedFallback(actuator, workspaceId, { liveTimeoutMs: 2_500 });
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
  // In-browser preview render cache (see the RENDER CACHE note inside the route). Insertion-order
  // Map doubles as a simple LRU-ish bound: oldest entry evicted once over MAX.
  const inbrowserPreviewCache = new Map<string, { hash: string; html: string; kind: string; ts: number }>();
  const INBROWSER_CACHE_TTL_MS = 5 * 60_000;
  const INBROWSER_CACHE_MAX = 30;

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
      const { files } = await collectFilesWithSavedFallback(actuator, workspaceId, { liveTimeoutMs: 2_500 });
      if (Object.keys(files).length === 0) {
        res.status(404).json({ error: 'No files to preview yet — build something first.' });
        return;
      }
      // The client's own origin (sent in the body, validated to an http/https URL) is used to load
      // the self-hosted preview compiler via an absolute same-origin URL — a root-relative path
      // doesn't resolve inside the sandboxed <iframe srcDoc>, which produced "Could not load the
      // preview compiler". Falls back to a header-derived origin, then to no origin (relative).
      const bodyOrigin = typeof req.body?.origin === 'string' && /^https?:\/\/[^\s/]+$/i.test(req.body.origin) ? req.body.origin : '';
      const hdrHost = req.get('host');
      const hdrOrigin = hdrHost ? `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${hdrHost}` : '';
      const previewOrigin = bodyOrigin || hdrOrigin || undefined;
      // RENDER CACHE — reopening the preview with UNCHANGED files returns the identical compiled
      // HTML, so a cached render is a pure speed win (zero quality trade-off: any file change
      // produces a different hash → fresh render). Per-instance, bounded, TTL'd; keyed by the
      // exact file contents + the origin baked into the HTML.
      const cacheKey = `${workspaceId}|${previewOrigin ?? ''}`;
      const filesHash = hashKey(Object.entries(files).flatMap(([p, c]) => [p, c]));
      const cached = inbrowserPreviewCache.get(cacheKey);
      if (cached && cached.hash === filesHash && Date.now() - cached.ts < INBROWSER_CACHE_TTL_MS) {
        res.json({ html: cached.html, kind: cached.kind, count: Object.keys(files).length, cached: true });
        return;
      }
      const vfs = VirtualFileSystem.fromRecord(files);
      const html = renderPreview(vfs, previewOrigin);
      // Detect the renderer used so the client can label the mode honestly.
      const kind = isReactProject(vfs) ? 'react' : isVueProject(vfs) ? 'vue' : 'static';
      inbrowserPreviewCache.set(cacheKey, { hash: filesHash, html, kind, ts: Date.now() });
      if (inbrowserPreviewCache.size > INBROWSER_CACHE_MAX) {
        const oldest = inbrowserPreviewCache.keys().next().value;
        if (oldest !== undefined) inbrowserPreviewCache.delete(oldest);
      }
      res.json({ html, kind, count: Object.keys(files).length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build the in-browser preview.' });
    }
  });

  // VISUAL EDITOR (in-browser mode, v1: single simple text child) — apply a text edit made in the
  // RENDERED preview back into the REAL source file at its exact JSX position, via a real AST
  // (VisualEditPatcher.ts), never a blind string/line replacement. Writes through the SAME durable
  // store + live actuator every other file write uses, so the edit shows up everywhere else (Files,
  // Code Studio's own editor, Git) exactly like a v3.0-panel edit does — not a disposable, disconnected
  // copy the next build would silently overwrite.
  app.post('/api/agentv3/visual-edit', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const filePath = typeof req.body?.file === 'string' ? req.body.file : '';
    const line = Number(req.body?.line);
    const column = Number(req.body?.column);
    const newText = typeof req.body?.newText === 'string' ? req.body.newText : null;
    if (!workspaceId || !filePath || newText === null) {
      res.status(400).json({ error: 'workspaceId, file and newText are required.' });
      return;
    }
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    try {
      const actuator = buildActuator();
      const { files } = await collectFilesWithSavedFallback(actuator, workspaceId, { liveTimeoutMs: 2_500 });
      const source = files[filePath];
      if (source == null) {
        res.status(404).json({ error: `${filePath} was not found in this workspace's current files.` });
        return;
      }
      const result = await applyVisualTextEdit({ filePath, source, line, column, newText });
      if (!result.ok) {
        res.status(422).json({ error: result.error });
        return;
      }
      // Write through BOTH the live actuator (so a still-warm sandbox reflects it immediately) and the
      // durable store (so it survives an instance recycle / is what the next preview build reads) —
      // matching how every other v3.0 file write persists. Actuator write is best-effort: a VFS-tier
      // or cold sandbox has no live copy to write into, and the durable save below is authoritative.
      try { await actuator.writeFile(workspaceId, filePath, result.newSource); } catch { /* best-effort */ }
      await saveWorkspaceFiles(workspaceId, { [filePath]: result.newSource });
      res.json({ ok: true, file: filePath, content: result.newSource });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to apply the visual edit.' });
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
      // DURABLE PERSIST (the keystone fix): also merge the imported/edited files into the durable
      // WorkspaceFileStore — NOT just the ephemeral sandbox. Without this, an IDE edit lands only in a
      // volatile sandbox and the File Guardian later restores the stale durable copy, silently
      // destroying the edit. mergeWorkspaceFiles UNIONS paths so a partial set never drops other files.
      // Awaited so a subsequent build reads the fresh truth. Best-effort — never blocks the import.
      try { await mergeWorkspaceFiles(workspaceId, files as Record<string, string>); } catch { /* durable persist is best-effort */ }
      // Phase S2 — when this import is a MANUAL IDE EDIT (source: 'ide-edit', sent by the editor's
      // debounced syncer), record the paths so the NEXT v3.0 build acknowledges them ("I noticed you
      // edited N files…") and builds on top of them. Bulk repo imports / uploads do NOT set this flag,
      // so they don't spam the next turn with "you edited 500 files". Best-effort — never blocks.
      if (req.body?.source === 'ide-edit') {
        try { await recordManualEdits(workspaceId, written.length ? written : Object.keys(files as Record<string, string>), Date.now()); } catch { /* edit tracking is best-effort */ }
      }
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
        // Also re-materialize the durable binary assets so a restored app isn't full of broken images.
        await restoreWorkspaceAssets(actuator, workspaceId).catch(() => 0);
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
    // SECURITY (C1): identity from the VERIFIED token only — never the client-claimed body.userId.
    // Runs before flushHeaders(), so a reject is a clean HTTP 401 (no stream started yet). Skipped
    // under VITEST (route handler isn't exercised by tests; the pure resolveBuildIdentity is tested
    // directly), and a genuine anonymous caller (no token + no claim) still resolves to userId=null.
    const claimedUid = typeof req.body?.userId === 'string' && req.body.userId ? req.body.userId : null;
    let verified: { uid: string; email: string | null } | null;
    if (process.env.VITEST) {
      verified = claimedUid ? { uid: claimedUid, email: null } : null;
    } else {
      const diag = await verifyFirebaseIdentityDiag(req);
      verified = diag.identity;
      // HONESTY (admin's "anon" investigation, 2026-07-05): a logged-in user whose token failed to
      // verify silently became 'anon' (→ app-anon repos + the 5/hr anon rate limit + a SHARED account
      // lock across all anon users). When a uid WAS claimed but verification produced no identity, log
      // the exact reason so this is diagnosable instead of invisible — no behaviour change, just truth.
      if (!verified && claimedUid) {
        audit('AGENTV3_ANON_FALLBACK', { claimedUid, reason: diag.reason, detail: diag.detail ?? null }, 'warn');
      }
    }
    const identity = resolveBuildIdentity(verified?.uid ?? null, claimedUid);
    if (!identity.ok) {
      res.status(401).json({ error: identity.error, code: identity.code });
      return;
    }
    const userId = identity.userId;
    // Allowlist/enable must key off the VERIFIED email when we have a token; only a genuinely
    // anonymous caller (no verified identity) falls back to the claimed email — where there's no uid
    // to impersonate anyway. Never trust a client `email` for an authenticated user.
    const email = verified ? verified.email : (typeof req.body?.email === 'string' ? req.body.email : null);
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
    // BUILD LOCK KEY (FIX #3, flag-gated): per-ACCOUNT today (`userId ?? 'anon'`); per-WORKSPACE when
    // AGENTV3_PER_WORKSPACE_LOCK is on — so two DIFFERENT apps build at once while the SAME app stays
    // mutually exclusive. `lockWorkspaceId` is the stable derived id for THIS session (only used as the
    // key when the flag is on AND it's stable; else buildLockKey falls back to the account key). Flag
    // OFF → buildKey is byte-identical to the old `userId ?? 'anon'`.
    const perWorkspaceLock = perWorkspaceLockEnabled();
    // Only key by workspace when the sessionId is STABLE (matches deriveWorkspaceId's own gate) — else
    // deriveWorkspaceId returns a Date.now()-based id that would differ every request, so we fall back
    // to the account key (buildLockKey handles the null). This keeps the lock stable per app+session.
    const lockSessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
    const lockWorkspaceId = perWorkspaceLock && lockSessionId && SESSION_ID_RE.test(lockSessionId)
      ? deriveWorkspaceId(userId, lockSessionId)
      : null;
    const buildKey = buildLockKey(userId, lockWorkspaceId, perWorkspaceLock);
    if (activeBuilds.has(buildKey)) {
      const existing = runningBuilds.get(buildKey);
      if (shouldReclaimBuildLock(existing, Date.now())) {
        // Abandoned/zombie lock (its client dropped on a network blip and the build hung, or it crashed
        // without clearing the lock) — RECLAIM it so the account is never trapped until the wall-clock
        // deadline. Tear the old build down cleanly, then fall through to start the fresh one.
        if (existing) {
          try { existing.abort.abort(); } catch { /* best-effort */ }
          try { endBuild(existing); } catch { /* best-effort */ }
          if (runningBuilds.get(buildKey) === existing) runningBuilds.delete(buildKey);
        }
        activeBuilds.delete(buildKey);
      } else {
        // Same key still building. Under per-workspace locking this means the SAME app is already
        // building (attach it, don't start a second); under per-account it's the account-wide lock.
        res.status(409).json({
          error: perWorkspaceLock
            ? 'This app is already building in another chat — connect to it (or stop it) instead of starting a second build.'
            : 'A build is already running for this account. Stop it before starting another.',
          resumable: isBuildRunning(buildKey),
        });
        return;
      }
    }
    // PER-ACCOUNT CONCURRENCY CAP (per-workspace only): bound how many builds one account runs at once,
    // so N different apps can build in parallel but sandbox cost stays bounded. `acquireDecision` is
    // pure + tested; flag OFF never consults the cap (single-build-per-account is unchanged).
    const capDecision = acquireDecision({
      perWorkspace: perWorkspaceLock,
      lockHeldByLiveBuild: false, // the live-lock case was already handled (reclaim-or-409) above
      accountActiveCount: countActiveBuildsForUser(runningBuilds.values(), userId),
      cap: maxConcurrentBuilds(),
    });
    if (!capDecision.ok && capDecision.reason === 'account-cap') {
      res.status(429).json({ error: `You have ${capDecision.active} builds running (max ${capDecision.cap} at once). Let one finish, or stop it, then try again.` });
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
    // PROJECT LANDING PIPELINE, entry split (admin master plan): a .zip attached in chat is an
    // APP IMPORT, not a document. It used to fall into the generic attachment path — its text was
    // extracted into the model's CONTEXT and the archive was never unpacked into the workspace,
    // so Files/IDE stayed empty and there was nothing to preview. Zips are diverted to the real
    // import pipeline below (extract → validate → dual-write → preview boot); every OTHER
    // attachment keeps the existing document/vision path.
    const zipImports = rawAttachments.filter((a) => isZipAttachment(a));
    const docAttachments = rawAttachments.filter((a) => !isZipAttachment(a));
    let attachmentContext = '';
    if (docAttachments.length > 0) {
      send({ type: 'narration', agent: 'architect', text: `📎 Reading ${docAttachments.length} file(s)…`, ts: Date.now() });
      try {
        const docs = await buildDocumentContext(docAttachments);
        // Bounded (8s) — a stalled vision provider must not hang the request before the deadline
        // timer is armed; on timeout we proceed without the image description.
        const vis = await raceTimeout(describeVisionAttachments(docAttachments, { useClaude: onlyOpus }), 8_000, 'describeVisionAttachments')
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
    // Hydrate this workspace's memory from durable storage BEFORE reading recent requests / classifying
    // intent — on a COLD Cloud Run instance the in-process memory is empty, so a "continue" would look
    // like a brand-new build (the classifier reads recentRequests). Idempotent (a hydration flag stops
    // the build path re-replaying) + bounded + best-effort so a slow Firestore never hangs the gate.
    try {
      await raceTimeout(restoreWorkspaceMemory(intentWorkspaceId, getWorkspaceMemory(intentWorkspaceId)), 3_000, 'restoreMemoryForIntent');
    } catch { /* best-effort — classification falls back to keyword + projectExists */ }
    // Keep the RAW count (not just the boolean) — a plain-chat turn below reuses this same read to
    // honestly answer "how many files do we have?" instead of answering blind. No extra Firestore call.
    const projectFileCount = await raceTimeout(
      countWorkspaceFiles(intentWorkspaceId),
      4_000,
      'countWorkspaceFiles',
    ).catch(() => 0);
    const projectExists = projectFileCount > 0;
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
    // An import turn (zip attachment OR a set GitHub import URL) must NEVER take the cheap chat
    // early-exit — the Landing Pipeline (and the follow-up survey/edit) lives in the build path
    // below. Without this, "is app ko analyze karo" + an import could classify as small-talk and
    // exit before anything was imported.
    const hasImportIntent = zipImports.length > 0 || (typeof req.body?.importUrl === 'string' && req.body.importUrl.trim() !== '');
    const isPlainChatTurn = intent === 'chat' && !hasImportIntent;
    // Surgical edit mode: the user is modifying an existing app (fix/change/update/
    // refactor/…), not building from scratch. When true, the build loop reads the
    // current files and makes minimum targeted edits instead of rebuilding everything.
    // `let` — a successful zip import below forces edit mode so the turn works WITH the imported
    // app instead of scaffolding a fresh build over it.
    let isEditMode = intent === 'edit_existing';
    if (isPlainChatTurn) {
      try {
        // "Text reply > build app" (admin decision, 2026-07-01): the TRUE last-resort classifier
        // default now prefers chat over a build for a genuinely ambiguous message — but that must
        // never become "it refuses to build". Recompute the pure, no-I/O classification signal (cheap
        // — a few regex checks) to tell a genuinely AMBIGUOUS message (signal 'default': no clear
        // build/edit/informational/problem/continuation/social/short signal matched at all) apart from
        // CLEAR chit-chat ('social'/'short') — only the ambiguous case gets nudged to offer building.
        const ambiguousBuildAsk = classifyIntentWithConfidence(prompt).signal === 'default';
        const chatPrompt = attachmentContext
          ? `${prompt}\n\nThe user attached file(s); here is the extracted content:\n\n${attachmentContext}`
          : prompt;
        // v3.0 used to answer a plain chat question ("kितni files hai?") completely blind — the chat
        // lane never loaded any workspace context. projectFileCount was already computed above for
        // intent classification (no extra Firestore call needed here).
        const chatWorkspaceContext = chatWorkspaceContextLine(projectFileCount);
        // v3.0 preview self-awareness: so "kya preview chal raha hai?" is answered from REAL state, not a
        // guess. No sandbox probe here (that would slow every chat message) — classify from the durable
        // file count + whether a live backend exists. This never falsely claims RUNNING; when files exist
        // it honestly says the app is SAVED and reboots on demand (the reopen-years-later guarantee).
        const chatPreviewHealth = previewHealthContextLine(classifyPreviewHealth({
          hasFiles: projectFileCount > 0,
          liveBackend: sandboxDiag().livePreviewAvailable,
          livePortUp: null,
          everPublished: projectFileCount > 0,
          lastError: null,
          booting: false,
        }));
        // ETERNAL SESSIONS ("same memory"): recall context from the project's durable episodic
        // memory — hydrated at intent-time above, survives instance recycles and years of absence —
        // so "what were we building?" is answered from real session history, never blind. Empty for
        // a fresh session (keeps the response cache usable). Best-effort.
        const chatSessionRecall = (() => {
          try { return sessionRecallContextLine(getWorkspaceMemory(intentWorkspaceId).snapshot().episodes); } catch { return ''; }
        })();
        // P-PE.1 — plain-chat response cache. A reply is cacheable ONLY when it's a pure function of the
        // prompt text alone (no per-workspace/per-user data injected) — identical prompts WITHOUT an
        // attachment AND without workspace context can be served from an in-memory TTL+LRU cache: instant
        // and free, no behaviour change. Once real file-count context is injected, the reply depends on
        // THIS project's state, so it must bypass the cache (a stale/wrong count is worse than a cache
        // miss). Build/edit turns never reach this path, and attachment turns are skipped (unique prompt).
        const cacheable = !attachmentContext && !chatWorkspaceContext && !chatPreviewHealth && !chatSessionRecall && chatCacheEnabled();
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
                "mention which model you are.\n\n" + CREATOR_IDENTITY + chatWorkspaceContext + chatPreviewHealth + chatSessionRecall +
                (ambiguousBuildAsk
                  ? "\n\nThis message was ambiguous — it might be a request to build or change something "
                    + "in the user's app, phrased in an unusual way, OR it might just be a genuine "
                    + "question/comment. Answer it naturally, but if it plausibly could mean \"build/fix "
                    + "this\", ALSO ask a short clarifying question at the end (e.g. \"Would you like me "
                    + "to build/fix this for you?\") so the user can confirm with their next message."
                  : ''),
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
        // Record the turn in project memory so iterative context is preserved (mirrors the build
        // path's recordRequest). Memory was already hydrated at intent-time above, so this appends to
        // the real history; then PERSIST it so a plain-chat turn ("what are we building?") survives an
        // instance recycle and a later build still remembers it. Both best-effort — never block a reply.
        try {
          const chatWsId = deriveWorkspaceId(userId, req.body?.sessionId);
          const chatMem = getWorkspaceMemory(chatWsId);
          chatMem.recordRequest(prompt);
          void saveWorkspaceMemory(chatWsId, chatMem.snapshot()).catch(() => {});
        } catch { /* memory is best-effort — never blocks a reply */ }
        // Surface the reply EXACTLY like a normal build narration — no provider
        // name, no note — then close out the stream the same way a build does.
        const chatEvents = new AgentEventStream();
        chatEvents.subscribe((e) => send(e), false);
        chatEvents.emit({ type: 'narration', agent: 'architect', text: reply, ts: Date.now() });
        chatEvents.emit({ type: 'done', ok: true, summary: reply, ts: Date.now() });
        // billedUsd: 0 — the cheap free router is not billed to the user as a build.
        send({ type: 'result', ok: true, summary: reply, steps: 0, billedUsd: 0, billedInr: 0 });
        // HISTORY (single-source-of-truth rebuild): persist this chat turn to the SAME server
        // ConversationStore every build turn uses. The plain-chat lane previously saved NOTHING
        // server-side — the root reason the client kept its own (bug-prone) transcript copies in
        // chat_sessions, which is what kept corrupting history. Runs AFTER the reply is flushed
        // (no user-visible latency) and BEFORE res.end() — Cloud Run can throttle CPU once the
        // response ends, so a fire-and-forget write here could be silently lost. Bounded +
        // best-effort: a slow or failed store never affects the reply the user already has.
        try {
          await raceTimeout(upsertConversationTurn(getConversationStore(), {
            conversationId: conversationIdForWorkspace(intentWorkspaceId),
            userId: userId ?? 'anon',
            workspaceId: intentWorkspaceId,
            title: deriveTitle(prompt),
            turn: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: reply },
            ],
            patch: { status: 'complete', updatedAt: Date.now() },
          }), 8_000, 'persistChatTurn');
        } catch { /* persistence is best-effort — never blocks the reply */ }
        activeBuilds.delete(buildKey);
        if (!res.writableEnded) res.end();
        return;
      } catch {
        // The free router failed — do NOT error out. Fall through to the normal
        // build path so the user always gets an answer. (No return here.)
      }
    }

    // SECURITY (audit A2 — defense-in-depth for C2): a BUILD needs an isolated sandbox. In production,
    // refuse to build when neither E2B nor Docker is configured, instead of silently falling back to
    // LocalActuator — which runs the agent's generated + imported commands in THIS host process, the
    // exact avenue that made the importUrl injection (C2) reach the host. Mirrors the guard
    // engineer.ts already enforces. Placed AFTER the plain-chat early-exit so a normal chat turn (no
    // sandbox needed) is unaffected. The stream headers are already flushed, so we emit a terminal
    // error event + clean up activeBuilds (same exit shape the chat path uses) rather than res.status().
    if (buildSandboxUnavailableInProd()) {
      send({ type: 'narration', agent: 'architect', text: 'The build sandbox is not available on this server right now (cloud sandbox not configured), so I did not run the build. Your account was not charged. Please try again shortly or contact the admin.', ts: Date.now() });
      send({ type: 'error', message: 'Build sandbox (E2B) is not configured on the server — refusing to run the build on the host for safety.' });
      send({ type: 'result', ok: false, summary: 'Build sandbox not configured on the server.', steps: 0, billedUsd: 0, billedInr: 0 });
      activeBuilds.delete(buildKey);
      if (!res.writableEnded) res.end();
      return;
    }

    // Register this build so it can be STOPPED and RE-ATTACHED to ("Resume") after the
    // original connection is lost. The client's response is the first subscriber; if it
    // disconnects we keep the build alive (still buffering) so the user can resume it.
    const abort = new AbortController();
    // intentWorkspaceId was already derived above (deriveWorkspaceId(userId, req.body?.sessionId)) for
    // intent classification — reuse it so the running-build registry knows which session owns this
    // build, instead of computing it twice from the same (userId, sessionId) pair.
    // `key` stays the ACCOUNT key (userId ?? 'anon') for the cross-device LiveChannel (readers already
    // filter by workspaceId), while the registry Map is keyed by `buildKey` (per-workspace when enabled).
    // `userId` lets the per-account cap count this account's live builds across workspaces.
    const rb: RunningBuild = { abort, buffer: [], subscribers: new Set(), ended: false, startedTs: Date.now(), key: userId ?? 'anon', userId, workspaceId: intentWorkspaceId };
    const primary: BuildSubscriber = {
      write: (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n'); },
      end: () => { if (!res.writableEnded) res.end(); },
    };
    rb.subscribers.add(primary);
    runningBuilds.set(buildKey, rb);
    req.on('close', () => { rb.subscribers.delete(primary); });
    // ETERNAL SESSIONS: tap every outgoing build event into a compact durable timeline (tool
    // calls, file changes, diffs, preview, terminal facts). Persisted once in the finally below
    // and replayed on reopen, so a restored session shows the SAME Claude-style action rows,
    // Diff/Terminal tabs and done-footer it showed live — not a bare prose transcript.
    const sessionTimeline = createTimelineRecorder();
    const emit = (e: unknown): void => { sessionTimeline.record(e); broadcastBuild(rb, e); };
    // Exposed to the finally so the LAST background checkpoint is flushed on every exit path
    // (success, error, abort). Held outside the try because `dispatcher` is block-scoped to it.
    let dispatcherForFlush: { flushCheckpoints: () => Promise<void> } | undefined;

    const events = new AgentEventStream();
    events.subscribe((e) => emit(e), false);
    const state = new WorkspaceState(events);

    const actuator = buildActuator();
    const workspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    // Phase G1 — git as the third organ: durably persist every real git checkpoint as it is emitted,
    // so the commit timeline survives sandbox recycling and is visible across sessions/devices (not just
    // this session's RAM). Best-effort — a persist failure never affects the build or the stream.
    events.subscribe((e) => {
      const evt = e as { type?: string; checkpoint?: unknown };
      if (evt?.type === 'checkpoint' && evt.checkpoint) saveCheckpoint(workspaceId, evt.checkpoint).catch(() => {});
    }, false);
    // `let` — a zip import below adopts the DETECTED framework of the imported app (persisted
    // durably by persistSessionTimeline), overriding whatever the client's picker defaulted to.
    let framework = typeof req.body?.framework === 'string' && req.body.framework ? req.body.framework : 'vite-react';
    const importUrl = typeof req.body?.importUrl === 'string' ? req.body.importUrl.trim() : '';

    // ── PROJECT LANDING PIPELINE — admin master plan: ONE pipeline for every import source ────
    // Whatever door an existing app comes in by (zip attachment here, GitHub repo URL below in
    // the build body), it must LAND the same way: validate → both stores (E2B sandbox for the
    // live preview, durable file store for Files/IDE/reopen) → files_restored event → detected
    // framework adopted → edit mode forced (never scaffold over an imported app) → sources
    // indexed into project memory → live preview booted in the BACKGROUND with an honest
    // outcome in the stream. The finally awaits the boot so Cloud Run can't throttle it away.
    let importPreviewBoot: Promise<void> | undefined;
    // True once THIS turn imported a project (zip or GitHub URL). An import turn's deliverable is the
    // LANDED project — the agent then SURVEYS it and, per the user's "do not change any files yet",
    // creates no new files. So an import turn must NOT be judged like a build: producing no files is
    // success (not a failed/escalated build), and the mandatory readiness gate must not audit the
    // user's freshly-imported existing code and declare it "NOT READY". Set by the zip + URL landers.
    let isImportTurn = false;
    const landImportedProject = async (
      importedFiles: Record<string, string>,
      opts: { source: string; writeToSandbox: boolean; droppedNote?: string; sandboxOnly?: Record<string, string>; assets?: Record<string, string> },
    ): Promise<boolean> => {
      const validation = validateImportedProject(importedFiles);
      if (!validation.ok) {
        emit({ type: 'narration', agent: 'architect', text: `⚠️ ${validation.issues.join(' ')}`, ts: Date.now() });
        return false;
      }
      let written: string[];
      if (opts.writeToSandbox) {
        // Best-effort: an 'import'-type workspace starts EMPTY so the imported app never gets
        // template scaffold files mixed in (mirrors the import-files route).
        try { await actuator.ensureWorkspace(workspaceId, 'import'); } catch { /* reuse existing sandbox */ }
        written = (await writeWorkspaceFiles(actuator, workspaceId, importedFiles)).written;
        // Sandbox-only extras (big text lockfiles): the live sandbox gets them so `npm install`
        // reproduces the app's exact dependency tree; the durable store skips them by design
        // (over its per-doc cap — the import summary says so honestly). Best-effort.
        for (const [p, c] of Object.entries(opts.sandboxOnly ?? {})) {
          try { await actuator.writeFile(workspaceId, p, c); } catch { /* install falls back to fresh resolution */ }
        }
      } else {
        written = Object.keys(importedFiles); // already in the sandbox (e.g. a git clone)
      }
      // Small binary assets (logo/favicon/icons/fonts): write REAL bytes into the sandbox so the
      // live preview renders them, and persist them in their OWN durable store so they survive a
      // reload/recycle (the text-file store can't hold binaries — see WorkspaceAssetStore). Kept
      // entirely out of `importedFiles`, so they never pollute the text map. Best-effort.
      const assets = opts.assets ?? {};
      if (Object.keys(assets).length > 0) {
        if (opts.writeToSandbox) { try { await materializeAssets(actuator, workspaceId, assets); } catch { /* an asset failing never blocks the import */ } }
        void saveWorkspaceAssets(workspaceId, assets).catch(() => {});
      }
      // DURABLE PERSIST — the half whose absence caused "zip imported but Files/IDE/Preview all
      // empty": without it the import lives only in the ephemeral sandbox.
      try { await mergeWorkspaceFiles(workspaceId, importedFiles); } catch { /* durable persist is best-effort */ }
      framework = validation.framework;
      isEditMode = true;
      isImportTurn = true; // this turn's job was to import + survey, not to build (see the flag decl)
      emit({ type: 'files_restored', files: written.map((path) => ({ path, kind: 'create' as const })), ts: Date.now() });
      emit({
        type: 'narration', agent: 'architect', ts: Date.now(),
        text: `📦 Imported ${written.length} file${written.length === 1 ? '' : 's'} from ${opts.source} (framework: ${framework})`
          + (opts.droppedNote ? ` ${opts.droppedNote}` : '')
          + (validation.issues.length > 0 ? `\n⚠️ ${validation.issues.join(' ')}` : ''),
      });
      // Surface the env-variable names the app expects (from its committed .env template) — the
      // live .env was deliberately not imported, so the user must know what to re-enter.
      try {
        const envNote = envTemplateNote(importedFiles);
        if (envNote) emit({ type: 'narration', agent: 'architect', text: envNote, ts: Date.now() });
      } catch { /* the env note is best-effort */ }
      // Project memory: the import is a durable fact of this session, and the imported sources
      // are indexed so the very first edit request works with real context.
      try {
        const mem = getWorkspaceMemory(workspaceId);
        mem.recordNote(`Imported an existing app from ${opts.source}: ${written.length} files, framework ${framework}.`);
        for (const [p, c] of Object.entries(importedFiles).slice(0, 300)) mem.indexFile(p, c);
        void saveWorkspaceMemory(workspaceId, mem.snapshot()).catch(() => {});
      } catch { /* memory is best-effort */ }
      // The AI turn must work WITH the landed app — never scaffold over it, and answer a plain
      // "read/analyze my app" ask with an honest survey of the real files.
      attachmentContext += `\n\n[APP IMPORT — already completed] The user's app from ${opts.source} has ALREADY been imported into this workspace: ${written.length} files, detected framework ${framework}. Work WITH these existing files (read them as needed) and NEVER scaffold a new app over them. If the user only asked to read/analyze it, give a short honest survey of the app (what it is, key files/structure, how it runs) and ask what they'd like to change.`;
      // Background live-preview boot (the actuator handles install + start + health-check).
      if (validation.hasPackageJson && sandboxDiag().livePreviewAvailable) {
        const emitLive = (e: unknown): void => { if (!rb.ended) emit(e); };
        // HEAVY-APP PREVIEW (capability ②): a full-stack imported app (Express + Postgres + env-driven
        // config, like Mitrify) crashes on a bare `npm run dev` — no DATABASE_URL, undefined env vars.
        // Provision a local DB + write a dev .env FIRST so the server has a real chance to boot; the
        // setup persists in the sandbox, so even if the background boot is slow, the Diagnose button
        // (which re-boots) now succeeds too. External paid services can't be faked — reported honestly.
        const needsDb = detectNeedsDatabase(importedFiles);
        const declaredEnvVars = envVarNames(importedFiles);
        importPreviewBoot = (async () => {
          try {
            const provided: Record<string, string> = {};
            if (needsDb && typeof actuator.provisionBackend === 'function') {
              emitLive({ type: 'narration', agent: 'architect', text: '🗄️ Your app needs a database — provisioning a local PostgreSQL in the sandbox so it can boot…', ts: Date.now() });
              try {
                const prov = await withTimeout(actuator.provisionBackend(workspaceId, ['db']), 130_000, 'import-db-provision');
                Object.assign(provided, prov.envVars ?? {}); // DATABASE_URL
              } catch { /* DB provision is best-effort — the boot still tries without it */ }
            }
            // P3 (admin 2026-07-05): CONJURE the app's own local secrets — SESSION_SECRET/JWT_SECRET
            // etc. get REAL random values, because an empty placeholder is itself a boot-killer
            // (express-session throws "secret option required" on '' — the exact reason the Mitrify
            // preview died). Third-party keys are NEVER faked; they stay empty + honestly listed.
            Object.assign(provided, conjurableSecrets(declaredEnvVars));
            // Write a dev .env so `process.env.X` is defined (the #1 boot-crash cause) — the
            // provisioned DATABASE_URL + generated local secrets, plus empty placeholders for the rest.
            if (declaredEnvVars.length > 0 || Object.keys(provided).length > 0) {
              try { await actuator.writeFile(workspaceId, '.env', buildDevEnvContent(declaredEnvVars, provided)); } catch { /* env write best-effort */ }
              const extNote = externalServiceNote(declaredEnvVars);
              if (extNote) emitLive({ type: 'narration', agent: 'architect', text: extNote, ts: Date.now() });
            }
            emitLive({ type: 'narration', agent: 'architect', text: '⚙️ Setting up the live preview in the background (npm install + dev server) — your app keeps loading while I reply…', ts: Date.now() });
            const result = await withTimeout(actuator.runCommand(workspaceId, 'npm run dev'), 240_000, 'import-preview-boot');
            const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
            const { up, port } = parseDevServerHealthCheck(combined);
            if (up) {
              const bootPort = port ?? devScriptPort(importedFiles['package.json'] ?? null) ?? oneShotDevPort(framework);
              const bootUrl = applyPreviewDomain(await withTimeout(actuator.getPortUrl(workspaceId, bootPort), 10_000, 'import-preview-url'));
              if (bootUrl) emitLive({ type: 'preview', url: bootUrl, ts: Date.now() });
              emitLive({ type: 'narration', agent: 'architect', text: `✅ Live preview is up on port ${bootPort} — open the Preview tab (Live server).`, ts: Date.now() });
            } else {
              emitLive({ type: 'narration', agent: 'architect', text: '⚠️ The live preview did not boot automatically — the In-browser preview works from your imported files, and the Preview tab\'s Diagnose button shows the exact boot log.', ts: Date.now() });
            }
          } catch {
            emitLive({ type: 'narration', agent: 'architect', text: '⚠️ The live preview setup ran out of time — use the In-browser preview, or press Diagnose in the Preview tab to boot it with a visible log.', ts: Date.now() });
          }
        })();
      }
      return true;
    };
    if (zipImports.length > 0) {
      try {
        emit({ type: 'narration', agent: 'architect', text: `📦 Unpacking ${zipImports[0].name || 'your zip'} into the workspace…`, ts: Date.now() });
        const extracted = await extractZipProject(Buffer.from(zipImports[0].base64, 'base64'));
        const lockKept = Object.keys(extracted.sandboxOnly);
        await landImportedProject(extracted.files, {
          source: zipImports[0].name || 'your zip',
          writeToSandbox: true,
          droppedNote: [
            extracted.appRoot ? `— landed the app from its "${extracted.appRoot}/" folder` : '',
            lockKept.length > 0 ? `— kept ${lockKept.join(', ')} for exact dependency versions (sandbox only, over the durable-store size cap)` : '',
            droppedDetailNote(extracted),
          ].filter(Boolean).join(' '),
          sandboxOnly: extracted.sandboxOnly,
          assets: extracted.assets,
        });
      } catch (err) {
        emit({ type: 'narration', agent: 'architect', text: `⚠️ Could not unpack the zip (${err instanceof Error ? err.message : String(err)}) — nothing was imported. Please re-export the archive and try again.`, ts: Date.now() });
      }
    }
    // ETERNAL SESSIONS: persist this turn's evidence layer onto the conversation record — the
    // compact timeline recorded by the emit tap above, the terminal facts (billing/tokens/build
    // health) for the done-footer, and the session's framework (so a reopened session's follow-up
    // builds don't silently reset to vite-react). Called from BOTH the hard-deadline finalizer (a
    // hung build's finally may never run) and the normal finally; the delta cursor keeps the two
    // calls from double-appending events. Best-effort + bounded — a store failure never affects
    // the build or the stream.
    let timelinePersistCursor = 0;
    const persistSessionTimeline = async (): Promise<void> => {
      try {
        await raceTimeout((async () => {
          const store = getConversationStore();
          const convId = conversationIdForWorkspace(workspaceId); // mainConversationId is try-scoped
          const rec = await store.get(convId).catch(() => null);
          if (!rec) return; // no record even after the fallback upsert — nothing to attach to
          const all = sessionTimeline.events();
          const freshEvents = all.slice(timelinePersistCursor);
          const finalState = sessionTimeline.final();
          if (freshEvents.length === 0 && !finalState && rec.framework === framework) return;
          timelinePersistCursor = all.length;
          // DURABLE BUILD REPORT (admin, 2026-07-05: "build report hamesa ke liye wahin save honi
          // chahiye jahan chat text save hota hai"): embed a COMPACT settled report INTO the conversation
          // record's finalState, so the "Build report" is saved atomically with the chat and always
          // returns on reopen — never dependent on the separate best-effort workspace_diagnostics doc
          // (which can 404 after a long/killed build like an 18-min run). Only when the build has settled
          // (finalState present) and a report exists; the heavy forensic channels stay in the workspace
          // doc. Best-effort read — a missing report never blocks the timeline write.
          const settledReport = finalState ? lastDiagnostics.get(userId ?? 'anon') : undefined;
          const finalStateToSave = finalState && settledReport
            ? { ...finalState, report: compactReportForRecord(settledReport) }
            : finalState;
          await store.update(convId, {
            updatedAt: Date.now(),
            ...(freshEvents.length > 0 ? { timelineAppend: freshEvents } : {}),
            ...(finalStateToSave ? { finalState: finalStateToSave } : {}),
            framework,
          });
        })(), 8_000, 'persistSessionTimeline');
      } catch { /* the evidence layer is best-effort — never affects the build */ }
    };
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
    // P-ARCH+.1 — complexity-adaptive wall-clock. Compute the effective cap ONCE here (before the
    // deadline is armed) from a prompt-derived complexity signal, and thread this SAME value into every
    // downstream deadline/headroom check below. Threading a single value is what keeps the watchdog, the
    // runner cap, and the four post-build headroom gates CONSISTENT — a deep build that earns more time
    // must not then be denied its tsc-gate/preview/reviewer against a stale, unscaled deadline. Only
    // `deep` builds are lengthened; simple/standard are unchanged; `0` (disabled) is preserved.
    const buildComplexity = complexityFromPrompt(prompt);
    const buildDepth: PipelineDepth = resolvePipelineDepth(
      (buildComplexity.moduleCount || 0) + (buildComplexity.featureCount || 0),
      onlyOpus,
    );
    const effectiveBuildSeconds = scaleBuildSeconds(maxBuildSeconds(), buildDepth);
    const deadlineMs = effectiveBuildSeconds * 1000;
    // P-ARCH+.3 — tokens spent by the optional up-front blueprint step (below). Declared here so the
    // final billing hook can fold them into the user's charge with the same markup as every other
    // v3.0 call (NavBharatAI-Anthropic-billed). Stays {0,0} unless the blueprint step actually runs.
    const blueprintUsage = { inputTokens: 0, outputTokens: 0 };
    // Force-finalize a build that overran its wall-clock cap — or, once the build has already SUCCEEDED,
    // its much shorter ADVISORY cap (see armAdvisoryCap). Extracted so the initial arm and the re-arm
    // share one implementation. Guarded by rb.ended so it can never double-emit after a clean finish.
    const finalizeOnDeadline = async () => {
      if (rb.ended) return;
      try { abort.abort(); } catch { /* best-effort */ }
      // GUARANTEE the durable file save actually happens BEFORE claiming "your files are saved" below
      // (real build report evidence: a build cut off by this exact deadline left its just-written files
      // NEVER durably saved — only the fire-and-forget 3s onFileWrite debounce had a chance to run, and
      // it can be starved by back-to-back writes or simply not fire before the process is reclaimed — so
      // the in-browser preview later found nothing and returned the misleading "No files to preview
      // yet" 404 even though the workspace genuinely had files). Awaited + best-effort: mirrors the
      // "DURABLE FILE SAVE" block at normal completion (captured writes ∪ a live sandbox scan).
      try {
        if (writtenFiles.size > 0) {
          const toSave: Record<string, string> = {};
          try {
            const scanned = await collectWorkspaceFiles(actuator, workspaceId);
            Object.assign(toSave, scanned.files);
          } catch { /* listFiles can be flaky — the captured writes below are the reliable source */ }
          for (const [p, c] of writtenFiles) toSave[p] = c; // captured writes win (freshest, reliable)
          await saveWorkspaceFiles(workspaceId, toSave);
        }
      } catch { /* durable file save is best-effort — never blocks the deadline finalization */ }
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
          // Also into the bounded per-workspace HISTORY so this settled report survives even after
          // a later (possibly much smaller) build overwrites the "latest" doc above.
          saveDiagnosticsHistory(workspaceId, dl).catch(() => {});
          // Durable per-USER "latest report" — retrievable by userId alone across cold starts / new
          // sessions, so the "Build report" never vanishes even when the client's workspaceId changed.
          saveLatestForUser(userId, dl).catch(() => {});
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
      // A deadline-finalized build's `finally` may never run (the body is stuck on an un-abortable
      // await) — persist the evidence layer HERE too, after the terminal emit so the recorder has
      // captured the result facts. The delta cursor makes a later finally call a no-op.
      await persistSessionTimeline();
      activeBuilds.delete(buildKey);
      if (runningBuilds.get(buildKey) === rb) runningBuilds.delete(buildKey);
      endBuild(rb);
    };
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined = deadlineMs > 0 ? setTimeout(finalizeOnDeadline, deadlineMs) : undefined;
    // ADVISORY CAP — the #1 "build stuck running" root cause: once the app is BUILT and durably saved,
    // the remaining post-build work (reviewer, reflection, project summary, memory persist, and above
    // all the GitHub push/merge NETWORK calls) is ADVISORY. A single hung advisory step used to hold
    // the event stream open — and the 15s pings defeat the client stall-watchdog — so the UI stayed
    // "building" long after the app was finished, all the way to the full wall-clock cap. Once the build
    // has SUCCEEDED we shorten the deadline to this short cap, so the terminal `result` is emitted (and
    // the stream closed → the client's spinner clears) promptly even when an advisory step hangs. The
    // finalizer is success-aware, so it emits a real SUCCESS result, not a "paused".
    const ADVISORY_CAP_MS = 120_000;
    const armAdvisoryCap = () => {
      if (deadlineMs <= 0) return;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(finalizeOnDeadline, ADVISORY_CAP_MS);
    };
    // Visible to the deadline timer above so it can finalize a finished build as SUCCESS instead of
    // "paused". Set the moment a build lane produces a successful result (before advisory post-work).
    let buildResultRef: { ok: boolean; summary: string; steps?: number; billedUsd?: number } | null = null;
    // DURABLE FILE CAPTURE, hoisted here (not just inside the build-execution block below) so BOTH the
    // deadline-timeout handler above and the crash catch below — a plain `try{}`/`catch{}` block is its
    // own separate scope from an inner `const` — can see and durably flush it. Records the exact content
    // of every file the agent writes (reliable — straight from the write op, not a later listFiles that
    // can come back empty). See the "DURABLE FILE SAVE" block for the normal-completion path.
    const writtenFiles = new Map<string, string>();

    // P-PME.4 — LIVE, ADAPTIVE ETA state. The up-front estimate (set below at build start) is a
    // realistic total; the heartbeat below recomputes the REMAINING time every 2 min and emits it,
    // so "I'll update it as I go" is literally true (not a one-shot claim). 0 until the build starts.
    let etaTotalMs = 0;
    let etaStartMs = 0;
    let etaTick = 0;

    // MINUTE-BY-MINUTE TIMELINE — record a "still working" heartbeat every 60 s so the build report
    // shows what the build was doing each minute (and names any in-flight/stuck tool) instead of a
    // blank gap during a long/slow step. Best-effort; cleared in `finally`.
    const diagHeartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (rb.ended) return;
      try { buildDiagRef?.heartbeat(); } catch { /* diagnostics are best-effort */ }
      // Live ETA: every 2nd tick (~2 min) show elapsed + a REVISED remaining time, adapting as the
      // build runs. Honest when it overruns the estimate (no fake "almost done"). Best-effort.
      etaTick += 1;
      if (etaTotalMs > 0 && etaStartMs > 0 && etaTick % 2 === 0) {
        try {
          const elapsedMs = Date.now() - etaStartMs;
          const remainingMs = etaTotalMs - elapsedMs;
          const inTxt = formatEta(elapsedMs).replace('~', '');
          const text = remainingMs > 45_000
            ? `⏱️ Still building… ${inTxt} in · ~${formatEta(remainingMs).replace('~', '')} to go`
            : `⏱️ Still building… ${inTxt} in · wrapping up (a little longer than estimated)`;
          // STABLE id so each ETA tick REPLACES the previous line (the reducer dedupes narration by id)
          // instead of stacking a new "Still building…" bubble every 2 min — and so the client can drop
          // this ONE transient line the moment the build finishes (it is live status, not chat history).
          events.emit({ type: 'narration', agent: 'architect', text, ts: Date.now(), id: 'eta-live' });
        } catch { /* ETA is best-effort — never affects the build */ }
      }
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
      // LARGE-PROJECT ROUTING (admin 2026-07-05: "badi apps direct Sonnet"): list the existing
      // project ONCE up-front (edit/import mode only — a fresh build has nothing to list). The
      // listing is REUSED further down for the edit-mode prompt, so this adds no extra sandbox
      // roundtrip. On a Mitrify-scale app the analyser tiers by the PROMPT ("survey" → haiku) while
      // the CONTEXT is huge — the cheap floor then timed out 8× and fell to Claude anyway. Detecting
      // "large existing project" here routes the whole build to Sonnet directly and keeps the cheap
      // floor out of its chain: faster, and no silent multi-timeout money burn.
      let editFileTree: string[] | null = null;
      if (isEditMode) {
        try { editFileTree = await actuator.listFiles(workspaceId); } catch { editFileTree = null; }
      }
      const largeProject = isLargeExistingProject(editFileTree?.length ?? 0);
      // Admin routing policy: small app → Haiku, complex app → Sonnet, large project → Sonnet,
      // power → Opus (was always Sonnet). Gemini/Vertex remain the fallback in buildTurnRunner.
      const model = selectBuildModel(analysis?.startTier, onlyOpus, largeProject);
      if (largeProject && !onlyOpus) {
        // Honest + visible: the user sees WHY this build routes to the strong model.
        events.emit({
          type: 'narration', agent: 'architect', ts: Date.now(),
          text: `🏗️ Large project (${editFileTree?.length ?? 0} files) — running directly on the strong model for reliability.`,
        });
      }
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
      const captureProvider = (used: string): void => {
        providerTurns.set(used, (providerTurns.get(used) ?? 0) + 1);
        // Also surface the delivering provider in the downloadable build report ("Built by: GLM …"),
        // so the admin can see which provider actually answered each turn. Best-effort.
        try { buildDiag.recordProviderTurn(used); } catch { /* diagnostics are best-effort */ }
      };
      const client = buildTurnRunner({
        ...(analysis ? { geminiModel: tierToGeminiBuildModel(analysis.startTier) } : {}),
        // First attempt only opts the cheap floor in — and only for simple/medium apps (complex →
        // straight to the strong model) AND only for allowlisted users (canary; empty list = all).
        // NEVER for a large existing project (admin 2026-07-05): the floor timed out 8× on a 233KB
        // Mitrify-scale prompt and every turn fell to Claude anyway — pure wasted minutes.
        // Escalation builds below never pass this, so they stay Claude.
        allowCheapFloor: !largeProject && cheapFloorAllowedForTier(analysis?.startTier) && cheapFloorAllowedForUser(userId, email),
        onProviderUsed: captureProvider,
        onProviderError: (name, err) => buildDiag.record({
          phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK',
          message: `Provider ${name} failed — falling back to the next provider`,
          autoResolved: true, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        }),
      });
      // Build start time — used for cost-ladder telemetry duration (P2 measurement).
      const buildStartedAt = Date.now();
      etaStartMs = buildStartedAt; // anchor the live ETA heartbeat to the real build start
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
          etaTotalMs = est.estimateMs; // feed the live heartbeat so it can revise the remaining time
          events.emit({ type: 'narration', agent: 'architect', text: `⏱️ Estimated build time: ${est.etaText} — I'll keep you posted as I go.`, ts: Date.now() });
        } catch { /* ETA is best-effort — never affects the build */ }
      }
      const budget = maxBuildBudgetUsd();
      // AgentRunner treats `undefined` as "no cap" (0 would instead stop the build after its very
      // first dollar, since it checks `billed() >= maxBudgetUsd`) — convert the disabled (0) case here.
      const maxBudgetUsdForRunner = budget > 0 ? budget : undefined;
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
      // Own-repo working-branch storage (admin model 2026-07-05, flag-gated OFF): when the user imports
      // a repo they OWN, edits are stored on a stable working branch (`navbharatai/work`) INSIDE that
      // real repo and reach `main` only via a PR the user merges — never a separate mirror, never a
      // direct push to `main`. Non-null only in that case; the mirror path leaves it null (unchanged).
      let ownRepoTarget: OwnRepoTarget | null = null;
      try {
        // Emit an immediate status so the NDJSON stream is never silent while the
        // sandbox is being created (E2B VM setup can take several seconds). A long
        // silent gap after the headers is what trips Cloud Run / mobile-Safari
        // request timeouts and surfaces as a bare "Load failed" on the client.
        events.emit({ type: 'narration', agent: 'architect', text: 'Setting up your workspace…', ts: Date.now() });
        // SPEED (flag-gated) — RESUME this workspace's own warm sandbox (files + node_modules + dev
        // server already there) instead of a cold create + restore + install. The sandbox id is stored
        // per workspaceId, and workspaceId is derived server-side from the VERIFIED uid, so this can
        // only ever resume THIS user's own sandbox. If the sandbox was reaped/expired, ensureWorkspace's
        // Sandbox.connect→create fallback transparently makes a fresh one (today's behaviour), so this
        // is safe even when the resume misses. Enable with AGENTV3_SANDBOX_RESUME=on.
        const resumeSandboxId = sandboxResumeEnabled()
          ? (await sandboxStore.get(workspaceId).catch(() => null)) ?? undefined
          : undefined;
        await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId);
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
              // Decide the storage target: the user's OWN imported repo (working branch) vs the safe
              // private mirror. The write-access API call only runs for a plausibly-owned imported repo
              // (feature enabled + the import URL's owner equals the signed-in login), so the common
              // path is unchanged. resolveStorageTarget makes the final, guard-checked decision.
              const imported = ownRepoStorageEnabled() ? parseGitHubRepo(importUrl) : null;
              const ownsImported = !!imported && imported.owner.toLowerCase() === login.toLowerCase();
              const access = ownsImported
                ? await userClient.getRepoAccess(imported!.repo)
                : { exists: false, canPush: false, defaultBranch: 'main' };
              const target = resolveStorageTarget({
                importUrl, userLogin: login, hasWriteAccess: access.canPush,
                baseBranch: access.defaultBranch, mirrorRepoName: repoName, ownRepoEnabled: ownRepoStorageEnabled(),
              });
              if (target.mode === 'own-repo') {
                // OWN-REPO WORKING BRANCH: store edits on `navbharatai/work` INSIDE the user's real repo.
                // `main` (the base branch) is NEVER pushed here — edits reach it only via a PR the user
                // merges. Hydrate prefers the work branch (accumulated edits), else the repo default.
                repoAuthedUrl = userClient.authedCloneUrl(target.repo, target.owner);
                repoBranch = target.workBranch;
                prClient = userClient;
                repoNameRef = target.repo;
                ownRepoTarget = target;
                repoSync = new GitRepoSync(actuator, workspaceId);
                const h = await repoSync.hydrateFromRepo(repoAuthedUrl, { branch: target.workBranch, fallbackBranch: target.baseBranch, overlayAnyContent: true });
                events.emit({ type: 'repo', url: `https://github.com/${target.owner}/${target.repo}`, fullName: `${target.owner}/${target.repo}`, ts: Date.now() });
                // Tell the client own-repo mode is active so it can offer the "Ship to main" / "Revert"
                // controls scoped to this exact repo + branches (see /api/agentv3/ship, /revert).
                events.emit({ type: 'own_repo', owner: target.owner, repo: target.repo, workBranch: target.workBranch, baseBranch: target.baseBranch, ts: Date.now() });
                events.emit({
                  type: 'narration', agent: 'architect',
                  text: h.hydrated
                    ? `Working on your own repo ${target.owner}/${target.repo} — edits go to the ‘${target.workBranch}’ branch; your ‘${target.baseBranch}’ stays untouched until you merge the PR.`
                    : `Connected to your own repo ${target.owner}/${target.repo} — edits will be saved to the ‘${target.workBranch}’ branch; your ‘${target.baseBranch}’ stays safe until you merge the PR.`,
                  ts: Date.now(),
                });
              } else {
                // MIRROR (today's behaviour): a private per-project repo in the user's account.
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
              }
            } catch { repoSync = undefined; prClient = undefined; ownRepoTarget = null; /* fall through to the platform store */ }
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
            // SECURITY (C2): reject a non-GitHub / malformed importUrl up front with a clear message,
            // and NEVER build a token-bearing URL from it (the token would otherwise be embedded into
            // whatever the user supplied). sanitizeRepoUrl validates the plain form; the token is then
            // injected into the SAME validated shape, and GitRepoSync re-validates at the sink.
            const cleanImportUrl = sanitizeRepoUrl(importUrl);
            if (!cleanImportUrl) {
              events.emit({ type: 'narration', agent: 'architect', text: `That import URL isn't a supported GitHub repository URL (expected https://github.com/owner/repo). Starting with an empty workspace instead.`, ts: Date.now() });
            } else {
            events.emit({ type: 'narration', agent: 'architect', text: `Importing your project from ${cleanImportUrl}…`, ts: Date.now() });
            // NOTE: do NOT gate the clone on "the sandbox is empty" — ensureWorkspace ALWAYS
            // pre-scaffolds a fresh workspace (a .gitignore + package-lock.json), so an empty check
            // never fires and the import silently did nothing (the reported "GitHub connect hua par
            // 0 files aayi" bug). hydrateFromRepo clones into a TEMP dir and overlays, so it handles
            // a scaffolded workspace by design — just run it whenever the user asked to import.
            const importSync = new GitRepoSync(actuator, workspaceId);
            const githubToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
            const cloneUrl = githubToken ? cleanImportUrl.replace('https://', `https://${githubToken}@`) : cleanImportUrl;
            // TRUST THE FILESYSTEM, not the shell echo. On a LARGE repo (real evidence: a 316-file
            // import) hydrateFromRepo's success marker was not captured, so it reported "skipped" and
            // we printed a false "couldn't clone" AND skipped the landing pipeline — even though the
            // files were actually on disk. So we measure the workspace BEFORE and AFTER: if the clone
            // added real files, the import SUCCEEDED regardless of what the echo said, and we land them.
            const beforePaths = new Set(Object.keys((await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string> }))).files));
            const h = await importSync.hydrateFromRepo(cloneUrl, { overlayAnyContent: true });
            const after = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
            const addedReal = Object.keys(after.files).filter((p) => !beforePaths.has(p));
            if (h.hydrated || addedReal.length > 0) {
              // LANDING PIPELINE (same as a zip import): the clone put files in the SANDBOX only.
              // Land them properly — durable store (Files/IDE/reopen), files_restored event,
              // framework lock, edit mode, memory index, background preview boot.
              if (Object.keys(after.files).length > 0) {
                await landImportedProject(after.files, { source: cleanImportUrl, writeToSandbox: false });
              } else {
                events.emit({ type: 'narration', agent: 'architect', text: 'The repository cloned but contained no readable source files — starting with an empty workspace instead.', ts: Date.now() });
              }
            } else if (h.skipped) {
              // The clone genuinely failed AND added no files — a bad URL, a PRIVATE repo without
              // access, or git being unavailable. Say so instead of silently building empty.
              events.emit({ type: 'narration', agent: 'architect', text: `I couldn't clone ${cleanImportUrl}. If it's private, connect the GitHub account that owns it (⚙ → GitHub) so I have access; otherwise check the URL. Starting with an empty workspace for now.`, ts: Date.now() });
            } else {
              // Cloned successfully but the repo had no content beyond .git (a brand-new empty repo).
              events.emit({ type: 'narration', agent: 'architect', text: `${cleanImportUrl} looks like an empty repository — there was nothing to import. Tell me what you'd like to build in it.`, ts: Date.now() });
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
            // A recycled sandbox loses binary assets too (they aren't in the text-file store or the
            // sandbox scan) — re-materialize them from the durable asset store alongside the files.
            await restoreWorkspaceAssets(actuator, workspaceId).catch(() => 0);
            // The guardian used to restore files SILENTLY — no file_changed event, so the client's
            // "Files (N)" count (and the agent's own file-count answers in plain chat, above) stayed
            // stuck at the pre-restore number even though the workspace genuinely has plan.count more
            // files now. Record each restored path through the SAME channel a normal write uses, so
            // every surface (header count, Files tab, plain-chat context) reflects reality immediately.
            for (const path of Object.keys(plan.restore)) state.recordFileChange({ path, kind: 'create' }, 'architect');
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
        // Pass the actuator as the session's command runner so the REAL Code Studio terminal can exec
        // bounded commands in this same warm sandbox.
        registerSession(workspaceId, git, userId ?? undefined, actuator);
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
        maxBudgetUsd: maxBudgetUsdForRunner, maxSteps: subAgentMaxSteps, checkpointer: git,
        // Pass the SAME 32000-token per-turn cap the top-level runner uses (below). Without it a
        // sub-agent falls back to 8192 and truncates large files — the top cause of incomplete apps.
        maxTokensPerTurn: buildMaxTokensPerTurn(),
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
        chosenProviderId, // Phase 0 hosting quota: classify first-party (platform-paid) vs BYO
      );
      // writtenFiles is declared further up (hoisted so the deadline-timeout/crash paths can see it too).
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
        // Security gate: scan AI-generated JS/TS files for malicious patterns before
        // they are persisted. Critical findings emit a security warning event so the
        // user sees it in the build log; the write itself is still recorded (the agent
        // may be writing the file to then fix it), but the warning is surfaced clearly.
        try {
          const scanResult = scanGeneratedCode(path, content);
          if (scanResult.findings.length > 0) {
            const report = formatCodeScanReport(scanResult);
            console.warn('[agentv3] CodeSafetyScanner finding:', report);
            events.emit({
              type: 'security_warning',
              filePath: path,
              safe: scanResult.safe,
              findings: scanResult.findings.map((f) => ({
                severity: f.severity,
                rule: f.rule,
                description: f.description,
                line: f.line,
              })),
              report,
              ts: Date.now(),
            });
          }
        } catch { /* security scan is best-effort — never blocks the build pipeline */ }

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
      // Phase S2 — IDE↔v3.0 awareness (Google-AI-Studio style): if the user MANUALLY edited files in
      // Code Studio since the last build, consume that pending set, tell the agent about it (so it reads
      // and builds ON TOP of those edits, never reverting them), and acknowledge it to the user in chat.
      // Consuming clears the set so the same edits aren't re-announced next turn. Additive + best-effort.
      try {
        const manual = await consumeManualEdits(workspaceId);
        if (manual.count > 0) {
          const note = manualEditContext(manual.paths);
          if (note) architectSystem = `${note}\n\n---\n\n${architectSystem}`;
          events.emit({ type: 'narration', agent: 'architect', text: manualEditNarration(manual.count), ts: Date.now() });
        }
      } catch { /* manual-edit awareness is best-effort — never blocks the build */ }
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

      // P-ARCH+.3 — up-front BLUEPRINT (advisory) for DEEP, agentic, NEW builds. The fast lane already
      // freezes a file-manifest + shared contract; the agentic loop plans free-form (update_todo only),
      // so a large app drifts (mismatched imports, missing files). This does ONE bounded, best-effort
      // model step to propose a file manifest + shared contract and PREPENDS it as advisory guidance —
      // the architect still owns the plan. Default OFF (opt-in AGENTV3_BLUEPRINT=on), matching the
      // cautious rollout of AGENTV3_ESCALATION/AUTOFIX. FULLY CONTAINED: on any timeout/error the block
      // is empty and the build runs EXACTLY as today; its tokens are billed via blueprintUsage below.
      if (
        !isEditMode && intent === 'new_build' && buildDepth === 'deep'
        && !classifyForOneShot(analysis?.startTier) && process.env.AGENTV3_BLUEPRINT === 'on'
      ) {
        try {
          const bpGenerate = async (system: string, user: string): Promise<string> => {
            const startedAt = Date.now();
            const call = new ClaudeClient(undefined, { maxRetries: 1 }).runTurn({
              model: fastBuildModel(), system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 6000,
            });
            // Hard timeout so an up-front step can NEVER hang the build (the losing call is ignored).
            const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('blueprint step timed out')), 30_000));
            const t = await Promise.race([call, timeout]);
            try {
              buildDiag.recordLlmCall({ model: fastBuildModel(), provider: 'anthropic', promptPreview: `${system}\n---\n${user}`, promptChars: system.length + user.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true });
            } catch { /* diagnostics best-effort */ }
            blueprintUsage.inputTokens += t.usage.inputTokens;
            blueprintUsage.outputTokens += t.usage.outputTokens;
            return t.text;
          };
          const scaffold = (await actuator.listFiles(workspaceId).catch(() => [])).filter((p) => !/^(node_modules|\.git)\//.test(p)).slice(0, 80);
          const manifest = parseFileManifest(await bpGenerate(manifestSystemPrompt(framework), manifestUserPrompt(prompt, scaffold)));
          if (manifest.length >= 2) {
            const contract = ((await bpGenerate(contractSystemPrompt(framework), contractUserPrompt(prompt, manifest))) || '').trim();
            const block = blueprintAdvisoryBlock(manifest, contract);
            if (block) {
              architectSystem = `${block}\n\n---\n\n${architectSystem}`;
              events.emit({ type: 'narration', agent: 'architect', text: 'Sketching a file blueprint & shared contract to keep this larger app consistent…', ts: Date.now() });
            }
          }
        } catch { /* blueprint is advisory + best-effort — on any error/timeout the build proceeds unchanged */ }
      }
      if (isEditMode) {
        // Reuse the up-front large-project listing (no second sandbox roundtrip); re-list only if
        // that early attempt failed (listing is best-effort — fall through to the normal build prompt).
        let fileTree: string[] = editFileTree ?? [];
        if (fileTree.length === 0) {
          try {
            fileTree = await actuator.listFiles(workspaceId);
          } catch { /* listing is best-effort — fall through to the normal build prompt */ }
        }
        // Engage surgical-edit mode ONLY when there are real files to patch. On an
        // empty or failed workspace there is nothing to edit, so the normal build
        // prompt (which freely creates files) is the correct, non-misleading default.
        if (fileTree.length > 0) {
          // Count EDITABLE SOURCE files (autopsy #2): listFiles includes ~150 binary assets the agent
          // can't touch, so the old raw `fileTree.length` (e.g. 317) contradicted the import banner's
          // "165 files" for the SAME project. One shared count (fileClassification.ts) keeps them honest.
          const sourceCount = countEditableSourceFiles(fileTree);
          events.emit({
            type: 'narration',
            agent: 'architect',
            text: `✏️ Editing your existing app (${sourceCount} source file${sourceCount === 1 ? '' : 's'}) — I'll make targeted changes, not rebuild it.`,
            ts: Date.now(),
          });
          architectSystem = editModePrefix(fileTree) + '\n\n---\n\n' + architectSystem;
          // Warm the project graph from the PERSISTED sandbox files when memory is
          // cold (process restarted but the sandbox survived). This makes the agent's
          // recall / evaluate tools see the existing codebase immediately on a resumed
          // edit session, instead of only after it manually re-reads files. Best-effort,
          // capped, and a no-op when memory is already warm — never blocks the build.
          // Runs BEFORE grounding (retrieval v2) so the freshly-warmed IMPORT GRAPH feeds
          // centrality ranking on the very first turn after an import — not one turn late.
          try {
            // Level 9: restore persisted memory snapshot before warming from files —
            // episodes and file-list hints survive server restarts this way.
            const wsMem = getWorkspaceMemory(workspaceId);
            await restoreWorkspaceMemory(workspaceId, wsMem).catch(() => {});
            await warmIndexFiles(wsMem, fileTree, (p) => actuator.readFile(workspaceId, p));
          } catch { /* warming is best-effort — never blocks a build */ }
          // P-AI.2 retrieval v2 (Mitrify autopsy) — intent-aware grounding: content hits (grep) +
          // structural anchors (package.json/README/entry/routes/schema) + import-graph centrality.
          // Replaces path-token-overlap-only selection, whose zero-overlap tie handed a survey
          // request the first 14 files alphabetically (BackButton.tsx…). Bounded + best-effort.
          try {
            let contentHits: string[] = [];
            try {
              const terms = contentSearchTerms(prompt);
              if (terms.length > 0 && typeof actuator.searchFiles === 'function') {
                contentHits = await actuator.searchFiles(workspaceId, terms).catch(() => []);
              }
            } catch { /* content search is best-effort */ }
            const sel = selectGroundingCandidates({
              fileTree, prompt, contentHits,
              imports: getWorkspaceMemory(workspaceId).graph().imports,
            });
            const filesMap: Record<string, string> = {};
            for (const p of sel.candidates) {
              const c = await actuator.readFile(workspaceId, p).catch(() => '');
              if (c) filesMap[p] = c;
            }
            // Overview/survey → anchors-first order (BM25 is meaningless for a query that matches no
            // content terms) and a wider block (5) so entry+routes+schema all land. Targeted → BM25 top 3.
            const grounded = buildGroundedContext(filesMap, prompt, sel.overview ? 5 : 3, { preserveOrder: sel.overview });
            if (grounded) architectSystem = `${grounded}\n\n---\n\n${architectSystem}`;
          } catch { /* grounding is best-effort — never blocks the build */ }
        }
      }

      // Base runner options — shared by the default build AND any escalated rebuild (P3).
      // Only client/model/conversationId vary per tier; everything else is identical so the
      // escalated build streams to the same surfaces and writes to the same workspace.
      // A new build or an edit MUST produce files — tell the runner so it reports a no-tool
      // "I'm preparing a plan…" reply as a FAILED build (ok:false) instead of a fake success.
      // EXCEPT an IMPORT turn: its deliverable is the just-landed project, and the user asked for a
      // SURVEY ("do not change any files yet"), so creating no new files is the correct, successful
      // outcome — NOT a failed build to retry/escalate. (Real evidence: importing Mitrify escalated
      // 3-4× over 5 min and ran the readiness gate on the user's OWN imported code → "NOT READY 0/100".)
      const expectsArtifacts = (intent === 'new_build' || intent === 'edit_existing') && !isImportTurn;
      // The mandatory readiness gate audits code v3.0 BUILT — it must NOT judge a freshly-imported
      // existing app (its pre-existing hardcoded keys / SQL patterns are the user's, not this build's,
      // and surfacing "NOT READY 0/100" on their working production app is wrong + alarming).
      const runReadinessGate = readinessGateEnabled() && !isImportTurn;
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
        maxBudgetUsd: maxBudgetUsdForRunner,
        maxSteps,
        toolConcurrency,
        agentRole: 'architect' as const,
        signal: abort.signal,
        expectsArtifacts,
        // B1 — lift the per-turn output cap off ClaudeClient's 8192 default so a large file/component
        // is written in ONE turn instead of truncating at max_tokens. Shared by the default build AND
        // every escalated/retry runner that spreads baseRunnerOpts.
        maxTokensPerTurn: buildMaxTokensPerTurn(),
        // R2 §1.1 — top-level build runners (which spread baseRunnerOpts) get the mandatory
        // readiness gate; sub-agents (SubAgent.ts, separate opts) never do. An import+survey turn
        // opts out (runReadinessGate) so the gate never audits the user's freshly-imported code.
        readinessGate: runReadinessGate,
        // WATCHDOG — hard wall-clock cap so a build can never hang for 20-30 min (0 = disabled).
        maxBuildMs: effectiveBuildSeconds * 1000,
        // AI Diagnosis Bundle #4 — capture every model turn's I/O (truncation, failures, latency)
        // into the build report. Shared by the default build AND every escalated/retry/heal runner.
        onLlmCall: (c: Parameters<NonNullable<typeof buildDiag.recordLlmCall>>[0]) => {
          try { buildDiag.recordLlmCall(c); } catch { /* diagnostics are best-effort */ }
        },
      };
      // Hoisted so the fast-lane fallback persistence below (SETTLED section) can reuse the SAME id —
      // if the agentic runner ends up actually persisting under it, the fallback is a no-op.
      // STABLE per-session id so ALL runners in this build AND every later message in this session
      // share ONE conversation (append, don't fork) → one history entry per session, coherent editing.
      const mainConversationId = conversationIdForWorkspace(workspaceId);
      const runner = new AgentRunner({
        ...baseRunnerOpts,
        client,
        model,
        // D7: persist the build transcript so it survives a reconnect/refresh. Best-effort —
        // a store failure never breaks the build (see AgentRunner). Reloadable via the
        // GET /api/agentv3/conversations endpoints below.
        persistence: {
          store: getConversationStore(),
          conversationId: mainConversationId,
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
          maxBudgetUsd: maxBudgetUsdForRunner,
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

      // ── SOFTWARE PROJECT MODE (SPM-2) — flag-gated AGENTV3_PROJECT_MODE=on, default OFF ──────
      // A 1000-5000-file project can never fit one agentic conversation (context window, step cap,
      // wall clock). In project mode the mega-ask is decomposed ONCE into modules with explicit
      // dependencies + frozen export contracts (durable — survives reloads and instance rotations),
      // and each build turn constructs ONE module in a small, constant-size context: that module's
      // spec + the contracts of already-DONE modules. The existing Layer-3 client auto-continue
      // drives turn after turn via the `resumable` result flag below. FULLY CONTAINED: flag off, no
      // plan, a non-mega ask, a planner failure, or ANY error → the build runs EXACTLY as today.
      // With a plan active, only a CONTINUATION message advances it — a substantive mid-project
      // message (an edit request, a question) takes the normal build path so it is never
      // steamrolled into "build module N". Planner tokens are billed via blueprintUsage (same
      // markup as every other v3.0 call).
      let projectPlanRef: ProjectPlan | null = null;
      let projectModuleRef: ProjectModule | null = null;
      if (projectModeEnabled(process.env, { userId, email }) && !planFirst) {
        try {
          let pPlan = await loadProjectPlan(workspaceId);
          const planPreExisted = !!pPlan;
          if (!pPlan && intent === 'new_build' && !isEditMode && detectMegaProject(prompt)) {
            events.emit({ type: 'narration', agent: 'architect', text: '🏗️ This is a large software project — decomposing it into independently-buildable modules with frozen interface contracts…', ts: Date.now() });
            const ppGenerate = async (system: string, user: string): Promise<string> => {
              const startedAt = Date.now();
              const call = new ClaudeClient(undefined, { maxRetries: 1 }).runTurn({
                model: fastBuildModel(), system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8000,
              });
              // Hard timeout so the up-front planner can NEVER hang the build (the losing call is ignored).
              const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('project planner timed out')), 60_000));
              const t = await Promise.race([call, timeout]);
              try {
                buildDiag.recordLlmCall({ model: fastBuildModel(), provider: 'anthropic', promptPreview: `${system}\n---\n${user}`, promptChars: system.length + user.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true });
              } catch { /* diagnostics best-effort */ }
              blueprintUsage.inputTokens += t.usage.inputTokens;
              blueprintUsage.outputTokens += t.usage.outputTokens;
              return t.text;
            };
            const ppScaffold = (await actuator.listFiles(workspaceId).catch(() => [] as string[])).filter((p) => !/^(node_modules|\.git)\//.test(p)).slice(0, 80);
            const modules = parsePlannedModules(await ppGenerate(projectPlanSystemPrompt(framework), projectPlanUserPrompt(prompt, ppScaffold)));
            if (modules.length >= MIN_PROJECT_MODULES) {
              pPlan = createProjectPlan(prompt, framework, modules, Date.now());
              await saveProjectPlan(workspaceId, pPlan);
              events.emit({ type: 'narration', agent: 'architect', text: `📦 Project plan ready: ${modules.length} modules — ${modules.map((m) => m.name).join(' → ')}. I will build them one per round, in dependency order, and the plan survives reloads.`, ts: Date.now() });
            }
            // Fewer modules than MIN_PROJECT_MODULES → not really a mega-project; fall through and
            // build normally (honest fallback — never force a small app through module rounds).
          }
          if (pPlan && !planComplete(pPlan) && (!planPreExisted || isContinuationMessage(prompt))) {
            let nextMod = nextBuildableModule(pPlan);
            // RETRY a failed module on an EXPLICIT user continuation (auto-continue stops at a
            // failure by design — `resumable` is only emitted on ok results). Resetting it to
            // pending clears the failure detail and lets the normal scheduler pick it up again.
            if (!nextMod && planPreExisted) {
              const failedMod = pPlan.modules.find((m) => m.status === 'failed');
              if (failedMod) {
                pPlan = markModuleStatus(pPlan, failedMod.id, 'pending');
                nextMod = nextBuildableModule(pPlan);
                if (nextMod) events.emit({ type: 'narration', agent: 'architect', text: `🔁 Retrying module "${failedMod.name}" (it failed last round).`, ts: Date.now() });
              }
            }
            if (nextMod) {
              pPlan = markModuleStatus(pPlan, nextMod.id, 'in_progress');
              await saveProjectPlan(workspaceId, pPlan);
              state.setTodos(projectPlanTodos(pPlan));
              projectPlanRef = pPlan;
              projectModuleRef = pPlan.modules.find((m) => m.id === nextMod.id) ?? nextMod;
              buildPrompt = `${moduleBuildContext(pPlan, projectModuleRef)}\n\n---\n\nUser's message this turn:\n${buildPrompt}`;
              events.emit({ type: 'narration', agent: 'architect', text: `🧩 ${planProgressLine(pPlan)}`, ts: Date.now() });
            } else {
              const reason = planBlockedReason(pPlan);
              if (reason) events.emit({ type: 'narration', agent: 'architect', text: `⚠️ Project plan is blocked: ${reason}`, ts: Date.now() });
            }
          } else if (pPlan && !planComplete(pPlan) && planPreExisted) {
            events.emit({ type: 'narration', agent: 'architect', text: `ℹ️ Handling this message normally (project plan stays paused at ${planProgressLine(pPlan)}). Say "continue" to resume the next module.`, ts: Date.now() });
          }
        } catch { /* project mode is additive — on ANY failure the build proceeds exactly as today */ }
      }

      // Cost-ladder escalation (P3) — DORMANT unless AGENTV3_ESCALATION=on. When off,
      // this is exactly `await runner.run(buildPrompt)` (the start-tier build, once). When
      // on, the build runs cheap-first and climbs the analyser's escalation path ONLY when
      // the objective gate (build completed?) fails — the last tier is always delivered as a
      // best-effort backstop, so the build never "breaks". `deliveredTier` feeds telemetry.
      let result: Awaited<ReturnType<typeof runner.run>> | undefined;
      let deliveredTier: StartTier = analysis?.startTier ?? (onlyOpus ? 'opus' : 'gemini');
      // True once the fast lane (SimpleBuilder / OneShot) produced the result — that path already runs
      // its own tsc verify-gate + repair, so the post-agentic tsc gate below skips it (no redundant run).
      let fastLaneGated = false;

      // ── ONE-SHOT FAST LANE (additive, flag-gated; the agentic loop is untouched) ──
      // For a SIMPLE new-build app, try ONE cheap generation call first (no Architect, no
      // sub-agents, no per-file round-trips, no Opus, no rebuild loop). On success the build is
      // done. On ANY failure (no usable files / model error) it falls through to the agentic loop
      // below — the safety net — so behavior is NEVER worse than today. AGENTV3_ONESHOT=off disables.
      // Project mode (SPM-2): a module turn always runs the agentic loop — the fast lane's isolated
      // per-file generation has no tool loop to honor the module's frozen contracts and file scope.
      if (oneShotEnabled() && intent === 'new_build' && classifyForOneShot(analysis?.startTier) && !projectModuleRef && !isImportTurn) {
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
          // Write files with bounded concurrency instead of one serial E2B round trip each (SPEED).
          // Paths are distinct by construction (de-duped by path upstream), so concurrent writes to
          // different files never conflict; the E2B round-trip latency (~150-300ms each) now overlaps.
          // The plan-progress ticker counts writes (order-independent), so completion order is fine.
          await mapWithConcurrency(files, 6, (f, i) =>
            dispatcher.dispatch({ id: `fast-w${i}`, name: 'write_file', input: { path: f.path, content: f.content } }, 'frontend'),
          );
        };
        const fastPreview = async (): Promise<void> => {
          // Re-install when package.json is NEWER than node_modules (the generator added deps like
          // tailwindcss). The old `[ -d node_modules ] && "deps present"` skipped install on a
          // restored/scaffolded sandbox even after new deps were added → "Cannot find module
          // 'tailwindcss'" → dev server crash. This installs exactly when the dep set changed.
          await dispatcher.dispatch({ id: 'fast-install', name: 'bash', input: { command: 'if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install; else echo "deps present"; fi' } }, 'frontend');
          // DEPENDENCY RECONCILE (real fix for the broken preview): the AI sometimes imports a package
          // it forgot to add to package.json (real report: `@dnd-kit/modifiers` imported by TodoList.tsx
          // but never declared) → `npm install` never fetched it → Vite "could not be resolved" → the
          // dev server's port is up but the app can't load. Scan the generated files for imported-but-
          // undeclared packages and install exactly those BEFORE starting the dev server. Bounded + safe:
          // each name is shell-quote-validated, capped, and this only ADDS missing deps (never removes).
          try {
            const missing = findMissingDependencies(Object.fromEntries(writtenFiles))
              .filter((p) => /^(?:@[\w.-]+\/)?[\w.-]+$/.test(p)) // shell-safe package names only
              .slice(0, 20);
            if (missing.length > 0) {
              fastLog(`📦 Installing ${missing.length} missing dependenc${missing.length === 1 ? 'y' : 'ies'} the code imports but package.json omitted: ${missing.join(', ')}`);
              await dispatcher.dispatch({ id: 'fast-reconcile', name: 'bash', input: { command: `npm install --no-audit --no-fund ${missing.join(' ')}` } }, 'frontend');
            }
          } catch { /* reconcile is best-effort — a failure just falls back to the plain install above */ }
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
        const fastRepair = async (errors: string, currentFiles: { path: string; content: string }[], contract?: string): Promise<{ path: string; content: string }[]> => {
          const text = await fastGenerate(repairSystemPrompt(framework), repairUserPrompt(prompt, errors, currentFiles, contract));
          return parseFileBlocks(text).map((b) => ({ path: b.path, content: b.content }));
        };
        const fastLog = (msg: string) => events.emit({ type: 'narration', agent: 'architect', text: msg, ts: Date.now() });
        const fastResult = (summary: string, steps: number) => {
          result = { ok: true, summary, steps, usage: osUsage, billedUsd: billedAmountUsd({ inputTokens: osUsage.inputTokens, outputTokens: osUsage.outputTokens }, powerLevelReq) };
          deliveredTier = analysis?.startTier ?? 'haiku';
          fastLaneGated = true; // the fast lane already type-checked + repaired — skip the agentic gate
        };

        // 1) SIMPLE BUILDER (primary) — plan a file manifest, then generate EACH file in its own
        //    focused call. This beats the single-call OneShot's ~8k-token truncation that made
        //    multi-file apps produce "no files" and drop into the slow agentic loop.
        const sb = await runSimpleBuild({ prompt, framework, scaffoldPaths: scaffold, generate: fastGenerate, writeFiles: fastWrite, startPreview: fastPreview, verify: fastVerify, repair: fastRepair, log: fastLog, depOrder: process.env.AGENTV3_DEP_ORDER !== 'off' });
        buildDiag.record({ phase: 'build', severity: 'info', code: sb.ok ? 'SIMPLE_BUILD_SUCCESS' : 'SIMPLE_BUILD_FALLBACK', message: sb.summary, autoResolved: true, detail: sb.reason });
        // Deterministic end-state classification (BUILD_SUCCESS / TYPECHECK_FAILED / BUILD_PARTIAL / …)
        // recorded into the build report so dashboards/retry policy can branch on the exact outcome.
        if (sb.outcome) buildDiag.record({ phase: 'build', severity: 'info', code: `OUTCOME_${sb.outcome}`, message: `Build outcome: ${sb.outcome}`, autoResolved: true });
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
        // STRONG JUDGE (admin 2026-07-03): the cheap floor (GLM/Kimi) builds attempt 1; a SONNET judge
        // reviews it — a cheap model can't reliably catch its own gaps (a cosmetic feature, a subtle
        // bug). Only on a judge FAIL do we spend Sonnet, and then to REPAIR the judge's specific
        // findings (edit the existing files), never a rebuild. Disable with AGENTV3_SONNET_JUDGE=off.
        let judgeFindings: string[] = [];
        let lastAttempt = 0;
        const judgeOn = process.env.AGENTV3_SONNET_JUDGE !== 'off';
        const esc = await runWithEscalation(analysis.escalationPath, {
          buildOnTier: async (tier, attempt) => {
            lastAttempt = attempt;
            if (attempt === 1) return runner.run(buildPrompt); // cheap-first start-tier runner
            // Escalated attempt: a stronger (Sonnet), Claude-first runner on the same workspace/stream.
            // When the judge produced findings, hand them over as a REPAIR task (fix these; edit the
            // existing files), never a rebuild-from-scratch.
            const repairing = judgeFindings.length > 0;
            events.emit({ type: 'narration', agent: 'architect', text: repairing ? 'Escalating to Sonnet to fix the issues found in review…' : 'Escalating to a stronger model to finish the build…', ts: Date.now() });
            const escRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ geminiModel: tierToGeminiBuildModel(tier), claudeFirst: true, onProviderUsed: captureProvider }),
              // Opus ONLY in power mode — a power-off escalation caps at Sonnet, never Opus
              // (admin rule 2026-06-28). Escalation only runs in normal mode anyway.
              model: resolveModel(tier === 'opus' && onlyOpus),
              persistence: {
                store: getConversationStore(),
                conversationId: mainConversationId, // same session conversation — append, don't fork
                userId: userId ?? 'anon',
                workspaceId,
                title: deriveTitle(prompt),
              },
            });
            return escRunner.run(repairing ? judgeRepairPrompt(prompt, judgeFindings) : buildPrompt);
          },
          gate: async (build) => {
            const base = escalationGate(build.ok);
            if (!base.pass) return base; // build broken / readiness failed → escalate (rebuild, as before)
            // The cheap build PASSED the free deterministic gate — now the STRONG judge looks deeper.
            // Only judge the CHEAP first attempt (never re-judge Sonnet's own repair), and only when the
            // cheap floor actually delivered it (no point judging a Claude-built app).
            const deliveredCheap = /^(GLM|KIMI)$/i.test(dominantProvider(providerTurns) || '');
            if (!judgeOn || lastAttempt !== 1 || !deliveredCheap) return base;
            // ADMIN PLAN (2026-07-05): review the cheap build with GROK (cheaper than Sonnet + an
            // independent family), and give GLM/KIMI EXACTLY ONE self-repair bounce — re-reviewed by
            // Grok — BEFORE we ever spend Sonnet. Claude is touched only for the FINAL repair below.
            const judge = selectReviewJudge();
            const reviewerName = judge.kind === 'grok' ? 'Grok' : 'Sonnet';
            const collectFiles = (): Array<{ path: string; content: string }> => [...writtenFiles.entries()].map(([path, content]) => ({ path, content }));
            const recordVerdict = (v: { pass: boolean; score: number; findings: string[] }, tag: string): void => {
              try { buildDiag.record({ phase: 'build', severity: v.pass ? 'info' : 'warning', code: 'CHEAP_REVIEW', message: `${tag}: ${v.pass ? 'PASS' : 'FAIL'} (score ${v.score})${v.pass ? '' : ' — ' + v.findings.slice(0, 3).join('; ')}`, autoResolved: true }); } catch { /* diagnostics best-effort */ }
            };
            events.emit({ type: 'narration', agent: 'architect', text: `🔎 ${reviewerName} is reviewing the cheap build…`, ts: Date.now() });
            let verdict = await judgeBuild(prompt, collectFiles(), judge.runTurn, judge.modelId);
            recordVerdict(verdict, `${reviewerName} review`);
            // BOUNCE loop: `nextReviewAction` bounds it — after `cap` cheap repairs it can ONLY go to
            // Sonnet, never bounce to the weak model again (that was the 51-fallback grind).
            const cap = cheapBounceCap(process.env.AGENTV3_CHEAP_BOUNCES);
            let bounces = 0;
            while (nextReviewAction(verdict.pass, bounces, cap) === 'cheap_repair') {
              bounces++;
              events.emit({ type: 'narration', agent: 'architect', text: '🔧 Review found issues — GLM/KIMI fixing them once…', ts: Date.now() });
              try { await runner.run(judgeRepairPrompt(prompt, verdict.findings)); } catch { break; /* GLM/KIMI down → stop bouncing, escalate to Sonnet */ }
              events.emit({ type: 'narration', agent: 'architect', text: `🔎 ${reviewerName} re-reviewing the fix…`, ts: Date.now() });
              verdict = await judgeBuild(prompt, collectFiles(), judge.runTurn, judge.modelId);
              recordVerdict(verdict, `${reviewerName} re-review`);
            }
            if (verdict.pass) return base; // the cheap build (or its one self-fix) is genuinely good → no Sonnet spend
            judgeFindings = verdict.findings; // still failing after the bounce → hand to Sonnet as the repair list
            return { pass: false, score: verdict.score, reason: `Review found issues: ${verdict.findings.slice(0, 2).join('; ')}` };
          },
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
            conversationId: mainConversationId, // same session conversation — append, don't fork
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

      // G3 — POST-AGENTIC TSC GATE (default-on; disable with AGENTV3_AGENTIC_TSC_GATE=off). The fast
      // lane (SimpleBuilder) type-checks + repairs, but the agentic loop / escalation / empty-build
      // retry had NO deterministic compile gate — it relied on the agent choosing to run tsc, which is
      // not guaranteed, so a build that "finished" could still ship type errors. This runs one real
      // `tsc --noEmit` over the produced files and, on type errors, makes ONE bounded Claude repair
      // pass, then re-checks. It is purely ADDITIVE: it NEVER flips result.ok and NEVER blocks (best-
      // effort, abortable, budget-capped); on persisting errors it records the honest OUTCOME so the
      // report/dashboard sees the true end-state (ship-with-warning, exactly like PREVIEW_FAILED).
      if (
        process.env.AGENTV3_AGENTIC_TSC_GATE !== 'off' && !fastLaneGated
        && result.ok && writtenFiles.size > 0 && !abort.signal.aborted
        // Only with comfortable time left for install + tsc + one repair pass.
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000)
      ) {
        const runTsc = async (): Promise<{ ok: boolean; errors: string }> => {
          try {
            // ENSURE A TSCONFIG FIRST: an imported/older project can have NO tsconfig.json, in which case
            // `tsc --noEmit` prints its HELP page and exits 0 — a FALSE "clean" pass while real type
            // errors (e.g. a missing enum export) slip through to a blank-screen runtime crash (seen in a
            // real report). For a TS project (a .ts/.tsx under src) with no config, write a minimal,
            // PERMISSIVE tsconfig (strict:false, skipLibCheck) so tsc actually verifies — without
            // introducing new strictness errors. Never overwrites an existing config. Best-effort.
            const ensureCfg = "if [ ! -f tsconfig.json ] && [ ! -f tsconfig.app.json ] && find src -name '*.ts' -o -name '*.tsx' 2>/dev/null | head -1 | grep -q .; then printf '%s' '{\"compilerOptions\":{\"target\":\"ES2020\",\"lib\":[\"ES2020\",\"DOM\",\"DOM.Iterable\"],\"module\":\"ESNext\",\"moduleResolution\":\"bundler\",\"jsx\":\"react-jsx\",\"strict\":false,\"skipLibCheck\":true,\"noEmit\":true,\"esModuleInterop\":true,\"allowSyntheticDefaultImports\":true,\"isolatedModules\":true},\"include\":[\"src\"]}' > tsconfig.json; fi";
            const r = await actuator.runCommand(workspaceId, `${ensureCfg}; if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install >/dev/null 2>&1; fi; npx --no-install tsc --noEmit 2>&1 | tail -200 || true`);
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            // A help-page result means tsc STILL didn't really run (e.g. no src TS files) — treat as
            // "unverified, don't block", never as a clean pass (no fake success).
            if (looksLikeTscHelpOutput(out)) return { ok: true, errors: '' };
            return hasTscErrors(out) ? { ok: false, errors: out.slice(0, 6000) } : { ok: true, errors: '' };
          } catch {
            return { ok: true, errors: '' }; // couldn't verify (no real sandbox / tooling) → don't block
          }
        };
        let check = await runTsc();
        if (!check.ok) {
          events.emit({ type: 'narration', agent: 'architect', text: '🔍 Type-checking the finished build — found type errors, fixing them…', ts: Date.now() });
          try {
            const currentFiles = Array.from(writtenFiles.entries()).map(([path, content]) => ({ path, content }));
            const t = await new ClaudeClient(undefined, { maxRetries: 2 }).runTurn({
              model: fastBuildModel(), system: repairSystemPrompt(framework),
              messages: [{ role: 'user', content: repairUserPrompt(prompt, check.errors, currentFiles) }],
              tools: [], maxTokens: 8000,
            });
            const fixes = parseFileBlocks(t.text).map((b) => ({ path: b.path, content: b.content }));
            for (let i = 0; i < fixes.length; i++) {
              await dispatcher.dispatch({ id: `tscgate-w${i}`, name: 'write_file', input: { path: fixes[i].path, content: fixes[i].content } }, 'frontend');
            }
          } catch (e) {
            console.log(`[AGENTV3] agentic tsc-gate repair failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          check = await runTsc();
          if (check.ok) {
            events.emit({ type: 'narration', agent: 'architect', text: '✅ Type errors fixed — the finished build now compiles cleanly.', ts: Date.now() });
          } else {
            // Type errors remain after one repair — record the honest end-state (do NOT flip result.ok;
            // the app is built and will be durably saved — ship-with-warning, like PREVIEW_FAILED).
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'OUTCOME_TYPECHECK_FAILED', message: 'Type errors remained after the agentic build and one repair pass.', autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: '⚠️ Some TypeScript errors remain after one fix pass. Your files are saved — send a follow-up and I\'ll finish fixing them.', ts: Date.now() });
          }
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
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000)
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
          if (attempt >= healMax || abort.signal.aborted || (effectiveBuildSeconds > 0 && Date.now() - buildStartedAt > effectiveBuildSeconds * 1000 - 60_000)) {
            events.emit({ type: 'narration', agent: 'architect', text: `⚠️ I checked the live preview and it did not fully render: ${problems.slice(0, 3).join('; ')}. Your files are saved — send a follow-up and I'll fix it.`, ts: Date.now() });
            break;
          }
          events.emit({ type: 'narration', agent: 'architect', text: `🔍 I opened the preview and it didn't render correctly (${problems[0]}). Fixing it now…`, ts: Date.now() });
          try {
            const healRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ claudeFirst: true }),
              model: resolveModel(onlyOpus),
              persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
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
            persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
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
      if (result.ok) {
        buildResultRef = { ok: true, summary: result.summary, steps: result.steps, billedUsd: result.billedUsd };
        // Build succeeded + files saved → cap the remaining ADVISORY work so a hung push/persist can
        // never hold the stream open (and the UI "building") past this short window. Normal completion
        // clears the timer in the finally before it can fire, so this only bites a genuinely stuck tail.
        armAdvisoryCap();
      }

      // FAST-LANE PERSISTENCE FALLBACK ("memory gone after reload" fix): only the agentic AgentRunner
      // (escalation/empty-build-retry/preview-heal/auto-fix) persists to ConversationStore — via its
      // own `persistence` option, triggered inside run(). The FAST LANE (SimpleBuilder/OneShot — the
      // PRIMARY, most-common path for a simple build) never calls runner.run() when it succeeds, so it
      // never touches ConversationStore at all. A build that completed entirely through the fast lane
      // therefore left NO durable conversation record: on reload, "restore the most recent build"
      // (GET /api/agentv3/conversations) found nothing for this workspace (or an older, unrelated one),
      // so the chat/session looked wiped even though the generated FILES were saved separately. Ensure
      // exactly one record exists for every build, regardless of which path produced it — checked by
      // whether ANYTHING was already persisted for this workspace during this build's own run (covers
      // every persistence-configured runner above, not just the base one), so this never double-writes
      // over a richer, already-saved transcript. Best-effort — a store failure never affects the build.
      try {
        const store = getConversationStore();
        const recentForUser = await store.listByUser(userId ?? 'anon', 10);
        if (needsFallbackConversationPersist(recentForUser, workspaceId, buildStartedAt)) {
          // UPSERT on the stable per-session id (shared helper — the ONE server write shape for
          // history): first turn creates the record, later turns append; a create race retries
          // as an append so a turn is never silently dropped.
          await upsertConversationTurn(store, {
            conversationId: mainConversationId,
            userId: userId ?? 'anon',
            workspaceId,
            title: deriveTitle(prompt),
            // Explicit creation stamps: the prompt was said at build START, the summary at the
            // end — so on reopen the user's bubble sorts ABOVE the timeline action rows it
            // caused, and the summary below them (the live order). A single end-of-write stamp
            // put the prompt underneath its own build's activity.
            turn: [
              { role: 'user', content: prompt, ts: buildStartedAt },
              { role: 'assistant', content: result.summary || '', ts: Date.now() },
            ],
            patch: { status: result.ok ? ('complete' as const) : ('error' as const), billedUsd: result.billedUsd, updatedAt: Date.now() },
          });
        }
      } catch { /* fallback persistence is best-effort — never affects the build result */ }

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
        // D10 SELF-LEARNING: distil the actual BUILD REPORT (root cause + the real unresolved problems +
        // the Sonnet judge's findings) into ONE concrete lesson and record it — so the SPECIFIC mistake
        // (OOM, cosmetic feature, missing tsconfig, blank preview) becomes a durable lesson the next
        // build recalls, instead of a generic summary. Flows to session memory now, and to the
        // cross-project user brain below. Best-effort.
        try {
          const diag = buildDiag.report();
          const lesson = buildLessonFromDiagnostics({ ok: result.ok, rootCause: diag.rootCause, problems: diag.problems });
          if (lesson) reflectMem.recordNote(lesson);
        } catch { /* lesson distillation is best-effort */ }
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
          // Pass the REAL preview state: a live preview URL was published this build iff lastPreviewUrl
          // is set. Without this the recap always said "see it live" even when the preview never came up
          // (the dishonest message a real build report showed — no-fake-success rule).
          // HONESTY (autopsy 2026-07-05): also pass how many files THIS run actually changed —
          // writtenFiles counts only dispatcher writes (AI edits), NOT imported files, so a read-only
          // import+survey gets "I analyzed your project — no files were changed" instead of the false
          // "Here's what I built". An edit run says "I changed N file(s)"; a fresh build keeps "built".
          const summaryText = summarizeProject(getWorkspaceMemory(workspaceId).graph(), prompt, { previewLive: !!lastPreviewUrl, changedFiles: writtenFiles.size, editMode: isEditMode });
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
      const reviewHeadroomOk = effectiveBuildSeconds === 0 || (Date.now() - buildStartedAt) < (effectiveBuildSeconds * 1000 - 120_000);
      // SPEED: skip the advisory reviewer (30-90s + 3-6 Claude calls) for FAST-LANE (simple) builds —
      // they already passed the fast lane's own `npx tsc --noEmit` type-check + CSS-consistency verify +
      // repair, so the extra multi-call review adds latency to the most common build with little value.
      // The reviewer still runs on the agentic path (complex builds). Force it on with AGENTV3_REVIEW_FASTLANE=on.
      const reviewerAllowed = !fastLaneGated || process.env.AGENTV3_REVIEW_FASTLANE === 'on';
      if (result.ok && reviewHeadroomOk && reviewerAllowed) {
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
          // C9 — the reviewer's CRITICAL findings are no longer merely advisory: FIX them in the same
          // build. A [CRITICAL] means a feature is missing or broken (e.g. the calculator's Operator
          // logic bug a real report's reviewer caught but never fixed). This complements the Sonnet
          // judge (#876, which only guards CHEAP-floor builds) — the reviewer runs on every agentic
          // build, so this catches a strong build's critical bug too. ONE bounded repair pass, gated by
          // autoFixEnabled(), best-effort — never blocks/fails the build; the fix's writes are saved.
          const criticals = (review.issues ?? []).filter((i) => i.severity === 'critical').map((i) => i.message.trim()).filter(Boolean);
          if (criticals.length && autoFixEnabled() && reviewHeadroomOk && !abort.signal.aborted) {
            events.emit({ type: 'narration', agent: 'architect', text: `🔧 Reviewer found ${criticals.length} critical issue(s) — fixing them now…`, ts: Date.now() });
            const critFixRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ claudeFirst: true }),
              model: resolveModel(onlyOpus),
              persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
            });
            try {
              const fix = await raceTimeout(critFixRunner.run(judgeRepairPrompt(prompt, criticals)), 120_000, 'reviewer-critical-autofix');
              if (fix.ok) result = fix;
              // Persist the repair's writes (the reviewer runs AFTER the main save, so save again).
              if (writtenFiles.size > 0) { try { await saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* best-effort */ } }
              try { buildDiag.record({ phase: 'build', severity: 'info', code: 'REVIEWER_AUTOFIX', message: `Auto-fixed ${criticals.length} reviewer critical issue(s)`, autoResolved: true }); } catch { /* best-effort */ }
            } catch (e) { console.log(`[AGENTV3] reviewer-critical auto-fix failed: ${e instanceof Error ? e.message : String(e)}`); }
          }
        } catch { /* reviewer is best-effort (incl. its 90s cap) — never affects the build result */ }
      }

      // ── SOFTWARE PROJECT MODE (SPM-2): settle this module's status from the REAL result ──────
      // done only on a genuinely successful turn; failed (with the honest reason) otherwise — a
      // failed module blocks its dependents by design (planBlockedReason reports it). A wall-clock
      // pause never reaches here, so the module stays in_progress and the next turn RESUMES it.
      // The plan (todos projection) is refreshed BEFORE the PLAN_STATE capture below so the durable
      // note reflects the settled statuses. Best-effort — never affects the build result.
      if (projectPlanRef && projectModuleRef) {
        try {
          const settled = result.ok
            ? markModuleStatus(projectPlanRef, projectModuleRef.id, 'done')
            : markModuleStatus(projectPlanRef, projectModuleRef.id, 'failed', (result.summary || 'The build turn for this module failed.').slice(0, 300));
          await saveProjectPlan(workspaceId, settled);
          projectPlanRef = settled;
          state.setTodos(projectPlanTodos(settled));
          if (planComplete(settled)) {
            events.emit({ type: 'narration', agent: 'architect', text: `🏁 All ${settled.modules.length} modules are complete — the project plan is finished.`, ts: Date.now() });
          } else if (result.ok) {
            events.emit({ type: 'narration', agent: 'architect', text: `✅ Module "${projectModuleRef.name}" done — ${planProgressLine(settled)}. Continuing with the next module…`, ts: Date.now() });
          } else {
            const reason = planBlockedReason(settled);
            events.emit({ type: 'narration', agent: 'architect', text: `❌ Module "${projectModuleRef.name}" failed — ${reason ?? 'say "continue" after reviewing to retry the remaining modules.'}`, ts: Date.now() });
          }
        } catch { /* module settle is best-effort — the plan self-heals on the next turn */ }
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
      if (userId) {
        try {
          // Only THIS build's episodes (created at/after the pre-run watermark) — never the prior
          // builds' episodes that restoreWorkspaceMemory replayed, which would inflate confidence.
          const episodes = getWorkspaceMemory(workspaceId)
            .snapshot()
            .episodes.filter((e) => typeof e.ts === 'number' && e.ts >= brainBaselineTs);
          // D10 — LEARN FROM MISTAKES TOO: previously only a SUCCESSFUL build promoted lessons, so the
          // most valuable signal (what a FAILED build did wrong) was dropped from the cross-project
          // brain. Now a failed build ALSO teaches the user brain — but only its curated NOTE lessons
          // (the distilled "what went wrong / avoid this"), NEVER its `fix` episodes (a fix on a failed
          // build is unproven, so promoting it as a "proven fix" would be a bad lesson). A successful
          // build still promotes everything (proven fixes + notes), unchanged.
          const promotable = result.ok ? episodes : episodes.filter((e) => (e as { kind?: string }).kind === 'note');
          userLessonBrainStore.recordBuildLessons(userId, promotable, new Date().toISOString()).catch(() => {});
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
          // OWN-REPO WORKING BRANCH (admin model 2026-07-05): the user imported a repo they own — push
          // edits to the `navbharatai/work` branch (force is safe: single-writer branch, NEVER `main`)
          // and keep ONE work→base PR open. We do NOT auto-merge: `main` changes only when the USER
          // merges the PR (an in-app "Ship to main" + "Revert" lands in the next slice). So there is
          // structurally nothing that can break `main` here.
          if (ownRepoTarget && prClient) {
            const pushed = await repoSync.pushAll(repoAuthedUrl, ownRepoTarget.workBranch, msg);
            if (pushed.pushed) {
              let prNote = `Saved your edits to the ‘${ownRepoTarget.workBranch}’ branch (your ‘${ownRepoTarget.baseBranch}’ is untouched).`;
              try {
                const pr = await prClient.openPullRequest(
                  ownRepoTarget.repo, ownRepoTarget.workBranch, ownRepoTarget.baseBranch,
                  `NavBharatAI: update ${ownRepoTarget.repo}`,
                  `Edits by NavBharatAI Pro v3.0 on \`${ownRepoTarget.workBranch}\`. Review and merge into \`${ownRepoTarget.baseBranch}\` when ready.`,
                );
                if (pr.number) {
                  prNote = `Saved your edits to ‘${ownRepoTarget.workBranch}’ and opened PR #${pr.number} → ‘${ownRepoTarget.baseBranch}’. Your ‘${ownRepoTarget.baseBranch}’ is untouched — review and merge when ready: ${pr.htmlUrl}`;
                }
              } catch { /* PR is best-effort — the edits are safely on the work branch regardless */ }
              events.emit({ type: 'narration', agent: 'architect', text: prNote, ts: Date.now() });
            }
          } else if (githubPrMode() && prClient && repoNameRef) {
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
      // P-ARCH+.3 — fold the optional blueprint step's tokens into the charge with the SAME markup as
      // every other v3.0 call, so NavBharatAI never eats that cost when the build succeeds. It's added
      // BEFORE the zeroing below, so a failed/free build (which bills ₹0) correctly doesn't charge for
      // the blueprint either — consistent with the rest of the build's billing policy.
      let effectiveBilledUsd = result.billedUsd
        + billedAmountUsd({ inputTokens: blueprintUsage.inputTokens, outputTokens: blueprintUsage.outputTokens }, powerLevelReq);
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

      // P-PE.6 — Prompt audit trail: one durable record per build capturing the EXACT prompt context
      // (version, intent, model, task type, outcome + the system-prompt head) for prompt-engineering
      // traceability. Best-effort — never blocks the build.
      savePromptAudit(userId, buildPromptAudit({
        ts: Date.now(),
        promptVersion: architectPromptVersion,
        intentLabel: String(intent),
        model,
        taskType: analysis?.taskType ?? 'unknown',
        ok: result.ok,
        systemPrompt: architectSystem,
      })).catch(() => {});

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
        // The "latest" and the bounded per-workspace HISTORY writes are independent Firestore docs —
        // run them concurrently (both best-effort) instead of two sequential round trips on the result path.
        await Promise.all([
          saveDiagnostics(workspaceId, diagnostics).catch(() => {}),
          saveDiagnosticsHistory(workspaceId, diagnostics).catch(() => {}),
          // Durable per-USER "latest report" — retrievable by userId alone across cold starts / new
          // sessions, so the "Build report" never vanishes even when the client's workspaceId changed.
          saveLatestForUser(userId, diagnostics).catch(() => {}),
        ]);
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
      // SOFTWARE PROJECT MODE (SPM-2): a successful MODULE turn with plan modules still buildable
      // marks the result `resumable`, so the existing Layer-3 client auto-continue drives the next
      // module without the user typing "continue". Only on ok (a failed module stops the loop for
      // an explicit user decision) and only when the plan can actually advance (never on blocked).
      const projectContinue = projectPlanRef && result.ok && !planComplete(projectPlanRef) && nextBuildableModule(projectPlanRef)
        ? { resumable: true, planRemaining: projectPlanRef.modules.filter((m) => m.status !== 'done').length }
        : {};
      emit({ type: 'result', ...result, ...projectContinue, billedUsd: effectiveBilledUsd, billedInr: Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100, ...(totalTokens > 0 ? { tokens: totalTokens } : {}), ...(diagnostics ? { diagnostics } : {}) });
    } catch (err) {
      // Capture the crash in the diagnostics report too. NOTE: onUpdate only refreshes the per-instance
      // in-memory cache (lastDiagnostics) — it does NOT write to Firestore on every tick — so a crash
      // must explicitly durable-save here, or this report is lost the moment the instance recycles
      // (exactly the "empty build report" DiagnosticsStore.ts exists to prevent, but this path missed it).
      try {
        buildDiagRef?.record({ phase: 'build', severity: 'error', code: 'BUILD_EXCEPTION', message: err instanceof Error ? err.message : String(err), autoResolved: false });
        buildDiagRef?.finish(false);
        const crashReport = buildDiagRef?.report();
        if (crashReport) {
          lastDiagnostics.set(buildKey, crashReport);
          saveDiagnostics(workspaceId, crashReport).catch(() => {});
          saveDiagnosticsHistory(workspaceId, crashReport).catch(() => {});
          // Durable per-USER "latest report" so even a crashed build's report is retrievable by userId
          // alone (across cold starts / new sessions) — the whole point of "gayab na ho".
          saveLatestForUser(userId, crashReport).catch(() => {});
        }
      } catch { /* diagnostics are best-effort */ }
      // Same durable-file-save guarantee as the deadline-timeout path: a crash mid-build must not
      // strand whatever files WERE captured behind only the flaky fire-and-forget 3s debounce. In its
      // own try/catch — `writtenFiles` may not be declared yet if the crash happened very early (before
      // any file was written), which would throw a ReferenceError here and must not block the error emit.
      try {
        if (writtenFiles.size > 0) {
          saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)).catch(() => {});
        }
      } catch { /* writtenFiles not yet in scope (crash before any write), or save failed — best-effort */ }
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
      // SPEED (flag-gated) — remember THIS workspace's now-warm sandbox (built app + node_modules +
      // dev server) so the next build for the same session resumes it instead of a cold create. Recorded
      // at the END so the id reflects the final warm sandbox. Best-effort + bounded; only when enabled.
      if (sandboxResumeEnabled()) {
        try {
          const sbId = await raceTimeout(actuator.getSandboxId(workspaceId), 5_000, 'getSandboxId').catch(() => null);
          if (sbId) await sandboxStore.record(workspaceId, userId, sbId);
        } catch { /* best-effort — never affects the build */ }
      }
      // A zip/GitHub import's background preview boot must finish BEFORE the response ends — Cloud
      // Run throttles CPU after the stream closes, which would silently kill npm install mid-way.
      // Bounded + best-effort. The cap covers a HEAVY full-stack app: up to ~130s to provision a
      // local Postgres + ~240s to install & boot the dev server. Even if this is cut off, the DB +
      // dev .env are already set up in the sandbox, so the Diagnose button (a manual re-boot)
      // succeeds afterwards.
      if (importPreviewBoot) {
        await raceTimeout(importPreviewBoot, 380_000, 'importPreviewBoot').catch(() => {});
      }
      // ETERNAL SESSIONS: persist this turn's evidence layer (shared closure, delta-cursored —
      // also called by the hard-deadline finalizer whose builds never reach this finally). Runs
      // BEFORE the stream ends so Cloud Run cannot throttle the write away.
      await persistSessionTimeline();
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
