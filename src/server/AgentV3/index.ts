// AgentV3 (Vargen 3.0) — public surface for the v5.0 agent engine.
//
// P0 ships the type vocabulary, the event spine (AgentEventStream), the state
// container (WorkspaceState), and the feature flag. The native tool-use build
// loop and the multi-agent team (Orchestrator/SubAgentRunner/ToolCatalog) land
// in P1+. See NAVBHARATAI_PRO_V3_DESIGN.md.

export * from './types';
export { AgentEventStream } from './AgentEventStream';
export type { AgentEventListener } from './AgentEventStream';
export { WorkspaceState } from './WorkspaceState';
export {
  isAgentV3Enabled,
  isAgentV3GloballyEnabled,
  agentV3Allowlist,
  agentV3FreeList,
  isAgentV3FreeUser,
  isAgentV3PaidPublicEnabled,
  isAgentV3CreditGateEnabled,
  costRoutingEnabled,
  costRoutingActiveFor,
  buildRequiresSignIn,
} from './featureFlag';
export { decideAffordability } from './Affordability';
export type { AffordabilityAction, AffordabilityInput, AffordabilityDecision } from './Affordability';
export { estimateBuildTokens, estimateBuildCost } from './PreflightEstimate';
export type { EstimatedUsage, PreflightEstimate } from './PreflightEstimate';
export { readWalletBalanceInr, firestoreWalletReader } from './WalletBalance';
export type { WalletReader, WalletDocData } from './WalletBalance';
export { decidePaidGate } from './PaidGate';
export type { PaidGateInput } from './PaidGate';
export { ClaudeClient, parseMessage, isRetryableError, sanitizeApiKey } from './ClaudeClient';
export type {
  ClaudeToolDef,
  ToolUse,
  TurnUsage,
  TurnResult,
  RetryOptions,
  RunTurnParams,
  TurnRunner,
  MessagesCreateClient,
} from './ClaudeClient';
export { AgentRunner } from './AgentRunner';
export type { AgentRunnerOptions, AgentRunResult } from './AgentRunner';
export { resolveModel, sonnetModel, opusModel, haikuModel, fastBuildModel, opusNormalModel, ladderModel } from './models';
export { toPowerLevel, powerSpec, type PowerLevel, type ClaudeEffort, type PowerSpec } from './powerLevel';
export type { ClaudeLadderTier } from './models';
export { architectSystemPrompt, planSystemPrompt, editModePrefix, dateContextBlock, LANGUAGE_RULE } from './systemPrompt';
export { awaitApproval, resolveApproval, pendingApprovalCount } from './Approvals';
export {
  NORMAL_MULTIPLIER,
  SONNET_MULTIPLIER,
  OPUS_MULTIPLIER,
  POWER_MULTIPLIER,
  opusRate,
  sonnetRate,
  opusEquivalentUsd,
  sonnetEquivalentUsd,
  billedForTier,
  billedAmountUsd,
  billedAmountInr,
} from './pricing';
export type { BilledUsage, TokenRate, BillingTier } from './pricing';
export { defaultToolCatalog, CATALOG_TOOL_NAMES, taskToolDef, secondOpinionToolDef, consensusToolDef, catalogForTools } from './ToolCatalog';
export { ToolDispatcher, ALWAYS_WRITE_SECRETS } from './ToolDispatcher';
export type { ActuatorPort, ToolResult, SubAgentSpawn } from './ToolDispatcher';
export { makeSecondOpinion } from './SecondOpinion';
export type { SecondOpinion, OpinionRouter } from './SecondOpinion';
export { makeConsensus, synthesizeConsensus } from './Consensus';
export type { Consensus, Perspective } from './Consensus';
export { makeWebSearch, WebSearch, formatSearchResults, parseDuckDuckGo } from './WebSearch';
export type { WebSearchFn, SearchResult } from './WebSearch';
export { makeDeploy, FirebaseHostingDeployer, makeChannelId } from './Deployment';
export type { DeployFn } from './Deployment';
export { GitHubAppClient, githubConfigFromEnv, githubStorageEnabled, githubStorageActive, repoNameForProject, readableAppNameForRepo } from './GitHubAppClient';
export type { GitHubConfig, RepoInfo, CiVerdict, PullRequestInfo } from './GitHubAppClient';
export { GitRepoSync, sanitizeRepoUrl } from './GitRepoSync';
export type { HydrateResult, PushResult } from './GitRepoSync';
export { mergeViaPullRequest, githubPrMode, planRevert } from './GitHubPrFlow';
export type { PrCapableClient, PrFlowResult, PrFlowOptions, RevertPlan } from './GitHubPrFlow';
export { UserGitHubClient } from './UserGitHubClient';
export { parseGitHubRepo, resolveStorageTarget, ownRepoStorageEnabled, WORK_BRANCH } from './GitStorageTarget';
export type { StorageTarget, OwnRepoTarget, MirrorTarget, ResolveStorageTargetInput } from './GitStorageTarget';
export { perWorkspaceLockEnabled, maxConcurrentBuilds, buildLockKey, countActiveBuildsForUser, acquireDecision, buildKeyCandidates, workspaceSessionsMatch, MAX_CONCURRENT_BUILDS_DEFAULT } from './BuildConcurrency';
export type { AcquireResult } from './BuildConcurrency';
export { emptyQueue, enqueue, claimNext, completeRunning, cancelItem, reorderPending, pendingItems, runningItem, queueSummary, MAX_QUEUE_ITEMS } from './BuildQueue';
export { parseChatRole, roleSystemPrompt, parseProposedSteps, stripStepsBlock, selectRoleContextFiles, formatRoleContext } from './RoleChats';
export type { ChatRole } from './RoleChats';
export type { CommandQueue, QueueItem, QueueItemStatus, QueueItemSource, EnqueueResult, ClaimResult } from './BuildQueue';
export { roleConfig, isWorkerRole, WORKER_ROLES, allRoles, findRolesByCapability, rolesByLayer, rosterBriefing } from './AgentRegistry';
export type { RoleConfig } from './AgentRegistry';
export { agentLifecycle } from './AgentLifecycle';
export type { AgentHealth, AgentPhase, RunToken } from './AgentLifecycle';
export { WorkspaceMemory, getWorkspaceMemory, extractFacts, warmIndexFiles } from './WorkspaceMemory';
export type { ProjectGraph, SymbolInfo, Episode, MemorySnapshot, RecallHit } from './WorkspaceMemory';
export { analyzeArchitecture, architectureSummary, resolveLocalImport } from './ArchitectureAnalysis';
export type { ArchitectureReport } from './ArchitectureAnalysis';
export { scanSecurity, securitySummary } from './SecurityAnalysis';
export type { SecurityFinding, Severity } from './SecurityAnalysis';
export { scanAuthenticity, authenticitySummary } from './AuthenticityAnalysis';
export type { AuthenticityIssue, AuthenticitySeverity } from './AuthenticityAnalysis';
export { scanAccessibility, accessibilitySummary } from './AccessibilityAnalysis';
export type { AccessibilityIssue, AccessibilitySeverity } from './AccessibilityAnalysis';
export { scanObservability, observabilitySummary } from './ObservabilityAnalysis';
export type { ObservabilityIssue, ObservabilitySeverity } from './ObservabilityAnalysis';
export { injectHealthEndpoint, injectErrorHandler, injectObservabilityFixes } from './ObservabilityInjector';
export type { HealthInjectionResult, ObservabilityInjectionResult } from './ObservabilityInjector';
export { scanGracefulShutdown, gracefulShutdownSummary } from './GracefulShutdownAnalysis';
export type { ShutdownIssue, ShutdownSeverity } from './GracefulShutdownAnalysis';
export { scanSecurityHeaders, securityHeadersSummary } from './SecurityHeadersAnalysis';
export type { SecurityHeaderIssue, SecurityHeaderSeverity } from './SecurityHeadersAnalysis';
export { scanSri, scanProjectSri, sriSummary } from './SriAnalysis';
export type { SriIssue } from './SriAnalysis';
export { scanCsp, scanProjectCsp, cspSummary } from './CspMetaAnalysis';
export type { CspIssue } from './CspMetaAnalysis';
export { scanCommentLanguage, scanProjectCommentLanguage, commentLanguageSummary } from './CommentLanguageAnalysis';
export type { CommentLanguageIssue } from './CommentLanguageAnalysis';
export { scanUploadValidation, scanProjectUploadValidation, uploadValidationSummary } from './UploadValidationAnalysis';
export type { UploadValidationIssue } from './UploadValidationAnalysis';
export { analyzeDependencies, dependencySummary, normalizeImportToPackage } from './DependencyAnalysis';
export type { DependencyIssue, DependencySeverity } from './DependencyAnalysis';
export { extractEnvRefs, parseEnvKeys, analyzeEnvVars, envVarSummary } from './EnvVarAnalysis';
export type { EnvVarIssue } from './EnvVarAnalysis';
export { assessReadiness, readinessVerdict } from './Readiness';
export type { ReadinessReport } from './Readiness';
export { reflectOnBuild, reflectionNote } from './Reflection';
export type { BuildReflection } from './Reflection';
export { summarizeProject, projectSummaryNote } from './ProjectSummary';
export { formatRecalledLessons } from './RecalledLessons';
export { detectLanguageHint } from './LanguageDetect';
export type { LanguageHint } from './LanguageDetect';
export { makeSubAgentSpawn } from './SubAgent';
export type { SubAgentDeps } from './SubAgent';
export { GitManager } from './GitManager';
export type { Checkpointer, CommandRunner } from './GitManager';
export { registerSession, getSession, restoreSession, restoreSessionDetailed, gitStatusForSession, execInSession, ptyHostForSession, sessionCount } from './WorkspaceRegistry';
export type { WorkspaceSession } from './WorkspaceRegistry';
export { classifyIntent, classifyIntentWithConfidence, classifyIntentSmart } from './IntentClassifier';
export type { BuildIntent, IntentWithConfidence } from './IntentClassifier';
export { decidePlanning } from './ComplexityClassifier';
export type { PlanningDecision } from './ComplexityClassifier';
export { analyzeRequest } from './RequestAnalyser';
export type { AnalyserInput, AnalysisResult, StartTier, TaskType } from './RequestAnalyser';
export { reviewEdit, formatReviewResult } from './PostEditReviewer';
export type { PostEditReview } from './PostEditReviewer';
export { reviewBuild, formatReview } from './ReviewerAgent';
export type { ReviewResult, ReviewIssue } from './ReviewerAgent';
export { saveWorkspaceMemory, loadWorkspaceMemory, restoreWorkspaceMemory } from './FirestoreWorkspaceMemoryStore';
export { getEmbeddingStore, _clearEmbeddingStores } from './EmbeddingSearch';
export type { EmbeddingEntry } from './EmbeddingSearch';
export { analyzeWithAST } from './ASTAnalyzer';
export type { ASTFacts, ASTSymbolInfo, ASTImport } from './ASTAnalyzer';
export { renameSymbol, addComponentProp } from './CodemodeExecutor';
export type { CodemodeResult, CodemodeChange, CodemodeFile } from './CodemodeExecutor';

import { AGENTV3_PHASE } from './types';

export interface AgentV3Status {
  phase: typeof AGENTV3_PHASE;
  /** False until the native build loop ships (P1). Honest: not usable yet. */
  ready: boolean;
  /** The surfaces v5.0 merges into one synced engine (§3.2). */
  surfaces: string[];
  note: string;
}

/**
 * Honest engine status. Reflects the real phase of the v5.0 engine.
 */
export function agentV3Status(): AgentV3Status {
  return {
    phase: AGENTV3_PHASE,
    ready: true,
    surfaces: ['preview', 'ide', 'files', 'git', 'history'],
    note:
      'AgentV3 P3 is live: native tool-use build loop, multi-provider routing ' +
      '(Vertex→Gemini→Claude), E2B sandbox, auto-fix loop, readiness gate, ' +
      'and 0.0.0.0 dev-server binding. Real builds operational.',
  };
}
