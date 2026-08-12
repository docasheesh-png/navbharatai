import type { Express, Request, Response } from 'express';
import { buildRateLimiter, workspaceRateLimiter, inbrowserPreviewRateLimiter, previewPollRateLimiter, shellInputRateLimiter, verifyFirebaseToken, verifyFirebaseIdentity, verifyFirebaseIdentityDiag, resolveVerifiedEmail, resolveVerifiedName, enforceNotBanned } from '../lib/authMiddleware';
import { SESSION_ID_RE, verifiedIdentity, ANON_WORKSPACE_PREFIX } from '../lib/identityPolicy';
import { redactProviderError } from '../lib/providerRedaction';
import { analyzeRequirementGaps, renderRequirementGaps, shouldSurfaceRequirementGaps, buildRequirementGuidance } from '../lib/RequirementGapAnalyzer';
import { partitionFrontendBackend, partitionSummary } from '../AgentV3/frontendBackendPartition';
import { dedupeSameModuleImports } from '../AgentV3/FullStackGuards';
import { goldenScaffoldForPrompt, goldenScaffoldFiles } from '../AgentV3/goldenScaffolds/registry';
import { projectContractCard, declaredPackagesFromPackageJson } from '../AgentV3/projectContractCard';
import { deriveInvariants, renderInvariants, checkInvariants, invariantSummary } from '../AgentV3/architectureInvariants';
import { fileBudgetForPrompt, overBudgetNote } from '../AgentV3/fileBudget';
import { analyzeHooksRules, hooksRepairInstruction } from '../AgentV3/HooksRulesAnalysis';
import { dedupeDuplicateImports } from '../AgentV3/DuplicateImportGuard';
import { parallelBuildEnabled, lockedActuator } from '../AgentV3/parallelBuild';
import { PathWriteLock } from '../AgentV3/pathWriteLock';
import {
  isAgentV3Enabled,
  agentV3Status,
  AgentEventStream,
  WorkspaceState,
  ToolDispatcher,
  ALWAYS_WRITE_SECRETS,
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
  type AgentEvent,
  resolveModel,
  toPowerLevel,
  powerSpec,
  type PowerLevel,
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
  readableAppNameForRepo,
  resolveStorageTarget,
  ownRepoStorageEnabled,
  parseGitHubRepo,
  WORK_BRANCH,
  perWorkspaceLockEnabled,
  maxConcurrentBuilds,
  buildLockKey,
  countActiveBuildsForUser,
  acquireDecision,
  buildKeyCandidates,
  workspaceSessionsMatch,
  type RepoInfo,
  type PrCapableClient,
  type OwnRepoTarget,
  registerSession,
  restoreSession,
  restoreSessionDetailed,
  gitStatusForSession,
  execInSession,
  getSession,
  ptyHostForSession,
  agentLifecycle,
  getWorkspaceMemory,
  warmIndexFiles,
  reflectOnBuild,
  reflectionNote,
  summarizeProject,
  formatRecalledLessons,
  detectLanguageHint,
  classifyIntent,
  isAgentV3FreeUser,
  isAgentV3PaidPublicEnabled,
  isAgentV3CreditGateEnabled,
  costRoutingActiveFor,
  buildRequiresSignIn,
  estimateBuildCost,
  readWalletBalanceInr,
  firestoreWalletReader,
  decidePaidGate,
} from '../AgentV3';
// ADMIN-SDK binding (bypasses rules) — getDb() here feeds only the wallet read/debit money path.
import { getServerDb as getDb } from '../lib/serverDb';
import { randomUUID } from 'crypto';
import { getConnection } from '../lib/supabaseConnectionStore';
import { provisionDatabaseForUser } from '../lib/supabaseProvisionFlow';
import { databaseReadiness } from '../AgentV3/databaseNeed';
import {
  extractPageRoutes, pageCheckScript, parsePageCheck, summarizePageCheck, PAGE_LOAD_TIMEOUT_MS,
  a11yIssueCount, slowRouteCount,
} from '../AgentV3/PageRouteCheck';
import {
  deriveJourneys, journeyScript, parseJourneyResults, summarizeJourneys, noJourneyReason,
  JOURNEY_TIMEOUT_MS,
} from '../AgentV3/journeyDerivation';
import { releaseGate, releaseGateSummary, type RuntimeEvidence, type QualitySignals } from '../AgentV3/releaseGate';
import { auditSummaryClaims, claimCorrection, claimAuditSummary } from '../AgentV3/claimAudit';
import { reviewerShouldWrite, toReviewSuggestions, reviewSuggestionSummary, reviewSuggestionCard } from '../AgentV3/greenReviewPolicy';
import { scaffoldFilesInTscErrors, canonicalScaffold } from '../AgentV3/scaffoldBoilerplate';
import { greenFreezeEnabled, latchGreen, clearGreenLatch, isGreenLatched, runInPass, setGreenFreezeObserver } from '../AgentV3/greenFreeze';
import { verifyAfterFix, verifyAfterFixEnabled, verifyAfterFixNote } from '../AgentV3/verifyAfterFix';
import { provisionPathSummary } from '../AgentV3/sandbox/dbProvisionVerify';
import { ALL_DB_ENV_VARS, dbProvider } from '../../lib/dbProviders';
import { loadQueue, mutateQueue } from '../AgentV3/BuildQueueStore';
import { parseChatRole, roleSystemPrompt, parseProposedSteps, stripStepsBlock, selectRoleContextFiles, formatRoleContext } from '../AgentV3/RoleChats';
import { summarizeFileTree } from '../AgentV3/systemPrompt';
import { weakBuildDisciplineBlock } from '../AgentV3/weakBuildDiscipline';
import { pickPaletteForPrompt, palettePromptBlock } from '../AgentV3/designPresets';
import { deadlinePauseMessage } from '../AgentV3/DeadlinePause';
import { flushDecision } from '../AgentV3/DurableFlush';
import { enqueue as enqueueCommand, cancelItem as cancelQueueItem, claimNext as claimNextQueued, completeRunning as completeQueuedRunning, pendingItems as pendingQueueItems, runningItem as runningQueueItem, queueSummary, type QueueItem, type QueueItemSource } from '../AgentV3/BuildQueue';
import {
  InMemoryConversationStore,
  deriveTitle,
  upsertConversationTurn,
  type ConversationStore,
} from '../AgentV3/ConversationStore';
import { createTimelineRecorder, sessionRecallContextLine } from '../AgentV3/SessionTimeline';
import { isZipAttachment, extractZipProject, validateImportedProject, droppedDetailNote, importAccountingLine, envTemplateNote, findUnresolvedLocalImports, fixMispathLocalImports, shouldRetryImportAnonymously, detectFrameworkFromWorkspace, checkFrameworkCoherence, frameworkCoherenceGuidance } from '../AgentV3/ProjectImport';
import { fetchGithubRepoZip, type ZipFetchReason } from '../AgentV3/GithubZipFetch';
import { fetchRepoTree, fetchRepoTextFile, summarizeRepoTree, pickSurveyFiles, materializeRepoViaApi } from '../AgentV3/GithubApiTree';
import { importFailureNarration, importFailureModelReason } from '../AgentV3/importDiagnostics';
import { generateMissingCssModules } from '../AgentV3/CssModuleGenerator';
import { missingViteEnvTypes, viteEnvTypesNote } from '../AgentV3/viteEnvTypes';
import { generateMissingBarrels } from '../AgentV3/BarrelGenerator';
import { detectNeedsDatabase, envVarNames, mergeDevEnvContent, externalServiceNote, conjurableSecrets, detectDatabaseProvider, persistentDatabaseAdvisory, externalSecretVars, previewBootFailureAdvisory, previewServeNarration, halfBootCause, detectMigrationCommand, shellEnvAssignment, schemaMissingFromLog } from '../AgentV3/ImportPreview';
import { decideGreenGuard, restorePlan, greenGuardMessage, greenWorkspaceKey, greenGuardEnabled, buildRemoveCommand, attemptWorkspaceKey, wantsAttemptBack, attemptRestoredMessage } from '../AgentV3/GreenGuard';
import { pickCheckRoutes, buildFingerprint, regressedRoutes, regressionMessage, encodeFingerprint, decodeFingerprint, fingerprintWorkspaceKey, routeFingerprintEnabled } from '../AgentV3/RouteFingerprint';
import { resetHealLedger, healRepeats, healRepeatMessage } from '../AgentV3/HealLedger';
import { analyzeDbCoupledBoot, dbCoupledBootFixInstruction, dbCoupledBootFixOffer } from '../AgentV3/DbCoupledBootAnalysis';
import { languageInstruction } from '../AgentV3/IndicLanguage';
import { countEditableSourceFiles } from '../AgentV3/fileClassification';
import { FirestoreConversationStore } from '../AgentV3/FirestoreConversationStore';
import type { IEngineerActuator } from '../AgentV3/sandbox/EngineerAI/actuators/IEngineerActuator';
import { userCostStore } from '../lib/UserCostStore';
import { debitWalletForBuild } from '../lib/walletDebit';
import { notifyBuildComplete, notifyLowBalance } from '../lib/PushNotificationService';
import { freeTierCheapEnabled, isFreeTierBuild, isFreeTierUser, freeTierUpsellMessage, powerModeBlockedForFreeUser, powerModePaidOnlyMessage, type FreeTierWallet } from '../AgentV3/FreeTierBuildRouting';
import { clampPowerForUser } from '../AgentV3/powerGating';
import { weakTierWelcomeNotice, weakTierBuildFailedNotice } from '../AgentV3/weakTierNotice';
import { detectAppRequirements, unconfiguredRequirements, appRequirementsNotice } from '../AgentV3/AppRequirements';
import { credentialGuardEnabled, credentialGuardInstruction, findBootKillingEnvGuards, bootKillingGuardSummary, bootKillerRepairInstruction } from '../AgentV3/missingCredentialGuard';
import { inrToWalletTokens } from '../lib/payments';
import { onboardingCreditStore, freeOnboardingLimit } from '../lib/OnboardingCreditStore';
import { usdInrRate } from '../lib/UsdInrRate';
import { makeResilientTurnRunner } from './agentv3Resilient';
import { GoogleGenAI } from '@google/genai';
import { scanGeneratedCode, formatCodeScanReport } from '../AgentV3/CodeSafetyScanner';
import { GeminiToolRunner, type GeminiGenAiClient } from '../AgentV3/providers/GeminiToolRunner';
import { makeMultiProviderTurnRunner, forceModelRunner, sizeGatedRunner, pacedRunner, type NamedRunner } from '../AgentV3/providers/MultiProviderTurnRunner';
import { OpenAiToolRunner, type OpenAiChatClient } from '../AgentV3/providers/OpenAiToolRunner';
import {
  openShell,
  readShell,
  subscribeShell,
  writeShell,
  resizeShell,
  closeShell,
  getShell,
  MAX_SHELLS_PER_WORKSPACE,
} from '../AgentV3/ShellSessions';
import { BuildDiagnostics, renderDiagnosticsText, renderSessionDiagnosticsText, capSessionReports, userFacingReport, importTurnObservation, type BuildDiagnosticsReport } from '../AgentV3/BuildDiagnostics';
import { deployBackendToRender, resolveRenderKey, renderRequirement } from '../AgentV3/renderDeploy';
import { buildBuildManifest, deliveredModelId, signManifest } from '../AgentV3/BuildManifest';
import { enterNoClaudeZone } from '../AgentV3/noClaudeZone';
import { findSyntaxErrors, syntaxRepairInstruction } from '../AgentV3/SyntaxCheck';
import { analyzeImportExports, exportRegenTargets, exportRegenInstruction, findCircularDependencies, findUnusedDependencies, type ExportRegenTarget } from '../AgentV3/ImportExportAnalysis';
import { detectBackendPresence } from '../AgentV3/BackendPresence';
import { resolveFrameworkSelection } from '../AgentV3/PromptFramework';
import { computePromptHash, reportMatchesActiveBuild, hasActiveBuildExpectation, type ActiveBuildExpectation } from '../AgentV3/buildIdentity';
import { pickerItems } from '../../lib/reportPicker';
import { analyzeSpaFallback, spaFallbackSnippet } from '../AgentV3/SpaFallbackAnalysis';
import { shouldAutoScaffoldE2e, e2eAutoScaffoldNote } from '../AgentV3/e2eAutoScaffold';
import { findAuthFlow, buildAuthFlowSpec, AUTH_SPEC_PATH } from '../AgentV3/authFlowSpec';
import { planE2eScaffold } from '../AgentV3/e2eScaffold';
import {
  planSmokeChecks, classifySmokeStatus, summarizeSmoke, smokeCurlCommand, parseCurlStatus,
  type SmokePlan, type SmokeResult,
} from '../AgentV3/RouteSmokeCheck';
import { classifyBuildOutcome } from '../AgentV3/BuildOutcome';
import { auditConnectedProject } from '../AgentV3/ConnectAudit';
import { runOneShot, classifyForOneShot, classifyForSimpleLane, oneShotEnabled, oneShotStillViable, parseFileBlocks } from '../AgentV3/OneShotBuilder';
import { shouldContinue, continuationPrompt, joinContinuation, unterminatedTailPath, isTruncatedStop, MAX_CONTINUATIONS } from '../AgentV3/FastLaneContinuation';
import { runSimpleBuild, repairSystemPrompt, repairUserPrompt, manifestSystemPrompt, manifestUserPrompt, parseFileManifest, contractSystemPrompt, contractUserPrompt, blueprintAdvisoryBlock, cssBraceImbalance, type RepairStrategy } from '../AgentV3/SimpleBuilder';
import { analyzeProjectIntegrity, integrityRepairInstruction, injectGlobalStylesheetImport, normalizeImportSpecifiers } from '../AgentV3/ProjectIntegrityChecks';
import { redactCredentialLogs } from '../AgentV3/credentialLogRedaction';
import { hasTscErrors, looksLikeTscHelpOutput } from '../AgentV3/TscGate';
import { judgeBuild, judgeRepairPrompt, type JudgeRunTurn } from '../AgentV3/BuildJudge';
import { nextReviewAction, selectReviewer, cheapBounceCap } from '../AgentV3/CheapFloorReview';
import { buildLessonFromDiagnostics } from '../AgentV3/BuildLessons';
import { buildProjectContext, buildRunningSummary, formatPlanState, parsePlanState } from '../AgentV3/ProjectContext';
import { computePlanProgress } from '../AgentV3/PlanProgress';
// Software Project Mode (SPM-2) — module-decomposed mega-builds, flag-gated AGENTV3_PROJECT_MODE=on.
import { projectModeEnabled, detectMegaProject, isContinuationMessage, parsePlannedModules, createProjectPlan, nextBuildableModule, planComplete, planBlockedReason, markModuleStatus, planProgressLine, projectPlanTodos, moduleBuildContext, projectPlanSystemPrompt, projectPlanUserPrompt, coordinatorDigest, MIN_PROJECT_MODULES, type ProjectPlan, type ProjectModule } from '../AgentV3/ProjectPlan';
import { coordinateBeforeTurn, applyReplan, replanSystemPrompt, replanUserPrompt, LLM_REPLAN_THRESHOLD } from '../AgentV3/ProjectCoordinator';
import { saveProjectPlan, loadProjectPlan, deleteProjectPlan } from '../AgentV3/ProjectPlanStore';
import { withTimeout, mapWithConcurrency } from '../AgentV3/asyncUtils';
import { analyzePreviewHtml, buildPreviewRepairPrompt } from '../AgentV3/PreviewVerify';
import { checkFeaturePresence, featurePresenceSummary, featurePresenceRepairPrompt, featureHealEnabled } from '../AgentV3/FeaturePresence';
import { detectTestPlan, parseTestOutcome, vaccineEnabled, testOutcomeRepairPrompt, suitePresentButRunnerMissing } from '../AgentV3/testRunner';
import { generateFuzzPlan, interpretFuzzErrors, fuzzSummary, fuzzRepairPrompt, redTeamEnabled, type FuzzInput, type FuzzCase, type FuzzVerdict } from '../AgentV3/FuzzProbe';
import { billedAmountUsd, sonnetEquivalentUsd, powerToTier, type BillingPowerLevel } from '../AgentV3/pricing';
import { tieredMarkupUsd, realProviderCostUsd } from '../AgentV3/providerRates';
import { createUsageSink } from '../AgentV3/UsageSink';
import {
  createProviderUsageLedger,
  reconcileWithSink,
  perTierBilledUsd,
  providerBaselineCostUsd,
} from '../AgentV3/ProviderUsageLedger';
import OpenAI from 'openai';
import type { TurnRunner } from '../AgentV3/ClaudeClient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { redactPII } from '../AgentV3/SecretRedactor';
import { audit } from '../lib/audit';
import { notePersistenceFailure, persistenceHealth } from '../lib/persistenceHealth';
import { userPreferenceStore } from '../AgentV3/UserPreferenceStore';
import { adrStore, renderAdrMarkdown } from '../AgentV3/adrMemory';
import { userLessonBrainStore } from '../AgentV3/UserLessonBrain';
import { mistakeLedgerStore, mistakeKey } from '../AgentV3/MistakeLedger';
import { fleetMistakeLedgerStore } from '../AgentV3/FleetMistakeLedger';
import { LISTENING_PORTS_COMMAND, parseListeningPorts, rankPortCandidates } from '../AgentV3/PortDiscovery';
import { liveChannel, liveEventsAllowedFor } from '../AgentV3/LiveChannel';
import { extractEntities, entityRequirementsContext } from '../AgentV3/EntityExtractor';
import { chatResponseCache, chatCacheEnabled, hashKey } from '../AgentV3/PromptCache';
import { dialoguePhaseContext } from '../AgentV3/DialogueStateManager';
import { registerPrompt } from '../AgentV3/PromptRegistry';
import { buildRetrospective } from '../lib/BuildRetrospectiveEngine';
import { estimateBuildTime, complexityFromPrompt, liveEtaTick } from '../lib/BuildTimeEstimator';
import { resolvePipelineDepth, scaleBuildSeconds, reviewerBudgetMs, reviewGraceMs, type PipelineDepth } from '../AgentV3/PipelineDepth';
import { incrementalBuildCache, hashFiles, computeBuildPlan, buildPlanNarration } from '../AppMakerLab/IncrementalBuildCache';
import { startBuildTrace } from '../telemetry/TracingManager';
import { DecisionTrace, persistDecisionTrace, getDecisionTrace } from '../AgentV3/DecisionTraceManager';
import { planAutoTests } from '../AgentV3/TestGenerationAgent';
import { planAppDefaults, defaultAssetPath } from '../AgentV3/appDefaults';
import { locationTag } from '../AppMakerLab/intelligence/LogIntelligenceEngine';
import { findingsToDebt } from '../AgentV3/engineeringMemory';
import { selectZombieBuilds } from '../AgentV3/buildWatchdog';
import { recordDebt } from '../AppMakerLab/intelligence/TechnicalDebtTracker';
import { estimateTokens, contextUsage } from '../AgentV3/TokenEstimator';
import { buildGroundedContext, contentSearchTerms, selectGroundingCandidates, lastGroundingCost } from '../AgentV3/ContextReranker';
import { groundingProvenance, dominantGroundingBlock } from '../AgentV3/contextBudget';
import { fenceUntrusted } from '../AgentV3/UntrustedContent';
import { autoFixEnabled, reviewerAutoFixEnabled, reviewerWarningAutoFixEnabled, autoFixMaxAttempts, filterActionableErrors, buildRepairPrompt, autoFixWarning, reviewerAutofixOutcome, reviewerFixBudgetMs, reviewerFixShouldRetry, reviewCriticalUnresolvedSummary, releaseGateFailureSummary, runtimeVerifiedRecord, runtimeUncheckedRecord, runtimeErrorsRemainRecord, type RuntimeError } from '../AgentV3/AutoFix';
import { apiTesterHintFor } from '../AgentV3/RuntimeErrorClassify';
/** Hard per-session cost cap (USD). Prevents runaway retry spirals ($26 todo app problem).
 *  Set SESSION_COST_CAP_USD in env to override. Default: $5. */
function sessionCostCapUsd(): number {
  const v = parseFloat(process.env.SESSION_COST_CAP_USD ?? '');
  return Number.isFinite(v) && v > 0 ? v : 5.0;
}
import { deploymentStore, withDeploymentPersistence, isLiveDeployment, type DeploymentRecord } from '../AgentV3/DeploymentStore';
import { sandboxStore, sandboxResumeEnabled } from '../AgentV3/SandboxStore';
import { getDeployProvider, DEFAULT_DEPLOY_PROVIDER, deployProviderStatus } from '../AgentV3/DeployProviders';
import { FirebaseHostingDeployer } from '../AgentV3/Deployment';
import { firebaseCustomDomainsEnabled } from '../lib/firebaseCustomDomain';
import { workspaceHasFirebaseDomain } from '../lib/firebaseDomainLink';
// Side-effect imports: each provider self-registers into the DeployProviders registry on load.
import '../AgentV3/VercelProvider';
import '../AgentV3/NetlifyProvider';
import '../AgentV3/CloudflareProvider';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { planAnalysisSummary } from '../AgentV3/PlanIntelligence';
import { collectWorkspaceFiles, writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { VirtualFileSystem } from '../project/ProjectModel';
import { applyPreviewDomain } from '../AgentV3/PreviewDomain';
import { validateProjectForPreview, devScriptPort, missingPreviewReason, resolveDevRunCommand, classifyDevServerFailure, userFacingPreviewFailure, cleanPreviewLogForUser } from '../AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { buildBuildInstallCommand } from '../AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { loadUserVaultSecrets } from '../lib/secrets';
import { secretRequestPrompt } from '../AgentV3/secretRequest';
import { userDatabaseContext, noDatabaseConnectedContext, DB_PROVIDER_MARKER } from '../AgentV3/userDatabaseContext';
import { userStorageContext } from '../AgentV3/userStorageContext';
import { userAuthContext } from '../AgentV3/userAuthContext';
import { classifyPreviewHealth, previewHealthContextLine } from '../AgentV3/PreviewHealth';
import { findMissingDependencies } from '../AgentV3/DependencyReconciler';
import { ensureViteReactFoundation, sanitizeTsconfigExtends } from '../AgentV3/FrameworkFoundation';
import { TSC_ENSURE, TSC_BIN } from '../AgentV3/tscCommand';
import { renderPreview } from '../runtime/renderPreview';
import { wakePublicState, sanitizeWakeError, type TerminalWakeState } from '../AgentV3/terminalWake';
import { checkPreviewCompiles, previewCompileRepairInstruction, previewDivergenceBlocksDelivery, previewCompileUnresolvedSummary } from '../runtime/PreviewCompileCheck';
import { isReactProject } from '../runtime/ReactPreview';
import { isVueProject } from '../runtime/VuePreview';
import { CREATOR_IDENTITY, recencyDirective, INDIA_TERRITORIAL_INTEGRITY } from '../lib/prompts';
import { liveSearchContext } from '../lib/liveSearchContext';
import { classifyIntentSmart, classifyIntentWithConfidence, wantsFreshStart, isExplicitCompleteBuild } from '../AgentV3/IntentClassifier';
import { decidePlanning } from '../AgentV3/ComplexityClassifier';
import { analyzeRequest, type StartTier, type AnalysisResult } from '../AgentV3/RequestAnalyser';
import { BuildCheckpoint } from '../AgentV3/BuildCheckpoints';
import { agentV3CostTelemetry } from '../AgentV3/AgentV3CostTelemetry';
import { runWithEscalation, type GateVerdict } from '../AgentV3/EscalationOrchestrator';
import { escalationRolloutPercent, inEscalationRollout, escalationCohort } from '../AgentV3/escalationRollout';
import { buildHealthFromDiagnostics } from '../AgentV3/buildHealthCard';
import { backstopHonestyNote, backstopNarration } from '../AgentV3/backstopHonesty';
import { reviewBuild, formatReview, hasReviewableSource, selectAutoFixableWarnings } from '../AgentV3/ReviewerAgent';
import {
  saveWorkspaceMemory,
  restoreWorkspaceMemory,
  loadWorkspaceMemory,
  deleteWorkspaceMemory,
} from '../AgentV3/FirestoreWorkspaceMemoryStore';
import { purgeWorkspace } from '../AgentV3/WorkspaceManager';
import { saveWorkspaceFiles, mergeWorkspaceFiles, loadWorkspaceFiles, removeWorkspaceFiles, purgeWorkspaceFiles, countWorkspaceFiles, listWorkspaceFilePaths, reconcileProjectFileTree, resetWorkspaceFilesForApprovedRebuild, savePlanForFileSet } from '../AgentV3/WorkspaceFileStore';
import { applyWellKnownMissingDeps } from '../AgentV3/DependencyAutoFix';
import { splitCachedSystem } from '../AgentV3/systemPromptCache';
import { saveWorkspaceAssets, materializeAssets, restoreWorkspaceAssets } from '../AgentV3/WorkspaceAssetStore';
import { recordManualEdits, consumeManualEdits, manualEditContext, manualEditNarration } from '../AgentV3/ManualEditTracker';
import { saveCheckpoint, loadCheckpoints, dormantGitStatusFromCheckpoints } from '../AgentV3/CheckpointStore';
import { buildPromptAudit, savePromptAudit } from '../AgentV3/PromptAuditStore';
import { recentBuildHistoryFor, etaBasisNote } from '../AgentV3/etaHistory';
import { sandboxCost, sandboxBillableUsd, sandboxBillingNote } from '../AgentV3/sandboxCost';
import { saveDiagnostics, loadDiagnostics, saveDiagnosticsHistory, upsertDiagnosticsHistoryProgress, listDiagnosticsHistory, getDiagnosticsHistoryItem, saveLatestForUser, loadLatestForUser, compactReportForRecord, redactReportSecrets, deleteDiagnostics } from '../AgentV3/DiagnosticsStore';
import { buildAdminReportRecord, saveAdminBuildReport } from '../AgentV3/AdminBuildReportStore';
import { renderRescueEligible, renderRescueConfirmsSuccess } from '../AgentV3/renderRescue';
import { cssConsistencyError } from '../AgentV3/CssConsistency';
import { analyzeDesignCoverage, designRepairInstruction, designCoverageSummary } from '../AgentV3/DesignCoverage';
import { buildServiceGraph } from '../AgentV3/serviceGraph';
import { detectMonorepo } from '../AgentV3/monorepoAnalysis';
import { unsendKeepCount } from '../AgentV3/unsend';
import { planFileGuardian } from '../AgentV3/FileGuardian';
import { summarizeSession, sessionSummaryLine } from '../AgentV3/sessionSummary';
import { sweepUnusedImports, importSweepEnabled } from '../AgentV3/UnusedImportSweep';
import { looksLikePlatformSource, PLATFORM_SOURCE_REFUSAL } from '../AgentV3/PlatformSourceGuard';
import { ensureViteConfig } from '../AgentV3/ViteConfigGuard';
import { applyVisualTextEdit, applyVisualStyleEdit, applyVisualStyleEdits } from '../AgentV3/VisualEditPatcher';
import { VertexProvider } from '../AI/Router/providers/VertexProvider';
import { GeminiProvider } from '../AI/Router/providers/GeminiProvider';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';

/**
 * AgentV3 (Vargen 3.0) routes.
 *
 * Flag-gated (AGENTV3_ENABLED, default OFF) + allowlist (admin-only now → all
 * logged-in users at GA, D8). The AgentV3 *module* imports nothing from the live
 * Pro/Engineer agent loops; this route is the composition root that wires the
 * v5.0 engine to the shared sandbox actuator (reused infra, not the live loop).
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
// MOVED OUT (2026-08-06) — see routes/actuatorFactory. `routes/zipUpload` needs this and nothing else
// from this file, and importing it dragged in the whole AgentV3 engine: 6.5 SECONDS per import, paid on
// every server boot and responsible for a test that failed at random. Re-exported here so every existing
// importer keeps working AND there is still exactly one actuator per process — two would silently hand a
// session's second message a cold, empty sandbox.
import { buildActuator } from './actuatorFactory';
import { envFlag } from '../lib/envFlag';
import {
  workspaceOwnershipOk as sharedWorkspaceOwnershipOk,
  verifiedWorkspaceReadOk as sharedVerifiedWorkspaceReadOk,
  workspaceIdFor,
  safeWorkspaceUid,
} from '../lib/workspaceIdentity';
import { adminRequestOk } from '../lib/adminAuth';
export { buildActuator };

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
 * SECURITY (T0-9 / Phase-0 identity policy, Tier 1) — the ONLY email an entitlement/billing gate may
 * trust is the VERIFIED token email. A client-claimed `body.email` must grant NOTHING: `isAgentV3FreeUser`
 * and `buildRequiresSignIn` match the free-list/allowlist by EMAIL (case-insensitive), so trusting a
 * claimed email let an UNVERIFIED caller spoof a free-list address (e.g. the admin's) and run
 * billing-exempt builds — and the free-list unlocks the paid power tiers, i.e. FREE Opus on NavBharatAI's
 * account. This is the exact "no token → refuse, never degrade and spend anyway" rule of the admin-approved
 * Phase-0 policy; it supersedes the old Fix-26 claimed-email degrade (a real admin's transient token blip
 * still self-heals — the client force-refreshes its token on the resulting 401 and retries). Pure + tested.
 */
export function entitlementEmail(verified: { email: string | null } | null): string | null {
  return verified ? verified.email : null;
}

/**
 * SECURITY (C1 fast-follow) — verified identity for READ/mutate v5.0 routes that take the caller from
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
 * get-one / delete) were the ONLY v5.0 reads gated on a verified token ALONE. Every OTHER v5.0 route
 * resolves identity as `verifiedUid ?? claimedUid` (workspaceOwnershipOk) — that is how file
 * CONTENTS, memory and the build report all read today. `verifyIdToken` returns null on a TRANSIENT
 * failure for a genuinely signed-in user (a just-expired/again-refreshed token, an admin-SDK
 * cert-fetch hiccup, a cold-start init race). Verified-only then returned userId=null, so the LIST
 * route 400'd (transcripts vanished from History) and the GET route could not build the real
 * `agentv3-{uid}-{sid}` candidate (404) — the client fell back to the session-switch-erased
 * chat_sessions copy and showed "saved copy has 0 messages" on EVERY item, while files/memory stayed
 * fine. The claimed-userId fallback aligns these reads with the rest of v5.0; access is still gated
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
 * so CI/local stay on the in-memory store, matching the cautious v5.0 flag-gating.
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
      const verifiedWs = workspaceIdFor(verifiedUid, sid);
      if (verifiedWs) out.push(verifiedWs);
      out.push(`${ANON_WORKSPACE_PREFIX}${sid}`);
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

/**
 * The terminal ConversationStatus to stamp on the durable record when a build settles — or `undefined` to
 * leave the record's status untouched. Root cause it fixes (build-report + IMG autopsy 2026-08-02): a
 * successful build's durable record was left at status:'running' because `persistSessionTimeline` writes
 * finalState/timeline but NEVER status, and the only status:'complete'/'error' write is the fallback block
 * that is SKIPPED once a runner has already persisted a turn. So a client that dropped before the terminal
 * `result` event reopened to a record with no verdict → the UI showed neither success nor fail nor billing,
 * just "that build isn't running anymore — send your message again". A definitive success → 'complete', a
 * definitive failure → 'error'. A NULL result (a resumable wall-clock pause, or a still-running/hung build
 * whose verdict isn't known yet) returns undefined so the caller leaves status:'running' intact — a
 * resumable pause must never be clobbered into a terminal state (it would block the client auto-continue).
 * Pure + exported for testing.
 */
export function terminalConversationStatus(
  result: { ok: boolean } | null | undefined,
): 'complete' | 'error' | undefined {
  if (!result) return undefined; // no settled verdict → don't clobber a resumable/running record
  return result.ok ? 'complete' : 'error';
}

/** A client-supplied session id must be a safe, bounded token (it becomes part of
 *  the workspace id, which is interpolated into sandbox paths/commands).
 *  The single definition lives in the Phase-0 identity policy module (imported at the top). */

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
  // The rule itself lives in lib/workspaceIdentity (audit finding #2) so the STORE layer and every
  // other route share this exact decision instead of re-typing `agentv3-${uid}-`. Re-exported from
  // here because callers and tests already import it from this module.
  return sharedWorkspaceOwnershipOk(verifiedUid, claimedUid, workspaceId);
}

/**
 * SECURITY Phase 3.2 — STRICTER ownership for PRIVATE READS (build report, decision trace). Unlike
 * `workspaceOwnershipOk` (which allows a claimed-uid fallback so a token-blip user's BUILD never
 * hard-breaks — "app must never break"), a private report READ requires the VERIFIED uid to own a
 * real workspace. The claimed fallback is spoofable: the uid is embedded in the workspaceId, so a
 * token-less caller who learned `agentv3-victim-{sid}` could claim `userId=victim` and pass
 * workspaceOwnershipOk. Reads have no never-break constraint (the client force-refreshes its token
 * and retries), so we can safely demand a verified match. Anon workspaces stay reachable by their
 * unguessable sid (capability model — preserves Fix-26 report/trace access for degraded sessions).
 * PURE + exported + unit-tested.
 */
export function verifiedWorkspaceReadOk(verifiedUid: string | null, workspaceId: string): boolean {
  return sharedVerifiedWorkspaceReadOk(verifiedUid, workspaceId); // see lib/workspaceIdentity
}

async function assertWorkspaceOwner(req: Request, workspaceId: string): Promise<boolean> {
  const verifiedUid = await verifyFirebaseToken(req);
  // Claimed id may come from the JSON body (POST) or the query string (GET).
  const claimedUid =
    (typeof req.body?.userId === 'string' ? req.body.userId : null) ??
    (typeof req.query?.userId === 'string' ? req.query.userId : null);
  return workspaceOwnershipOk(verifiedUid, claimedUid, workspaceId);
}

/**
 * SECURITY (T0-9 convergence, 2026-07-19) — STRICT owner gate for the DESTRUCTIVE writes (exec,
 * delete-files, import-files, visual-edit). Unlike `assertWorkspaceOwner` (which keeps a claimed-uid
 * fallback so a token-blip BUILD never hard-breaks), these highest-stakes operations demand the VERIFIED
 * uid own a real workspace: a token-less caller who merely LEARNED `agentv3-victim-{sid}` can no longer
 * run an arbitrary command or delete files on it by claiming the victim's uid. Anon workspaces stay
 * reachable by their unguessable sid (capability model unchanged), and a legit owner with a transient
 * token blip self-heals (403 → the client refreshes its token and retries — and these are explicit,
 * user-initiated actions, not the automatic build loop). Reuses the tested `verifiedWorkspaceReadOk`
 * (verified-owner-or-anon-capability), so the strict rule is identical to the private-report read gate.
 */
async function assertVerifiedWorkspaceOwner(req: Request, workspaceId: string): Promise<boolean> {
  return verifiedWorkspaceReadOk(await verifyFirebaseToken(req), workspaceId);
}

export function deriveWorkspaceId(userId: string | null, sessionId: unknown): string {
  // An unusable uid becomes the shared-anon bucket rather than a malformed id — that fallback is this
  // builder's own policy; the id SHAPE comes from lib/workspaceIdentity.
  const uid = safeWorkspaceUid(userId) ?? 'anon';
  const session = typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId) ? sessionId : String(Date.now());
  return workspaceIdFor(uid, session) as string; // uid is safe by construction above
}

/**
 * FAIL-SAFE REBUILD GUARD (Fix 27 — report 2026-07-07: "isne pura app wapas banaya. yeh to bilkul
 * accepted nahi hai"). The intent probe (countWorkspaceFiles) FAILS OPEN: a transient Firestore
 * timeout/error yields 0, so an edit turn ("add a share button") on a 46-file imported app kept its
 * `new_build` classification and the complete-app manifest lane REBUILT all 40 files over the user's
 * app. This is the second, independent check on the durable path list: a new_build turn on a
 * workspace that verifiably holds real source files — without an explicit fresh-start or
 * complete-app request — must flip to an EDIT. The destructive rebuild path must never be reachable
 * through an infra hiccup. Pure.
 */
/**
 * Fix 41 (report 2026-07-08) — the instruction injected into the architect prompt when a GitHub-URL
 * import FAILED this turn. Without it the model, seeing an empty workspace and a "survey this repo"
 * ask, replied "I don't see a repository URL in your message — please share it" 15 seconds after the
 * platform itself said "I couldn't clone <url>". This makes the model ACKNOWLEDGE the exact URL and
 * the real reason (private/no-access/bad-url) and tell the user how to grant access — never re-ask
 * for the URL they already gave. Returns '' when no import failed. Pure.
 */
export function failedImportPromptNote(failed: { url: string; reason: string } | null | undefined): string {
  if (!failed || !failed.url) return '';
  return [
    'IMPORTANT — A GITHUB IMPORT WAS ALREADY ATTEMPTED AND FAILED THIS TURN.',
    `The user DID provide a repository URL: ${failed.url}`,
    `The import failed because ${failed.reason}.`,
    'Do NOT ask the user for the repository URL — they already gave it. Acknowledge that this exact',
    'URL could not be accessed, and if it is private tell them to connect the GitHub account that owns',
    'it via ⚙ → GitHub (or double-check the URL). Keep the reply short and do not contradict the',
    'message the platform already showed them. Do NOT clone the repository yourself into a temp',
    'directory and report success — those files would NOT persist into the workspace.',
  ].join('\n');
}

/**
 * INSTANT-CONNECT survey note (admin 2026-07-24). When the GitHub API tree + key files were fetched
 * up-front, give the architect the repo's real structure and key-file contents so it can survey the app
 * IMMEDIATELY — no waiting on the full download/land. Bounded so a huge repo never floods the prompt.
 * Returns '' when there is no instant-connect data. Pure.
 */
export function importSurveyPromptNote(
  survey: { url: string; fileCount: number; structure: string; keyFiles: Record<string, string>; truncated: boolean } | null | undefined,
): string {
  if (!survey || !survey.url) return '';
  const lines = [
    'IMPORTED PROJECT — you are connected to the user\'s GitHub repository and its files are being loaded into the workspace.',
    `Repository: ${survey.url}`,
    `It contains ${survey.fileCount} file(s)${survey.truncated ? ' (large repo — the listing below is partial)' : ''}. Top-level structure: ${survey.structure}.`,
  ];
  const keys = Object.keys(survey.keyFiles);
  if (keys.length > 0) {
    lines.push('', 'Key files (read directly from the repo, for your survey):');
    for (const k of keys) {
      lines.push(`\n----- ${k} -----\n${survey.keyFiles[k]}`);
    }
  }
  lines.push('', 'Use this to give an accurate survey of what the app is and how it is structured. Do not claim you cannot see the repository — you are connected to it.');
  return lines.join('\n');
}

/** The leading marker of the honesty-backstop prefix — used to avoid prepending it twice. */
export const IMPORT_HONESTY_PREFIX_MARK = '⚠️ The GitHub import did not complete';

/**
 * HONESTY BACKSTOP (mitrify autopsy 2026-07-23, rule 5). When a GitHub import FAILED this turn, the
 * user-facing summary must NOT read as an import success — even if the model's prose claims it cloned the
 * repo "successfully". (Real case: the model surveyed a `/tmp` clone that never landed, so the workspace was
 * empty while the summary said "ready for further work".) This prepends the platform's honest verdict so the
 * truth is the FIRST thing the user reads; the model's prose still follows but can no longer stand alone as a
 * false success. Returns '' when no import failed. Pure.
 */
export function importHonestySummaryPrefix(failed: { url: string; reason: string } | null | undefined): string {
  if (!failed || !failed.url) return '';
  return `${IMPORT_HONESTY_PREFIX_MARK} — ${failed.url} could not be imported (${failed.reason}). Your workspace does not contain that repository, so anything below is not a saved import.\n\n———\n`;
}

export function rebuildGuardFlipsToEdit(opts: {
  intent: string;
  isEditMode: boolean;
  durableSourceCount: number;
  freshStart: boolean;
  explicitCompleteBuild: boolean;
}): boolean {
  return !opts.isEditMode && opts.intent === 'new_build' && opts.durableSourceCount > 0
    && !opts.freshStart && !opts.explicitCompleteBuild;
}

/**
 * REBUILD CONFIRMATION GATE (Fix 28 — admin, 2026-07-07: "agar AI rebuild ki koshish kare, to
 * pehle user se puch le"). After the fail-safe guard above, the ONLY way a turn is still
 * rebuild-shaped over a non-empty workspace is an explicit fresh-start / complete-app request —
 * or a wrong call. Either way the app that exists is about to be REPLACED, so the build must
 * pause and ASK (the same permission_request gate plan-mode uses): Approve = rebuild from
 * scratch; Deny (or the 10-min timeout) = keep the app and apply the request as an EDIT. The
 * user can always Stop and type something else — the "other" option. An import turn is exempt
 * (its pipeline forces edit mode and never scaffolds over the imported app). Pure predicate.
 */
export function shouldConfirmRebuild(opts: {
  intent: string;
  isEditMode: boolean;
  hasImportIntent: boolean;
  durableSourceCount: number;
}): boolean {
  return opts.intent === 'new_build' && !opts.isEditMode && !opts.hasImportIntent
    && opts.durableSourceCount > 0;
}

/**
 * BILLING HONESTY (Fix 35 — admin 2026-07-07: "preview theek chal gaya to hi user se paise len").
 * True when an artifact-producing build's live preview was verified by the SERVER'S OWN browser
 * visit as NOT rendering (after the bounded self-heal) — that build is not a delivered app and
 * bills ₹0. Server-side verdict only; a client-reported failure can never zero a bill. Pure.
 */
export function zeroBillForUnrenderedPreview(expectsArtifacts: boolean, previewVerifiedFailed: boolean): boolean {
  return expectsArtifacts === true && previewVerifiedFailed === true;
}

/**
 * "WORKING APP OR FREE" — does a FAILED build get charged? Never.
 *
 * ROOT CAUSE (navbharatai self-import autopsy 2026-07-27, buildId d1623410): the failed-build guard was
 * written as `expectsArtifacts && !result.ok`. `expectsArtifacts` is FALSE on every import/survey turn,
 * so an import turn that genuinely FAILED — this one ended with `OUTCOME_SYNTAX_ERROR` *and*
 * `BUILD_TIMEOUT` after 29 minutes — sailed straight past the guard and was billed (₹19.08 recorded).
 * Meanwhile the user-facing summary said, verbatim, "You have NOT been charged for this build". The
 * report and the message contradicted each other, and the message was the one that was wrong.
 *
 * The guard's INTENT was always "a build that did not succeed is never charged"; only its condition was
 * narrower than its intent. `!ok` is the whole rule — an import turn is still a build the user paid for,
 * and a failed one must be free exactly like any other. A SUCCESSFUL import/survey turn still bills
 * normally (the survey is real delivered work). Only ever REDUCES a charge. PURE + tested.
 */
export function zeroBillForFailedBuild(resultOk: boolean): boolean {
  return resultOk === false;
}

/**
 * Should the post-build INTEGRITY heal (a file-MUTATING LLM pass) run?
 *
 * ROOT CAUSE (mitrify import autopsy 2026-07-24, report fdc35433): the user's prompt was "Import this app …
 * and give me a short survey … **Do not change any files yet**." The engine imported + surveyed correctly,
 * but the integrity heal STILL ran and edited 3 files (an autoFocus focus-conflict fix) — a direct
 * instruction violation. It was the un-gated SIBLING of the C9 reviewer-autofix, which is already skipped on
 * import/survey turns for exactly this reason (`!isImportTurn`, 2026-07-07). Gate the heal on
 * `expectsArtifacts` (= a real new_build/edit turn, never an import/survey turn) so a "do not change" turn
 * only RECORDS the integrity warnings (advisory) and never mutates files. Pure + tested.
 */
/**
 * Is a build that wrote ZERO files actually a FAILURE worth re-running from scratch?
 *
 * WHY THIS EXISTS AT ALL (deep-test App #7): a build that EXPECTED artifacts produced no files because
 * the sandbox could not be set up, and still reported "✓ Done" over an empty preview. Retrying on a
 * stronger model is the right answer to THAT.
 *
 * WHY IT NEEDED NARROWING (Shiv Medical Store report, 2026-08-10): the user asked to "continue from
 * where you left off and finish/fix the build so the app works end-to-end". The agent diagnosed it,
 * started the dev server, published a working preview and finished — writing no files, because NO FILE
 * NEEDED TO CHANGE. That is the CORRECT outcome, and it was classified as an empty build: the entire
 * build re-ran on a second model, roughly doubling a 15.6-minute, ₹567 build for nothing.
 *
 * The distinction is not "did files change" but "is there an app". A NEW build that produced nothing
 * has nothing to show, and an edit on an EMPTY workspace had nothing to edit — both are real failures.
 * An edit on a project that already has files can legitimately finish without touching one: fixing the
 * server, answering a question, diagnosing a problem. Judging that by file count punishes the engine
 * for doing exactly what was asked.
 *
 * Pure + exported for testing.
 */
export function shouldRetryEmptyBuild(opts: {
  expectsArtifacts: boolean;
  filesWritten: number;
  isEditMode: boolean;
  /** Files the project already had when the turn started. */
  existingProjectFiles: number;
  aborted: boolean;
  withinCostCap: boolean;
}): boolean {
  if (!opts.expectsArtifacts || opts.filesWritten > 0 || opts.aborted || !opts.withinCostCap) return false;
  // An edit on a project that already exists may legitimately change nothing.
  if (opts.isEditMode && opts.existingProjectFiles > 0) return false;
  return true;
}

export function shouldRunIntegrityHeal(opts: {
  gateEnabled: boolean;
  resultOk: boolean;
  expectsArtifacts: boolean;
  aborted: boolean;
}): boolean {
  return opts.gateEnabled && opts.resultOk && opts.expectsArtifacts && !opts.aborted;
}

/**
 * EMPTY-BUILD HONESTY (deep-test App #7, 2026-07-13). A build that EXPECTED artifacts (a new build / edit)
 * but produced ZERO files is a FAILURE — never "✓ Done". The App #7 report showed `ok: true` / "Done · 9
 * steps" over an EMPTY preview because the sandbox could not be set up (SANDBOX_UNAVAILABLE), so no file
 * could ever be written, yet the turn still ran the model 29× and reported success. Returns an honest,
 * retry-able summary when the build must be forced to `ok:false`, or null when it produced files / didn't
 * expect any. Pure + exported for testing.
 */
export function emptyBuildFailureSummary(
  expectsArtifacts: boolean,
  fileCount: number,
  sandboxUnavailable: boolean,
): string | null {
  if (!expectsArtifacts) return null;
  // SANDBOX DOWN ⇒ FAILURE regardless of file count (deep-test App #11, 2026-07-14). When the sandbox
  // could not be set up (403 "team is blocked: missing payment method"), EVERY write_file/bash 403'd, so
  // NOTHING was persisted to the sandbox and NOTHING was ever installed/compiled/run. But the per-file
  // generator still recorded 23 in-memory files (flushed only to the durable Firestore store), so
  // `fileCount > 0` was true — and the old `fileCount > 0 → null` guard let the build report ok:true /
  // "READY 100/100" over a preview with ZERO files ("0 file par build health 100%"). A dead sandbox can
  // never have produced a real, runnable, VERIFIED app, so fail unconditionally when it was unavailable.
  if (sandboxUnavailable) {
    return 'The build could not run — the sandbox was unavailable (no files could be created, installed, or verified). Please try again in a moment; you have not been charged.';
  }
  if (fileCount > 0) return null;
  return 'The build produced no files. Please try again — you have not been charged.';
}

/**
 * FINAL-SYNTAX-ERROR HONESTY (sibling of the reviewer-CRITICAL false-success fix, 2026-07-21). The final
 * syntax re-verify catches a LATE repair (endgame / reviewer-autofix) that reintroduced a non-parsing
 * file after the early syntax gate. It already records an UNRESOLVED OUTCOME_SYNTAX_ERROR so the health
 * card can't say READY — but it never flipped the build's `ok` verdict, so a build that WON'T COMPILE
 * could still emit ok:true and be BILLED as success (only the preview-verify path zeroed billing, and
 * only when it actually observed the non-render). An app that does not compile is not a delivered app
 * (the "working app or free" law) — force ok:false with an honest, resumable summary so both exit paths
 * (the deadline finalizer and the normal settle) agree and the failed-build billing guard makes it free.
 * White-label: no provider/model names. Pure + exported for testing.
 */
export function finalSyntaxErrorSummary(fileCount: number): string {
  const n = Math.max(1, fileCount);
  return (
    `Your app is saved, but ${n} file${n === 1 ? '' : 's'} in the final build ${n === 1 ? "doesn't" : "don't"} ` +
    `compile yet — so it isn't runnable. You have NOT been charged for this build. Reply "continue" and I'll finish the fix.`
  );
}

/**
 * The STABLE durable-conversation id for a session's workspace — one conversation record per session,
 * NOT per build/message.
 *
 * THE BUG this fixes: every build minted `conversationId: randomUUID()`, and a single build can spin up
 * to FIVE runners (main + escalation + retry + preview-heal + auto-fix) — so one session's many messages
 * (and even one message's retries) each became a SEPARATE conversation document → the history menu
 * showed every message as its own "chat", and reopening/continuing landed on a fragmented transcript
 * (so v5.0 behaved like a fresh session on each message and couldn't edit coherently). Deriving the id
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
 * U-1 — the LintGate is OFF by default (opt-IN, the opposite of the readiness gate): a build blocks on
 * real ESLint errors only when the admin sets AGENTV3_LINT_GATE=on. Kept a separate canary switch so it
 * can be measured on a few builds before it ever gates everyone (like the escalation rollout).
 */
export function lintGateEnabled(): boolean {
  return envFlag('AGENTV3_LINT_GATE');
}

/**
 * Whether the post-build completeness REVIEWER (a 30-90s+, multi-call pass) should run after a build.
 * Pure + exported so the exact gate is regression-tested (`agentv3.test.ts`).
 *
 * ROOT-CAUSE (autopsy 2026-07-30, build 77bd487b): the reviewer is meant to verify what was BUILT, so an
 * import/survey turn ("give me a survey, do NOT change any files") must get NO reviewer — every other
 * post-build gate (readiness/lint/reviewer-autofix) already checks `!isImportTurn`. This one previously
 * gated only on `wroteFiles`, and INFRA writes on a survey turn (the `.env` that loads the user's saved
 * keys, foundational scaffolding) push that above zero — so the reviewer ran for ~16 min AND its heal
 * edited the imported project (added imports + 12 package.json deps), a direct "do not change" violation.
 * `isImportTurn` is the real signal: on an import/survey turn the reviewer never runs.
 */
export function reviewerShouldRun(opts: {
  wroteFiles: boolean;
  isImportTurn: boolean;
  fastLaneGated: boolean;
  reviewFastlaneForced: boolean;
  startTierSonnet: boolean;
}): boolean {
  return opts.wroteFiles
    && !opts.isImportTurn
    && (!opts.fastLaneGated || opts.reviewFastlaneForced || opts.startTierSonnet);
}

/**
 * Whether a post-build CODE gate (tsc / missing-files / syntax / missing-export) should run.
 *
 * SIBLING OF THE REVIEWER BUG ABOVE, found by measurement (reports d5f0a2bc + 15985d3b, 2026-08-05).
 * That fix's own comment claimed "every other post-build gate already checks `!isImportTurn`" — and
 * these four did not. All of them gated on `writtenFiles.size > 0`, which the `.env` WE write on an
 * import turn pushes above zero, exactly as the infra writes defeated the reviewer's size-only guard.
 *
 * The cost was measured, not guessed: the post-answer stretch showed the SAME ~97 seconds on two
 * separate Mitrify builds. On an import/survey turn the tsc gate type-checks the user's entire
 * untouched project (165 files, one component 402 KB) for no possible benefit — nothing of ours is
 * in it — and its repair pass could then edit files the user explicitly said not to change.
 *
 * These gates verify what WE built. On a turn where we built nothing, there is nothing to verify.
 * One predicate for all four, exported and tested, so a fifth gate cannot quietly repeat this.
 */
export function postBuildCodeGateShouldRun(opts: {
  enabled: boolean;
  fastLaneGated: boolean;
  buildOk: boolean;
  wroteFiles: boolean;
  isImportTurn: boolean;
  aborted: boolean;
}): boolean {
  return opts.enabled && !opts.fastLaneGated && opts.buildOk && opts.wroteFiles
    && !opts.isImportTurn && !opts.aborted;
}

/**
 * Requirement-aware build (admin-approved option A, 2026-07-20). Default OFF — when 'on', a fresh build of an
 * ambiguous DOMAIN prompt gets a bounded guidance block telling the builder to proactively INCLUDE the
 * features that domain almost always needs but the prompt left implicit (RBAC/audit/EMR for a hospital, …),
 * so a rich request never yields a shallow app. FRICTION-FREE: no clarifying round-trip (the admin's
 * "text reply > build app" rule). Flag off leaves the build prompt byte-identical to today.
 */
export function requirementAwareBuildEnabled(): boolean {
  return envFlag('AGENTV3_REQUIREMENT_AWARE');
}

/**
 * Billing Phase 3 — PER-TIER billing switch. Default OFF: the whole build is billed at the single
 * power-derived tier (billedAmountUsd), byte-identical to today. ON (AGENTV3_PER_TIER_BILLING=1|true):
 * the build is billed per the reconciled per-provider ledger, so a mixed build (cheap floor builds +
 * Sonnet reviews/edits) charges the Sonnet share at ×3, not the whole build at the cheap ×1.2. Kept
 * OFF until the cheap floor actually carries daily builds — flipping it while every build still runs
 * on Claude would raise normal-build prices ~2.5×. The admin usage-report shows both amounts so the
 * flip is a measured decision.
 */
export function perTierBillingEnabled(): boolean {
  return envFlag('AGENTV3_PER_TIER_BILLING');
}

/**
 * REAL-COST + TIERED-MARKUP billing (admin model, 2026-07-14) — the money path for every NON-Opus
 * tier (Weak, Normal, Strong): bill = tieredMarkup(exact per-provider/model real cost), not the old
 * "Sonnet-equivalent × 1.2/×3". ON by DEFAULT (this IS the billing model now); the env is a kill
 * switch so ops can instantly revert to the legacy flat/per-tier path WITHOUT a deploy if a live
 * anomaly appears. The two Opus tiers (Powerful/Full Team) are unaffected either way (they keep real
 * Opus × 2). Set `AGENTV3_REALCOST_BILLING=off` (or `0`/`false`) to disable.
 */
export function realCostBillingEnabled(): boolean {
  return envFlag('AGENTV3_REALCOST_BILLING', true);
}

/**
 * USER-FACING cost breakdown — provider-ANONYMOUS by design (admin rule 2026-07-15: the user must
 * NEVER see which backend AI did the work; to them, NavBharatAI did everything). It carries ONLY the
 * real bill + token counts + the user's own selected tier, branded as NavBharatAI. It deliberately
 * omits every provider/model name (GLM/Kimi/Claude/Sonnet/Opus/Gemini/Grok), our internal real cost,
 * and the markup multiplier — those live only in the admin diagnostics report. This is also the SINGLE
 * shape the client renders, so it can never crash on a mismatched per-tier object.
 */
export interface UserCostBreakdown {
  inputTokens: number;
  outputTokens: number;
  billedUsd: number;
  billedInr: number;
  usdInrRate: number;
  /** The user's selected tier, in user-facing words (never a model/provider name). */
  tier: string;
  /** Always the NavBharatAI engine — the only "who did the work" the user ever sees. */
  engine: string;
}

const POWER_TIER_DISPLAY: Record<string, string> = {
  weak: 'Weak', off: 'Normal', mini: 'Strong', medium: 'Powerful', max: 'Full Team',
};

/** Build the anonymized, client-safe cost breakdown for a build. Pure. */
export function userCostBreakdown(
  sinkTotal: { inputTokens: number; outputTokens: number },
  billedUsd: number,
  powerLevel: BillingPowerLevel | boolean,
  rate: number,
): UserCostBreakdown {
  const key = powerLevel === true ? 'medium' : powerLevel === false ? 'off' : String(powerLevel);
  return {
    inputTokens: Math.max(0, sinkTotal.inputTokens || 0),
    outputTokens: Math.max(0, sinkTotal.outputTokens || 0),
    billedUsd,
    billedInr: Math.round(billedUsd * Math.max(0, rate) * 100) / 100,
    usdInrRate: Math.max(0, rate),
    tier: POWER_TIER_DISPLAY[key] ?? 'NavBharatAI',
    engine: 'NavBharatAI Pro v5.0',
  };
}

/** Minimal shape of the per-provider ledger the billing decision needs (structural — no import cycle). */
export interface BillingLedgerView {
  entries: () => Array<{ provider: string; model?: string; usage: { inputTokens: number; outputTokens: number } }>;
  byProvider: () => Record<string, { inputTokens: number; outputTokens: number }>;
  total: () => { inputTokens: number; outputTokens: number };
}

/**
 * THE single billing decision for a build (Fix 65 + Fix 67). Computes the USD to bill from the build's
 * per-provider token ledger + power level: Opus tiers keep real Opus × 2; every non-Opus tier bills
 * tieredMarkup(REAL provider cost) under the real-cost kill-switch, else the legacy flat/per-tier path.
 * Extracted so BOTH exit paths — the normal settle AND the watchdog/advisory wall-clock finalization —
 * bill IDENTICALLY (Fix 67 root cause: the watchdog path used the old flat formula and skipped the
 * per-provider recording, so a build that overran its cap silently bypassed Fix 65). Pure w.r.t. its
 * inputs (reads only env + the shared routing predicate); the zero-bill guards are applied by callers.
 */
/**
 * What this build's sandbox cost, read at BILLING time.
 *
 * The report already records sandbox seconds — but it does so AFTER the settle, so at the moment the
 * bill is decided the number does not exist yet. Reading it here (the same `sandboxHeldSeconds` the
 * report uses, so the two can never disagree) is what lets the cost reach the bill at all.
 *
 * Returns 0 on ANY doubt: no actuator, no measurement, the feature off, or no real rate configured.
 * A money path must fail toward charging LESS, never toward charging for something we cannot measure.
 */
function billableSandboxUsd(actuator: unknown, workspaceId: string | null | undefined): number {
  try {
    const fn = (actuator as any)?.sandboxHeldSeconds;
    if (typeof fn !== 'function' || !workspaceId) return 0;
    return sandboxBillableUsd(sandboxCost(fn.call(actuator, workspaceId)));
  } catch {
    return 0;
  }
}

export function decideBuildBilledUsd(
  providerLedger: BillingLedgerView,
  sinkTotal: { inputTokens: number; outputTokens: number },
  powerLevel: BillingPowerLevel | boolean,
  userId: string | null | undefined,
  email: string | null | undefined,
  /**
   * What this build's E2B sandbox cost us (admin 2026-08-11: "e2b ka kharcha bill me jodo").
   *
   * Added to the REAL cost BEFORE the markup, which is the only place it belongs: the non-Opus
   * formula is literally `tieredMarkup(real cost)`, and a cloud VM billed by wall-clock is as real a
   * cost as a token. Until now NavBharatAI absorbed 100% of it, so a build that spent almost nothing
   * on tokens but held a VM for forty minutes was pure loss.
   *
   * `sandboxBillableUsd` returns 0 unless the admin has BOTH switched it on AND set their real
   * `E2B_USD_PER_HOUR` — the default rate is an admitted placeholder, and billing a placeholder is
   * exactly the invented cost the billing law forbids. So the default behaviour is unchanged.
   *
   * The OPUS tiers are deliberately untouched: CLAUDE.md records that path as admin-confirmed at
   * "real Opus × 2", and quietly changing a confirmed price is not mine to do.
   */
  sandboxUsd = 0,
): {
  effectiveBilledUsd: number;
  reconciledProviderUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  realCostRemainder: { inputTokens: number; outputTokens: number };
  isOpusTier: boolean;
} {
  const reconciledProviderUsage = reconcileWithSink(providerLedger.byProvider(), sinkTotal);
  const flatBilledUsd = billedAmountUsd(sinkTotal, powerLevel);
  const ledgerAttributed = providerLedger.total();
  const realCostRemainder = {
    inputTokens: Math.max(0, (sinkTotal.inputTokens || 0) - (ledgerAttributed.inputTokens || 0)),
    outputTokens: Math.max(0, (sinkTotal.outputTokens || 0) - (ledgerAttributed.outputTokens || 0)),
  };
  const isOpusTier = powerToTier(powerLevel) === 'opus';
  let effectiveBilledUsd: number;
  if (isOpusTier) {
    effectiveBilledUsd = flatBilledUsd; // real Opus × 2 — unchanged
  } else if (realCostBillingEnabled()) {
    const tokenCost = realProviderCostUsd(providerLedger.entries(), realCostRemainder);
    effectiveBilledUsd = tieredMarkupUsd(tokenCost + Math.max(0, sandboxUsd || 0));
  } else {
    effectiveBilledUsd = (perTierBillingEnabled() || costRoutingActiveFor(userId, email))
      ? perTierBilledUsd(reconciledProviderUsage, powerLevel)
      : flatBilledUsd;
  }
  return { effectiveBilledUsd, reconciledProviderUsage, realCostRemainder, isOpusTier };
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
    const liveCount = Object.keys(live.files).length;
    if (liveCount > 0) {
      // DISPLAY SHRINK GUARD (quiz-app "sari files 0 ho gayi", 2026-07-17): a recycled-then-recreated
      // sandbox can answer with a NON-empty but PARTIAL listing (a scaffold remnant / 1-2 files) —
      // which used to win outright, so the Files tab showed 1-2 while the durable store safely held
      // 27. Same policy as the store's own savePlanForFileSet: when the live listing is drastically
      // smaller than the durable index, it is a cold/partial sandbox — serve the durable set UNION
      // the live files (live content wins on overlap, so warm mid-build freshness is never lost).
      const savedPaths = await listWorkspaceFilePaths(workspaceId).catch(() => [] as string[]);
      if (savePlanForFileSet(savedPaths.length, liveCount) === 'replace') {
        return { files: live.files, skipped: live.skipped, source: 'live' };
      }
      const savedFull = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
      return { files: { ...savedFull, ...live.files }, skipped: live.skipped, source: 'saved' };
    }
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
// When AGENTV3_DEBUG_PROVIDER is enabled, every v5.0 reply is tagged with the
// provider/model that produced it, so the admin can verify WHERE each reply came
// from (e.g. confirm Vertex is answering). It is OFF by default, so users never see
// it; turn it ON by setting the env var on Cloud Run, and OFF again by unsetting it —
// no code change, no leak. Remove this helper and its call sites once testing is done.
function isProviderDebugOn(): boolean {
  return envFlag('AGENTV3_DEBUG_PROVIDER');
}
export function providerDebugTag(label: string): string {
  return isProviderDebugOn() && label ? `\n\n_[debug · replied via ${label}]_` : '';
}

/** One concurrent build per account — guards against runaway cost / abuse. */
const activeBuilds = new Set<string>();
const MAX_PROMPT_LEN = 20_000;
/**
 * Overdraft tolerance (₹) for the paid-public affordability gate: a build whose real cost slightly
 * overruns its pre-flight estimate may push the balance a little negative; the account is then blocked
 * for the NEXT build until top-up. This absorbs the unavoidable inaccuracy of a pre-build estimate so a
 * near-boundary user's work is never cut off mid-way. Overridable via AGENTV3_PAID_OVERDRAFT_INR.
 */
const PAID_OVERDRAFT_INR = (() => {
  const raw = Number(process.env.AGENTV3_PAID_OVERDRAFT_INR);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
})();

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
  /** Full Team steering (Fix 60): user messages sent MID-BUILD ('max' tier only). The AgentRunner
   *  drains this between turns and injects each as a REAL user turn, so the very next model call
   *  acts on it — the Claude-Code-style "talk to the team while it builds" experience. */
  steerQueue?: string[];
  /** The build's resolved power level — gates mid-build steering to the Full Team ('max') tier. */
  powerLevel?: string;
  /** The channel key (userId) — used to mirror events to the cross-device LiveChannel. Stays the
   *  ACCOUNT key even under per-workspace locking, so the cross-device mirror is unchanged. */
  key?: string;
  /** The owning account (userId ?? 'anon') — lets the per-account concurrency cap count this account's
   *  live builds even when the registry Map is keyed by workspace (per-workspace locking). */
  userId?: string | null;
  /** Which v5.0 session/project this build belongs to (agentv3-{uid}-{sessionId}). One account can
   *  have several DIFFERENT chat sessions; `runningBuilds` is keyed by userId only (one account can
   *  only build one thing at a time), but the auto-resume/attach and live-mirror paths must still
   *  verify the running build is actually the CALLER's session before replaying/mirroring it — else a
   *  build genuinely still running in session A silently bleeds into a freshly-opened session B under
   *  the same account (root-caused 2026-07-01: "+ New chat" showing an unrelated build's progress). */
  workspaceId?: string;
}
const runningBuilds = new Map<string, RunningBuild>();

/**
 * TEST-ONLY seam (VITEST): register/clear a running build under a key so the /stop and /attach identity
 * guards (T0-9 — match by VERIFIED uid, never a claimed body.userId) can be regression-tested;
 * `runningBuilds` is module-internal. A hard no-op outside tests, so it can never affect production.
 */
export function __setRunningBuildForTest(key: string, rb: RunningBuild | null): void {
  if (!process.env.VITEST) return;
  if (rb) runningBuilds.set(key, rb);
  else runningBuilds.delete(key);
}

const MAX_BUILD_BUFFER = 4000;
/** The most recent build's diagnostics report per build key (userId) — for download/endpoint. */
const lastDiagnostics = new Map<string, BuildDiagnosticsReport>();
/** Free users already shown the weak-tier welcome notice this instance (once per user — see the send). */
const weakNoticeShownFor = new Set<string>();

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

/**
 * VAJRA V4-1c (NIRMAN Phase A, server half) — how long to wait for in-flight builds to flush before a
 * SIGTERM shutdown proceeds. Cloud Run gives ~10s of grace after SIGTERM; leave headroom so the HTTP
 * server still closes cleanly. No builds → 0 (exit immediately). PURE + unit-tested.
 */
export function shutdownGraceMs(buildCount: number, capMs = 6_000): number {
  if (!(buildCount > 0)) return 0;
  return Math.min(capMs, 6_000);
}

/**
 * Gracefully drain every in-flight AgentV3 build on shutdown (a deploy/rotation). For each live build:
 * emit an HONEST "server is restarting — your build resumes automatically, files are safe" narration
 * (the client's V4-1a auto-continue then re-sends the turn cleanly instead of seeing an abrupt drop),
 * and ABORT its controller so the build's own `finally` (durable file + diagnostics save) runs before
 * the process exits — bounding lost work to the ≤6s flush already in place. Best-effort + bounded:
 * returns the number of builds signalled; never throws, never hangs (the caller caps the total wait).
 */
export function drainRunningBuilds(): number {
  let drained = 0;
  for (const rb of runningBuilds.values()) {
    if (rb.ended) continue;
    drained++;
    try {
      broadcastBuild(rb, { type: 'narration', agent: 'architect', text: '⚙️ The server is restarting (a deploy) — your build will resume automatically in a moment. Your files are safe.', ts: Date.now() });
    } catch { /* best-effort — a dead subscriber never blocks the drain */ }
    try { rb.abort.abort(); } catch { /* the build's own finally still saves durably */ }
  }
  return drained;
}
/** Is a build currently running for this account? (Account-wide — unscoped by session. Kept for
 *  callers that only care "is this account building anything", e.g. the /chat route's own
 *  reconnect-on-drop, which is always reconnecting to a build IT started, so it can't attach to the
 *  wrong session by construction.) */
function isBuildRunning(buildKey: string): boolean {
  const rb = runningBuilds.get(buildKey);
  return !!rb && !rb.ended;
}

/**
 * T1-watchdog: proactively reap DEFINITIVELY-dead builds (ended, or grossly past the hard max the
 * AgentRunner already aborts at) so a hung/crashed build never holds an account's one-build slot until the
 * next request happens to arrive. Conservative by design (see selectZombieBuilds): an abandoned-but-maybe-
 * reconnecting build is left for the REACTIVE reclaim, never killed here. Tears each zombie down with the
 * exact same clean sequence as the reactive path (abort → endBuild → drop both locks). Exported + returns a
 * count so it is unit-testable; best-effort, never throws. Returns the number reaped.
 *
 * HONEST BOUNDARY (rule 6): this aborts + unlocks the IN-PROCESS build. Force-killing the orphaned E2B
 * sandbox VM and auto-rebuild-on-crash need the out-of-process supervisor (GA-2 remaining, infra-blocked).
 */
export function sweepZombieBuilds(now: number = Date.now()): number {
  const hardMaxMs = maxBuildSeconds() > 0 ? maxBuildSeconds() * 1000 + 120_000 : 0;
  let reaped = 0;
  for (const key of selectZombieBuilds(runningBuilds.entries(), now, hardMaxMs)) {
    const rb = runningBuilds.get(key);
    if (!rb) continue;
    try { rb.abort.abort(); } catch { /* best-effort */ }
    try { endBuild(rb); } catch { /* best-effort */ }
    if (runningBuilds.get(key) === rb) runningBuilds.delete(key);
    activeBuilds.delete(key);
    reaped++;
    console.warn(`[AGENTV3 WATCHDOG] reaped zombie build ${key} (ended or past hard max).`);
  }
  return reaped;
}

// Run the sweeper on a bounded interval. Guarded out of tests (no stray timer); unref'd so it never keeps
// the process alive. Cross-instance zombies on OTHER server instances are out of scope (in-process registry).
if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  const watchdogTimer = setInterval(() => { try { sweepZombieBuilds(); } catch { /* watchdog is best-effort */ } }, 60_000);
  watchdogTimer.unref?.();
}

/**
 * T0-9 — the money/entitlement facts of `/api/agentv3/status`, keyed off the VERIFIED identity ONLY (never a
 * claimed `?userId`). `billed` = paid-public is on AND the user is not free-listed. `powerUnlocked` = a
 * free-list admin/tester, OR a verified user whose wallet shows a past purchase. A null `verified` degrades
 * to billed=false/powerUnlocked=false (the client self-heals on its next token-refresh poll). Pure over its
 * inputs (config flags + the already-read wallet) — unit-testable.
 */
export function statusEntitlement(
  verified: { uid: string; email: string | null } | null,
  wallet: FreeTierWallet | null,
): { billed: boolean; powerUnlocked: boolean } {
  const uid = verified?.uid ?? null;
  const email = verified?.email ?? null;
  const billed = isAgentV3PaidPublicEnabled() && !isAgentV3FreeUser(uid, email);
  const powerUnlocked = isAgentV3FreeUser(uid, email) || (!!uid && !isFreeTierUser(wallet));
  return { billed, powerUnlocked };
}
/** Is a build running for this account AND does it belong to `workspaceId`? Use this (not
 *  `isBuildRunning`) for any path that might auto-attach to a build the caller didn't itself start —
 *  otherwise a build genuinely still running in a DIFFERENT v5.0 session under the same account gets
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
export function shouldReclaimBuildLock(existing: RunningBuild | undefined, now: number, staleMs = 30_000, hardMaxMs = 0): boolean {
  if (!existing || existing.ended) return true;
  // Abandoned: no live watcher AND past the stall window.
  if (existing.subscribers.size === 0 && now - existing.startedTs > staleMs) return true;
  // ZOMBIE (GA-2 in-process reaper): a build grossly past the HARD max duration is definitively dead — the
  // AgentRunner aborts at AGENTV3_MAX_BUILD_SECONDS, so a build still "running" well beyond that never fired
  // its cleanup (a hung await / crashed heal gate). Reclaim it even with a lingering subscriber, so a single
  // zombie can't trap the account's "one build at a time" slot forever. hardMaxMs=0 disables this check.
  if (hardMaxMs > 0 && now - existing.startedTs > hardMaxMs) return true;
  return false;
}

/**
 * The v5.0 BUILD turn-runner. Builds run on CLAUDE ONLY (Haiku → Sonnet → Opus) because only
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
 * Per the v5.0 constitution NavBharatAI pays the Claude cost; the user is billed the
 * Opus-equivalent markup. Models are env-overridable (AGENTV3_{HAIKU,SONNET,OPUS}_MODEL).
 */
/**
 * Decide whether the v5.0 build chain leads with Claude. Pure + exported for unit testing.
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
export function selectBuildModel(tier: StartTier | undefined, power: boolean | PowerLevel, largeProject = false): string {
  // Admin tier→model redefinition (2026-07-13): a PAID PINNED tier runs exactly its model —
  // Strong ('mini') → Sonnet 100%; Powerful/Full Team ('medium'/'max', legacy boolean true) → Opus.
  if (power === 'mini') return sonnetModel();
  if (power === true || power === 'medium' || power === 'max') return opusModel();
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
 * Mitrify-scale imports are ~300+, fresh v5.0 builds are ~15-60). Pure + exported for testing.
 */
export function isLargeExistingProject(fileCount: number): boolean {
  const threshold = Math.max(1, parseInt(process.env.AGENTV3_LARGE_PROJECT_FILES || '', 10) || 100);
  return fileCount >= threshold;
}

/**
 * Should this build skip Haiku/the cheap floor and run directly on the strong model? True for a LARGE
 * existing project OR an IMPORT turn. Imports matter separately: a GitHub-URL clone lands its files
 * AFTER model selection, so the large-project file count is 0 at decision time (the Mitrify import ran
 * on Haiku + the cheap floor, which then timed out on the huge grounding prompt). Every import operates
 * on a real existing app with a big prompt → strong model. Pure + exported for testing.
 */
export function shouldRouteStrongModel(largeProject: boolean, hasImportIntent: boolean): boolean {
  return largeProject === true || hasImportIntent === true;
}

/** The dev-server port a framework's `npm run dev` listens on — used by the OneShot lane to
 *  publish the preview after a one-shot build. Pure + exported for testing. */
/**
 * The port an E2B preview URL is really serving on — E2B hosts are `https://<port>-<sandbox>.e2b.app`,
 * so the port is the first label. Falls back to an explicit `:port`, else null. PURE.
 *
 * WHY (admin report 2026-08-06): the health probe used `oneShotDevPort(framework)` — a GUESS from the
 * framework name (vite-react ⇒ 5173). A full-stack Express app commonly serves everything on its own
 * port (mitrify: 5000), so the probe hit a port nothing was listening on and a perfectly healthy app
 * was classified "sleeping" — or worse, the guess happened to answer and the verdict described a
 * different process entirely. The URL the client is ACTUALLY displaying is the ground truth.
 */
export function previewUrlPort(previewUrl: string | null | undefined): number | null {
  const raw = (previewUrl || '').trim();
  if (!raw) return null;
  let host = '';
  try {
    const u = new URL(raw);
    if (u.port) {
      const explicit = Number(u.port);
      return Number.isInteger(explicit) && explicit > 0 && explicit < 65_536 ? explicit : null;
    }
    host = u.hostname;
  } catch {
    return null;
  }
  const m = /^(\d{2,5})-/.exec(host);       // E2B: 5000-abc123.e2b.app
  const port = m ? Number(m[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

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
 * Parse a provider API-key env into a POOL of keys for rotation (ROADMAP Tier-4). Accepts a comma- or
 * whitespace-separated list (`key1,key2 key3`) so the cheap floor can fail over from a 429-throttled
 * key to a fresh one on the SAME model — the deep-test App #9/#10 GLM-saturation lever. A single key
 * stays valid (a list of one → today's exact behaviour). Blanks are dropped and duplicates de-duped
 * (a copy-paste repeat never doubles a rung). Pure + exported for testing.
 */
export function parseKeyPool(env: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of (env || '').split(/[\s,]+/)) {
    const key = k.trim();
    if (key && !seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/**
 * NavBharatAI Pro v5.0 — optional CHEAP BUILD FLOOR (admin cost-down lever, DEFAULT OFF).
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
/**
 * Whether Vertex/Gemini join the build chain as the TRUE LAST RESORT (after the cheap floor, CLAUDE,
 * and the forced-Haiku backstop have ALL thrown). Default ON — admin go-ahead 2026-07-07 ("jab sab
 * fail ho jaye to last me gemini/vertex se try karwao"), given during a real all-provider outage
 * (GLM/KIMI timeouts + Anthropic credits exhausted). '0' / 'off' rolls back to the old exclusion;
 * '1' (the old opt-in) still enables. Pure + exported for testing.
 */
export function geminiLastResortEnabled(flag: string | undefined): boolean {
  const v = (flag || '').trim().toLowerCase();
  return v !== '0' && v !== 'off';
}

/**
 * Whether Vertex/Gemini act as a PEER of the cheap floor (tried right after GLM/Kimi, BEFORE Claude)
 * on a floor-led build — admin request 2026-07-20 ("GLM fail ho to Kimi AUR Vertex dono se kaam
 * karwao"). Default ON. This is exactly the order the FREE tier already uses (floor → Vertex/Gemini →
 * Haiku); this extends it to the paid/normal floor-led path. Vertex/Gemini can under-produce in the
 * agentic tool-loop, but the readiness + tsc gates + empty-build retry-on-stronger-model catch a
 * 0-file turn — it can never SHIP a broken build; it just adds a fallback rung before Claude.
 * `AGENTV3_VERTEX_PEER=0`/`off` reverts to Vertex/Gemini as the absolute last resort (after Claude).
 * Pure + exported for testing.
 */
export function vertexPeerBuildEnabled(flag: string | undefined): boolean {
  const v = (flag || '').trim().toLowerCase();
  return v !== '0' && v !== 'off';
}

// FLOOR BALANCE (admin directive 2026-07-21, restaurant-build autopsy: "GLM par pura load na dalo —
// GLM+Kimi+Vertex+Haiku me smartly divide"): alternate which cheap provider LEADS on each runner
// construction, so first-attempt load spreads ~50/50 across GLM and KIMI instead of GLM eating every
// first call (that build: 32 GLM 429s while KIMI sat second on every attempt). SMART, not equal —
// the shared 429 cooldown/bench already skips an unhealthy provider regardless of order, so this
// rotation only spreads load between HEALTHY providers; Vertex/Gemini/Haiku remain strictly error-only
// backstops (the cost order and the weak-tier no-Claude ladder are unchanged — only the GLM↔KIMI lead
// swaps). Kill switch: AGENTV3_FLOOR_BALANCE=off restores the fixed GLM-first order.
let floorLeadCounter = 0;
/** Test-only: reset the lead-alternation counter so ordering assertions are deterministic. */
export function _resetFloorLeadCounter(): void { floorLeadCounter = 0; }

/** Pure reorder: when `kimiFirst`, the KIMI rung block leads and the GLM block follows (any other rungs
 *  keep their relative position after both). Identity when either block is absent or `kimiFirst` is false. */
export function balanceFloorLead(runners: NamedRunner[], kimiFirst: boolean): NamedRunner[] {
  if (!kimiFirst) return runners;
  const base = (e: NamedRunner): string => e.reportAs ?? e.name;
  const glm = runners.filter((e) => base(e) === 'GLM');
  const kimi = runners.filter((e) => base(e) === 'KIMI');
  if (glm.length === 0 || kimi.length === 0) return runners;
  const rest = runners.filter((e) => base(e) !== 'GLM' && base(e) !== 'KIMI');
  return [...kimi, ...glm, ...rest];
}

export function cheapBuildFloorRunners(opts?: { free?: boolean; flagshipOnly?: boolean }): NamedRunner[] {
  // DEFAULT = 'on' (admin 2026-07-12, "1st call claude nahi chahiye — jaisa CLAUDE.md me save hai"):
  // per the confirmed Model Routing Policy the FIRST build call must be the flagship cheap coder
  // (GLM glm-5.2 / Kimi), NOT Claude — Claude is only the last-resort backstop. So the cheap floor now
  // LEADS by default; Claude/Haiku still backstop the chain, and a missing GLM/KIMI key makes `add()`
  // skip that rung (keyless → no-op), so with NO keys this is still byte-for-byte the old Claude path.
  // Explicit `AGENTV3_CHEAP_FLOOR=off` remains the instant, env-authoritative kill switch (env overrides
  // this default). NOTE: an env value always wins — if Cloud Run pins it to `off`, that off wins here.
  const floor = (process.env.AGENTV3_CHEAP_FLOOR || 'on').trim().toLowerCase();
  if (floor === 'off' || floor === '') return [];
  const runners: NamedRunner[] = [];
  // ADMIN DESIGN (2026-07-07, combined plan): every GLM/KIMI failure that day was "Request timed
  // out." on the LARGEST prompts while small turns succeeded 7/7. So: (1) timeout 25s → 60s (they
  // are slow, not broken — give real work time to finish); (2) prompt-size-aware routing — a turn
  // over the size limit SKIPS the floor instantly (straight to Claude, no gamble); (3) prompt diet —
  // oversized blocks are trimmed before reaching the cheap model (sizeGatedRunner does 2+3); the
  // 2-consecutive-timeout BENCH lives in makeMultiProviderTurnRunner. All env-tunable.
  const floorTimeoutMs = Number(process.env.AGENTV3_CHEAP_FLOOR_TIMEOUT_MS) || 60_000;
  // ADMIN OVERRIDE (2026-07-11, "kimi/glm se limit hata do — 1st try for every file glm/kimi"): the
  // 45k skip meant edit/continue turns (file grounding pushes the prompt just over 45k) NEVER used the
  // cheap floor — every one fell to Claude, defeating "direct sonnet kahi nahi chahiye". Default is now
  // 0 = NO size skip, so GLM/Kimi lead every prompt (the prompt-diet trim still applies; Claude still
  // backstops any real timeout). The env can RE-impose a positive limit if timeouts ever return.
  const floorMaxRaw = (process.env.AGENTV3_CHEAP_FLOOR_MAX_PROMPT_CHARS ?? '').trim();
  const floorMaxPromptChars = floorMaxRaw !== '' && Number.isFinite(Number(floorMaxRaw)) ? Number(floorMaxRaw) : 0;
  // KIMI-specific timeout (admin 2026-07-13, "kimi ka time badhao — 120 sec"): KIMI (Moonshot) is
  // measurably SLOWER than GLM on the LARGEST prompts (a 39-file full-stack build turn) — the real App #7
  // "Request timed out" failures were KIMI not finishing within the 60s floor, so the turn fell to Vertex
  // which then TRUNCATED. Giving KIMI 120s lets it finish the big turn instead of prematurely cascading to
  // the truncating fallback. GLM keeps the shorter floor timeout (fast fallback when a GLM key is throttled
  // is desirable). Env-tunable; a positive AGENTV3_CHEAP_FLOOR_TIMEOUT_MS still floors KIMI no lower than GLM.
  const kimiTimeoutMs = Math.max(floorTimeoutMs, Number(process.env.AGENTV3_KIMI_TIMEOUT_MS) || 120_000);
  // KEY POOL / ROTATION (ROADMAP Tier-4, deep-test App #9/#10: GLM 429-saturation dominated failures).
  // GLM_API_KEY / KIMI_API_KEY may hold a COMMA- (or whitespace-) separated LIST of keys. Each key
  // becomes its own rung, so a 429 on one key immediately fails over to the SAME model on the NEXT key
  // (see model-major/key-minor ordering below) instead of dropping model quality or falling to Claude.
  // A single key → a list of one → byte-for-byte today's behaviour (fully backward-compatible).
  const add = (name: string, apiKeyRaw: string | undefined, baseURL: string, models: string[], runnerOpts: { thinkingControl?: boolean } = {}, timeoutMs: number = floorTimeoutMs): void => {
    const keys = parseKeyPool(apiKeyRaw);
    if (keys.length === 0) return; // no key → a second, independent off-switch
    // MODEL-MAJOR, KEY-MINOR: try the BEST model across ALL keys before dropping a tier. So a throttled
    // key #1 fails over to the same flagship model on key #2 (quality preserved); only when every key is
    // exhausted for that model does the chain drop to a weaker one. Each KEY gets a distinct bench name
    // ('GLM', 'GLM#2', …) so the 2-consecutive-429 bench sidelines only the throttled key, not the pool;
    // every rung still reports as the base provider (reportAs) → one clean telemetry/no-Claude label.
    for (const model of models) {
      keys.forEach((apiKey, k) => {
        try {
          const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 0 });
          // Proactive pacer (default-OFF, AGENTV3_RATE_PACER=on): pace this provider's calls under its rate
          // + auto-shrink concurrency on 429/timeout. Keyed by the BASE provider name so all keys of one
          // provider share one bucket (global per-provider pacing). No-op passthrough when the flag is off.
          const runner = pacedRunner(sizeGatedRunner(new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model, ...runnerOpts }), floorMaxPromptChars), name);
          runners.push(k === 0 ? { name, runner } : { name: `${name}#${k + 1}`, runner, reportAs: name });
        } catch { /* misconfigured model/key rung — skip; the next rung / Claude still backstops */ }
      });
    }
  };
  // Explicit ALLOWLIST (not just "anything but off") so a stray/unrecognized value (a typo, an old
  // config left over from a different provider name) stays a safe no-op instead of silently turning
  // on paid GLM/KIMI calls. 'glm'/'kimi' still pin to ONE (explicit single-provider testing/rollback);
  // 'both'/'on' enable the "friends" pair.
  //
  // MODEL-ID SOURCE OF TRUTH (admin decision "A", 2026-07-12): GLM_MODEL / KIMI_MODEL are kept EMPTY in
  // Cloud Run ON PURPOSE — the model ids live HERE, in these code defaults, maintained by Claude. Why not
  // env-pin or auto-latest: env-pinning means the admin edits Cloud Run on every model release (churn);
  // blindly auto-picking "latest" is unsafe (a new/preview model can be worse at the agentic tool-loop,
  // pricier, or break a build — "newest" ≠ "best coder"). So new models are adopted DELIBERATELY: when
  // GLM/Kimi ship a genuinely better stable coder, bump the default below in a PR (ideally after a quick
  // bake-off). The comma ladder + Claude/Vertex backstop means a RETIRED id auto-falls-through — the app
  // never breaks even if these are never touched; updating is only ever to ADOPT a better model.
  //
  // FREE-TIER graduated ladder (Model Routing Policy, admin 2026-07-12): a FREE build climbs CHEAPEST-FIRST
  // — flash → cheap coder → flagship — so it starts on the cheapest model and only climbs (error-fallback
  // + the Grok judge loop) when it must. Paid/default stays flagship-first. Its own env overrides
  // (AGENTV3_FREE_GLM_MODEL / AGENTV3_FREE_KIMI_MODEL) so the free ladder is tunable without touching paid.
  const glmDefault = opts?.free ? ['glm-4.7-flash', 'glm-4.7', 'glm-5.2'] : ['glm-5.2', 'glm-4.7'];
  // KIMI K3 (admin 2026-07-28): PREPENDED to the paid ladder, never a replacement. If `kimi-k3` is not
  // a live id yet, the call errors and `parseModelLadder`'s comma ladder falls through to k2.7-code
  // exactly as before — so adopting it cannot break a build even if the model does not exist.
  // The FREE ladder is deliberately UNCHANGED (admin: "weak module abhi jaisa hai vaise hi"): it is
  // ordered cheapest-first with the flagship LAST, so putting a newer flagship in front would invert
  // the free tier's whole cost model.
  const kimiDefault = opts?.free ? ['kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code'] : ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'];
  const glmEnv = opts?.free ? process.env.AGENTV3_FREE_GLM_MODEL : process.env.GLM_MODEL;
  const kimiEnv = opts?.free ? process.env.AGENTV3_FREE_KIMI_MODEL : process.env.KIMI_MODEL;
  // FLAGSHIP-ONLY (admin 2026-08-02, weak-fail repair): when the WEAK build fails, its last repair pass
  // must run on the TOP GLM/Kimi model — NOT the cheap flash/coder rungs that produced the failing app.
  // The flagship is the LAST rung of each cheapest-first free ladder (glm-5.2 / kimi-k2.7-code), so
  // `flagshipOnly` keeps just that rung. A paid/flagship-first ladder is already flagship-led, so slicing
  // its last (glm-4.7) would WEAKEN it — flagshipOnly is therefore honoured only for the free ladder.
  const pickLadder = (env: string | undefined, def: string[]): string[] => {
    const ladder = parseModelLadder(env, def);
    return opts?.flagshipOnly && opts?.free && ladder.length > 1 ? ladder.slice(-1) : ladder;
  };
  if (floor === 'glm' || floor === 'both' || floor === 'on') {
    // thinkingControl: the app-level thinking toggle (same one that drives Claude's adaptive
    // thinking) is forwarded to GLM's reasoning switch — one setting controls every module.
    add('GLM', process.env.GLM_API_KEY, process.env.GLM_BASE_URL || 'https://api.z.ai/api/paas/v4', pickLadder(glmEnv, glmDefault), { thinkingControl: true });
  }
  if (floor === 'kimi' || floor === 'both' || floor === 'on') {
    add('KIMI', process.env.KIMI_API_KEY, process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1', pickLadder(kimiEnv, kimiDefault), {}, kimiTimeoutMs);
  }
  // Amazon Bedrock — Z.AI GLM 5 as a cheap-floor rung (admin 2026-07-08). Bedrock exposes its
  // SERVERLESS models via an OpenAI-COMPATIBLE endpoint, so the SAME OpenAiToolRunner the GLM/KIMI
  // rungs use works unchanged — no AWS SDK. Its own off-switch is the BEDROCK_API_KEY (the `add`
  // helper skips a keyless rung), so this is inert until the admin sets the key in Cloud Run and
  // selects it via AGENTV3_CHEAP_FLOOR=bedrock. Region default us-west-2 (where the admin enabled
  // GLM 5); model default `zai.glm-5` — both env-overridable.
  if (floor === 'bedrock') {
    const region = (process.env.BEDROCK_REGION || 'us-west-2').trim();
    add('BEDROCK-GLM', process.env.BEDROCK_API_KEY, `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`, parseModelLadder(process.env.BEDROCK_GLM_MODEL, ['zai.glm-5']));
  }
  // FLOOR BALANCE (see the block above cheapBuildFloorRunners): alternate the GLM↔KIMI lead per
  // construction, only when BOTH providers are actually present (a single-provider floor never rotates
  // and never consumes the counter). Default ON per the admin's 2026-07-21 load-divide directive.
  const balanceOn = (process.env.AGENTV3_FLOOR_BALANCE ?? 'on').trim().toLowerCase() !== 'off';
  const baseOf = (e: NamedRunner): string => e.reportAs ?? e.name;
  const hasBoth = runners.some((e) => baseOf(e) === 'GLM') && runners.some((e) => baseOf(e) === 'KIMI');
  // FREE-TIER KIMI LEAD (admin 2026-08-02, QR-build autopsy: a free build logged 106 GLM failures vs 2 KIMI
  // — GLM's free rung glm-4.7-flash is by far the most 429-throttled right now). On a FREE build, KIMI LEADS
  // outright instead of the 50/50 balance, so the first-attempt call hits the currently-reliable provider;
  // GLM stays right behind it as the error-fallback, so no capability is lost — only the lead changes. Paid
  // builds keep the GLM↔KIMI 50/50 alternation unchanged. Kill switch AGENTV3_FREE_KIMI_LEAD=off restores the
  // balanced order for free builds too.
  const freeKimiLead = opts?.free === true && hasBoth
    && (process.env.AGENTV3_FREE_KIMI_LEAD ?? 'on').trim().toLowerCase() !== 'off';
  if (freeKimiLead) return balanceFloorLead(runners, true);
  return balanceFloorLead(runners, balanceOn && hasBoth && floorLeadCounter++ % 2 === 1);
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
/**
 * Pure, mode-aware judge SELECTION (Model Routing Policy, admin 2026-07-12): Free = Grok, Paid = Grok
 * or Sonnet (either is fine), Power = Opus. FREE never resolves to a Claude judge — if no Grok key it
 * returns 'sonnet' as a signal that no non-Claude judge is available, and the free-ladder caller SKIPS
 * the judge rather than spend Claude. Exported for tests.
 */
export function resolveJudgeKind(mode: 'free' | 'paid' | 'power', grokKey: string | undefined, reviewerEnv: string | undefined): 'grok' | 'sonnet' | 'opus' {
  if (mode === 'power') return 'opus';
  if (mode === 'free') return grokKey ? 'grok' : 'sonnet';
  return selectReviewer({ reviewer: reviewerEnv, grokKey });
}

function selectReviewJudge(mode: 'free' | 'paid' | 'power' = 'paid'): { runTurn: JudgeRunTurn; modelId: string; kind: 'grok' | 'sonnet' | 'opus' } {
  const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const kind = resolveJudgeKind(mode, grokKey, process.env.AGENTV3_REVIEWER);
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
    } catch { /* client not constructable → fall through to the Claude judge */ }
  }
  // Claude judge — Opus in power mode, Sonnet otherwise.
  const runTurn: JudgeRunTurn = (a) => new ClaudeClient(undefined, { maxRetries: 1 }).runTurn(a).then((t) => ({ text: t.text }));
  return { runTurn, modelId: kind === 'opus' ? opusModel() : sonnetModel(), kind: kind === 'opus' ? 'opus' : 'sonnet' };
}

/**
 * Whether the cheap build floor (GLM/Kimi) may LEAD a build for a given start tier. The floor is for
 * SIMPLE/MEDIUM apps (gemini/haiku tiers); a COMPLEX app (sonnet) or POWER build (opus) starts
 * directly on the strong model — "complex → seedha Sonnet" — so a likely-doomed cheap attempt is not
 * wasted before escalation. An unknown tier (cost-ladder off) is allowed (the admin opted in and
 * Claude still backstops). AGENTV3_CHEAP_FLOOR_ALL_TIERS=1 overrides → apply the floor to every tier.
 * Pure + exported for testing.
 */
export function cheapFloorAllowedForTier(startTier?: string, rolloutKey?: string): boolean {
  if (envFlag('AGENTV3_CHEAP_FLOOR_ALL_TIERS')) return true;
  // SMART CHEAP-FIRST (admin 2026-07-03): when ESCALATION is on, EVERY app — simple OR complex —
  // tries the cheap floor (GLM/Kimi) FIRST, because a weak cheap build is caught by the mandatory
  // readiness gate (it downgrades ok:false) and RETRIED on Sonnet. So all apps get the cheap-first
  // cost saving AND the Sonnet safety net. WITHOUT escalation there is no stronger retry, so we keep
  // the conservative split (complex → strong directly) — a complex app must never ship a weak cheap
  // build with no way to escalate. This makes "all apps cheap-first → gate → Sonnet-on-fail" the
  // behaviour precisely when it is safe.
  // T1-escalation-on: this must be the CANARY-AWARE check (escalationActiveFor, same rollout key as
  // shouldEscalateBuild) — a build OUTSIDE a partial rollout has no Sonnet retry, so it must keep the
  // conservative split below, not lead cheap on a complex app.
  if (escalationActiveFor(rolloutKey)) return true;
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
 * HONEST ROUTING DIAGNOSIS (admin 2026-07-12, autopsy of fae70e42): a report that shows "Claude built
 * this" never said WHY the cheap GLM/Kimi floor did NOT lead — so "1st call claude kyun?" was a guess.
 * This resolves the EXACT reason from the same inputs the router uses, so every build report can state
 * it plainly. Pure + exported for testing; reads the env for the flag + key presence (never the values).
 */
export function cheapFloorDecision(env: NodeJS.ProcessEnv, ctx: {
  allowCheapFloor: boolean; routeStrong: boolean; freeTierBuildActive: boolean;
  tierAllowed: boolean; userAllowed: boolean;
}): { active: boolean; reason: string } {
  const floor = (env.AGENTV3_CHEAP_FLOOR || 'on').trim().toLowerCase();
  if (floor === 'off' || floor === '') {
    return { active: false, reason: 'Cheap floor OFF (AGENTV3_CHEAP_FLOOR=off) → Claude leads. Set it to on/glm/kimi to make GLM/Kimi lead.' };
  }
  const hasGlm = !!(env.GLM_API_KEY && env.GLM_API_KEY.trim());
  const hasKimi = !!(env.KIMI_API_KEY && env.KIMI_API_KEY.trim());
  const hasBedrock = !!(env.BEDROCK_API_KEY && env.BEDROCK_API_KEY.trim());
  const wantsGlm = floor === 'glm' || floor === 'both' || floor === 'on';
  const wantsKimi = floor === 'kimi' || floor === 'both' || floor === 'on';
  const wantsBedrock = floor === 'bedrock';
  const keyOk = (wantsGlm && hasGlm) || (wantsKimi && hasKimi) || (wantsBedrock && hasBedrock);
  if (!keyOk) {
    const need = wantsBedrock ? 'BEDROCK_API_KEY' : [wantsGlm ? 'GLM_API_KEY' : '', wantsKimi ? 'KIMI_API_KEY' : ''].filter(Boolean).join('/');
    return { active: false, reason: `Cheap floor '${floor}' is ON but no matching API key is set (${need}) → the keyless rung is skipped, Claude leads. Set the key in Cloud Run.` };
  }
  if (!ctx.allowCheapFloor) {
    if (ctx.routeStrong) return { active: false, reason: 'Large project / import build → routed straight to the strong model by design (cheap floor intentionally skipped).' };
    if (!ctx.userAllowed) return { active: false, reason: 'This build account is NOT in the AGENTV3_CHEAP_FLOOR_USERS canary allowlist → Claude leads. Clear that env var to enable GLM/Kimi for everyone.' };
    if (!ctx.tierAllowed) return { active: false, reason: 'This app tier is not eligible for the cheap floor (escalation off + complex app) → strong model leads.' };
    return { active: false, reason: 'Cheap floor not allowed for this build → Claude leads.' };
  }
  return { active: true, reason: `Cheap floor ACTIVE — ${floor.toUpperCase()} leads the first attempt; Claude/Haiku only backstop on failure.` };
}

/**
 * Pick the report a late preview error should be APPENDED to (evidence must never fork — jungle-game
 * reports 2026-07-12): prefer the durable copy; when it is missing/unreadable, fall back to this
 * instance's IN-MEMORY report — but only when it is genuinely the SAME workspace's build (the memory
 * map is keyed per-user, so it can hold a different, newer project). Null = nothing to attach to.
 * Pure + exported for testing.
 */
export function pickPreviewErrorBase<R extends { workspaceId?: string }>(
  durable: R | null,
  mem: R | null,
  workspaceId: string,
): R | null {
  if (durable) return durable;
  if (mem && mem.workspaceId === workspaceId) return mem;
  return null;
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

/**
 * Map a MultiProviderTurnRunner provider NAME (GLM / KIMI / BEDROCK-GLM / CLAUDE / CLAUDE_HAIKU /
 * VERTEX / GEMINI) to the honest `provider` label recorded in the build report's per-LLM-call log.
 * The FAST lane (Simple Builder / OneShot) now leads with the cheap floor exactly like the agentic
 * chain, so its calls can be delivered by GLM/Kimi — recording a fixed 'anthropic' would be a rule-5
 * honesty bug. Unknown names fall back to the name itself (lower-cased) so nothing is silently hidden.
 * Pure + exported for testing.
 */
export function fastLaneProviderLabel(used: string | undefined): string {
  switch ((used || '').toUpperCase()) {
    case 'GLM': return 'glm';
    case 'KIMI': return 'kimi';
    case 'BEDROCK-GLM': return 'bedrock';
    case 'CLAUDE':
    case 'CLAUDE_HAIKU': return 'anthropic';
    case 'VERTEX':
    case 'GEMINI': return 'google';
    default: return (used || 'anthropic').toLowerCase();
  }
}

/**
 * Routing for the post-build HEAL/retry runners (integrity / preview / C9 reviewer-autofix / runtime
 * auto-fix / the no-files rebuild). Model Routing Policy (admin 2026-07-12): a FREE build must NEVER
 * touch Claude — anywhere — so on a free build these runners go CHEAP-ONLY (GLM/Kimi, no Claude); a
 * paid/power build keeps Claude-first (Sonnet in normal, Opus in power). Pure + exported for tests.
 * (This closes the leak where the heal gates built a `claudeFirst` runner regardless of tier.)
 */
/** Kill switch for the weak-fail flagship repair (admin 2026-08-02). Default ON; `off` reverts weak heals
 *  to today's cheap/Vertex path without a deploy. */
export function weakFlagshipHealEnabled(): boolean {
  return (process.env.AGENTV3_WEAK_FLAGSHIP_HEAL ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * Routing for a post-build HEAL/repair pass. A heal pass only ever runs when the build already has a
 * problem to fix, so this is the "the build is failing" moment.
 *
 * WEAK/FREE (admin 2026-08-02, "weak me last me GLM/Kimi ke top module use kar sakte hai"): a failing
 * weak build's repair must run on the TOP GLM/Kimi model (glm-5.2 / kimi-k2.7-code) — NOT the cheap
 * flash/coder that produced the failing app — so the last resort is genuinely stronger. Enforced by
 * leading the heal chain with the FLAGSHIP-ONLY free floor (`allowCheapFloor + free + flagship`); Claude
 * stays stripped by `noClaude` at the call site (Sonnet/Opus never on weak — Vertex/Gemini + Haiku remain
 * the final backstops). The main build is UNCHANGED (still cheapest-first) — only repairs go flagship, and
 * only on a build that is already failing. Cost is therefore bounded to failing builds.
 *
 * PAID: unchanged — Claude-first repair (Sonnet/Opus), no cheap floor.
 */
export function healRunnerRoutingOpts(
  freeTierBuildActive: boolean,
): { claudeFirst: boolean; cheapOnly: boolean; allowCheapFloor?: boolean; free?: boolean; flagship?: boolean } {
  if (!freeTierBuildActive) return { claudeFirst: true, cheapOnly: false };
  return weakFlagshipHealEnabled()
    ? { claudeFirst: false, cheapOnly: true, allowCheapFloor: true, free: true, flagship: true }
    : { claudeFirst: false, cheapOnly: true };
}

/**
 * UNBREAKABLE WEAK-MODULE GUARD (admin-mandated absolute rule, 2026-07-13). When a build runs in the
 * WEAK module (the free/cheap tier), **Claude must NEVER be called — not the builder, not ANY post-build
 * heal gate.** This is the single chokepoint that enforces it: it strips every Claude runner (`CLAUDE`
 * plus the forced-Haiku backstop `CLAUDE_HAIKU`) from the final provider chain whenever `noClaude` is
 * set, regardless of what claudeFirst / cheapOnly / env produced. A weak build therefore runs on the
 * cheap floor (GLM/Kimi) + Vertex/Gemini last resort ALONE — NavBharatAI never spends its Claude budget
 * on a weak build. ROOT CAUSE it closes (deep-test App #1, 2026-07-13): the "no Claude" guarantee was
 * tied only to `cheapOnly`/`freeTierBuildActive`; a weak build whose heal gate did not thread that flag
 * still built a Claude runner and ran 4 Sonnet calls on a free build. Pure + exported for unit testing.
 */
export function enforceNoClaude<T extends { name: string }>(chain: T[], noClaude: boolean): T[] {
  if (!noClaude) return chain;
  // AMENDMENT (admin-mandated 2026-07-13, verbatim: "weak module me claude haiku add kar de? to last me.
  // par sart yeh hai … haiku ke alawa kuch aur nahi chalna chahiye, matlab sonnet ya opus never never"):
  // the WEAK module may now use Claude **HAIKU** as the absolute LAST resort — and ONLY Haiku. So:
  //   • 'CLAUDE' (the Sonnet/Opus runner) is STILL stripped — Sonnet/Opus never run on weak, ever.
  //   • 'CLAUDE_HAIKU' is KEPT — it is safe BY CONSTRUCTION: forceModelRunner pins it to haikuModel()
  //     (it rewrites params.model), so it can never execute anything but Haiku. The ClaudeClient
  //     no-Claude-zone chokepoint independently enforces the same (haiku ids allowed, all else refused).
  //   • Every kept CLAUDE_HAIKU is MOVED TO THE END of the chain ("to last me") — even on a defensive
  //     path where the chain was assembled with Haiku mid-chain, weak order stays cheap → … → Haiku last.
  const kept = chain.filter((r) => r.name !== 'CLAUDE');
  const haiku = kept.filter((r) => r.name === 'CLAUDE_HAIKU');
  return [...kept.filter((r) => r.name !== 'CLAUDE_HAIKU'), ...haiku];
}

function buildTurnRunner(opts?: { geminiModel?: string; claudeFirst?: boolean; allowCheapFloor?: boolean; cheapOnly?: boolean; free?: boolean; flagship?: boolean; noClaude?: boolean; onProviderError?: (name: string, err: unknown) => void; onProviderUsed?: (used: string, fellBackFrom: string[]) => void; onTurnComplete?: (used: string, usage: { inputTokens: number; outputTokens: number }, model?: string) => void }): TurnRunner {
  // Explicit env overrides always win; absent them the cost-ladder tier model
  // (when supplied) is preferred over the fixed gemini-2.5-pro default.
  const buildModel = (envName: string): string =>
    process.env[envName] || process.env.AGENTV3_BUILD_MODEL || opts?.geminiModel || 'gemini-2.5-pro';
  const cheap: NamedRunner[] = [];
  // Per-call timeout for the Gemini/Vertex runners — the Google GenAI SDK is constructed without an
  // http timeout, so a stalled call would otherwise block the whole build (every other provider family
  // already has a timeout). Default 120s (matches the Claude LLM timeout); AGENTV3_GEMINI_TIMEOUT_MS overrides.
  const geminiTimeoutMs = Math.max(0, parseInt(process.env.AGENTV3_GEMINI_TIMEOUT_MS || '', 10) || 120_000);
  // Vertex (function-calling, via the Cloud Run service account / ADC).
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (project) {
    try {
      const vertex = new GoogleGenAI({ vertexai: true, project, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
      cheap.push({ name: 'VERTEX', runner: new GeminiToolRunner(vertex as unknown as GeminiGenAiClient, { model: buildModel('AGENTV3_VERTEX_BUILD_MODEL'), timeoutMs: geminiTimeoutMs }) });
    } catch { /* not constructable in this env — skip */ }
  }
  // Gemini direct (GEMINI_API_KEY).
  if (process.env.GEMINI_API_KEY) {
    try {
      const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      cheap.push({ name: 'GEMINI', runner: new GeminiToolRunner(gemini as unknown as GeminiGenAiClient, { model: buildModel('AGENTV3_GEMINI_BUILD_MODEL'), timeoutMs: geminiTimeoutMs }) });
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
  const floorRunners = opts?.allowCheapFloor ? cheapBuildFloorRunners({ free: opts?.free, flagshipOnly: opts?.flagship }) : [];
  // Claude-only env shortcut — but NEVER for a weak/noClaude build (the guarded chain below handles it;
  // a weak build with no non-Claude provider was already refused upstream as WEAK_ENGINE_UNAVAILABLE).
  if (cheap.length === 0 && floorRunners.length === 0 && opts?.noClaude !== true) return makeResilientTurnRunner(new ClaudeClient(undefined, buildRetry)); // Claude-only env
  const claude: NamedRunner = { name: 'CLAUDE', runner: new ClaudeClient(undefined, buildRetry) };
  // P7 failover hardening: a final Claude-HAIKU backstop that FORCES the Haiku model
  // regardless of the turn's requested model. It only ever runs after every prior provider
  // (Vertex → Gemini → primary Claude) has thrown, so normal builds are unaffected — but if
  // Sonnet/Opus is overloaded or rate-limited, Haiku still completes the turn and the build
  // never breaks. Billing is unchanged (Opus-equivalent markup, D5/D6) regardless of which
  // model actually answers. AGENTV3_DISABLE_HAIKU_BACKSTOP=1 removes it if ever needed.
  const haikuBackstop: NamedRunner = { name: 'CLAUDE_HAIKU', runner: forceModelRunner(new ClaudeClient(undefined, buildRetry), haikuModel()) };
  const withBackstop = envFlag('AGENTV3_DISABLE_HAIKU_BACKSTOP') ? [] : [haikuBackstop];
  // Builds run on CLAUDE FIRST (Haiku/Sonnet/Opus do REAL tool-use → real files). Gemini/Vertex CAN
  // hallucinate in the tool-use loop — reply describing files ("creating index.html…") without ever
  // calling write_file — which is why they were EXCLUDED entirely from the build chain for a while
  // (a REAL past incident: every build silently on Gemini/Vertex with ZERO files).
  //
  // NOW DEFAULT-ON as the TRUE LAST RESORT — the explicit, informed admin go-ahead this comment used
  // to demand was given on 2026-07-07 ("jab sab fail ho jaye to last me gemini/vertex se try
  // karwao"), during a real outage where GLM/KIMI were timing out AND the Anthropic account was out
  // of credits — every build died with NO final resort. Vertex/Gemini only ever run after every
  // prior provider (cheap floor → CLAUDE → forced-Haiku backstop) has thrown, and the old incident's
  // failure mode is now caught by the safety nets built since: the empty-build retry-on-stronger-
  // model net, the mandatory readiness gate, and the tsc verification gate — a zero-file hallucinated
  // "build" cannot ship as success anymore. AGENTV3_BUILD_ALLOW_GEMINI=0/off rolls back the exclusion.
  const fallback = geminiLastResortEnabled(process.env.AGENTV3_BUILD_ALLOW_GEMINI) ? cheap : [];
  const claudeFirst = resolveClaudeFirst(opts?.claudeFirst, process.env.AGENTV3_BUILD_CLAUDE_FIRST);
  // NOTE: fallback (Vertex/Gemini) sits AFTER withBackstop in the claudeFirst branch — Claude and its
  // forced-Haiku backstop are exhausted FIRST, Vertex/Gemini is the absolute last resort, matching the
  // requested chain "CLAUDE_HAIKU/sonnet (by complexity) -> vertex/gemini". The claudeFirst===false
  // branch is a DIFFERENT, separately-opted-into cost strategy (try the cheap model before Claude) —
  // left unchanged; the admin's chain applies to the default (claudeFirst===true) path.
  const baseChain = claudeFirst ? [claude, ...withBackstop, ...fallback] : [...fallback, claude, ...withBackstop];
  // FREE-TIER cheap-only (admin 2026-07-10, amended 2026-07-13): a not-yet-paying user's build runs on
  // the cheap floor first — Sonnet/Opus NEVER — with Vertex/Gemini and (since the 2026-07-13 Haiku
  // amendment) the model-pinned Claude-HAIKU backstop as the graduated last resorts, so NavBharatAI's
  // premium Claude budget is never spent on a free build (Haiku is the one authorized, cheap exception).
  // Guarded so it can only take effect when a floor actually exists (floorRunners non-empty); if the
  // caller asks for cheapOnly with no floor configured we fall back to the normal chain rather than
  // build an empty (always-failing) chain. When the cheap build can't deliver, the route converts the
  // user to paid (upsell) instead of rescuing on Sonnet.
  const cheapOnly = opts?.cheapOnly === true && floorRunners.length > 0;
  // Cheap floor LEADS when active; [] → `[...[], ...baseChain]` is byte-for-byte today's chain.
  // Claude + Haiku backstop remain inside baseChain, so failures always fall back safely.
  //
  // FREE-TIER last resort ladder (Model Routing Policy, admin 2026-07-12 + HAIKU AMENDMENT 2026-07-13):
  // a free/weak cheap-only build climbs GLM/Kimi → Vertex/Gemini → **Claude HAIKU as the absolute LAST
  // rung** (admin verbatim: "weak module me claude haiku add kar de? to last me. par sart yeh hai …
  // haiku ke alawa kuch aur nahi chalna chahiye, matlab sonnet ya opus never never"). The Haiku rung is
  // the forced-Haiku backstop — model-pinned by forceModelRunner, so it can never run Sonnet/Opus — and
  // enforceNoClaude + the ClaudeClient zone chokepoint below independently guarantee the "never never".
  // Non-free cheap-only gets floor → Haiku (no Vertex/Gemini — unchanged policy for that path).
  // VERTEX/GEMINI AS A CHEAP-FLOOR PEER (admin 2026-07-20 "GLM fail ho to Kimi AUR Vertex dono"): on a
  // floor-led paid build, try Vertex/Gemini right after GLM/Kimi and BEFORE Claude — the same order the
  // free tier already uses. Only when a floor is active, claudeFirst, the fallback (Vertex/Gemini) exists,
  // and the peer flag is on; otherwise today's chain (Vertex/Gemini as the absolute last resort) stands.
  const vertexPeer = vertexPeerBuildEnabled(process.env.AGENTV3_VERTEX_PEER)
    && floorRunners.length > 0 && fallback.length > 0 && claudeFirst && !cheapOnly;
  const chain = cheapOnly
    ? (opts?.free ? [...floorRunners, ...cheap, ...withBackstop] : [...floorRunners, ...withBackstop])
    : vertexPeer
      ? [...floorRunners, ...fallback, claude, ...withBackstop] // GLM → Kimi → Vertex/Gemini → Claude → Haiku
      : [...floorRunners, ...baseChain];
  // UNBREAKABLE WEAK-MODULE GUARD (admin absolute rule 2026-07-13, HAIKU AMENDMENT same day): a
  // weak/noClaude build can NEVER touch Sonnet/Opus. enforceNoClaude strips 'CLAUDE' from the FINAL
  // chain no matter how it was assembled — so even a heal gate that forgot to set cheapOnly cannot leak
  // a Sonnet call onto a free build — and keeps ONLY the model-pinned 'CLAUDE_HAIKU' backstop, moved to
  // the END ("haiku … to last me"). Weak order: cheap floor → Vertex/Gemini → Haiku last.
  const guardedChain = enforceNoClaude(chain, opts?.noClaude === true);
  return makeMultiProviderTurnRunner(guardedChain, {
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
    // Billing Phase 3 — forward per-turn (provider, tokens) to the caller's ProviderUsageLedger.
    ...(opts?.onTurnComplete ? { onTurnComplete: opts.onTurnComplete } : {}),
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

/**
 * The provider NAMES the Grok plan chain may contain (pure — the unit-testable invariant behind
 * grokPlanRunner). WEAK ⇒ NO CLAUDE, EVER: on a noClaude build the plan chain is Grok ALONE — the
 * Claude fallback rung is not merely deprioritised, it does not exist. Audit 2026-07-13 confirmed
 * the leak this kills: this chain is assembled OUTSIDE buildTurnRunner, so enforceNoClaude never
 * saw it, and one Grok timeout ran a weak (free) build's plan turn on a real Claude call.
 */
export function planRunnerChainNames(noClaude: boolean): string[] {
  return noClaude ? ['GROK'] : ['GROK', 'CLAUDE'];
}

/**
 * Fix 62 (admin real run 2026-07-14) — NEVER surface a raw provider/infra error to an end user's chat.
 * The E2B 403 "team is blocked: missing payment method" was shown verbatim: it leaks the infra vendor,
 * alarms the user ("missing payment method" reads as THEIR billing problem), and — for a clone error —
 * can echo a token-embedded URL (a real secret leak). These pure helpers give the user a clean, honest
 * message; the RAW error still goes to the build report / logs (admin-only) for debugging.
 */
// The White-Label Law anonymizer (`redactProviderError`) moved to ../lib/providerRedaction (rule 4 —
// centralised so the chat/error surface AND the build-report anonymiser [Fix 68] apply the SAME redaction by
// construction, never a drifted copy). Imported above and re-exported here so existing importers/tests are
// unaffected. Admin-only surfaces (build diagnostics for the admin, logs, telemetry) keep the real names.
export { redactProviderError };

/**
 * Fix 68 — who may see the RAW build report (with real provider/model names). Only the admin; every normal end
 * user gets the provider-anonymous view (userFacingReport). Checked against the VERIFIED email (never a spoofable
 * query param). Env `AGENTV3_REPORT_ADMINS` (comma-separated emails) overrides; unset defaults to the known
 * admins. Fails CLOSED — an unknown/empty email is NOT admin, so a lookup failure yields the anonymized view.
 */
export function isReportAdmin(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;
  const raw = process.env.AGENTV3_REPORT_ADMINS;
  const list = (raw && raw.trim() ? raw : 'aashishcpmt09@gmail.com,doc.asheesh@icloud.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}

/** The user-facing note when the build sandbox can't be set up (any cause). Deliberately carries NO
 *  raw provider text — an end user can't act on an infra/billing issue and must not see one. The real
 *  reason is recorded in the build report (buildDiag detail) for the admin. Pure + exported. */
export function sandboxUnavailableNotice(): string {
  return "Note: the build engine is temporarily unavailable, so I can't create files right now. I can still chat and plan with you — please try building again in a little while.";
}

/**
 * Full Team mid-build steering (Fix 60) — pure gates, exported for unit tests.
 * Steering is the FULL TEAM ('max') tier's premium capability: the gate runs on the BUILD's
 * resolved power level (what the engine actually runs), so a hand-crafted request from a
 * lower tier can never reach it.
 */
export function steerAllowedForBuild(powerLevel: string | undefined | null): boolean {
  return powerLevel === 'max';
}

/** Normalise a steering message: trim, refuse empty/non-string, cap at 2000 chars. */
export function sanitizeSteerMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > 2000 ? t.slice(0, 2000) : t;
}

function grokPlanRunner(opts?: { noClaude?: boolean }): TurnRunner | null {
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
    // Chain membership comes from planRunnerChainNames (the pure, tested invariant): on a noClaude
    // build the chain is Grok ALONE — a Grok failure surfaces as a plan error handled best-effort by
    // the caller, never a Claude call.
    const chain: NamedRunner[] = [grok];
    if (planRunnerChainNames(opts?.noClaude === true).includes('CLAUDE')) {
      chain.push({ name: 'CLAUDE', runner: new ClaudeClient(undefined, { maxRetries: 2 }) });
    }
    return makeMultiProviderTurnRunner(chain, {
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
  return envFlag('AGENTV3_ESCALATION');
}

/**
 * Whether escalation is ACTIVE for a specific build — the flag AND the percentage canary
 * (T1-escalation-on). With AGENTV3_ESCALATION=on and no AGENTV3_ESCALATION_PCT this is 100%
 * (identical to the old "on" semantics); with PCT=N only ~N% of workspaces (stable hash
 * bucket, so a project is consistently in or out) get the ladder. CRITICAL INVARIANT: the
 * SAME rollout key must gate BOTH the cheap floor and the escalation retry — a build outside
 * the canary must never lead with a cheap build that has no Sonnet safety net behind it.
 */
export function escalationActiveFor(rolloutKey?: string): boolean {
  return escalationEnabled() && inEscalationRollout(rolloutKey, escalationRolloutPercent());
}

/**
 * Whether THIS build should run through the escalation orchestrator. Only when: the flag is
 * on, we have an analyser verdict, it is NOT power/Only-Opus mode (power bypasses the ladder),
 * and the escalation path actually has a higher tier to climb to. Otherwise the single-build
 * fast path is used (and stays identical to today).
 */
export function shouldEscalateBuild(analysis: AnalysisResult | undefined, onlyOpus: boolean, rolloutKey?: string): boolean {
  if (!escalationActiveFor(rolloutKey)) return false;
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
  const dockerEnabled = envFlag('DOCKER_ENABLED');
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
  // Capability probe — lets the frontend decide whether to show the v5.0 toggle.
  app.get('/api/agentv3/status', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    // `workspaceId` is OPTIONAL (older/other callers that only care "is this account building
    // anything" keep working unchanged). When the caller DOES pass one (the v5.0 panel's
    // auto-resume check), `buildRunningHere` answers "is a build running for THIS session" —
    // the account-wide `buildRunning` stays as-is for backward compatibility, but auto-resume
    // must key off `buildRunningHere`, or a build genuinely still running in a DIFFERENT v5.0
    // session bleeds its progress into whatever session the user currently has open.
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    // CANDIDATE KEYS (2026-07-06, with the dead-Stop/Resume fix): the running build may live under the
    // workspace key, the account key, or the shared 'anon' bucket (verified-identity fallback), and an
    // anon-keyed build's workspace is `agentv3-anon-<sid>` — so `buildRunningHere` checks every
    // candidate with the SESSION-aware match, or auto-resume would never even offer the Resume button
    // for the caller's own anon-keyed build.
    const perWs = perWorkspaceLockEnabled();
    const candidates = buildKeyCandidates(userId, workspaceId, perWs);
    const buildRunning = perWs
      ? countActiveBuildsForUser(runningBuilds.values(), userId) > 0
      : candidates.some((k) => isBuildRunning(k));
    const buildRunningHere = candidates.some((k) => {
      const rb = runningBuilds.get(k);
      if (!rb || rb.ended) return false;
      if (!workspaceId) return true;          // account-wide back-compat (callers without a session)
      if (!rb.workspaceId) return true;       // legacy build without a stamped workspace (back-compat)
      return workspaceSessionsMatch(rb.workspaceId, workspaceId);
    });
    // T0-9 SECURITY (2026-07-14): `billed`/`powerUnlocked` are MONEY/entitlement facts and were computed
    // from the CLAIMED `?userId`/`?email` — so `?userId=<victim>` leaked whether that account had ever
    // purchased (its wallet's paid status). They are now derived from the VERIFIED token only (the client
    // already sends its Bearer token here); an unverified caller gets billed=false/powerUnlocked=false and
    // self-heals on the next token-refresh poll. `enabled`/`buildRunning`/`buildRunningHere` deliberately
    // STAY on the claimed identity — tokenless auto-resume pollers depend on them and they leak nothing
    // cross-user (build presence under a key the caller already supplies), so this never breaks resume.
    const verified = await verifiedIdentity(req);
    const wallet = verified?.uid ? await firestoreWalletReader(getDb())(verified.uid).catch(() => null) : null;
    res.json({
      enabled: isAgentV3Enabled(userId, email),
      ...statusEntitlement(verified, wallet),
      buildRunning,
      buildRunningHere,
      ...agentV3Status(),
      team: agentLifecycle.snapshot(),
    });
  });

  // D7 — list a user's persisted builds (most-recently-updated first) so the client can
  // reload one after a refresh/reconnect. Metadata only (no transcript) for a cheap list.
  app.get('/api/agentv3/conversations', async (req: Request, res: Response) => {
    // SECURITY T0-9 (enumeration fix, Phase-0 Tier-1): LISTING a user's conversations is cross-user data,
    // so the caller is resolved from the VERIFIED Firebase token ONLY — never a claimed ?userId. The old
    // resolveReadIdentity fallback trusted a claimed uid when the token failed to verify, so an unverified
    // caller who knew a victim's uid could enumerate that account's transcripts (titles, timestamps,
    // billed amounts). An unverified/unresolved caller now gets an EMPTY list (not an error), so a real
    // user's History self-heals on the next fetch/reload instead of ever leaking another account — the
    // client already force-refreshes its token for this route (#819). GET-one/delete stay capability-gated
    // (they additionally require the UNGUESSABLE conversation id), so they keep resolveReadIdentity.
    const verified = await verifiedIdentity(req);
    const userId = verified?.uid ?? null;
    const email = verified?.email ?? null;
    // No verified identity, the shared-anon bucket, or a token that failed to verify → empty (never a leak,
    // never a hard error). The anon bucket is likewise never enumerable (would leak every degraded session).
    if (!userId || userId === 'anon') { res.json({ conversations: [] }); return; }
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    try {
      const list = await getConversationStore().listByUser(userId, 50);
      // LIVE-DOT enrichment: mark each session whose workspace has an ACTIVE published deployment
      // (agentv3_deployments, doc ID = workspaceId — one batched read) so the history menu can show
      // a real green "Live" dot. Bounded + best-effort: a deployment-store hiccup must never break
      // or slow the history list, it just omits the dots (honest degradation, not an error).
      const deployments = await Promise.race([
        deploymentStore.getMany(list.map((c) => c.workspaceId)),
        new Promise<Map<string, DeploymentRecord>>((resolve) => setTimeout(() => resolve(new Map()), 3_000)),
      ]).catch(() => new Map<string, DeploymentRecord>());
      res.json({
        conversations: list.map((c) => {
          const dep = c.workspaceId ? deployments.get(c.workspaceId) : undefined;
          const live = isLiveDeployment(dep);
          return {
            id: c.id, title: c.title, status: c.status, workspaceId: c.workspaceId,
            billedUsd: c.billedUsd, createdAt: c.createdAt, updatedAt: c.updatedAt,
            ...(c.pinned ? { pinned: true } : {}),
            ...(live ? { live: true, liveUrl: dep!.url } : {}),
          };
        }),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // D7 — load one persisted build (full transcript) for resume. Owner-only.
  app.get('/api/agentv3/conversations/:id', async (req: Request, res: Response) => {
    const { userId, email } = await resolveReadIdentity(req); // SECURITY (C1 follow-up): verified token, not query.userId
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
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
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
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
          // GA-1 — cascade purge: delete the conversation AND every per-workspace store it owned
          // (files/plan/memory/diagnostics/deployment). conversationId === workspaceId (#837), so the
          // shallow store.remove used to orphan all of that data forever. Best-effort; never throws.
          const purge = await purgeWorkspace({
            removeConversation: (id) => store.remove(id),
            purgeFiles: purgeWorkspaceFiles,
            deletePlan: deleteProjectPlan,
            deleteMemory: deleteWorkspaceMemory,
            deleteDiagnostics: deleteDiagnostics,
            deleteDeployment: (id) => deploymentStore.delete(id),
          }, cid);
          if (!purge.ok) {
            const failed = purge.stores.filter((s) => !s.ok).map((s) => s.store).join(', ');
            console.warn(`[AGENTV3] purgeWorkspace ${cid}: some stores failed (${failed}) — conversation removed, orphans may remain.`);
          }
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

  // Pin / unpin one persisted build (history-menu "pin" action). Owner-only — the same
  // conversationAccess() ownership check + candidate-id resolution as delete. Pinning applies a
  // pinned-only patch that PRESERVES the record's updatedAt (pinning is not "activity"), so a pinned
  // build keeps its real last-worked time and only its list POSITION changes (pinned float to top).
  app.post('/api/agentv3/conversations/:id/pin', async (req: Request, res: Response) => {
    const { userId, email } = await resolveReadIdentity(req); // verified token, not query.userId
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    const pinned = req.body?.pinned !== false; // default true; pass { pinned: false } to unpin
    try {
      const store = getConversationStore();
      let updated = false;
      let forbidden = false;
      for (const cid of candidateConversationIds(req.params.id, userId)) {
        const rec = await store.get(cid).catch(() => null);
        const access = conversationAccess(rec, userId);
        if (access === 'ok' && rec) {
          // Preserve updatedAt — pinning must not bump the "last worked on" time or reorder by recency.
          await store.update(cid, { pinned, updatedAt: rec.updatedAt }).catch(() => { /* best-effort */ });
          updated = true;
        } else if (access === 'forbidden') {
          forbidden = true;
        }
      }
      if (!updated && forbidden) {
        res.status(403).json({ error: 'This build belongs to another account.' });
        return;
      }
      if (!updated) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      res.json({ ok: true, pinned });
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
    // Audit finding #3: this used to compare the admin PASSWORD against `?admin=` in the URL, which
    // wrote that password into every access log. It now takes the same expiring, constant-time admin
    // token the panel uses. Losing the query path only costs the admin the THROTTLE bypass — the
    // diagnosis itself is still served, and a throttled probe returns an honest message.
    const adminOk = adminRequestOk(req);
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
  // v5.0 hit: provider fallbacks, tool errors, "replied without building" nudges, readiness
  // blockers, sandbox problems). Owner-scoped (keyed by the caller's userId). The v5.0 panel's
  // "Download report" button reads this so the admin can hand the JSON to Claude for fixes.
  // REPORT TO ADMIN (admin 2026-07-29): the user no longer downloads/copies their build report — a
  // single "Report" button submits it to the admin inbox. The report is resolved SERVER-side (same
  // sources as the diagnostics GET) and snapshotted into admin_build_reports; the user gets only an
  // { ok } acknowledgement, never the content. Ownership is enforced from the VERIFIED token, never
  // the request body, so a user can only report their OWN build (no IDOR). Honest: if there is no
  // report yet, or the save genuinely fails, we say so — never a fake "sent".
  app.post('/api/agentv3/report-to-admin', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { workspaceId?: string; buildId?: string; activeBuildId?: string; promptHash?: string };
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const buildId = typeof body.buildId === 'string' && body.buildId ? body.buildId : '';
    const verifiedUid = await verifyFirebaseToken(req);
    // Ownership: a workspace-scoped report requires read access to that workspace (grants the
    // unguessable anon-workspace capability case too, mirroring the diagnostics GET).
    if (workspaceId && !verifiedWorkspaceReadOk(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'This build report belongs to another account.' });
      return;
    }
    // Resolve the report from the same durable sources the download used.
    let report: BuildDiagnosticsReport | null = null;
    if (workspaceId && buildId) {
      // A build PICKED from the report list. The user chose this one deliberately — resolve exactly
      // it, and fail honestly rather than silently falling back to "latest", which would send us a
      // report about a different build than the one they are complaining about.
      report = await getDiagnosticsHistoryItem(workspaceId, buildId).catch(() => null);
      if (!report) {
        res.status(404).json({ error: 'That build\'s report is no longer available — please pick another build.' });
        return;
      }
    }
    // P0 SIBLING (2026-08-04): the download path validates every fallback candidate against the
    // ACTIVE build the client is looking at (its buildId + promptHash) so a stale report for a
    // DIFFERENT app can never be exported. This submit path was built later and dropped the guard —
    // the client was already sending `activeBuildId`/`promptHash` and the server ignored both, so
    // "Report" on the build in front of you could quietly submit a previous app's report and send us
    // to debug the wrong thing. Same expectation object, same accept/reject rule.
    const submitExpect: ActiveBuildExpectation = {
      buildId: typeof body.activeBuildId === 'string' && body.activeBuildId ? body.activeBuildId : undefined,
      promptHash: typeof body.promptHash === 'string' && body.promptHash ? body.promptHash : undefined,
      workspaceId: workspaceId || undefined,
    };
    // Only guard the FALLBACK chain: an explicitly picked past build is, by definition, not the
    // active one, and rejecting the user's own choice for not being "current" would be the bug.
    const strictSubmit = !buildId && hasActiveBuildExpectation(submitExpect);
    const acceptSubmit = (r: BuildDiagnosticsReport | null | undefined): BuildDiagnosticsReport | null => {
      if (!r) return null;
      if (strictSubmit && !reportMatchesActiveBuild(r, submitExpect).ok) {
        audit('AGENTV3_REPORT_IDENTITY_MISMATCH', { workspaceId, wantBuildId: submitExpect.buildId, gotBuildId: r.buildId }, 'warn');
        return null;
      }
      return r;
    };
    if (!report && workspaceId) report = acceptSubmit(await loadDiagnostics(workspaceId).catch(() => null));
    if (!report && verifiedUid) report = acceptSubmit(lastDiagnostics.get(verifiedUid) ?? null);
    if (!report && verifiedUid) report = acceptSubmit(await loadLatestForUser(verifiedUid).catch(() => null));
    if (!report) {
      res.status(404).json({ error: 'No build report yet — build an app first, then send the report.' });
      return;
    }
    const email = verifiedUid ? await resolveVerifiedEmail(verifiedUid).catch(() => null) : null;
    const name = verifiedUid ? await resolveVerifiedName(verifiedUid).catch(() => null) : null;
    // THE WHOLE SESSION, not one turn (admin 2026-08-09: "puri report, sabhi edit sath 0 to 100 admin
    // ko send ho"). A user builds and then edits many times; the failure they report is usually
    // explained by an EARLIER turn — which a single-build record threw away, leaving the admin to
    // debug with a fraction of the evidence. Gather every build of this workspace exactly the way the
    // admin download route does (durable history + the latest, de-duplicated by start time, ordered
    // oldest → newest). Best-effort: if history cannot be read, the record is exactly what it was
    // before — one honest build, never a fake or partial "session".
    const wsForSession = workspaceId || report.workspaceId || '';
    let sessionBuilds: BuildDiagnosticsReport[] = [];
    if (wsForSession) {
      try {
        const metaList = await listDiagnosticsHistory(wsForSession, 20).catch(() => []);
        const full = (await Promise.all(
          metaList.map((h) => getDiagnosticsHistoryItem(wsForSession, h.id).catch(() => null)),
        )).filter(Boolean) as BuildDiagnosticsReport[];
        const byStart = new Map<number, BuildDiagnosticsReport>();
        for (const r of full) byStart.set(r.startedAt, r);
        // The report in hand is the freshest truth for its own slot — and covers the case where the
        // latest build is not in durable history yet.
        byStart.set(report.startedAt, report);
        sessionBuilds = [...byStart.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      } catch { sessionBuilds = []; }
    }
    const record = buildAdminReportRecord(report, {
      userId: verifiedUid ?? null,
      email,
      name,
      workspaceId: workspaceId || report.workspaceId || null,
      buildId: buildId || report.buildId || null,
      reportedAt: Date.now(),
    }, sessionBuilds);
    const saved = await saveAdminBuildReport(record);
    if (!saved) {
      res.status(502).json({ error: 'Could not send the report right now — please try again in a moment.' });
      return;
    }
    try { audit('AGENTV3_REPORT_TO_ADMIN', { userId: verifiedUid ?? undefined, workspaceId: record.meta.workspaceId ?? undefined, ok: record.meta.ok ?? undefined }); } catch { /* never throws */ }
    res.json({ ok: true });
  });

  /**
   * Is this app ready to be PUBLISHED, as far as data is concerned? (admin 2026-08-06)
   *
   * WHY AT DEPLOY AND NOWHERE ELSE. A preview database is a throwaway — the sandbox makes one, the data
   * dies with it, and asking a user to go and open a database account before they have even seen their
   * app is friction with nothing behind it. Publishing is the opposite: the sandbox does not come along,
   * so an app that saves data and has no database becomes a LIVE site where every signup, order and
   * booking fails. That is the one moment the question is worth interrupting for — once.
   *
   * Read-only and owner-gated. It answers with facts (does the app store data, is a database connected,
   * could we create one right now) and NEVER acts; the acting is the user's next click.
   */
  app.get('/api/agentv3/database-readiness', async (req: Request, res: Response) => {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required' }); return; }
    if (!await assertVerifiedWorkspaceOwner(req, workspaceId)) {
      res.status(403).json({ error: 'Not your workspace.' });
      return;
    }
    const uid = await verifyFirebaseToken(req);
    const files = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
    // A signed-out user has no vault and no Supabase grant — the honest answer is "not connected, and
    // we cannot create one either", which the client turns into "sign in / connect your own".
    const vaultSecrets = uid ? await loadUserVaultSecrets(uid).catch(() => ({} as Record<string, string>)) : {};
    const supabaseConnected = uid ? !!(await getConnection(uid).catch(() => null))?.orgId : false;
    res.json(databaseReadiness({
      files,
      vaultSecrets,
      dbEnvNames: ALL_DB_ENV_VARS,
      providerLabel: (id) => dbProvider(id)?.label ?? null,
      supabaseConnected,
    }));
  });

  app.get('/api/agentv3/diagnostics', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    // SECURITY Phase 3.2 (IDOR) — a build report is PRIVATE. Until now this route had NO ownership
    // check: anyone who learned a workspaceId (e.g. via the now-closed enumeration leak) could
    // download another user's full report — generated source, prompts, errors. Two guards:
    //  • workspace-scoped read (history / session / buildId / latest-by-workspace): require ownership
    //    of the workspaceId. assertWorkspaceOwner grants the anon-capability case too (an
    //    agentv3-anon-* workspace is reachable by its unguessable id), so Fix-26 report downloads work.
    //  • per-user fallback (no workspaceId → loadLatestForUser / in-memory): resolve the owner from the
    //    VERIFIED token below, NEVER the query userId — else `?userId=victim` fetched victim's report.
    const verifiedReportUid = await verifyFirebaseToken(req);
    // Fix 68 (White-Label Law §3) — only the ADMIN sees the raw report with real provider/model names; every
    // normal user gets the provider-anonymous view. Resolve the VERIFIED email (never the spoofable query
    // param) and fail CLOSED (no email / lookup failure ⇒ anonymized).
    const showProviderDetail = isReportAdmin(await resolveVerifiedEmail(verifiedReportUid ?? '').catch(() => null));
    if (workspaceId && !verifiedWorkspaceReadOk(verifiedReportUid, workspaceId)) {
      res.status(403).json({ error: 'This build report belongs to another account.' });
      return;
    }
    // History list (P-REPORT.4): "the report vanished when the next build started" — past builds'
    // reports are kept in a bounded per-workspace history, independent of whichever build most
    // recently overwrote the "latest" doc below. Metadata only (cheap); fetch one in full via buildId.
    if (req.query.history === '1') {
      if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
      const history = await listDiagnosticsHistory(workspaceId).catch(() => []);
      // Fix 68 — the history metadata carries summary/rootCause, which we author and can name a provider; a
      // non-admin gets those scrubbed (the full report is anonymized separately when fetched by id).
      const historyOut = showProviderDetail
        ? history
        : history.map((h) => ({ ...h, summary: h.summary === undefined ? undefined : redactProviderError(h.summary), rootCause: h.rootCause === undefined ? undefined : redactProviderError(h.rootCause) }));
      res.json({ history: historyOut });
      return;
    }
    // REPORT PICKER (admin 2026-08-04): "Report" used to be able to send only the LATEST build, so a
    // bug from three edits ago was unreportable — the user clicked Report and we received a report
    // about a different, working build. This lists the workspace's past builds so they can point at
    // the one that actually broke.
    //
    // A SEPARATE mode from `history=1` on purpose. The report is admin-only (2026-07-29): the user
    // submits it and never reads it. `history=1` carries our analysis (summary, root cause, issue
    // counts) and stays as it was for admin tooling; this mode returns ONLY what the user already
    // knows — when it ran, what they asked for, whether it worked — via the one tested strip
    // (`pickerItems`), so a field added to the history entry later cannot leak onto a user's screen.
    if (req.query.picker === '1') {
      if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
      const entries = await listDiagnosticsHistory(workspaceId).catch(() => []);
      res.json({ builds: pickerItems(entries) });
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
      // FALLBACK — the exact "build report ban hi nahi rahi / No build report yet" the admin hit on a
      // real, successful build (2026-07-06): this workspaceId's history can be EMPTY even though the
      // user has a durable last-build report — an anon-degraded build saved under `agentv3-anon-*`, or a
      // fresh session minted a NEW workspaceId. The non-scope path already recovers via loadLatestForUser
      // (see below); the session download forgot it and 404'd → the client's blanket "No build report
      // yet". Mirror that per-user fallback so the whole-session download never falsely reports "none".
      if (byStart.size === 0) {
        const perUser = await loadLatestForUser(verifiedReportUid).catch(() => null); // verified uid, not query (Phase 3.2)
        // P0 — only splice the per-user fallback in when it belongs to the ACTIVE build the client asked
        // for; otherwise it could be the user's last build of a DIFFERENT app (the reported bug).
        const sessExpect: ActiveBuildExpectation = {
          buildId: typeof req.query.activeBuildId === 'string' && req.query.activeBuildId ? req.query.activeBuildId : undefined,
          promptHash: typeof req.query.promptHash === 'string' && req.query.promptHash ? req.query.promptHash : undefined,
          workspaceId: workspaceId || undefined,
        };
        if (perUser && (!hasActiveBuildExpectation(sessExpect) || reportMatchesActiveBuild(perUser, sessExpect).ok)) {
          byStart.set(perUser.startedAt, perUser);
        }
      }
      const ordered = [...byStart.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      if (ordered.length === 0) { res.status(404).json({ error: 'No build diagnostics yet — run a build first.' }); return; }
      // Byte-budget the payload (newest builds kept whole, oldest dropped, honestly counted) — an
      // unbounded 20-full-report stitch was tens of MB and died in mobile Safari ("Load failed").
      const { kept, omitted } = capSessionReports(ordered);
      // Fix 68 — non-admin users get the provider-anonymous view of every build in the session.
      const sessionOut = showProviderDetail ? kept : kept.map(userFacingReport);
      if (req.query.format === 'text') {
        res.type('text/plain').send(renderSessionDiagnosticsText(sessionOut));
        return;
      }
      res.json({ session: { builds: sessionOut, count: ordered.length, omittedBuilds: omitted } });
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
      // P0 (2026-07-12) — the client echoes the ACTIVE build's identity (its unique buildId + promptHash,
      // from the build's `build_meta`/`result` events). Every candidate source below is VALIDATED against
      // it, so the export can only ever return the report for THAT build — never a previous, different
      // app's report (the Jungle-Runner-for-Expense-Tracker bug). When no identity is asserted (a legacy
      // client), the checks are inert and resolution behaves exactly as before.
      const expect: ActiveBuildExpectation = {
        // `activeBuildId` (distinct from the history-item `buildId` param above) = the unique id of the
        // build the client is currently looking at, echoed from its `build_meta`/`result` events.
        buildId: typeof req.query.activeBuildId === 'string' && req.query.activeBuildId ? req.query.activeBuildId : undefined,
        promptHash: typeof req.query.promptHash === 'string' && req.query.promptHash ? req.query.promptHash : undefined,
        workspaceId: workspaceId || undefined,
      };
      const strict = hasActiveBuildExpectation(expect);
      // Accept a candidate only if it matches the asserted active build; a mismatch is DROPPED (never
      // returned), so a stale/other-app report can't leak through any fallback tier.
      const accept = (r: BuildDiagnosticsReport | null | undefined): BuildDiagnosticsReport | null => {
        if (!r) return null;
        if (strict) {
          const m = reportMatchesActiveBuild(r, expect);
          if (!m.ok) { audit('AGENTV3_REPORT_IDENTITY_MISMATCH', { workspaceId, wantBuildId: expect.buildId, gotBuildId: r.buildId, reason: m.reason }, 'warn'); return null; }
        }
        return r;
      };
      // Prefer the DURABLE (Firestore) copy keyed by workspaceId: freshest authoritative copy — survives
      // instance rotation AND carries PREVIEW errors appended after the build.
      if (workspaceId) report = accept(await loadDiagnostics(workspaceId).catch(() => null));
      // Per-user fallbacks are keyed to the VERIFIED uid (Phase 3.2) — never the spoofable query userId.
      if (!report && verifiedReportUid) report = accept(lastDiagnostics.get(verifiedReportUid));
      // Durable per-USER fallback (P-REPORT.5): survives cold starts / new sessions — but ONLY returned
      // when it belongs to the active build (the identity check above), so it can never leak the user's
      // last build of a DIFFERENT app.
      if (!report) report = accept(await loadLatestForUser(verifiedReportUid).catch(() => null));
      if (!report) {
        // Strict + nothing matched → the report for THIS build isn't available yet. ABORT honestly rather
        // than hand back whatever last report happened to exist (a different build/app).
        if (strict) { res.status(409).json({ error: 'The report for this build is not ready yet — wait for the build to finish, then export again.', code: 'BUILD_REPORT_NOT_READY' }); return; }
        res.status(404).json({ error: 'No build diagnostics yet — run a build first.' }); return;
      }
    }
    // SECURITY Phase 2.1 — redact secrets on the OUTPUT path too. Durable copies are already redacted
    // at save, but the in-memory `lastDiagnostics` fallback (line above) holds the RAW build report;
    // masking here guarantees no download — JSON or text — ever emits a key/token, whatever its source.
    // Idempotent over an already-redacted copy (a mask contains no secret shape to re-match).
    report = redactReportSecrets(report);
    // Fix 68 — a normal user gets the provider-anonymous view (real provider/model names, telemetry and
    // routing manifest are admin-only). Applied after secret-redaction so BOTH the text and JSON renders below
    // carry the anonymized report.
    if (!showProviderDetail) report = userFacingReport(report);
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
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    // SECURITY Phase 3.2 (IDOR) — the decision trace reveals a build's intent/model/outcome and is
    // owner-private. This route had NO ownership check; add the STRICT verified-owner read gate
    // (anon-capability preserved — an agentv3-anon-* workspace is reachable by its unguessable id).
    if (!verifiedWorkspaceReadOk(await verifyFirebaseToken(req), workspaceId)) {
      res.status(403).json({ error: 'This decision trace belongs to another account.' });
      return;
    }
    const decisions = await getDecisionTrace(workspaceId);
    if (!decisions || decisions.length === 0) { res.status(404).json({ error: 'No decision trace yet — run a build first.' }); return; }
    res.json({ decisions });
  });

  // Capture a PREVIEW failure (in-browser srcdoc / live runtime) reported by the client into the
  // build's diagnostics report — so a build that "succeeded" but doesn't actually render shows the
  // REAL preview error in the downloadable report (no separate screenshot needed). The build is
  // already finished, so we append to the durable (workspace-keyed) report and the in-memory copy.
  // Best-effort + owner-scoped; never throws.
  // SEPARATE-BACKEND DEPLOY (slice 4, admin 2026-08-02): trigger a REAL deploy of the user's Node/Express
  // backend to Render via the Render API + RENDER_API_KEY. Honest — no fake success: reports not-configured
  // (no key), no-service (repo not connected yet in Render, one-time), or a real live URL on success.
  app.post('/api/agentv3/deploy-backend', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const platform = typeof req.body?.platform === 'string' ? req.body.platform : 'render';
    const repoUrl = typeof req.body?.repoUrl === 'string' ? req.body.repoUrl : undefined;
    const appName = typeof req.body?.appName === 'string' ? req.body.appName : undefined;
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' }); return; }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    // Only Render is a wired backend host today; others still use the config-inject + GitHub-connect path.
    if (platform !== 'render') { res.status(400).json({ error: `Backend one-click deploy isn't wired for "${platform}" yet — push to GitHub and connect it on your host (the config was already added).` }); return; }
    // THE USER'S OWN RENDER KEY, NOT OURS (root-caused 2026-08-07). The gate used to ask only
    // `renderConfigured()` — i.e. the SERVER's env — while the refusal it returned told the user to
    // "Set RENDER_API_KEY (Settings → Secrets & API Keys)". Nothing read that vault entry, so a user who
    // followed the instruction exactly got the identical refusal back: an instruction the app did not
    // implement. Beyond the wrong words, deploying every user's backend with one server-side key would
    // put all of them in a single Render account billed to whoever owns it — against the standing rule
    // that user apps run on the USER's own account. Their key is preferred; ours only backstops.
    const renderVault = userId ? await loadUserVaultSecrets(userId).catch(() => null) : null;
    const renderKey = resolveRenderKey(renderVault);
    if (!renderKey) { res.status(503).json({ ok: false, reason: 'not-configured', error: renderRequirement(process.env, renderVault) }); return; }
    try {
      const result = await deployBackendToRender({ repoUrl, appName, apiKey: renderKey.key });
      res.status(result.ok ? 200 : 409).json(result);
    } catch (e) {
      res.status(502).json({ ok: false, reason: 'api-error', error: `Render deploy failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  app.post('/api/agentv3/preview-error', previewPollRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const source: 'in-browser' | 'live' = req.body?.source === 'live' ? 'live' : 'in-browser';
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 4000) : '';
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' }); return; }
    if (!workspaceId || !message) { res.status(400).json({ error: 'workspaceId and message are required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    // SECURITY (T0-9): the per-USER "latest report" slot is keyed off the VERIFIED uid, NEVER the claimed
    // body.userId. Since assertWorkspaceOwner passes for ANY caller on an agentv3-anon-* workspace, keying
    // that slot by the claim let an attacker (owning their own anon workspace) set body.userId=<victim> and
    // OVERWRITE the victim's downloadable "latest build report" with attacker-supplied content. The
    // workspace-keyed durable copies below stay workspace-scoped (already ownership-checked); only this
    // user-keyed copy was spoofable. An anon caller has no verified uid → the shared 'anon' slot, as before.
    const reportUid = (await verifiedIdentity(req))?.uid ?? null;
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
      const mem = lastDiagnostics.get(reportUid ?? 'anon');
      if (mem) lastDiagnostics.set(reportUid ?? 'anon', append(mem));
      // Update the durable copy so the download/copy reflects it even after an instance rotation.
      //
      // EVIDENCE MUST NEVER FORK (jungle-game reports, 2026-07-12): when the durable read returned
      // null this whole block silently no-op'd — the error then lived ONLY in this instance's memory,
      // so one download (memory path) showed the PREVIEW_ERROR while the session-stitch download
      // (durable history) said "0 errors / BUILD_SUCCESS" — two different stories for one build, and
      // the second one hid the bug entirely. Fall back to the IN-MEMORY report as the base (same
      // build — it was just updated above) so the append always lands durably; only when NEITHER copy
      // exists is there genuinely nothing to attach to (and we say so instead of a blind ok:true).
      const durable = await loadDiagnostics(workspaceId).catch(() => null);
      const base = pickPreviewErrorBase(durable, mem ?? null, workspaceId);
      if (base) {
        const withPreviewError = append(base);
        // LOUD failures (same discipline as DiagnosticsStore's own saves): silently-swallowed saves
        // here are exactly how the durable copies quietly diverged from memory.
        await saveDiagnostics(workspaceId, withPreviewError).catch((e) => {
          console.error(`[DIAGNOSTICS] preview-error append: saveDiagnostics failed (workspace=${workspaceId}): ${e instanceof Error ? e.message : String(e)}`);
        });
        // Refresh the SAME history entry (same startedAt → same id) with the late-arriving preview
        // error, so a build's history record isn't missing evidence captured after it settled.
        await saveDiagnosticsHistory(workspaceId, withPreviewError).catch((e) => {
          console.error(`[DIAGNOSTICS] preview-error append: saveDiagnosticsHistory failed (workspace=${workspaceId}): ${e instanceof Error ? e.message : String(e)}`);
        });
        // Keep the durable per-USER "latest report" in sync too, so a preview error that arrives after
        // the build settled still reaches the userId-keyed copy the report UI falls back to — but ONLY
        // when this workspace IS the user's latest build (same/newer startedAt). This prevents a late
        // preview error from an OLDER workspace regressing the per-user copy to a stale build.
        const perUser = await loadLatestForUser(reportUid).catch(() => null);
        if (!perUser || (withPreviewError.startedAt ?? 0) >= (perUser.startedAt ?? 0)) {
          await saveLatestForUser(reportUid, withPreviewError).catch((e) => {
            console.error(`[DIAGNOSTICS] preview-error append: saveLatestForUser failed (user=${reportUid ?? 'anon'}): ${e instanceof Error ? e.message : String(e)}`);
          });
        }
        res.json({ ok: true });
        return;
      }
      // No report exists anywhere for this workspace (neither durable nor memory) — the error was
      // received but could not be attached. Honest response; the client treats it as best-effort.
      console.error(`[DIAGNOSTICS] preview-error append: no report found to attach to (workspace=${workspaceId})`);
      res.json({ ok: false, reason: 'no report found for this workspace to attach the preview error to' });
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
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' }); return; }
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
        // SELF-HEAL the recurring "No package.json found" (admin, 2026-07-21). A hydrated vite-react
        // project that has real source files but LOST its package.json (a scaffold gap, or a save that
        // dropped it) is RUNNABLE the moment the foundation is synthesized — so heal it here instead of
        // dead-ending the preview with a scary "the project has no defined dependencies" verdict. The
        // build path already runs this; the Diagnose/preview path did NOT, which is why the error kept
        // recurring. ensureViteReactFoundation is idempotent + SELF-GUARDED (isViteReactTarget → no-op for
        // non-React or genuinely-empty projects, so a Vue app is never given a vite package.json, and a
        // truly-empty project still gets the honest missingPreviewReason below). It synthesizes
        // package.json from the code's REAL imports (+ entry/index.html/vite.config as needed). Persist the
        // healed files to the durable store so the fix STICKS across future sandboxes, not just this boot.
        if (Object.keys(saved).length > 0) {
          try {
            const foundation = ensureViteReactFoundation(saved, { framework });
            if (foundation.added.length > 0) {
              Object.assign(saved, foundation.files);
              await mergeWorkspaceFiles(workspaceId, foundation.files).catch(() => {});
              sendStage(`Restoring your project (recovered ${foundation.added.length} missing file(s): ${foundation.added.join(', ')})`, 7);
            }
          } catch { /* foundation heal is best-effort — the structure check below still runs */ }
          // Strip any dangling tsconfig `extends` (an uninstalled bare-package base) so a reopened project
          // whose tsconfig extends a phantom package (e.g. "@tsconfig/react") still boots its dev server.
          if (process.env.AGENTV3_TSCONFIG_SANITIZE !== 'off') {
            try {
              const ts = sanitizeTsconfigExtends(saved);
              if (ts.fixes.length > 0) {
                Object.assign(saved, ts.patch);
                await mergeWorkspaceFiles(workspaceId, ts.patch).catch(() => {});
              }
            } catch { /* best-effort — a bad tsconfig extends just falls through as before */ }
          }
          await writeWorkspaceFiles(actuator, workspaceId, saved);
        }
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
        let reason = structure.issues.join(' ');
        // HONESTY (build-report autopsy 2026-07-06): a MISSING package.json in the (cold/recycled)
        // sandbox is usually a failed RESTORE, not the user's project genuinely lacking one — so don't
        // tell a user whose app really has a package.json that "the project has no defined dependencies".
        // Consult the durable file index (the real source of truth) and report the true cause instead.
        if (!pkgRaw || !pkgRaw.trim()) {
          const durablePaths = await listWorkspaceFilePaths(workspaceId).catch(() => [] as string[]);
          reason = missingPreviewReason(durablePaths);
        }
        finish({ ok: false, portListening: false, reason, detail: '' });
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
      // Fix 32: Diagnose must also boot with the project's OWN run script (dev → start → serve) —
      // an imported app whose script is `start` (CoreUI) otherwise fails here with the same
      // `Missing script: "dev"` the automatic boot hit. Best-effort read; scaffold default on miss.
      const diagPkgRaw = await actuator.readFile(workspaceId, 'package.json').catch(() => null);
      const result = await withTimeout(actuator.runCommand(workspaceId, resolveDevRunCommand(diagPkgRaw)), 90_000, 'preview-diagnose');
      if (heartbeat) clearInterval(heartbeat);
      sendStage('Running the health check', 85);
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      const { up, port } = parseDevServerHealthCheck(combined);
      const boundPort = port ?? effectivePort;
      if (up) {
        sendStage('Resolving the public preview URL', 95);
        // EARN IT (admin 2026-08-03): a bound port is not the app serving. VISIT the home route and only
        // report "preview restored" when it renders — otherwise Diagnose was greenlighting a server that
        // returns "Cannot GET" on its own client routes (the exact full-stack bug).
        const visit = async (cand: number): Promise<{ url?: string; served: { rendered: boolean; problems: string[] } }> => {
          let url: string | undefined;
          try { url = applyPreviewDomain(await withTimeout(actuator.getPortUrl(workspaceId, cand), 10_000, 'preview-diagnose-url')); } catch { /* URL resolution best-effort — the boot itself already succeeded */ }
          // No URL ⇒ keep the pre-flip semantics (port up, page unverifiable, benefit of the doubt).
          if (!url) return { served: { rendered: true, problems: [] } };
          try { return { url, served: analyzePreviewHtml((await withTimeout(actuator.browseUrl(workspaceId, url), 30_000, 'preview-diagnose-verify')).html) }; }
          catch { return { url, served: { rendered: false, problems: ['the preview could not be reached to verify it'] } }; }
        };
        let winner = await visit(boundPort);
        let winnerPort = boundPort;
        // FLIP SYSTEM (admin 2026-08-07: "ek par na chale to dusra, dusre par na chale to teesra?").
        // Engages ONLY when the first port's page did not render — then the sandbox OS is asked which
        // TCP ports are REALLY listening (a fact, not a guess) and each remaining candidate is visited
        // until one genuinely renders the app. The happy path costs nothing extra; a blind cascade of
        // guesses is exactly what this avoids — every flip target is evidence (a listening port), and
        // every verdict is earned (a rendered page).
        if (winner.url && !winner.served.rendered) {
          let listening: number[] = [];
          try {
            listening = parseListeningPorts((await withTimeout(actuator.runCommand(workspaceId, LISTENING_PORTS_COMMAND), 10_000, 'preview-port-scan')).stdout);
          } catch { /* the scan is best-effort — without it the flip simply has no extra candidates */ }
          for (const cand of rankPortCandidates({ parsed: port, scriptPort, expected: effectivePort, listening, framework })) {
            if (cand === winnerPort) continue;
            const attempt = await visit(cand);
            if (attempt.url && attempt.served.rendered) { winner = attempt; winnerPort = cand; break; }
          }
        }
        const previewUrl = winner.url;
        const served = winner.served;
        finish({
          ok: served.rendered,
          portListening: true,
          port: winnerPort,
          previewUrl,
          reason: !previewUrl
            ? `Dev server is up on port ${winnerPort}, but the public URL could not be resolved yet. Try again in a few seconds.`
            : served.rendered
              ? `Dev server is up on port ${winnerPort} — preview restored.`
              // Task 2 (2026-08-05): the boot log is right here in `combined` — when it NAMES the
              // cause (half-boot on an unreachable database, a missing key), say THAT instead of
              // pointing the user into the log to find something we already computed.
              : halfBootCause(combined)
                ?? `Dev server is up on port ${winnerPort}, but it isn't serving the app's pages yet: ${served.problems[0] || 'no page rendered'}. This is common for a full-stack app whose client routes aren't served (only its API) — the boot log below shows the cause.`,
          detail: combined.slice(-4000),
        });
        return;
      }
      finish({
        ok: false,
        portListening: false,
        port: boundPort,
        // HONEST, ACTIONABLE HEADLINE (mitrify autopsy 2026-08-04). This used to GUESS — "the exact cause
        // is in the detail log below (a crash on boot, a missing dependency, or a port conflict)" — while
        // classifyDevServerFailure already knew the answer deterministically. Worse, a user was made to
        // read a raw log to learn something we had computed. Now the panel states the real cause in plain
        // language, and for the two causes the user can genuinely resolve — a missing key of theirs, or a
        // database — it names the exact screen to go to.
        reason: userFacingPreviewFailure(classifyDevServerFailure(combined), boundPort, combined),
        detail: cleanPreviewLogForUser(combined).slice(-4000),
      });
    } catch (err) {
      if (heartbeat) clearInterval(heartbeat);
      finish({ ok: false, portListening: false, reason: err instanceof Error ? err.message : 'Could not reach the sandbox to diagnose the preview.', detail: '' }, 500);
    }
  });

  // PREVIEW HEALTH — v5.0's self-awareness of whether the preview is actually running. Gathers REAL
  // signals (durable file count → the app survives years; live backend configured?; a warm sandbox's
  // port probe) and classifies the true state: live / sleeping (idle-recycled — reboots on demand) /
  // crashed / inbrowser_only / empty. Deliberately does NOT create a sandbox just to check (that would
  // be wasteful and slow) — a cold workspace reports `sleeping` (rebootable from saved files), which is
  // exactly the "reopen an old chat years later" case: files are safe, the live preview boots on demand.
  app.post('/api/agentv3/preview-health', previewPollRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const framework = typeof req.body?.framework === 'string' ? req.body.framework : 'vite-react';
    if (!isAgentV3Enabled(userId, email)) { res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' }); return; }
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) { res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' }); return; }
    try {
      // hasFiles is DURABLE (Firestore) — true even years later on a long-dead sandbox.
      const fileCount = await raceTimeout(countWorkspaceFiles(workspaceId), 4_000, 'previewHealthFiles').catch(() => 0);
      const diag = sandboxDiag();
      // Only probe the live port when a sandbox is ALREADY warm — never spin one up just to check.
      let livePortUp: boolean | null = null;
      let pageRendered: boolean | null = null;
      let pageProblems: string[] = [];
      if (diag.livePreviewAvailable) {
        try {
          const actuator = buildActuator();
          const sandboxId = actuator.getSandboxId ? await raceTimeout(actuator.getSandboxId(workspaceId), 4_000, 'previewHealthSandbox').catch(() => null) : null;
          if (sandboxId) {
            // THE PORT THE APP REALLY BOUND, not a framework guess. `oneShotDevPort('vite-react')` is
            // 5173, but a full-stack Express app commonly serves everything on its own port (mitrify:
            // 5000) — so the guess probed a port nothing was on, and a perfectly healthy app read as
            // "sleeping". The client sends the live URL it is actually displaying; its port is the
            // ground truth, and the guess stays only as the fallback.
            const port = previewUrlPort(typeof req.body?.previewUrl === 'string' ? req.body.previewUrl : null)
              ?? oneShotDevPort(framework);
            // -L FOLLOWS REDIRECTS and we keep the BODY. Root cause (admin report 2026-08-06): the old
            // probe threw the body away (`-o /dev/null`) and accepted 301/302 as healthy. The app's `/`
            // redirected to /customer/home, we saw 302, called it "live — up and running", and the tab
            // then rendered the raw "Cannot GET /customer/home" page AS the user's app.
            const probe = await raceTimeout(
              actuator.runCommand(workspaceId, `curl -sL --max-time 5 -w "\\n__STATUS__%{http_code}" http://127.0.0.1:${port} 2>/dev/null || echo "__STATUS__000"`),
              10_000, 'previewHealthProbe',
            ).catch(() => ({ stdout: '__STATUS__000', stderr: '', exitCode: -1 }));
            const raw = probe.stdout || '';
            const statusMatch = /__STATUS__(\d{3})\s*$/.exec(raw.trim());
            const code = statusMatch ? Number(statusMatch[1]) : 0;
            const body = statusMatch ? raw.slice(0, raw.lastIndexOf('__STATUS__')) : raw;
            livePortUp = code >= 200 && code < 400;
            if (livePortUp) {
              // EARN THE VERDICT — the same tested analyzer the import boot uses. A 404 / "Cannot GET"
              // / empty shell is NOT a live app, whatever the status line says.
              const verdict = analyzePreviewHtml(body);
              pageRendered = verdict.rendered;
              pageProblems = verdict.problems;
            }
          }
        } catch { /* probe is best-effort — a failure just means "not currently up" (null/false) */ }
      }
      const health = classifyPreviewHealth({
        hasFiles: fileCount > 0,
        liveBackend: diag.livePreviewAvailable,
        livePortUp,
        pageRendered,
        pageProblems,
        everPublished: fileCount > 0, // files exist ⇒ a build ran ⇒ a preview was attempted
        lastError: null,             // a specific crash error only comes from a live boot (Diagnose)
        booting: false,
      });
      // `serving` is what the CLIENT needs to stop presenting a 404 page as the user's app.
      res.json({ ...health, fileCount, serving: pageRendered, servingProblems: pageProblems });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Approve/reject a pending gate (plan mode / permission prompt, P4).
  // T1-ratelimit-all: /respond resolves a pending approval (a state change) — capped like the other
  // workspace endpoints so it can't be hammered.
  app.post('/api/agentv3/respond', workspaceRateLimiter(), (req: Request, res: Response) => {
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
  app.post('/api/agentv3/stop', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const stopWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    // SECURITY T0-9: match the build under the VERIFIED identity it was registered under — never the
    // claimed body.userId, which would let a caller stop ANOTHER account's build by passing its uid
    // (builds are keyed by /chat's resolveBuildIdentity = verified uid, or the anon bucket). The client
    // already sends its Bearer token here for exactly this (the dead-Stop fix); the server just has to
    // honour it. A token that can't be verified resolves to null → only the shared anon bucket, never
    // another user's account key.
    const verifiedStopUid = (await verifiedIdentity(req))?.uid ?? null;
    // CANDIDATE KEYS (admin's dead-Stop fix, 2026-07-06): the build may be registered under the
    // workspace key, the verified account key, OR the shared 'anon' bucket (when /chat's verified
    // identity fell back to anon — the exact case where Stop used to look up the WRONG key, stop
    // nothing, and leave the 409 loop unbreakable). Stop the FIRST live build found; free its lock.
    const candidates = buildKeyCandidates(verifiedStopUid, stopWorkspaceId, perWorkspaceLockEnabled());
    let wasRunning = false;
    for (const key of candidates) {
      const rb = runningBuilds.get(key);
      if (!rb || rb.ended) continue;
      // The anon bucket is shared: prefer the SESSION-aware cross-check when both sides know their
      // workspace (the anon build's id is agentv3-anon-<sid> while the client asks with its uid-based
      // id — same session, so exact match would wrongly refuse). When the stopping client doesn't know
      // its workspaceId (post-reload), allow — any anonymous caller could always reach this bucket, so
      // a signed-in caller stopping it adds no new exposure.
      if (key === 'anon' && userId && stopWorkspaceId && rb.workspaceId && !workspaceSessionsMatch(rb.workspaceId, stopWorkspaceId)) continue;
      rb.abort.abort();                                       // loop stops between turns
      endBuild(rb);                                           // close all attached streams now
      if (runningBuilds.get(key) === rb) runningBuilds.delete(key);
      activeBuilds.delete(key);                               // free the lock the build actually held
      wasRunning = true;
      break;
    }
    activeBuilds.delete(candidates[0]);                       // always unblock the caller's own key
    res.json({ stopped: wasRunning });
  });

  // ── UNSEND — take back the last message (Slice 2) ──
  // "Unsend" removes the user's most-recent message EVERYWHERE it was recorded, so it never resurfaces:
  //   1. STOP any in-flight build for it (same verified-identity matching as /stop — never break another
  //      account's build), and free its lock.
  //   2. TRUNCATE the durable transcript to just before that prompt — the transcript IS the provider's
  //      replayed memory, so this is what actually makes the model "forget" it on the next turn/reopen.
  //   3. PURGE the workspace EPISODIC memory turn (the request episode + every error/fix/note/reflection
  //      derived from it), then persist — else a cold reopen re-hydrates the unsent message from Firestore.
  // Owner-only (conversationAccess) + idempotent (a second call finds nothing to remove and still 200s).
  // A missing memory layer would leave the unsent message "remembered" — a privacy + correctness defect —
  // so all three layers are purged in the SAME request (real feature, no half-wiring).
  app.post('/api/agentv3/unsend', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    // SECURITY (mirrors /stop + the conversation routes): resolve the VERIFIED uid, never the claimed
    // body.userId — an unsend must not be able to purge another account's build by passing its id.
    const verifiedUid = (await verifiedIdentity(req))?.uid ?? null;

    // 1) Stop any in-flight build for this workspace (abort → close streams → free the lock), exactly
    //    like /stop. An unsend of a message whose build is still running must first halt that build.
    const buildKeys = buildKeyCandidates(verifiedUid, workspaceId, perWorkspaceLockEnabled());
    let stopped = false;
    for (const key of buildKeys) {
      const rb = runningBuilds.get(key);
      if (!rb || rb.ended) continue;
      if (key === 'anon' && userId && rb.workspaceId && !workspaceSessionsMatch(rb.workspaceId, workspaceId)) continue;
      rb.abort.abort();
      endBuild(rb);
      if (runningBuilds.get(key) === rb) runningBuilds.delete(key);
      activeBuilds.delete(key);
      stopped = true;
      break;
    }
    activeBuilds.delete(buildKeys[0]); // always unblock the caller's own key

    try {
      const store = getConversationStore();
      let truncated = false;
      let purgedMemory = false;
      let forbidden = false;
      // The transcript + memory live under the workspace id (conversationId === workspaceId, #837); a
      // legacy v3_<sid> id resolves to its real agentv3-<uid>-<sid> / anon workspace. Purge every
      // accessible match so no copy of the unsent message survives.
      for (const cid of candidateConversationIds(workspaceId, verifiedUid)) {
        const rec = await store.get(cid).catch(() => null);
        const access = conversationAccess(rec, verifiedUid);
        if (access === 'forbidden') { forbidden = true; continue; }
        if (access !== 'ok' || !rec) continue;

        // 2) Truncate the durable transcript to just before the last real user prompt.
        const keep = unsendKeepCount(rec.messages);
        if (keep < rec.messages.length) {
          await store.truncateMessages(cid, keep, { updatedAt: Date.now() }).catch(() => { /* best-effort */ });
          truncated = true;
        }

        // 3) Purge the workspace episodic memory turn, then persist so a cold reopen can't rehydrate it.
        try {
          const mem = getWorkspaceMemory(cid);
          await restoreWorkspaceMemory(cid, mem).catch(() => null); // ensure durable episodes are loaded first
          const removed = mem.removeLastRequestTurn();
          if (removed.length > 0) {
            await saveWorkspaceMemory(cid, mem.snapshot()).catch(() => { /* best-effort */ });
            purgedMemory = true;
          }
        } catch { /* memory purge is best-effort — never fail the unsend */ }
      }

      if (!truncated && !purgedMemory && !stopped && forbidden) {
        res.status(403).json({ error: 'This build belongs to another account.' });
        return;
      }
      // Idempotent: removed just now, or already gone → 200 either way.
      res.json({ ok: true, stopped, truncated, purgedMemory });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Full Team mid-build steering (Fix 60, admin 2026-07-13) ──
  // The Claude-Code-style "message the team while it builds": a user on the FULL TEAM ('max') tier can
  // send a message DURING a running build; it is queued on the RunningBuild and the AgentRunner injects
  // it as a REAL user turn between steps, so the very next model call acts on it. Server-enforced tier
  // gate (the premium feature can't be reached by a hand-crafted request from a lower tier), the same
  // verified-identity matching as /stop (never the claimed body id), and rate-limited like every other
  // workspace state change.
  app.post('/api/agentv3/steer', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const message = sanitizeSteerMessage(req.body?.message);
    if (!message) {
      res.status(400).json({ error: 'A non-empty message is required.' });
      return;
    }
    const steerWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    // SECURITY: match the running build under the VERIFIED identity (same discipline as /stop) —
    // a caller must never be able to steer ANOTHER account's build by passing its uid.
    const verifiedSteerUid = (await verifiedIdentity(req))?.uid ?? null;
    const candidates = buildKeyCandidates(verifiedSteerUid, steerWorkspaceId, perWorkspaceLockEnabled());
    for (const key of candidates) {
      const rb = runningBuilds.get(key);
      if (!rb || rb.ended) continue;
      if (key === 'anon' && userId && steerWorkspaceId && rb.workspaceId && !workspaceSessionsMatch(rb.workspaceId, steerWorkspaceId)) continue;
      // TIER GATE: mid-build steering is the Full Team tier's premium capability — enforced on the
      // BUILD's resolved tier (what the engine is actually running), never the client's claim.
      if (!steerAllowedForBuild(rb.powerLevel)) {
        res.status(403).json({ error: 'Mid-build team messages are a Full Team tier feature. Switch to Full Team before starting the build.', code: 'FULL_TEAM_ONLY' });
        return;
      }
      (rb.steerQueue ??= []).push(message);
      // Instant, honest feedback to EVERY attached device: the message is queued (the runner emits
      // its own "picked up" narration when it actually injects it at the next step boundary).
      broadcastBuild(rb, { type: 'narration', agent: 'system', text: `📨 Message to the team queued — it will be picked up at the next step: “${message.slice(0, 140)}${message.length > 140 ? '…' : ''}”`, ts: Date.now() });
      audit('AGENTV3_STEER_QUEUED', { userId, workspaceId: rb.workspaceId }, 'info');
      res.json({ ok: true, queued: rb.steerQueue.length });
      return;
    }
    res.status(404).json({ error: 'No running build to message — the team is idle. Just send normally.', code: 'NO_RUNNING_BUILD' });
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
  // T1-ratelimit-all: /ship publishes a real deploy (build + provider push) — an expensive,
  // sandbox+external-hitting state change, so it gets the same 60/30-per-hour workspace ceiling as
  // the other workspace endpoints. (NOT applied to /stop, /attach, /live — the lock-free + reconnect
  // critical paths must never be throttled — nor to /queue/next|complete, which an executor drains.)
  app.post('/api/agentv3/ship', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
        body: `Merging \`${WORK_BRANCH}\` into \`${access.defaultBranch}\` — reviewed & shipped from NavBharatAI Pro v5.0.`,
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
  // T1-ratelimit-all: /revert restores a checkpoint (hits git + the sandbox) — a real state change,
  // rate-limited like the other workspace endpoints.
  app.post('/api/agentv3/revert', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
      const revertSha = await client.createCommit(repo, `Revert "${firstLine}"\n\nReverted from NavBharatAI Pro v5.0.`, parentTree, [head.sha]);
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
  app.post('/api/agentv3/attach', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    // SECURITY T0-9: /attach replays a build's full LIVE transcript, so it must match the build under the
    // VERIFIED identity it was registered under — never the claimed body.userId, which would let a caller
    // stream ANOTHER account's live build by passing its uid. The client already sends its Bearer token
    // here for exactly this (the dead-Resume fix). A token that can't be verified resolves to null → only
    // the shared anon bucket (still session-guarded below by the unguessable sessionId), never an account.
    const verifiedAttachUid = (await verifiedIdentity(req))?.uid ?? null;
    // `workspaceId` is OPTIONAL for back-compat, but the panel's auto-resume ALWAYS sends the session
    // it's asking about. CANDIDATE KEYS (admin's dead-Resume fix, 2026-07-06): the build may live under
    // the workspace key, the verified account key, OR the shared 'anon' bucket (verified-identity
    // fallback) — look in all three, refusing any build from a DIFFERENT session (session-aware match:
    // an anon-keyed build of the SAME session must attach, a different session's build never may).
    const requestedWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : null;
    let rb: RunningBuild | undefined;
    for (const key of buildKeyCandidates(verifiedAttachUid, requestedWorkspaceId, perWorkspaceLockEnabled())) {
      const cand = runningBuilds.get(key);
      if (!cand || cand.ended) continue;
      // Never replay a DIFFERENT session's build into the open one (defense-in-depth on every key).
      if (requestedWorkspaceId && cand.workspaceId && !workspaceSessionsMatch(cand.workspaceId, requestedWorkspaceId)) continue;
      // The shared anon bucket for a SIGNED-IN caller: attach replays a full transcript, so require a
      // positive session match (unguessable sessionId) — never attach it blind.
      if (key === 'anon' && userId && !(requestedWorkspaceId && cand.workspaceId && workspaceSessionsMatch(cand.workspaceId, requestedWorkspaceId))) continue;
      rb = cand;
      break;
    }
    if (!rb) {
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

  // CROSS-DEVICE LIVE SYNC (poll): a SECOND device watching the same account's build polls this for
  // events newer than its cursor. Unlike /attach (in-memory, one instance), this reads the shared
  // LiveChannel, so it works even when the build runs on a DIFFERENT Cloud Run instance. Server-only
  // DB access (admin SDK) — the client never touches Firestore. Returns {events, seq, gap, running}.
  app.get('/api/agentv3/live', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    const sinceSeq = Number.parseInt(typeof req.query.sinceSeq === 'string' ? req.query.sinceSeq : '0', 10) || 0;
    // SECURITY T0-9: the cross-device live mirror streams a build's EVENTS, so it keys off the VERIFIED
    // token — never a claimed ?userId (which would let a caller mirror ANOTHER account's live build via
    // the durable LiveChannel, even cross-instance). An unverified/anon caller gets an empty, non-running
    // poll: the mirror simply winds down (the build + the primary /chat stream are unaffected). The client
    // sends its Bearer token on this poll for exactly this.
    const verifiedUid = (await verifiedIdentity(req))?.uid ?? null;
    if (!verifiedUid) {
      res.json({ events: [], seq: sinceSeq, gap: false, running: false });
      return;
    }
    // `workspaceId` is OPTIONAL for back-compat with older clients. When THIS instance is the one
    // actually running the build (the common case — same-instance), its in-memory `rb.workspaceId`
    // is authoritative: if it's for a DIFFERENT session than the caller asked about, report nothing —
    // otherwise a build genuinely still running in session A bleeds its progress into session B's
    // live-mirror poll.
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    const localRb = runningBuilds.get(verifiedUid);
    if (workspaceId && localRb && !localRb.ended && localRb.workspaceId && localRb.workspaceId !== workspaceId) {
      res.json({ events: [], seq: sinceSeq, gap: false, running: false });
      return;
    }
    try {
      const { events, seq, gap, workspaceId: eventsWorkspaceId } = await liveChannel.readSince(verifiedUid, sinceSeq);
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
      res.json({ events, seq, gap, running: isBuildRunning(verifiedUid) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ONE place that turns a restore outcome into the sentence the user reads, so the API and the UI
  // can never drift into telling different stories about the same failure.
  const restoreMessage = (reason: string): string => {
    switch (reason) {
      case 'restored': return 'Restored your workspace to that checkpoint.';
      case 'forbidden': return 'That workspace does not belong to you.';
      case 'no-sandbox': return 'This app has no live workspace right now. Open it (or send a message) and try again.';
      case 'no-history':
        return 'That checkpoint is no longer restorable — this workspace was rebuilt, so its earlier history is gone. Your latest files are safe: use "Restore all files".';
      case 'unknown-sha':
        return 'That checkpoint is not in this workspace\'s history any more.';
      default:
        return 'Could not restore that checkpoint. Your current files were not changed.';
    }
  };

  // History → restore: roll the workspace back to a checkpoint commit (P-git).
  app.post('/api/agentv3/restore', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
    // The checkpoint LIST is durable, so the UI can offer a restore the sandbox can no longer perform.
    // Report WHICH of those situations it is, instead of one boolean for four different facts — the
    // user can act on "that version's history is gone" and cannot act on "not in this session".
    const result = await restoreSessionDetailed(workspaceId, sha, userId ?? undefined, () => buildActuator());
    res.json({ ok: result.ok, reason: result.reason, message: restoreMessage(result.reason) });
  });

  // Phase G1 — git as the third organ: return a workspace's DURABLE checkpoint history (newest first).
  // v5.0 builds make real git commits; this surfaces the persisted timeline so the IDE shows the full
  // history even across sessions / devices / sandbox recycles (not just the current session's RAM).
  // Ownership-checked; empty list when the workspace has no checkpoints yet.
  app.get('/api/agentv3/checkpoints', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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

  // REAL Code Studio terminal: run ONE bounded command in the user's own warm v5.0 sandbox. Each
  // command runs under a hard timeout with capped output (see execInSession) — no persistent shell,
  // no runaway processes. available:false when the sandbox isn't warm (honest, never faked output).
  // Ownership-checked + rate-limited.
  app.post('/api/agentv3/exec', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) { // T0-9: strict — exec runs arbitrary commands
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

  // ===============================================================================================
  // REAL PERSISTENT SHELLS (admin 2026-08-04: "kya ham, replit jaisa real shell nahi bana sakte?")
  //
  // /exec above runs ONE bounded command and returns — no state, no live output, no Ctrl+C, 30s cap.
  // These five give Code Studio a genuine TTY per terminal tab, living in the user's own sandbox:
  // `cd` persists, output streams as it happens, Ctrl+C interrupts, interactive prompts answer.
  // See ShellSessions.ts for the design and its limits. Every route is ownership-checked with the
  // same strict verification /exec uses, because a shell runs arbitrary commands.
  // ===============================================================================================

  /** Files seeded back on a terminal wake. High enough for a real project, low enough that a huge
   *  one cannot hold the open request indefinitely — the shell opens either way, and the build path
   *  restores the rest. */
  const TERMINAL_WAKE_MAX_FILES = 400;

  /**
   * Wake a dormant workspace so the TERMINAL can open in it.
   *
   * WHY (admin screenshot 2026-08-05). Opening the terminal on a project with 21 saved files said:
   * "Workspace is dormant — send a message in v5.0 chat to bring the sandbox back online, then the
   * terminal works again." That is honest, and it is still the wrong answer: it hands the user a chore
   * and sends them to a different screen to perform it. A real IDE opens the terminal. We already know
   * the workspace, we already have the durable files, and the resume path is proven — the only reason
   * the terminal did not use it is that nobody had wired it.
   *
   * The sequence is the build path's own, minus everything a terminal does not need: resume this
   * workspace's sandbox (or create one), seed the durable files back into it, open a git repo so
   * checkpoints keep working, and register the session so the PTY host becomes reachable.
   *
   * Bounded and best-effort. On any failure the caller falls through to exactly today's honest dormant
   * message — this can make the terminal work, never make it worse. Kill switch:
   * AGENTV3_TERMINAL_AUTOWAKE=off.
   */
  /**
   * BACKGROUND terminal wake with LIVE, pollable progress (admin 2026-08-06: "start hone me bahut
   * time laga, fir bhi start nahi hua").
   *
   * ROOT CAUSE of that report: the wake ran INLINE in /shell/open — one HTTP request holding a cold
   * sandbox create + a full project seed + git setup. A cold create alone can take 60-90s, so the
   * client's 90s deadline fired while the wake was genuinely working, and the user saw "took too
   * long" for a workspace that was seconds from ready. The preview watchdog taught this exact
   * lesson: NEVER judge slow work by a clock — judge it by progress. So the wake is now a
   * deduplicated background job whose phase/seeded/total the client polls and paints; only a wake
   * that stops PROGRESSING is declared dead, and the open request itself returns immediately.
   */
  const terminalWakes = new Map<string, TerminalWakeState>();
  const WAKE_STALE_MS = 300_000; // an unfinished wake older than this is abandoned and restartable

  function startTerminalWake(workspaceId: string, userId?: string): TerminalWakeState {
    const existing = terminalWakes.get(workspaceId);
    // One wake per workspace at a time; a FINISHED wake (ready or failed) never blocks a fresh one —
    // "Try again" after a failure must actually try again.
    if (existing && !existing.finishedAt && Date.now() - existing.startedAt < WAKE_STALE_MS) return existing;
    const state: TerminalWakeState = { phase: 'starting', seeded: 0, total: 0, startedAt: Date.now() };
    terminalWakes.set(workspaceId, state);
    void (async () => {
      try {
        const actuator = buildActuator();
        const resumeSandboxId = sandboxResumeEnabled()
          ? (await sandboxStore.get(workspaceId).catch(() => null)) ?? undefined
          : undefined;
        await actuator.ensureWorkspace(workspaceId, undefined, resumeSandboxId);
        // Seed the saved project back in. A RESUMED sandbox usually still has the files, but a
        // recreated one comes back empty — and a terminal opening onto an empty directory would look
        // exactly like the data loss this whole path exists to avoid.
        const saved = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
        const entries = Object.entries(saved).slice(0, TERMINAL_WAKE_MAX_FILES);
        state.total = entries.length;
        state.phase = 'seeding';
        // A RESUMED sandbox still holds its filesystem — E2B pause preserves the disk, and the
        // reaper pauses rather than kills. Re-seeding every file onto a resumed sandbox was most of
        // the wake for the COMMON case (admin 2026-08-06: "Replit me to shell load nahi hota" —
        // Replit's trick is exactly this: resume from a snapshot, copy nothing). One cheap probe
        // decides: if the first saved file already exists with content, the whole seed is skipped;
        // only a genuinely recreated (empty) sandbox pays the seeding time.
        let needSeed = entries.length > 0;
        if (needSeed && resumeSandboxId) {
          const probe = await actuator.readFile(workspaceId, entries[0][0]).catch(() => null);
          if (typeof probe === 'string' && probe.length > 0) {
            needSeed = false;
            state.seeded = entries.length;
          }
        }
        if (!needSeed) {
          state.phase = 'finishing';
        }
        // In PARALLEL batches, not one-by-one: each E2B write is a network round-trip, so a 30-file
        // project seeded serially added many seconds to every wake. The batch counter is what the
        // user watches — real progress, not a spinner.
        if (needSeed) {
          for (let i = 0; i < entries.length; i += 8) {
            await Promise.all(entries.slice(i, i + 8).map(([path, content]) =>
              typeof content === 'string' ? actuator.writeFile(workspaceId, path, content).catch(() => {}) : Promise.resolve(),
            ));
            state.seeded = Math.min(i + 8, entries.length);
          }
          state.phase = 'finishing';
        }
        // THE SHELL MUST NEVER WAIT FOR GIT (admin screenshot 2026-08-06: the wake froze on
        // "Preparing git and tools…"). ensureRepo runs git init/config inside the sandbox — on a
        // 166-file project that can take long, and it has no timeout — while the shell needs NONE of
        // it (git only serves the Git panel). Register the session and declare ready FIRST; the repo
        // initializes in the background and is simply already done by the time anyone opens the Git
        // panel. This hang class is now structurally impossible, not merely handled.
        const git = new GitManager(actuator, workspaceId);
        registerSession(workspaceId, git, userId, actuator);
        state.phase = 'ready';
        state.finishedAt = Date.now();
        void git.ensureRepo().catch(() => false);
      } catch (e) {
        // The REAL reason, sanitized of infra branding, kept for the owner who polls it — a wake
        // that will not name its failure is undiagnosable from a screenshot (the whole lesson of
        // this terminal's history).
        state.phase = 'failed';
        state.error = sanitizeWakeError(e);
        state.finishedAt = Date.now();
      }
    })();
    return state;
  }

  /** Open a shell. Honest available:false (with the dormant/not_started reason) when no warm sandbox. */
  app.post('/api/agentv3/shell/open', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    let host = ptyHostForSession(workspaceId, userId ?? undefined);
    // Dormant workspace with a real saved project? Wake it instead of sending the user to another
    // screen to do it by hand — but in the BACKGROUND, answering immediately with pollable progress.
    // Holding this request open through a cold sandbox create is what produced "took too long to
    // wake (90s)" on a wake that was actually succeeding.
    if (!host) {
      const hasProject = await countWorkspaceFiles(workspaceId).catch(() => 0);
      const canWake = process.env.AGENTV3_TERMINAL_AUTOWAKE !== 'off' && !!process.env.E2B_API_KEY?.trim();
      if (hasProject > 0 && canWake) {
        let wake = startTerminalWake(workspaceId, userId ?? undefined);
        if (wake.phase === 'ready') {
          host = ptyHostForSession(workspaceId, userId ?? undefined);
          // Ready per the record but no live session (instance recycled between): restart honestly.
          if (!host) { terminalWakes.delete(workspaceId); wake = startTerminalWake(workspaceId, userId ?? undefined); }
        }
        if (!host) {
          res.json({ available: false, reason: 'waking', wake: wakePublicState(wake), savedFileCount: hasProject });
          return;
        }
      }
    }
    const result = await openShell(workspaceId, host, {
      userId: userId ?? undefined,
      cols: Number(req.body?.cols),
      rows: Number(req.body?.rows),
    });
    if (result.ok) {
      res.json({ available: true, shellId: result.shell.shellId, cursor: result.shell.cursor });
      return;
    }
    if (result.reason === 'too_many') {
      res.status(429).json({
        available: true,
        error: `You already have ${MAX_SHELLS_PER_WORKSPACE} terminals open in this workspace. Close one to open another.`,
      });
      return;
    }
    if (result.reason === 'failed') {
      // A real sandbox that refused to start a TTY — say so, never pretend a shell exists. `detail`
      // carries the sandbox's OWN message: this route is already ownership-checked, so the only person
      // who can read it is the person whose workspace it is, and a failure that will not name itself
      // costs far more than it protects (2026-08-05: a live terminal fault I could not diagnose
      // because every failure produced the same sentence).
      res.status(502).json({
        available: true,
        error: 'The sandbox could not start a shell. Try again in a moment.',
        detail: result.detail?.slice(0, 300),
      });
      return;
    }
    // no_sandbox — the same honest dormant answer /exec gives, plus WHICH precondition actually
    // failed. "No sandbox" has three quite different causes and they need three different actions:
    // the workspace is not on this instance at all (a Cloud Run cold start — send a message to wake
    // it), it is here but holds no runner, or it has a runner that cannot open a TTY (LocalActuator
    // in dev/CI). Collapsing them into one message is what made a live report undiagnosable.
    const session = getSession(workspaceId);
    const cause = !session ? 'no_session'
      : !session.runner ? 'no_runner'
      : 'runner_not_pty';
    const fileCount = await countWorkspaceFiles(workspaceId).catch(() => 0);
    res.json({
      available: false,
      reason: fileCount > 0 ? 'dormant' : 'not_started',
      cause,
      savedFileCount: fileCount,
    });
  });

  /**
   * Wake progress poll — on the generous shell bucket, because a waking client asks every ~2.5s and
   * the strict 60/hr workspace bucket would 429 the poll before a slow cold start could finish
   * (the exact keystroke-limiter lesson, again).
   */
  app.get('/api/agentv3/shell/wake', shellInputRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const wake = terminalWakes.get(workspaceId);
    res.json({
      wake: wake ? wakePublicState(wake) : null,
      hostReady: !!ptyHostForSession(workspaceId, userId ?? undefined),
    });
  });

  /**
   * Live output as Server-Sent Events.
   *
   * SSE rather than WebSocket deliberately: it is plain HTTP, so it inherits this app's auth, proxy
   * and Cloud Run behaviour with no new transport to secure, and it reconnects on its own. The
   * terminal's input is a separate POST, which is fine — a person types far slower than HTTP.
   *
   * `cursor` makes reconnection ordinary instead of a special case: the client sends the last offset
   * it rendered and gets exactly what it missed, so a locked phone or a dropped network resumes with
   * no gap and no duplicated output.
   */
  app.get('/api/agentv3/shell/stream', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const shellId = typeof req.query.shellId === 'string' ? req.query.shellId : '';
    if (!workspaceId || !shellId) {
      res.status(400).json({ error: 'workspaceId and shellId are required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const from = Number(req.query.cursor);
    const backlog = readShell(shellId, Number.isFinite(from) ? from : 0, userId ?? undefined);
    if (!backlog) {
      res.status(404).json({ error: 'This terminal is no longer open.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // proxies must not buffer a terminal — that is the whole point
    });

    const send = (event: string, payload: unknown) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* client gone */ }
    };

    // Anything produced before this connection attached, plus an honest note if scrollback was
    // trimmed while nobody was watching — a silent gap would read as corrupted output.
    send('output', { data: backlog.data, cursor: backlog.cursor, truncated: backlog.truncated });

    const unsubscribe = subscribeShell(
      shellId,
      (chunk, cursor) => send('output', { data: chunk, cursor }),
      userId ?? undefined,
    );
    if (!unsubscribe) { res.end(); return; }

    // Heartbeat: keeps intermediaries from closing an idle stream, and lets the client notice a dead
    // connection while a long build produces nothing for minutes.
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* client gone */ } }, 20_000);
    // Poll for exit so the UI can show "[process exited]" instead of a shell that just stops responding.
    const watch = setInterval(() => {
      const s = getShell(shellId, userId ?? undefined);
      if (!s || !s.alive) { send('exit', { exitCode: s?.exitCode ?? null }); cleanup(); res.end(); }
    }, 1000);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearInterval(beat);
      clearInterval(watch);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  /** Keystrokes → the TTY. Ctrl+C is just the real \x03 byte arriving here; there is no special case. */
  app.post('/api/agentv3/shell/input', shellInputRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const shellId = typeof req.body?.shellId === 'string' ? req.body.shellId : '';
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    if (!workspaceId || !shellId) {
      res.status(400).json({ error: 'workspaceId and shellId are required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const ok = await writeShell(shellId, data, userId ?? undefined);
    res.json({ ok });
  });

  /** New window size → the TTY, so column-drawn output (top, vim, progress bars) wraps correctly. */
  app.post('/api/agentv3/shell/resize', shellInputRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const shellId = typeof req.body?.shellId === 'string' ? req.body.shellId : '';
    if (!workspaceId || !shellId) {
      res.status(400).json({ error: 'workspaceId and shellId are required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    const ok = await resizeShell(shellId, Number(req.body?.cols), Number(req.body?.rows), userId ?? undefined);
    res.json({ ok });
  });

  /** Kill the shell. Idempotent — closing an already-closed terminal is a success, not an error. */
  app.post('/api/agentv3/shell/close', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const shellId = typeof req.body?.shellId === 'string' ? req.body.shellId : '';
    if (!workspaceId || !shellId) {
      res.status(400).json({ error: 'workspaceId and shellId are required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    await closeShell(shellId, userId ?? undefined);
    res.json({ ok: true });
  });

  // R5 §5.1 — return a workspace's latest LIVE deployment URL (durable, survives reconnect).
  // Lets the UI restore the "Live site" link after a refresh/new session instead of losing it
  // with the build stream. Ownership-checked; null url when the app has never been deployed.
  app.get('/api/agentv3/deployment', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
  /**
   * The deploy function used by BOTH the AI `deploy` tool and the direct Publish endpoint.
   *
   * Extracted so the two paths cannot drift: it carries the provider choice, the custom-domain
   * republish and the durable deployment record. A second copy would be the kind of duplicate that
   * quietly loses one of those three.
   */
  const makeDeployFn = (opts: { userId: string | null; githubToken?: string; providerId: string }) => {
    const provider = getDeployProvider(opts.providerId)
      ?? getDeployProvider(DEFAULT_DEPLOY_PROVIDER)
      ?? getDeployProvider('firebase')!;
    return withDeploymentPersistence(
      async (ws: string, files: Map<string, Buffer>) => {
        const url = await provider.deploy(ws, files, { userId: opts.userId, githubToken: opts.githubToken });
        // Firebase-NATIVE custom domain: when publishing on OUR hosting AND this workspace has a
        // connected domain, ALSO publish the same build to its dedicated site so the domain serves the
        // fresh app. Best-effort — a failure here never fails the primary publish, which is already live.
        if (opts.providerId === 'firebase' && firebaseCustomDomainsEnabled()) {
          try {
            if (await workspaceHasFirebaseDomain(ws)) {
              await new FirebaseHostingDeployer().deployToSite(ws, files);
            }
          } catch (e) {
            console.warn('[agentv3] custom-domain site publish failed (primary publish is live):', e);
          }
        }
        return url;
      },
      opts.userId,
      opts.providerId,
    );
  };

  /**
   * PUBLISH — the direct, deterministic path. POST /api/agentv3/publish
   *
   * ROOT CAUSE this replaces (admin 2026-08-11: "publish button kisi kaam ka nahi hai"). Publishing
   * used to be driven by asking the MODEL to do it: the button sent the chat prompt "run npm run build,
   * then call the deploy tool". Publishing is a DETERMINISTIC operation — build, collect dist, upload,
   * return the URL — and routing it through a language model made it non-deterministic (the model might
   * not call the tool at all; one recorded build had it running `ls -la dist/` trying to work out what
   * had happened), SLOW, and BILLED, for something that should cost the user nothing. A button that
   * might publish is not a Publish button.
   *
   * This runs the same steps directly and reuses the SAME `deploy` tool implementation the agent calls,
   * so custom domains, the production-database migration, the liveness check and the durable deployment
   * record all still happen — none of it is reimplemented here.
   */
  app.post('/api/agentv3/publish', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'NavBharatAI Pro v5.0 is not available for this account.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'Build an app first — there is nothing to publish yet.' });
      return;
    }
    // Strict: publishing writes to a public host, so a claimed uid is not enough.
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }

    const providerId = typeof req.body?.deployProvider === 'string' ? req.body.deployProvider : DEFAULT_DEPLOY_PROVIDER;
    const provider = getDeployProvider(providerId);
    if (!provider) {
      res.status(400).json({ error: 'That hosting option is not available.' });
      return;
    }
    const githubToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : undefined;
    if (!provider.isConfigured({ userId, githubToken })) {
      res.status(422).json({ error: `${provider.name} is not connected yet — add its access token in Settings → Secrets & API Keys, then publish.` });
      return;
    }

    try {
      const actuator = buildActuator();
      // 1. BUILD. Deterministic, and its real output is returned on failure — the user gets the
      //    compiler's own reason instead of "publish failed".
      const build = await actuator.runCommand(workspaceId, 'npm run build');
      if (build.exitCode !== 0) {
        const detail = (build.stderr || build.stdout || '').trim().split('\n').slice(-12).join('\n');
        res.status(422).json({
          error: 'Your app did not build, so there was nothing to publish. Fix the build error and try again.',
          detail: detail.slice(0, 4000),
        });
        return;
      }

      // 2. DEPLOY, through the SAME tool the agent uses — so the custom-domain republish, the
      //    production-database migration, the liveness probe and the durable record all still run.
      const dispatcher = new ToolDispatcher(
        actuator, workspaceId, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        makeDeployFn({ userId, githubToken, providerId }),
      );
      const result = await dispatcher.dispatch({ id: 'publish', name: 'deploy', input: {} });
      if (result.is_error) {
        res.status(422).json({ error: result.content });
        return;
      }

      // The URL is read back from the durable record rather than parsed out of the message — the
      // record is what every other surface reads, so they cannot disagree.
      let url = '';
      try { url = (await deploymentStore.get(workspaceId))?.url || ''; } catch { /* fall through */ }
      if (!url) {
        const m = result.content.match(/https?:\/\/[^\s)]+/);
        url = m ? m[0] : '';
      }
      res.json({ ok: true, url, message: result.content });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not publish your app. Please try again.' });
    }
  });

  app.get('/api/agentv3/deploy-providers', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    // hasGithub is a boolean hint only — never accept a token in a GET query string.
    const hasGithub = req.query.hasGithub === 'true' || req.query.hasGithub === '1';
    res.json({
      providers: deployProviderStatus({ userId, githubToken: hasGithub ? 'present' : undefined }),
      default: DEFAULT_DEPLOY_PROVIDER,
      // Slice 3: tells the client whether the Firebase-native "connect your own domain" surface is
      // live, so the Publish flow only offers it when the backend feature flag is on.
      customDomains: firebaseCustomDomainsEnabled(),
    });
  });

  // §12.2 — deploy/git support: return the built app's source files as a
  // path→content map. This is exactly the shape the EXISTING deploy + git routes
  // accept (`/api/pro/deploy`, `/api/github/push-enhanced`), so v5.0 reuses that
  // backend for durable deploy + GitHub push instead of rebuilding any of it.
  // Read-only; never returns node_modules / build output / live .env secrets.
  app.post('/api/agentv3/workspace-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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

  // CONNECT AUDIT (master import, part 4) — what the user is told in the first thirty seconds after
  // their project lands. Deterministic and FREE: it indexes the workspace and runs the analyzers this
  // repo already has (architecture + dead code), with no model call anywhere. See ConnectAudit.ts for
  // why the moment after connecting, rather than connecting itself, is the thing worth building.
  app.post('/api/agentv3/connect-audit', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId is required.' }); return; }
    if (!(await assertWorkspaceOwner(req, workspaceId))) {
      res.status(403).json({ error: 'Forbidden: this workspace does not belong to you.' });
      return;
    }
    try {
      const actuator = buildActuator();
      const mem = getWorkspaceMemory(workspaceId);
      const tree = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
      // Bounded like every other indexing call here: a 16,000-file monorepo must not turn a courtesy
      // audit into a minute of work. The counts stay honest because the audit reports what it READ.
      await warmIndexFiles(mem, tree, (p) => actuator.readFile(workspaceId, p).catch(() => ''), { maxFiles: 1_500 });
      res.json(auditConnectedProject(mem.graph()));
    } catch (err: any) {
      // A failed audit is a missing bonus, never a failed import — the project is already landed. Say
      // so plainly rather than manufacturing a scary error over work the user did not ask for.
      res.status(200).json({ fileCount: 0, findings: [], message: '', error: err?.message || 'audit unavailable' });
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

  app.post('/api/agentv3/inbrowser-preview', inbrowserPreviewRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
      // HONEST FULL-STACK STATE (Task #64): the in-browser preview compiles only the FRONTEND. If the
      // app also has a backend (a Node/Express API, a database, a Python server, or defined routes) its
      // API calls silently fail here — the app "looks broken" for a reason the user can't see. Derive it
      // deterministically from the files so the client can show an honest "needs a Live server" banner
      // instead of a silently-broken preview. Same value whether the render is cached or fresh.
      const backend = detectBackendPresence(files);
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
      // DEEP REFRESH (`fresh: true`): the client's "Fix with AI" on a broken preview first asks for a
      // cache-bypassing recompile — a blank/failed preview is often just a stale cached render, so
      // re-rendering from scratch can make the app work with no AI turn spent. Skip the cache READ
      // (still WRITE the fresh render below so subsequent normal reloads stay fast).
      const fresh = req.body?.fresh === true;
      const cached = fresh ? undefined : inbrowserPreviewCache.get(cacheKey);
      if (cached && cached.hash === filesHash && Date.now() - cached.ts < INBROWSER_CACHE_TTL_MS) {
        res.json({ html: cached.html, kind: cached.kind, count: Object.keys(files).length, cached: true, hasBackend: backend.hasBackend, backendReason: backend.reason });
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
      res.json({ html, kind, count: Object.keys(files).length, hasBackend: backend.hasBackend, backendReason: backend.reason });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build the in-browser preview.' });
    }
  });

  // VISUAL EDITOR (in-browser mode, v1: single simple text child) — apply a text edit made in the
  // RENDERED preview back into the REAL source file at its exact JSX position, via a real AST
  // (VisualEditPatcher.ts), never a blind string/line replacement. Writes through the SAME durable
  // store + live actuator every other file write uses, so the edit shows up everywhere else (Files,
  // Code Studio's own editor, Git) exactly like a v5.0-panel edit does — not a disposable, disconnected
  // copy the next build would silently overwrite.
  app.post('/api/agentv3/visual-edit', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const filePath = typeof req.body?.file === 'string' ? req.body.file : '';
    const line = Number(req.body?.line);
    const column = Number(req.body?.column);
    const newText = typeof req.body?.newText === 'string' ? req.body.newText : null;
    // Phase 2 (admin 2026-07-29): the same endpoint also applies inline-STYLE edits (toolbar / resize /
    // reposition) when the client sends a `styleUpdates` map (camelCase CSS → value; '' removes a key).
    const styleUpdatesRaw = req.body?.styleUpdates;
    const styleUpdates = styleUpdatesRaw && typeof styleUpdatesRaw === 'object' && !Array.isArray(styleUpdatesRaw)
      ? (styleUpdatesRaw as Record<string, string>) : null;
    const isStyleEdit = styleUpdates != null && Object.keys(styleUpdates).length > 0;
    // MULTI-ELEMENT SELECT: several elements in the SAME file arrive as one request and are patched in a
    // single read-modify-write. One request per element would be a lost update — see applyVisualStyleEdits.
    const editsRaw = Array.isArray(req.body?.edits) ? req.body.edits : null;
    const edits = editsRaw
      ? (editsRaw as any[])
          .filter((e) => e && typeof e === 'object' && Number.isFinite(Number(e.line))
            && e.styleUpdates && typeof e.styleUpdates === 'object' && !Array.isArray(e.styleUpdates))
          .map((e) => ({ line: Number(e.line), column: Number(e.column) || 1, styleUpdates: e.styleUpdates as Record<string, string> }))
      : [];
    const isBatchEdit = edits.length > 0;
    if (!workspaceId || !filePath || (newText === null && !isStyleEdit && !isBatchEdit)) {
      res.status(400).json({ error: 'workspaceId, file and either newText, styleUpdates or edits are required.' });
      return;
    }
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) { // T0-9: strict — visual-edit writes files
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
      const result = isBatchEdit
        ? await applyVisualStyleEdits({ filePath, source, edits })
        : isStyleEdit
          ? await applyVisualStyleEdit({ filePath, source, line, column, styleUpdates: styleUpdates as Record<string, string> })
          : await applyVisualTextEdit({ filePath, source, line, column, newText: newText as string });
      if (!result.ok) {
        res.status(422).json({ error: result.error });
        return;
      }
      // An `ok` result with no source is not a state any patcher should produce, but writing `undefined`
      // into the workspace would EMPTY the user's file — so it is refused here rather than trusted.
      const newSource = result.newSource;
      if (typeof newSource !== 'string') {
        res.status(500).json({ error: 'The edit produced no file content.' });
        return;
      }
      // A batch that partially applied MUST say so — the elements that refused are named, so the user is
      // never told all their selected elements changed when some did not.
      const partial = isBatchEdit ? (result as { failures?: Array<{ line: number; error: string }> }).failures ?? [] : [];
      // Write through BOTH the live actuator (so a still-warm sandbox reflects it immediately) and the
      // durable store (so it survives an instance recycle / is what the next preview build reads) —
      // matching how every other v5.0 file write persists. Actuator write is best-effort: a VFS-tier
      // or cold sandbox has no live copy to write into, and the durable save below is authoritative.
      try { await actuator.writeFile(workspaceId, filePath, newSource); } catch { /* best-effort */ }
      // MERGE, never replace: a single-file edit must UPSERT into the durable index — the old
      // saveWorkspaceFiles call REPLACED the whole path index with this ONE file (the "sab gayab" wipe
      // class; the store's shrink-guard now also blocks it, this is the correct semantics at the source).
      await mergeWorkspaceFiles(workspaceId, { [filePath]: newSource });
      res.json({ ok: true, file: filePath, content: newSource, ...(partial.length > 0 ? { failures: partial } : {}) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to apply the visual edit.' });
    }
  });

  // §12.2 — import an existing project (e.g. fetched from GitHub via the existing
  // `/api/github/fetch` route, or any source) into the v5.0 sandbox so the agent can
  // edit/update and then deploy/push it back. Path-safe (no traversal/absolute), and
  // never imports node_modules / .git / live .env secrets.
  //
  // Only an import over this size triggers the GitHub durability backstop (or the "connect
  // GitHub" prompt when no token is available) — routine small imports/edits never need it.
  const LARGE_IMPORT_GITHUB_BACKSTOP_BYTES = 5 * 1024 * 1024;
  app.post('/api/agentv3/import-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) { // T0-9: strict — import-files writes files
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
      // debounced syncer), record the paths so the NEXT v5.0 build acknowledges them ("I noticed you
      // edited N files…") and builds on top of them. Bulk repo imports / uploads do NOT set this flag,
      // so they don't spam the next turn with "you edited 500 files". Best-effort — never blocks.
      if (req.body?.source === 'ide-edit') {
        try { await recordManualEdits(workspaceId, written.length ? written : Object.keys(files as Record<string, string>), Date.now()); } catch { /* edit tracking is best-effort */ }
      }
      // GITHUB BACKSTOP FOR LARGE IMPORTS (report 2026-07-27 — "1gb zip firbase me nahi to github
      // login karwao"). Firestore's WorkspaceFileStore caps a single file doc at ~900KB, so a
      // genuinely large imported project has no practical ceiling only in git. The client sends
      // `finalize: true` on the LAST chunk of a multi-chunk import (chunkFilesForSync on the
      // client) together with the import's total byte size; pushAll commits the sandbox's FULL
      // current state (every chunk already written to it this batch), not just this one request's
      // files. Only fires for bulk imports over a real size threshold — never for routine IDE-edit
      // autosaves — and is a pure best-effort backstop: the Firestore/sandbox copy above is already
      // the durable source of truth, this just adds a second, unbounded-size one when it matters.
      let github: { url: string; fullName: string } | null = null;
      let needsGithub = false;
      const totalBytes = typeof req.body?.totalBytes === 'number' ? req.body.totalBytes : 0;
      if (req.body?.source === 'import' && req.body?.finalize === true && totalBytes > LARGE_IMPORT_GITHUB_BACKSTOP_BYTES && githubStorageActive()) {
        const userToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
        if (userToken) {
          try {
            const userClient = new UserGitHubClient(userToken);
            const login = await userClient.getLogin();
            // Converge on the SAME readable repo name a v5.0 build turn for this workspace would
            // use (repoNameForProject with the conversation's own title/createdAt) whenever that
            // record already exists, so an import that happens alongside/after a chat build lands
            // in the one repo the user already sees — not a second, disconnected one. Falls back to
            // a stable (still deterministic, still real) name when no conversation exists yet.
            let repoName = repoNameForProject(userId, workspaceId);
            try {
              const idRec = await getConversationStore().get(workspaceId).catch(() => null);
              if (idRec?.title) {
                repoName = repoNameForProject(userId, workspaceId, {
                  appName: idRec.title,
                  createdAtMs: typeof idRec.createdAt === 'number' && idRec.createdAt > 0 ? idRec.createdAt : Date.now(),
                });
              }
            } catch { /* readable-name lookup is best-effort — the stable fallback name still works */ }
            const repo = await userClient.ensureRepo(repoName);
            const authedUrl = userClient.authedCloneUrl(repoName, login);
            const repoSync = new GitRepoSync(actuator, workspaceId);
            const pushed = await repoSync.pushAll(authedUrl, repo.defaultBranch || 'main', 'Import large project from ZIP');
            if (pushed.pushed || pushed.noChange) {
              github = { url: repo.htmlUrl, fullName: repo.fullName || `${login}/${repoName}` };
            }
          } catch { /* GitHub backup is a best-effort backstop — never blocks the import */ }
        } else {
          needsGithub = true; // large import, no GitHub connected — let the client offer to connect
        }
      }
      res.json({ imported: written.length, skipped: skipped.length, ...(github ? { github } : {}), ...(needsGithub ? { needsGithub: true } : {}) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to import the files.' });
    }
  });

  // Delete files from the v5.0 workspace — keeps v5.0's known file set in sync when the user
  // deletes files in the IDE. Removes the paths from the durable WorkspaceFileStore (the
  // authoritative source for what files exist), so a fresh/restored session won't have them and
  // the file-guardian won't resurrect them. Ownership-checked. Body { workspaceId, userId, email,
  // paths: string[] }.
  app.post('/api/agentv3/delete-files', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
    if (!(await assertVerifiedWorkspaceOwner(req, workspaceId))) { // T0-9: strict — delete-files removes files
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
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
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
  app.post('/api/agentv3/chat', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
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
    // SECURITY (T0-9): entitlement/billing email is the VERIFIED token email ONLY — a client-claimed
    // body email grants nothing (see entitlementEmail). This closes a free-list spoof: an unverified
    // caller could previously claim the admin's free-list email and run billing-exempt FREE Opus builds.
    // A real admin's transient token blip self-heals (the client refreshes its token on the 401 below).
    let email = entitlementEmail(verified);
    // FREE-LIST EXEMPTION HARDENING (deep-test 2026-07-13 — the admin's -1,22,330-token wallet). Free-list
    // exemption matches by EMAIL; when the verified token omits the email claim (some providers / custom
    // tokens do), `entitlementEmail` is null → a free-list admin matched uid-only → NOT exempt → billed and
    // debited into the deep negative. Resolve the account's REAL email from the already-VERIFIED uid (T0-9
    // safe — server-side account email, never client-claimed) so exemption holds regardless of token claims.
    // Best-effort: null on failure → degrades to exactly today's behavior. Only runs when the token lacked one.
    if (!email && verified?.uid) {
      email = await resolveVerifiedEmail(verified.uid);
    }
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v5.0) is not enabled.' });
      return;
    }
    // SECURITY Phase 1.3 (bill-or-refuse): a build spends NavBharatAI's paid model budget, so a
    // caller with NO billable identity may not run one. A verified user is fine; the Fix-26 graceful
    // degrade of an allowlisted identity (token-blip admin whose claimed email is on the allowlist)
    // is fine; a genuinely anonymous caller is refused with an honest 401. Runs before flushHeaders,
    // so this is a clean HTTP error, not a broken stream. The client force-refreshes its token on
    // this path, so a real signed-in user's transient blip self-heals on retry.
    if (buildRequiresSignIn(userId, email)) {
      res.status(401).json({
        error: 'Please sign in to build with NavBharatAI Pro v5.0 — builds run on a real account so usage can be tracked.',
        code: 'signin',
      });
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
        // SECURITY (T0-9): attribute abuse to the VERIFIED identity already resolved above (`userId`),
        // NEVER the spoofable `req.body.userId`. Keying the ledger off the claim let an authenticated
        // attacker (a) accrue jailbreak violations under a victim's uid to get the VICTIM hard-blocked
        // (targeted DoS), and (b) evade their own accumulating block by rotating the claimed uid.
        const abuserUid = userId || 'anon';
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

    // ── ROLE CHAT LANE (FIX #5 — the 3-role model's PLANNER + ADVISOR) ─────────────────────────────
    // A read-only turn: NO tools at all (structurally nothing to write with), grounded in the REAL
    // project (file tree + a bounded relevance-picked subset of contents), replying with analysis and
    // optionally a proposed-steps block the USER approves into the executor's queue. Deliberately
    // BEFORE the build lock: a role turn never writes, so it must run freely WHILE the executor builds
    // (that concurrency is the whole point of the model). Old clients never send `chatRole` → this
    // lane is invisible to them.
    const chatRole = parseChatRole(req.body?.chatRole);
    if (chatRole) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const sendLine = (e: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n'); };
      const roleWorkspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
      try {
        // Ground the role in the REAL project: durable files → tree + relevance-picked contents.
        const roleFiles = await raceTimeout(loadWorkspaceFiles(roleWorkspaceId), 8_000, 'roleLoadFiles').catch(() => ({} as Record<string, string>));
        const fileTree = summarizeFileTree(Object.keys(roleFiles));
        const picked = selectRoleContextFiles(roleFiles, prompt);
        const roleRecall = (() => {
          try { return sessionRecallContextLine(getWorkspaceMemory(roleWorkspaceId).snapshot().episodes); } catch { return ''; }
        })();
        const system = LANGUAGE_RULE + '\n\n' + roleSystemPrompt(chatRole) + '\n\n' + recencyDirective() + roleRecall + formatRoleContext(fileTree, picked);
        const roleRouter = AIRouterManager.getRouter('free');
        const { response } = await raceTimeout(roleRouter.route(prompt, system), 45_000, 'roleChat.route');
        const fullReply = response.content || '';
        const steps = parseProposedSteps(fullReply);
        const prose = stripStepsBlock(fullReply) || fullReply;
        sendLine({ type: 'narration', agent: 'architect', text: prose, ts: Date.now() });
        // Steps are PROPOSED only — the client shows them for approval; nothing is auto-enqueued.
        if (steps.length > 0) sendLine({ type: 'proposed_steps', role: chatRole, steps, ts: Date.now() });
        sendLine({ type: 'done', ok: true, summary: prose, ts: Date.now() });
        sendLine({ type: 'result', ok: true, summary: prose, steps: 0, billedUsd: 0, billedInr: 0 });
        // Persist the turn + memory exactly like the plain-chat lane (best-effort, bounded).
        try {
          const mem = getWorkspaceMemory(roleWorkspaceId);
          mem.recordRequest(prompt);
          void saveWorkspaceMemory(roleWorkspaceId, mem.snapshot()).catch(() => {});
        } catch { /* best-effort */ }
        try {
          await raceTimeout(upsertConversationTurn(getConversationStore(), {
            conversationId: conversationIdForWorkspace(roleWorkspaceId),
            userId: userId ?? 'anon',
            workspaceId: roleWorkspaceId,
            title: deriveTitle(prompt),
            turn: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: prose },
            ],
            patch: { status: 'complete', updatedAt: Date.now() },
          }), 8_000, 'persistRoleTurn');
        } catch { /* persistence is best-effort */ }
      } catch (roleErr) {
        const msg = roleErr instanceof Error ? roleErr.message : String(roleErr);
        sendLine({ type: 'error', message: `The ${chatRole} could not reply (${msg}). Please try again.`, ts: Date.now() });
        sendLine({ type: 'result', ok: false, summary: `${chatRole} turn failed.`, steps: 0, billedUsd: 0, billedInr: 0 });
      }
      if (!res.writableEnded) res.end();
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
      // A build past its hard max + a 2-min grace is a zombie (the run aborts at maxBuildSeconds) — reclaim
      // it even if a stale subscriber lingers. 0 (max disabled) keeps only the abandoned-lock reclaim.
      const hardMaxMs = maxBuildSeconds() > 0 ? maxBuildSeconds() * 1000 + 120_000 : 0;
      if (shouldReclaimBuildLock(existing, Date.now(), 30_000, hardMaxMs)) {
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
    // Power level (admin tier→model redefinition 2026-07-13): 'weak' (GLM/Kimi, never Claude) |
    // 'off' (Normal, adaptive) | 'mini' (Strong → Sonnet 100%) | 'medium' (Powerful → Opus medium
    // effort) | 'max' (Full Team → Opus max/ultracode). Accepts the new `powerLevel` field; falls
    // back to the legacy `onlyOpus` boolean (→ 'mini').
    const powerLevelReq = toPowerLevel(req.body?.powerLevel ?? (req.body?.onlyOpus === true));
    // POWER-TIER GATING (admin 2026-07-12): a FREE user (logged in, never purchased, NOT free-list) may use
    // ONLY the cheap 'weak' tier (GLM/Kimi, never Claude). Clamp it SERVER-SIDE — the UI only shows 'weak'
    // to free users, but the server enforces it so a UI bypass (a hand-crafted request with power:'max')
    // can never spend NavBharatAI's Claude/Opus budget. Free-list admins/testers + paying users keep all
    // five tiers. The wallet is read here ONLY when a non-free-list user asks for a NON-weak tier (so the
    // common free→weak path costs no extra Firestore read).
    const powerFreeListUnrestricted = isAgentV3FreeUser(userId, email);
    let powerLevelReqEffective = powerLevelReq;
    if (!powerFreeListUnrestricted && powerLevelReq !== 'weak') {
      const powerWallet = userId ? await firestoreWalletReader(getDb())(userId).catch(() => null) : null;
      // isFreeTierUser(null) → true (conservative: an unreadable wallet is treated as free → clamped to
      // weak). Fail-CLOSED on purpose — a Firestore blip must never let a free account reach a paid tier.
      const isPaidForPower = !isFreeTierUser(powerWallet);
      powerLevelReqEffective = clampPowerForUser(powerLevelReq, isPaidForPower);
    }
    const powerSpecResolved = powerSpec(powerLevelReqEffective);
    const onlyOpus = powerSpecResolved.powerMode;
    // Admin tier→model redefinition (2026-07-13): `onlyOpus` (kept name for the ~30 existing call
    // sites) now means "a PAID PINNED tier is selected" (mini/medium/max) — gating, no cheap floor,
    // no ladder. `pinnedOpus` is true ONLY for the real Opus tiers (medium/max): everything that
    // must run Opus-side (plan-on-Claude, Claude vision, Opus judge) keys on THIS, so a Strong
    // ('mini' → Sonnet 100%) build can never trigger an Opus call anywhere.
    const pinnedOpus = powerSpecResolved.pinnedModel === 'opus';
    // Honest guard (rule 6): if a build is forced onto the cheap 'weak' tier but NO cheap floor is
    // configured (AGENTV3_CHEAP_FLOOR unset / keyless), there is nothing to run it on — and it must NOT
    // silently fall back to Claude (that is the exact free-user money leak). Refuse honestly instead.
    if (powerSpecResolved.cheapOnly && cheapBuildFloorRunners().length === 0) {
      activeBuilds.delete(buildKey);
      audit('AGENTV3_WEAK_TIER_NO_FLOOR', { userId }, 'warn');
      res.status(503).json({ error: 'The free engine is temporarily unavailable. Please try again shortly, or add credits to build on the full engine.', code: 'WEAK_ENGINE_UNAVAILABLE' });
      return;
    }

    // PAID-PUBLIC AFFORDABILITY GATE (admin plan 2026-07-06) — flag-gated OFF by default.
    // Runs BEFORE flushHeaders() so a refusal is a clean pre-stream HTTP 402 (no stream started). The
    // whole block is inert unless AGENTV3_PAID_PUBLIC=true; free-list users (admin/testers) bypass it and
    // are never even read from the wallet. A build that is ALLOWED to start always runs to completion —
    // this never kills a running build; settlement on the ACTUAL cost happens afterwards (the graceful
    // overdraft in Affordability absorbs any estimate miss). `paidEconomyNotice` is emitted once the
    // stream opens (below) so a low-balance user is told honestly, without blocking their work.
    let paidEconomyNotice: string | null = null;
    // Weak-tier notice (admin final spec 2026-07-12): true when the CALLER is a free-tier user (never
    // purchased) — used to emit the localized "you are on the free Weak engine, recharge unlocks all
    // tiers" narration once the stream opens. Stays null when billing is off / no wallet read happened.
    let callerIsFreeTier: boolean | null = null;
    // The affordability gate runs when EITHER the full paid-public switch OR the decoupled credit gate
    // (AGENTV3_CREDIT_GATE) is on. The credit gate lets ₹0-balance accounts be blocked from spending
    // NavBharatAI's model budget without turning on the rest of paid-public (which stays OFF during the
    // security migration). Free-list users (admin/testers) always bypass it.
    if ((isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) && !isAgentV3FreeUser(userId, email)) {
      // ONE wallet read serves the whole paid-surface gate: the power-mode paid-only check (doc's
      // totalMoneySpent) AND the balance math below (doc's remaining_balance via the same pure reader).
      // An anonymous caller (userId null) has no wallet to read → balance-unknown → fail-open proceed.
      const walletDoc = userId ? await firestoreWalletReader(getDb())(userId).catch(() => null) : null;
      const balanceInr = userId ? await readWalletBalanceInr(async () => walletDoc, userId) : null;
      if (userId) callerIsFreeTier = isFreeTierUser(walletDoc);
      // Slice F (admin routing plan §1 row 6): POWER MODE (Only Opus) is for PAYING accounts only —
      // a user who has never purchased cannot spend the most expensive engine. Refused pre-stream,
      // BEFORE the balance math, with the specific actionable reason (not a generic credits message).
      // Free-list admins/testers never reach here (outer condition), and with billing off this whole
      // block is inert — exactly today's behavior.
      if (powerModeBlockedForFreeUser(onlyOpus, walletDoc)) {
        activeBuilds.delete(buildKey); // release the lock; the build never starts.
        audit('AGENTV3_POWER_MODE_BLOCKED_FREE_USER', { userId }, 'info');
        res.status(402).json({
          error: powerModePaidOnlyMessage(),
          code: 'POWER_MODE_PAID_ONLY',
          ...(typeof balanceInr === 'number' ? { balanceInr, balanceTokens: inrToWalletTokens(balanceInr) } : {}),
        });
        return;
      }
      const estimate = estimateBuildCost(prompt, powerLevelReqEffective, usdInrRate());
      const gate = decidePaidGate({
        // The gate itself is active here (outer condition already gated on the two flags); decidePaidGate
        // keys its block/economy/proceed decision on this being true, so pass true regardless of which
        // flag enabled it.
        paidPublicEnabled: true,
        isFreeUser: false,
        balanceInr,
        estimateInr: estimate.inr,
        overdraftInr: PAID_OVERDRAFT_INR,
      });
      if (gate.action === 'block') {
        activeBuilds.delete(buildKey); // release the lock acquired above; the build never starts.
        audit('AGENTV3_BUILD_BLOCKED_NO_CREDITS', { userId, balanceInr, estimateInr: estimate.inr }, 'warn');
        void notifyLowBalance(userId, true);
        res.status(402).json({
          error: gate.notice || 'Your credits are used up. Add credits to start a new build.',
          code: 'INSUFFICIENT_CREDITS',
          balanceInr,
          estimateInr: estimate.inr,
          // Billing Phase 2 — token-first display: the same numbers in the wallet's primary unit,
          // converted at the SAME rate purchases mint and debits burn (inrToWalletTokens).
          ...(typeof balanceInr === 'number' ? { balanceTokens: inrToWalletTokens(balanceInr) } : {}),
          estimateTokens: inrToWalletTokens(estimate.inr),
        });
        return;
      }
      if (gate.action === 'economy') {
        // HONEST notice: the dedicated cheap "economy engine" routing is not yet enabled (it is gated on
        // the provider bake-off), so we do NOT claim to switch engines — the build simply continues on
        // the standard engine and the user is told to top up. No fake capability.
        paidEconomyNotice =
          'Low balance — your build will continue as normal. Add credits to keep full speed on every build.';
        audit('AGENTV3_BUILD_LOW_BALANCE_ECONOMY', { userId, balanceInr, estimateInr: estimate.inr }, 'info');
      }
    }

    // FREE-TIER cheap-only routing (admin 2026-07-10) — DORMANT unless AGENTV3_FREE_TIER_CHEAP=true.
    // A not-yet-paying public user's build runs on the cheap floor (GLM/Kimi) ALONE — never Claude —
    // so NavBharatAI's Claude budget is spent only on paying users. Reads the wallet ONLY when the
    // feature is on (zero added Firestore work on today's default path), and only when a cheap floor is
    // actually configured (else there is nothing to route to → normal path). A paying user, an anon
    // caller, or a free-list admin is never free-tier. If the cheap build fails, the route converts the
    // user to paid (upsell) rather than rescuing on Claude — see the build-failed handling below.
    let freeTierBuildActive = false;
    if (
      // Slice G: the ONE master switch (AGENTV3_COST_ROUTING, per-user canary via _USERS) turns this
      // on; the older per-feature flag stays honored as a surgical override. Either activates it.
      (freeTierCheapEnabled() || costRoutingActiveFor(userId, email)) &&
      userId &&
      (isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) &&
      !isAgentV3FreeUser(userId, email) &&
      cheapBuildFloorRunners().length > 0
    ) {
      const walletDoc = await firestoreWalletReader(getDb())(userId).catch(() => null);
      freeTierBuildActive = isFreeTierBuild({
        enabled: true,
        billingActive: true,
        cheapFloorConfigured: true,
        wallet: walletDoc,
      });
      if (freeTierBuildActive) {
        audit('AGENTV3_FREE_TIER_CHEAP_BUILD', { userId }, 'info');
      }
    }
    // POWER-TIER (admin 2026-07-12): the 'weak' tier ALWAYS routes cheap-only (GLM/Kimi, never Claude),
    // independent of the AGENTV3_COST_ROUTING env canary — a free user is clamped to 'weak' above, so this
    // is what makes "free user par kabhi Sonnet nahi" true by construction. The no-floor case was already
    // refused honestly at the clamp (WEAK_ENGINE_UNAVAILABLE), so here the floor is guaranteed present.
    if (!freeTierBuildActive && powerSpecResolved.cheapOnly && cheapBuildFloorRunners().length > 0) {
      freeTierBuildActive = true;
      audit('AGENTV3_WEAK_TIER_CHEAP_BUILD', { userId }, 'info');
    }
    // UNBREAKABLE no-Claude signal (admin absolute rule, 2026-07-13): TRUE whenever this build is on the
    // cheap/weak tier — either the resolved WEAK power level (`powerSpecResolved.cheapOnly`) OR the
    // cost-routing free tier (`freeTierBuildActive`). Threaded as `noClaude` into EVERY buildTurnRunner
    // call (builder + all heal gates) so the enforceNoClaude chokepoint strips Claude by construction.
    // Independent of any single flag path, so no forgotten call site can leak a Claude call onto a weak
    // build. (`powerSpecResolved.cheapOnly` is redundant here since the block above already promotes it
    // into freeTierBuildActive, but kept explicit so the intent survives future edits to that block.)
    const noClaudeBuild = freeTierBuildActive || powerSpecResolved.cheapOnly === true;

    // Smart planning gate: skip for simple apps (todo, calculator, etc.) to save
    // 2-3 min. planFirst=false from the client always wins (explicit user skip).
    // planFirst=true (or absent) defers to the complexity classifier — a simple
    // prompt skips planning even when the client hasn't explicitly disabled it.
    const planFirstRequested = req.body?.planFirst !== false;
    const planFirst = planFirstRequested && decidePlanning(prompt) !== 'skip';
    const thinking = req.body?.thinking === true; // adaptive thinking, off by default
    // "made by NavBharatAI" app-signature toggle (admin 2026-07-16). Default ON (viral-growth):
    // absent/undefined = ON; only an explicit `false` from Settings → General turns it off.
    const appSignatureEnabled = req.body?.appSignature !== false;

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
    // "No response from the v5.0 engine … the backend may be unreachable, or v5.0 is
    // not enabled." This first byte forces the infra to commit to the stream and makes
    // the client register a real event immediately, so a later failure surfaces its
    // OWN honest terminal error instead of the bare "no response" message. A `ping` is
    // the contract-safe choice: the client already ignores the 15 s keepalive pings.
    send({ type: 'ping' });
    // PAID-PUBLIC low-balance notice (honest): when the affordability gate returned 'economy', the build
    // proceeds normally but the user is told, in-chat, that their balance is low. Emitted as a system
    // narration so it renders in the build conversation right away. Null (the default / gate-off) → nothing.
    if (paidEconomyNotice) {
      send({ type: 'narration', agent: 'system', text: paidEconomyNotice, ts: Date.now() });
    }
    // Weak-tier welcome notice (admin final spec 2026-07-12): a FREE user on the weak tier is told — in
    // their own language, right at the top of the reply — that they are on the free Weak engine, where the
    // ⚙️ tier selector lives (the Settings-gear "Build options" button in the toolbar just below the message box), and that the first
    // recharge unlocks all tiers.
    // Shown once per user per server instance (a gentle reminder may repeat after a cold start — fine);
    // the phrasing rotates by seed so repeats never read identically.
    if (callerIsFreeTier === true && powerSpecResolved.cheapOnly && userId && !weakNoticeShownFor.has(userId)) {
      weakNoticeShownFor.add(userId);
      const langCode = detectLanguageHint(prompt)?.code ?? null;
      send({ type: 'narration', agent: 'system', text: weakTierWelcomeNotice(langCode, userId.length + prompt.length), ts: Date.now() });
    }
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
        const vis = await raceTimeout(describeVisionAttachments(docAttachments, { useClaude: pinnedOpus, noClaude: noClaudeBuild }), 8_000, 'describeVisionAttachments')
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
    // EXPLICIT full-app build WINS over the non-empty-workspace heuristic (report 2026-07-07): a
    // detailed "Create a complete Hospital OPD Management System" was downgraded to a surgical edit
    // because 3 scaffold/test files restored from history made projectExists=true — so the engine
    // "edited" the app page-by-page over junk files (26 min, 146 steps, incomplete). An explicit
    // build-a-complete-app request is a fresh build regardless of stray files in the workspace.
    const explicitCompleteBuild = isExplicitCompleteBuild(prompt);
    if (intent === 'new_build' && projectExists && !wantsFreshStart(prompt) && !explicitCompleteBuild) {
      intent = 'edit_existing';
    } else if (intent === 'edit_existing' && explicitCompleteBuild) {
      // Rescue a spurious edit classification (the LLM biased by projectExists, or a keyword edit
      // signal) when the user EXPLICITLY asked to CREATE A COMPLETE new app. Strict detector, so a
      // genuine edit ("add a logout button", "fix the header") can never be flipped to a rebuild.
      intent = 'new_build';
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
        let chatPrompt = attachmentContext
          ? `${prompt}\n\nThe user attached file(s); here is the extracted content:\n\n${attachmentContext}`
          : prompt;
        // LIVE WEB GROUNDING (admin 2026-07-12): a plain chat question that needs current facts
        // (sports/news/prices/"latest"/"aaj") gets real search results folded in, so v5.0 answers from
        // today's data, not its training cutoff. Gated + bounded + best-effort — normal chat is untouched.
        try {
          const liveBlock = await liveSearchContext(prompt);
          if (liveBlock) chatPrompt = `${liveBlock}\n\n---\n${chatPrompt}`;
        } catch { /* live search is best-effort */ }
        // v5.0 used to answer a plain chat question ("kितni files hai?") completely blind — the chat
        // lane never loaded any workspace context. projectFileCount was already computed above for
        // intent classification (no extra Firestore call needed here).
        const chatWorkspaceContext = chatWorkspaceContextLine(projectFileCount);
        // v5.0 preview self-awareness: so "kya preview chal raha hai?" is answered from REAL state, not a
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
                "mention which model you are.\n\n" + CREATOR_IDENTITY + '\n\n' + INDIA_TERRITORIAL_INTEGRITY + '\n\n' + recencyDirective() + chatWorkspaceContext + chatPreviewHealth + chatSessionRecall +
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
    const rb: RunningBuild = { abort, buffer: [], subscribers: new Set(), ended: false, startedTs: Date.now(), key: userId ?? 'anon', userId, workspaceId: intentWorkspaceId, steerQueue: [], powerLevel: powerLevelReqEffective };
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
    let disposeGreenFreezeObserver: (() => void) | null = null;

    const events = new AgentEventStream();
    events.subscribe((e) => emit(e), false);
    const state = new WorkspaceState(events);

    // AP-4 (flag-gated): when parallel building is ON, wrap the actuator so concurrent frontend/backend
    // sub-agents can't clobber each other on the SAME file path (same-path writes serialize; disjoint
    // paths run concurrently — the speedup). Off by default ⇒ the raw actuator, byte-identical to today.
    const rawActuator = buildActuator();
    const parallelBuild = parallelBuildEnabled();
    const buildWriteLock = new PathWriteLock();
    const actuator = parallelBuild ? lockedActuator(rawActuator, buildWriteLock) : rawActuator;
    const workspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    // GREEN FREEZE — clear any stale green latch for this workspace at the VERY START, before a single
    // write. This is the robust fix for the leak the adversarial review found (2026-08-12): a prior
    // build for the same workspace can end via a reclaim / sweeper / drain path that bypasses the
    // finally, leaving its latch set — which would then freeze THIS build's early generation writes and
    // break it. Clearing here does not depend on any prior build's cleanup running, so no teardown path
    // can leak a latch into the next build.
    try { clearGreenLatch(workspaceId); } catch { /* best-effort */ }
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
    // Agent-facing warning when the restored workspace's source files and package.json disagree on the
    // framework (set by the coherence pre-flight in the FileGuardian block below; prepended to buildPrompt).
    let frameworkCoherenceMsg = '';
    // BIDIRECTIONAL FRAMEWORK SELECTION (admin 2026-07-20: "chahe user settings se select kare ya chat me
    // bol de … dono se apne aap select ho jaye"). Two paths, one deterministic reconcile:
    //   • SETTINGS pick — `frameworkExplicit === true` means the user actually chose in the picker; that
    //     choice ALWAYS wins (even React+Vite), so chat text never overrides a deliberate pick.
    //   • CHAT mention — when the pick was NOT explicit (the bare 'vite-react' default), an explicitly-named
    //     framework in the PROMPT selects the matching scaffold. Now covers BOTH front-end/meta frameworks
    //     AND pure back-end/API requests (detectFrameworkFromPrompt phase 2), e.g. "build a Django REST API".
    // MelodyBox root cause (2026-07-18) that started this: the build path never read the prompt, so a "Vue 3"
    // prompt was scaffolded as React → unresolved imports, readiness 0/100. A project import overrides again
    // below (L~4409). Backward-compatible: an old client sends no `frameworkExplicit`, so detection still
    // runs whenever the value is the bare default — exactly today's behaviour.
    //   • CONFLICT — if the user picked framework A but the text names a DIFFERENT framework B, the CLIENT
    //     confirms first and re-sends with `frameworkResolved` set (never silently build the wrong stack).
    //     The server uses the SAME shared resolver; on a residual conflict (e.g. a non-interactive caller
    //     that can't confirm) it honours the explicit PICK, so a build is never blocked here.
    const frameworkExplicit = req.body?.frameworkExplicit === true;
    const frameworkResolved = req.body?.frameworkResolved === true;
    const fwSel = resolveFrameworkSelection({ picked: framework, explicit: frameworkExplicit, prompt, resolved: frameworkResolved });
    framework = fwSel.status === 'ok' ? fwSel.framework : fwSel.picked;
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
    // Fix 41: a failed GitHub-URL import (private/no-access/bad-url) recorded here so the architect
    // prompt can acknowledge it instead of re-asking the user for the URL they already gave.
    let failedImport: { url: string; reason: string } | null = null;
    // INSTANT CONNECT (admin 2026-07-24, "Claude 0.1s me repo connect ho jata hai"): the repo's file tree
    // + a couple of key files, fetched via the GitHub API BEFORE any download/land — so the survey can
    // describe the app immediately (like Claude reading a tree, not bulk-cloning). Injected into the
    // architect prompt below; the full file materialization (zipball) still runs for edit/build.
    let importSurvey: { url: string; fileCount: number; structure: string; keyFiles: Record<string, string>; truncated: boolean } | null = null;
    /**
     * DURABLE import accounting (admin 2026-08-03, mitrify): record where every archive entry went,
     * into the BUILD REPORT — not only the chat narration. The gap between "316 files" (the repo
     * listing) and "166 source files" (what the AI edits) was never explained anywhere the admin
     * could read it, so the only possible reading was "10% bhi import nahi ho paya". The numbers
     * exist (`extracted.dropped`); they were simply thrown away. Best-effort by construction —
     * accounting must never break an import.
     */
    const recordImportAccounting = (
      extracted: Parameters<typeof importAccountingLine>[0],
      diag?: { record: (issue: { phase: 'build' | 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }) => void },
    ): void => {
      try {
        const line = importAccountingLine(extracted);
        // Durable: the build report must answer "where did my files go?" on its own.
        diag?.record({ phase: 'build', severity: 'info', code: 'IMPORT_ACCOUNTING', message: line, autoResolved: true });
        // …and answer it where the user is actually looking, too.
        emit({ type: 'narration', agent: 'architect', text: `📊 ${line}`, ts: Date.now() });
      } catch { /* accounting is best-effort */ }
    };

    const landImportedProject = async (
      importedFiles: Record<string, string>,
      opts: { source: string; writeToSandbox: boolean; droppedNote?: string; sandboxOnly?: Record<string, string>; assets?: Record<string, string>; sandboxAssets?: Record<string, string>;
        // `detail` carries the provider's/boot's own words for the ADMIN report; `recordCommand` is what
        // lets this path leave the same forensic trail the agent's own commands already leave.
        diag?: {
          record: (issue: { phase: 'build' | 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean; detail?: string }) => void;
          recordCommand?: (rec: { command: string; exitCode: number | null; stdout?: string; stderr?: string; durationMs?: number }) => void;
          /** Push the framework label the import DETECTED, so the report stops carrying the request default. */
          setFramework?: (framework: string) => void;
          /** Name the long NON-TOOL stretch running now, so a quiet minute is described, not guessed at. */
          enterPhase?: (name: string) => void;
          exitPhase?: () => void;
        } },
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
        const landed = await writeWorkspaceFiles(actuator, workspaceId, importedFiles);
        written = landed.written;
        // HOW the files landed (bulk tar vs per-file) + the count-proof — into the build report, so a
        // future "files missing after import" report can be diagnosed from evidence instead of guesses
        // (the #2044→#2046 loss was invisible precisely because this telemetry was thrown away).
        try {
          opts.diag?.record({
            phase: 'build', severity: 'info', code: 'IMPORT_LANDING',
            message: `Sandbox landing: ${landed.written.length} file(s) via ${landed.landedVia ?? 'per-file'}`
              + (landed.bulkVerifiedCount !== undefined ? ` (bulk extract count-verified: ${landed.bulkVerifiedCount})` : '')
              + (landed.skipped.length > 0 ? `; ${landed.skipped.length} skipped` : ''),
            autoResolved: true,
          });
        } catch { /* telemetry is best-effort */ }
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
      // SANDBOX-ONLY images (large images the durable store can't hold): materialize them for the LIVE
      // preview so imported apps aren't full of broken pictures — but do NOT persist them (a cold
      // restart re-imports, exactly like big lockfiles). admin 2026-08-03.
      const sandboxAssets = opts.sandboxAssets ?? {};
      if (opts.writeToSandbox && Object.keys(sandboxAssets).length > 0) {
        try { await materializeAssets(actuator, workspaceId, sandboxAssets); } catch { /* best-effort — a broken image never blocks the import */ }
      }
      // DURABLE PERSIST — the half whose absence caused "zip imported but Files/IDE/Preview all
      // empty": without it the import lives only in the ephemeral sandbox.
      try { await mergeWorkspaceFiles(workspaceId, importedFiles); } catch { /* durable persist is best-effort */ }
      framework = validation.framework;
      // TELL THE REPORT (autopsy d6deaaf0): the diagnostics object captured `framework` at build
      // start, before the import existed, so it kept the request default while the manifest recorded
      // the detected one — one build, two answers. The label is now pushed wherever it changes.
      try { opts.diag?.setFramework?.(framework); } catch { /* a label update never blocks an import */ }
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
      // PERSISTENT-DATABASE ADVISORY (admin 2026-07-23 — big imported apps must be told clearly "this is the
      // problem, here's the solution"): if the imported app uses a database and the user has NOT connected
      // their own persistent DB, say so plainly and point them at the real fix (Settings → Database, the
      // existing bring-your-own flow the engine auto-wires) — instead of leaving DB guidance only in the
      // model's hidden system prompt (invisible unless the model relays it). Suppressed when a DB is already
      // connected. Best-effort + kill-switch AGENTV3_DB_ADVISORY=off.
      if (process.env.AGENTV3_DB_ADVISORY !== 'off') {
        try {
          const provider = detectDatabaseProvider(importedFiles);
          if (provider) {
            const vault = userId ? await loadUserVaultSecrets(userId).catch(() => null) : null;
            const connected = !!userDatabaseContext(vault);
            const advisory = persistentDatabaseAdvisory({ provider, connected });
            if (advisory) emit({ type: 'narration', agent: 'architect', text: advisory, ts: Date.now() });
          }
        } catch { /* the DB advisory is best-effort — never blocks an import */ }
      }
      // ROCK-SOLID IMPORT (admin 2026-07-07): an imported repo can itself be INCOMPLETE — a snapshot
      // pushed from an interrupted mid-build state (real case: App.tsx importing five src/pages/*
      // files the repo never contained). Detect unresolved LOCAL imports deterministically at IMPORT
      // time and say so with the exact list + a one-line repair path — the user must never discover
      // this later as a stubbed, blank preview. The AI turn also gets the list, so "fix it" works.
      try {
        const unresolved = findUnresolvedLocalImports(importedFiles);
        if (unresolved.length > 0) {
          const list = unresolved.slice(0, 8).map((u) => `${u.missing} (imported by ${u.importedBy})`).join('; ');
          const more = unresolved.length > 8 ? ` …and ${unresolved.length - 8} more` : '';
          emit({
            type: 'narration', agent: 'architect', ts: Date.now(),
            text: `⚠️ This import looks INCOMPLETE — ${unresolved.length} file(s) its code references are missing from the repo: ${list}${more}. The snapshot may have been saved mid-build. Say "create the missing files" and I'll build them to match the imports.`,
          });
          attachmentContext += `\n\n[IMPORT COMPLETENESS] These local imports resolve to NO imported file (the repo snapshot is incomplete): ${unresolved.map((u) => `${u.missing} ← ${u.importedBy}`).join('; ')}. If the user asks to fix/complete/repair the app, CREATE exactly these files (matching what the importing code expects) — do not rename the imports.`;
        }
      } catch { /* completeness check is best-effort — never blocks an import */ }
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
      // FORENSIC TRAIL (mitrify autopsy 2026-08-04, "Cannot GET /customer/home" AGAIN): the honest
      // boot-verify shipped 2026-08-03 — and today's report contained ZERO preview entries, so the #1
      // user-visible failure could not be autopsied: was the boot skipped? did it finish after the
      // stream closed (emitLive drops post-end narrations by design)? Nobody could tell. Every branch
      // now records into buildDiag, which does not depend on the stream — starting with the SKIP case,
      // whose reason was exactly the entry missing from today's report.
      if (!(validation.hasPackageJson && sandboxDiag().livePreviewAvailable)) {
        opts.diag?.record({
          phase: 'preview', severity: 'info', code: 'IMPORT_PREVIEW_SKIPPED',
          message: `Background live-preview boot NOT attempted for this import: ${!validation.hasPackageJson ? 'the project has no package.json (nothing to npm-install/run)' : 'the sandbox live preview is unavailable in this session'}.`,
          autoResolved: true,
        });
      }
      if (validation.hasPackageJson && sandboxDiag().livePreviewAvailable) {
        const emitLive = (e: unknown): void => { if (!rb.ended) emit(e); };
        opts.diag?.record({
          phase: 'preview', severity: 'info', code: 'IMPORT_PREVIEW_BOOT_STARTED',
          message: 'Background live-preview boot started (npm install + dev server). Its verdict is recorded here even if it lands after the reply stream closes.',
          autoResolved: true,
        });
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
              const dbStartedAt = Date.now();
              try {
                const prov = await withTimeout(actuator.provisionBackend(workspaceId, ['db']), 130_000, 'import-db-provision');
                Object.assign(provided, prov.envVars ?? {}); // DATABASE_URL
                // FORENSIC TRAIL (admin 2026-08-04): this outcome used to be swallowed entirely, so a
                // report could never say whether the database the app needs actually came up.
                //
                // AND THE CLAIM IS NOW EARNED (admin task 1, 2026-08-05 — Mitrify build d5f0a2bc): this
                // very line once said "provisioned in 21s" while the app's next connect to that same URL
                // got ECONNREFUSED, because provisionBackend returned a fallback URL even when its
                // readiness poll had failed — and this record trusted the URL's existence. "Provisioned"
                // is now said only when a real SELECT 1 succeeded over the exact URL the app was handed;
                // anything less is recorded as the failure it is.
                if (prov.dbVerified === false) {
                  opts.diag?.record({
                    phase: 'preview', severity: 'warning', code: 'IMPORT_DB_PROVISION_FAILED',
                    message: `PostgreSQL was set up but the real connection test FAILED after ${Math.round((Date.now() - dbStartedAt) / 1000)}s (${prov.dbVerifyFailure === 'not-ready' ? 'the server never accepted connections' : prov.dbVerifyFailure === 'select1-failed' ? 'the server accepted connections but SELECT 1 over the app\'s URL did not succeed' : 'provisioning returned no result'}). DATABASE_URL is written for a late heal, but the app will likely fail to connect on boot. Source: ${provisionPathSummary(prov.dbDiagnostics)}.`,
                    autoResolved: false,
                    // WHY, for us — pg_ctlcluster's own error, whether psql exists, which user we
                    // are. Report 15985d3b said this truthfully and still left the cause unknown,
                    // because every reason had been swallowed inside the sandbox script.
                    ...(prov.dbDiagnostics ? { detail: prov.dbDiagnostics.slice(0, 800) } : {}),
                  });
                } else {
                  opts.diag?.record({
                    phase: 'preview', severity: 'info', code: 'IMPORT_DB_PROVISIONED',
                    // WHICH ROUTE, not just "it worked" (admin 2026-08-06). The diagnostics used to be
                    // attached on FAILURE only, so a build that succeeded told us nothing about HOW —
                    // and the one open question about the fetched-Postgres path is whether it fires in
                    // the real sandbox at all. A success that carries no evidence cannot answer it, so
                    // the summary rides here too and the next green build IS the answer.
                    message: `Sandbox database provisioned for the preview in ${Math.round((Date.now() - dbStartedAt) / 1000)}s (${Object.keys(prov.envVars ?? {}).join(', ') || 'no env vars returned'})${prov.dbVerified === true ? ' — connection verified with a real SELECT 1' : ''}. Source: ${provisionPathSummary(prov.dbDiagnostics)}.`,
                    autoResolved: true,
                    ...(prov.dbDiagnostics ? { detail: prov.dbDiagnostics.slice(0, 800) } : {}),
                  });
                }
              } catch (e) {
                // Still best-effort — the boot continues without a database — but NEVER silent again.
                opts.diag?.record({
                  phase: 'preview', severity: 'warning', code: 'IMPORT_DB_PROVISION_FAILED',
                  message: `The sandbox database did NOT come up in ${Math.round((Date.now() - dbStartedAt) / 1000)}s. The app will boot without DATABASE_URL, so anything that queries on startup may fail.`,
                  autoResolved: false,
                  detail: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
                });
              }
            }
            // P3 (admin 2026-07-05): CONJURE the app's own local secrets — SESSION_SECRET/JWT_SECRET
            // etc. get REAL random values, because an empty placeholder is itself a boot-killer
            // (express-session throws "secret option required" on '' — the exact reason the Mitrify
            // preview died). Third-party keys are NEVER faked; they stay empty + honestly listed.
            Object.assign(provided, conjurableSecrets(declaredEnvVars));
            // THE PORT IS THE APP'S OWN — WE DO NOT ASSIGN IT (admin 2026-08-09: "report me likha hai
            // app port 3000 par, lekin mitrify to port 5000 par hai").
            //
            // The report was not lying: the app really was on 3000, because WE PUT IT THERE. A pin
            // used to write a fixed PORT into the app's dev .env, so every PORT-honoring app was
            // moved off its own port. That was a workaround for the 2026-08-07
            // bug where a saved preview URL kept pointing at a port the app no longer bound — and it
            // treated the SYMPTOM (make the app match our URL) instead of the cause (make our URL
            // follow the app). Forcing the port also silently contradicts everything else in the
            // user's project that names the real one: their README, their OAuth redirect URIs, a
            // hardcoded proxy or CORS origin — and on an import turn whose instruction was "do not
            // change any files", moving the app's port is precisely the kind of change we promised
            // not to make.
            // The cause is now fixed properly: the boot below discovers the port the app ACTUALLY
            // bound (its own log first, then the ports the sandbox OS reports as listening) and the
            // preview URL follows it. So the app keeps its own port — 5000 stays 5000.
            // Write a dev .env so `process.env.X` is defined (the #1 boot-crash cause) — the
            // provisioned DATABASE_URL + generated local secrets, plus empty placeholders for the rest.
            if (declaredEnvVars.length > 0 || Object.keys(provided).length > 0) {
              // MERGED, never overwritten (fixed 2026-08-09). This used to write the generated content
              // straight over `.env`, and that content lists every declared var with an EMPTY
              // placeholder — so a real value already in the file became `KEY=`. On this very route a
              // build can have just saved the user's own key (the mid-build secrets popup), or
              // rescueDatabase can have just written a real DATABASE_URL, and this wiped it. The user
              // supplied the key, it saved, and the app still did not work.
              try {
                let existingEnv = '';
                try { existingEnv = await actuator.readFile(workspaceId, '.env'); } catch { existingEnv = ''; }
                await actuator.writeFile(workspaceId, '.env', mergeDevEnvContent(existingEnv, declaredEnvVars, provided));
              } catch { /* env write best-effort */ }
              const extNote = externalServiceNote(declaredEnvVars);
              if (extNote) emitLive({ type: 'narration', agent: 'architect', text: extNote, ts: Date.now() });
            }
            // THE MISSING SUBSYSTEM, now present (build report 32d4f48e — Mitrify): a provisioned
            // database is EMPTY. That build's boot log said `relation "profiles" does not exist`
            // twice while the preview was declared "✅ up" with 0 warnings — nothing ever ran the
            // app's own migrations. Run them HERE, right after the DB exists and the .env is written,
            // so the dev server boots against real tables. DATABASE_URL is passed explicitly because
            // migration CLIs (drizzle-kit) do not load .env themselves. Best-effort + bounded: a
            // migration failure is recorded honestly and the boot still proceeds.
            const migration = needsDb && provided.DATABASE_URL ? detectMigrationCommand(importedFiles) : null;
            // PHASE MARKERS (autopsy d6deaaf0): these stretches are not tool calls, so before this the
            // heartbeat had nothing to name and the report showed a blank gap where the minutes went.
            let migrationApplied = false;
            if (migration) {
              emitLive({ type: 'narration', agent: 'architect', text: `🗄️ Creating your app's database tables (${migration.label}) so pages that read data work in the preview…`, ts: Date.now() });
              opts.diag?.enterPhase?.('creating the database tables');
              const mStartedAt = Date.now();
              // INSTALL BEFORE MIGRATE (build report d6deaaf0, Mitrify — `npm run db:push` → exit 127,
              // `sh: 1: drizzle-kit: not found`). A migration CLI is a project DEPENDENCY, so running the
              // app's own migration script before `npm install` is a guaranteed failure — and it failed
              // silently enough that the app booted against an empty database and every data page broke.
              // The install is not extra time: the dev-server boot runs the same one seconds later and
              // now finds a warm tree. A FAILED install is recorded and the migration is skipped, because
              // running a command whose binary certainly does not exist only buys a confusing exit 127.
              let depsReady = true;
              try {
                const deps = await withTimeout(
                  Promise.resolve(actuator.ensureDependencies?.(workspaceId) ?? { ok: true, ran: false, log: '' }),
                  300_000,
                  'import-db-migrate-deps',
                );
                depsReady = deps.ok;
                if (!deps.ok) {
                  opts.diag?.record({
                    phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_SKIPPED',
                    message: `Could not install the project's dependencies, so the migration step (${migration.label}) was skipped rather than run without them — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                    autoResolved: false,
                    detail: (deps.log || '').split('\n').slice(-25).join('\n').slice(0, 1000),
                  });
                }
              } catch (e) {
                depsReady = false;
                opts.diag?.record({
                  phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_SKIPPED',
                  message: `Installing the project's dependencies did not finish in time, so the migration step (${migration.label}) was skipped — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                  autoResolved: false,
                  detail: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
                });
              }
              if (depsReady) try {
                const mcmd = `${shellEnvAssignment('DATABASE_URL', provided.DATABASE_URL)} ${migration.command}`;
                const mres = await withTimeout(actuator.runCommand(workspaceId, mcmd), 150_000, 'import-db-migrate');
                try {
                  opts.diag?.recordCommand?.({
                    command: migration.command,
                    exitCode: typeof mres.exitCode === 'number' ? mres.exitCode : null,
                    stdout: mres.stdout ?? '', stderr: mres.stderr ?? '',
                    durationMs: Date.now() - mStartedAt,
                  });
                } catch { /* diagnostics best-effort */ }
                const mok = mres.exitCode === 0;
                if (mok) migrationApplied = true;
                opts.diag?.record({
                  phase: 'preview', severity: mok ? 'info' : 'warning',
                  code: mok ? 'IMPORT_DB_MIGRATIONS_APPLIED' : 'IMPORT_DB_MIGRATIONS_FAILED',
                  message: mok
                    ? `The app's own database migrations ran clean (${migration.label}, ${Math.round((Date.now() - mStartedAt) / 1000)}s) — its tables exist before the dev server boots.`
                    : `The app's database migration step (${migration.label}) exited ${mres.exitCode} after ${Math.round((Date.now() - mStartedAt) / 1000)}s — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                  autoResolved: mok,
                });
              } catch (e) {
                opts.diag?.record({
                  phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_FAILED',
                  message: `The app's database migration step (${migration.label}) did not finish within its window — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                  autoResolved: false,
                  detail: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
                });
              }
            }
            opts.diag?.exitPhase?.();
            emitLive({ type: 'narration', agent: 'architect', text: '⚙️ Setting up the live preview in the background (npm install + dev server) — your app keeps loading while I reply…', ts: Date.now() });
            // Remembered so the migration can be RETRIED after the boot — see the retry block below.
            const migrationPending = !!migration && !migrationApplied;
            opts.diag?.enterPhase?.('installing dependencies and starting your app');
            // Fix 32 (CoreUI report 2026-07-07): launch with the PROJECT'S OWN run script (dev →
            // start → serve), never a hardcoded `npm run dev` — CoreUI's script is `start`, so the
            // blind command failed with `Missing script: "dev"` and the live preview never booted.
            const bootCommand = resolveDevRunCommand(importedFiles['package.json'] ?? null);
            const bootStartedAt = Date.now();
            const result = await withTimeout(actuator.runCommand(workspaceId, bootCommand), 240_000, 'import-preview-boot');
            const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
            // THE REPORT'S BIGGEST BLIND SPOT, closed (admin 2026-08-04: "puri build report save hi
            // nahi hoti hai"). recordCommand was wired ONLY into the ToolDispatcher, so it captured
            // commands the AGENT ran and NOTHING from this path — yet this is the phase that takes
            // minutes and produces the recurring "Cannot GET". An autopsy of build cb03bdde therefore
            // found a 238-second window with no events at all; that was never a hole in TIME, it was
            // a hole in the RECORDING. The boot's own log is the single most useful artefact for that
            // failure class, so it now rides in the report like any other command.
            try {
              opts.diag?.recordCommand?.({
                command: bootCommand,
                exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                durationMs: Date.now() - bootStartedAt,
              });
            } catch { /* diagnostics are best-effort and must never break a boot */ }
            // HONEST LAST LINE (report 32d4f48e): when the boot log itself PROVES missing tables
            // (`relation "profiles" does not exist`), that evidence must never again sit unread in
            // the command log while the tally reports zero problems. Recorded and told to the user —
            // a preview that renders its shell but fails every data read is not a working preview.
            const missingTable = schemaMissingFromLog(combined);
            if (missingTable) {
              opts.diag?.record({
                phase: 'preview', severity: 'warning', code: 'DB_SCHEMA_MISSING',
                message: `The boot log shows the database is missing its tables (first: "${missingTable}") — pages that read data will fail even where the preview renders. ${migration ? `The migration step (${migration.label}) ran — see its own entry for the outcome.` : 'No migration script was found in the project to create them.'}`,
                autoResolved: false,
              });
              emitLive({ type: 'narration', agent: 'architect', text: `⚠️ Heads up: the app's database is missing its "${missingTable}" table — pages that read data may fail until the app's migrations run.`, ts: Date.now() });
            }
            opts.diag?.exitPhase?.();
            // RETRY THE MIGRATION AFTER THE BOOT (real report e61b13b1, 2026-08-10). The pre-boot
            // install failed here with `exit status 217` — and the SAME installer then succeeded
            // nineteen seconds later inside the boot ("[health-check] installing dependencies… done").
            // So the migration was skipped for a condition that had already cleared, and the app booted
            // against an empty database exactly as before the fix; only the reason in the report
            // changed. The boot PROVES the dependencies are installed, so that is the honest moment to
            // try again. This is a second chance, not a cover-up: the first attempt's failure stays in
            // the report, and WHY that install failed while the next one worked is recorded in
            // PROGRESS.md as an open root cause rather than guessed at here.
            if (migrationPending && migration && provided.DATABASE_URL) {
              opts.diag?.enterPhase?.('creating the database tables (second attempt)');
              const rStartedAt = Date.now();
              try {
                const rcmd = `${shellEnvAssignment('DATABASE_URL', provided.DATABASE_URL)} ${migration.command}`;
                const rres = await withTimeout(actuator.runCommand(workspaceId, rcmd), 150_000, 'import-db-migrate-retry');
                try {
                  opts.diag?.recordCommand?.({
                    command: `${migration.command} (retry after install)`,
                    exitCode: typeof rres.exitCode === 'number' ? rres.exitCode : null,
                    stdout: rres.stdout ?? '', stderr: rres.stderr ?? '',
                    durationMs: Date.now() - rStartedAt,
                  });
                } catch { /* diagnostics best-effort */ }
                const rok = rres.exitCode === 0;
                opts.diag?.record({
                  phase: 'preview', severity: rok ? 'info' : 'warning',
                  code: rok ? 'IMPORT_DB_MIGRATIONS_APPLIED' : 'IMPORT_DB_MIGRATIONS_FAILED',
                  message: rok
                    ? `The app's own database migrations ran clean on a second attempt (${migration.label}), once the dev-server boot had installed the dependencies — its tables now exist.`
                    : `The app's database migration step (${migration.label}) also failed on a second attempt, after the boot installed the dependencies (exit ${rres.exitCode}) — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                  autoResolved: rok,
                });
              } catch (e) {
                opts.diag?.record({
                  phase: 'preview', severity: 'warning', code: 'IMPORT_DB_MIGRATIONS_FAILED',
                  message: `The second attempt at the app's database migrations did not finish within its window — its tables may be missing, so pages that read data can fail even if the preview looks up.`,
                  autoResolved: false,
                  detail: e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400),
                });
              }
              opts.diag?.exitPhase?.();
            }
            opts.diag?.enterPhase?.('checking the live preview');
            const { up, port } = parseDevServerHealthCheck(combined);
            if (up) {
              const scriptPort = devScriptPort(importedFiles['package.json'] ?? null);
              let bootPort = port ?? scriptPort ?? oneShotDevPort(framework);
              // EARN THE VERDICT (admin 2026-08-03, "Cannot GET /customer/home" shown as a live preview):
              // a bound port is NOT the app serving. Actually VISIT the home route and read the rendered
              // HTML — only claim "✅ up" when it genuinely serves the app; otherwise say WHY (the exact
              // problem analyzePreviewHtml found, e.g. a full-stack app serving its API but 404-ing its
              // client routes). The URL is still exposed either way so the user can retry from the tab.
              const visit = async (candidate: number) => {
                let url = '';
                try { url = applyPreviewDomain(await withTimeout(actuator.getPortUrl(workspaceId, candidate), 10_000, 'import-preview-url')); }
                catch { /* URL resolution is best-effort — the boot itself already succeeded */ }
                if (!url) return { url: '', served: { rendered: true, problems: [] as string[] } };
                try { return { url, served: analyzePreviewHtml((await withTimeout(actuator.browseUrl(workspaceId, url), 30_000, 'import-preview-verify')).html) }; }
                catch { return { url, served: { rendered: false, problems: ['the preview could not be reached to verify it'] } }; }
              };
              let winner = await visit(bootPort);
              // FLIP SYSTEM, now on the IMPORT path too (admin 2026-08-09 — "report me port 3000, lekin
              // mitrify to 5000 par hai"). The flip existed only on the Diagnose route, so this path had
              // ONE guess and no way to correct it — which is why the port was being PINNED instead.
              // With the pin gone the app keeps its own port, and if the first guess does not render we
              // ask the sandbox OS which ports are REALLY listening and visit each candidate until one
              // genuinely serves the app. Every flip target is evidence, every verdict is earned, and
              // the happy path costs nothing extra.
              if (winner.url && !winner.served.rendered) {
                let listening: number[] = [];
                try {
                  listening = parseListeningPorts((await withTimeout(actuator.runCommand(workspaceId, LISTENING_PORTS_COMMAND), 10_000, 'import-preview-port-scan')).stdout);
                } catch { /* best-effort — without the scan the flip simply has no extra candidates */ }
                for (const cand of rankPortCandidates({ parsed: port, scriptPort, expected: bootPort, listening, framework })) {
                  if (cand === bootPort) continue;
                  const attempt = await visit(cand);
                  if (attempt.url && attempt.served.rendered) { winner = attempt; bootPort = cand; break; }
                }
              }
              const bootUrl = winner.url;
              const served = winner.served;
              if (bootUrl) emitLive({ type: 'preview', url: bootUrl, ts: Date.now() });
              // BOOT LOG DIAGNOSER (admin task 2, 2026-08-05 — Mitrify build d5f0a2bc): the boot log
              // is IN HAND here, and on that build it named the exact cause (`ECONNREFUSED …:5432` at
              // ensureSchema) while the verdict still guessed "it isn't serving the app's pages (only
              // its API)" — wrong even about the API, since route registration had died with the same
              // rejection. The verdict now says what the log PROVES and only guesses when it proves
              // nothing. And when the code shows the repairable zombie shape (task 3), the verdict
              // carries the one-line permission ask — the user's reply is the permission.
              const bootCause = served.rendered ? null : halfBootCause(combined);
              const zombie = served.rendered ? null : analyzeDbCoupledBoot(importedFiles);
              const verdict = previewServeNarration({
                rendered: served.rendered, problems: served.problems, port: bootPort, needsDb,
                bootCause,
                fixOffer: zombie ? dbCoupledBootFixOffer() : null,
              });
              emitLive({ type: 'narration', agent: 'architect', text: verdict.text, ts: Date.now() });
              // The verdict is the fact the next autopsy needs — a served=false here IS the
              // "Cannot GET /customer/home" class, named with its exact problem.
              opts.diag?.record({
                phase: 'preview', severity: verdict.ok ? 'info' : 'warning', code: verdict.ok ? 'IMPORT_PREVIEW_SERVING' : 'IMPORT_PREVIEW_NOT_SERVING',
                message: verdict.text.slice(0, 400), autoResolved: verdict.ok,
              });
              // RECORD IT HERE TOO (2026-08-05, from report 15985d3b). The integrity-block copy of this
              // check runs on `integrityFiles`, which on an IMPORT turn is just the `.env` we wrote —
              // that build's own POST_ANSWER_TIMING says "1 files" — so the report carried no
              // DB_COUPLED_BOOT for an imported app, which is precisely the case the check exists for.
              // `importedFiles` is the real project map, and it is right here.
              if (zombie) {
                opts.diag?.record({
                  phase: 'preview', severity: 'warning', code: 'DB_COUPLED_BOOT',
                  // An OBSERVATION, not our defect: this block only runs for an IMPORTED repo, so the
                  // coupled boot is the user's own pre-existing code. Counting it among "problems v5.0
                  // still owes" would make our own tally lie about what we did.
                  ...importTurnObservation(true, `${zombie.message} ${dbCoupledBootFixOffer()}`),
                  detail: dbCoupledBootFixInstruction(zombie),
                });
              }
            } else {
              // HONEST DB-AWARE FAILURE (admin 2026-07-24): a full-stack app that crashed on boot almost
              // always needs a real DB and/or external secrets — say so with the exact fix, instead of a
              // generic "did not boot". Falls back to the generic line for an app that needs neither.
              const dbNote = previewBootFailureAdvisory({
                needsDb,
                provider: detectDatabaseProvider(importedFiles),
                externalVars: externalSecretVars(declaredEnvVars),
                dbProvisioned: 'DATABASE_URL' in provided,
              });
              emitLive({ type: 'narration', agent: 'architect', text: dbNote
                || '⚠️ The live preview did not boot automatically — the In-browser preview works from your imported files, and the Preview tab\'s Diagnose button shows the exact boot log.', ts: Date.now() });
              opts.diag?.record({
                phase: 'preview', severity: 'warning', code: 'IMPORT_PREVIEW_BOOT_FAILED',
                message: (dbNote || 'Dev server did not come up within the boot window.').slice(0, 400), autoResolved: false,
              });
            }
          } catch {
            const dbNote = previewBootFailureAdvisory({
              needsDb,
              provider: detectDatabaseProvider(importedFiles),
              externalVars: externalSecretVars(declaredEnvVars),
              dbProvisioned: false,
            });
            emitLive({ type: 'narration', agent: 'architect', text: dbNote
              || '⚠️ The live preview setup ran out of time — use the In-browser preview, or press Diagnose in the Preview tab to boot it with a visible log.', ts: Date.now() });
            // The exception/timeout path must leave the same trail as a clean failure — this branch
            // going silent is exactly how today's report ended up with zero preview entries.
            opts.diag?.record({
              phase: 'preview', severity: 'warning', code: 'IMPORT_PREVIEW_BOOT_FAILED',
              message: (dbNote || 'Preview boot timed out or threw before a verdict could be read.').slice(0, 400), autoResolved: false,
            });
          }
        })();
      }
      return true;
    };
    if (zipImports.length > 0) {
      try {
        emit({ type: 'narration', agent: 'architect', text: `📦 Unpacking ${zipImports[0].name || 'your zip'} into the workspace…`, ts: Date.now() });
        const extracted = await extractZipProject(Buffer.from(zipImports[0].base64, 'base64'));
        recordImportAccounting(extracted);
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
          sandboxAssets: extracted.sandboxAssets,
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
    // Durable history rows read near the START, summarized at the END — see the note at the read.
    let sessionHistoryForSummary:
      | { history: Awaited<ReturnType<typeof listDiagnosticsHistory>>; startedAt: number }
      | null = null;
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
    // RC-2 (admin 2026-07-06): a LARGE existing project earns `deep` wall-clock headroom just like a
    // complex fresh build. An edit prompt ("retry", "fix the navbar") is SHORT, so prompt-magnitude
    // alone undersizes the budget — but restoring the project + installing deps + working across a big
    // codebase genuinely needs the time (the "paused at the time limit" the admin hit on a ~1650-file
    // import). Size comes from the DURABLE store (sandbox-independent, cheap metadata-only read) so it is
    // correct even here, BEFORE the sandbox is ensured/hydrated below. The paths are reused for the RC-1
    // edit-file-tree reconcile further down — one durable read, no duplication.
    let durableFilePaths: string[] = [];
    try { durableFilePaths = await listWorkspaceFilePaths(workspaceId); } catch { durableFilePaths = []; }
    // FAIL-SAFE INTENT RE-CHECK (Fix 27 — report 2026-07-07: "isne pura app wapas banaya"): the intent
    // probe above (countWorkspaceFiles) FAILS OPEN — a transient Firestore timeout/error returns 0, so
    // "add a share button" on a 46-file imported app classified as a FRESH build and the complete-app
    // manifest lane REBUILT all 40 files over the user's app. The durable path list here is a second,
    // independent read of the same truth; if it shows real source files, a new_build turn (without an
    // explicit fresh-start / complete-app request) is an EDIT — the destructive rebuild path must never
    // be reachable through an infra hiccup. This read is fetched unconditionally (cheap metadata-only
    // doc) and reused below exactly as before.
    if (rebuildGuardFlipsToEdit({
      intent,
      isEditMode,
      durableSourceCount: countEditableSourceFiles(durableFilePaths),
      freshStart: wantsFreshStart(prompt),
      explicitCompleteBuild,
    })) {
      intent = 'edit_existing';
      isEditMode = true;
    }
    // REBUILD CONFIRMATION GATE (Fix 28): a turn that is STILL rebuild-shaped over a non-empty
    // workspace (explicit fresh-start / complete-app ask — or a wrong call the guard couldn't
    // catch) is about to REPLACE the user's existing app. Never silently: pause and ask. Approve
    // = rebuild from scratch; Deny or the timeout = keep the app and run this request as an EDIT.
    if (shouldConfirmRebuild({
      intent,
      isEditMode,
      hasImportIntent,
      durableSourceCount: countEditableSourceFiles(durableFilePaths),
    })) {
      const srcCount = countEditableSourceFiles(durableFilePaths);
      const confirmId = randomUUID();
      emit({
        type: 'narration', agent: 'architect', ts: Date.now(),
        text: `⚠️ This workspace already contains your app (${srcCount} source files). Rebuilding from scratch will REPLACE it.`,
      });
      emit({
        type: 'permission_request',
        agent: 'architect',
        action: `Rebuild from scratch? Approve = replace the existing ${srcCount}-file app with a brand-new build. Deny = keep your app and apply this request as a targeted EDIT instead. (You can also Stop and type something else.)`,
        callId: confirmId,
        ts: Date.now(),
      });
      const rebuildApproved = await awaitApproval(confirmId);
      if (!rebuildApproved) {
        intent = 'edit_existing';
        isEditMode = true;
        emit({
          type: 'narration', agent: 'architect', ts: Date.now(),
          text: '✅ Keeping your existing app — applying your request as a targeted edit.',
        });
      } else {
        emit({
          type: 'narration', agent: 'architect', ts: Date.now(),
          text: '🔄 Rebuild confirmed — building a fresh app from scratch.',
        });
        // GENERATION RESET (Fix 36c): the user explicitly approved replacing the old app — its
        // durable file index must not survive, or the File Guardian later resurrects the previous
        // generation INTO the fresh build (old+new type systems mixed = hours of thrash). The old
        // code stays recoverable via git/GitHub history; only the auto-restore pointer is cleared.
        await resetWorkspaceFilesForApprovedRebuild(workspaceId, 'user-approved-rebuild').catch(() => {});
        durableFilePaths = [];
      }
    }
    const largeEditProject = isEditMode && isLargeExistingProject(durableFilePaths.length);
    const buildComplexity = complexityFromPrompt(prompt);
    const buildDepth: PipelineDepth = resolvePipelineDepth(
      (buildComplexity.moduleCount || 0) + (buildComplexity.featureCount || 0),
      onlyOpus,
      largeEditProject,
    );
    const effectiveBuildSeconds = scaleBuildSeconds(maxBuildSeconds(), buildDepth);
    const deadlineMs = effectiveBuildSeconds * 1000;
    // P-ARCH+.3 — tokens spent by the optional up-front blueprint step (below). Declared here so the
    // final billing hook can fold them into the user's charge with the same markup as every other
    // v5.0 call (NavBharatAI-Anthropic-billed). Stays {0,0} unless the blueprint step actually runs.
    const blueprintUsage = { inputTokens: 0, outputTokens: 0 };
    // BILLING ACCOUNTING (2026-07-10) — ONE build-level token sink. Every token-spending unit of this
    // build feeds it: the fast lane, the main agentic runner, EVERY sub-agent, and every
    // escalation/heal/fix/retry runner. The final charge is computed from this sink's TOTAL (below),
    // so tokens spent inside sub-agents (previously dropped) and inside heal/fix runs whose `result`
    // replaced the main build's (previously discarded) are now billed. Root-cause fix for the
    // ₹14k-real-vs-₹1,524-billed leak: bill the whole build, not one runner's turns.
    const buildUsage = createUsageSink();
    // Fix 67 — the per-provider ledger + build ref live in the INNER build scope (created once the build
    // starts), but finalizeOnDeadline (the wall-clock/advisory finalizer) lives out here. This holder is
    // populated by the inner scope so the finalizer can bill via the SAME real-cost path (Fix 65) and
    // debit with the SAME idempotent buildRef the normal settle uses. Empty until the build starts → the
    // finalizer safely skips billing if the cap somehow fires before then.
    const billingCtx: { providerLedger?: BillingLedgerView; buildStartedAt?: number; cacheReadInputTokens?: number } = {};
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
      // NOT a clean success if the reviewer found [CRITICAL]s the auto-fix never verifiably resolved
      // (this is exactly the case the advisory cap fires on — it fired mid-"🔧 fixing them now…"). An
      // unresolved-critical build finalizes as the resumable NOT-ok path below: billedUsd:0 (no charge
      // for a broken app) + auto-continue so the next window actually fixes the criticals.
      const ok = !!buildResultRef && buildResultRef.ok === true && reviewCriticalsUnresolved.length === 0;
      // Fix 67 — a build finalized by the wall-clock / advisory cap must bill via the SAME real-cost
      // path as the normal settle (Fix 65), NOT the old flat formula, and must record its per-provider
      // tokens + billing INTO the report (set BEFORE report() below). Root cause: this path used
      // billedAmountUsd(...) and skipped setProviderTokens/setBilling, so a build that overran its cap
      // showed the wrong legacy ₹ (e.g. ₹250 instead of the real-cost ₹157) and its report was
      // billing-null. Only a SUCCESSFUL app is billed; an overran-but-failed build stays free.
      let watchdogBilledUsd = 0;
      if (ok && billingCtx.providerLedger) {
        try {
          const decided = decideBuildBilledUsd(billingCtx.providerLedger, buildUsage.total(), powerLevelReqEffective, userId ?? undefined, email, billableSandboxUsd(actuator, workspaceId));
          watchdogBilledUsd = decided.effectiveBilledUsd;
          buildDiagRef?.setProviderTokens(decided.reconciledProviderUsage);
          buildDiagRef?.setCacheReadInputTokens(billingCtx.cacheReadInputTokens ?? 0);
          buildDiagRef?.setBilling({
            userTier: isAgentV3FreeUser(userId, email)
              ? 'free-list (admin/tester)'
              : freeTierBuildActive
                ? 'free (welcome bonus — cheap engines)'
                : (isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) && !isAgentV3FreeUser(userId, email)
                  ? 'paid'
                  : 'billing-off (no charge)',
            billedUsd: Math.round(watchdogBilledUsd * 1_000_000) / 1_000_000,
            billedInr: Math.round(watchdogBilledUsd * usdInrRate() * 100) / 100,
            powerMode: onlyOpus,
            powerLevel: powerLevelReqEffective,
            noClaude: noClaudeBuild,
          });
        } catch { /* billing enrichment is best-effort — never blocks finalization */ }
      }
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
        // Fix 67 — DEBIT the wallet for a cap-finalized successful build, idempotent by the SAME
        // buildRef the normal settle uses (`${workspaceId}_${buildStartedAt}`), so a race between this
        // finalizer and a normal settle can never double-charge. Gated exactly like the normal path
        // (paid-public/credit-gate AND non-free-user AND amount > 0). Without this a build that overran
        // its cap was silently FREE (a revenue leak) while still SHOWING a charge — now the shown ₹, the
        // report, and the actual debit all agree on the Fix 65 real-cost amount.
        let watchdogWalletDebit: { tokensDebited: number; tokenBalance: number } | null = null;
        if (userId && watchdogBilledUsd > 0) {
          userCostStore.record(userId, watchdogBilledUsd).catch(() => {});
          // Only debit with the EXACT buildRef the normal settle uses; without it a ref mismatch could
          // let a race double-charge, so skip the debit rather than risk it (the build stays free — safe).
          const billingActiveNow = (isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) && !isAgentV3FreeUser(userId, email);
          if (billingActiveNow && billingCtx.buildStartedAt !== undefined) {
            try {
              const debitRes = await debitWalletForBuild(getDb() as any, userId, {
                billedInr: watchdogBilledUsd * usdInrRate(),
                buildRef: `${workspaceId}_${billingCtx.buildStartedAt}`,
                description: 'NavBharatAI Pro v5.0 build (time-capped)',
              });
              if (debitRes.ok) watchdogWalletDebit = { tokensDebited: debitRes.tokensDebited, tokenBalance: debitRes.tokenBalance };
            } catch { /* debit failure never blocks finalization (logged nowhere-critical) */ }
          }
        }
        const billedInr = Math.round(watchdogBilledUsd * usdInrRate() * 100) / 100;
        const watchdogCostBreakdown = watchdogBilledUsd > 0
          ? userCostBreakdown(buildUsage.total(), watchdogBilledUsd, powerLevelReqEffective, usdInrRate())
          : null;
        emit({ type: 'result', ok: true, summary: buildResultRef.summary || 'Built your app — your files are saved.', steps: buildResultRef.steps ?? 0, billedUsd: watchdogBilledUsd, billedInr, ...(watchdogWalletDebit && watchdogWalletDebit.tokensDebited > 0 ? { walletTokensDebited: watchdogWalletDebit.tokensDebited, walletTokenBalance: watchdogWalletDebit.tokenBalance } : {}), ...(watchdogCostBreakdown ? { costBreakdown: watchdogCostBreakdown } : {}), ...(dl ? { diagnostics: dl } : {}) });
        void notifyBuildComplete(userId, true);
      } else {
        // SEAMLESS WINDOW TRANSITION (admin "sabkuch automatically hona chahiye, user ko pata bhi na
        // lage", 2026-07-20): a wall-clock pause that will be AUTO-CONTINUED must be INVISIBLE — no
        // "time limit reached" chat bubble. We deliberately do NOT emit a pause narration here. The
        // client's decideAutoContinue speaks only when it genuinely STOPS (budget/backstop/no-progress),
        // showing an honest message THEN; while it keeps auto-continuing it stays silent, so a multi-
        // window build reads as one continuous build. The `summary` is kept on the result for the record
        // (never rendered as a bubble on the resumable path). RC-4's honest-wording lives in the client
        // stopMessage now, so nothing here can claim "almost done".
        const pauseMsg = deadlinePauseMessage(writtenFiles.size);
        // P-Layer3 — mark this result RESUMABLE so the client can auto-continue (bounded) without the
        // user having to type "continue". A normal failure has no `resumable` flag, so it won't auto-retry.
        // `filesWritten` is the PROGRESS signal (FleetOps): the client keeps auto-continuing a wall-clock
        // pause while this strictly increases across windows, so a big full-stack app finishes unattended.
        emit({ type: 'result', ok: false, resumable: true, summary: pauseMsg.summary, steps: 0, billedUsd: 0, billedInr: 0, filesWritten: writtenFiles.size, ...(dl ? { diagnostics: dl } : {}) });
      }
      // A deadline-finalized build's `finally` may never run (the body is stuck on an un-abortable
      // await) — persist the evidence layer HERE too, after the terminal emit so the recorder has
      // captured the result facts. The delta cursor makes a later finally call a no-op.
      await persistSessionTimeline();
      try { clearGreenLatch(workspaceId); } catch { /* best-effort */ }
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
    // FALSE-SUCCESS GUARD (deep-test 2026-07-21): `buildResultRef` above captures the architect's
    // OPTIMISTIC success BEFORE the post-build reviewer validates it. When the reviewer then finds
    // [CRITICAL] issues that are NOT verifiably fixed (the C9 auto-fix never ran, failed, or — the real
    // case — got cut off mid-repair by the advisory cap), nothing here downgraded the verdict, so BOTH
    // exit paths (the deadline finalizer above and the normal settle below) shipped `ok:true` + the
    // stale "console clean" summary AND billed for a broken app. This holder is set the moment the
    // reviewer reports unfixed criticals and cleared only when the auto-fix pass verifiably completes;
    // both exits consult it so an unresolved-critical build is honestly NOT-ok (→ free via the existing
    // "working app or free" guard, and resumable on the finalizer path so the next window fixes them).
    let reviewCriticalsUnresolved: string[] = [];
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
    // The ORIGINAL up-front estimate, kept alongside etaTotalMs (which liveEtaTick EXTENDS on overrun)
    // so each re-baseline step stays proportional to the app's real size, not to the growing budget.
    let etaBaseMs = 0;
    // How many times the budget has been re-baselined. Threaded through liveEtaTick so a build that
    // has already broken its estimate stops making fresh countdown promises.
    let etaRevisions = 0;

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
          // RE-BASELINING tick (autopsy 2026-08-02): liveEtaTick returns the line AND an extended budget
          // when the build overruns, so an over-estimate build keeps showing a fresh, honest number
          // instead of freezing on one "wrapping up (a little longer than estimated)" line for 20+ min.
          const tick = liveEtaTick(elapsedMs, etaTotalMs, etaBaseMs || etaTotalMs, etaRevisions);
          etaTotalMs = tick.totalMs;
          // Carry the revision count forward: it is what stops the countdown resuming its "~1 min to
          // go" promise after the estimate has already been broken (mitrify autopsy 2026-08-04).
          etaRevisions = tick.revisions;
          const text = tick.text;
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
      // Gemini Flash instead of Pro. Active within v5.0 (itself flag-gated); set
      // AGENTV3_COST_LADDER=off to fall back to the fixed model. Billing is
      // unchanged (Opus-equivalent markup) — this only trims real provider cost.
      // No provider name is surfaced to the user (kept to server telemetry only).
      const costLadderOn = process.env.AGENTV3_COST_LADDER !== 'off';
      const analysis = costLadderOn
        ? analyzeRequest({ prompt, powerMode: onlyOpus, pinnedModel: powerSpecResolved.pinnedModel })
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
        let sandboxPaths: string[] | null = null;
        try { sandboxPaths = await actuator.listFiles(workspaceId); } catch { sandboxPaths = null; }
        // RC-1 ROOT FIX (admin 2026-07-06): the sandbox is EPHEMERAL. On a recycled/cold sandbox
        // listFiles returns a near-empty set — the FileGuardian restore runs LATER in this handler —
        // so the true project size was under-seen: a large existing project MISROUTED to the weak
        // model AND the edit prompt saw a fraction of the files (the exact "25 vs 1654 files on the
        // SAME repo across two turns" the admin hit). The durable WorkspaceFileStore is the source of
        // truth for what the project contains, independent of sandbox coldness — reconcile against it so
        // detection + the edit prompt see every file. (durableFilePaths was fetched once up-front for the
        // RC-2 depth decision; reuse it here — one durable read, no duplication.)
        const reconciled = reconcileProjectFileTree(sandboxPaths, durableFilePaths);
        editFileTree = reconciled.length > 0 ? reconciled : sandboxPaths;
      }
      const largeProject = isLargeExistingProject(editFileTree?.length ?? 0);
      // Fix 4 (2026-07-06): an IMPORT turn ALSO routes to the strong model directly. A GitHub-URL
      // import clones its files AFTER this point (so editFileTree is empty here and the large-project
      // check can't see them — the Mitrify import wrongly ran on Haiku + the cheap floor, which then
      // timed out 6× on the huge grounding prompt). Any import operates on a real existing app with a
      // large prompt, so treat it like a large edit: strong model, no cheap floor.
      const routeStrong = shouldRouteStrongModel(largeProject, hasImportIntent);
      // Admin routing policy: small app → Haiku, complex app → Sonnet, large project / import → Sonnet.
      // PAID PINNED tiers (admin 2026-07-13): Strong → Sonnet 100%, Powerful/Full Team → Opus — the
      // LEVEL is passed (not a boolean) so the pinned model is exact. Gemini/Vertex remain the
      // error-only fallback in buildTurnRunner.
      const model = selectBuildModel(analysis?.startTier, powerLevelReqEffective, routeStrong);
      if (routeStrong && !onlyOpus) {
        // Honest + visible: the user sees WHY this build routes to the strong model.
        events.emit({
          type: 'narration', agent: 'architect', ts: Date.now(),
          text: largeProject
            ? `🏗️ Large project (${editFileTree?.length ?? 0} files) — running directly on the strong model for reliability.`
            : `📦 Imported project — running directly on the strong model for reliability.`,
        });
      }
      // BUILD DIAGNOSTICS — capture every struggle (provider fallback, tool error, "replied
      // without building" nudge, readiness blocker, sandbox issue) into a downloadable report,
      // so the admin can hand it to Claude and the rough edges get fixed in code.
      // AUTOPSY 2026-07-06 ("na hi build report me kuch aya"): the report used to live ONLY in the
      // in-memory `lastDiagnostics` map during a build and was persisted DURABLY solely at the terminal
      // paths (finalize / completion / crash-catch). A Cloud Run instance rotation or hard-kill mid-build
      // dies BEFORE any of those and does NOT run a JS catch → the durable report was never written →
      // the admin saw an EMPTY build report (and the comment below claimed durability the code never
      // delivered). Fix: persist the report DURABLY inside onUpdate too, THROTTLED to at most once per
      // DIAG_FLUSH_MS so Firestore writes stay bounded. First update flushes immediately (report is
      // durable from the very first recorded issue); the terminal save still writes the complete report.
      const DIAG_FLUSH_MS = 10_000;
      let _lastDiagFlushAt = 0;
      // P0 (2026-07-12) — every build mints a UNIQUE build id + a stable prompt hash. Both are stamped into
      // the diagnostics report AND echoed to the client (early `build_meta` event + the final `result`), so
      // the "Build report" export can be validated to belong to THIS build and can NEVER hand back a
      // previous, different app's report (the Jungle-Runner-for-Expense-Tracker bug).
      const buildId = randomUUID();
      const promptHash = computePromptHash(prompt);
      emit({ type: 'build_meta', buildId, promptHash, workspaceId });
      const buildDiag = new BuildDiagnostics({
        buildId, promptHash,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
        workspaceId, prompt, model, framework,
        // REAL-TIME: persist the report after every recorded issue, so "Build report" is never empty
        // mid-build and genuinely survives a crash/hang/rotation (the user can download it any time).
        onUpdate: (r) => {
          lastDiagnostics.set(buildKey, r);
          const now = Date.now();
          if (flushDecision(_lastDiagFlushAt, now, DIAG_FLUSH_MS) === 'flush-now') {
            _lastDiagFlushAt = now;
            saveDiagnostics(workspaceId, r).catch(() => {}); // durable — survives an instance rotation mid-build
            // Also upsert THIS turn into the session history AS IT RUNS (CrewHub 2026-07-20): a turn that
            // gets interrupted before settle (Load failed / sandbox recycle / disconnect) would otherwise
            // be missing from the whole-session download. Keyed by startedAt, so the settle later overwrites
            // it with the final version — every turn of a multi-turn build is captured. Best-effort.
            upsertDiagnosticsHistoryProgress(workspaceId, r).catch(() => {});
          }
        },
      });
      buildDiagRef = buildDiag; // expose to the outer catch so a build crash is captured too
      // A clean sheet, so "healed twice" means twice in THIS build — see HealLedger.
      resetHealLedger(workspaceId);

      // SELF-SOURCE GUARD (contamination autopsy 2026-07-31): a real workspace's durable store held
      // NavBharatAI's OWN 2576-file platform source, so "make this app" spent 31 minutes trying to boot our
      // server (ok:null) instead of building anything. Building the platform itself as a user app is never
      // valid — refuse HONESTLY up front instead of grinding to the wall-clock wall, and record it so the
      // storage/isolation contamination can be investigated. False-positive-proof (needs ≥2 internal paths).
      if (looksLikePlatformSource(durableFilePaths)) {
        buildDiag.record({
          phase: 'build', severity: 'error', code: 'PLATFORM_SOURCE_WORKSPACE',
          message: 'Refused: the workspace contains NavBharatAI\'s own platform source (not a user app).',
          detail: `${durableFilePaths.length} durable file(s); ≥2 internal platform-signature paths present.`,
          autoResolved: false,
        });
        emit({ type: 'narration', agent: 'architect', ts: Date.now(), text: `⚠️ ${PLATFORM_SOURCE_REFUSAL}` });
        buildDiag.finish(false, PLATFORM_SOURCE_REFUSAL);
        events.emit({ type: 'done', ok: false, summary: PLATFORM_SOURCE_REFUSAL, ts: Date.now() });
        emit({ type: 'result', ok: false, summary: PLATFORM_SOURCE_REFUSAL, steps: 0, billedUsd: 0, billedInr: 0 });
        return;
      }

      // Requirement-gap analysis (T1.4 → engine slice): auto-run the existing analyzer at build start and
      // record the detected domain, the features that domain usually needs but the prompt left implicit, and
      // the clarifying questions into the ADMIN-ONLY build report — so every autopsy shows what the request
      // left ambiguous (rule 5). Pure + best-effort; changes NO build flow and touches NO user-facing surface.
      // (The interactive "pause and ask the user" gate is a separate, admin-gated follow-up.) Only records
      // when a real domain is detected AND something is genuinely missing/askable, to keep the report high-signal.
      try {
        const reqGaps = analyzeRequirementGaps(prompt);
        if (shouldSurfaceRequirementGaps(reqGaps)) {
          buildDiag.record({
            phase: 'build',
            severity: 'info',
            code: 'REQUIREMENT_GAPS',
            message: `Requirement analysis: domain=${reqGaps.domain}, ${reqGaps.likelyMissing.length} likely-missing feature(s), ${reqGaps.clarifyingQuestions.length} clarifying question(s) the engine assumed sensible defaults for.`,
            detail: renderRequirementGaps(reqGaps),
            autoResolved: true,
          });
        }
      } catch {
        /* requirement analysis is best-effort — never let it affect the build */
      }

      // UNBREAKABLE weak-module no-Claude chokepoint (admin absolute rule, 2026-07-13). Bind a no-Claude
      // zone to THIS build's async context now that we know its tier (nothing calls Claude before here).
      // Every awaited descendant — the builder, the plan phase, every heal gate, the judge, any sub-agent
      // — inherits it, and `ClaudeClient.runTurn` REFUSES a Claude call inside it before a token is spent.
      // This backstops `enforceNoClaude` (which only strips Claude from provider CHAINS): a raw
      // ClaudeClient created outside any chain (a judge/plan fallback, or a gate that forgot to thread the
      // flag — the exact App #3 Pomodoro leak) is now caught at the invocation point, not at N fragile
      // call sites. `onBlocked` records an honest, loud diagnostic naming the model that was refused.
      enterNoClaudeZone({
        active: noClaudeBuild,
        onBlocked: (model) => {
          try {
            buildDiag.record({
              phase: 'provider',
              severity: 'warning',
              code: 'NO_CLAUDE_BLOCKED',
              message: `Weak-module guard refused a Sonnet/Opus-class Claude call (${model ?? 'claude'}) — on a weak/free build only the Haiku last resort is authorized (admin amendment 2026-07-13). The call was blocked (no tokens spent); routing stays on the cheap floor (GLM/Kimi) → Vertex/Gemini → Haiku.`,
              autoResolved: true,
            });
          } catch {
            /* diagnostics is best-effort — never let it break the guard */
          }
        },
      });
      events.subscribe((e) => buildDiag.ingestEvent(e), false);
      // Fix 37a (admin: "app kitni baar fail hui yeh bhi likho"): stamp how many earlier builds in
      // THIS workspace's durable history ended not-ok, so a repeat failure is visible in every
      // report instead of each report looking like a first attempt. Best-effort, non-blocking.
      void listDiagnosticsHistory(workspaceId, 50)
        .then((h) => {
          buildDiag.setPriorFailedBuilds(h.filter((e) => e.ok === false).length);
          // THE SESSION, not just this turn (admin 2026-08-06). Two complaints, one root cause: a
          // 58-minute session reported as 18 minutes, and three workspace wipes no report mentioned —
          // both because startedAt/endedAt and the data-loss events are PER TURN. Built from the SAME
          // read that already fed priorFailedBuilds, so it costs no extra query.
          // The session summary is DEFERRED to the end of the build (autopsy 2026-08-09). It used to be
          // computed right here — inside the history read that fires near the START — so `Date.now()` was
          // milliseconds after `buildStartedAt` and every report said the session had lasted ~100 ms. A
          // 5m45s build reported `elapsedMs: 157`; a 2.5-minute one reported 92. The irony is that this
          // field exists precisely to stop session length being under-reported ("a 58-minute session
          // reported as 18 minutes"), and on the first turn it was under-reporting maximally.
          //
          // The history `h` is what the read was for and it is correct — only the clock was wrong — so we
          // keep the rows and re-summarize at the end against the real end time.
          sessionHistoryForSummary = { history: h, startedAt: buildStartedAt };
        })
        .catch(() => { /* history read is best-effort */ });
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
      // Billing Phase 3 — per-provider TOKEN attribution (admin usage-report + optional per-tier
      // billing). Fed by MultiProviderTurnRunner.onTurnComplete for the architect + its sub-agents
      // (they share this client) + the escalation runner. Observational: it never changes billing
      // with the per-tier flag off. Aux calls (blueprint/plan/judge) reconcile into 'other' at settle.
      const providerLedger = createProviderUsageLedger();
      /**
       * SHADOW ledger — fast-lane turns, recorded for OBSERVATION and never for billing.
       *
       * The admin chose to measure before changing fast-lane attribution (2026-08-11), and measurement
       * was impossible: four of the seven fast-lane call sites record their tokens in NEITHER the
       * provider ledger nor the build total, so they are invisible. Three others land in the
       * unattributed remainder and are priced at Sonnet despite running on the cheap floor.
       *
       * This ledger is deliberately separate from providerLedger. Adding these turns to the real one
       * would CHANGE THE BILL — which is the decision being measured, so it cannot be a side effect of
       * measuring it.
       */
      const shadowFastLaneLedger = createProviderUsageLedger();
      const captureShadowUsage = (used: string, usage: { inputTokens: number; outputTokens: number }, model?: string): void => {
        shadowFastLaneLedger.add(used, usage, model);
      };
      billingCtx.providerLedger = providerLedger; // Fix 67 — expose to the wall-clock/advisory finalizer
      const captureTurnUsage = (used: string, usage: { inputTokens: number; outputTokens: number }, model?: string, cacheReadInputTokens?: number): void => {
        // Fix 66 — the cache-hit share rides the ledger entry so the REAL-cost settle prices it at the
        // provider's cheaper cache-read rate (usageCostUsd). Margin-safe: providers without a cache
        // line in the rate card price it at the full input rate (identical to before).
        const cacheRead = Number.isFinite(cacheReadInputTokens) && (cacheReadInputTokens ?? 0) > 0 ? (cacheReadInputTokens ?? 0) : 0;
        providerLedger.add(used, cacheRead > 0 ? { ...usage, cacheReadInputTokens: cacheRead } : usage, model);
        // …and accumulate the build total for the diagnostics report's cache-hit rate line.
        if (cacheRead > 0) {
          billingCtx.cacheReadInputTokens = (billingCtx.cacheReadInputTokens ?? 0) + cacheRead;
        }
      };
      // The cheap floor (GLM/Kimi) leads a build's FIRST attempt for simple/medium apps for allowlisted
      // users — OR is forced ON+cheap-ONLY for a not-yet-paying free-tier user. Computed ONCE here and
      // reused by BOTH the agentic architect chain AND the fast lane (Simple Builder / OneShot), so the
      // fast lane is governed by the SAME policy as everything else — no divergent "direct Sonnet" path.
      const cheapTierAllowed = cheapFloorAllowedForTier(analysis?.startTier, workspaceId);
      const cheapUserAllowed = cheapFloorAllowedForUser(userId, email);
      // PAID PINNED tiers (admin fidelity rule 2026-07-13): the floor must NEVER lead a mini/medium/max
      // build — the user selected an exact model (Sonnet or Opus) and that model leads 100%. Before this
      // guard, escalation-on made cheapFloorAllowedForTier() return true for EVERY tier, so GLM/Kimi
      // could lead even a paid Opus build — the exact substitution the admin forbade.
      const allowCheapFloor = freeTierBuildActive || (!onlyOpus && !routeStrong && cheapTierAllowed && cheapUserAllowed);
      // HONEST ROUTING RECORD (autopsy fae70e42): state in the build report EXACTLY why the cheap
      // GLM/Kimi floor did or did not lead — so "1st call claude kyun?" is answered by the report
      // itself, never a guess. Best-effort; never affects the build.
      try {
        const floorDecision = cheapFloorDecision(process.env, {
          allowCheapFloor, routeStrong, freeTierBuildActive,
          tierAllowed: cheapTierAllowed, userAllowed: cheapUserAllowed,
        });
        buildDiag.record({
          phase: 'provider', severity: floorDecision.active ? 'info' : 'warning',
          code: 'CHEAP_FLOOR_DECISION', message: floorDecision.reason, autoResolved: floorDecision.active,
        });
      } catch { /* diagnostics are best-effort — never blocks a build */ }
      const recordProviderFallback = (name: string, err: unknown): void => {
        // Structured per-provider failure TALLY (admin 2026-07-11: "kaun se providers fail hue,
        // kitni baar") + the existing per-event timeline entry (carries the message).
        try { buildDiag.recordProviderFailure(name, err); } catch { /* diagnostics are best-effort */ }
        buildDiag.record({
          phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK',
          message: `Provider ${name} failed — falling back to the next provider`,
          autoResolved: true, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        });
      };
      // Unified TEXT-generation runner for the FAST lane + up-front aux steps (blueprint / project
      // planner / tsc-gate repair). Leads with the cheap floor exactly like the agentic chain and
      // ALWAYS keeps Claude as the backstop inside the chain — so GLM/Kimi build cleanly when configured,
      // and a floor outage/timeout falls straight back to Sonnet (the app never breaks). With
      // AGENTV3_CHEAP_FLOOR off/unset this is byte-for-byte today's Claude-only behaviour. `onUsed` gives
      // the caller the ACTUAL delivering provider so the build report records the truth (rule 5), never a
      // fixed 'anthropic'. Token/billing accounting stays in each caller's existing sink (no onTurnComplete
      // here — avoids double-counting the fast lane's own buildUsage.add).
      const makeFastTextRunner = (onUsed?: (used: string) => void): TurnRunner => buildTurnRunner({
        ...(analysis ? { geminiModel: tierToGeminiBuildModel(analysis.startTier) } : {}),
        allowCheapFloor,
        cheapOnly: freeTierBuildActive,
        free: freeTierBuildActive,
        noClaude: noClaudeBuild, // weak module → Claude can never be in the chain (absolute rule)
        onProviderUsed: (used) => { try { onUsed?.(used); } catch { /* caller callback best-effort */ } captureProvider(used); },
        // OBSERVATION ONLY — captureShadowUsage feeds the shadow ledger, never the billing one. This is
        // what makes the fast-lane billing question answerable without answering it by accident.
        onTurnComplete: captureShadowUsage,
        onProviderError: recordProviderFallback,
      });
      const client = buildTurnRunner({
        ...(analysis ? { geminiModel: tierToGeminiBuildModel(analysis.startTier) } : {}),
        // First attempt only opts the cheap floor in — and only for simple/medium apps (complex →
        // straight to the strong model) AND only for allowlisted users (canary; empty list = all).
        // NEVER for a large existing project (admin 2026-07-05): the floor timed out 8× on a 233KB
        // Mitrify-scale prompt and every turn fell to Claude anyway — pure wasted minutes.
        // Escalation builds below never pass this, so they stay Claude.
        // FREE-TIER: force the cheap floor ON and cheap-ONLY (no Claude) for a not-yet-paying user.
        allowCheapFloor,
        cheapOnly: freeTierBuildActive,
        free: freeTierBuildActive,
        noClaude: noClaudeBuild, // weak module → Claude can never be in the chain (absolute rule)
        onProviderUsed: captureProvider,
        onTurnComplete: captureTurnUsage,
        onProviderError: recordProviderFallback,
      });

      /**
       * EVERY heal/repair runner, built ONE way — so its tokens are always attributed.
       *
       * ROOT CAUSE (real build report, Shiv Medical Store 2026-08-10, ₹566.96 on a FREE build): the 12
       * heal/repair runners were each written as
       *   buildTurnRunner(healRunnerOpts())
       * with no `onTurnComplete`. Their usage therefore reached the build total but was attributed to
       * NO provider, so it landed in the "unattributed remainder" — which realProviderCostUsd prices at
       * SONNET rates as a deliberately conservative upper bound.
       *
       * The result was exactly backwards. healRunnerRoutingOpts routes a free build's heals to the
       * CHEAP coders (~$0.6/M) and the user was billed for them at $3/M — a 5× overcharge on the
       * majority of that build's tokens (507k of 776k). And because heals only fire when a build
       * STRUGGLES, the worse a build went, the more of it was billed at the highest rate in the stack.
       *
       * It is the same shape as the bug `enforceNoClaude` exists to prevent: a guarantee that depended
       * on every heal-gate author remembering to thread one option. Threading `onTurnComplete` through
       * 12 call sites by hand would just re-arm it for the 13th, so the obligation lives here instead —
       * a new heal runner is attributed by construction, and `healRunnerAttributionGuard` in the tests
       * fails the build if anyone reintroduces the raw form.
       *
       * A second benefit beyond the money: attribution is what makes `noClaude: true` PROVABLE. An
       * unattributed token has no provider, so a Claude call hidden in that bucket would be invisible
       * to the honesty detector on exactly the tier where Claude is forbidden.
       */
      const healRunnerOpts = () => ({
        ...healRunnerRoutingOpts(freeTierBuildActive),
        noClaude: noClaudeBuild,
        onProviderUsed: captureProvider,
        onTurnComplete: captureTurnUsage,
      });
      // Build start time — used for cost-ladder telemetry duration (P2 measurement).
      const buildStartedAt = Date.now();
      billingCtx.buildStartedAt = buildStartedAt; // Fix 67 — the finalizer debits with this exact ref
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
          // ETA NOW LEARNS FROM REAL BUILDS (admin 2026-08-11). This call used to pass NO history, so
          // every user saw the cold heuristic at confidence 0.4 on every build, forever — which is the
          // measured "ETA said ~3 min, took 15.6" defect. `estimateBuildTime` could always blend past
          // durations; it was simply never given any on the path that matters. History comes from the
          // build records we ALREADY store durably, so this adds no storage and costs no provider spend.
          // Best-effort by construction: a history read that fails yields [], i.e. exactly today's
          // behaviour, and can never delay or fail a build.
          const etaComplexity = complexityFromPrompt(prompt);
          const past = await recentBuildHistoryFor(
            workspaceId, etaComplexity,
            (id, n) => listDiagnosticsHistory(id, n) as Promise<any>,
          );
          const est = estimateBuildTime(etaComplexity, past);
          etaTotalMs = est.estimateMs; // feed the live heartbeat so it can revise the remaining time
          etaBaseMs = est.estimateMs;  // the ORIGINAL estimate — sizes each overrun re-baseline step
          buildDiag.record({
            phase: 'plan', severity: 'info', code: 'ETA_BASIS',
            message: `ETA ${est.etaText} · basis ${est.basis} · confidence ${est.confidence}`,
            detail: etaBasisNote(past),
            autoResolved: true,
          });
          events.emit({ type: 'narration', agent: 'architect', text: `⏱️ Estimated build time: ${est.etaText} — I'll keep you posted as I go.`, ts: Date.now() });
        } catch { /* ETA is best-effort — never affects the build */ }
      }
      const budget = maxBuildBudgetUsd();
      // AgentRunner treats `undefined` as "no cap" (0 would instead stop the build after its very
      // first dollar, since it checks `billed() >= maxBudgetUsd`) — convert the disabled (0) case here.
      const maxBudgetUsdForRunner = budget > 0 ? budget : undefined;
      // Slice 2 (QuizArena autopsy 2026-07-17) — COMPLEXITY-ADAPTIVE step cap. A 30-file app died at
      // the flat 80-step cap; a flat raise for everyone (the rejected "800") would just give runaway
      // loops more rope. When the analyser judged this prompt COMPLEX (sonnet start-tier), the cap
      // scales to 150 — bounded, and only for builds that genuinely need more room. An explicit
      // AGENTV3_MAX_STEPS env value always wins (it remains the flat override it has always been).
      const maxStepsDefault = analysis?.startTier === 'sonnet' ? 150 : 80;
      const maxSteps = envInt('AGENTV3_MAX_STEPS', maxStepsDefault);
      const subAgentMaxSteps = envInt('AGENTV3_SUBAGENT_MAX_STEPS', 40);
      // How many parallel-safe tools / review sub-agents may run at once in a turn (rate-limit
      // safe default; lower it if Anthropic concurrency limits are hit).
      const toolConcurrency = envInt('AGENTV3_TOOL_CONCURRENCY', 4);

      // Sandbox + git setup is best-effort: a plain chat (e.g. "hello") must still
      // get a reply even when no sandbox is available (no E2B key, or a read-only
      // filesystem). If setup fails we tell the user honestly and keep chatting —
      // the build tools will report the real sandbox error only if the user asks
      // to build. This is what makes v5.0 conversational like Claude Code.
      let git: GitManager | undefined;
      // Deep-test App #7 (2026-07-13): true when the build sandbox could not be set up (E2B down / quota /
      // template). No file can ever be written, so the build MUST end as a failure — not "✓ Done" over an
      // empty preview. Threaded into the empty-build honesty override below.
      let sandboxUnavailable = false;
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
        // WHERE THE SETUP MINUTES ACTUALLY GO (autopsy 2026-08-09). Two reported builds spent 2.5 minutes
        // with "Setting up your workspace…" as their only narration — the heartbeats at minute 1 AND minute
        // 2 both read "last: Setting up your workspace…" — and nothing recorded WHICH part of setup ate it.
        // Sandbox create, the npm install inside ensureWorkspace, and the GitHub hydrate that follows all
        // hid behind one sentence, so the largest slice of a short build was the one slice we could not
        // measure. These stamps cost nothing and turn "setup felt slow" into a number worth acting on.
        const setupT0 = Date.now();
        const resumeSandboxId = sandboxResumeEnabled()
          ? (await sandboxStore.get(workspaceId).catch(() => null)) ?? undefined
          : undefined;
        const resumeLookupMs = Date.now() - setupT0;
        const ensureT0 = Date.now();
        await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId);
        const ensureWorkspaceMs = Date.now() - ensureT0;
        try {
          buildDiag.record({
            phase: 'build', severity: 'info', code: 'SETUP_TIMING', autoResolved: true,
            message: `Workspace ready in ${Math.round((Date.now() - setupT0) / 1000)}s`,
            detail: `resume-id lookup ${resumeLookupMs}ms · sandbox create/connect + scaffold + install `
              + `${ensureWorkspaceMs}ms · resumed=${resumeSandboxId ? 'yes' : 'no (cold)'}`,
          });
        } catch { /* timing is observation only — it must never affect a build */ }
        // PREVIEW SYNC FIX (LearnLoop autopsy): the scaffold's root manifests (package.json, index.html,
        // framework configs) are seeded straight into the sandbox by ensureWorkspace and BYPASS the
        // onFileWrite write-tracking — so they only reached the durable store via a flaky end-of-build
        // scan. When that scan failed, a later cold-sandbox preview re-seeded from durable had no
        // package.json → "No package.json found" despite `npm run dev` exit 0. Persist the seeded scaffold
        // to durable NOW (merge = union, never wipes anything), so package.json is durable from step 0.
        // Best-effort — never blocks a build; a resumed sandbox seeds nothing (returns undefined → no-op).
        try {
          const seededScaffold = actuator.takeSeededScaffold?.(workspaceId);
          if (seededScaffold && Object.keys(seededScaffold).length > 0) {
            await mergeWorkspaceFiles(workspaceId, seededScaffold).catch(() => {});
          }
        } catch { /* scaffold durability is best-effort — the end-of-build scan remains the fallback */ }
        // GIT-NATIVE HYDRATE: when storage is active, ensure the project repo exists and seed the
        // sandbox from it BEFORE the Firestore fallback. Best-effort — any failure here leaves the
        // build on the existing (Firestore) durability path, never blocking it.
        if (githubStorageActive()) {
          const projectId = typeof req.body?.sessionId === 'string' && req.body.sessionId ? req.body.sessionId : workspaceId;
          // READABLE repo name (admin 2026-07-18; simplified 2026-08-10): derive it from the build's OWN
          // stable identity — its stored title + createdAt — so the GitHub repo is human-readable and SIMPLE
          // ("watch-18jul26-1100am-3f9a": single word + date + time) instead of the old opaque
          // "app-<uid>-<sessionId>". Crucially this stays STABLE across turns: the
          // current-turn prompt changes each turn, but the stored title/createdAt do not, so ensureRepo keeps
          // hitting the SAME repo rather than spawning a new one per turn. On the FIRST turn the record may not
          // exist yet — the current prompt IS the first prompt, so deriveTitle(prompt)+now matches the identity
          // the record is about to be created with. Best-effort: any lookup failure falls back cleanly.
          let readableAppName = deriveTitle(prompt);
          let readableCreatedAt = Date.now();
          try {
            const idRec = await getConversationStore().get(workspaceId).catch(() => null);
            if (idRec) {
              if (idRec.title) readableAppName = idRec.title;
              if (typeof idRec.createdAt === 'number' && idRec.createdAt > 0) readableCreatedAt = idRec.createdAt;
            }
          } catch { /* readable-name identity lookup is best-effort — prompt + now is a valid fallback */ }
          // IMPORTED REPO NAME WINS (mitrify autopsy 2026-07-27): on an import turn the prompt/title is an
          // INSTRUCTION ("Import this app … and give me a short survey"), so the mirror repo was named
          // `import-this-app-from-my-github-repositor-…` for an app called `mitrify`. The imported repo's
          // own name is the better, equally-stable identity. See readableAppNameForRepo (pure + tested).
          readableAppName = readableAppNameForRepo({ importedRepo: parseGitHubRepo(importUrl), fallbackTitle: readableAppName });
          const repoName = repoNameForProject(userId, projectId, { appName: readableAppName, createdAtMs: readableCreatedAt });
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
        // Fix 41 (report 2026-07-08): when the clone FAILS, the platform prints an honest "I couldn't
        // clone <url>" — but the AI turn that runs next had NO idea a URL was even tried, so it asked
        // "I don't see a repository URL in your message — please share it", contradicting the platform
        // 15 seconds later (amnesiac + unprofessional). This flag carries the failed URL + reason into
        // the architect prompt so the model acknowledges the failure instead of re-asking for the URL.
        if (importUrl) {
          try {
            // SECURITY (C2): reject a non-GitHub / malformed importUrl up front with a clear message,
            // and NEVER build a token-bearing URL from it (the token would otherwise be embedded into
            // whatever the user supplied). sanitizeRepoUrl validates the plain form; the token is then
            // injected into the SAME validated shape, and GitRepoSync re-validates at the sink.
            const cleanImportUrl = sanitizeRepoUrl(importUrl);
            if (!cleanImportUrl) {
              failedImport = { url: importUrl, reason: 'the URL is not a supported GitHub repository URL (expected https://github.com/owner/repo)' };
              events.emit({ type: 'narration', agent: 'architect', text: `That import URL isn't a supported GitHub repository URL (expected https://github.com/owner/repo). Starting with an empty workspace instead.`, ts: Date.now() });
            } else {
            events.emit({ type: 'narration', agent: 'architect', text: `Importing your project from ${cleanImportUrl}…`, ts: Date.now() });
            const githubToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : '';
            const importStartedAt = Date.now();
            // ═══ INSTANT CONNECT (admin 2026-07-24 — "Claude 0.1s me repo connect ho jata hai") ═══
            // Before ANY download, ask GitHub's API for the file TREE (one tiny call — paths only, no blob
            // content) + a couple of key files. This is how an instant-feeling connect works: no bulk
            // clone, just the structure. We show it right away and feed it to the survey, so the model can
            // describe the app immediately while the full materialization (zipball, below) completes.
            try {
              const tree = await fetchRepoTree({ url: cleanImportUrl, token: githubToken || undefined });
              if (tree.ok && tree.paths && tree.paths.length > 0) {
                const summary = summarizeRepoTree(tree.paths);
                const extHint = summary.extensions.length > 0 ? ` — mostly ${summary.extensions.slice(0, 3).map((e) => `.${e.ext}`).join(', ')}` : '';
                events.emit({
                  type: 'narration', agent: 'architect', ts: Date.now(),
                  text: `🔗 Connected to ${cleanImportUrl} — ${summary.fileCount} file${summary.fileCount === 1 ? '' : 's'}${extHint}. Top level: ${summary.topLevel.join(', ')}${tree.truncated ? ' …(large repo — structure truncated)' : ''}`,
                });
                // Read a few key files on demand (package.json / README / config) so the survey is accurate
                // from the API alone — no wait for the download.
                const keyFiles: Record<string, string> = {};
                for (const p of pickSurveyFiles(tree.paths, 4)) {
                  const f = await fetchRepoTextFile({ url: cleanImportUrl, path: p, token: githubToken || undefined, ref: tree.defaultBranch });
                  if (f.ok && f.content) keyFiles[p] = f.content.slice(0, 8000);
                }
                importSurvey = { url: cleanImportUrl, fileCount: summary.fileCount, structure: summary.topLevel.join(', '), keyFiles, truncated: !!tree.truncated };
              }
            } catch { /* instant-connect is a best-effort accelerator — the zipball land below is the source of truth */ }
            // ═══ PRIMARY IMPORT PATH — SERVER-SIDE ZIPBALL (mitrify autopsy 2026-07-24, the ROOT fix) ═══
            // The old path git-cloned INSIDE the E2B sandbox, which depends on the sandbox having outbound
            // network to github.com AND valid CA certificates — it doesn't (a provably-PUBLIC repo failed
            // to clone in the sandbox with an unclassified error, while an identical clone succeeded
            // everywhere else). Every prior fix touched the overlay/classifier/reporting — all DOWNSTREAM
            // of a clone that never succeeds — so none could work. Fix: fetch the repo SERVER-SIDE (proven-
            // good network — the same server already reaches GitHub's API to create the save-repo) as a
            // zipball, then land it through the EXACT extractZipProject → landImportedProject pipeline the
            // (working) zip-upload import uses. Removes the sandbox network/git/cert dependency entirely.
            let serverSideLanded = false;
            let serverFetchReason: ZipFetchReason | 'validate' | undefined;
            try {
              const zres = await fetchGithubRepoZip({ url: cleanImportUrl, token: githubToken || undefined });
              if (zres.ok && zres.buf) {
                const extracted = await extractZipProject(zres.buf);
                recordImportAccounting(extracted, buildDiag);
                if (Object.keys(extracted.files).length > 0) {
                  const lockKept = Object.keys(extracted.sandboxOnly);
                  serverSideLanded = await landImportedProject(extracted.files, {
                    source: cleanImportUrl,
                    writeToSandbox: true,
                    droppedNote: [
                      extracted.appRoot ? `— landed the app from its "${extracted.appRoot}/" folder` : '',
                      lockKept.length > 0 ? `— kept ${lockKept.join(', ')} for exact dependency versions (sandbox only, over the durable-store size cap)` : '',
                      droppedDetailNote(extracted),
                    ].filter(Boolean).join(' '),
                    sandboxOnly: extracted.sandboxOnly,
                    sandboxAssets: extracted.sandboxAssets,
                    assets: extracted.assets,
                    diag: buildDiag,
                  });
                  if (!serverSideLanded) serverFetchReason = 'validate'; // fetched+extracted but not a runnable project
                } else {
                  serverFetchReason = 'empty'; // repo fetched but nothing importable after filtering
                }
              } else {
                serverFetchReason = zres.reason;
              }
            } catch { serverFetchReason = 'network'; }
            try {
              buildDiag.record({
                phase: 'build',
                severity: serverSideLanded ? 'info' : 'warning',
                code: 'IMPORT_DIAGNOSTIC',
                message: `GitHub import via SERVER-SIDE zipball ${serverSideLanded ? 'SUCCEEDED' : `did not land (${serverFetchReason ?? 'unknown'})`} for ${cleanImportUrl} — hadToken=${!!githubToken}; elapsed=${Date.now() - importStartedAt}ms${serverSideLanded ? '' : ' → falling back to in-sandbox clone'}`,
                autoResolved: serverSideLanded,
              });
            } catch { /* diagnostics are best-effort */ }
            // ═══ RELIABILITY FALLBACK — MATERIALIZE VIA api.github.com ONLY (git tree → git blobs) ═══
            // The zipball redirects to codeload.github.com — a DIFFERENT host than api.github.com. Our
            // proven GitHub client (UserGitHubClient, which creates the save-repo in prod) only ever
            // reaches api.github.com, so codeload's reachability is the one thing not proven. If the
            // zipball didn't land, rebuild the whole file map using ONLY api.github.com (the git tree +
            // per-file git blobs) — the exact host proven to work in prod — then land it through the same
            // pipeline. Slower (one call per file) but maximally reliable; runs only when the fast zipball
            // path failed. (mitrify autopsy 2026-07-24 — remove the last unproven-reachable host.)
            let apiMaterialized = false;
            if (!serverSideLanded) {
              try {
                const mat = await materializeRepoViaApi({ url: cleanImportUrl, token: githubToken || undefined });
                if (mat.ok && mat.files && Object.keys(mat.files).length > 0) {
                  apiMaterialized = await landImportedProject(mat.files, {
                    source: cleanImportUrl,
                    writeToSandbox: true,
                    droppedNote: mat.skipped ? `— skipped ${mat.skipped} file(s) (dependency/build folders, binaries, secrets, or over the size cap)` : '',
                    diag: buildDiag,
                  });
                  serverSideLanded = apiMaterialized;
                }
                buildDiag.record({
                  phase: 'build',
                  severity: apiMaterialized ? 'info' : 'warning',
                  code: 'IMPORT_DIAGNOSTIC',
                  message: `GitHub import via api.github.com git-blobs ${apiMaterialized ? `SUCCEEDED (${mat.fetched} files)` : `did not land (${mat.reason ?? 'unknown'})`} for ${cleanImportUrl} — hadToken=${!!githubToken}; elapsed=${Date.now() - importStartedAt}ms${apiMaterialized ? '' : ' → falling back to in-sandbox clone'}`,
                  autoResolved: apiMaterialized,
                });
              } catch { /* best-effort — fall through to the legacy clone */ }
            }
            // FALLBACK — only if BOTH server-side fetches did NOT land files (a private repo the token
            // truly cannot see, an over-cap repo, or an API outage) — try the legacy in-sandbox clone.
            // Never a regression vs today; on the common case the clone never runs.
            if (!serverSideLanded) {
            // NOTE: do NOT gate the clone on "the sandbox is empty" — ensureWorkspace ALWAYS
            // pre-scaffolds a fresh workspace (a .gitignore + package-lock.json), so an empty check
            // never fires and the import silently did nothing (the reported "GitHub connect hua par
            // 0 files aayi" bug). hydrateFromRepo clones into a TEMP dir and overlays, so it handles
            // a scaffolded workspace by design — just run it whenever the user asked to import.
            const importSync = new GitRepoSync(actuator, workspaceId);
            const cloneUrl = githubToken ? cleanImportUrl.replace('https://', `https://${githubToken}@`) : cleanImportUrl;
            // TRUST THE FILESYSTEM, not the shell echo. On a LARGE repo (real evidence: a 316-file
            // import) hydrateFromRepo's success marker was not captured, so it reported "skipped" and
            // we printed a false "couldn't clone" AND skipped the landing pipeline — even though the
            // files were actually on disk. So we measure the workspace BEFORE and AFTER: if the clone
            // added real files, the import SUCCEEDED regardless of what the echo said, and we land them.
            const beforePaths = new Set(Object.keys((await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string> }))).files));
            let h = await importSync.hydrateFromRepo(cloneUrl, { overlayAnyContent: true });
            let after = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
            let addedReal = Object.keys(after.files).filter((p) => !beforePaths.has(p));
            // Capture the FIRST (token-authed) attempt's outcome before any anonymous retry overwrites it,
            // so the structured IMPORT_DIAGNOSTIC below can show BOTH attempts. (mitrify autopsy 2026-07-24.)
            const authAttempt = { added: addedReal.length, hydrated: h.hydrated, reason: h.reason, errTail: h.errTail };
            let anonRetried = false;
            // ANONYMOUS-CLONE FALLBACK (deep-test App #5, 2026-07-13): a token-authenticated clone can FAIL
            // on a PUBLIC repo the token's scope doesn't cover (a GitHub App installation token, or a token
            // for a different account) — while an anonymous clone of that same public repo succeeds. The
            // report showed hydrateFromRepo say "couldn't clone .../mitrify" while the model's own plain
            // `git clone` of the identical URL exited 0. Retry once WITHOUT the token before giving up (a
            // private repo still needs it, so the authed attempt runs first).
            if (shouldRetryImportAnonymously({ hydrated: h.hydrated, addedFileCount: addedReal.length, hadToken: !!githubToken, urlsDiffer: cloneUrl !== cleanImportUrl })) {
              anonRetried = true;
              events.emit({ type: 'narration', agent: 'architect', text: 'Retrying the import without credentials (it looks like a public repo)…', ts: Date.now() });
              h = await importSync.hydrateFromRepo(cleanImportUrl, { overlayAnyContent: true });
              after = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
              addedReal = Object.keys(after.files).filter((p) => !beforePaths.has(p));
            }
            // STRUCTURED IMPORT DIAGNOSTIC (mitrify autopsy 2026-07-24, rule 5 — the missing subsystem).
            // The import path used to record ONLY human narration strings, so a failed clone was a black
            // box: no reason code, no per-attempt file counts, no stderr — a session had to re-probe the
            // repo externally just to learn it was public. Record the decisive evidence ONCE here (ADMIN
            // diagnostics only; the errTail is already URL/token-redacted inside the sandbox) so the next
            // report definitively shows whether the clone failed (and why) or the overlay dropped files.
            const importLanded = h.hydrated || addedReal.length > 0;
            try {
              buildDiag.record({
                phase: 'build',
                severity: importLanded ? 'info' : 'warning',
                code: 'IMPORT_DIAGNOSTIC',
                message: `GitHub import ${importLanded ? 'SUCCEEDED' : 'did not land files'} for ${cleanImportUrl} — hadToken=${!!githubToken}; authAttempt(added=${authAttempt.added}, reason=${authAttempt.reason ?? (authAttempt.hydrated ? 'ok' : 'none')}); ${anonRetried ? `anonRetry(added=${addedReal.length}, reason=${h.reason ?? (h.hydrated ? 'ok' : 'none')})` : 'no-anon-retry'}; elapsed=${Date.now() - importStartedAt}ms`,
                autoResolved: importLanded,
                detail: (h.errTail || authAttempt.errTail) ? `git stderr (redacted): ${(h.errTail || authAttempt.errTail || '').slice(0, 300)}` : undefined,
              });
            } catch { /* diagnostics are best-effort — never let a record break the import */ }
            if (importLanded) {
              // LANDING PIPELINE (same as a zip import): the clone put files in the SANDBOX only.
              // Land them properly — durable store (Files/IDE/reopen), files_restored event,
              // framework lock, edit mode, memory index, background preview boot.
              if (Object.keys(after.files).length > 0) {
                // Only the label is threaded here (not the whole diagnostics object): this path never
                // recorded issues, and widening its forensic surface is a separate change. The label
                // alone is what the autopsy proved wrong, so the label alone is what moves.
                await landImportedProject(after.files, {
                  source: cleanImportUrl, writeToSandbox: false,
                  diag: { record: () => {}, setFramework: (f) => buildDiag.setFramework(f) },
                });
              } else {
                events.emit({ type: 'narration', agent: 'architect', text: 'The repository cloned but contained no readable source files — starting with an empty workspace instead.', ts: Date.now() });
              }
            } else if (h.skipped) {
              // The clone genuinely failed AND added no files. Instead of one generic guess, give the
              // user the ACCURATE cause git reported (no connection / expired token / wrong account /
              // network) — classified inside the sandbox so the token never leaks (admin 2026-07-23).
              const diagCtx = { reason: h.reason, hadToken: !!githubToken, url: cleanImportUrl };
              failedImport = { url: cleanImportUrl, reason: importFailureModelReason({ reason: h.reason, hadToken: !!githubToken }) };
              events.emit({ type: 'narration', agent: 'architect', text: importFailureNarration(diagCtx), ts: Date.now() });
            } else {
              // Cloned successfully but the repo had no content beyond .git (a brand-new empty repo).
              events.emit({ type: 'narration', agent: 'architect', text: `${cleanImportUrl} looks like an empty repository — there was nothing to import. Tell me what you'd like to build in it.`, ts: Date.now() });
            }
            } // end fallback in-sandbox clone (if !serverSideLanded)
            }
          } catch (importErr) {
            const m = importErr instanceof Error ? importErr.message : String(importErr);
            // Fix 62 — redact URLs/tokens/vendor from the git error before it reaches the user's chat
            // (a raw clone error can echo the token-embedded remote URL — a secret leak).
            const safeM = redactProviderError(m);
            failedImport = { url: importUrl, reason: `the import errored (${safeM})` };
            events.emit({ type: 'narration', agent: 'architect', text: `Could not import the repository (${safeM}). Starting with an empty workspace instead.`, ts: Date.now() });
          }
        }
        // FILE GUARDIAN: the files v5.0 created must STAY. The sandbox is ephemeral, so at the start
        // of every turn we compare what's in it against the durable history (WorkspaceFileStore) and
        // AUTO-RECOVER anything that went missing — a one-off deleted file is re-added, and a fully
        // recycled sandbox is restored whole (overwriting bare scaffold placeholders). It runs BEFORE
        // the agent edits anything, so it can only recover loss, never clobber legitimate new work.
        // ── "KEEP MY CHANGES" (admin 2026-08-09) ────────────────────────────────────────────────────
        // Green Guard has exactly one honest false positive: a user who asked for something large ON
        // PURPOSE — a framework migration, a rewrite — gets rolled back because their app legitimately
        // does not render yet. A safety net the user cannot escape is a cage, so the restore message
        // states the exact words that bring their version back, and this honours them.
        //
        // It runs BEFORE the file guardian on purpose: the guardian's job is to restore the durable
        // project into the sandbox, so putting the attempt into the durable store first means the
        // guardian then carries it into the sandbox by its own existing path — no second restore
        // mechanism to keep in step with the first. The turn then proceeds normally, so "keep my
        // changes and add a login" does both things in one go instead of costing the user a turn.
        //
        // Matching is EXACT-PHRASE, never a classifier: guessing wrong here either strands the user or
        // restores a broken tree over a working one, and neither is worth a probabilistic win rate.
        if (greenGuardEnabled() && wantsAttemptBack(prompt)) {
          try {
            const attempt = await loadWorkspaceFiles(attemptWorkspaceKey(workspaceId)).catch(() => ({} as Record<string, string>));
            const count = Object.keys(attempt).length;
            if (count > 0) {
              await saveWorkspaceFiles(workspaceId, attempt);
              events.emit({ type: 'narration', agent: 'architect', text: attemptRestoredMessage(count), ts: Date.now() });
              buildDiag.record({
                phase: 'build', severity: 'info', code: 'GREEN_GUARD_ATTEMPT_RESTORED',
                message: `The user asked for the rolled-back attempt back; ${count} file(s) restored from the preserved attempt before this turn's work began.`,
                autoResolved: true,
              });
            } else {
              // Honest rather than silent: the phrase was understood, there was simply nothing kept.
              events.emit({ type: 'narration', agent: 'architect', text: 'There is no earlier version of yours saved to bring back — nothing was rolled back recently. Tell me what you would like to change and we will go from what is here now.', ts: Date.now() });
            }
          } catch { /* best-effort — a failed recall must never block the turn */ }
        }
        try {
          const saved = await loadWorkspaceFiles(workspaceId);
          const existing = await collectWorkspaceFiles(actuator, workspaceId).catch(() => ({ files: {} as Record<string, string>, skipped: [] }));
          // `existing.skipped` MUST be passed: those paths ARE in the sandbox, the scan just declined
          // to read them (excluded/too large/binary/unreadable/past a cap). Judged without it, they
          // looked missing — a false data-loss report AND an overwrite of possibly-newer content by an
          // older snapshot (mitrify autopsy 2026-08-04). See planFileGuardian's header.
          const plan = planFileGuardian(saved, existing.files, existing.skipped);
          if (plan.count > 0) {
            // Fix 37c (admin: "data kyu udha, report me likh kar aaye"): record the OBSERVED cause of
            // the loss the guardian is about to repair — an empty sandbox listing means the ephemeral
            // sandbox was recycled/cold; a partial gap means specific files went missing. This lands
            // in the report's dataLossEvents so the WHY is diagnosable after the fact, not guessed.
            try {
              const existingCount = Object.keys(existing.files).length;
              // Message math made explicit (quiz-app autopsy 2026-07-17): "store holds 27; sandbox
              // listed 27 — restoring 1" read as self-contradictory. The listings are SETS, not just
              // counts — the sandbox can list N files while still MISSING some stored ones (it may
              // hold different extras). Say the missing count in plain words.
              // Honest arithmetic (mitrify autopsy 2026-08-04): the scan's SKIPPED paths are present in
              // the sandbox, so they are named separately instead of silently inflating the "missing"
              // number — the old line reported the scan's own skip gap as if it were lost data.
              const skippedCount = existing.skipped.length;
              buildDiag.recordDataLoss(
                existingCount === 0 ? 'sandbox recycled/empty' : 'files missing from sandbox',
                `durable store holds ${Object.keys(saved).length} file(s); the live sandbox read ${existingCount}${skippedCount > 0 ? ` (plus ${skippedCount} present but not read — excluded/too large/binary)` : ''} and was genuinely missing ${plan.count} of the stored file(s) — restoring ${plan.count} (mode: ${plan.mode}). The durable store + GitHub history retained everything; only the ephemeral sandbox lost state.`,
              );
            } catch { /* diagnostics are best-effort */ }
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
          // PRE-FLIGHT DEP SYNC (quiz-app autopsy 2026-07-17): the well-known-dep reconcile used to
          // run ONLY inside the end-of-build readiness pass — an INTERRUPTED build (internet cut,
          // credit cut, kill) never reached it, so its package.json could ship without a dependency
          // its own imports need (react-router-dom in the real case) and the NEXT session's dev
          // server crashed on it, costing an LLM self-heal round. The guardian turn-start already
          // holds the full durable map + live sandbox map in memory, so reconciling here is free —
          // deterministic, before the dev server or any model sees the workspace. Same kill switch
          // as the readiness-pass reconcile (AGENTV3_DEP_RECONCILE=off); readiness still backstops.
          // ROOT CAUSE (mitrify import autopsy 2026-07-27, buildId 321f4f6c): this pre-flight reconcile
          // mutated package.json on a turn whose prompt was "Import this app … Do not change any files
          // yet" — a direct instruction violation. It is a SIBLING of the exact bug `shouldRunIntegrityHeal`
          // was built to close on 2026-07-24 (same class: a file-mutating pass that didn't check
          // isImportTurn) — that fix covered the integrity self-heal but not this pass. Gated the same way.
          if (process.env.AGENTV3_DEP_RECONCILE !== 'off' && !isImportTurn) {
            try {
              const union = { ...saved, ...existing.files, ...plan.restore };
              // FRAMEWORK-DRIFT CORRECTION (PulseBoard autopsy 2026-07-20): the `framework` label is set
              // ONCE (client picker / first-turn prompt) and never re-derived from what the app ACTUALLY
              // became. A Next.js app carried a stale `vite-react` label for the WHOLE session — so the
              // builder spent ~15 min reconciling package.json vs Next.js code, the preview booted with
              // Vite assumptions, and the report mislabelled it. Now: when the restored workspace clearly
              // IS a meta-framework (a real next/nuxt/… dep, its config file, or the App-Router shape) that
              // differs from the current label, adopt it — the SAME adoption a zip import already does,
              // extended to a continue/restore turn. Only ever UPGRADES a bare `vite-react` label to a
              // confidently-detected meta-framework (detectFrameworkFromWorkspace returns null otherwise),
              // so it can never mis-flip a genuine Vite app. Kill switch: AGENTV3_FRAMEWORK_DRIFT=off.
              if (process.env.AGENTV3_FRAMEWORK_DRIFT !== 'off' && framework === 'vite-react') {
                const detected = detectFrameworkFromWorkspace(union);
                if (detected && detected !== framework) {
                  framework = detected;
                  // Same sibling as the import path above — the report must not keep the stale label.
                  try { buildDiagRef?.setFramework?.(detected); } catch { /* never block a build on a label */ }
                  events.emit({ type: 'narration', agent: 'architect', text: `🧭 Detected this is a ${detected} app (not the default) — switching to the ${detected} toolchain so the preview and checks match your code.`, ts: Date.now() });
                }
              }
              // PROJECT-COHERENCE PRE-FLIGHT (autopsy buildId a4be5a05): a workspace whose SOURCE files are
              // one framework (e.g. a .svelte/+page.server.ts/$lib tree) but whose package.json can't build
              // it (React + `tsc && vite build`, no svelte deps) makes the builder thrash ~18 min then fail
              // (tsc-not-found, $types unresolved, $lib unresolvable). No detector caught this because they
              // all trust package.json deps and never classify source files by extension. Here we DETECT it
              // and WARN the agent (prepended to buildPrompt) to reconcile to ONE framework before writing
              // features — we never auto-mutate files (that's the risky part). Kill switch:
              // AGENTV3_FRAMEWORK_COHERENCE=off.
              if (process.env.AGENTV3_FRAMEWORK_COHERENCE !== 'off') {
                const coherence = checkFrameworkCoherence(union);
                if (!coherence.ok) {
                  frameworkCoherenceMsg = frameworkCoherenceGuidance(coherence);
                  buildDiag.record({ phase: 'plan', severity: 'warning', code: 'FRAMEWORK_SOURCE_MISMATCH', message: `Workspace source is ${coherence.sourceFramework} but package.json is ${coherence.packageFramework} — reconcile to one framework before building.`.slice(0, 400), autoResolved: false, detail: coherence.evidence.join('; ') });
                }
              }
              if (typeof union['package.json'] === 'string') {
                const depRes = applyWellKnownMissingDeps(union);
                if (depRes.added.length) {
                  const newPkg = depRes.files['package.json'];
                  await writeWorkspaceFiles(actuator, workspaceId, { 'package.json': newPkg });
                  await mergeWorkspaceFiles(workspaceId, { 'package.json': newPkg }).catch(() => {});
                  state.recordFileChange({ path: 'package.json', kind: 'modify' }, 'architect');
                  events.emit({ type: 'narration', agent: 'architect', text: `🔧 Added ${depRes.added.length} missing dependency(ies) to package.json (${depRes.added.map((d) => d.package).join(', ')}) so the app installs and runs.`, ts: Date.now() });
                }
              }
            } catch { /* best-effort — the readiness-pass reconcile still backstops */ }
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
        sandboxUnavailable = true;
        buildDiag.record({
          phase: 'sandbox', severity: 'error', code: 'SANDBOX_UNAVAILABLE',
          message: 'The build sandbox could not be set up — the build cannot create files.',
          autoResolved: false, detail: m.slice(0, 300),
        });
        events.emit({
          type: 'narration',
          agent: 'architect',
          // Clean, non-leaky message to the user (Fix 62); the raw reason `m` is in buildDiag.detail above.
          text: sandboxUnavailableNotice(),
          ts: Date.now(),
        });
      }

      // PLAN CONTINUITY (admin 2026-07-21 — "plan reset na ho, ek hi plan complete ho"): MEMORY
      // FIX 4 saves the final plan durably as a PLAN_STATE note at build end, but the LOAD half
      // was only ever wired into the resume endpoint — every new build turn started from an EMPTY
      // WorkspaceState, so a continuation turn (auto-continue / "continue" / a queued step) showed
      // a fresh 0/N plan instead of the one the user was watching. Seed the workspace with the
      // saved plan when it is UNFINISHED, so x/y keeps climbing across turns until the app is done;
      // a fully-done plan is retired and a new request starts clean. With merge-on-update
      // (todoMerge.ts) the model's next update_todo folds INTO this seeded plan — finished items
      // stay, stale pending items prune, new steps append. Best-effort, never blocks a build.
      try {
        const findPlanNote = (eps: Array<{ kind?: string; text?: string }> | undefined) =>
          eps?.slice().reverse().find((e) => e.kind === 'note' && typeof e.text === 'string' && e.text.startsWith('PLAN_STATE'));
        let planSeedNote = findPlanNote(getWorkspaceMemory(workspaceId).snapshot().episodes);
        if (!planSeedNote) {
          const coldSnap = await loadWorkspaceMemory(workspaceId).catch(() => null);
          planSeedNote = findPlanNote(coldSnap?.episodes);
        }
        const savedPlan = planSeedNote ? parsePlanState(planSeedNote.text) : [];
        if (savedPlan.length > 0 && savedPlan.some((t) => t.status === 'pending' || t.status === 'in_progress')) {
          state.setTodos(savedPlan);
        }
      } catch { /* plan continuity is best-effort — never blocks a build */ }

      // Remember the build request in project memory (episodic — the team can
      // recall what was asked for during the build).
      getWorkspaceMemory(workspaceId).recordRequest(prompt);

      // The Architect can delegate to specialist sub-agents via the task tool.
      const spawnSubAgent = makeSubAgentSpawn({
        client, actuator, workspaceId, state, events, model, onlyOpus,
        // Tier fidelity + honest billing (admin 2026-07-13): sub-agents spend most of a build's
        // tokens — they must bill at the TIER's rate (Strong → Sonnet × 3, not Opus × 2) and run
        // at the tier's effort, same as the top-level runner.
        powerLevel: powerLevelReqEffective, effort: powerSpecResolved.effort,
        maxBudgetUsd: maxBudgetUsdForRunner, maxSteps: subAgentMaxSteps, checkpointer: git,
        // Pass the SAME 32000-token per-turn cap the top-level runner uses (below). Without it a
        // sub-agent falls back to 8192 and truncates large files — the top cause of incomplete apps.
        maxTokensPerTurn: buildMaxTokensPerTurn(),
        // Billing accounting fix (THE big leak): the Architect delegates all app code to sub-agents,
        // so most of a build's tokens are spent here. Feed the build-level sink so they are billed.
        usageSink: buildUsage,
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
      // ONE implementation, shared with the direct Publish endpoint — see makeDeployFn.
      const deploy = makeDeployFn({ userId, githubToken: githubTokenForDeploy, providerId: chosenProviderId });
      // writtenFiles is declared further up (hoisted so the deadline-timeout/crash paths can see it too).
      // Fix 2 — PROGRESSIVE SERVER PERSISTENCE: save every written file to Firestore
      // within 3 s of each write. If the client connection drops mid-build (tab close,
      // network hiccup), the files already written are safely on the server. The final
      // save at build-end (below) is still the authoritative snapshot; this is the
      // mid-build safety net. GitHub push still happens only after 100% completion.
      let _progressPersistTimer: ReturnType<typeof setTimeout> | null = null;
      // AUTOPSY 2026-07-06 ("yeh app nahi bani"): the sandbox + Cloud Run instance are EPHEMERAL — a
      // rotation/hard-kill mid-build loses everything not yet durably saved. The old code used a
      // RESETTING 3 s debounce, so a CONTINUOUS write burst (parallel specialist agents each writing
      // files) kept sliding the timer and it NEVER flushed until a 3 s gap — a rotation during the burst
      // lost the whole app. Guarantee a durable flush at least every FILE_FLUSH_MAX_MS regardless of the
      // write rate, while still coalescing quiet bursts. Bounds worst-case loss to a few seconds of work.
      const FILE_FLUSH_MAX_MS = 6_000;
      let _lastFileFlushAt = Date.now();
      // PLAN SYNC: drive the plan list's spinner + green ticks from REAL build activity, since the
      // model (Haiku especially) does not reliably call update_todo to advance statuses. Each file
      // written advances the progress; the build's final success marks every item done (below).
      let planSteps = 0;
      // GREEN FREEZE — record each refused post-green write as an honest, offered-not-applied finding,
      // and collect them so the user is told (via the GREEN STOP suggestion path) rather than left with
      // a silent no-op. Disposed in the finally so nothing leaks between builds.
      disposeGreenFreezeObserver = setGreenFreezeObserver(({ path, pass }) => {
        try {
          buildDiag.record({
            phase: 'build', severity: 'info', code: 'GREEN_FREEZE_DEFERRED',
            message: `The app was already verified working, so an edit to "${path}"${pass ? ` (${pass})` : ''} was NOT applied — the working app was left untouched. Reply if you want this change made.`,
            autoResolved: true,
          });
        } catch { /* best-effort */ }
      });
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
        const flushFilesDurably = () => {
          _lastFileFlushAt = Date.now();
          if (_progressPersistTimer) { clearTimeout(_progressPersistTimer); _progressPersistTimer = null; }
          if (writtenFiles.size > 0) {
            saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)).catch(() => {});
          }
        };
        if (flushDecision(_lastFileFlushAt, Date.now(), FILE_FLUSH_MAX_MS) === 'flush-now') {
          // Overdue — a burst has been sliding the debounce; flush NOW so a rotation can't wipe it.
          flushFilesDurably();
        } else {
          if (_progressPersistTimer) clearTimeout(_progressPersistTimer);
          _progressPersistTimer = setTimeout(flushFilesDurably, 3_000);
        }
      };
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git, secondOpinion, consensus, webSearch, deploy, onFileWrite, framework,
        // AI Diagnosis Bundle #3 — capture every sandbox command's raw logs into the build report.
        (c) => { try { buildDiag.recordCommand(c); } catch { /* diagnostics are best-effort */ } });
      // "made by NavBharatAI" signature: default ON, off only when the user toggled it off in
      // Settings → General. The dispatcher bakes the badge into index.html on preview publish.
      dispatcher.setSignatureEnabled(appSignatureEnabled);
      // Vault → App pipe (admin 2026-07-17): inject the user's OWN saved keys (Settings → Secrets & API Keys)
      // into the .env of the app they build, so an app that needs an API key runs with the real key the
      // user stored — without ever pasting it into chat. Loaded from the user's ENCRYPTED vault only
      // (loadUserVaultSecrets never reads process.env, so NavBharatAI's platform keys can never leak in).
      // Captured into `vaultSecrets` so the connected-database context (below) can also read it.
      let vaultSecrets: Record<string, string> = {};
      try {
        if (userId) {
          vaultSecrets = await loadUserVaultSecrets(userId);
          // ENGINEER_DB_PROVIDER is an internal marker (which DB the user connected), not an app secret —
          // keep it OUT of the built app's .env; it is only used to build the DB context prompt below.
          const { [DB_PROVIDER_MARKER]: _dbMarker, ...appEnv } = vaultSecrets;
          dispatcher.setUserSecrets(appEnv);
          // PRE-FLIGHT WRITE (mitrify autopsy 2026-08-04). The secrets .env used to be written lazily from
          // inside run_command, so any path that starts a dev server through the ACTUATOR instead — an
          // import turn, the Diagnose button, update_preview — booted the app with NONE of the keys the
          // user saved in Settings. Write them now, before anything can run, so the keys the user entered
          // are genuinely readable by the app v5.0 built. No-op when the vault is empty; best-effort.
          await dispatcher.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS).catch(() => {});
        }
      } catch { /* best-effort — a vault-load failure just means the app runs without injected keys */ }

      // ASK FOR A DATABASE WHEN THE SANDBOX CANNOT PROVIDE ONE (admin 2026-08-06: "user se puchona
      // chahiye na!"). The sandbox's own Postgres is free and instant, so it is always tried FIRST and
      // no question is asked when it works. When it does not, the build used to write a DATABASE_URL
      // pointing at a database that was never running and carry on toward a certain ECONNREFUSED.
      //
      // The offer is only wired when we can genuinely honour a "yes": the user must already have their
      // Supabase account connected, because consent needs a browser popup that a running build cannot
      // open. Without a grant we stay silent here — the existing "connect your own in Settings" guidance
      // is the honest answer, and an offer we cannot fulfil would be worse than none.
      //
      // It ASKS rather than acting because a new project consumes one of the two a free Supabase plan
      // allows. Deny (or the approval timeout) simply means we continue and report honestly.
      // ASK THE USER FOR A KEY, MID-BUILD (admin 2026-08-08). Wired only when there is a VERIFIED user,
      // because without one there is no vault to save into — and a popup whose input goes nowhere is
      // worse than the build carrying on and reporting the missing key at the end.
      //
      // The value never passes through here. The client writes it straight to the encrypted vault over
      // the authenticated secrets API; this callback only re-READS the vault afterwards and hands the
      // dispatcher the pairs to merge into the app's `.env`. That re-read is the whole point: the vault
      // is loaded once at build start, so a key saved mid-build would otherwise not exist for the
      // running app until the next build.
      if (userId) {
        dispatcher.setSavedSecretNames(Object.keys(vaultSecrets));
        dispatcher.setSecretRequestHandler(async (asks) => {
          const requestId = randomUUID();
          emit({
            type: 'secret_request',
            agent: 'architect',
            callId: requestId,
            prompt: secretRequestPrompt({ ask: asks, alreadyHave: [], rejected: [] }),
            secrets: asks,
            ts: Date.now(),
          });
          // `false` here means the user pressed Skip, closed the build, or the ask timed out — all of
          // which are "carry on without it", never a retry loop.
          if (!await awaitApproval(requestId)) return null;

          // Re-read the vault: the client saved directly to it, so this is the first moment the server
          // can see the values. Only the keys we ASKED for are returned — a build must never quietly
          // pull in unrelated keys the user happens to have saved.
          const fresh = await loadUserVaultSecrets(userId).catch(() => null);
          if (!fresh) return null;
          const picked: Record<string, string> = {};
          for (const a of asks) {
            const v = fresh[a.name];
            if (typeof v === 'string' && v.trim()) picked[a.name] = v;
          }
          return Object.keys(picked).length > 0 ? picked : null;
        });
      }

      if (userId && vaultSecrets[DB_PROVIDER_MARKER] !== 'supabase') {
        const connected = await getConnection(userId).catch(() => null);
        if (connected?.orgId) {
          let asked = false;
          dispatcher.setDatabaseFallback(async () => {
            if (asked) return null; // one offer per build — never a loop of prompts
            asked = true;
            const requestId = randomUUID();
            emit({
              type: 'narration', agent: 'architect', ts: Date.now(),
              text: '🗄️ Your app needs a database to save data, and a temporary one could not be started here.',
            });
            emit({
              type: 'permission_request',
              agent: 'architect',
              action: 'Create a free database in YOUR OWN Supabase account so this app can save data? '
                + 'Approve = I create it now and wire it up (your data and its billing stay yours; it uses one of the 2 projects a free Supabase plan allows). '
                + 'Deny = I keep going without one, and you can connect your own in Settings → App Settings → Database.',
              callId: requestId,
              ts: Date.now(),
            });
            if (!await awaitApproval(requestId)) {
              emit({ type: 'narration', agent: 'architect', ts: Date.now(), text: '👍 No database created. You can connect your own any time in Settings → App Settings → Database.' });
              return null;
            }
            emit({ type: 'narration', agent: 'architect', ts: Date.now(), text: '🗄️ Creating your database in your Supabase account — this takes a minute or two.' });
            const result = await provisionDatabaseForUser(userId, { appLabel: prompt.slice(0, 40), workspaceId }).catch(() => null);
            if (!result || !result.ok) {
              // Supabase's own words — a full free plan in particular needs the user's action, not a
              // generic failure line that reads like our bug.
              emit({ type: 'narration', agent: 'architect', ts: Date.now(), text: `⚠️ ${result && !result.ok ? result.error : 'Your database could not be created just now.'}` });
              return null;
            }
            emit({
              type: 'narration', agent: 'architect', ts: Date.now(),
              text: result.schemaApplied === false
                ? '✅ Database created in your Supabase account and wired into your app — its tables could not be set up yet, so I will create them as the build continues.'
                : '✅ Database created in your Supabase account and wired into your app. Your data stays in your own account.',
            });
            return result.env;
          });
        }
      }

      dispatcherForFlush = dispatcher; // let the finally flush the final checkpoint

      // Surgical edit mode (gold standard): when the user is editing an existing
      // app rather than building fresh, inject the CURRENT file tree and the
      // edit-mode prefix so the agent reads existing files and makes minimum,
      // targeted edit_file patches — never rebuilding everything from scratch.
      // Best-effort: a listFiles failure falls back to the edit prefix without a
      // tree, and a non-edit turn uses the normal architect prompt unchanged.
      let architectSystem = architectSystemPrompt(framework, { parallelBuild });
      // Capture the pure static body BEFORE any per-request context block is prepended below, so the
      // cache-prefix optimization (AGENTV3_CACHE_PREFIX, applied before the runner is built) can split
      // the volatile prefix back out and keep this large static body as a stable Anthropic cache prefix.
      const staticArchitectSystem = architectSystem;
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
      // Weak-tier build discipline (admin 2026-07-14): a weak/cheap-only build (GLM/Kimi) drifts over
      // the long tool-loop and ends half-broken — it keeps adding features instead of finishing a
      // running core. Give it an explicit core-first, keep-it-compiling build order. Pure guidance
      // (cannot break a build), scoped to noClaudeBuild, kill switch AGENTV3_WEAK_DISCIPLINE=off.
      // Additive + best-effort: '' (no change) for any non-weak build, so paid/power builds are unchanged.
      try {
        const disciplineBlock = weakBuildDisciplineBlock(noClaudeBuild);
        if (disciplineBlock) architectSystem = `${disciplineBlock}\n\n---\n\n${architectSystem}`;
      } catch { /* weak-tier discipline is best-effort — never blocks a build */ }
      // M2-S2.2 (design system): on a FRESH build, hand the model a domain-fit, WCAG-checked accent
      // palette (hospital→teal, finance→emerald, restaurant→amber, …) so the app gets a professional,
      // fitting colour scheme instead of always-indigo or a random guess. Advisory only (the model may
      // design its own with equal contrast). Additive + best-effort; skipped on edits and via
      // AGENTV3_PALETTE_PRESET=off.
      try {
        if (!isEditMode && process.env.AGENTV3_PALETTE_PRESET !== 'off') {
          const paletteBlock = palettePromptBlock(pickPaletteForPrompt(prompt));
          architectSystem = `${paletteBlock}\n\n---\n\n${architectSystem}`;
        }
      } catch { /* palette preset is best-effort — never blocks a build */ }
      // MISSING-CREDENTIAL CONTRACT (admin spec 2026-08-03: "jab tak user keys na de, us option ko 'coming
      // soon' likh kar freeze kar do — puri app band na ho"). AppRequirements tells the user WHICH of their
      // own keys are missing; that message is worthless if the app is already dead by the time they read it.
      // Generated apps routinely do `if (!process.env.X) throw` at module scope, so ONE unset payment key
      // white-screens a 12-screen app — a total failure of the one absolute rule, triggered by the user
      // having done nothing wrong. PREVENTION beats repair (the 50/50 law), so the contract is injected into
      // the builder's prompt: a missing credential freezes that ONE control in a visible, disabled "Coming
      // soon" state naming the exact key + settings path, never crashes at boot, and never fakes a result.
      // Additive + best-effort; AGENTV3_CREDENTIAL_GUARD=off leaves the prompt byte-identical.
      try {
        if (credentialGuardEnabled()) {
          architectSystem = `${credentialGuardInstruction()}\n\n---\n\n${architectSystem}`;
        }
      } catch { /* the guard contract is best-effort — never blocks a build */ }
      // Phase S2 — IDE↔v5.0 awareness (Google-AI-Studio style): if the user MANUALLY edited files in
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
      // GA-6 — Persistent engineering memory: inject this PROJECT's prior architecture decisions (ADRs)
      // so a follow-up build stays consistent with the established stack instead of re-deciding blind.
      // Additive + best-effort — '' (no change) for a first build or on any error; never blocks a build.
      try {
        const adrContext = await adrStore.contextFor(userId, workspaceId);
        if (adrContext) architectSystem = `${adrContext}\n\n---\n\n${architectSystem}`;
      } catch { /* ADR context is best-effort — a failure leaves the prompt unchanged */ }
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
      // Connected-database context (admin 2026-07-20): if the user connected their OWN database in
      // Settings → Database, tell the builder to USE it (exact env-var names + real SDK) and never
      // scaffold a new/different one. Reads the vault secrets loaded above. Additive + best-effort —
      // '' when no DB is connected, so plain builds and prompt-regression tests are unaffected.
      try {
        const dbContext = userDatabaseContext(vaultSecrets);
        if (dbContext) {
          architectSystem = `${dbContext}\n\n---\n\n${architectSystem}`;
        } else if (!isEditMode) {
          // No database connected: on a fresh build, tell the builder to guide the user (in THEIR
          // language) to connect their own DB at Settings → Database IF the app needs persistence.
          // Skipped in edit mode (an established app already made its data decision).
          architectSystem = `${noDatabaseConnectedContext()}\n\n---\n\n${architectSystem}`;
        }
      } catch { /* connected-DB context is best-effort — a failure leaves the prompt unchanged */ }
      // Connected-storage context (admin 2026-07-29): if the user connected a STANDALONE file-storage
      // provider in Settings → App Settings → Storage (S3-compatible / Cloudinary), tell the builder to
      // USE it (exact env-var names + the real StorageGenerator recipe) and never invent its own upload
      // path. Additive + best-effort — '' when no storage is connected, so plain builds are unaffected.
      // (Firebase/Supabase storage is already covered by the connected-DB context above.)
      try {
        const storageContext = userStorageContext(vaultSecrets);
        if (storageContext) architectSystem = `${storageContext}\n\n---\n\n${architectSystem}`;
      } catch { /* connected-storage context is best-effort — a failure leaves the prompt unchanged */ }
      // Connected-auth context (admin 2026-07-29): if the user connected a dedicated auth provider in
      // Settings → App Settings → Authentication (Clerk / Auth0 / Supabase / Firebase), tell the builder
      // to USE it for all login/session and never roll its own. Additive + best-effort — '' when none is
      // connected. Coherent with the DB context: it instructs "DB for data, this provider for auth".
      try {
        const authContext = userAuthContext(vaultSecrets);
        if (authContext) architectSystem = `${authContext}\n\n---\n\n${architectSystem}`;
      } catch { /* connected-auth context is best-effort — a failure leaves the prompt unchanged */ }
      // P-AI.3 — Dialogue phase: give the agent a posture for this turn's lifecycle stage (debugging /
      // requirements / planning / deploy). hasExistingFiles ≈ isEditMode (an established project).
      // Additive + best-effort: '' for the baseline build phase, so existing turns are unchanged.
      try {
        const { guidance } = dialoguePhaseContext({ intent, prompt, hasExistingFiles: isEditMode, planning: planFirst });
        if (guidance) architectSystem = `${guidance}\n\n---\n\n${architectSystem}`;
      } catch { /* dialogue phase is best-effort — a failure leaves the prompt unchanged */ }

      // Fix 41: if a GitHub-URL import was attempted and FAILED this turn, tell the model plainly so it
      // never asks the user for the URL they already provided (the amnesiac "I don't see a URL" reply).
      const importFailNote = failedImportPromptNote(failedImport);
      if (importFailNote) architectSystem = `${importFailNote}\n\n---\n\n${architectSystem}`;
      // INSTANT CONNECT: give the architect the repo's real structure + key files (fetched via the GitHub
      // API up-front) so it can survey the imported app immediately, Claude-style.
      const importSurveyNote = importSurveyPromptNote(importSurvey);
      if (importSurveyNote) architectSystem = `${importSurveyNote}\n\n---\n\n${architectSystem}`;

      // P-ARCH+.3 — up-front BLUEPRINT (advisory) for DEEP, agentic, NEW builds. The fast lane already
      // freezes a file-manifest + shared contract; the agentic loop plans free-form (update_todo only),
      // so a large app drifts (mismatched imports, missing files). This does ONE bounded, best-effort
      // model step to propose a file manifest + shared contract and PREPENDS it as advisory guidance —
      // the architect still owns the plan. Default OFF (opt-in AGENTV3_BLUEPRINT=on), matching the
      // cautious rollout of AGENTV3_ESCALATION/AUTOFIX. FULLY CONTAINED: on any timeout/error the block
      // is empty and the build runs EXACTLY as today; its tokens are billed via blueprintUsage below.
      if (
        !isEditMode && intent === 'new_build' && buildDepth === 'deep'
        // Simple-lane-eligible builds (now incl. sonnet tier) plan their own manifest+contract inside
        // the lane — spending a blueprint model call here would be wasted on them.
        && !classifyForSimpleLane(analysis?.startTier) && envFlag('AGENTV3_BLUEPRINT')
      ) {
        try {
          const bpGenerate = async (system: string, user: string): Promise<string> => {
            const startedAt = Date.now();
            // Cheap-floor-first like every other build text call (admin 2026-07-11 — no direct-Sonnet path).
            let bpProvider = 'CLAUDE';
            const call = makeFastTextRunner((used) => { bpProvider = used; }).runTurn({
              model: fastBuildModel(), system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 6000,
            });
            // Hard timeout so an up-front step can NEVER hang the build (the losing call is ignored).
            const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('blueprint step timed out')), 30_000));
            const t = await Promise.race([call, timeout]);
            try {
              const lbl = fastLaneProviderLabel(bpProvider);
              buildDiag.recordLlmCall({ model: lbl === 'anthropic' ? fastBuildModel() : bpProvider.toLowerCase(), provider: lbl, promptPreview: `${system}\n---\n${user}`, promptChars: system.length + user.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true });
            } catch { /* diagnostics best-effort */ }
            blueprintUsage.inputTokens += t.usage.inputTokens;
            blueprintUsage.outputTokens += t.usage.outputTokens;
            buildUsage.add({ inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens });
            return t.text;
          };
          const scaffold = (await actuator.listFiles(workspaceId).catch(() => [])).filter((p) => !/^(node_modules|\.git)\//.test(p)).slice(0, 80);
          const manifest = parseFileManifest(await bpGenerate(manifestSystemPrompt(framework), manifestUserPrompt(prompt, scaffold)));
          // FILE BUDGET honesty (admin 2026-08-02): the plan is NEVER trimmed — shipping an incomplete app
          // would be far worse than shipping a large one — but an overrun is recorded so "this app planned
          // more files than it should need" is measurable instead of invisible.
          try {
            const overNote = overBudgetNote(manifest.length, fileBudgetForPrompt(prompt));
            if (overNote) buildDiag.record({ phase: 'plan', severity: 'warning', code: 'FILE_BUDGET_EXCEEDED', message: overNote, autoResolved: true });
          } catch { /* budget telemetry is best-effort */ }
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
          // PROJECT CONTRACT CARD (autopsy 2026-08-02) — PREVENT the two import mistakes this edit
          // build made and then had to self-heal: it imported shared types from `./storage` (the wrong
          // owner) and used `nanoid` without declaring it in package.json. The builder had the file
          // TREE and a few file CONTENTS, but never a compact symbol→module map or the declared-package
          // list, so it guessed. Hand it both BEFORE it writes a line — a heal that keeps firing is an
          // unfixed root cause. Runs AFTER warmIndexFiles (the graph is warm) so the card reflects the
          // real project. Pure + bounded (caps in projectContractCard); best-effort — on any failure
          // the build proceeds exactly as before. Kill switch AGENTV3_CONTRACT_CARD=off.
          if (process.env.AGENTV3_CONTRACT_CARD !== 'off') {
            try {
              const pkgRaw = await actuator.readFile(workspaceId, 'package.json').catch(() => '');
              const card = projectContractCard({
                symbols: getWorkspaceMemory(workspaceId).graph().symbols,
                declaredPackages: declaredPackagesFromPackageJson(pkgRaw),
              });
              if (card) architectSystem = `${card}\n\n---\n\n${architectSystem}`;
            } catch { /* the contract card is best-effort — never blocks a build */ }
          }
          // ARCHITECTURE INVARIANTS (Mission 10/10 Phase 1) — the PREVENT half. The contract card above
          // answers "which module owns this symbol"; this answers the question that decides whether an
          // app stays one app: "how is THIS project built?" Styling system, import style, where network
          // calls go, where pages live — all READ OUT OF the project, never a house style of ours.
          //
          // Derived from the warm graph only (paths + import specifiers + dependencies), so it costs no
          // file reads at all. The post-build check below sees file CONTENTS as well and can therefore
          // observe one rule more; deriving with less input only ever yields FEWER rules, never
          // different ones. Kill switch AGENTV3_ARCH_INVARIANTS=off.
          if (process.env.AGENTV3_ARCH_INVARIANTS !== 'off') {
            try {
              const g = getWorkspaceMemory(workspaceId).graph();
              const block = renderInvariants(deriveInvariants({
                files: g.files, imports: g.imports, dependencies: g.dependencies,
              }));
              if (block) architectSystem = `${block}\n\n---\n\n${architectSystem}`;
            } catch { /* architecture invariants are best-effort — never block a build */ }
          }
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
            // WHERE THE GROUNDING TOKENS WENT (admin 2026-08-11). Recorded on EVERY build, not only
            // when something is dropped: the number nobody looks at is the number that grows, and
            // "tokens ARE the bill" was learned the expensive way (776k input tokens to change 3
            // files). A dominant single block is the #2260 shape generalised — reported by SHAPE, so
            // it also catches the oversized file nobody thought to exclude.
            const cost = lastGroundingCost();
            if (cost) {
              const dominant = dominantGroundingBlock(cost);
              buildDiag.record({
                phase: 'plan', severity: dominant || cost.dropped.length > 0 ? 'warning' : 'info',
                code: 'GROUNDING_COST',
                message: groundingProvenance(cost),
                detail: dominant ? `One file is most of the preamble: ${dominant}` : undefined,
                autoResolved: true,
              });
            }
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
      // The mandatory readiness gate audits code v5.0 BUILT — it must NOT judge a freshly-imported
      // existing app (its pre-existing hardcoded keys / SQL patterns are the user's, not this build's,
      // and surfacing "NOT READY 0/100" on their working production app is wrong + alarming).
      const runReadinessGate = readinessGateEnabled() && !isImportTurn;
      // U-1 — LintGate follows the same top-level-only / not-on-import scoping as the readiness gate,
      // but is OFF unless the admin opts in (AGENTV3_LINT_GATE=on). Default OFF → builds are unchanged.
      const runLintGate = lintGateEnabled() && !isImportTurn;
      // SYSTEM-PROMPT CACHE-PREFIX (perf/cost audit 2026-07-18, opt-in AGENTV3_CACHE_PREFIX=on, default OFF):
      // the ~12 volatile context blocks above were prepended to the HEAD of the static architect prompt,
      // so the daily/per-request-changing head busted the Anthropic cache for the whole ~46KB static body
      // every build. When enabled, split that volatile prefix back OUT of the cached system block and move
      // it into the per-turn USER message (applied at buildPrompt init below) — the model sees identical
      // content, only relocated, so quality is unchanged, but the large static body becomes a stable cache
      // prefix (cache reads ≈ 0.1× input rate). Ships DORMANT: flag off = byte-for-byte today's behaviour.
      let cachePrefixPreamble = '';
      if (envFlag('AGENTV3_CACHE_PREFIX')) {
        const split = splitCachedSystem(architectSystem, staticArchitectSystem);
        architectSystem = split.system;
        cachePrefixPreamble = split.preamble;
      }
      const baseRunnerOpts = {
        dispatcher,
        state,
        events,
        // AP-4 (flag-gated, default off): let frontend/backend WRITER sub-agents dispatch in parallel.
        // Paired with the lockedActuator write-lock above, so concurrent same-path writes can't clobber.
        parallelBuild,
        // Billing accounting fix: the ONE build-level sink, shared by the main runner and every
        // runner that spreads baseRunnerOpts (escalation/retry/heal/fix/critFix) so all their tokens
        // are billed even when their `result` is later discarded.
        usageSink: buildUsage,
        system: architectSystem,
        tools: catalogForTools(roleConfig('architect').tools),
        onlyOpus,
        powerLevel: powerLevelReqEffective,
        // Slice 2 — weak-tier mid-build checkpoint scope. Same signal Slice 1 uses: a weak/cheap-only
        // build (no Claude). Inert unless AGENTV3_WEAK_CHECKPOINT=on; non-weak builds never run it.
        weakBuild: noClaudeBuild,
        effort: powerSpecResolved.effort,
        thinking,
        maxBudgetUsd: maxBudgetUsdForRunner,
        maxSteps,
        toolConcurrency,
        // Full Team mid-build steering (Fix 60): ONLY the 'max' tier drains the /steer queue — the
        // premium capability is tier-gated at BOTH ends (the route refuses non-max queues; the runner
        // simply has no poll elsewhere). Spread into every top-level/heal runner via baseRunnerOpts,
        // so the team keeps listening through repair phases too.
        ...(steerAllowedForBuild(powerLevelReqEffective)
          ? { steerPoll: () => (rb.steerQueue && rb.steerQueue.length ? rb.steerQueue.splice(0, rb.steerQueue.length) : []) }
          : {}),
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
        // U-1 — opt-in lint gate (default OFF); blocks a finished build on real ESLint errors when enabled.
        lintGate: runLintGate,
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

      // Phase B — Checkpoint Loop: early validation + graceful degradation
      // (intelligent scoping): create a checkpoint monitor with feature priorities
      // from the request analyser. Monitors build health every N tool calls.
      const checkpoint = new BuildCheckpoint(state);
      const checkpointListener = (event: AgentEvent) => {
        try {
          if (event.type === 'tool_call') {
            // After each tool call, check if it's time for a checkpoint
            if (checkpoint.recordToolCall()) {
              // Checkpoint triggered — run the deterministic health check. This NEVER drops
              // requested features or tells the build to stop (TaskForge autopsy 2026-07-18);
              // the genuine "too big for one turn" case is owned by the step-limit auto-resume.
              const health = checkpoint.quickCheck(events);
              if (!health.ok && health.broken) {
                events.emit({
                  type: 'narration', agent: 'architect',
                  text: '⚠️ Build health check detected issues — preparing recovery…',
                  ts: Date.now(),
                });
              }
            }
          }
        } catch { /* checkpoint monitoring is best-effort — never blocks */ }
      };
      // Wire the checkpoint listener into the event stream (best-effort).
      // Subscribe with replay=false since we only care about future events in the build.
      try {
        events.subscribe(checkpointListener, false);
      } catch { /* checkpoint listener is best-effort — never blocks a build */ }

      let buildPrompt = prompt;
      // Cache-prefix mode (see above): the volatile context blocks that were split out of the system
      // prompt ride the user turn instead, so the model still receives every one — just not in the
      // cached system prefix. '' (flag off) leaves buildPrompt exactly as today.
      if (cachePrefixPreamble) buildPrompt = `${cachePrefixPreamble}\n\n---\n\n${buildPrompt}`;

      // Framework-mismatch warning (from the coherence pre-flight above) rides the user turn so the builder
      // reconciles to ONE framework before writing features. Applies to any turn on an incoherent workspace;
      // '' (coherent, or flag off) leaves buildPrompt unchanged.
      if (frameworkCoherenceMsg) buildPrompt = `${frameworkCoherenceMsg}\n\n---\n\n${buildPrompt}`;

      // REQUIREMENT-AWARE BUILD (admin-approved option A, 2026-07-20; flag AGENTV3_REQUIREMENT_AWARE, default
      // OFF): on a FRESH build of an ambiguous domain prompt, proactively tell the builder to INCLUDE the
      // features that domain almost always needs but the prompt left implicit (RBAC/audit/EMR for a hospital,
      // …) — so a rich request never gets a shallow app. FRICTION-FREE: NO clarifying round-trip (the admin's
      // "text reply > build app" rule) — the build just comes out richer. Only fires for a new build (never an
      // edit) of a detected domain with genuinely-missing features; a clear/generic prompt yields '' guidance,
      // and with the flag off this whole block is inert, leaving buildPrompt byte-identical to today.
      if (requirementAwareBuildEnabled() && intent === 'new_build' && !isEditMode) {
        try {
          const reqGuidance = buildRequirementGuidance(analyzeRequirementGaps(prompt));
          if (reqGuidance) buildPrompt = `${reqGuidance}\n\n---\n\n${buildPrompt}`;
        } catch { /* requirement guidance is best-effort — never affect the build */ }
      }

      // ASK-USER clarify (opt-in, friction-free resolution of the admin's #1 category). On a FRESH domain
      // build, surface the clarifications the engine ALREADY assumed sensible defaults for as a NON-BLOCKING,
      // dismissible card — the build proceeds immediately (it NEVER waits for an answer, honouring the
      // "text reply > build app" rule), and the user can adjust any assumption via a normal follow-up. Only
      // fires for a new build of a detected domain with real askable gaps. Flag-gated OFF (AGENTV3_ASK_USER):
      // when unset the emit never happens, so the stream is byte-identical to today. Best-effort.
      if (envFlag('AGENTV3_ASK_USER') && intent === 'new_build' && !isEditMode) {
        try {
          const g = analyzeRequirementGaps(prompt);
          if (shouldSurfaceRequirementGaps(g) && g.clarifyingQuestions.length > 0) {
            emit({ type: 'clarify', domain: g.domain, questions: g.clarifyingQuestions.slice(0, 3), ts: Date.now() });
          }
        } catch { /* clarify is best-effort — never affects the build */ }
      }

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

      // KNOWN-MISTAKE GUARD (admin ask 2026-08-06: "ek baar wali galti wapas repeat na ho").
      //
      // The recall above matches lessons against the user's PROMPT. A lesson is about a MISTAKE, and a
      // prompt is about a WISH — "green dot hatao" shares no words with "the dev server bound its port
      // before wiring page routes", so the lesson that would prevent the repeat could never surface.
      // This lookup is keyed by the ERROR SIGNATURES this project has actually hit, so a proven fix is
      // recalled by IDENTITY rather than by similarity, and cannot be missed because the wording
      // differs. '' when nothing matches ⇒ a project with no such history is byte-identical to today.
      let mistakeGuardSigs: string[] = [];
      try {
        const pastErrors = getWorkspaceMemory(workspaceId).snapshot().episodes
          .filter((e) => e.kind === 'error')
          .slice(-25)
          .map((e) => e.text);
        const detail = await mistakeLedgerStore.guardDetailFor(userId, pastErrors);
        let guardSource: 'personal' | 'fleet' | null = null;
        if (detail.text) {
          buildPrompt = `${detail.text}\n\n---\n\n${buildPrompt}`;
          mistakeGuardSigs = detail.signatures;
          guardSource = 'personal';
        } else if (pastErrors.length > 0) {
          // FLEET FALLBACK: the fleet may hold a proven fix the user has never personally earned
          // (anonymous by construction — signature keys, sanitized text, no identity stored).
          const fleet = await fleetMistakeLedgerStore.guardDetailFor(pastErrors);
          if (fleet.text) {
            buildPrompt = `${fleet.text}\n\n---\n\n${buildPrompt}`;
            mistakeGuardSigs = fleet.signatures;
            guardSource = 'fleet';
          }
        }
        // The guard is VISIBLE in the admin report from the moment it fires, with the ledger's live
        // repeat rate — so "is the learning system working?" is answered by every report, by number.
        if (guardSource) {
          const s = detail.stats;
          buildDiag.record({
            phase: 'build', severity: 'info', code: 'MISTAKE_GUARD', autoResolved: false,
            message: `Known-mistake guard active (${guardSource}): ${mistakeGuardSigs.length} proven fix(es) recalled by error signature${
              s ? `. Personal ledger: ${s.solved}/${s.total} solved, repeat rate ${Math.round(s.repeatRate * 100)}%` : ''}.`,
          });
        }
      } catch { /* the guard is best-effort — never blocks a build */ }

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
        // Phase 6.1: the instruction now states its own CONFIDENCE. A distinctive script is proof and
        // is asserted plainly; a romanized guess ("enakku … venum") says it is a guess and tells the
        // model to follow the user's actual words if it is wrong — overstating a guess is how a
        // mis-detection becomes an entire app the user cannot read.
        const langInstruction = hint
          ? languageInstruction({ code: hint.code, name: hint.name, evidence: hint.evidence ?? 'script' })
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
        // OPUS TIERS (Model Routing Policy, admin 2026-07-12): "power mode = sab kuch Opus" — the
        // plan phase too. On Powerful/Full Team we do NOT route planning to Grok; `planGrok = null`
        // falls the plan runner to the normal build `client` + `model`, which there is Opus.
        // Strong ('mini' → Sonnet 100%, admin 2026-07-13) plans on Grok like Normal — planning on
        // Opus for a Sonnet-pinned tier would be exactly the cross-tier call the admin forbade.
        const planGrok = pinnedOpus ? null : grokPlanRunner({ noClaude: noClaudeBuild });
        const planRunner = new AgentRunner({
          client: planGrok ?? client,
          dispatcher: new ToolDispatcher(actuator, workspaceId, state, events),
          state,
          events,
          usageSink: buildUsage, // billing accounting fix — the plan step's tokens are billed too
          model: planGrok ? haikuModel() : model,
          system: planSystemPrompt(),
          tools: catalogForTools(['update_todo']),
          onlyOpus,
          powerLevel: powerLevelReqEffective,
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
      // markup as every other v5.0 call).
      let projectPlanRef: ProjectPlan | null = null;
      let projectModuleRef: ProjectModule | null = null;
      if (projectModeEnabled(process.env, { userId, email }) && !planFirst) {
        try {
          let pPlan = await loadProjectPlan(workspaceId);
          const planPreExisted = !!pPlan;
          // A single bounded plan-generation LLM call (used by BOTH the initial decomposition and the
          // GA-7 live-replan below). Cheap-floor-first like every other build text call; hard 60s
          // timeout so a planner call can NEVER hang the build.
          const ppGenerate = async (system: string, user: string): Promise<string> => {
            const startedAt = Date.now();
            let ppProvider = 'CLAUDE';
            const call = makeFastTextRunner((used) => { ppProvider = used; }).runTurn({
              model: fastBuildModel(), system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8000,
            });
            const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('project planner timed out')), 60_000));
            const t = await Promise.race([call, timeout]);
            try {
              const lbl = fastLaneProviderLabel(ppProvider);
              buildDiag.recordLlmCall({ model: lbl === 'anthropic' ? fastBuildModel() : ppProvider.toLowerCase(), provider: lbl, promptPreview: `${system}\n---\n${user}`, promptChars: system.length + user.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true });
            } catch { /* diagnostics best-effort */ }
            blueprintUsage.inputTokens += t.usage.inputTokens;
            blueprintUsage.outputTokens += t.usage.outputTokens;
            buildUsage.add({ inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens });
            return t.text;
          };
          if (!pPlan && intent === 'new_build' && !isEditMode && detectMegaProject(prompt)) {
            events.emit({ type: 'narration', agent: 'architect', text: '🏗️ This is a large software project — decomposing it into independently-buildable modules with frozen interface contracts…', ts: Date.now() });
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
            // GA-7 — Project Coordinator: before scheduling, run the deterministic coordinator to break
            // a blocking dependency cycle and arbitrate file-ownership conflicts, and (only when a
            // module has repeatedly failed and the plan still can't advance) ask the model for a revised
            // plan. Additive + best-effort: any failure leaves pPlan exactly as it was.
            try {
              const act = coordinateBeforeTurn(pPlan);
              if (act.plan !== pPlan) {
                pPlan = act.plan;
                await saveProjectPlan(workspaceId, pPlan);
              }
              for (const note of act.notes) {
                events.emit({ type: 'narration', agent: 'architect', text: `🧭 Coordinator: ${note}`, ts: Date.now() });
              }
              if (act.kind === 'needs-llm-replan') {
                const stuck = pPlan.modules.find((m) => m.status !== 'done' && (m.attempts ?? 0) >= LLM_REPLAN_THRESHOLD);
                if (stuck) {
                  const revised = parsePlannedModules(await ppGenerate(replanSystemPrompt(framework), replanUserPrompt(pPlan, stuck.id)));
                  const replanned = applyReplan(pPlan, revised);
                  if (replanned !== pPlan) {
                    pPlan = replanned;
                    await saveProjectPlan(workspaceId, pPlan);
                    events.emit({ type: 'narration', agent: 'architect', text: `🧭 Coordinator revised the plan around the stuck module "${stuck.name}" — resuming.`, ts: Date.now() });
                  }
                }
              }
            } catch { /* coordinator is additive — on ANY failure the plan proceeds unchanged */ }
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
              // GA-7 — surface the coordinator digest (milestone progress + current role) alongside the
              // plain progress line, closing the previously built-but-unwired coordinatorDigest export.
              const digest = coordinatorDigest(pPlan);
              events.emit({ type: 'narration', agent: 'architect', text: `🧩 ${planProgressLine(pPlan)}${digest ? ` · ${digest}` : ''}`, ts: Date.now() });
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
      let deliveredTier: StartTier = analysis?.startTier ?? (pinnedOpus ? 'opus' : onlyOpus ? 'sonnet' : 'gemini');
      // T1-escalation-on — how many ladder escalations this build actually performed (0 = first tier
      // delivered). Set by the escalation lane below; feeds the canary-measurement telemetry.
      let escalationsCount = 0;
      // True once the fast lane (SimpleBuilder / OneShot) produced the result — that path already runs
      // its own tsc verify-gate + repair, so the post-agentic tsc gate below skips it (no redundant run).
      let fastLaneGated = false;

      // ── GOLDEN SCAFFOLD PRE-SEED (admin 2026-08-02: "starter-template apps must build instantly & correctly") ──
      // When a NEW build's prompt is EXACTLY one of the simple starter-template chip prompts, pre-seed the
      // workspace with NavBharatAI's hand-verified golden scaffold for that app — CI-proven to parse under
      // esbuild AND compile under the in-browser Babel preview, with zero duplicate imports. The builder then
      // VERIFIES & CUSTOMIZES instead of writing from scratch: first build correct by construction (the 50/50
      // law's PREVENT half — the weak tier stops generating the very bug classes we keep healing). Fresh
      // builds only (never clobbers an existing app); an EDITED chip prompt never matches (no surprise
      // template). Best-effort: any failure just falls through to a normal from-scratch build. Kill switch
      // AGENTV3_GOLDEN_SCAFFOLD=off.
      let goldenPreseeded = false;
      if (process.env.AGENTV3_GOLDEN_SCAFFOLD !== 'off' && intent === 'new_build' && !projectModuleRef && !isImportTurn) {
        try {
          const golden = goldenScaffoldForPrompt(prompt);
          if (golden) {
            const existingSrc = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))
              .filter((p) => p.startsWith('src/'));
            if (existingSrc.length === 0) {
              const goldenFiles = goldenScaffoldFiles(golden);
              for (const [gp, gc] of Object.entries(goldenFiles)) {
                await actuator.writeFile(workspaceId, gp, gc);
                writtenFiles.set(gp, gc);
                try { getWorkspaceMemory(workspaceId).indexFile(gp, gc); } catch { /* index best-effort */ }
              }
              await saveWorkspaceFiles(workspaceId, goldenFiles).catch(() => {});
              goldenPreseeded = true;
              buildDiag.record({ phase: 'build', severity: 'info', code: 'GOLDEN_SCAFFOLD', message: `Pre-seeded the tested "${golden.label}" template (${Object.keys(goldenFiles).length} files) — the builder verifies & customizes instead of writing from scratch.`, autoResolved: true });
              emit({ type: 'narration', agent: 'architect', text: `⚡ Starting from NavBharatAI's tested "${golden.label}" app template — verifying and customizing it for you.`, ts: Date.now() });
              // HANDOFF FRAMING (same discipline as the fast-lane salvage below): the builder must treat the
              // scaffold as ITS OWN work to verify — never alien clutter to re-plan or rewrite.
              //
              // TIER-AWARE, and this distinction is load-bearing. A SIMPLE scaffold IS the finished app, so
              // "polish and finish" is the truth. A PRO scaffold is a compile-proven ARCHITECTURE covering
              // part of a much larger request ("…activity history, tasks, and a dashboard of pipeline
              // value") — telling the builder it "fully implements the request" would make it ship a
              // skeleton and declare success, which is exactly the fake-completion the real-features rule
              // forbids. So pro gets an EXTEND instruction instead of a FINISH one.
              buildPrompt = golden.tier === 'pro'
                ? `[EXTEND THIS WORKING FOUNDATION — DO NOT START OVER] This workspace was just pre-seeded with NavBharatAI's tested "${golden.label}" foundation. ` +
                  `It already compiles and runs: src/lib/ui.tsx holds the shared components (Shell, Card, StatTile, Badge, Button, Field, Select, Modal, Empty), ` +
                  `src/lib/store.ts holds persistent state (useCollection, inr, shortDate), and src/App.tsx has the working screens. ` +
                  `READ all three FIRST. It is a STARTING POINT, not the finished app — BUILD OUT everything the request below asks for that is not there yet, ` +
                  `reusing those existing components and the useCollection pattern rather than inventing a second set. Add new screens as their own files under src/. ` +
                  `Do NOT rewrite what already works, do NOT re-plan a parallel file structure, and NEVER add an import that already exists.\n\n---\n\n${buildPrompt}`
                : `[VERIFY & FINISH — DO NOT START OVER] This workspace was just pre-seeded with NavBharatAI's tested, working "${golden.label}" app template. ` +
                  `It already compiles cleanly and fully implements the request below. READ src/App.tsx first. If the request matches the template (it should — the prompt is the template's own), ` +
                  `make at most SMALL polish edits and finish quickly. Do NOT rewrite it from scratch, do NOT re-plan a parallel file structure, and NEVER add an import that already exists.\n\n---\n\n${buildPrompt}`;
            }
          }
        } catch { /* pre-seed is best-effort — a failure just builds from scratch */ }
      }

      // ── ONE-SHOT FAST LANE (additive, flag-gated; the agentic loop is untouched) ──
      // For a SIMPLE new-build app, try ONE cheap generation call first (no Architect, no
      // sub-agents, no per-file round-trips, no Opus, no rebuild loop). On success the build is
      // done. On ANY failure (no usable files / model error) it falls through to the agentic loop
      // below — the safety net — so behavior is NEVER worse than today. AGENTV3_ONESHOT=off disables.
      // Project mode (SPM-2): a module turn always runs the agentic loop — the fast lane's isolated
      // per-file generation has no tool loop to honor the module's frozen contracts and file scope.
      // COMPLETE-APP LANE (admin 2026-07-06): sonnet-tier NEW builds now take this deterministic
      // manifest-driven lane FIRST too (classifyForSimpleLane) — the free-form multi-agent loop churned
      // on real builds (98 steps/10min, 148 steps/29min, both died incomplete) while this lane plans the
      // COMPLETE file list up front, builds every file on Sonnet, and tsc-verifies. The agentic loop
      // remains the automatic fallback below when this lane fails — never worse than before.
      // PAID PINNED tiers skip the fast lane (admin fidelity rule 2026-07-13): the lane's per-file
      // generator leads with the cheap floor and runs fastBuildModel — neither is the tier's pinned
      // model. mini/medium/max take the agentic loop on their exact model instead. (Before the 'mini'
      // redefinition this was implicit — the analyzer's 'opus' start tier failed classifyForSimpleLane;
      // 'mini' now resolves to the 'sonnet' start tier, which the lane WOULD accept, so the guard is
      // explicit.)
      // `!goldenPreseeded`: a pre-seeded golden app skips the fast lane — regenerating from scratch would
      // discard the verified template; the agentic loop verifies & customizes the seeded files instead.
      if (!goldenPreseeded && oneShotEnabled() && intent === 'new_build' && !onlyOpus && classifyForSimpleLane(analysis?.startTier) && !projectModuleRef && !isImportTurn) {
        // Usage ACCUMULATES across every cheap call (manifest + each per-file call), so billing is honest.
        const osUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        const scaffold = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))
          .filter((p) => !/^(node_modules|\.git)\//.test(p)).slice(0, 80);
        // Shared side-effects for both fast lanes (Simple Builder + OneShot).
        // ONE fast-lane model round trip. Returns the provider's stop reason alongside the text so the
        // continuation wrapper below can tell "the model finished" from "the model ran out of budget"
        // — a distinction the lane previously threw away, which is how a truncated app shipped as done.
        const fastGenerateOnce = async (system: string, user: string): Promise<{ text: string; stopReason: string | null }> => {
          // #2 — capture this fast-lane model call's I/O into the diagnosis bundle. The fast lane
          // (Simple Builder / OneShot) does NOT go through AgentRunner, so its model calls were a
          // blind spot — a truncated (max_tokens) per-file generation is exactly what produces broken
          // code. Now every manifest / per-file / repair call is recorded (success AND failure).
          const fbModel = fastBuildModel();
          const promptPreview = `${system}\n---\n${user}`;
          const startedAt = Date.now();
          // The FAST lane now leads with the cheap floor (GLM/Kimi) exactly like the agentic chain —
          // no hardcoded "direct Sonnet" path (admin 2026-07-11). `usedProvider` captures who ACTUALLY
          // delivered this per-file call so the build report records the truth, not a fixed 'anthropic'.
          // Claude is always the backstop inside the chain, so a floor miss falls back to Sonnet.
          let usedProvider = 'CLAUDE';
          const runner = makeFastTextRunner((used) => { usedProvider = used; });
          let t;
          try {
            // RESILIENT (admin 2026-07-07, "jab sab fail ho jaye to last me gemini/vertex"): the lane's
            // calls are TEXT-ONLY (tools: []), so the multi-provider fallback (cheap floor → Claude →
            // Vertex → Gemini) is safe here — no tool-use hallucination risk — and it keeps the complete-
            // app lane alive when a provider is down/out of credits.
            // Fix 31 (admin: "Thinking button nonfunctional"): the fast lane is the DEFAULT complete-app
            // path, and it silently DROPPED the user's Thinking toggle — thinking worked only on the
            // agentic/edit lanes. Pass it through (ClaudeClient gates by model capability, so a Haiku/
            // fallback tier degrades gracefully) and stream the live reasoning summary into the build
            // feed so the toggle has a real, visible effect on every lane.
            const fastTurnId = randomUUID();
            t = await runner.runTurn({
              // The requested model is the CLAUDE-tier model (fbModel = Sonnet); GLM/Kimi ignore it and
              // force their own ladder, so this is the model billed/recorded only when Claude delivers.
              model: fbModel, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8000,
              thinking,
              onThinking: (delta: string) =>
                events.emit({ type: 'stream_delta', agent: 'architect', id: fastTurnId, kind: 'thinking', delta, ts: Date.now() }),
            });
          } catch (err) {
            try { buildDiag.recordLlmCall({ model: fbModel, provider: fastLaneProviderLabel(usedProvider), promptPreview, promptChars: promptPreview.length, responsePreview: '', responseChars: 0, finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startedAt, ok: false, error: err instanceof Error ? err.message : String(err) }); } catch { /* diagnostics best-effort */ }
            throw err;
          }
          const provLabel = fastLaneProviderLabel(usedProvider);
          try { buildDiag.recordLlmCall({ model: provLabel === 'anthropic' ? fbModel : usedProvider.toLowerCase(), provider: provLabel, promptPreview, promptChars: promptPreview.length, responsePreview: t.text, responseChars: t.text.length, finishReason: t.stopReason, toolCalls: t.toolUses.length, inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens, latencyMs: Date.now() - startedAt, ok: true }); } catch { /* diagnostics best-effort */ }
          osUsage.inputTokens += t.usage.inputTokens;
          osUsage.outputTokens += t.usage.outputTokens;
          osUsage.cacheCreationInputTokens += t.usage.cacheCreationInputTokens ?? 0;
          osUsage.cacheReadInputTokens += t.usage.cacheReadInputTokens ?? 0;
          // Billing accounting fix: the fast lane does not use AgentRunner, so feed the build-level
          // sink directly here (mirrors AgentRunner's own sink write).
          buildUsage.add({ inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens });
          // REAL-cost billing (Fix 65): attribute this fast-lane call to the provider/model that ACTUALLY
          // delivered, so a cheap GLM/Kimi fast-lane build is priced at the cheap rate — not swept into
          // the Sonnet-rate "unattributed remainder". Mirrors the agentic chain's onTurnComplete.
          captureTurnUsage(usedProvider, { inputTokens: t.usage.inputTokens, outputTokens: t.usage.outputTokens }, t.model, t.usage.cacheReadInputTokens ?? 0);
          return { text: t.text, stopReason: t.stopReason ?? null };
        };
        // TRUNCATION CONTINUATION (admin report 858f6d7b). Every fast-lane generation now runs to
        // COMPLETION instead of silently stopping at the provider's output ceiling. Previously a
        // `finish=max_tokens` response was accepted as final: the one-shot call was cut off before it
        // emitted `src/main.tsx`, the healer synthesized a generic replacement, and that file's import
        // is what the user's preview then failed on — plus ~16k of 33k billed output tokens were spent
        // on text we discarded. Continuing is provider-cap-agnostic (raising max_tokens only moves the
        // ceiling and can 400 on a provider whose real cap is lower), bounded to MAX_CONTINUATIONS, and
        // a continuation that FAILS never loses the work already produced — we keep what we have.
        const fastGenerate = async (system: string, user: string): Promise<string> => {
          const first = await fastGenerateOnce(system, user);
          let text = first.text;
          let stopReason = first.stopReason;
          let attempts = 0;
          while (shouldContinue(stopReason, attempts)) {
            attempts += 1;
            events.emit({ type: 'narration', agent: 'architect', text: `✍️ That file list was longer than one response allows — continuing it (${attempts}/${MAX_CONTINUATIONS}) so nothing is left half-written…`, ts: Date.now() });
            let next: { text: string; stopReason: string | null };
            try {
              next = await fastGenerateOnce(system, continuationPrompt(text));
            } catch (err) {
              // A failed continuation must never discard the complete files we already have.
              buildDiag.record({ phase: 'build', severity: 'warning', code: 'FASTLANE_CONTINUATION_FAILED', message: `A continuation of a truncated generation failed after ${attempts - 1} successful continuation(s) — keeping the files produced so far.`, autoResolved: false, detail: err instanceof Error ? err.message : String(err) });
              break;
            }
            text = joinContinuation(text, next.text);
            stopReason = next.stopReason;
          }
          if (attempts > 0) {
            buildDiag.record({ phase: 'build', severity: 'info', code: 'FASTLANE_CONTINUED', message: `A generation hit the output-token ceiling and was continued ${attempts} time(s) so no file was left half-written.`, autoResolved: true, detail: `finalStopReason=${stopReason ?? 'unknown'}` });
          }
          // LAST LINE OF DEFENCE: continuations exhausted and the model is STILL mid-file. parseFileBlocks
          // deliberately accepts a final unterminated block (so a missing ENDFILE cannot swallow the next
          // file), which means a half-written file is indistinguishable from a complete one downstream —
          // it would be written to the workspace and shipped as built. Drop it and say so, honestly.
          const halfWritten = isTruncatedStop(stopReason) ? unterminatedTailPath(text) : null;
          if (halfWritten) {
            const cut = text.lastIndexOf('<<<FILE');
            if (cut > 0) text = text.slice(0, cut);
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'FASTLANE_TRUNCATED_FILE_DROPPED', message: `${halfWritten} was still being written when the output limit was reached after ${MAX_CONTINUATIONS} continuations — it was DISCARDED rather than saved half-finished.`, autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `⚠️ ${halfWritten} was cut off mid-write, so I discarded the partial file rather than saving a broken one — I'll rebuild it.`, ts: Date.now() });
          }
          return text;
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
          // FOUNDATION GUARANTEE (deep-test Level-1, build 7c56b35a): the file-list planner can OMIT the
          // foundational files a vite-react app needs to install & boot — most damagingly `package.json`.
          // When it does, the `fast-install` below fails `ENOENT … package.json` (exit -1), the missing-
          // dependency reconcile (`npm install <pkgs>`) then fails 254 (no package.json to install INTO),
          // and `npm run dev` never starts → the whole build degrades to BUILD_PARTIAL with the type-check
          // unable to run. Root-cause fix: before ANY install, synthesize the foundational files that are
          // ABSENT (package.json with deps derived from the code's REAL imports, index.html, an entry,
          // vite.config, tsconfig) — never overwriting a generated OR on-disk-scaffolded file. Covers both
          // fast-lane builders (SimpleBuilder + OneShot) since both funnel through fastPreview.
          // Deterministic + unit-tested (FrameworkFoundation.ts). Kill switch: AGENTV3_FOUNDATION_GUARD=off.
          if (process.env.AGENTV3_FOUNDATION_GUARD !== 'off') {
            try {
              const foundation = ensureViteReactFoundation(Object.fromEntries(writtenFiles), { framework, existingPaths: scaffold });
              if (foundation.added.length > 0) {
                fastLog(`🩹 Added ${foundation.added.length} missing foundational file(s) so the app can install & boot: ${foundation.added.join(', ')}`);
                // Route through write_file so each lands in the sandbox AND is recorded in writtenFiles
                // (the durable store + the reconcile scan below both then see the new package.json).
                await mapWithConcurrency(Object.entries(foundation.files), 4, ([p, c], i) =>
                  dispatcher.dispatch({ id: `fast-foundation-${i}`, name: 'write_file', input: { path: p, content: c } }, 'frontend'),
                );
              }
            } catch { /* best-effort — a failure here just falls through to the install exactly as before */ }
          }
          // TSCONFIG EXTENDS SANITIZER (autopsy buildId 9245f090): a generated tsconfig can `extends` a
          // bare package that isn't installed (e.g. the phantom "@tsconfig/react") — Vite then dies at
          // startup with TSConfckParseError and the dev server never comes up. Strip the dangling extends
          // (deterministic + safe — a Vite-React tsconfig is self-contained) BEFORE the install/dev server.
          // Kill switch: AGENTV3_TSCONFIG_SANITIZE=off.
          if (process.env.AGENTV3_TSCONFIG_SANITIZE !== 'off') {
            try {
              const ts = sanitizeTsconfigExtends(Object.fromEntries(writtenFiles));
              if (ts.fixes.length > 0) {
                fastLog(`🩹 Repaired ${ts.fixes.length} tsconfig file(s) that extended an uninstalled base so the dev server can start: ${ts.fixes.map((f) => f.file).join(', ')}`);
                try { buildDiag.record({ phase: 'build', severity: 'info', code: 'TSCONFIG_EXTENDS_REPAIRED', message: `Removed an unresolvable tsconfig extends: ${ts.fixes.map((f) => `${f.file} (${f.removed.join(', ')})`).join('; ')}`.slice(0, 400), autoResolved: true }); } catch { /* diagnostics best-effort */ }
                await mapWithConcurrency(Object.entries(ts.patch), 4, ([p, c], i) =>
                  dispatcher.dispatch({ id: `fast-tsconfig-${i}`, name: 'write_file', input: { path: p, content: c } }, 'frontend'),
                );
              }
            } catch { /* best-effort — a bad tsconfig extends just falls through to the install as before */ }
          }
          // ALWAYS run a real install — a build that just (re)wrote package.json MUST have its FULL
          // dependency tree installed. The old `… else echo "deps present"` skip trusted a pre-baked/
          // partial node_modules (the E2B base image ships one), which left a transitive babel/
          // browserslist dep (caniuse-lite/dist/unpacker/agents) missing → the dev server "came up" but
          // crashed every transform with "[plugin:vite:react-babel] Cannot find module 'caniuse-lite/…'"
          // (build report 2026-07-06). `npm install` is idempotent + fast when already satisfied, so
          // always reconciling is correct and cheap — it also covers the earlier "Cannot find module
          // 'tailwindcss'" case the skip caused. (buildBuildInstallCommand: pure, unit-tested.)
          await dispatcher.dispatch({ id: 'fast-install', name: 'bash', input: { command: buildBuildInstallCommand() } }, 'frontend');
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
              // `|| … --legacy-peer-deps` retries only if the strict install hits an ERESOLVE peer
              // conflict (EventHive autopsy) — the automated install is then as forgiving as the agent's.
              await dispatcher.dispatch({ id: 'fast-reconcile', name: 'bash', input: { command: `npm install --no-audit --no-fund ${missing.join(' ')} || npm install --no-audit --no-fund --legacy-peer-deps ${missing.join(' ')}` } }, 'frontend');
            }
          } catch { /* reconcile is best-effort — a failure just falls back to the plain install above */ }
          await dispatcher.dispatch({ id: 'fast-dev', name: 'bash', input: { command: 'npm run dev' } }, 'frontend');
          await dispatcher.dispatch({ id: 'fast-preview', name: 'update_preview', input: { port: oneShotDevPort(framework) } }, 'frontend');
        };
        // A — real compile check: install deps (idempotent) then type-check. tsc surfaces the exact
        // contract mismatch (e.g. a hook that doesn't return what a component destructures) that
        // separate per-file generation can produce. `|| true` keeps a clean run at exit 0; a real
        // type error is detected by the "error TSxxxx" marker. A throw → "couldn't verify" (non-blocking).
        // ONE bounded retry when the whole verify pipeline THROWS (a transient sandbox hiccup — the
        // command channel dropping, a cold E2B reconnect): a second attempt usually succeeds, and a
        // type-check that RUNS beats an honest-but-unverified ship. Still-failing → ran:false (honest).
        const fastVerify = async (): Promise<import('../AgentV3/SimpleBuilder').VerifyResult> => {
          const attempt = () => fastVerifyOnce();
          try { return await attempt(); }
          catch {
            try { return await attempt(); }
            catch { return { ok: true, errors: '', ran: false }; } // could not verify — say so, never fake a pass
          }
        };
        const fastVerifyOnce = async (): Promise<import('../AgentV3/SimpleBuilder').VerifyResult> => {
          {
            // MISSING-FILES GATE (Fix 38c — Task-Manager report 2026-07-07: App.tsx lazy-imported 10
            // pages that were never written, yet verify said "compiles ✓"). Deterministic + free:
            // every LOCAL module a written file references must exist (in the written set or the
            // scaffold). A gap fails verify with the exact list, so the SAME repair pass CREATES the
            // missing files instead of the build shipping a shell that crashes on first navigation.
            try {
              const writtenMap = Object.fromEntries(writtenFiles);
              const withScaffold: Record<string, string> = { ...Object.fromEntries(scaffold.map((sp) => [sp, ''])), ...writtenMap };
              let unresolved = findUnresolvedLocalImports(withScaffold)
                .filter((u) => writtenMap[u.importedBy] !== undefined); // judge only OUR writes
              // DETERMINISTIC MISPATH AUTO-FIX (deep-test build #1, 2026-07-17): when an unresolved import
              // is a WRONG PATH to a file that ALREADY EXISTS, fix the path ourselves — zero model calls —
              // instead of failing verify and paying the repair→one-shot→full-builder cascade (the trivial
              // one-char path error that cost ~10 min on a throttled build). Only OUR written files with a
              // single unambiguous target are rewritten; truly-missing imports still fail so the repair CREATEs them.
              if (unresolved.some((u) => u.existsAt) && process.env.AGENTV3_IMPORT_PATH_AUTOFIX !== 'off') {
                try {
                  const { files: fixedFiles, fixes } = fixMispathLocalImports(withScaffold);
                  const seen = new Set<string>();
                  const toWrite = fixes
                    .filter((f) => writtenMap[f.importedBy] !== undefined && !seen.has(f.importedBy) && seen.add(f.importedBy))
                    .map((f) => ({ path: f.importedBy, content: fixedFiles[f.importedBy] }));
                  if (toWrite.length > 0) {
                    await fastWrite(toWrite);
                    for (const w of toWrite) { writtenFiles.set(w.path, w.content); withScaffold[w.path] = w.content; }
                    buildDiag.record({ phase: 'build', severity: 'info', code: 'IMPORT_PATH_AUTOFIXED', message: `Auto-fixed ${fixes.length} wrong local import path(s) that pointed at existing files — no rebuild needed.`, autoResolved: true, detail: fixes.map((f) => `${f.importedBy}: "${f.from}" → "${f.to}"`).join('\n') });
                    unresolved = findUnresolvedLocalImports(withScaffold).filter((u) => writtenFiles.get(u.importedBy) !== undefined);
                  }
                } catch { /* auto-fix is best-effort — a failure just falls through to the honest ok:false below */ }
              }
              if (unresolved.length > 0) {
                // A mispath (the file EXISTS at existsAt) must be fixed by correcting the import path,
                // NOT by creating a duplicate file — say so precisely so the repair does the right thing.
                const list = unresolved.slice(0, 12).map((u) => u.existsAt
                  ? `${u.missing} (imported by ${u.importedBy}) — WRONG PATH: this module already exists at ${u.existsAt}; FIX THE IMPORT PATH to point at it (do NOT create a new file)`
                  : `${u.missing} (imported by ${u.importedBy}) — CREATE this file`).join('\n  ');
                const anyMispath = unresolved.some((u) => u.existsAt);
                return { ok: false, errors: `UNRESOLVED IMPORTS — these local modules don't resolve.${anyMispath ? ' Some are WRONG PATHS to files that already exist (fix the path); others must be created.' : ' CREATE each of them fully.'}\n  ${list}${unresolved.length > 12 ? `\n  …and ${unresolved.length - 12} more` : ''}` };
              }
            } catch { /* the missing-files gate is best-effort — tsc below still runs */ }
            // JS/TS SYNTAX GATE (deep-test App #6, 2026-07-13): a truncated/corrupt generated file (e.g. a
            // stray CSS declaration inside JSX) does not PARSE, so the app never compiles — but the sandbox
            // tsc often can't run to catch it (VERIFY_DID_NOT_RUN). esbuild parses IN-PROCESS (immune to
            // that), so a real parse error fails verify HERE with the exact file+message and the SAME repair
            // pass rewrites it — instead of shipping an app that won't compile as "verified".
            try {
              const syntaxErrors = await findSyntaxErrors(Object.fromEntries(writtenFiles));
              if (syntaxErrors.length > 0) {
                return { ok: false, errors: `SYNTAX ERRORS — these generated files do not parse and the app cannot compile. Rewrite each one so it parses cleanly:\n${syntaxRepairInstruction(syntaxErrors)}` };
              }
            } catch { /* the syntax gate is best-effort — tsc below still runs */ }
            // CSS SYNTAX GATE (Fix 38d): tsc never reads CSS — an unclosed block makes postcss/vite
            // reject the whole stylesheet at runtime (the exact "Unclosed block" overlay from the
            // report) while every other check stays green. Deterministic brace balance per css file.
            for (const [cssPath, cssContent] of writtenFiles) {
              if (!/\.css$/i.test(cssPath)) continue;
              const imbalance = cssBraceImbalance(cssContent);
              if (imbalance !== 0) {
                return { ok: false, errors: `CSS SYNTAX ERROR in ${cssPath}: ${Math.abs(imbalance)} ${imbalance > 0 ? 'unclosed' : 'extra closing'} brace(s) — postcss will reject the whole file ("Unclosed block") and the app will render unstyled. Rewrite ${cssPath} with balanced braces.` };
              }
            }
            // Fix 38b — the old command hid a tsc that never ran (`--no-install … || true` → no
            // "error TS" → fake "verified ✓"). The __TSC_CLEAN__ marker prints ONLY when tsc really
            // ran and exited 0; no errors AND no marker now means UNVERIFIED, which fails honestly.
            const r = await actuator.runCommand(workspaceId, `${TSC_ENSURE}; if ${TSC_BIN} --noEmit > /tmp/nb_tsc.log 2>&1; then echo __TSC_CLEAN__; fi; tail -200 /tmp/nb_tsc.log 2>/dev/null || true`);
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
            if (!out.includes('__TSC_CLEAN__')) {
              // The compiler could not EXECUTE — no compile errors AND no clean marker. The common case
              // is a vite-react JS app whose scaffold has no `typescript` dependency, so `npx --no-install
              // tsc` simply isn't there (or npx failed). This is NOT a compile failure.
              //
              // ROOT CAUSE this fixes (deep-test App #1/#2 + the clock re-run, 2026-07-13): returning
              // ok:false here made SimpleBuilder treat "tsc couldn't run" as a BUILD FAILURE → wasteful
              // repair attempts → a per-file→one-shot fallback on EVERY simple JS build (4 min / extra
              // tokens), even though the identical code compiled and rendered perfectly via the one-shot.
              // Report ran:false instead — an HONEST "unverified" (Fix 38b's goal: never a fake
              // "verified ✓") that lets the files SHIP on the fast path, with the REAL gate — the live
              // browser preview-verify — doing the earning. tsc that genuinely RAN and found errors still
              // returns ok:false above (unchanged); only the un-runnable case is downgraded to ran:false.
              return { ok: true, errors: '', ran: false };
            }
            return { ok: true, errors: '', ran: true };
          }
          // NOTE: no catch here on purpose — an infra THROW must reach fastVerify's retry wrapper
          // (one retry, then an honest ran:false), never be silently converted into a pass.
        };
        const fastRepair = async (errors: string, currentFiles: { path: string; content: string }[], contract?: string, strategy?: RepairStrategy): Promise<{ path: string; content: string }[]> => {
          // GA-8: forward the ladder strategy so each attempt's prompt escalates (contract-full →
          // focus-offenders → contract-authority) instead of re-firing the identical repair call.
          const text = await fastGenerate(repairSystemPrompt(framework, strategy), repairUserPrompt(prompt, errors, currentFiles, contract, strategy));
          return parseFileBlocks(text).map((b) => ({ path: b.path, content: b.content }));
        };
        const fastLog = (msg: string) => events.emit({ type: 'narration', agent: 'architect', text: msg, ts: Date.now() });
        const fastResult = (summary: string, steps: number, typecheckRan = true) => {
          result = { ok: true, summary, steps, usage: osUsage, billedUsd: billedAmountUsd({ inputTokens: osUsage.inputTokens, outputTokens: osUsage.outputTokens }, powerLevelReqEffective) };
          deliveredTier = analysis?.startTier ?? 'haiku';
          // Skip the agentic readiness gate ONLY when the fast lane genuinely type-checked. If the
          // sandbox check could not run (typecheckRan=false), the downstream gate stays ON so the app
          // is still audited — never two skipped checks stacked on one infra failure.
          fastLaneGated = typecheckRan;
        };

        // 1) SIMPLE BUILDER (primary) — plan a file manifest, then generate EACH file in its own
        //    focused call. This beats the single-call OneShot's ~8k-token truncation that made
        //    multi-file apps produce "no files" and drop into the slow agentic loop.
        // STREAMING FIRST-PAINT (gated, default OFF). The healed files are final long before the
        // verify+repair loop and the dev-server install/boot (30–155 s) finish. When on, persist them
        // to the durable store NOW (mergeWorkspaceFiles UNIONS paths — never a wipe) so the sandbox-
        // free in-browser preview can render them, then emit file_changed events so the client's
        // filesVersion bumps and the preview re-pulls immediately — the user sees the real app tens of
        // seconds sooner. Best-effort; never blocks or fails the build. Kill: unset AGENTV3_STREAMING_PREVIEW.
        const onFilesReady = envFlag('AGENTV3_STREAMING_PREVIEW')
          ? (files: { path: string; content: string }[]) => {
              const rec = Object.fromEntries(files.map((f) => [f.path, f.content]));
              mergeWorkspaceFiles(workspaceId, rec).catch(() => { /* durable save is best-effort */ });
              for (const f of files) events.emit({ type: 'file_changed', agent: 'architect', change: { path: f.path, kind: 'create' as const }, ts: Date.now() });
            }
          : undefined;
        const sb = await runSimpleBuild({ prompt, framework, scaffoldPaths: scaffold, generate: fastGenerate, writeFiles: fastWrite, startPreview: fastPreview, verify: fastVerify, repair: fastRepair, log: fastLog, onFilesReady, depOrder: process.env.AGENTV3_DEP_ORDER !== 'off', maxRepairs: 3 });
        buildDiag.record({ phase: 'build', severity: 'info', code: sb.ok ? 'SIMPLE_BUILD_SUCCESS' : 'SIMPLE_BUILD_FALLBACK', message: sb.summary, autoResolved: true, detail: sb.reason });
        // OBSERVABILITY (deep-test App #2, 2026-07-13): when the fast lane falls back after a verify
        // failure, record the ACTUAL compiler error text so the report can be mined for the true cause
        // (the tip-calc report showed only "TYPECHECK_FAILED" with no error → the plan↔contract mismatch
        // was un-diagnosable). Warning severity + full message in `detail`; never blocks (the full builder
        // still finishes the app).
        if (!sb.ok && sb.verifyErrors) {
          buildDiag.record({ phase: 'build', severity: 'warning', code: 'SIMPLE_BUILD_VERIFY_ERROR', message: `Fast-lane verify failed: ${sb.verifyErrors.split('\n')[0].slice(0, 200)}`, autoResolved: true, detail: sb.verifyErrors });
        }
        // Deterministic end-state classification (BUILD_SUCCESS / TYPECHECK_FAILED / BUILD_PARTIAL / …)
        // recorded into the build report so dashboards/retry policy can branch on the exact outcome.
        // A fast-lane FALLBACK (`!sb.ok` — timed out / verify-failed) is a HANDOFF to the full builder,
        // NOT a terminal build outcome. Recording it as `OUTCOME_BUILD_FAILED` made a mid-build snapshot
        // or a cut/partial report show a FALSE "BUILD_FAILED" rootCause while the full builder was still
        // successfully finishing the app (CollabDesk/SvelteKit autopsy 2026-07-19: a 48-file build that
        // progressed fine for 10+ more min after the fast-lane timeout carried a stale "BUILD_FAILED"
        // rootCause because the report was captured before the full builder emitted its own outcome).
        // Only a SUCCESSFUL fast lane is terminal (the app is done); a fallback's outcome is informational
        // (SIMPLE_BUILD_FALLBACK already frames the handoff) and must NOT feed deriveRootCause.
        if (sb.outcome) {
          buildDiag.record(sb.ok
            ? { phase: 'build', severity: 'info', code: `OUTCOME_${sb.outcome}`, message: `Build outcome: ${sb.outcome}`, autoResolved: true }
            : { phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_OUTCOME', message: `Fast-lane outcome (handed off to the full builder): ${sb.outcome}`, autoResolved: true });
        }
        // HANDOFF FRAMING (StudySync root cause, 2026-07-16): when the fast lane timed out but SALVAGED
        // its finished files into the workspace, the full builder must treat them as ITS OWN prior work
        // to complete — not alien clutter to re-plan around or delete. Without this framing the full
        // builder rebuilt a PARALLEL module tree (src/utils + src/types beside the fast lane's src/lib)
        // → 4 broken imports → a dead app. The note travels in buildPrompt so EVERY fallback runner
        // (start-tier, escalation, default) sees it.
        if (!sb.ok && sb.salvagedPaths?.length) {
          buildDiag.record({ phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_SALVAGE', message: `Fast lane salvaged ${sb.salvagedPaths.length} finished file(s) into the workspace for the full builder to continue from.`, autoResolved: true, detail: sb.salvagedPaths.join(', ') });
          buildPrompt =
            `[CONTINUE — DO NOT START OVER] A faster build lane already generated ${sb.salvagedPaths.length} file(s) of THIS app before running out of time; ` +
            `they are in the workspace now and they are YOUR OWN prior work:\n${sb.salvagedPaths.slice(0, 40).map((p) => `- ${p}`).join('\n')}\n` +
            `READ these files first and COMPLETE the app around them — keep their module structure, types and export names; add only what is missing; ` +
            `fix any error in place. Do NOT re-plan a parallel structure (no duplicate types/ or utils/ trees), do NOT delete or rewrite them wholesale.\n\n---\n\n${buildPrompt}`;
        }
        // HONESTY (rule 5): a lane we DECIDED not to run must say so, and say why. Silence here would
        // read in the report as "the one-shot was never eligible", which is a different fact.
        if (!sb.ok && classifyForOneShot(analysis?.startTier) && !oneShotStillViable(sb)) {
          buildDiag.record({ phase: 'build', severity: 'info', code: 'ONESHOT_SKIPPED', message: `Skipped the one-shot fast lane: the file plan had already found ${sb.plannedFiles} files, and that lane only fits a single-file app — going straight to the full builder instead of spending a generation call proving it.`, autoResolved: true });
        }
        if (sb.ok) {
          if (sb.typecheckRan === false) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'VERIFY_DID_NOT_RUN', message: 'The fast-lane type-check could not execute in the sandbox (after one retry) — the app shipped unverified; the agentic readiness gate stays ON.', autoResolved: false });
          }
          fastResult(sb.summary, sb.filesWritten, sb.typecheckRan !== false);
        } else if (classifyForOneShot(analysis?.startTier) && oneShotStillViable(sb)) {
          // 2) ONE-SHOT (secondary) — a single call still suits a TRIVIAL one-file app the manifest
          //    skips. Gated to the simple tiers only: a sonnet-tier (complex) prompt can never fit in
          //    one 8k-token call — it falls straight through to the agentic loop instead.
          //    …and gated on what the lane above just MEASURED. See oneShotStillViable: in the dukaan
          //    report the manifest had planned 8 files, so "the manifest skips it" was already false,
          //    and this lane still ran for 150 seconds to fail at something a single call cannot do.
          const os = await runOneShot({ prompt, framework, scaffoldPaths: scaffold, generate: fastGenerate, writeFiles: fastWrite, startPreview: fastPreview, log: fastLog });
          buildDiag.record({ phase: 'build', severity: 'info', code: os.ok ? 'ONESHOT_SUCCESS' : 'ONESHOT_FALLBACK', message: os.summary, autoResolved: true, detail: os.reason });
          if (os.ok) {
            // VERIFY GATE for the one-shot lane too (autopsy 2026-07-07: a NowPlaying.tsx TRUNCATED
            // mid-JSX by max_tokens shipped as "built" — only the manifest lane had the tsc gate, the
            // one-shot secondary had NONE, and the workspace can also hold the failed manifest
            // attempt's partial files, which only a whole-project compile check catches). Same
            // fastVerify + ONE bounded fastRepair; on a still-broken result we do NOT claim success —
            // the agentic loop below finishes the job. "Preview is EARNED."
            let osVerified: boolean | null = null;
            if (process.env.AGENTV3_ONESHOT_VERIFY !== 'off') {
              try {
                let v = await fastVerify();
                if (!v.ok) {
                  fastLog('Found build errors in the one-shot app — fixing them…');
                  const cur = [...writtenFiles.entries()].map(([path, content]) => ({ path, content }));
                  const fixed = (await fastRepair(v.errors, cur).catch(() => [])).filter((f) => f && f.path && f.content);
                  if (fixed.length) { await fastWrite(fixed); v = await fastVerify(); }
                }
                // ran:false = the check never executed — "unknown", never a pass (no fake success).
                osVerified = v.ran === false ? null : v.ok;
              } catch { osVerified = null; /* could not verify → don't block (matches fastVerify's own policy) */ }
            }
            const osOutcome = classifyBuildOutcome({ filesWritten: os.filesWritten, typecheckOk: osVerified });
            buildDiag.record({ phase: 'build', severity: 'info', code: `OUTCOME_${osOutcome}`, message: `Build outcome: ${osOutcome}`, autoResolved: true });
            if (osVerified === false) {
              buildDiag.record({ phase: 'build', severity: 'warning', code: 'ONESHOT_VERIFY_FAILED', message: 'One-shot app did not compile after one repair — handing to the full builder.', autoResolved: true });
              fastLog('The one-shot app still has build errors — switching to the full builder to finish it.');
            } else {
              // osVerified null = the check never ran → keep the agentic gate ON (audited downstream).
              fastResult(os.summary, os.filesWritten, osVerified === true);
            }
          }
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

      // FREE-TIER: never escalate a free build — escalation climbs to Sonnet/Claude, and a not-yet-
      // paying user's build must never spend that budget. A failed free build converts to paid (upsell).
      if (!result && analysis && !freeTierBuildActive && shouldEscalateBuild(analysis, onlyOpus, workspaceId)) {
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
            // WHITE-LABEL LAW: to the user it is always NavBharatAI doing the work. This line used to
            // name "Sonnet" — a vendor model — on a surface every builder sees. What the user needs to
            // know is that the engine is stepping up and WHY, which is said without the vendor.
            events.emit({ type: 'narration', agent: 'architect', text: repairing ? 'Bringing in NavBharatAI\'s stronger engine to fix what the review found…' : 'Bringing in NavBharatAI\'s stronger engine to finish the build…', ts: Date.now() });
            const escRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner({ geminiModel: tierToGeminiBuildModel(tier), claudeFirst: true, noClaude: noClaudeBuild, onProviderUsed: captureProvider, onTurnComplete: captureTurnUsage, onProviderError: (name, err) => { try { buildDiag.recordProviderFailure(name, err); } catch { /* best-effort */ } } }),
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
            // This escalation loop only runs for a paid, non-power build (free/power skip escalation),
            // so the mode is 'paid' here; passed explicitly so the judge selection is mode-correct.
            const judge = selectReviewJudge(onlyOpus ? 'power' : 'paid');
            const reviewerName = judge.kind === 'grok' ? 'Grok' : judge.kind === 'opus' ? 'Opus' : 'Sonnet';
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
              // WHITE-LABEL LAW: named GLM and KIMI to the user. Which engine repairs it is ours to
              // know; the user is told what is happening to THEIR app.
              events.emit({ type: 'narration', agent: 'architect', text: '🔧 Review found issues — NavBharatAI is fixing them…', ts: Date.now() });
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
        escalationsCount = esc.escalations;
        if (esc.escalations > 0) {
          console.log(`[AGENTV3] delivered tier=${esc.tier} after ${esc.escalations} escalation(s), gatePassed=${esc.gatePassed}`);
        }
        // T1-backstop-honesty: the strongest tier was DELIVERED as a best-effort backstop but did NOT pass
        // the objective gate. Never ship that as a silent clean pass — record it so the build-health card +
        // report show it (buildHealthFromDiagnostics folds unresolved warnings in), and narrate it honestly.
        const backstopNote = backstopHonestyNote(esc.gatePassed, esc.gate?.reason);
        if (backstopNote) {
          try { buildDiag.record({ phase: 'readiness', severity: 'warning', code: 'BACKSTOP_GATE_FAIL', message: backstopNote, autoResolved: false }); } catch { /* diagnostics best-effort */ }
          const narr = backstopNarration(esc.gatePassed);
          if (narr) events.emit({ type: 'narration', agent: 'architect', text: narr, ts: Date.now() });
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
      if (shouldRetryEmptyBuild({
        expectsArtifacts,
        filesWritten: writtenFiles.size,
        isEditMode,
        existingProjectFiles: editFileTree?.length ?? 0,
        aborted: abort.signal.aborted,
        withinCostCap: costAfterFirstAttempt <= capUsd,
      })) {
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
          client: buildTurnRunner(healRunnerOpts()),
          model: resolveModel(powerLevelReqEffective), // the tier's pinned model (Strong → Sonnet; Powerful/FT → Opus; Normal → Sonnet)
          effort: powerSpecResolved.effort,
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

      // Whether the browser console could be READ this run — hoisted so the claim audit can compare the
      // model's "no console errors" against whether anyone actually looked.
      let runtimeCaptureAvailable = false;

      // THE RELEASE GATE'S EVIDENCE (Mission 10/10 Phase 5, §23), collected as the checks below run.
      //
      // Every field starts at 'not-run' and is only ever moved by a check that ACTUALLY RAN. That
      // default is the entire design: every runtime check in this engine is gated on a preview URL, so
      // they all skip together, and they skip precisely when the app is most broken. A gate that
      // defaulted to 'passed' — or that inferred health from silence — would report the quietest, most
      // broken builds as the healthiest ones.
      const gateEvidence: RuntimeEvidence = {
        buildOk: false, preview: 'not-run', pages: 'not-run', journeys: 'not-run',
        typecheck: 'not-run', tests: 'not-run',
      };
      // Zero means "none found", and it stays zero when the browser never ran — which is correct here
      // only because the gate cannot reach GREEN without runtime proof anyway, so an unmeasured app is
      // already held back by the evidence rules rather than by a fabricated quality score.
      const gateQuality: QualitySignals = { a11yIssues: 0, slowRoutes: 0 };

      // G3 — POST-AGENTIC TSC GATE (default-on; disable with AGENTV3_AGENTIC_TSC_GATE=off). The fast
      // lane (SimpleBuilder) type-checks + repairs, but the agentic loop / escalation / empty-build
      // retry had NO deterministic compile gate — it relied on the agent choosing to run tsc, which is
      // not guaranteed, so a build that "finished" could still ship type errors. This runs one real
      // `tsc --noEmit` over the produced files and, on type errors, makes ONE bounded Claude repair
      // pass, then re-checks. It is purely ADDITIVE: it NEVER flips result.ok and NEVER blocks (best-
      // effort, abortable, budget-capped); on persisting errors it records the honest OUTCOME so the
      // report/dashboard sees the true end-state (ship-with-warning, exactly like PREVIEW_FAILED).
      if (
        postBuildCodeGateShouldRun({
          enabled: process.env.AGENTV3_AGENTIC_TSC_GATE !== 'off',
          fastLaneGated, buildOk: result.ok, wroteFiles: writtenFiles.size > 0,
          // !isImportTurn: this gate verifies what WE built; on a survey turn we built nothing, and
          // the `.env` we write ourselves used to defeat the size-only guard (see the predicate).
          isImportTurn, aborted: abort.signal.aborted,
        })
        // Only with comfortable time left for install + tsc + one repair pass.
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000)
      ) {
        // `verified` is separate from `ok` on purpose. Two of the paths below return ok=true meaning
        // "we could not check, so do not block" — which is right for the gate and would be a LIE as
        // release evidence. Collapsing the two is how "we did not look" becomes "it passed".
        const runTsc = async (): Promise<{ ok: boolean; verified: boolean; errors: string }> => {
          try {
            // ENSURE A TSCONFIG FIRST: an imported/older project can have NO tsconfig.json, in which case
            // `tsc --noEmit` prints its HELP page and exits 0 — a FALSE "clean" pass while real type
            // errors (e.g. a missing enum export) slip through to a blank-screen runtime crash (seen in a
            // real report). For a TS project (a .ts/.tsx under src) with no config, write a minimal,
            // PERMISSIVE tsconfig (strict:false, skipLibCheck) so tsc actually verifies — without
            // introducing new strictness errors. Never overwrites an existing config. Best-effort.
            const ensureCfg = "if [ ! -f tsconfig.json ] && [ ! -f tsconfig.app.json ] && find src -name '*.ts' -o -name '*.tsx' 2>/dev/null | head -1 | grep -q .; then printf '%s' '{\"compilerOptions\":{\"target\":\"ES2020\",\"lib\":[\"ES2020\",\"DOM\",\"DOM.Iterable\"],\"module\":\"ESNext\",\"moduleResolution\":\"bundler\",\"jsx\":\"react-jsx\",\"strict\":false,\"skipLibCheck\":true,\"noEmit\":true,\"esModuleInterop\":true,\"allowSyntheticDefaultImports\":true,\"isolatedModules\":true},\"include\":[\"src\"]}' > tsconfig.json; fi";
            const r = await actuator.runCommand(workspaceId, `${ensureCfg}; ${TSC_ENSURE}; ${TSC_BIN} --noEmit 2>&1 | tail -200 || true`);
            const out = `${r.stdout || ''}\n${r.stderr || ''}`;
            // A help-page result means tsc STILL didn't really run (e.g. no src TS files) — treat as
            // "unverified, don't block", never as a clean pass (no fake success).
            if (looksLikeTscHelpOutput(out)) return { ok: true, verified: false, errors: '' };
            return hasTscErrors(out)
              ? { ok: false, verified: true, errors: out.slice(0, 6000) }
              : { ok: true, verified: true, errors: '' };
          } catch {
            // Couldn't verify (no real sandbox / tooling) → don't block, and don't claim a pass either.
            return { ok: true, verified: false, errors: '' };
          }
        };
        let check = await runTsc();
        // DETERMINISTIC FIRST — restore the boilerplate WE ship before asking a weak model to fix it
        // (confirmed across three real builds, 2026-08-12). The scaffold's class-component
        // src/ErrorBoundary.tsx is correct; a weak coder that touches it breaks its typing
        // (`Property 'state' does not exist on type 'ErrorBoundary'`) and then CANNOT fix it — a React
        // error boundary must be a class, which the model does not know, so it burned five tsc passes
        // and shipped it broken. The model never has a legitimate reason to rewrite an error boundary,
        // so restoring our version can never lose user intent. Same shape as the dead-server fix: when
        // the failure is in a file we own and there is one correct form, do the free certain thing.
        // Kill switch: AGENTV3_SCAFFOLD_RESTORE=off.
        if (!check.ok && process.env.AGENTV3_SCAFFOLD_RESTORE !== 'off') {
          try {
            const brokenScaffold = scaffoldFilesInTscErrors(check.errors);
            const restored: string[] = [];
            for (const path of brokenScaffold) {
              const canonical = canonicalScaffold(path);
              if (!canonical) continue;
              let current = '';
              try { current = await actuator.readFile(workspaceId, path); } catch { current = ''; }
              if (current !== canonical) {
                await dispatcher.dispatch({ id: `scaffold-restore-${restored.length}`, name: 'write_file', input: { path, content: canonical } }, 'frontend');
                restored.push(path);
              }
            }
            if (restored.length > 0) {
              buildDiag.record({
                phase: 'build', severity: 'info', code: 'SCAFFOLD_RESTORED',
                message: `Restored ${restored.length} file(s) NavBharatAI ships (e.g. the error boundary) to their known-good version instead of spending a model pass on them: ${restored.join(', ')}. A build never needs to change these.`,
                autoResolved: true,
              });
              check = await runTsc();
            }
          } catch { /* deterministic restore is best-effort — fall through to the model repair below */ }
        }
        if (!check.ok) {
          events.emit({ type: 'narration', agent: 'architect', text: '🔍 Type-checking the finished build — found type errors, fixing them…', ts: Date.now() });
          try {
            const currentFiles = Array.from(writtenFiles.entries()).map(([path, content]) => ({ path, content }));
            // Cheap-floor-first like every other build text call (admin 2026-07-11 — no direct-Sonnet path);
            // Claude still backstops the chain so the repair never fails for lack of a provider.
            const t = await makeFastTextRunner().runTurn({
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
        if (check.verified) gateEvidence.typecheck = check.ok ? 'passed' : 'failed';
      }

      // MISSING-FILES GATE for the AGENTIC path (deep-test App #4 — Instagram, 2026-07-13). The fast
      // lane already runs findUnresolvedLocalImports before verify (Fix 38c), but the AGENTIC build (the
      // path that builds COMPLEX apps — this Instagram clone was 101 steps) never did. So src/App.tsx
      // importing ./hooks (useAuth) + ./App.module.css that were NEVER written shipped as "✓ Done"; the
      // preview STUBBED the missing modules, useAuth() came back undefined, and the app crashed at runtime
      // ("Cannot read properties of undefined (reading 'isAuthenticated')"). Same defect CLASS the fast-
      // lane gate catches — missing on the path that builds the biggest apps (root cause: the gate lived
      // at ONE call site). Deterministic + free: every LOCAL import must resolve to a real written/scaffold
      // file; a gap triggers ONE bounded creation pass grounded in the importing files, then re-checks and
      // records the HONEST end-state (never "fully functional" while a dangling import guarantees a crash).
      // Kill: AGENTV3_MISSING_FILES_GATE=off.
      if (
        postBuildCodeGateShouldRun({
          enabled: process.env.AGENTV3_MISSING_FILES_GATE !== 'off',
          fastLaneGated, buildOk: result.ok, wroteFiles: writtenFiles.size > 0,
          // !isImportTurn: this gate verifies what WE built; on a survey turn we built nothing, and
          // the `.env` we write ourselves used to defeat the size-only guard (see the predicate).
          isImportTurn, aborted: abort.signal.aborted,
        })
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 60_000)
      ) {
        try {
          const scaffoldPaths = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))
            .filter((p) => !/^(node_modules|\.git)\//.test(p));
          const findMissing = (): Array<{ missing: string; importedBy: string; existsAt?: string }> => {
            const writtenMap = Object.fromEntries(writtenFiles);
            const fileMap: Record<string, string> = { ...Object.fromEntries(scaffoldPaths.map((p) => [p, ''])), ...writtenMap };
            // Judge only OUR writes — a pre-existing scaffold file's own imports are not this build's gap.
            return findUnresolvedLocalImports(fileMap).filter((u) => writtenMap[u.importedBy] !== undefined);
          };
          let missing = findMissing();
          // DETERMINISTIC CSS-MODULE STUBS (Kanban autopsy 2026-07-13): a missing *.module.css is 100%
          // generatable from the importer's own `styles.X` usage — no LLM step needed. Create these FIRST so
          // the bounded repair pass below only spends its budget on the genuinely-hard missing files
          // (barrels/components). This was the report's single biggest struggle (12+ missing .module.css that
          // exhausted the step-limit). Kill: AGENTV3_CSS_MODULE_GEN=off.
          if (missing.length > 0 && process.env.AGENTV3_CSS_MODULE_GEN !== 'off') {
            try {
              const fileMapForCss: Record<string, string> = { ...Object.fromEntries(scaffoldPaths.map((p) => [p, ''])), ...Object.fromEntries(writtenFiles) };
              const cssStubs = generateMissingCssModules(fileMapForCss);
              if (cssStubs.length > 0) {
                for (let i = 0; i < cssStubs.length; i++) {
                  await dispatcher.dispatch({ id: `cssmod-w${i}`, name: 'write_file', input: { path: cssStubs[i].path, content: cssStubs[i].content } }, 'frontend');
                }
                buildDiag.record({ phase: 'build', severity: 'info', code: 'CSS_MODULES_GENERATED', message: `${cssStubs.length} missing CSS module(s) generated deterministically from component class usage (no repair step spent): ${cssStubs.map((s) => s.path).join(', ')}`, autoResolved: true });
                events.emit({ type: 'narration', agent: 'architect', text: `🎨 Generated ${cssStubs.length} missing stylesheet(s) from the components' class usage.`, ts: Date.now() });
                missing = findMissing(); // re-check: CSS modules now resolve — only the hard files remain for the LLM pass
              }
            } catch { /* deterministic CSS gen is best-effort — the LLM pass below still handles them */ }
          }
          // DETERMINISTIC BARREL (index) GENERATION (Kanban autopsy 2026-07-13): a folder-barrel import
          // (`import { Icon } from '.../Icons'`) whose leaf files already export the names but whose index
          // was never written is 100% generatable — re-export each name from its unique leaf, no LLM step.
          // Runs before the repair pass so the budget goes to real gaps. Kill: AGENTV3_BARREL_GEN=off.
          if (missing.length > 0 && process.env.AGENTV3_BARREL_GEN !== 'off') {
            try {
              const fileMapForBarrel: Record<string, string> = { ...Object.fromEntries(scaffoldPaths.map((p) => [p, ''])), ...Object.fromEntries(writtenFiles) };
              const barrels = await generateMissingBarrels(fileMapForBarrel);
              if (barrels.length > 0) {
                for (let i = 0; i < barrels.length; i++) {
                  await dispatcher.dispatch({ id: `barrel-w${i}`, name: 'write_file', input: { path: barrels[i].path, content: barrels[i].content } }, 'frontend');
                }
                buildDiag.record({ phase: 'build', severity: 'info', code: 'BARRELS_GENERATED', message: `${barrels.length} missing barrel(s) generated deterministically from existing leaf modules (no repair step spent): ${barrels.map((b) => b.path).join(', ')}`, autoResolved: true });
                events.emit({ type: 'narration', agent: 'architect', text: `📦 Generated ${barrels.length} missing index barrel(s) re-exporting existing modules.`, ts: Date.now() });
                missing = findMissing(); // re-check: barrels now resolve — only the hard files remain
              }
            } catch { /* deterministic barrel gen is best-effort — the LLM pass below still handles them */ }
          }
          if (missing.length > 0) {
            // Split mispaths (the module EXISTS at existsAt — fix the import) from truly-missing (create it).
            // Without this the repair wrote a DUPLICATE of an already-written file (Kanban build 2026-07-13).
            const mispaths = missing.filter((m) => m.existsAt);
            const trulyMissing = missing.filter((m) => !m.existsAt);
            const fmt = (arr: typeof missing) => arr.slice(0, 15).map((u) => u.existsAt
              ? `${u.missing} (imported by ${u.importedBy}) → exists at ${u.existsAt}` : `${u.missing} (imported by ${u.importedBy})`).join('\n  ');
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'MISSING_FILES_DETECTED', message: `${missing.length} local import(s) don't resolve — ${trulyMissing.length} missing file(s), ${mispaths.length} wrong path(s) (the app crashes at runtime; the preview stubs them):\n  ${fmt(missing)}`, autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `🔧 ${missing.length} import(s) don't resolve — ${mispaths.length > 0 ? `fixing ${mispaths.length} wrong path(s) and ` : ''}creating ${trulyMissing.length} missing file(s)…`, ts: Date.now() });
            try {
              // Ground the creation pass in the files that DO the importing, so each new module matches its
              // real usage (correct named/default exports, hook/prop shapes) instead of a blind stub.
              const importerPaths = Array.from(new Set(missing.map((m) => m.importedBy)));
              const importerFiles = importerPaths
                .map((p) => ({ path: p, content: writtenFiles.get(p) || '' }))
                .filter((f) => f.content);
              const createList = trulyMissing.map((m) => `- ${m.missing} (imported by ${m.importedBy})`).join('\n');
              const mispathList = mispaths.map((m) => `- in ${m.importedBy}: the import of "${m.missing}" is a WRONG PATH — that module already exists at ${m.existsAt}; correct the import path to point at it`).join('\n');
              const t = await makeFastTextRunner().runTurn({
                model: fastBuildModel(), system: repairSystemPrompt(framework),
                messages: [{ role: 'user', content:
                  `The app was built for this request:\n${prompt}\n\n` +
                  `Some LOCAL imports don't resolve, so the app crashes at runtime. Fix EXACTLY these, changing NOTHING else:\n` +
                  (mispathList ? `\nWRONG IMPORT PATHS — the target file ALREADY EXISTS; do NOT create a new file, just correct the import path in the importing file:\n${mispathList}\n` : '') +
                  (createList ? `\nMISSING FILES — these were NEVER created; CREATE each with REAL, working content that satisfies EXACTLY how the ` +
                  `importing file uses it (correct named/default exports, correct hook return shapes, real logic — no TODOs, no empty stubs; ` +
                  `for a *.module.css import, create the stylesheet with the class names the component references):\n${createList}\n` : '') +
                  `\nThe files that import them (match their usage precisely):\n` +
                  importerFiles.map((f) => `\n=== ${f.path} ===\n${f.content.slice(0, 4000)}`).join('\n') },
                ],
                tools: [], maxTokens: 8000,
              });
              const created = parseFileBlocks(t.text).map((b) => ({ path: b.path, content: b.content }));
              for (let i = 0; i < created.length; i++) {
                await dispatcher.dispatch({ id: `missfiles-w${i}`, name: 'write_file', input: { path: created[i].path, content: created[i].content } }, 'frontend');
              }
            } catch (e) {
              console.log(`[AGENTV3] missing-files gate repair failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            missing = findMissing();
            if (missing.length === 0) {
              buildDiag.record({ phase: 'build', severity: 'info', code: 'MISSING_FILES_HEALED', message: 'All previously-missing local modules were created — the app no longer has dangling imports.', autoResolved: true });
              events.emit({ type: 'narration', agent: 'architect', text: '✅ Created the missing files — the app is now complete.', ts: Date.now() });
              if (writtenFiles.size > 0) { try { await saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* durable save best-effort */ } }
            } else {
              // Still missing after one pass → HONEST end-state. Do NOT flip result.ok (the app is saved —
              // ship-with-warning, like OUTCOME_TYPECHECK_FAILED); the PREVIEW_VERIFY gate below is the
              // render-truth judge that can zero billing if the crash is confirmed on screen.
              buildDiag.record({ phase: 'build', severity: 'error', code: 'OUTCOME_MISSING_FILES', message: `After one creation pass, ${missing.length} local module(s) are STILL missing — the app will crash at runtime:\n  ${fmt(missing)}`, autoResolved: false });
              events.emit({ type: 'narration', agent: 'architect', text: '⚠️ Some referenced files could not be auto-created. Your files are saved — send a follow-up and I\'ll finish them.', ts: Date.now() });
            }
          }
        } catch { /* missing-files gate is best-effort — never blocks a build */ }
      }

      // SYNTAX GATE (deep-test App #6 — Expense Tracker, 2026-07-13). A GLM response hit max_tokens
      // (LLM_TRUNCATED) and produced a corrupt src/App.tsx — a CSS declaration (`-side: border-radius:
      // 0.5rem;`) injected INTO a JSX <button>. The file does not PARSE, so the app never compiled and the
      // preview died with "Unexpected token (31:13)" — yet the build shipped "READY 60/100" because the
      // sandbox `tsc` could not run (VERIFY_DID_NOT_RUN). This gate parses every generated JS/TS/JSX/TSX
      // file with esbuild IN THE SERVER PROCESS (immune to the sandbox tsc failures) and, on a real parse
      // error, runs ONE bounded repair pass, re-checks, and records the HONEST end-state: an unhealed
      // syntax error is an ERROR blocker → buildHealth becomes NOT READY (never a "READY" app that won't
      // compile). Kill: AGENTV3_SYNTAX_GATE=off.
      if (
        postBuildCodeGateShouldRun({
          enabled: process.env.AGENTV3_SYNTAX_GATE !== 'off',
          fastLaneGated, buildOk: result.ok, wroteFiles: writtenFiles.size > 0,
          // !isImportTurn: this gate verifies what WE built; on a survey turn we built nothing, and
          // the `.env` we write ourselves used to defeat the size-only guard (see the predicate).
          isImportTurn, aborted: abort.signal.aborted,
        })
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 45_000)
      ) {
        try {
          let syntaxErrors = await findSyntaxErrors(Object.fromEntries(writtenFiles));
          if (syntaxErrors.length > 0) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'SYNTAX_ERROR_DETECTED', message: `${syntaxErrors.length} generated file(s) do not parse (the app cannot compile):\n${syntaxRepairInstruction(syntaxErrors)}`, autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `🔧 ${syntaxErrors.length} file(s) have a syntax error (the app won't compile) — fixing them…`, ts: Date.now() });
            try {
              const brokenPaths = Array.from(new Set(syntaxErrors.map((e) => e.path)));
              const brokenFiles = brokenPaths
                .map((p) => ({ path: p, content: writtenFiles.get(p) || '' }))
                .filter((f) => f.content);
              const t = await makeFastTextRunner().runTurn({
                model: fastBuildModel(), system: repairSystemPrompt(framework),
                messages: [{ role: 'user', content:
                  `The app was built for this request:\n${prompt}\n\n` +
                  `These files have a SYNTAX ERROR and the app will NOT compile. Rewrite EACH broken file in ` +
                  `full so it parses cleanly — fix ONLY the syntax (a truncated/corrupted region, a stray CSS ` +
                  `declaration inside JSX, an unclosed brace/tag), keep all the real logic and UI. Change ` +
                  `nothing else.\n\nSYNTAX ERRORS:\n${syntaxRepairInstruction(syntaxErrors)}\n\n` +
                  `The broken files (rewrite each one completely and correctly):\n` +
                  brokenFiles.map((f) => `\n=== ${f.path} ===\n${f.content.slice(0, 6000)}`).join('\n') },
                ],
                tools: [], maxTokens: 8000,
              });
              const fixed = parseFileBlocks(t.text).map((b) => ({ path: b.path, content: b.content }));
              for (let i = 0; i < fixed.length; i++) {
                await dispatcher.dispatch({ id: `syntax-w${i}`, name: 'write_file', input: { path: fixed[i].path, content: fixed[i].content } }, 'frontend');
              }
            } catch (e) {
              console.log(`[AGENTV3] syntax gate repair failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            syntaxErrors = await findSyntaxErrors(Object.fromEntries(writtenFiles));
            if (syntaxErrors.length === 0) {
              buildDiag.record({ phase: 'build', severity: 'info', code: 'SYNTAX_HEALED', message: 'All syntax errors fixed — every generated file now parses.', autoResolved: true });
              events.emit({ type: 'narration', agent: 'architect', text: '✅ Fixed the syntax errors — the app compiles now.', ts: Date.now() });
              if (writtenFiles.size > 0) { try { await saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* durable save best-effort */ } }
            } else {
              // Still broken after one pass → HONEST end-state. An unparseable file is an ERROR blocker, so
              // buildHealthFromDiagnostics makes the build NOT READY (a syntax error means it cannot run —
              // never report a "READY" app that won't compile, the exact App #6 dishonesty).
              buildDiag.record({ phase: 'build', severity: 'error', code: 'OUTCOME_SYNTAX_ERROR', message: `After one repair pass, ${syntaxErrors.length} file(s) STILL do not parse — the app cannot compile:\n${syntaxRepairInstruction(syntaxErrors)}`, autoResolved: false });
              events.emit({ type: 'narration', agent: 'architect', text: '⚠️ A syntax error remains — the app won\'t compile yet. Your files are saved; send a follow-up and I\'ll finish the fix.', ts: Date.now() });
            }
          }
        } catch { /* syntax gate is best-effort — never blocks a build */ }
      }

      // MISSING-EXPORT GATE (deep-test App #7 — Trello full-stack, 2026-07-13). Truncated file-generations
      // (`LLM_TRUNCATED` on Vertex, hit under heavy GLM rate-limiting) cut off a module's export — e.g.
      // server/routes/cards.ts lost `export … cardRoutes`, breaking server/index.ts's `import { cardRoutes }`.
      // The readiness gate DETECTED 18 such broken imports but the app still shipped NOT READY; the existing
      // reconcileImportExports only fixes named↔default KIND mismatches, so it can't restore an export that a
      // truncation deleted. This gate finds every "name imported but not exported" mismatch, REGENERATES the
      // target file(s) so the missing export exists again, re-checks, and records the honest end-state. Same
      // proven shape as the missing-files/syntax gates. Kill: AGENTV3_MISSING_EXPORT_GATE=off.
      if (
        postBuildCodeGateShouldRun({
          enabled: process.env.AGENTV3_MISSING_EXPORT_GATE !== 'off',
          fastLaneGated, buildOk: result.ok, wroteFiles: writtenFiles.size > 0,
          // !isImportTurn: this gate verifies what WE built; on a survey turn we built nothing, and
          // the `.env` we write ourselves used to defeat the size-only guard (see the predicate).
          isImportTurn, aborted: abort.signal.aborted,
        })
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 45_000)
      ) {
        try {
          const analyzeTargets = async (): Promise<ExportRegenTarget[]> => {
            const map = Object.fromEntries(writtenFiles);
            const rep = await analyzeImportExports(map);
            // Regenerate only OUR written targets (never a scaffold/read-only file).
            return exportRegenTargets(rep, new Set(Object.keys(map))).filter((t) => writtenFiles.has(t.target));
          };
          let targets = await analyzeTargets();
          if (targets.length > 0) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'MISSING_EXPORT_DETECTED', message: `${targets.length} file(s) are missing exports that other files import (the build fails):\n${exportRegenInstruction(targets)}`, autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `🔧 ${targets.length} file(s) are missing an export another file needs — regenerating them…`, ts: Date.now() });
            try {
              const targetFiles = targets
                .map((t) => ({ path: t.target, content: writtenFiles.get(t.target) || '' }))
                .filter((f) => f.content);
              const t = await makeFastTextRunner().runTurn({
                model: fastBuildModel(), system: repairSystemPrompt(framework),
                messages: [{ role: 'user', content:
                  `The app was built for this request:\n${prompt}\n\n` +
                  `These files are imported by other modules for specific bindings, but they DO NOT export those ` +
                  `bindings (usually a generation that was cut off before the export). Rewrite EACH file in full ` +
                  `so it exports EXACTLY the required names, keeping all its existing logic/UI and adding the ` +
                  `missing export(s) with real implementations (no stubs). Change nothing else.\n\n` +
                  `REQUIRED EXPORTS:\n${exportRegenInstruction(targets)}\n\n` +
                  `The files to rewrite (complete each one, exports included):\n` +
                  targetFiles.map((f) => `\n=== ${f.path} ===\n${f.content.slice(0, 6000)}`).join('\n') },
                ],
                tools: [], maxTokens: 8000,
              });
              const fixed = parseFileBlocks(t.text).map((b) => ({ path: b.path, content: b.content }));
              for (let i = 0; i < fixed.length; i++) {
                await dispatcher.dispatch({ id: `missexport-w${i}`, name: 'write_file', input: { path: fixed[i].path, content: fixed[i].content } }, 'frontend');
              }
            } catch (e) {
              console.log(`[AGENTV3] missing-export gate repair failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            targets = await analyzeTargets();
            if (targets.length === 0) {
              buildDiag.record({ phase: 'build', severity: 'info', code: 'MISSING_EXPORT_HEALED', message: 'All previously-missing exports were restored — every local import now resolves to a real binding.', autoResolved: true });
              events.emit({ type: 'narration', agent: 'architect', text: '✅ Restored the missing exports — the imports resolve now.', ts: Date.now() });
              if (writtenFiles.size > 0) { try { await saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* durable save best-effort */ } }
            } else {
              buildDiag.record({ phase: 'build', severity: 'error', code: 'OUTCOME_MISSING_EXPORT', message: `After one repair pass, ${targets.length} file(s) STILL miss an imported export — the build will fail:\n${exportRegenInstruction(targets)}`, autoResolved: false });
              events.emit({ type: 'narration', agent: 'architect', text: '⚠️ Some imports still reference exports that could not be restored. Your files are saved — send a follow-up and I\'ll finish the fix.', ts: Date.now() });
            }
          }
        } catch { /* missing-export gate is best-effort — never blocks a build */ }
      }

      // PROJECT INTEGRITY (autopsy 2026-07-11, Todo + Notes reports) — two real defect CLASSES the
      // deterministic analyzer suite (ArchitectureAnalysis / WorkspaceHealth / deadCode) does not cover
      // and that shipped in both apps: (1) MULTIPLE mount-focus owners — the Notes build had NoteEditor
      // AND SearchBar both grabbing focus, so the required "auto-focus the note input" silently broke;
      // (2) the same stylesheet imported by 2+ modules (Notes imported global.css from main.tsx AND
      // App.tsx). Deterministic + free. Findings are ALWAYS recorded honestly (previously only the fuzzy
      // LLM reviewer text mentioned them — never structured). The bounded LLM SELF-HEAL is gated behind
      // AGENTV3_INTEGRITY_GATE (default OFF — canary first, like LintGate); flip on to auto-fix them.
      // Planned inside the integrity block below, where the full project map is already in memory,
      // and consumed by the route smoke check much further down. Declared here so the two are not
      // forced to share a scope, and so planning cannot pay for a second workspace load.
      let routeSmokePlan: SmokePlan | null = null;
      try {
        // FULL-WORKSPACE view for integrity (FitPulse autopsy 2026-07-17, hardened after the edit-build
        // re-test): `writtenFiles` holds only the files THIS build wrote. On an EDIT build that is 3-4
        // files — so the mixed-specifier check could not see the OTHER modules importing ThemeContext
        // (normalize never fired; the duplicate-context crash survived), and on the first pass the
        // scaffold-owned main.tsx was invisible (orphan-stylesheet FALSE positive). The analysis now
        // starts from the DURABLE STORE's full project map (the same source the sandbox restore uses),
        // overlaid with this build's writes (newest content wins), so every integrity check judges the
        // complete app the user actually runs. Entry/html candidates from the sandbox remain the
        // fallback for anything not yet persisted.
        // POST-ANSWER TIMING (autopsy cb03bdde, admin 2026-08-04): the user's answer landed at 399s and
        // the build did not finish until 624s — 225 seconds of "still working" AFTER the reply was on
        // screen. The autopsy could not say what dominated it, because nothing here was timed.
        //
        // Deliberately MEASURING rather than optimising: the obvious move is to background this whole
        // pass, but the full-workspace load exists for a real reason (an edit build writes 3-4 files, so
        // `writtenFiles` alone makes the integrity checks blind and produces FALSE positives), and
        // backgrounding it risks the report finalising before these findings land — the exact blind spot
        // just closed on the import-boot path. Cutting on a guess is how a confident wrong fix ships.
        // So the next report will say where the time actually goes, and THEN it can be fixed with evidence.
        const integrityStartedAt = Date.now();
        const storeFiles = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
        const storeLoadMs = Date.now() - integrityStartedAt;
        const integrityFiles: Record<string, string> = { ...storeFiles, ...Object.fromEntries(writtenFiles) };
        for (const p of ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/index.tsx', 'index.html', 'src/index.css']) {
          if (integrityFiles[p] === undefined) {
            try { integrityFiles[p] = await actuator.readFile(workspaceId, p); } catch { /* absent in sandbox too */ }
          }
        }
        // MIXED IMPORT SPECIFIERS — deterministic normalize (FitPulse: ThemeContext imported both
        // './context/ThemeContext' and 'context/ThemeContext' → the in-browser bundler instantiated the
        // module TWICE → two React contexts → "useTheme must be used within a ThemeProvider" crash that
        // only the user's preview showed). Rewrite every project import to ONE canonical relative form.
        // Kill: AGENTV3_IMPORT_NORMALIZE=off.
        // ROOT CAUSE (mitrify import autopsy 2026-07-27): this and the two passes below mutated files on
        // an import/survey-only turn ("do not change any files yet") — the same instruction-violation
        // class `shouldRunIntegrityHeal` closed for the LLM self-heal on 2026-07-24, never applied to
        // these deterministic siblings. Advisory findings (analyzeProjectIntegrity below) still always
        // run and get recorded — only the file-WRITING passes are gated on !isImportTurn.
        if (process.env.AGENTV3_IMPORT_NORMALIZE !== 'off' && !isImportTurn) {
          const norm = normalizeImportSpecifiers(integrityFiles);
          const touched = new Set(norm.rewrites.map((r) => r.file));
          for (const f of touched) {
            const content = norm.files[f];
            if (typeof content !== 'string') continue;
            integrityFiles[f] = content;
            if (writtenFiles.has(f) || f !== 'index.html') writtenFiles.set(f, content);
            try { await actuator.writeFile(workspaceId, f, content); } catch { /* sandbox write best-effort */ }
          }
          if (norm.rewrites.length > 0) {
            buildDiag.record({ phase: 'build', severity: 'info', code: 'INTEGRITY_IMPORTS_NORMALIZED', message: `Normalized ${norm.rewrites.length} import specifier(s) so every bundler sees one module instance (prevents duplicate-context "must be used within a Provider" crashes).`, autoResolved: true, detail: norm.rewrites.slice(0, 10).map((r) => `${r.file}: ${r.from} → ${r.to}`).join('; ') });
          }
        }
        // ORPHAN STYLESHEET — deterministic fix FIRST (NotesNest autopsy 2026-07-16: the app shipped as
        // raw unstyled HTML because src/index.css was imported by nothing). When the global sheet can be
        // wired by construction (inject `import './index.css'` into the entry), do it directly — no LLM,
        // no flag: this is the same class of certainty as the HTML-entry guard. Kill: AGENTV3_CSS_IMPORT_GUARD=off.
        if (process.env.AGENTV3_CSS_IMPORT_GUARD !== 'off' && !isImportTurn) {
          const wired = injectGlobalStylesheetImport(integrityFiles);
          for (const inj of wired.injected) {
            const newEntry = wired.files[inj.entry];
            if (typeof newEntry === 'string') {
              integrityFiles[inj.entry] = newEntry;
              writtenFiles.set(inj.entry, newEntry);
              try { await actuator.writeFile(workspaceId, inj.entry, newEntry); } catch { /* sandbox write best-effort — the store copy is fixed */ }
              buildDiag.record({ phase: 'build', severity: 'info', code: 'INTEGRITY_CSS_WIRED', message: `"${inj.stylesheet}" was imported by NOTHING (app would render unstyled) — injected its import into ${inj.entry}.`, autoResolved: true });
            }
          }
        }
        // VITE CLIENT TYPES — deterministic, and the cheapest fix in this whole block. See viteEnvTypes:
        // the dukaan report's build ran `tsc --noEmit` FOUR times over 106 seconds while every failing
        // round carried "Property 'env' does not exist on type 'ImportMeta'" — an app reading
        // import.meta.env with no `vite/client` declaration anywhere. A types-only triple-slash directive
        // has ZERO runtime effect, so this cannot change what the app does, only what the compiler knows.
        // Kill: AGENTV3_VITE_ENV_TYPES=off.
        if (process.env.AGENTV3_VITE_ENV_TYPES !== 'off' && !isImportTurn) {
          const dts = missingViteEnvTypes(integrityFiles);
          if (dts) {
            integrityFiles[dts.path] = dts.content;
            writtenFiles.set(dts.path, dts.content);
            try { await actuator.writeFile(workspaceId, dts.path, dts.content); } catch { /* sandbox write best-effort — the store copy is fixed */ }
            buildDiag.record({ phase: 'build', severity: 'info', code: 'VITE_ENV_TYPES_ADDED', message: viteEnvTypesNote(), autoResolved: true });
          }
        }
        // CREDENTIAL-IN-LOGS — deterministic redaction (SaaS-dashboard autopsy 2026-07-22). The readiness
        // gate's ONE high-severity privacy/compliance class is `pii-in-logs`: a console.* line that logs a
        // credential/token, which hard-blocks the readiness verdict. The PRIMARY fix runs earlier, as a
        // heal-then-judge step INSIDE the mandatory gate (ToolDispatcher.healCredentialLogs, called from
        // AgentRunner before assessBuildReadiness) so the verdict is never falsely blocked. THIS pass is
        // defense-in-depth: it also cleans the SHIPPED app on paths where the mandatory gate is skipped
        // (fast-lane type-checked, salvage, edit builds). Idempotent, so it's a no-op after the in-gate
        // heal already ran. Provably non-breaking. Kill: AGENTV3_CRED_LOG_GUARD=off.
        // IMPORT-TURN EXCEPTION (mitrify autopsy 2026-07-27): on a "do not change any files" import/survey
        // turn this pass rewrote 8 lines across 2 of the USER'S OWN files. A credential-in-logs finding on
        // someone else's imported repo is REAL and must still be surfaced — but surfacing it is a REPORT,
        // not a licence to edit their code. So on an import turn we DETECT and record it as an honest
        // advisory warning, and mutate nothing; the next real edit/build turn redacts it as usual.
        if (process.env.AGENTV3_CRED_LOG_GUARD !== 'off') {
          const redacted = redactCredentialLogs(integrityFiles);
          if (isImportTurn) {
            if (redacted.redactions.length > 0) {
              const files = [...new Set(redacted.redactions.map((r) => r.file))];
              buildDiag.record({ phase: 'build', severity: 'warning', code: 'COMPLIANCE_LOG_LEAK_FOUND', message: `${redacted.redactions.length} console log(s) across ${files.length} file(s) print a credential/token. NOT changed — you asked me not to modify files on this turn. Ask me to fix them and I will redact every one.`, autoResolved: false, detail: redacted.redactions.slice(0, 10).map((r) => `${r.file}:${r.line}`).join('; ') });
            }
          } else {
            for (const r of redacted.redactions) {
              const newContent = redacted.files[r.file];
              if (typeof newContent !== 'string' || newContent === integrityFiles[r.file]) continue;
              integrityFiles[r.file] = newContent;
              writtenFiles.set(r.file, newContent);
              try { await actuator.writeFile(workspaceId, r.file, newContent); } catch { /* sandbox write best-effort — the store copy is fixed */ }
            }
            if (redacted.redactions.length > 0) {
              const files = [...new Set(redacted.redactions.map((r) => r.file))];
              buildDiag.record({ phase: 'build', severity: 'info', code: 'COMPLIANCE_LOG_REDACTED', message: `Redacted ${redacted.redactions.length} console log(s) that leaked a credential/token (would have hard-blocked the readiness gate) across ${files.length} file(s).`, autoResolved: true, detail: redacted.redactions.slice(0, 10).map((r) => `${r.file}:${r.line}`).join('; ') });
            }
          }
        }
        const integrity = analyzeProjectIntegrity(integrityFiles);
        // Advisory-only import-cycle detection (never blocks/fails a build — most JS/TS cycles are
        // benign; ES modules tolerate them and type-only cycles are harmless). Surfaced so the
        // reviewer/repair pass and the admin diagnostics can see a genuine runtime-hazard loop; never
        // auto-"fixed" because breaking a cycle can change behaviour.
        // IMPORT-TURN HONESTY (mitrify autopsy 2026-07-27): on an import/survey turn every finding below
        // is an OBSERVATION about the user's pre-existing repo, computed from a knowingly PARTIAL file map
        // (binaries/oversize files are dropped by design). `importTurnObservation` records those as honest
        // ADVISORY notes so they can never be counted as OUR unresolved defects or become the build's
        // rootCause — which is exactly what made a successful survey report "14 unresolved problems" with
        // an unused-dependency hint as its headline cause. Unchanged on a real build/edit turn.
        const obs = (message: string) => importTurnObservation(isImportTurn, message);
        // MISSING SPA FALLBACK (ROADMAP #1 Phase 4.1) — the "Cannot GET /customer/home" class. Until now
        // this was only ever noticed AFTER the fact, by the preview verifier, as a symptom with no named
        // cause; the report said the preview did not render and the autopsy had to guess why. This names
        // it exactly, from the code, before the user ever meets it.
        //
        // Reported, not auto-written: the fix has to land AFTER the app's own API routes, and where that
        // is depends on a file we did not write. Inserting it at the wrong line would make the catch-all
        // answer the app's own /api calls with HTML — turning a routing bug into a broken API, which is
        // strictly worse than the bug being fixed. The C9 repair pass takes it from here with the exact
        // snippet, which is the difference between a hint and an instruction.
        try {
          const spa = analyzeSpaFallback(integrityFiles);
          if (spa) {
            buildDiag.record({
              phase: 'build',
              severity: 'warning',
              code: 'SPA_FALLBACK_MISSING',
              ...obs(spa.message),
              detail: `Client router found in ${spa.routerFile}. Add to ${spa.file}:\n${spaFallbackSnippet(spa)}`,
            });
          }
        } catch { /* a deterministic check must never break a build */ }
        // DB-COUPLED BOOT — the "zombie server" (admin task 3, 2026-08-05; sibling of the SPA-fallback
        // check above, verified end-to-end against the Mitrify repo): page serving awaited BEHIND an
        // unguarded database call, so a down database kills the boot half-way and every page answers
        // "Cannot GET /…" while the port looks alive. Reported with the proven fix as an instruction;
        // never auto-written — the record's message carries the permission ask, and the user's reply
        // is the permission (an import turn's files stay untouched, as asked).
        try {
          const zombie = analyzeDbCoupledBoot(integrityFiles);
          if (zombie) {
            buildDiag.record({
              phase: 'build',
              severity: 'warning',
              code: 'DB_COUPLED_BOOT',
              ...obs(`${zombie.message} ${dbCoupledBootFixOffer()}`),
              detail: dbCoupledBootFixInstruction(zombie),
            });
          }
        } catch { /* a deterministic check must never break a build */ }
        // Plan the route smoke check HERE, where the full project map is already loaded (see the
        // POST_ANSWER_TIMING note above — re-loading it later would pay that cost twice for nothing).
        try { routeSmokePlan = planSmokeChecks(Object.entries(integrityFiles).map(([path, content]) => ({ path, content }))); }
        catch { /* planning is best-effort — no plan simply means no smoke check */ }
        for (const c of findCircularDependencies(integrityFiles)) {
          const loop = c.cycle.length === 1
            ? `${c.cycle[0]} imports itself`
            : `${c.cycle.join(' → ')} → ${c.cycle[0]}`;
          buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_CIRCULAR_DEP', ...obs(`Circular import dependency: ${loop}. Many JS/TS cycles are harmless; if this one breaks at runtime (undefined-on-import), break the loop by moving the shared symbol into a third module both sides import.`) });
        }
        // Advisory-only unused-dependency detection (detection, NOT pruning — a declared dep can be
        // used via config/CLI/runtime, so removing it is unsafe; never blocks/fails a build). Only
        // runtime "dependencies" are inspected, with a conservative implicit-use allowlist.
        for (const u of findUnusedDependencies(integrityFiles)) {
          buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_UNUSED_DEP', ...obs(`"${u.name}" is declared in package.json dependencies but no project file imports it. If it is used only via config, a CLI, or a runtime string-load, ignore this; otherwise removing it shrinks the install.`) });
        }
        if (!integrity.ok) {
          if (integrity.focusOwners.length >= 2) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_FOCUS_CONFLICT', ...obs(`${integrity.focusOwners.length} components grab initial focus: ${integrity.focusOwners.map((o) => `${o.file} (${o.mechanism})`).join(', ')} — only one may own initial focus.`) });
          }
          for (const d of integrity.duplicateStylesheets) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_DUPLICATE_STYLESHEET', ...obs(`"${d.stylesheet}" imported by ${d.importers.length} modules: ${d.importers.join(', ')}.`) });
          }
          for (const o of integrity.orphanStylesheets) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_ORPHAN_STYLESHEET', ...obs(`"${o.stylesheet}" is imported by nothing (no module import, no HTML link) — the app ships unstyled unless it is wired in.`) });
          }
          for (const e of integrity.duplicateEntryPoints) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_DUPLICATE_ENTRY', ...obs(`${e.entries.length} files each mount a React root: ${e.entries.join(', ')}. The preview boots one; the others are dead and can serve the wrong app — keep the single served entry and remove the extra root mount(s).`) });
          }
          for (const d of integrity.duplicateComponentModules) {
            buildDiag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_DUPLICATE_MODULE', ...obs(`"${d.module}" exists in ${d.copies.length} places across different convention roots: ${d.copies.join(', ')}. Their interfaces drift and break the build (TaskForge autopsy). Keep the copy the app's entry imports; make each other copy a re-export stub from it (never delete the directory — governance refuses that).`) });
          }
          // Bounded LLM self-heal (flag-gated, default OFF). Never blocks or fails the build — a heal
          // that can't fix leaves the honest warnings above and the app still ships. NEVER on an
          // import/survey turn (mitrify autopsy 2026-07-24): the user said "do not change any files yet",
          // so the heal must not edit the imported project — the warnings above stay advisory (matches the
          // C9 reviewer-autofix `!isImportTurn` gate). `expectsArtifacts` is false on every import turn.
          if (shouldRunIntegrityHeal({ gateEnabled: envFlag('AGENTV3_INTEGRITY_GATE'), resultOk: result.ok, expectsArtifacts, aborted: abort.signal.aborted })) {
            events.emit({ type: 'narration', agent: 'architect', text: '🔧 Fixing project-integrity issues (focus ownership / duplicate stylesheet)…', ts: Date.now() });
            try {
              const integrityRunner = new AgentRunner({
                ...baseRunnerOpts,
                client: buildTurnRunner(healRunnerOpts()),
                model: resolveModel(powerLevelReqEffective),
                persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
              });
              const healed = await integrityRunner.run(
                `The app is built and compiles. Fix ONLY these project-integrity defects — make the smallest ` +
                `possible edits to the existing files, change nothing else:\n\n${integrityRepairInstruction(integrity)}`,
              );
              if (healed.ok) {
                // SUMMARY HONESTY (FitPulse autopsy 2026-07-17): the heal run's final narration used to
                // REPLACE the build summary — a no-op heal shipped "It seems there's a misunderstanding…
                // I will not make any changes." as the user's build result. Keep the REAL build summary;
                // the heal contributes its edits, never its chatter.
                result = { ...healed, summary: result.summary };
                const after = analyzeProjectIntegrity(Object.fromEntries(writtenFiles));
                if (after.ok) buildDiag.record({ phase: 'build', severity: 'info', code: 'INTEGRITY_HEALED', message: 'Project-integrity issues fixed (single focus owner; no duplicate stylesheet).', autoResolved: true });
              }
            } catch { /* self-heal is best-effort — the honest warnings stand */ }
          }
        }

        // PER-PAGE DESIGN COVERAGE (admin report 2026-08-11: "1st page beautiful, andar ke page bas HTML
        // feel dete hai"). Every other gate asks whether the styling is WIRED and CONSISTENT; none asked
        // whether a given page is DESIGNED. A page of bare divs typechecks, lints, passes CssConsistency
        // (it uses nothing, so nothing is undefined) and passes the integrity check (the stylesheet IS
        // imported — by the good first page). So the whole stack was blind to exactly this defect while
        // the model's own behaviour produced it: full effort on screen one, bare markup by screen five.
        //
        // Deterministic detection → costs nothing on a clean build. Advisory ALWAYS; the repair is
        // bounded and flag-gated, and neither can fail a build — a working app with a plain page ships.
        try {
          // SERVICE GRAPH (multi-service, §32 of the 2026-08-11 directive). Advisory and deterministic:
          // it only DESCRIBES which processes the project consists of, their ports and their start
          // order. Nothing is started from it yet — and that is deliberate. Before building a
          // multi-process runner we need to know how often a real project even has a second service,
          // which is exactly what this record measures. Building the runner first would be the same
          // mistake as scoring a benchmark nobody ran.
          try {
            const sgFiles = Object.fromEntries(writtenFiles);
            const sgPaths = Object.keys(sgFiles);
            const mono = detectMonorepo(sgPaths, sgFiles);
            const graph = buildServiceGraph({ contents: sgFiles, packageDirs: mono.packageDirs });
            if (graph.services.length > 0) {
              buildDiag.record({
                phase: 'build',
                severity: 'info',
                code: graph.multiService ? 'SERVICE_GRAPH_MULTI' : 'SERVICE_GRAPH_SINGLE',
                message: graph.summary + (graph.multiService
                  // Say the limitation out loud rather than let a green build imply all of it ran.
                  ? ' ⚠️ Only the primary service is started today; the others are described, not run.'
                  : ''),
                autoResolved: true,
              });
            }
          } catch { /* the service graph is advisory — it can never affect a build */ }

          // ARCHITECTURE INVARIANTS (Mission 10/10 Phase 1) — the DETECT half of the same rules that
          // were handed to the builder before it wrote anything. Deterministic, no model call, purely
          // advisory: it costs nothing on a clean build and can never fail one.
          //
          // The baseline is the project as it was BEFORE this build touched it. Deriving from the
          // finished project instead would let a build that broke the convention across five new files
          // REDEFINE the convention and then report itself clean — the measurement equivalent of
          // marking your own exam.
          if (process.env.AGENTV3_ARCH_INVARIANTS !== 'off') {
            try {
              // The project as it was BEFORE this build touched it.
              const invariantBaseline: Record<string, string> = {};
              for (const [p, c] of Object.entries(storeFiles)) {
                if (!writtenFiles.has(p)) invariantBaseline[p] = c;
              }
              // The IMPORT graph has to be filtered to the baseline too, and so do the dependencies
              // read out of it. Otherwise a build that adds styled-components to a Tailwind app makes
              // the project look like it has always used two styling systems, the invariant dissolves,
              // and the very edit that broke it reports itself clean.
              const graphImports = getWorkspaceMemory(workspaceId).graph().imports;
              const baseImports: Record<string, string[]> = {};
              const baseDeps = new Set<string>();
              for (const [f, specs] of Object.entries(graphImports)) {
                if (writtenFiles.has(f)) continue;
                baseImports[f] = specs;
                for (const s of specs) {
                  if (!s.startsWith('.') && !/^(@|~)\//.test(s)) {
                    baseDeps.add(s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
                  }
                }
              }
              const baseInvariants = deriveInvariants({
                files: Object.keys(invariantBaseline),
                imports: baseImports,
                dependencies: [...baseDeps],
                contents: invariantBaseline,
              });
              if (baseInvariants.length > 0) {
                const broken = checkInvariants(baseInvariants, Object.fromEntries(writtenFiles));
                for (const v of broken) {
                  buildDiag.record({
                    phase: 'build',
                    severity: 'warning',
                    code: 'ARCHITECTURE_INVARIANT_VIOLATED',
                    ...obs(`${v.file} breaks how this app is built — ${v.detail}. ${v.rule}`),
                  });
                }
                if (broken.length === 0) {
                  // Recorded on a clean build too: a check that only ever speaks up when it finds
                  // something leaves no evidence that it ran at all, and an unproven check is exactly
                  // what this whole mission is about.
                  buildDiag.record({
                    phase: 'build', severity: 'info', code: 'ARCHITECTURE_INVARIANTS_HELD',
                    message: invariantSummary(baseInvariants, broken), autoResolved: true,
                  });
                }
              }
            } catch { /* architecture invariants are advisory — they can never affect a build */ }
          }

          const designFiles = Object.fromEntries(writtenFiles);
          const design = analyzeDesignCoverage(designFiles);
          if (!design.ok) {
            for (const finding of design.findings.slice(0, 8)) {
              buildDiag.record({
                phase: 'build',
                severity: 'warning',
                code: 'DESIGN_PAGE_INCONSISTENT',
                ...obs(`${finding.file} does not match the app's own design standard (${finding.defects.join(', ')}; ${Math.round(finding.classedRatio * 100)}% of its elements carry a class). ${designCoverageSummary(design)}`),
              });
            }
            if (shouldRunIntegrityHeal({ gateEnabled: envFlag('AGENTV3_DESIGN_GATE'), resultOk: result.ok, expectsArtifacts, aborted: abort.signal.aborted })) {
              events.emit({ type: 'narration', agent: 'architect', text: `🎨 Bringing ${design.findings.length} page(s) up to the app's design standard…`, ts: Date.now() });
              try {
                const designRunner = new AgentRunner({
                  ...baseRunnerOpts,
                  client: buildTurnRunner(healRunnerOpts()),
                  model: resolveModel(powerLevelReqEffective),
                  persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
                });
                const healed = await designRunner.run(
                  `The app is built and compiles. ${designRepairInstruction(design)}`,
                );
                if (healed.ok) {
                  // Same honesty rule as the integrity heal: keep the REAL build summary, take only the
                  // edits. A no-op heal must never replace the user's build result with its own chatter.
                  result = { ...healed, summary: result.summary };
                  const after = analyzeDesignCoverage(Object.fromEntries(writtenFiles));
                  buildDiag.record({
                    phase: 'build',
                    severity: after.ok ? 'info' : 'warning',
                    code: after.ok ? 'DESIGN_HEALED' : 'DESIGN_PARTIALLY_HEALED',
                    // Honest either way: a heal that only fixed some pages must not report success.
                    message: after.ok
                      ? `Every page now uses the app's design system (${design.findings.length} page(s) brought up to standard).`
                      : `Design repair improved ${design.findings.length - after.findings.length} of ${design.findings.length} page(s); ${after.findings.length} still fall short.`,
                    autoResolved: after.ok,
                  });
                }
              } catch { /* design repair is best-effort — the honest warnings stand */ }
            }
          }
        } catch { /* design coverage is best-effort — never blocks a build */ }

        // The measurement the autopsy asked for (see the note above `integrityStartedAt`): how much of
        // the post-answer tail this whole pass owns, and how much of THAT is just loading the project.
        // Recorded even when nothing was found — a fast pass is the evidence that the time is elsewhere.
        buildDiag.record({
          phase: 'build',
          severity: 'info',
          code: 'POST_ANSWER_TIMING',
          message: `Post-answer integrity pass took ${Math.round((Date.now() - integrityStartedAt) / 1000)}s, of which loading the durable project was ${Math.round(storeLoadMs / 1000)}s (${Object.keys(storeFiles).length} files).`,
          autoResolved: true,
        });
      } catch { /* integrity analysis is best-effort — never blocks a build */ }

      // PRE-VERDICT DUPLICATE-IMPORT DEDUPE (build-report autopsy 2026-08-02, buildId a2f32f38): a weak-tier
      // build shipped src/main.tsx with BOTH `import ErrorBoundary from './ErrorBoundary'` AND
      // `import { ErrorBoundary } from "./ErrorBoundary"` → babel "Duplicate declaration ErrorBoundary" → the
      // in-browser preview would not compile → the build FAILED (readiness 38/100). The existing entry-file
      // dedupe sweep (#2016) removes exactly this, but it is gated on `result.ok` and runs AFTER the verdict —
      // so on a build the duplicate itself FAILS, it never fires (chicken-and-egg: the fix is locked behind the
      // success the bug prevents). Run the deterministic, safe-by-construction dedupe (dedupeDuplicateImports —
      // drops ONLY a fully-redundant import whose every binding is already bound from the SAME module by an
      // earlier import; it can never break code, it only removes a binding that already exists) over the written
      // source files HERE — BEFORE the preview-compile check + reviewer judge the build, and UNGATED by
      // result.ok — so the duplicate is gone before it can fail the build, and the build passes on its own
      // instead of needing an LLM heal that the weak tier could not deliver. Persisted to disk + writtenFiles so
      // the fix ships. Additive + best-effort. Kill switch AGENTV3_PREGATE_DEDUPE=off.
      if ((process.env.AGENTV3_PREGATE_DEDUPE ?? '').trim().toLowerCase() !== 'off' && expectsArtifacts && writtenFiles.size > 0) {
        try {
          for (const [p, c] of Array.from(writtenFiles)) {
            if (typeof c !== 'string' || !/\.(mjs|cjs|jsx?|tsx?)$/i.test(p) || /\.d\.ts$/i.test(p)) continue;
            const { content: deduped, removed } = dedupeDuplicateImports(c);
            if (removed.length > 0 && deduped !== c) {
              writtenFiles.set(p, deduped);
              try { await actuator.writeFile(workspaceId, p, deduped); } catch { /* best-effort live write */ }
              try { getWorkspaceMemory(workspaceId).indexFile(p, deduped); } catch { /* index best-effort */ }
              await saveWorkspaceFiles(workspaceId, { [p]: deduped }).catch(() => {});
              buildDiag.record({ phase: 'build', severity: 'info', code: 'DUPLICATE_IMPORT_DEDUPED', message: `Removed ${removed.length} fully-redundant duplicate import(s) from ${p} before the compile check: ${removed.join('; ')}`.slice(0, 400), autoResolved: true });
            }
          }
        } catch { /* pre-verdict dedupe is best-effort — never blocks or fails a build */ }
      }

      // PREVIEW-COMPILE GUARD (autopsy 2026-07-22, buildId 91694679): the in-browser preview transpiles
      // with Babel — a DIFFERENT compiler from both the build's tsc gate AND the E2B/vite (esbuild)
      // preview. Code can pass tsc, render in E2B, and still white-screen in the in-browser Babel preview
      // the user actually opens (the reported `declare`-class-field case). The old "✅ Preview verified"
      // only ever exercised the E2B surface, so this whole class of compiler-divergence shipped as
      // "verified". This guard dry-compiles every source file through the SAME Babel config the in-browser
      // preview uses (checkPreviewCompiles) — a throw here reproduces a real in-browser failure — and,
      // when the auto-fix gate is on, makes ONE bounded repair pass. Additive + best-effort: it records an
      // honest admin diagnostic and never changes result.ok, the bill, or the browser-verify verdict below.
      // Disable with AGENTV3_PREVIEW_COMPILE_CHECK=off.
      if (process.env.AGENTV3_PREVIEW_COMPILE_CHECK !== 'off' && result.ok && expectsArtifacts && writtenFiles.size > 0) {
        try {
          let compile = checkPreviewCompiles(Object.fromEntries(writtenFiles));
          if (!compile.ok) {
            const firstMsg = compile.errors[0] ? `${compile.errors[0].file}: ${compile.errors[0].message}` : 'in-browser preview compile failed';
            buildDiag.record({ phase: 'preview', severity: 'error', code: 'PREVIEW_COMPILE_DIVERGENCE', message: `in-browser preview would not compile — ${firstMsg}`.slice(0, 400), autoResolved: false, detail: `${compile.errors.length} file(s)` });
            // Bounded LLM self-heal — same gate/pattern as the runtime auto-fix loop and the integrity
            // heal. Only fires when a REAL divergence exists (the app already white-screens in-browser),
            // once, with time to spare. Never blocks or fails the build.
            const timeLeft = effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000;
            if (autoFixEnabled() && !abort.signal.aborted && timeLeft) {
              events.emit({ type: 'narration', agent: 'architect', text: '🔧 Fixing a preview compile issue so the live preview renders…', ts: Date.now() });
              const compileHealRunner = new AgentRunner({
                ...baseRunnerOpts,
                client: buildTurnRunner(healRunnerOpts()),
                model: resolveModel(powerLevelReqEffective),
                persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
              });
              const healed = await compileHealRunner.run(previewCompileRepairInstruction(compile.errors));
              if (healed.ok) {
                result = { ...healed, summary: result.summary }; // keep the REAL build summary; take the heal's edits
                compile = checkPreviewCompiles(Object.fromEntries(writtenFiles));
                if (compile.ok) {
                  buildDiag.record({ phase: 'preview', severity: 'info', code: 'PREVIEW_COMPILE_HEALED', message: 'in-browser preview compile issue fixed — the live preview now compiles.', autoResolved: true });
                }
              }
            }
            // BILLING HONESTY (autopsy 2026-08-01, buildId 1047276c — charged ₹88.82 for a preview that
            // would not compile): if the divergence SURVIVED the heal AND hits a guaranteed-reachable ENTRY
            // file (main/App/index — the reported "Duplicate declaration" in App.tsx), the live preview the
            // user opens genuinely white-screens → this is NOT a delivered working app. Flip to ok:false so
            // the verdict is honest AND the "working app or free" guard makes it FREE (never charge for a
            // preview the user can't see). Scoped to entry files so a broken-but-unimported source file
            // (this module's documented reachability limit) never falsely fails a working build.
            if (result && result.ok && !compile.ok && previewDivergenceBlocksDelivery(compile.errors)) {
              // Flip result.ok only — buildResultRef (the deadline-finalizer's snapshot) isn't set yet here
              // and is captured downstream ONLY `if (result.ok)`, so this flip keeps both exits honest and
              // the normal-settle billing (which keys on result.ok) makes the build free.
              result = { ...result, ok: false, summary: previewCompileUnresolvedSummary() };
              buildDiag.record({ phase: 'preview', severity: 'error', code: 'OUTCOME_PREVIEW_COMPILE', message: `The live in-browser preview does not compile (entry file: ${compile.errors.find((e) => previewDivergenceBlocksDelivery([e]))?.file ?? 'entry'}) — the build is not fully working and was not charged.`, autoResolved: false });
            }
          }
        } catch { /* preview-compile guard is best-effort — never blocks a build */ }
      }

      // POST-BUILD RULES-OF-HOOKS HEAL + HONEST RE-JUDGE (build-report autopsy 2026-08-02, buildId
      // 84902e18): a weak-tier invoicing app shipped `useMemo` called conditionally (useDashboardStats.ts:16)
      // → React crashes at runtime → the readiness gate correctly downgraded it to NOT READY 32/100. But
      // there was NO heal for a hooks violation (unlike the preview-compile guard directly above): the
      // write-time steering note was the ONLY defence, and a weak coder that ignores it had no second chance,
      // so the build just failed. Add a bounded, FOCUSED heal — when a FAILED artifact build has a real
      // Rules-of-Hooks violation, hand the healer the EXACT file:line / hook / rule broken
      // (hooksRepairInstruction) for a single repair pass, then RE-JUDGE through the SAME readiness gate and
      // recover the build to OK only when the gate GENUINELY passes (double-gated: hooks now clean AND
      // assessBuildReadiness ready) — so the verdict is never falsely flipped. The heal's writes reach
      // writtenFiles via the shared onFileWrite, so the re-analysis sees the fix. Weak-tier routed (no
      // Sonnet/Opus on a free build, per policy). Best-effort — never blocks a build. Kill switch
      // AGENTV3_HOOKS_HEAL=off.
      if ((process.env.AGENTV3_HOOKS_HEAL ?? '').trim().toLowerCase() !== 'off'
        && result && !result.ok && expectsArtifacts && writtenFiles.size > 0 && autoFixEnabled() && !abort.signal.aborted) {
        try {
          const hooksReport = await analyzeHooksRules(Object.fromEntries(writtenFiles));
          const timeLeft = effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000;
          if (!hooksReport.ok && hooksReport.violations.length > 0 && timeLeft) {
            events.emit({ type: 'narration', agent: 'architect', text: '🔧 Fixing a React hooks issue so the app runs without crashing…', ts: Date.now() });
            const hooksHealRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner(healRunnerOpts()),
              model: resolveModel(powerLevelReqEffective),
              persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
            });
            const healed = await hooksHealRunner.run(hooksRepairInstruction(hooksReport));
            if (healed.ok) {
              const after = await analyzeHooksRules(Object.fromEntries(writtenFiles));
              if (after.ok) {
                buildDiag.record({ phase: 'build', severity: 'info', code: 'HOOKS_RULES_HEALED', message: `Fixed ${hooksReport.violations.length} React Rules-of-Hooks violation(s) — the app no longer crashes at runtime.`, autoResolved: true });
                // Recover the build to OK only if the FULL readiness gate now passes (not just hooks) — so a
                // build with OTHER unresolved blockers stays honestly NOT-ready.
                if (readinessGateEnabled()) {
                  try {
                    const verdict = await dispatcher.assessBuildReadiness();
                    if (verdict.ready) {
                      result = { ...result, ok: true, summary: 'Built your app — a React Rules-of-Hooks issue was detected and automatically fixed, so it now runs correctly.' };
                      buildDiag.record({ phase: 'build', severity: 'info', code: 'READINESS_RECOVERED_AFTER_HOOKS_HEAL', message: `Readiness re-judged after the hooks heal: now READY (score ${verdict.score}/100).`, autoResolved: true });
                    }
                  } catch { /* re-judge is best-effort — the honest NOT-ready verdict stands */ }
                }
              }
            }
          }
        } catch { /* hooks heal is best-effort — never blocks or fails a build */ }
      }

      // BOOT-KILLER HEAL — the second half of the missing-credential contract (admin 2026-08-03: "us option
      // ko 'coming soon' likh kar freeze kar do, puri app band na ho"). The contract is injected into the
      // builder's prompt so the FIRST build is already correct; injecting a rule is NOT proof it was
      // followed, and the 50/50 law is explicit that if a problem still slips through, the heal must be
      // REAL, not best-effort cosmetics. So: detect the exact fatal pattern the contract forbids — a
      // top-level `throw`/`process.exit` gated on a missing env var — and, when found, run ONE bounded,
      // FOCUSED repair pass with the exact file:line, then RE-DETECT and report the truth either way.
      //
      // Deliberately NOT gated on `!result.ok`: this defect ships on a build that looks perfectly
      // successful — every gate passes because the key is only missing at the USER'S runtime, not ours.
      // That is precisely why it reached production before. The verdict is never flipped by this heal (a
      // build that failed stays failed); it only removes the landmine. Weak-tier routed (no Sonnet/Opus on
      // a free build). Costs an extra pass ONLY when a real boot-killer exists — a clean build pays nothing.
      // Best-effort + time-budgeted + abortable. Kill switch AGENTV3_CREDENTIAL_GUARD=off.
      if (credentialGuardEnabled() && expectsArtifacts && writtenFiles.size > 0 && !abort.signal.aborted) {
        try {
          // RETROACTIVE SWEEP (admin 2026-08-03, "han karo"): on a FRESH build `writtenFiles` IS the whole
          // app, but on an EDIT of an app built BEFORE the contract shipped, it holds only the handful of
          // files this turn touched — so a boot-killer sitting in an untouched file (the common case for an
          // OLD app) was invisible and shipped again. Scan the STORED workspace too, with this turn's
          // writes layered on top (newer wins), so every pre-existing boot-killer is found the next time
          // that app is built. Bounded to edit mode (a fresh build needs no extra read) and best-effort —
          // a store failure falls back to writtenFiles alone rather than skipping the check.
          let scanFiles: Map<string, string> | Record<string, string> = writtenFiles;
          if (isEditMode) {
            const stored = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
            if (Object.keys(stored).length > 0) {
              const merged = new Map<string, string>(Object.entries(stored));
              for (const [p, c] of writtenFiles) merged.set(p, c); // this turn's writes are the newer truth
              scanFiles = merged;
            }
          }
          const killers = findBootKillingEnvGuards(scanFiles);
          if (killers.length > 0) {
            buildDiag.record({
              phase: 'build', severity: 'warning', code: 'BOOT_KILLING_ENV_GUARD', autoResolved: false,
              message: bootKillingGuardSummary(killers).slice(0, 400),
            });
            const timeLeft = effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000;
            if (autoFixEnabled() && timeLeft) {
              events.emit({ type: 'narration', agent: 'architect', text: '🔧 Making sure a missing key freezes just that one feature instead of stopping the whole app…', ts: Date.now() });
              const guardHealRunner = new AgentRunner({
                ...baseRunnerOpts,
                client: buildTurnRunner(healRunnerOpts()),
                model: resolveModel(powerLevelReqEffective),
                persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
              });
              const healed = await guardHealRunner.run(bootKillerRepairInstruction(killers));
              // Re-detect over the SAME file set, with the heal's writes layered on (they land in
              // writtenFiles via onFileWrite), so the report states what is actually true now — never
              // "healed" on the healer's own say-so. Re-layering matters for the retroactive sweep: the
              // untouched old files are still in `scanFiles`, so a heal that fixed only some of them
              // honestly reports the rest as UNRESOLVED instead of vanishing with the stale snapshot.
              const afterFiles = new Map<string, string>(scanFiles instanceof Map ? scanFiles : Object.entries(scanFiles));
              for (const [p, c] of writtenFiles) afterFiles.set(p, c);
              const after = findBootKillingEnvGuards(afterFiles);
              if (healed.ok && after.length === 0) {
                buildDiag.record({
                  phase: 'build', severity: 'info', code: 'BOOT_KILLING_ENV_GUARD_HEALED', autoResolved: true,
                  message: `Removed ${killers.length} boot-killing env guard(s) — a missing key now freezes only that feature ("Coming soon") instead of taking the whole app down.`,
                });
              } else {
                buildDiag.record({
                  phase: 'build', severity: 'warning', code: 'BOOT_KILLING_ENV_GUARD_UNRESOLVED', autoResolved: false,
                  message: `Heal pass did not clear every boot-killing env guard — ${after.length} remain. ${bootKillingGuardSummary(after)}`.slice(0, 400),
                });
              }
            }
          }
        } catch { /* the guard heal is best-effort — never blocks or fails a build */ }
      }

      // PREVIEW SELF-CHECK + HEAL (default-on when a browser sandbox is available): v5.0 used to
      // claim "preview published" after only a port check (port-up ≠ the app rendered). Here it
      // actually OPENS the running app in a real browser, READS the rendered DOM + console, and
      // judges honestly whether it works — then makes ONE bounded repair pass if it didn't, and
      // re-verifies. This is what makes v5.0 AWARE of its own preview and able to fix what it sees.
      // Best-effort, time-budgeted, abortable — it can never break or hang the build. Disable with
      // AGENTV3_PREVIEW_VERIFY=off.
      // Admin rule (2026-07-07, "preview theek chala to hi paise len"): when v5.0's own eyes — the
      // real-browser verification below — conclude the delivered preview does NOT render even after
      // the bounded self-heal, that build is not a delivered app and must not be billed. Server-side
      // verdict only (a client-reported failure can never zero a bill — not spoofable).
      // RENDER RESCUE (admin 2026-07-30, autopsy: "app ban gayi, preview chal raha hai, par chat me
      // error, build health 0, aur bill 0 — mera API kharcha hua par user ka bill 0"). Root cause: a
      // build can finish `ok:false` (the agent hit a late tool error, ran out of steps, or a false
      // "replied-without-building") YET have actually WRITTEN the app AND the live preview genuinely
      // renders. Everything downstream keys off `result.ok`, so that working app is reported three
      // wrong ways at once: the chat shows a failure, build-health reads 0, and — worst — the bill is
      // zeroed (`zeroBillForFailedBuild`), so NavBharatAI eats the real API cost while the user pays
      // ₹0. v5.0's OWN real-browser eyes are already the trusted authority that DOWNGRADES a bill when
      // the preview doesn't render; here we use the SAME authority to UPGRADE: if `ok:false` but files
      // were written and the live preview renders cleanly (no actionable console errors), the app is
      // real — mark the build `ok:true` so health, the bill and the chat verdict all tell the truth.
      // Best-effort + abortable + flag-gated (kill switch AGENTV3_RENDER_RESCUE=off); on any doubt it
      // leaves `ok:false` untouched (never a fake success). Recorded as RENDER_RESCUE so the admin can
      // see how often the upstream ok-verdict was wrong and chase that cause too (rule 5, 50/50 law).
      let renderRescued = false;
      // GREEN GUARD (admin 2026-08-09: "app banne ke baad kharab nahi honi chahiye"). The single
      // EARNED green signal for this turn: set only where the preview was genuinely opened in a real
      // browser and rendered. Both places that call recordPreviewVerified() set it, and nothing else
      // may — a build that merely "finished" is not proof the app works, and protecting a state we
      // never verified would be the same lie in a new place.
      let previewGreen = false;
      if (
        process.env.AGENTV3_RENDER_RESCUE !== 'off'
        && renderRescueEligible({ ok: result.ok, expectsArtifacts, filesWritten: writtenFiles.size })
        && lastPreviewUrl && actuator.browseUrl && !abort.signal.aborted
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 30_000)
      ) {
        try {
          const shot = await withTimeout(actuator.browseUrl(workspaceId, lastPreviewUrl), 35_000, 'browseUrl');
          const verdict = analyzePreviewHtml(shot.html, { painted: shot.painted, source: shot.source });
          let consoleErrs: string[] = [];
          try { if (actuator.getConsoleErrors) consoleErrs = filterActionableErrors((await actuator.getConsoleErrors(workspaceId, buildStartedAt)).errors).map((e) => e.text); } catch { /* console capture best-effort */ }
          // A deterministic runtime-crash blocker (a Rules-of-Hooks violation etc.) renders fine on the
          // first paint and crashes on a later re-render — a one-shot snapshot can't see it, so it must
          // veto the rescue (real report 8a6e4585: useMemo@useChartData.ts:86 crashed the preview the
          // admin actually saw, yet the rescue upgraded to success). The full-workspace readiness result
          // that found it is already on the diagnostics timeline — no re-analysis.
          const runtimeCrashBlocker = buildDiag.hasRuntimeCrashBlocker();
          if (renderRescueConfirmsSuccess({ rendered: verdict.rendered, consoleErrorCount: consoleErrs.length, runtimeCrashBlocker })) {
            result = { ...result, ok: true, summary: result.summary || 'The app builds and the live preview renders correctly.' };
            renderRescued = true;
            previewGreen = true; // real browser, real render — the one thing worth protecting
            // GREEN FREEZE — the app is proven working. From here, refuse edits to its existing files
            // unless an allowlisted pass (the user's own request) makes them, so no later pass can
            // silently break what the browser just rendered. Snapshot the files present now. Best-effort.
            try {
              // Only latch on a REAL browser render — never on a curl fallback, whose empty-shell
              // "render" cannot be trusted (adversarial review 2026-08-12). A curl-verified build simply
              // does not engage the freeze rather than freeze on a false positive.
              if (greenFreezeEnabled() && shot.source === 'browser' && !isGreenLatched(workspaceId)) {
                const present = await actuator.listFiles(workspaceId).catch(() => [...writtenFiles.keys()]);
                latchGreen(workspaceId, present.length ? present : [...writtenFiles.keys()]);
              }
            } catch { /* latching is best-effort — never affects a build */ }
            try { buildDiag.recordPreviewVerified(); } catch { /* diagnostics best-effort */ }
            buildDiag.record({ phase: 'preview', severity: 'info', code: 'RENDER_RESCUE', message: 'Build finished not-ok but the live preview renders cleanly (real-browser verified) — upgraded to success so health, billing and the verdict are honest.', autoResolved: true });
            events.emit({ type: 'narration', agent: 'architect', text: '✅ Your app is built and the live preview renders correctly.', ts: Date.now() });
          } else if (runtimeCrashBlocker && verdict.rendered) {
            // Honest admin trail: the preview PAINTED but a deterministic runtime-crash proof stands, so
            // the rescue stood down and the build stays not-ok (free for the user) instead of a fake success.
            buildDiag.record({ phase: 'preview', severity: 'info', code: 'RENDER_RESCUE_BLOCKED', message: 'Live preview painted on load, but a deterministic runtime-crash defect (e.g. a Rules-of-Hooks violation) will crash it on re-render — NOT upgraded to success: a one-shot render cannot clear a latent runtime crash.', autoResolved: false });
          }
        } catch { /* rescue is best-effort — on any failure the build stays ok:false (never a fake success) */ }
      }

      let previewVerifiedFailed = false;
      // The POSITIVE counterpart. Without it the runtime verdict below could report "no live preview
      // session" for a build whose preview had just been opened and confirmed rendering — the
      // self-contradicting report from the Shiv Medical Store autopsy (2026-08-10).
      let previewVerifiedRendered = false;
      if (
        process.env.AGENTV3_PREVIEW_VERIFY !== 'off' && result.ok && !renderRescued && lastPreviewUrl && actuator.browseUrl
        && !abort.signal.aborted
        // Only if there's comfortable time left before the wall-clock cap (verify + a heal pass).
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000)
      ) {
        const healMax = autoFixEnabled() ? Math.max(1, autoFixMaxAttempts()) : 1; // ≥1 fix attempt
        // Restarting a dead process is NOT a repair attempt and must not spend the repair budget —
        // otherwise one crashed dev server silently costs the app its only chance at a real fix. Bounded
        // on its own so a server that refuses to stay up cannot loop.
        const MAX_SERVER_REVIVALS = 2;
        let serverRevivals = 0;
        for (let attempt = 0; attempt <= healMax && !abort.signal.aborted; attempt++) {
          let shot: { html: string; painted?: boolean; source?: 'browser' | 'curl' };
          try {
            shot = await withTimeout(actuator.browseUrl(workspaceId, lastPreviewUrl), 35_000, 'browseUrl');
          } catch { break; /* couldn't open the preview (no browser / timeout) — skip silently */ }
          const html = shot.html;
          const verdict = analyzePreviewHtml(html, { painted: shot.painted, source: shot.source });
          let consoleErrs: string[] = [];
          try {
            if (actuator.getConsoleErrors) consoleErrs = filterActionableErrors((await actuator.getConsoleErrors(workspaceId, buildStartedAt)).errors).map((e) => e.text);
          } catch { /* console capture is best-effort */ }
          if (verdict.rendered && consoleErrs.length === 0) {
            events.emit({ type: 'narration', agent: 'architect', text: '✅ Preview verified — I opened the running app in a browser and it renders correctly.', ts: Date.now() });
            // Honesty upgrade (autopsy 2026-07-11): the real-browser check just CONFIRMED the app renders,
            // so the deferred previewOk signal is now TRUE — upgrade OUTCOME_BUILD_PARTIAL → BUILD_SUCCESS
            // (the upgrade SimpleBuilder left to the route). Without this a verified-working app was
            // permanently reported as BUILD_PARTIAL. No-ops unless the last outcome was PARTIAL/PREVIEW_FAILED.
            previewGreen = true; // opened in a real browser, rendered, and no console errors
            // GREEN FREEZE — the app is proven working. From here, refuse edits to its existing files
            // unless an allowlisted pass (the user's own request) makes them, so no later pass can
            // silently break what the browser just rendered. Snapshot the files present now. Best-effort.
            try {
              // Only latch on a REAL browser render — never on a curl fallback, whose empty-shell
              // "render" cannot be trusted (adversarial review 2026-08-12). A curl-verified build simply
              // does not engage the freeze rather than freeze on a false positive.
              if (greenFreezeEnabled() && shot.source === 'browser' && !isGreenLatched(workspaceId)) {
                const present = await actuator.listFiles(workspaceId).catch(() => [...writtenFiles.keys()]);
                latchGreen(workspaceId, present.length ? present : [...writtenFiles.keys()]);
              }
            } catch { /* latching is best-effort — never affects a build */ }
            try { buildDiag.recordPreviewVerified(); } catch { /* diagnostics best-effort */ }
            // APP HEALTH CULTURE (slice 1, admin 2026-07-12 "culture, not just stain"): the app RENDERS
            // — now check it actually has the interactive features the user asked for (Add/Delete/Filter…
            // present as real controls in the running DOM). Deterministic + ADVISORY: records an honest
            // FEATURE_COVERAGE finding in the report (present vs missing); it NEVER blocks a build (a
            // heuristic must never false-fail a working app). Auto-fixing the gaps is the next slice.
            try {
              let coverage = checkFeaturePresence(prompt, html);
              // APP HEALTH CULTURE slice 2 (Phase 1b, opt-in AGENTV3_FEATURE_HEAL=on): the app renders
              // but a REQUESTED control is missing → run ONE bounded heal pass that adds the missing UI,
              // then re-open the running app and re-probe (only a control now in the live DOM counts).
              // Budget-gated + abortable; if the control still isn't there, the honest FEATURE_COVERAGE
              // warning below still stands. Never blocks or fails a build.
              if (
                coverage.missing.length > 0 && featureHealEnabled(workspaceId) && !abort.signal.aborted
                && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 60_000)
              ) {
                events.emit({ type: 'narration', agent: 'architect', text: `🧪 The app runs, but I don't see a control for: ${coverage.missing.join(', ')}. Adding it now…`, ts: Date.now() });
                try {
                  const featureRunner = new AgentRunner({
                    ...baseRunnerOpts,
                    client: buildTurnRunner(healRunnerOpts()),
                    model: resolveModel(powerLevelReqEffective),
                    persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
                  });
                  const healed = await runInPass('feature-presence-heal', () => featureRunner.run(featurePresenceRepairPrompt(coverage)));
                  if (healed.ok) {
                    result = healed;
                    try {
                      const after = (await withTimeout(actuator.browseUrl(workspaceId, lastPreviewUrl), 35_000, 'browseUrl')).html;
                      const afterCoverage = checkFeaturePresence(prompt, after);
                      if (afterCoverage.probes.length > 0) coverage = afterCoverage;
                    } catch { /* re-open best-effort — keep the pre-heal coverage */ }
                  }
                } catch (e) {
                  console.log(`[AGENTV3] feature heal failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
              if (coverage.probes.length > 0) {
                buildDiag.record({
                  phase: 'readiness',
                  severity: coverage.missing.length > 0 ? 'warning' : 'info',
                  code: 'FEATURE_COVERAGE',
                  message: featurePresenceSummary(coverage),
                  autoResolved: coverage.missing.length === 0,
                });
              }
            } catch { /* feature-presence is best-effort — never blocks a verified build */ }
            previewVerifiedRendered = true; // the eyes SAW it render — the runtime verdict must not deny it
            break;
          }
          // THE DEV SERVER IS DEAD — RESTART A PROCESS, DO NOT REWRITE AN APP (admin build transcript
          // 2026-08-12: a 44m50s / ₹42.16 build of one home page). Three times the preview came back
          // "closed port"; three times a full LLM repair pass ran; all three times the model read the
          // files, found nothing wrong, restarted the dev server and reported "No code changes were
          // needed — the app itself is fine." We were paying a language model to be a process
          // supervisor, at minutes and rupees per restart, and it edited working code while it was in
          // there. A code repair cannot fix a dead process; nothing in the repair prompt ("fix imports,
          // undefined variables, failed data access, or a crashing component") applies to one.
          //
          // Deterministic, free, and bounded: bring the server back, look again. If it will not stay up
          // after MAX_SERVER_REVIVALS, THAT is the honest finding — and it is an infrastructure finding,
          // not an accusation against the user's code.
          if (verdict.serverDown) {
            if (serverRevivals >= MAX_SERVER_REVIVALS) {
              buildDiag.record({
                phase: 'preview', severity: 'warning', code: 'PREVIEW_SERVER_DOWN',
                message: `The dev server would not stay running (${serverRevivals} restarts). The app's code was never the problem here — nothing was listening on the preview port. ${verdict.problems[0] ?? ''}`.trim(),
                autoResolved: false,
              });
              previewVerifiedFailed = true;
              break;
            }
            serverRevivals += 1;
            events.emit({ type: 'narration', agent: 'architect', text: '🔌 The preview server had stopped — restarting it…', ts: Date.now() });
            try {
              // The health-check wrapper in devServerHost recognises this command, installs stale deps
              // and waits for the port, so this one call is the whole restart.
              await withTimeout(actuator.runCommand(workspaceId, 'npm run dev'), 90_000, 'preview-server-revive');
            } catch { /* the re-check below is the real verdict — a failed restart just means another try */ }
            buildDiag.record({
              phase: 'preview', severity: 'info', code: 'PREVIEW_SERVER_RESTARTED',
              message: `The dev server had stopped and was restarted deterministically (attempt ${serverRevivals}) — no code was changed and no model call was made.`,
              autoResolved: true,
            });
            attempt -= 1; // a process restart is not a repair attempt
            continue;
          }
          const problems = [...verdict.problems, ...consoleErrs.map((e) => `console: ${e}`)];
          // WE COULD NOT SEE THE APP — that is not the same as seeing it broken, and a repair pass here
          // rewrites working code. This is the loop the admin reported on 2026-08-12: a snapshot taken
          // before the app painted read as "a runtime error crashed it", the repair restarted the dev
          // server, the preview really went down, and the cycle repeated for half an hour. With no
          // console error to corroborate it, an inconclusive read stops here — recorded honestly,
          // never acted on.
          if (verdict.inconclusive && consoleErrs.length === 0) {
            buildDiag.record({
              phase: 'preview', severity: 'info', code: 'PREVIEW_UNVERIFIED',
              message: `Could not confirm the preview either way — ${verdict.problems[0] ?? 'the snapshot showed nothing'}. No repair was attempted: rewriting a working app on a snapshot we cannot trust is worse than not knowing.`,
              autoResolved: true,
            });
            break;
          }
          buildDiag.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: problems.slice(0, 4).join(' | ').slice(0, 500), autoResolved: false });
          // Out of repair budget OR the wall-clock cap is near → stop and report honestly.
          if (attempt >= healMax || abort.signal.aborted || (effectiveBuildSeconds > 0 && Date.now() - buildStartedAt > effectiveBuildSeconds * 1000 - 60_000)) {
            previewVerifiedFailed = true; // the eyes saw it NOT render, and the heal budget is spent — billing zeroes below
            // RUNTIME HONESTY (deep-test 2026-07-18 — "onLinkClick is not a function"): the live preview
            // genuinely did NOT render / crashed at RUNTIME and the heal budget is spent. Record it as an
            // UNRESOLVED ERROR so buildHealthFromDiagnostics marks the build NOT READY — a crashing app must
            // never show "READY". (The syntax gate catches a COMPILE break; this catches the RUNTIME class
            // — an uncaught TypeError / a missing prop called as a function — that the parser can't see.)
            buildDiag.record({ phase: 'preview', severity: 'error', code: 'OUTCOME_PREVIEW_FAILED', message: `The live preview did not render/run cleanly after ${healMax} repair attempt(s): ${problems.slice(0, 3).join('; ')}`.slice(0, 500), autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `⚠️ I checked the live preview and it did not fully render: ${problems.slice(0, 3).join('; ')}. Your files are saved — send a follow-up and I'll fix it.`, ts: Date.now() });
            break;
          }
          events.emit({ type: 'narration', agent: 'architect', text: `🔍 I opened the preview and it didn't render correctly (${problems[0]}). Fixing it now…`, ts: Date.now() });
          try {
            const healRunner = new AgentRunner({
              ...baseRunnerOpts,
              client: buildTurnRunner(healRunnerOpts()),
              model: resolveModel(powerLevelReqEffective),
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

      // ROUTE SMOKE CHECK (ROADMAP #1 Phase 4.2). "The build succeeded" and "the app works" are
      // different claims, and only the first one was ever tested: the preview verifier proves a PAGE
      // renders, while nothing proved the API behind it answers. An app could ship with every screen
      // drawn and every button dead, and the report would say it passed.
      //
      // Calls the app's OWN declared routes and reports what actually came back. Two safety rules live
      // in RouteSmokeCheck and are enforced there rather than here: GET only (a check must never run
      // the user's writes against their data) and no path parameters (an invented id 404s, which we
      // would then report as a broken route — a false alarm about working code).
      //
      // Never changes the verdict. This is EVIDENCE for the report, not a new way for a working build
      // to be marked failed on a probe that could be wrong about a route it does not fully understand.
      if (
        process.env.AGENTV3_ROUTE_SMOKE !== 'off' && result.ok && lastPreviewUrl && actuator.runCommand
        && !abort.signal.aborted
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 45_000)
      ) {
        try {
          const plan = routeSmokePlan;
          if (plan && plan.targets.length > 0) {
            const results: SmokeResult[] = [];
            for (const target of plan.targets) {
              if (abort.signal.aborted) break;
              let status: number | null = null;
              try {
                const out = await withTimeout(
                  actuator.runCommand(workspaceId, smokeCurlCommand(lastPreviewUrl, target)),
                  15_000, 'route-smoke',
                );
                status = parseCurlStatus(out.stdout);
              } catch { status = null; }
              results.push(classifySmokeStatus(target, status));
            }
            const summary = summarizeSmoke(results, plan.skipped.length);
            buildDiag.record({
              phase: 'preview',
              // A failure here is a real finding; a clean run is worth recording too, because "we
              // checked and it worked" is the evidence this phase exists to produce.
              severity: summary.hasFailures ? 'warning' : 'info',
              code: summary.hasFailures ? 'ROUTE_SMOKE_FAILED' : 'ROUTE_SMOKE_PASSED',
              message: summary.headline,
              autoResolved: !summary.hasFailures,
              detail: [
                ...results.map((r) => `${r.verdict.toUpperCase()} ${r.path}${r.status === null ? '' : ` (${r.status})`}`),
                ...plan.skipped.map((s) => `SKIPPED ${s.method} ${s.path} — ${s.why}`),
              ].join('\n'),
            });
          }
        } catch { /* the smoke check is evidence, never a gate — a failure here changes nothing */ }
      }

      // DOES EVERY PAGE ACTUALLY RENDER, OR ONLY THE HOME ONE? (admin 2026-08-06 — "E2E auto-run, and
      // make it cheap for the admin".) Three checks already ran and none covers this: the preview
      // verifier loads HOME in a browser, RouteSmokeCheck curls the API, the console capture watches the
      // page the preview opened. So a React/Next app can answer 200 for `/dashboard`, throw during the
      // client-side render, paint a blank screen — and every one of them passes. That is the family the
      // "Cannot GET /customer/home" reports came from.
      //
      // IT IS CHEAP BY CONSTRUCTION, which is why it can run by default: Playwright AND Chromium are
      // PRE-BAKED into both E2B images and `_kickoffPlaywright` already warms them for the screenshot
      // tools. No download, no npm install, no model call — one browser navigation per route, capped at
      // MAX_PAGE_ROUTES, with home skipped because the preview verifier already proved it.
      //
      // EVIDENCE, NEVER A GATE — same rule as the route smoke check: a working build is never marked
      // failed by a probe that could be wrong about a route it does not fully understand.
      if (
        process.env.AGENTV3_PAGE_CHECK !== 'off' && result.ok && lastPreviewUrl && actuator.runCommand
        && !abort.signal.aborted
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 45_000)
      ) {
        try {
          const pageRoutes = extractPageRoutes(Object.fromEntries(writtenFiles));
          if (pageRoutes.length > 0) {
            const out = await withTimeout(
              actuator.runCommand(workspaceId, pageCheckScript(lastPreviewUrl, pageRoutes)),
              20_000 + pageRoutes.length * PAGE_LOAD_TIMEOUT_MS, 'page-route-check',
            );
            const pageResults = parsePageCheck(out.stdout);
            const pageSummary = summarizePageCheck(pageResults, pageRoutes.length);
            // Only when the browser really returned results — an empty parse means the script never
            // produced a line, which is "we do not know", not "every page is fine".
            if (pageResults.length > 0) gateEvidence.pages = pageSummary.ok ? 'passed' : 'failed';
            // §17/§26 — accessibility and performance were already measured here and already printed,
            // and had no bearing on the verdict. They now cost GREEN (never RED — see QualitySignals).
            gateQuality.a11yIssues = a11yIssueCount(pageResults);
            gateQuality.slowRoutes = slowRouteCount(pageResults);
            buildDiag.record({
              phase: 'preview',
              severity: pageSummary.ok ? 'info' : 'warning',
              code: pageSummary.ok ? 'PAGE_RENDER_PASSED' : 'PAGE_RENDER_FAILED',
              message: pageSummary.summary,
              autoResolved: pageSummary.ok,
              detail: pageResults.map((r) => `${r.verdict.toUpperCase()} ${r.note}`).join('\n'),
            });
          }
        } catch { /* evidence, never a gate — a failure here changes nothing about the build verdict */ }
      }

      // DOES THE APP ACTUALLY WORK, OR DOES IT ONLY RENDER? (Mission 10/10 Phase 4, §7)
      //
      // Every check above asks a version of "did it paint". None of them presses a button. So the most
      // common invisible failure in a generated app survives all of them: the UI PRETENDS. You type a
      // task, hit Add, the item appears — because it was pushed into a useState array. You reload and it
      // is gone. The app rendered, threw nothing, answered 200 everywhere, and does not work.
      //
      // create → reload → is it still there is the only assertion that separates real persistence from a
      // convincing illusion, and the journey is derived from the app's OWN markup — every selector read
      // out of its source, never guessed. A form we cannot address honestly yields no journey rather
      // than one that fails for the wrong reason.
      //
      // Cheap for the same reason PageRouteCheck is: Playwright and Chromium are pre-baked into the E2B
      // images, so this is a handful of browser actions and no model call.
      //
      // EVIDENCE, NEVER A GATE. And a journey that never reached the app's own behaviour is reported
      // UNREACHABLE, never FAILED — a login wall is not a defect.
      if (
        process.env.AGENTV3_JOURNEY_CHECK !== 'off' && result.ok && lastPreviewUrl && actuator.runCommand
        && !isImportTurn && !abort.signal.aborted
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 60_000)
      ) {
        try {
          const journeyFiles = Object.fromEntries(writtenFiles);
          // A marker unique to this build, so "the item appeared" cannot pass on pre-existing data.
          const marker = `nbai-${buildStartedAt.toString(36)}`;
          const journeys = deriveJourneys({
            files: journeyFiles,
            routes: extractPageRoutes(journeyFiles),
            marker,
          });
          if (journeys.length > 0) {
            const out = await withTimeout(
              actuator.runCommand(workspaceId, journeyScript(lastPreviewUrl, journeys, marker)),
              20_000 + journeys.length * JOURNEY_TIMEOUT_MS * 2, 'journey-check',
            );
            const journeyResults = parseJourneyResults(out.stdout);
            const verdict = summarizeJourneys(journeyResults);
            // 'unreachable' is its own outcome, not a pass and not a failure — a login wall tells us
            // nothing about the app, and either other answer would be invented.
            if (journeyResults.some((r) => r.verdict === 'failed')) gateEvidence.journeys = 'failed';
            else if (journeyResults.some((r) => r.verdict === 'passed')) gateEvidence.journeys = 'passed';
            else if (journeyResults.length > 0) gateEvidence.journeys = 'unreachable';
            buildDiag.record({
              phase: 'preview',
              severity: verdict.ok ? 'info' : 'warning',
              code: verdict.ok ? 'JOURNEY_PASSED' : 'JOURNEY_FAILED',
              message: verdict.summary,
              autoResolved: verdict.ok,
              detail: journeyResults.map((r) => `${r.verdict.toUpperCase()} ${r.route} (${r.step}) — ${r.note}`).join('\n'),
            });
          } else {
            // A quiet result that explains itself. "Nothing ran" and "nothing could be derived" look
            // identical in a report unless one of them says which it was.
            buildDiag.record({
              phase: 'preview', severity: 'info', code: 'JOURNEY_NOT_DERIVED',
              message: `No user journey was run — ${noJourneyReason(journeyFiles)}.`,
              autoResolved: true,
            });
          }
        } catch { /* evidence, never a gate — a failure here changes nothing about the build verdict */ }
      }

      // NO PREVIEW AT ALL IS THE LOUDEST FINDING THERE IS — and it was the one thing the report never
      // said (build f323a4db/49a7a987, admin 2026-08-06). Every post-build verification is gated on a
      // preview URL: the route smoke check, the page-render check and the E2E scaffold all silently
      // no-op without one. So EXACTLY when the app is most broken — it never came up — we verify the
      // LEAST, and the report reads clean. That build ran 18.8 minutes, reported ok, charged ₹286, and
      // the only trace of the failure was a passing mention inside the E2E skip reason.
      //
      // `PREVIEW_ERROR` already exists, but it fires only when a preview ATTEMPT reports an error. A
      // preview that was never produced at all raised nothing. This is that gap, and it is deliberately
      // a WARNING on the build itself rather than a note buried in another check's explanation.
      if (result.ok && !lastPreviewUrl && !isImportTurn && !abort.signal.aborted) {
        try {
          buildDiag.record({
            phase: 'preview', severity: 'warning', code: 'PREVIEW_NEVER_CAME_UP',
            message: 'The build finished, but no live preview was ever available — so nothing here has been '
              + 'proven to RUN. The route smoke check, the page-render check and the end-to-end scaffold all '
              + 'need a running app and were skipped, which is why the rest of this report looks quiet.',
            autoResolved: false,
          });
        } catch { /* diagnostics are best-effort and must never affect the build */ }
      }

      // E2E NET, WRITTEN NOT RUN (ROADMAP #1 Phase 4.3). `generate_e2e` was a tool the agent MAY call,
      // which in practice meant most apps shipped without one. This makes it a system reflex.
      //
      // Deliberately NOT executed here. Playwright pulls a browser of roughly 300 MB, and paying that
      // on every build — for every user, free tier included — would make builds materially slower to
      // add a signal we now largely have from the render check, the console-error capture and the
      // route smoke check. Writing the files costs nothing and leaves the user something real they
      // own: a net that runs in their own repo and their own CI whenever they want it. The report
      // says WRITTEN, never "passed" — a scaffold reported as a test run is a fake verdict.
      if (process.env.AGENTV3_AUTO_E2E !== 'off' && !abort.signal.aborted) {
        try {
          // THE WHOLE PROJECT, NOT THIS TURN'S WRITES (admin report 2026-08-12). An edit build that
          // wrote one `.env` was judged on that one file and skipped with the reason "this project has
          // no user interface for a browser to load" — for a React app with a full page of components.
          // The decision was arguably right and the REASON was false, which is worse: it tells the user
          // something untrue about their own app, and it hides the real reason from the next reader.
          const projectFiles = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
          const e2eFiles = { ...projectFiles, ...Object.fromEntries(writtenFiles) };
          const decision = shouldAutoScaffoldE2e({
            files: e2eFiles,
            ok: result.ok,
            isImportTurn,
            hasPreview: !!lastPreviewUrl,
          });
          if (decision.scaffold) {
            const plan = planE2eScaffold({ appName: workspaceId, devCommand: 'npm run dev' });
            const added: string[] = [];
            for (const [path, content] of Object.entries(plan.files) as Array<[string, string]>) {
              // Create-only: an existing file here belongs to the user, and the decision above already
              // refused whole projects that have their own E2E setup.
              let exists = false;
              try { await actuator.readFile(workspaceId, path); exists = true; } catch { exists = false; }
              if (exists) continue;
              await actuator.writeFile(workspaceId, path, content);
              writtenFiles.set(path, content);
              added.push(path);
            }
            // SIGN-IN FLOW (Phase 4.5). The smoke spec proves the app LOADS; this proves the login
            // form exists, accepts input and submits without throwing. An app whose sign-in is broken
            // is completely unusable no matter how good everything behind it is.
            //
            // Every selector is READ from the component this build produced, never guessed. A guessed
            // selector fails against working code — the exact bug removed from the unit scaffolds one
            // phase ago — so when the evidence is not in the markup, NO spec is written. A missing
            // test is honest; a red test against a correct app is not.
            const auth = findAuthFlow(e2eFiles);
            if (auth) {
              let authExists = false;
              try { await actuator.readFile(workspaceId, AUTH_SPEC_PATH); authExists = true; } catch { authExists = false; }
              if (!authExists) {
                const spec = buildAuthFlowSpec(auth);
                await actuator.writeFile(workspaceId, AUTH_SPEC_PATH, spec);
                writtenFiles.set(AUTH_SPEC_PATH, spec);
                added.push(AUTH_SPEC_PATH);
              }
            }
            if (added.length > 0) {
              buildDiag.record({
                phase: 'build', severity: 'info', code: 'E2E_SCAFFOLDED',
                message: e2eAutoScaffoldNote(added)
                  + (auth ? ` The sign-in test reads its selectors from ${auth.file}, so they keep working as long as that form does.` : ''),
                autoResolved: true,
              });
            }
          } else if (decision.reason) {
            // Recorded even when nothing was written: a silent skip cannot be told from a broken skip.
            buildDiag.record({
              phase: 'build', severity: 'info', code: 'E2E_SCAFFOLD_SKIPPED',
              message: `No end-to-end suite was added — ${decision.reason}.`,
              autoResolved: true,
            });
          }
        } catch { /* the net is additive — a failure here never touches the build result */ }
      }

      // APP HEALTH CULTURE — VACCINE (Immune System Phase 2, opt-in AGENTV3_VACCINE=on): run_tests is a
      // TOOL the agent MAY skip; the vaccine makes it a SYSTEM reflex. If the built project ships a real
      // test suite, the platform runs it ITSELF, reads honest pass/fail counts, and records a TEST_SUITE
      // finding — so a green build whose own tests fail can never be reported as verified. When the suite
      // fails and the feature-heal-style flag budget allows, ONE bounded repair pass fixes the SOURCE (never
      // deletes/skips a test) and re-runs. No suite → honest no-op. Best-effort, budget-gated, abortable —
      // never blocks or hangs a build.
      if (
        vaccineEnabled(workspaceId) && expectsArtifacts && result.ok && !abort.signal.aborted
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 90_000)
      ) {
        try {
          const vaxHealMax = featureHealEnabled(workspaceId) ? 1 : 0; // repair only when the heal budget is opted in
          for (let attempt = 0; attempt <= vaxHealMax && !abort.signal.aborted; attempt++) {
            const files = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
            let pkgRaw: string | undefined;
            try { pkgRaw = await actuator.readFile(workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
            const plan = detectTestPlan(files, pkgRaw);
            if (!plan) {
              // "Nothing ran" and "there was nothing to run" are different facts, and only the second is
              // good news. A suite whose runner is not installed — which includes the one WE scaffold —
              // now says so instead of going quiet.
              const missing = suitePresentButRunnerMissing(files, pkgRaw);
              if (missing) {
                buildDiag.record({
                  phase: 'readiness', severity: 'info', code: 'TEST_SUITE_UNVERIFIED',
                  message: missing, autoResolved: true, // not an app defect — nothing for the build to resolve
                });
              }
              break; // no real suite — honest no-op, never a fake pass
            }
            let outcome;
            try {
              const { exitCode, stdout, stderr } = await withTimeout(actuator.runCommand(workspaceId, plan.command), 180_000, 'vaccine-run-tests');
              outcome = parseTestOutcome(plan, exitCode, stdout, stderr);
            } catch { break; /* couldn't run the suite (timeout / no sandbox) — skip silently */ }
            if (outcome.ok) {
              gateEvidence.tests = 'passed';
              buildDiag.record({ phase: 'readiness', severity: 'info', code: 'TEST_SUITE', message: outcome.summary, autoResolved: true });
              if (attempt > 0) events.emit({ type: 'narration', agent: 'architect', text: `✅ Test suite green after fix — ${outcome.summary}.`, ts: Date.now() });
              break;
            }
            // A suite that could not EXECUTE is UNVERIFIED, not failed — and repairing the app cannot
            // help it. The Shiv Medical Store report (2026-08-10) recorded `playwright: FAIL (exit=1)`
            // as an unresolved defect of the user's app when the real cause was our own sandbox missing
            // the Playwright browser binaries. Report it honestly and stop: spending the repair budget
            // rewriting working tests because WE could not launch a browser is the worst of both.
            if (!outcome.ran) {
              buildDiag.record({
                phase: 'readiness', severity: 'info', code: 'TEST_SUITE_UNVERIFIED',
                message: outcome.summary,
                autoResolved: true, // not an app defect — nothing for the build to resolve
              });
              break;
            }
            // Out of repair budget OR near the wall-clock cap → record the honest failure and stop.
            if (attempt >= vaxHealMax || (effectiveBuildSeconds > 0 && Date.now() - buildStartedAt > effectiveBuildSeconds * 1000 - 60_000)) {
              // The suite RAN and did not pass — that is real evidence, unlike the unverified case above.
              gateEvidence.tests = 'failed';
              buildDiag.record({ phase: 'readiness', severity: 'warning', code: 'TEST_SUITE', message: outcome.summary + (outcome.failingTests.length ? ` — failing: ${outcome.failingTests.slice(0, 8).join(', ')}` : ''), autoResolved: false });
              break;
            }
            events.emit({ type: 'narration', agent: 'architect', text: `🧬 The app's own tests are failing (${outcome.summary}). Fixing the source now…`, ts: Date.now() });
            try {
              const vaxRunner = new AgentRunner({
                ...baseRunnerOpts,
                client: buildTurnRunner(healRunnerOpts()),
                model: resolveModel(powerLevelReqEffective),
                persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
              });
              const healed = await vaxRunner.run(testOutcomeRepairPrompt(outcome));
              if (healed.ok) result = healed; else break;
            } catch (e) {
              console.log(`[AGENTV3] vaccine heal failed: ${e instanceof Error ? e.message : String(e)}`);
              break;
            }
          }
        } catch { /* vaccine is best-effort — never blocks a build */ }
      }

      // THE RELEASE GATE (Mission 10/10 Phase 5, §23). Every check that could speak has now spoken, so
      // this is the first honest moment to answer the only question the user actually has: can I ship it?
      //
      // Four states, and the fourth is the point. RED means something we checked is broken. YELLOW means
      // it runs with caveats. GREEN means it runs AND a real user journey held up. UNKNOWN means nothing
      // failed and nothing was PROVEN — which, before this, was silently reported as health, because
      // every runtime check is gated on a preview URL and they all skip together exactly when the app is
      // most broken.
      //
      // GREEN CANNOT BE EARNED BY STATIC CLEANLINESS. That is the whole rule.
      try {
        gateEvidence.buildOk = result.ok;
        gateEvidence.preview = previewVerifiedRendered ? 'passed' : previewVerifiedFailed ? 'failed' : 'not-run';
        const gate = releaseGate(gateEvidence, {
          // Counted from what this build actually recorded, so the gate and the report cannot disagree.
          blockers: buildDiag.shippingIssueCount('error'),
          // Security findings already arrive as error-severity issues above; counting them again here
          // would report one problem twice in the same sentence.
          highSeverity: 0,
          warnings: buildDiag.shippingIssueCount('warning'),
        }, gateQuality);
        buildDiag.record({
          phase: 'readiness',
          // UNKNOWN is a warning, not an info: "we could not tell" is a finding about our own coverage,
          // and filing it as info is how it stops being read.
          // A RED gate on a build that SUCCEEDED is a warning about shipping, not an error in the run —
          // recording it as an error made it outrank every real finding and become the report's root
          // cause. Only a gate that agrees with a failed build is an error.
          severity: gate.state === 'red' && !result.ok ? 'error' : gate.state === 'green' ? 'info' : 'warning',
          code: 'RELEASE_GATE',
          message: releaseGateSummary(gate),
          autoResolved: gate.state === 'green',
        });
        // ── THE VERDICT MAY NO LONGER CONTRADICT THE EVIDENCE ────────────────────────────────────
        //
        // ADMIN REPORT 2026-08-12 (the dukaan stock app) — the worst failure this engine has produced,
        // and not a crash: it LIED. One report carried, simultaneously:
        //     ok: true
        //     RELEASE_GATE: RED — Not shippable
        //     rootCause: 2 local modules are STILL missing — the app will crash at runtime
        // …and the user was told, in their own language, "App tayyar hai! 🎉 App live hai: <link>".
        // The link showed a Closed Port Error. Everything needed to know better was already computed
        // and written down; nothing was allowed to act on it, because this block was explicitly
        // "reports on the build, must never affect it".
        //
        // That separation was right for the gate's ADVISORY half and wrong for its evidential half. A
        // gate that is RED *because a build-breaking blocker was recorded* is not an opinion — it is the
        // build's own error log, and shipping ok:true over it is a false success the platform forbids.
        //
        // ⚠️ DELIBERATELY NARROW — this is the difference between a guard and a nuisance:
        //   • It fires ONLY when RED coincides with a genuine unresolved ERROR (`shippingIssueCount`),
        //     which is the same count the gate itself used, so the two can never disagree.
        //   • It does NOT fire on a RED driven only by tests, because a suite can be RED while merely
        //     INDETERMINATE — this very report's suite said "could be a failing test OR the runner
        //     failing to start; the output gave nothing to tell them apart". Failing a working app over
        //     an ambiguity of OUR OWN sandbox is exactly the #2267 mistake, in the other direction.
        //   • Flipping ok:false also makes the build FREE (the standing "working app or free" guard
        //     keys on !result.ok) — so this fix hands money back as well as telling the truth.
        const gateBlockers = buildDiag.shippingIssueCount('error');
        const settled = result; // captured once — `result` is reassigned in the heal loop above
        if (gate.state === 'red' && gateBlockers > 0 && settled && settled.ok) {
          // The cause comes from the gate's own sentence, not a second derivation — one source, so the
          // summary the user reads and the verdict that flipped can never describe different builds.
          result = { ...settled, ok: false, summary: releaseGateFailureSummary(gateBlockers, releaseGateSummary(gate)) };
          // NOTE: `buildResultRef` (the deadline finalizer's snapshot) is deliberately NOT touched here
          // — it is not set yet at this point, and downstream it is captured ONLY `if (result.ok)`.
          // Flipping `result` above therefore keeps BOTH exits honest by construction, which is the
          // same reasoning the preview-compile guard records. TypeScript agrees: it types the ref as
          // null here, which is how the attempt to update it failed to compile.
          buildDiag.record({
            phase: 'readiness', severity: 'error', code: 'OUTCOME_RELEASE_GATE_RED',
            message: `The build reported success while the release gate was RED with ${gateBlockers} unresolved build-breaking issue(s) — the verdict has been corrected to NOT ok.`,
            autoResolved: false,
          });
        }
      } catch { /* the gate reports on the build; a fault HERE must never affect it */ }

      // APP HEALTH CULTURE — RED-TEAM (Immune System Phase 3 / GA-17, opt-in AGENTV3_REDTEAM=on): the
      // happy-path preview check only proves the app renders on GOOD input. The red-team ADVERSARIALLY
      // types hostile values (empty, oversized, injection-shaped, malformed numbers) into the app's own
      // inputs via a real browser and watches for a CRASH (uncaught error / React error / unhandled
      // rejection). A crash on hostile input is a real robustness bug the build never sees; it is recorded
      // as a FUZZ_ROBUSTNESS finding and (with the heal budget opted in) hardened by ONE bounded repair
      // pass. Hard-capped total cases + wall-clock budget + abortable — never blocks or hangs a build.
      if (
        redTeamEnabled() && expectsArtifacts && result.ok && !abort.signal.aborted
        && actuator.browserAction && actuator.getConsoleErrors && actuator.browseUrl && lastPreviewUrl
        && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 120_000)
      ) {
        try {
          let fuzzHtml = '';
          try { fuzzHtml = (await withTimeout(actuator.browseUrl!(workspaceId, lastPreviewUrl), 35_000, 'redteam-browse')).html; } catch { fuzzHtml = ''; }
          const plan = generateFuzzPlan(fuzzHtml);
          const MAX_TOTAL_CASES = 12; // hard cap across all inputs so the attack is always bounded
          const redTeamDeadline = Date.now() + 90_000; // whole red-team pass ≤ 90s regardless of case count
          const findings: { input: FuzzInput; case: FuzzCase; verdict: FuzzVerdict }[] = [];
          let casesRun = 0;
          outer:
          for (const target of plan) {
            for (const fcase of target.cases) {
              if (casesRun >= MAX_TOTAL_CASES || Date.now() > redTeamDeadline || abort.signal.aborted) break outer;
              casesRun++;
              const caseStart = Date.now();
              try {
                // Reset to a clean app state, type the hostile value, and submit (Enter).
                await withTimeout(actuator.browserAction(workspaceId, 'navigate', { url: lastPreviewUrl }), 15_000, 'redteam-nav');
                await withTimeout(actuator.browserAction(workspaceId, 'type', { selector: target.input.selector, text: fcase.value }), 12_000, 'redteam-type');
                await withTimeout(actuator.browserAction(workspaceId, 'press', { selector: target.input.selector, text: 'Enter' }), 12_000, 'redteam-submit');
              } catch { continue; /* the input wasn't reachable / action timed out — skip this case */ }
              let errs: string[] = [];
              try {
                if (actuator.getConsoleErrors) errs = (await actuator.getConsoleErrors(workspaceId, caseStart)).errors.map((e) => e.text);
              } catch { /* capture best-effort */ }
              const verdict = interpretFuzzErrors(errs);
              if (verdict.crashed) findings.push({ input: target.input, case: fcase, verdict });
            }
          }
          if (findings.length > 0) {
            buildDiag.record({ phase: 'readiness', severity: 'warning', code: 'FUZZ_ROBUSTNESS', message: fuzzSummary(findings), autoResolved: false });
            // Opt-in bounded heal — harden the source, then trust the next build/preview to re-verify.
            if (featureHealEnabled(workspaceId) && !abort.signal.aborted && (effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - 60_000)) {
              events.emit({ type: 'narration', agent: 'architect', text: `🛡️ Red-team crashed ${findings.length} input(s) on hostile input — hardening validation now…`, ts: Date.now() });
              try {
                const rtRunner = new AgentRunner({
                  ...baseRunnerOpts,
                  client: buildTurnRunner(healRunnerOpts()),
                  model: resolveModel(powerLevelReqEffective),
                  persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
                });
                const healed = await rtRunner.run(fuzzRepairPrompt(findings));
                if (healed.ok) { result = healed; buildDiag.record({ phase: 'readiness', severity: 'info', code: 'FUZZ_HARDENED', message: `Hardened ${findings.length} input(s) against hostile input.`, autoResolved: true }); }
              } catch (e) {
                console.log(`[AGENTV3] red-team heal failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          }
        } catch { /* red-team is best-effort — never blocks a build */ }
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
        // Honesty tracking (rule 5): did we EVER actually capture the browser console? An empty capture
        // only means "runtime clean" if a real session was read; otherwise it's "runtime UNCHECKED".
        let captureAvailable = false;
        for (let attempt = 1; attempt <= maxAttempts && !abort.signal.aborted; attempt++) {
          let captured: RuntimeError[] = [];
          try {
            const cap = await actuator.getConsoleErrors!(workspaceId, sinceMs);
            if (cap.captured !== false) { captureAvailable = true; runtimeCaptureAvailable = true; }
            captured = filterActionableErrors(cap.errors);
          } catch { break; /* console capture needs a real sandbox — availability stays unproven */ }
          if (captured.length === 0) break; // captured, but no actionable errors — nothing to fix
          events.emit({ type: 'narration', agent: 'architect', text: `🔧 Detected ${captured.length} runtime error(s) — auto-fixing (attempt ${attempt}/${maxAttempts})…`, ts: Date.now() });
          const fixStart = Date.now();
          const fixRunner = new AgentRunner({
            ...baseRunnerOpts,
            client: buildTurnRunner(healRunnerOpts()),
            model: resolveModel(powerLevelReqEffective),
            persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
          });
          try {
            const applyFix = () => runInPass('runtime-error-autofix', () => fixRunner.run(buildRepairPrompt(captured)));
            // VERIFY AFTER FIX (admin 2026-08-12) — this repair is ALLOWED to write to a green app, so it
            // must PROVE the app still works afterwards. Snapshot the working files, apply, re-render; if
            // the fix broke the app, roll back to the snapshot automatically. Only engaged once the app is
            // green-latched (before green there is nothing to protect and no net is needed). This is what
            // guarantees a non-technical user is never handed a broken app. Kill: AGENTV3_VERIFY_AFTER_FIX=off.
            if (verifyAfterFixEnabled() && isGreenLatched(workspaceId) && lastPreviewUrl && actuator.browseUrl) {
              let fixResult: { ok: boolean } | undefined;
              const reRenderOk = async (): Promise<boolean> => {
                const shot = await withTimeout(actuator.browseUrl!(workspaceId, lastPreviewUrl!), 35_000, 'verify-after-fix');
                const v = analyzePreviewHtml(shot.html, { painted: shot.painted, source: shot.source });
                if (v.inconclusive || v.serverDown) throw new Error('cannot re-verify'); // unproven → keep, do not revert on a guess
                return v.rendered;
              };
              const vr = await verifyAfterFix<Record<string, string>>({
                snapshot: async () => (await collectWorkspaceFiles(actuator, workspaceId)).files,
                apply: async () => { fixResult = await applyFix(); },
                reverify: reRenderOk,
                revert: async (snap) => {
                  const cur = (await collectWorkspaceFiles(actuator, workspaceId)).files;
                  const plan = restorePlan(snap, cur);
                  await runInPass('green-guard-restore', async () => {
                    for (const [p, c] of Object.entries(plan.write)) { try { await actuator.writeFile(workspaceId, p, c); } catch { /* per-file */ } }
                    const rm = buildRemoveCommand(plan.remove);
                    if (rm) { try { await withTimeout(actuator.runCommand(workspaceId, rm), 20_000, 'vaf-remove'); } catch { /* best-effort */ } }
                  });
                  await mergeWorkspaceFiles(workspaceId, snap).catch(() => {}); // durable revert too
                },
              });
              try { buildDiag.record({ phase: 'build', ...verifyAfterFixNote('runtime-error fix', vr) }); } catch { /* best-effort */ }
              // Promote the repaired result ONLY when it was kept — a reverted fix leaves the app exactly
              // as green as it was, so `result` must stay the working version, not the broken repair.
              if (vr.kept && fixResult?.ok) result = fixResult as typeof result;
              if (vr.reverted) break; // the repair broke it and was undone — stop, do not try again
            } else {
              const fix = await applyFix();
              if (fix.ok) result = fix;
            }
          } catch (e) {
            console.log(`[AGENTV3] auto-fix attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
          sinceMs = fixStart; // next check only sees errors from the post-fix reload
        }
        // Honest final verdict — RECORDED DURABLY to the diagnostics (so it folds into the shipped health
        // card via buildHealthFromDiagnostics), not just an ephemeral narration line that vanished:
        //   • errors remain → WARN they may still be present   • couldn't capture → "runtime UNCHECKED"
        //   • captured & clean → honest "runtime verified"     (all advisory — the loop never blocks a build)
        let remaining: RuntimeError[] = [];
        try {
          const fin = await actuator.getConsoleErrors!(workspaceId, sinceMs);
          if (fin.captured !== false) { captureAvailable = true; runtimeCaptureAvailable = true; }
          remaining = filterActionableErrors(fin.errors);
        } catch { /* best-effort — availability stays whatever the loop proved */ }
        try {
          if (remaining.length) {
            events.emit({ type: 'narration', agent: 'architect', text: autoFixWarning(remaining), ts: Date.now() });
            // If an API/network/CORS/HTTP-status error survived, proactively point the user at the API
            // Tester so they can test the exact endpoint themselves (admin 2026-07-24). Advisory only.
            const apiHint = apiTesterHintFor(remaining.map((e) => e.text));
            if (apiHint) events.emit({ type: 'narration', agent: 'architect', text: apiHint, ts: Date.now() });
            buildDiag.record(runtimeErrorsRemainRecord(remaining));
          } else if (!captureAvailable) {
            buildDiag.record(runtimeUncheckedRecord({ previewRendered: previewVerifiedRendered }));
          } else {
            buildDiag.record(runtimeVerifiedRecord());
          }
        } catch { /* diagnostics recording is best-effort — never breaks a build */ }
      }

      // DOES THE SUMMARY SURVIVE CONTACT WITH WHAT WE MEASURED? (admin transcript + report 2026-08-12)
      //
      // Two contradictions came out of ONE build. The model wrote "I verified this with a real browser
      // screenshot and confirmed there are no console errors" while the same report recorded that the
      // console could not be captured. And it described the screen as showing "Health 100/100, Level 1,
      // XP 0/100 · Location: Forest Path · Inventory · Game Log" — for a home page with four corner
      // buttons, whose source contains none of those words. It had described the same screen correctly
      // earlier in the same build; the second time it described an image it did not look at.
      //
      // A wrong verdict is a bug. A fabricated observation is the platform telling the user something
      // that never happened, in the confident voice of a verification — and the user has no way to know
      // which sentence to distrust. So the platform corrects itself, in its own reply, out loud.
      try {
        const contradictions = auditSummaryClaims(result.summary, {
          consoleCaptured: runtimeCaptureAvailable,
          screenshotTaken: buildDiag.toolWasUsed('screenshot'),
          previewVerified: previewVerifiedRendered,
          // The app's real source — a label it does not contain cannot have been on the screen.
          sourceText: Array.from(writtenFiles.values()).join('\n'),
        });
        if (contradictions.length > 0) {
          result = { ...result, summary: `${result.summary}${claimCorrection(contradictions)}` };
          buildDiag.record({
            phase: 'readiness', severity: 'warning', code: 'CLAIM_UNSUPPORTED',
            message: claimAuditSummary(contradictions), autoResolved: false,
          });
        }
      } catch { /* the audit reports on the summary; it must never break the build */ }

      // The core build is now SETTLED (generation + verify/repair + heal + autofix). Everything below
      // — quality review, reflection, memory persist, git push — is ADVISORY. Expose the result to the
      // deadline timer NOW so that if the wall-clock cap fires during that advisory work, the build is
      // finalized as SUCCESS (the app is built + already durably saved), not "paused — type continue".
      // HONESTY BACKSTOP (mitrify autopsy 2026-07-23, rule 5): a KNOWN-failed GitHub import must never be
      // reported as a success, whatever the model's prose says (the model surveyed a /tmp clone that never
      // landed, yet the summary read "successfully cloned … ready for further work" on an EMPTY workspace).
      // Prepend the platform's honest verdict so the truth leads. Applied to `result` BEFORE buildResultRef
      // captures it, so both the main and watchdog result paths carry the honest summary. `ok` is left
      // untouched (a survey-only reply is still a valid turn) — only the reporting is made honest.
      if (failedImport && !result.summary.startsWith(IMPORT_HONESTY_PREFIX_MARK)) {
        result = { ...result, summary: `${importHonestySummaryPrefix(failedImport)}${result.summary}` };
      }
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
          // Fix 39 (history-reopen report 2026-07-07: "na chat recover hui"): the fallback used to
          // save ONLY prompt + one-line summary, so a reopened fast-lane session showed exactly two
          // bubbles — the whole build story looked wiped. Persist the build's REAL narration digest
          // (the AGENT_STEP timeline the user watched live, bounded) as the assistant turn, so a
          // reopen replays the story instead of a stub.
          const narrationDigest = (() => {
            try {
              const steps = buildDiag.report().issues
                .filter((i) => i.code === 'AGENT_STEP' && !/^⏱/.test(i.message))
                .map((i) => i.message.split('\n')[0].slice(0, 160));
              const digest = steps.slice(0, 30).join('\n');
              return digest.length > 40 ? digest.slice(0, 4000) : '';
            } catch { return ''; }
          })();
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
              ...(narrationDigest ? [{ role: 'assistant' as const, content: narrationDigest, ts: buildStartedAt + 1 }] : []),
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
          const summaryText = summarizeProject(getWorkspaceMemory(workspaceId).graph(), prompt, { previewLive: !!lastPreviewUrl, changedFiles: writtenFiles.size, editMode: isEditMode, changedPaths: [...writtenFiles.keys()] });
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
      // COMPLETENESS BACKSTOP (admin 2026-07-06, "complete app"): a SONNET-tier (complex) prompt that
      // the deterministic lane built DOES get the reviewer — tsc proves it compiles, only the reviewer
      // checks it's feature-complete against the request, and its [CRITICAL] findings are auto-fixed
      // in the same build (C9). Bounded (90s review + 120s repair caps), so it can't stall the finish.
      // ANALYSIS-ONLY turns get NO reviewer (admin design 2026-07-07, "bina provider ko bheje…
      // surgical fix"): the reviewer exists to check what was BUILT — on a survey/import turn where
      // ZERO files were written it has nothing to verify, yet on a 100-file CoreUI import it
      // free-explored the whole template until its transcript hit 2.2M tokens and every provider
      // rejected it. Big projects live in GitHub + the durable store + the preview WITHOUT any model
      // reading them; the AI touches files only when the user asks for an edit (surgical, grounded).
      // ROOT-CAUSE GATE (autopsy 2026-07-30, build 77bd487b — a "give me a survey, do not change any files"
      // import of a 2508-file repo ran the reviewer for ~16 min AND its heal edited the project: "🔧 Added 4
      // missing imports" + "🔧 Added 12 missing dependencies to package.json"). The design (comment above, and
      // every OTHER post-build gate — readiness/lint/reviewer-autofix all check `!isImportTurn`) is that an
      // import/survey turn gets NO reviewer. But this ONE gate used `writtenFiles.size > 0` as the proxy for
      // "we built something to review" — and that proxy is DEFEATED by INFRA writes on a survey turn (the `.env`
      // that loads the user's saved keys, foundational scaffolding), which push the count above 0 even though
      // ZERO user code was written. Gate on `!isImportTurn` too (the real signal, in scope here and used at
      // 8558/8564) so a "do not change" survey can never trigger the reviewer or its file-modifying heal.
      const reviewerAllowed = reviewerShouldRun({
        wroteFiles: writtenFiles.size > 0,
        isImportTurn,
        fastLaneGated,
        reviewFastlaneForced: envFlag('AGENTV3_REVIEW_FASTLANE'),
        startTierSonnet: analysis?.startTier === 'sonnet',
      });
      if (result.ok && reviewHeadroomOk && reviewerAllowed) {
        try {
          let rFiles = await actuator.listFiles(workspaceId).catch(() => [] as string[]);
          // The REAL project size, captured before the fallback below can shrink rFiles to just this
          // turn's writes. The reviewer's budget must reflect the app it has to understand, not only
          // the handful of files handed to it (mitrify autopsy 2026-08-04: 90s granted "on 9 files"
          // for a 608-file app, killed mid-review, and the user asked to re-run it by hand).
          const projectFileCount = rFiles.length;
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
          // SIZE-SCALED, HEADROOM-CLAMPED reviewer budget (2026-07-07): a fixed 90s cap killed the
          // reviewer mid-review on a 40-file app and silently lost its completeness verdict. Bigger apps
          // get more time, never past the wall-clock safety margin. Honest note on timeout, not silence.
          const reviewHeadroomMs = effectiveBuildSeconds === 0 ? Infinity : (effectiveBuildSeconds * 1000 - (Date.now() - buildStartedAt));
          const reviewBudget = reviewerBudgetMs(rFiles.length, reviewHeadroomMs, projectFileCount);
          let review;
          // THE TIMEOUT STOPS US WAITING — IT MUST NOT STOP US LOOKING (admin report 2026-08-12).
          //
          // The promise is held in its own binding so that when the budget expires it is still
          // reachable. In the dukaan stock app the reviewer landed its `[CRITICAL] Missing CSS
          // Styling — App will look broken` **1.5 seconds** after `raceTimeout` rejected; because the
          // reference was gone with the expression, that finding — 26 files of the user's tokens,
          // already spent — was discarded, and the user shipped the broken app instead.
          const reviewPromise = reviewBuild({
              userRequest: prompt,
              fileTree: rFiles,
              fileSample: rSample,
              spawn: spawnSubAgent,
              // What THIS turn changed. Without it the reviewer surveys the whole project: the Shiv
              // Medical Store report shows ~25 read_file calls for a 3-file edit — the user's money
              // spent re-reading code they did not touch.
              changedFiles: [...writtenFiles.keys()],
          });
          try {
            review = await raceTimeout(reviewPromise, reviewBudget, 'post-build-review');
          } catch (e) {
            // Timeout (or a reviewer error): the app is built + compiles + saved — say so HONESTLY
            // instead of silently dropping the completeness check (the empty-`review` report gap).
            const timedOut = e instanceof Error && /timed out/i.test(e.message);
            // GRACE — collect a review that is ABOUT TO LAND. Only after a TIMEOUT: a reviewer that
            // THREW has already produced its answer (an error), and waiting on a settled rejection
            // would buy nothing. Bounded by reviewGraceMs against the CURRENT headroom, so a genuinely
            // hung reviewer can never eat the build's remaining wall clock — and returns 0 (skip
            // entirely, today's behaviour byte-for-byte) when the safety margin is not there.
            //
            // Re-racing the SAME promise is safe: the first raceTimeout already attached handlers to
            // it, so a rejection can never surface as an unhandled rejection, and no second reviewer
            // is spawned — this waits on work that is already running and already paid for.
            const graceMs = timedOut
              ? reviewGraceMs(reviewBudget, effectiveBuildSeconds === 0 ? Infinity : (effectiveBuildSeconds * 1000 - (Date.now() - buildStartedAt)))
              : 0;
            if (graceMs > 0) {
              review = await raceTimeout(reviewPromise, graceMs, 'post-build-review-grace').catch(() => null);
            }
            if (review) {
              // It landed. Everything downstream — recordReview, the C9 auto-fix, the honesty holder —
              // now runs exactly as it would have on a review that finished inside its budget.
              try { buildDiag.record({ phase: 'build', severity: 'info', code: 'REVIEW_LATE', message: `Post-build review overran its ${reviewBudget}ms budget and was collected within the ${graceMs}ms grace — its findings were kept, not discarded.`, autoResolved: true }); } catch { /* best-effort */ }
            } else {
              events.emit({ type: 'narration', agent: 'architect', text: timedOut
                ? '📋 Your app is built, compiles, and is saved. The deeper completeness review didn\'t finish on this large app — send "review it" and I\'ll run it on its own.'
                : '📋 Your app is built and saved (the post-build review could not run this time).', ts: Date.now() });
              // HONESTY (rule 5): this used to be recorded `autoResolved: true` — a literal claim that
              // the problem was resolved. Nothing was resolved: the completeness net was DOWN for this
              // build, which is exactly the caveat the health card should carry. It is a warning, not
              // an error, so it can never block a working app from shipping.
              try { buildDiag.record({ phase: 'build', severity: 'warning', code: 'REVIEW_INCOMPLETE', message: timedOut ? `Post-build review timed out after ${reviewBudget}ms (+${graceMs}ms grace) on ${rFiles.length} files — its completeness findings are NOT available for this build` : 'Post-build review errored — its completeness findings are NOT available for this build', autoResolved: false }); } catch { /* best-effort */ }
              review = null;
            }
          }
          const reviewText = review ? formatReview(review) : '';
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
          // build, so this catches a strong build's critical bug too. ONE bounded repair pass —
          // DEFAULT-ON via reviewerAutoFixEnabled() (2026-07-07: gating this on the opt-in
          // AGENTV3_AUTOFIX meant v5.0 diagnosed its own [CRITICAL] and then knowingly shipped it);
          // best-effort — never blocks/fails the build; the fix's writes are saved.
          const criticals = (review?.issues ?? []).filter((i) => i.severity === 'critical').map((i) => i.message.trim()).filter(Boolean);
          // Option 2 (canary, autopsy 2026-07-11): also repair FUNCTIONAL [WARNING] findings — the
          // Notes report's real bugs ("auto-focus broke", "sort ignores edits", "isAtLimit blocks
          // Add") were warnings, so C9 (criticals-only) shipped them. selectAutoFixableWarnings keeps
          // only functional ones (cosmetic/a11y/style excluded); gated OFF by default until canaried.
          const warningFixes = reviewerWarningAutoFixEnabled()
            ? selectAutoFixableWarnings(review?.issues ?? []).map((i) => i.message.trim()).filter(Boolean)
            : [];
          const autoFixItems = [...criticals, ...warningFixes];
          // GREEN STOP — once the app WORKS, offer improvements, do not impose them (admin 2026-08-12,
          // verified in BENCHMARK 0: the app rendered at 6.6 min and the build ran to 14.3, most of it
          // spent editing a working app; and in the 44-min report the reviewer's silent fix ERASED the
          // user's real .env secrets). The reviewer reports the engine's OWN quality/security/design
          // opinions. When the app is ALREADY verified rendering, applying those silently is exactly the
          // re-break class. So they become a "want me to fix these?" offer in the user's own summary,
          // and the working app ships untouched. The user's actual requests (a missing requested feature,
          // a real runtime error) are handled by their own passes and keep fixing automatically — this
          // governs only the reviewer's opinions. Kill switch: AGENTV3_GREEN_STOP=off. See greenReviewPolicy.
          const greenStopReview = !reviewerShouldWrite({ previewGreen }) && autoFixItems.length > 0 && !isImportTurn;
          // FALSE-SUCCESS GUARD: a real build turn (never an import/survey turn, where findings stay
          // advisory by design) whose reviewer found [CRITICAL]s is NOT-ok until they are verifiably
          // fixed. Set the holder NOW (before the bounded fix pass) so the verdict is honest even if
          // the fix can't run — no headroom, aborted, or (the real bug) cut off mid-repair by the
          // advisory cap. Warnings never gate success (only true criticals do). Cleared only on a
          // verifiably-completed fix pass below.
          // NOT when green-stopping: a verified-rendering app is NOT made not-ok by the reviewer's
          // opinions — those are now suggestions the user can accept, not blockers.
          if (criticals.length > 0 && !isImportTurn && !greenStopReview) reviewCriticalsUnresolved = criticals.slice();
          if (greenStopReview) {
            // The app is verified working. Surface the findings as an offer instead of silently editing.
            const suggestions = toReviewSuggestions(
              autoFixItems.map((t) => ({ text: t, functional: criticals.includes(t) })),
            );
            const suggestSummary = reviewSuggestionSummary(suggestions);
            if (suggestSummary) result = { ...result, summary: `${result.summary || ''}${suggestSummary}` };
            try {
              buildDiag.record({
                phase: 'build', severity: 'info', code: 'REVIEW_SUGGESTED_NOT_APPLIED',
                message: `The app was verified rendering, so ${suggestions.length} reviewer finding(s) were OFFERED to the user rather than applied silently (the working app was left untouched): ${suggestions.map((s) => s.title).join('; ')}`,
                autoResolved: true,
              });
            } catch { /* best-effort */ }
            const card = reviewSuggestionCard(suggestions);
            // A richer client can render per-item "fix" buttons; the summary above already carries the
            // whole feature end-to-end for a plain client, so this emit is purely additive.
            if (card) { try { events.emit({ type: 'suggest', ...card, ts: Date.now() }); } catch { /* best-effort */ } }
          } else if (autoFixItems.length && reviewerAutoFixEnabled() && reviewHeadroomOk && !abort.signal.aborted && !isImportTurn) {
            const label = warningFixes.length
              ? `${criticals.length} critical + ${warningFixes.length} functional issue(s)`
              : `${criticals.length} critical issue(s)`;
            events.emit({ type: 'narration', agent: 'architect', text: `🔧 Reviewer found ${label} — fixing them now…`, ts: Date.now() });
            // C9-RETRY (admin dashboard autopsy 2026-08-02 — "Reviewer critical not resolved" was the TOP
            // failure pattern, 29% of failed user reports): the single flat-120s attempt died on timeouts
            // and one-shot provider flakes, and the criticals shipped unresolved. Two class fixes, both
            // pure + tested in AutoFix.ts:
            //  - reviewerFixBudgetMs: the budget scales with how many findings must be fixed and clamps
            //    to the wall-clock headroom (up to 5 min when the build has it — kills the timeout class);
            //  - reviewerFixShouldRetry: ONE bounded retry after a COMPLETED-but-failed or non-timeout
            //    thrown pass, never after a timeout (the raced-out runner may still be editing — two
            //    concurrent runners on one workspace is a corruption risk), max 2 attempts total.
            const fixHeadroomMs = () => effectiveBuildSeconds === 0 ? Infinity : (effectiveBuildSeconds * 1000 - (Date.now() - buildStartedAt));
            for (let fixAttempt = 1; ; fixAttempt++) {
              // A FRESH runner per attempt — never re-run a runner whose previous run was abandoned.
              const critFixRunner = new AgentRunner({
                ...baseRunnerOpts,
                client: buildTurnRunner(healRunnerOpts()),
                model: resolveModel(powerLevelReqEffective),
                persistence: { store: getConversationStore(), conversationId: mainConversationId, userId: userId ?? 'anon', workspaceId, title: deriveTitle(prompt) },
              });
              let timedOut = false;
              let fixOk = false;
              try {
                const fix = await raceTimeout(critFixRunner.run(judgeRepairPrompt(prompt, autoFixItems)), reviewerFixBudgetMs(autoFixItems.length, fixHeadroomMs()), 'reviewer-autofix');
                fixOk = !!fix.ok;
                // Only a verifiably-COMPLETED repair pass clears the false-success guard. A failed/thrown
                // pass (below) leaves reviewCriticalsUnresolved set → the build finalizes honestly NOT-ok.
                // (A completed pass is trusted here, matching the existing `result = fix` promotion; a
                // future slice could re-review to confirm the criticals are actually gone.)
                if (fix.ok) { result = fix; reviewCriticalsUnresolved = []; }
                // Persist the repair's writes — MERGE, never replace: writtenFiles holds only THIS
                // TURN's writes (on an edit turn that's a handful of files), and the old
                // saveWorkspaceFiles call REPLACED the whole durable index with that partial set —
                // the exact "49 files → 3" wipe. The store's shrink-guard also blocks the class.
                if (writtenFiles.size > 0) { try { await mergeWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)); } catch { /* best-effort */ } }
                // HONEST outcome (deep-test 2026-07-18): only claim "Auto-fixed" when the repair actually
                // SUCCEEDED — a failed pass (e.g. the provider chain 400'd) must NOT report the criticals as
                // fixed while they still ship. reviewerAutofixOutcome records the truthful line either way.
                try { buildDiag.record({ phase: 'build', ...reviewerAutofixOutcome(fix.ok, label) }); } catch { /* best-effort */ }
              } catch (e) {
                timedOut = e instanceof Error && /timed out/i.test(e.message);
                console.log(`[AGENTV3] reviewer auto-fix failed (attempt ${fixAttempt}): ${e instanceof Error ? e.message : String(e)}`);
                // A THROWN failure (timeout / abort) also leaves the criticals in place — report it honestly.
                try { buildDiag.record({ phase: 'build', ...reviewerAutofixOutcome(false, label) }); } catch { /* best-effort */ }
              }
              if (fixOk || abort.signal.aborted || !reviewerFixShouldRetry(fixAttempt, fixHeadroomMs(), timedOut)) break;
              // WHITE-LABEL narration — the retry is invisible plumbing; the user only sees us still working.
              events.emit({ type: 'narration', agent: 'architect', text: `🔧 Still resolving ${label} — taking another pass…`, ts: Date.now() });
            }
          }
        } catch { /* reviewer is best-effort (incl. its 90s cap) — never affects the build result */ }
      }

      // FINAL SYNTAX RE-VERIFY (deep-test 2026-07-18 — "handleExportCSV already declared"). The syntax gate
      // above parses the file set ONCE, early. The LATE repair passes that run after it (endgame repair,
      // reviewer-autofix) can RE-EDIT a file and REINTRODUCE a parse error — e.g. a DUPLICATE
      // `const handleExportCSV` declaration — that nothing then re-checks, so the build shipped a "READY
      // 84/100" card while the real in-browser preview died with "Identifier 'handleExportCSV' has already
      // been declared". Re-parse the FINAL file state (after every repair) with esbuild in-process; an
      // unhealed parse error is recorded as an UNRESOLVED OUTCOME_SYNTAX_ERROR, so buildHealthFromDiagnostics
      // (below) counts it as a blocker → ready:false — the card can never say READY for an app that won't
      // compile. Best-effort, shares the syntax-gate kill switch. It only ever DOWNGRADES an over-optimistic
      // verdict: findSyntaxErrors flags ONLY files that genuinely do not parse, so a good build is never
      // falsely blocked. (It does not re-run a repair here — the app is saved and an honest follow-up fixes
      // it — so a late repair can never loop.)
      // Through the same predicate as the four above (2026-08-05). This one is MILDER — it re-parses
      // only our own `writtenFiles` and never repairs, so on an import turn it merely parsed the
      // `.env` and cost nothing. Routed through anyway: leaving one gate on the old size-only guard
      // is how someone later widens it to the whole project and rebuilds the bug.
      if (result && postBuildCodeGateShouldRun({
        enabled: process.env.AGENTV3_SYNTAX_GATE !== 'off',
        fastLaneGated: false, buildOk: result.ok, wroteFiles: writtenFiles.size > 0,
        isImportTurn, aborted: abort.signal.aborted,
      })) {
        try {
          const finalSyntaxErrors = await findSyntaxErrors(Object.fromEntries(writtenFiles));
          if (finalSyntaxErrors.length > 0) {
            buildDiag.record({ phase: 'build', severity: 'error', code: 'OUTCOME_SYNTAX_ERROR', message: `${finalSyntaxErrors.length} file(s) do not parse in the final build — the app cannot compile:\n${syntaxRepairInstruction(finalSyntaxErrors)}`, autoResolved: false });
            events.emit({ type: 'narration', agent: 'architect', text: `⚠️ A syntax error remains in the final build — the app won't compile yet. Your files are saved; send a follow-up and I'll finish the fix.`, ts: Date.now() });
            // FALSE-SUCCESS GUARD (sibling): an app that does not compile is NOT a delivered app — flip the
            // verdict so both exits agree (buildResultRef drives the deadline finalizer; result drives the
            // normal settle) and the "working app or free" guard makes it free. findSyntaxErrors flags ONLY
            // genuinely non-parsing files (see the block header), so a good build is never falsely failed.
            if (result) result = { ...result, ok: false, summary: finalSyntaxErrorSummary(finalSyntaxErrors.length) };
            if (buildResultRef) buildResultRef = { ...buildResultRef, ok: false };
          }
        } catch { /* final syntax re-verify is best-effort — never blocks a build */ }
      }

      // AP-4 slice 1 (read-only): record the frontend/backend file partition as an admin advisory. This
      // writes nothing and parallelizes nothing — it is the load-bearing evidence for a future, flag-gated
      // parallel FE/BE build (safe only when the two sides own DISJOINT files). Best-effort; never affects
      // the build. `partitionable` on real builds is the signal that unblocks the next slice.
      // NOT ON AN IMPORT/SURVEY TURN (reports d5f0a2bc + 15985d3b, 2026-08-05). This partitions
      // `writtenFiles`, which on a survey turn is just the `.env` we wrote — so a plainly full-stack
      // 165-file app was described in the report as "0 frontend, 0 backend, 0 shared, 1 other. No
      // clean full-stack split". Every word of that was true about the one file it measured and
      // false about the app, which is the worst kind of wrong: a confident, specific, misleading
      // line in the admin's primary diagnostic. It measures what WE built, so on a turn where we
      // built nothing it stays silent rather than describing our own `.env`.
      if (result && result.ok && writtenFiles.size > 0 && !isImportTurn) {
        try {
          const fbPart = partitionFrontendBackend([...writtenFiles.keys()]);
          buildDiag.record({
            phase: 'build',
            severity: 'info',
            code: 'FE_BE_PARTITION',
            message: partitionSummary(fbPart),
            autoResolved: true,
          });
        } catch { /* partition analysis is best-effort — never blocks a build */ }
      }

      // EMPTY-BUILD HONESTY (deep-test App #7 — Trello task-board, 2026-07-13). A build that EXPECTED
      // artifacts but produced ZERO files is a FAILURE — never "✓ Done". The report showed `ok: true` /
      // "Done · 9 steps" over an EMPTY preview because the sandbox could not be set up (SANDBOX_UNAVAILABLE),
      // so no file could ever be written, yet the turn still ran 29 provider calls and reported success.
      // Force ok:false with an honest, retry-able summary so the terminal event, build health, billing
      // (already ₹0 via zeroBillReason), and telemetry all agree the build did NOT succeed. This runs
      // BEFORE the SPM settle / billing / finish below so every downstream consumer sees the truth.
      if (result && result.ok) {
        const emptyFail = emptyBuildFailureSummary(expectsArtifacts, writtenFiles.size, sandboxUnavailable);
        if (emptyFail) result = { ...result, ok: false, summary: emptyFail };
      }

      // FALSE-SUCCESS GUARD (normal settle) — mirror the deadline finalizer's check. A build whose
      // post-build reviewer found [CRITICAL]s that the C9 auto-fix did NOT verifiably resolve (it failed
      // or was skipped within budget) is NOT a success: flip to ok:false with an HONEST, actionable
      // summary so (a) the summary never lies ("✅ console clean") over a broken app, (b) billing is free
      // via the "working app or free" guard below (it keys on !result.ok), and (c) build health can't say
      // READY (the OUTCOME_REVIEW_CRITICAL blocker below + ok:false both force ready:false). The specific
      // findings stay in the ADMIN-only diagnostics (white-label — the user sees only the honest count).
      if (result && result.ok && reviewCriticalsUnresolved.length > 0) {
        const n = reviewCriticalsUnresolved.length;
        result = { ...result, ok: false, summary: reviewCriticalUnresolvedSummary(n) };
        if (buildResultRef) buildResultRef = { ...buildResultRef, ok: false };
        try {
          buildDiag.record({ phase: 'build', severity: 'error', code: 'OUTCOME_REVIEW_CRITICAL', message: `${n} reviewer [CRITICAL] finding(s) were not verifiably fixed — the app is not fully working:\n- ${reviewCriticalsUnresolved.join('\n- ')}`, autoResolved: false });
        } catch { /* best-effort */ }
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

      // GA-6 — Persistent engineering memory: capture THIS successful build's architecture decision as
      // a numbered/dated ADR, persist it per-project, and drop the markdown into the workspace so the
      // decision is both durable (read back into the next build above) and visible to the user. A
      // no-change rebuild appends nothing (stackChanged guard). Best-effort — never affects the outcome.
      // NEVER on an import/survey turn (mitrify autopsy 2026-07-27): an "architecture decision" for a turn
      // that decided nothing is meaningless, and writing ADR markdown into a repo the user asked us not to
      // touch is the same instruction violation the gates above close. Today `writtenFiles` is empty on a
      // survey turn so this could not fire — the gate makes that safety explicit instead of incidental.
      if (result.ok && userId && writtenFiles.size > 0 && !isImportTurn) {
        (async () => {
          try {
            const rec = await adrStore.record(userId, workspaceId, { framework, files: Object.fromEntries(writtenFiles), prompt }, new Date().toISOString());
            if (rec) {
              const { path, content } = renderAdrMarkdown(rec);
              // Only RECORD the write if it actually happened. A `.catch` that swallows a green-freeze
              // refusal and then calls onFileWrite would record a file the sandbox never received
              // (adversarial review 2026-08-12). Record-only-on-success keeps the two in step.
              let adrWritten = false;
              try { await actuator.writeFile(workspaceId, path, content); adrWritten = true; } catch { /* refused or failed */ }
              if (adrWritten) onFileWrite?.(path, content);
            }
          } catch { /* ADR capture is best-effort — never blocks or affects the build */ }
        })();
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
        // MISTAKE LEDGER: fold THIS build's real failures in, keyed by signature. The proven-fix rule
        // lives in the store — a fix is recorded only when the build actually SUCCEEDED, because a
        // "fix" harvested from a still-failing build is a guess, and a learning system that stores
        // guesses starts confidently teaching wrong answers.
        try {
          const d = buildDiag.report();
          const unresolvedErrors = (d.problems ?? [])
            .filter((p) => p.severity === 'error' && p.autoResolved !== true)
            .map((p) => p.message);
          const errs = unresolvedErrors.slice(0, 10);
          if (errs.length > 0) {
            void mistakeLedgerStore.recordBuild(userId, { ok: result.ok, errors: errs, fix: result.ok ? d.rootCause ?? null : null });
            // FLEET: the same outcome, recorded anonymously for every user — deliberately NO userId
            // argument (the store cannot leak what it is never given). Sanitization happens inside.
            void fleetMistakeLedgerStore.recordBuild({ ok: result.ok, errors: errs, fix: result.ok ? d.rootCause ?? null : null });
          }
          // GUARD EFFECTIVENESS: when a guard was injected at build start, measure whether the guarded
          // failures actually stayed away. A guard that fires and the mistake recurs anyway is the
          // learning system FAILING — that must surface as a warning in the report, never hide behind
          // "a guard ran". A clean hold is recorded too, so the loop's wins are countable, not vibes.
          if (mistakeGuardSigs.length > 0) {
            // Measured against ALL unresolved errors, not the ledger's bounded slice — a guarded
            // failure that recurred as error #11 must never be reported as "held".
            const recurred = new Set(unresolvedErrors.map((e) => mistakeKey(e)));
            const broke = mistakeGuardSigs.filter((sig) => recurred.has(sig));
            buildDiag.record(
              broke.length > 0
                ? {
                    phase: 'build', severity: 'warning', code: 'GUARD_REPEAT', autoResolved: false,
                    message: `A known-fixed mistake recurred DESPITE the guard (${broke.length}/${mistakeGuardSigs.length} guarded signature(s) came back). The proven fix did not prevent the repeat — this failure class needs an upstream/architectural fix, not a better reminder.`,
                  }
                : {
                    phase: 'build', severity: 'info', code: 'GUARD_HELD', autoResolved: true,
                    message: `Known-mistake guard held: none of the ${mistakeGuardSigs.length} guarded failure(s) recurred in this build.`,
                  },
            );
          }
        } catch { /* the ledger is best-effort — never affects the build result */ }
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
          // A SELF-HEAL THAT DID NOT LAST (open root cause from report 02be22e3, now measured). Each
          // repair pass re-reads the file fresh from the sandbox and only acts when the defect is
          // genuinely still there — so healing the SAME file twice in one build is proof the earlier
          // write was absent on the next read. Recorded with names and counts so the next report can
          // be acted on instead of re-suspected. ADMIN-ONLY: the user never sees our repair passes.
          try {
            const repeats = healRepeats(workspaceId);
            if (repeats.length > 0) {
              buildDiag.record({
                phase: 'build', severity: 'warning', code: 'HEAL_NOT_DURABLE',
                message: healRepeatMessage(repeats), autoResolved: false,
              });
            }
          } catch { /* evidence gathering must never break a build */ }
          // ── ROUTE FINGERPRINT (admin 2026-08-09: "jo jo bacha hai usko bhi smart fix karo") ──────
          // Green Guard judged "green" from ONE url — the home page. So an edit that left the home page
          // rendering while breaking /admin ended the turn GREEN, the broken state became the new last
          // known good, and the guard protected the damage. That is the largest remaining way a working
          // app gets quietly broken, and the one a user finds days later.
          //
          // Here the pages that worked LAST time are re-opened. Losing one VETOES green, which hands the
          // turn straight to Green Guard's restore. Deliberately cheap and deliberately asymmetric:
          // it runs only on a turn that already looks green (a failing build pays nothing), it opens at
          // most MAX_CHECK_ROUTES pages, and a page that never rendered is NOT held against this turn —
          // only losing something we ourselves watched working counts.
          let routeChecks: Array<{ route: string; rendered: boolean }> = [];
          if (previewGreen && routeFingerprintEnabled() && lastPreviewUrl && actuator.browseUrl && !abort.signal.aborted) {
            try {
              const fpKey = fingerprintWorkspaceKey(workspaceId);
              const previous = decodeFingerprint(await loadWorkspaceFiles(fpKey).catch(() => ({})));
              // Watch the SAME pages as last time first, so two records are always comparable; top up
              // from the project's own declared routes when there is nothing recorded yet.
              const declared = getWorkspaceMemory(workspaceId).snapshot()?.graph?.routes ?? [];
              const toCheck = pickCheckRoutes(previous?.ok?.length ? previous.ok : declared);
              for (const r of toCheck) {
                if (abort.signal.aborted) break;
                const url = r === '/' ? lastPreviewUrl : `${lastPreviewUrl.replace(/\/$/, '')}${r}`;
                try {
                  const html = (await withTimeout(actuator.browseUrl(workspaceId, url), 20_000, 'route-fingerprint')).html;
                  routeChecks.push({ route: r, rendered: analyzePreviewHtml(html).rendered });
                } catch { /* unreachable ≠ broken by this turn — simply not measured */ }
              }
              const broken = regressedRoutes(previous, routeChecks);
              if (broken.length > 0) {
                previewGreen = false; // veto: Green Guard now restores instead of protecting the damage
                buildDiag.record({
                  phase: 'preview', severity: 'warning', code: 'ROUTE_REGRESSION',
                  message: regressionMessage(broken), autoResolved: false,
                });
              } else if (routeChecks.some((c) => c.rendered)) {
                // Record what worked, under its OWN key so a restore never writes it into the app.
                await saveWorkspaceFiles(fpKey, encodeFingerprint(buildFingerprint(routeChecks, Date.now()))).catch(() => {});
              }
            } catch { /* the fingerprint is an extra safety net — it must never break a build */ }
          }
          // ── GREEN GUARD, LAYER 2 (admin 2026-08-09) ──────────────────────────────────────────────
          // "Pehli build me working app ban jati hai — baad me edit kar ke kharab kyu kiya jata hai?"
          // Because THIS line saves whatever the turn produced, good or broken: the durable project has
          // always been "the last turn", never "the last WORKING turn". So a bad edit overwrote the good
          // app, whose only other copy was a git commit in a sandbox that gets recycled.
          //
          // Now: a turn that ended VERIFIED-GREEN is also kept as the last known good; a turn that ended
          // broken on an app that WAS green is put back. The property this buys is the one EndgameRepair
          // already proves for a single repair pass — a turn can help or do nothing, never harm.
          //
          // The failed attempt is NEVER destroyed: it is kept under its own key first, so "restore" costs
          // the user nothing and a deliberate work-in-progress is recoverable rather than erased.
          // Everything here is best-effort and flag-gated; on ANY failure the original save still happens
          // exactly as before. Kill switch: AGENTV3_GREEN_GUARD=off.
          let saved = false;
          if (greenGuardEnabled()) {
            try {
              const greenKey = greenWorkspaceKey(workspaceId);
              const snapshot = await loadWorkspaceFiles(greenKey).catch(() => ({} as Record<string, string>));
              const hasSnapshot = Object.keys(snapshot).length > 0;
              const decision = decideGreenGuard({
                before: { green: hasSnapshot },
                after: { green: previewGreen },
                hasSnapshot,
                // Carried so the recorded reason cannot claim more than the build itself reported.
                ready: !buildDiag.hasUnresolvedReadinessBlocker(),
              });
              buildDiag.record({
                phase: 'build', severity: 'info', code: `GREEN_GUARD_${decision.action.toUpperCase()}`,
                message: decision.reason, autoResolved: true,
              });
              if (decision.action === 'save') {
                await saveWorkspaceFiles(workspaceId, toSave);
                saved = true;
                // The new last known good. Written AFTER the project save so a failure here can never
                // cost the user their actual files.
                await saveWorkspaceFiles(greenKey, toSave).catch(() => {});
              } else if (decision.action === 'restore') {
                const plan = restorePlan(snapshot, toSave);
                // Keep the broken attempt before undoing it — nothing the user paid for is thrown away.
                await saveWorkspaceFiles(attemptWorkspaceKey(workspaceId), toSave).catch(() => {});
                await runInPass('green-guard-restore', async () => {
                  for (const [path, content] of Object.entries(plan.write)) {
                    try { await actuator.writeFile(workspaceId, path, content); } catch { /* per-file best-effort */ }
                  }
                });
                const rm = buildRemoveCommand(plan.remove);
                if (rm) { try { await withTimeout(actuator.runCommand(workspaceId, rm), 20_000, 'green-guard-remove'); } catch { /* best-effort */ } }
                await saveWorkspaceFiles(workspaceId, snapshot);
                saved = true;
                if (plan.remove.length > 0) await removeWorkspaceFiles(workspaceId, plan.remove).catch(() => {});
                events.emit({ type: 'narration', agent: 'architect', text: greenGuardMessage(plan), ts: Date.now() });
                buildDiag.record({
                  phase: 'build', severity: 'warning', code: 'GREEN_GUARD_RESTORED',
                  message: `Restored the last verified-working version: ${Object.keys(plan.write).length} file(s) put back, ${plan.remove.length} added by the failed attempt removed, ${plan.unchanged} already correct. The attempt itself is kept and was not discarded.`,
                  autoResolved: true,
                });
              }
            } catch { /* the guard must never cost a user their save — fall through to the plain save */ }
          }
          if (!saved) saveWorkspaceFiles(workspaceId, toSave).catch(() => {});
          // P-BRE.2 — incremental signal: compare this build's file hashes to the previous build's
          // (Firestore-cached per workspace), report how many files were UNCHANGED, and store the new
          // hashes for next time. Best-effort — never affects the build or the save above.
          try {
            const prevHashes = await incrementalBuildCache.getHashes(workspaceId);
            // GA-4 — unified incremental plan: unchanged + IMPACTED (blast radius) + deps-changed signal.
            const plan = computeBuildPlan(prevHashes, toSave);
            const line = buildPlanNarration(plan);
            if (line) events.emit({ type: 'narration', agent: 'architect', text: line, ts: Date.now() });
            incrementalBuildCache.setHashes(workspaceId, hashFiles(toSave), new Date().toISOString()).catch(() => {});
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
                  `Edits by NavBharatAI Pro v5.0 on \`${ownRepoTarget.workBranch}\`. Review and merge into \`${ownRepoTarget.baseBranch}\` when ready.`,
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
                body: 'Automated build by NavBharatAI Pro v5.0.',
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
      // BILLING ACCOUNTING FIX (2026-07-10) — charge the WHOLE build's real token spend, not one
      // runner's turns. `buildUsage` has accumulated every token-spending unit: the fast lane, the
      // blueprint/plan step, the main agentic runner, EVERY sub-agent (where the Architect delegates
      // all app code — the biggest previously-dropped leak), and every escalation/heal/fix/retry
      // runner (whose `result` used to REPLACE the main build's, discarding its billing). Billed at
      // the build's power tier, exactly as before. This supersedes the old `result.billedUsd +
      // blueprintUsage` sum (both are subsets of the sink now, so there is no double-count). The
      // zeroing rules below (empty build / unrendered preview / free onboarding) still apply.
      // Billing Phase 3 — reconcile the per-provider ledger against the billing sink's grand total so
      // the per-provider view (admin usage-report) always sums to exactly what was billed; the aux-call
      // remainder lands in the 'other' bucket. Cost is unchanged unless per-tier billing is flipped ON.
      // BILLING (admin model 2026-07-14, Fix 65): Opus tiers (Powerful/Full Team) keep "real Opus × 2";
      // every non-Opus tier (Weak/Normal/Strong) bills tieredMarkup(REAL provider cost). Computed by the
      // shared decideBuildBilledUsd so this settle path and the watchdog finalization (Fix 67) never
      // drift. The realcost path is default-ON (kill-switch `AGENTV3_REALCOST_BILLING`).
      const { effectiveBilledUsd: decidedBilledUsd, reconciledProviderUsage } =
        decideBuildBilledUsd(providerLedger, buildUsage.total(), powerLevelReqEffective, userId ?? undefined, email, billableSandboxUsd(actuator, workspaceId));
      let effectiveBilledUsd: number = decidedBilledUsd;
      // WHY a build ended up free — recorded into the build report's billing section (admin
      // 2026-07-11) so a ₹0 build always explains itself.
      let zeroBillReason: string | undefined;
      // NEVER charge for a build that produced nothing. If the user asked for an app/edit and
      // zero files were created (even after the Claude retry), the build failed — bill ₹0.
      // "Preview is EARNED" cuts both ways: no artifacts, no charge.
      if (expectsArtifacts && writtenFiles.size === 0) {
        effectiveBilledUsd = 0;
        zeroBillReason = 'empty build (0 files produced) — never charged';
        // FREE-TIER: a cheap-only free build that produced nothing is NOT rescued on Claude (that would
        // spend the very budget free-tier protects). Instead, honestly invite the user to add credits
        // and finish on the strongest engine — converting the user to paid without shipping a broken app.
        if (freeTierBuildActive) {
          events.emit({ type: 'narration', agent: 'architect', text: freeTierUpsellMessage(), ts: Date.now() });
        }
      }
      // Admin rule (2026-07-07): the server's own eyes saw the preview NOT render after the heal
      // budget — the app was not delivered, so the build is free. Same "preview is EARNED" law,
      // now enforced on the money too.
      if (zeroBillForUnrenderedPreview(expectsArtifacts, previewVerifiedFailed)) {
        effectiveBilledUsd = 0;
        zeroBillReason = 'preview did not render on verification — "preview is EARNED", so free';
        events.emit({ type: 'narration', agent: 'architect', text: '🛡️ Because the preview did not fully render on my verification, this build is FREE — no charge. Send a follow-up and I will fix it.', ts: Date.now() });
      }
      // FAILED-BUILD GUARD (admin 2026-07-14): a build that was expected to produce an app but did NOT
      // succeed must never be charged in full. Real case that triggered this: a weak-tier build failed
      // (readiness 0/100, 7 unresolved imports) yet was still billed ₹811. Same "working app or free"
      // law as the empty-build + unrendered-preview rules above — extended to any unsuccessful build
      // that slipped past them (files written but the build reported failure). Only ever REDUCES a charge.
      // 2026-07-27: condition widened from `expectsArtifacts && !result.ok` to just `!ok` — see
      // zeroBillForFailedBuild. An import/survey turn has expectsArtifacts=false, so a FAILED one
      // (syntax error + 29-min timeout) was billed ₹19.08 while telling the user it was free.
      if (zeroBillForFailedBuild(result.ok) && effectiveBilledUsd > 0) {
        effectiveBilledUsd = 0;
        zeroBillReason = 'build did not succeed — "working app or free", so no charge';
        events.emit({ type: 'narration', agent: 'architect', text: '🛡️ This build did not fully succeed, so it is FREE — no charge. Send a follow-up and I will fix it.', ts: Date.now() });
      }
      if (userId && result.ok && effectiveBilledUsd > 0 && freeOnboardingLimit() > 0) {
        const isFree = await onboardingCreditStore
          .consumeFreeBuild(userId, freeOnboardingLimit())
          .catch(() => false);
        if (isFree) {
          effectiveBilledUsd = 0;
          zeroBillReason = 'free onboarding build (new-user welcome credit)';
          events.emit({ type: 'narration', agent: 'architect', text: '🎁 This build is on us — welcome to NavBharatAI Pro!', ts: Date.now() });
        }
      }

      // Bill the user the marked-up cost (D5/D6), recorded in the same place the
      // platform records every build's cost. Best-effort — never blocks the run.
      // Internal accounting stays in USD (currency-stable); the customer-facing amount
      // is shown in INR (billedInr = billedUsd × the real-time USD→INR rate).
      // BILLING PHASE 1 — the charge is also actually DEBITED from the wallet. Before this,
      // the wallet was only ever credited: builds recorded a display-only monthly cost but
      // never decremented tokenBalance/remaining_balance, so the pre-flight gate compared
      // estimates against a balance that never went down (one recharge = unlimited builds).
      // Tokens leave at the SAME rate purchases mint them (TOKENS_PER_RUPEE); the debit is
      // idempotent per buildRef and awaited so the result event can show the real deduction.
      // A debit failure never blocks the result, but is loudly logged — money, not noise.
      // COHERENCE FIX (2026-07-10): the real wallet DEBIT must activate together with the rest of the
      // paid surface — the pre-flight estimate gate (L3099), the empty-balance BLOCK, and the header
      // balance chip are all gated on `paid-public OR credit-gate` AND non-free-user. The debit was
      // the one piece running UNGATED, so with billing "off" a user's wallet drained invisibly (no
      // chip, no block) and a later flag-on would strand every account at a negative balance from
      // spend they never saw. Now all four move as one: billing off → builds are free & wallets are
      // untouched (today's behavior); flag on → chip + estimate gate + debit + block all activate.
      // The display-only monthly cost (userCostStore) still records always — it is an internal
      // estimate surface, not a money movement.
      const billingActive = (isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()) && !isAgentV3FreeUser(userId, email);
      let walletDebit: { tokensDebited: number; tokenBalance: number } | null = null;
      if (userId && effectiveBilledUsd > 0) {
        userCostStore.record(userId, effectiveBilledUsd).catch(() => {});
      }
      // GA-6 — persistent engineering memory: funnel this build's unfixed security findings into the
      // cross-build tech-debt register (which had no automatic producer, so it stayed empty). Best-effort,
      // deduped+aged by the store; never affects the build or the result.
      if (userId) {
        try {
          const debtFindings = findingsToDebt({ security: getWorkspaceMemory(workspaceId).securityFindings() });
          if (debtFindings.length) void recordDebt(userId, workspaceId, debtFindings, new Date().toISOString());
        } catch { /* best-effort — never block the result */ }
      }
      if (userId && effectiveBilledUsd > 0 && billingActive) {
        try {
          const debitRes = await debitWalletForBuild(getDb() as any, userId, {
            billedInr: effectiveBilledUsd * usdInrRate(),
            buildRef: `${workspaceId}_${buildStartedAt}`,
            description: 'NavBharatAI Pro v5.0 build',
          });
          if (debitRes.ok) {
            walletDebit = { tokensDebited: debitRes.tokensDebited, tokenBalance: debitRes.tokenBalance };
          } else {
            console.error(`[AGENTV3 BILLING] Wallet debit FAILED for user ${userId} (build ${workspaceId}): ${debitRes.error} — cost was recorded but the balance was not decremented.`);
          }
        } catch (err: any) {
          console.error(`[AGENTV3 BILLING] Wallet debit threw for user ${userId}: ${err?.message || err}`);
        }
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
          // Billing accounting fix: record the ACTUAL charged amount + the WHOLE build's tokens
          // (from the sink), so the cost-ladder measurement reflects real spend, not one runner's turns.
          billedUsd: effectiveBilledUsd,
          inputTokens: buildUsage.total().inputTokens,
          outputTokens: buildUsage.total().outputTokens,
          ok: result.ok,
          powerMode: onlyOpus,
          durationMs: Math.max(0, Date.now() - buildStartedAt),
          // P-PE.2 — record which architect prompt version produced this build.
          promptVersion: architectPromptVersion || undefined,
          // PR4 — the provider that drove most build turns (cheap-floor-vs-Claude tripwire).
          deliveredVia: dominantProvider(providerTurns),
          // T1-escalation-on — the canary A/B labels: which cohort this build was in ('in'/'out'/'off',
          // same workspaceId key as the gates so labels match behaviour) + whether the ladder climbed.
          escalationCohort: escalationCohort(workspaceId),
          escalations: escalationsCount,
          // Billing Phase 3 — per-provider token attribution (reconciled to the billed total) + loss
          // accounting. A LOSS = real tokens spent (buildUsage>0) but the build was zeroed (empty /
          // unrendered preview / free onboarding) → NavBharatAI ate the Sonnet-equivalent cost.
          providerUsage: reconciledProviderUsage,
          wasLoss: effectiveBilledUsd === 0 && buildUsage.total().outputTokens > 0,
          lossRealCostUsd: effectiveBilledUsd === 0 ? sonnetEquivalentUsd(buildUsage.total()) : 0,
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
        // BILLING & PROVIDERS into the report (admin 2026-07-11): who the build ran for (free/paid),
        // the REAL settled charge + wallet debit, why a ₹0 build was free, and the per-provider token
        // split — written from the SAME values the user was billed on, never re-derived.
        try {
          // WEAK-MODULE NO-CLAUDE HONESTY (admin absolute rule + rule 5 "fix the system's honesty too",
          // 2026-07-13). The report's `noClaude` must state the TRUTH, never the intent. The verdict reads
          // the PROVIDER DELIVERY / token ledger (the runner that ACTUALLY answered each turn), NOT an
          // llmCall's nominal `model` label — App #5 proved the label lies: a 100%-GLM build recorded every
          // turn as 'claude-sonnet-4-6' (the requested model) while GLM delivered them all, which the old
          // label check false-flagged as a violation. The runtime chokepoint (ClaudeClient's zone guard)
          // blocks a real Claude call on a weak build before it runs, so this should read clean; if Claude
          // still DELIVERED a turn (a genuine chain leak), report noClaude:false + a loud NO_CLAUDE_VIOLATION.
          // Provider tokens must be set FIRST so the detector can see the corroborating cost signal.
          buildDiag.setProviderTokens(reconciledProviderUsage);
          // Observation only — see shadowFastLaneLedger. Never read by the cost path; it exists so the
          // fast-lane attribution decision can be made on a measured number instead of an estimate.
          try { buildDiag.setShadowFastLaneTokens(shadowFastLaneLedger.byProvider()); } catch { /* best-effort */ }
          buildDiag.setCacheReadInputTokens(billingCtx.cacheReadInputTokens ?? 0);
          const leakedClaudeProvider = noClaudeBuild ? buildDiag.claudeProviderDelivered() : null;
          if (leakedClaudeProvider) {
            buildDiag.record({
              phase: 'provider',
              severity: 'error',
              code: 'NO_CLAUDE_VIOLATION',
              message: `Weak-module absolute rule VIOLATED: this weak/free build was delivered by a Sonnet/Opus-class Claude (${leakedClaudeProvider}) despite the guarantee (only the Haiku last resort is authorized on weak — admin amendment 2026-07-13). Billing.noClaude is reported as false (the truth). Investigate the leaking gate — a weak build must never spend NavBharatAI's premium Claude budget.`,
              autoResolved: false,
            });
          }
          buildDiag.setBilling({
            userTier: isAgentV3FreeUser(userId, email)
              ? 'free-list (admin/tester)'
              : freeTierBuildActive
                ? 'free (welcome bonus — cheap engines)'
                : billingActive
                  ? 'paid'
                  : 'billing-off (no charge)',
            billedUsd: Math.round(effectiveBilledUsd * 1_000_000) / 1_000_000,
            billedInr: Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100,
            ...(walletDebit && walletDebit.tokensDebited > 0 ? { walletTokensDebited: walletDebit.tokensDebited } : {}),
            ...(zeroBillReason ? { zeroBillReason } : {}),
            powerMode: onlyOpus,
            powerLevel: powerLevelReqEffective,
            // The TRUTH, not the intent: only `true` when the build was meant to be Claude-free AND no
            // Claude provider actually delivered a turn. A real leak flips this to false (+ the violation above).
            noClaude: noClaudeBuild && !leakedClaudeProvider,
          });
        } catch { /* report enrichment is best-effort — never blocks the report itself */ }
        // U-1 — record the signed determinism-audit manifest (routing inputs + sha256 of every written
        // file, HMAC-signed by SECRET_ENCRYPTION_KEY when present). Best-effort; never blocks the report.
        try {
          // HONEST manifest identity (ShopSphere autopsy 2026-07-19): record the model that ACTUALLY
          // delivered (the ledger's dominant-provider model), not the nominal Claude fallback id — a
          // weak GLM build must never read as `claude-sonnet-4-6`. deliveredVia carries the provider.
          const deliveredViaProvider = dominantProvider(providerTurns);
          const deliveredModel = deliveredModelId(providerLedger.entries(), deliveredViaProvider);
          const manifest = signManifest(
            buildBuildManifest({
              buildId,
              promptHash,
              model: deliveredModel || String(model),
              deliveredVia: deliveredViaProvider,
              effort: powerSpecResolved?.effort,
              powerLevel: powerLevelReqEffective,
              framework,
              createdAt: new Date().toISOString(),
              files: Object.fromEntries(writtenFiles),
            }),
            process.env.SECRET_ENCRYPTION_KEY,
          );
          buildDiag.recordManifest(manifest);
        } catch { /* manifest is best-effort — never blocks the build or report */ }
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
        decisionTrace.record('model', `${deliveredTier} (${model})`, onlyOpus ? `pinned tier '${powerLevelReqEffective}' selected` : `analyzer chose ${analysis?.startTier ?? 'default'} start tier`, nowIso);
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
      // U-3 — FIRST-BUILD-CORRECT (prevent-not-heal, admin 2026-07-31): deterministically strip the model's
      // OWN provably-dead NAMED imports from the files it wrote THIS build, so the reviewer never spends a
      // whole "fix the error" round removing them and the app ships clean the first time. Safe by
      // construction (keep-on-any-doubt; never touches side-effect / namespace / default imports — see
      // UnusedImportSweep). Additive + best-effort; kill switch AGENTV3_IMPORT_SWEEP=off.
      try {
        if (result.ok && expectsArtifacts && writtenFiles.size > 0 && importSweepEnabled()) {
          const src: Record<string, string> = {};
          for (const [p, c] of writtenFiles) {
            if (typeof c === 'string' && /\.(mjs|cjs|jsx?|tsx?)$/i.test(p) && !/\.d\.ts$/i.test(p)) src[p] = c;
          }
          const cleaned = sweepUnusedImports(src);
          const savedSweep: Record<string, string> = {};
          for (const [p, c] of Object.entries(cleaned)) {
            try {
              await actuator.writeFile(workspaceId, p, c);
              writtenFiles.set(p, c);
              try { getWorkspaceMemory(workspaceId).indexFile(p, c); } catch { /* index best-effort */ }
              savedSweep[p] = c;
            } catch { /* one write failing must not block the rest */ }
          }
          if (Object.keys(savedSweep).length > 0) {
            await saveWorkspaceFiles(workspaceId, savedSweep).catch(() => {});
            events.emit({ type: 'narration', agent: 'architect', text: `🧹 Cleaned unused imports from ${Object.keys(savedSweep).length} file(s) — no wasted fix-up round.`, ts: Date.now() });
          }
        }
      } catch { /* the import sweep is best-effort — never affects the build result */ }
      // U-4 — FIRST-BUILD-CORRECT: a Vite app must ALWAYS have its config (missing-config autopsy 2026-07-31).
      // A real "continue" build FAILED (ok:false) because the app had `vite` in its deps but NO vite.config
      // at all — the reviewer's "Missing vite.config.ts — the build will fail." Materialize a minimal,
      // correct config when it's missing, persisted to the durable store + GitHub so THIS app and every
      // future continue can build. Runs even on a NOT-ok build (this IS the fix for it); loads the FULL file
      // set (not just this turn's writes) to judge presence; never clobbers an existing config; best-effort.
      try {
        if (expectsArtifacts) {
          const full = await loadWorkspaceFiles(workspaceId).catch(() => ({} as Record<string, string>));
          const cfg = ensureViteConfig(full);
          if (cfg && full[cfg.path] === undefined) {
            try {
              await actuator.writeFile(workspaceId, cfg.path, cfg.content);
              writtenFiles.set(cfg.path, cfg.content);
              try { getWorkspaceMemory(workspaceId).indexFile(cfg.path, cfg.content); } catch { /* index best-effort */ }
              await saveWorkspaceFiles(workspaceId, { [cfg.path]: cfg.content }).catch(() => {});
              events.emit({ type: 'narration', agent: 'architect', text: `🧩 Added the missing ${cfg.path} — a Vite app needs it to build.`, ts: Date.now() });
            } catch { /* best-effort — a write failure must never affect the build result */ }
          }
        }
      } catch { /* the vite-config ensure is best-effort — never affects the build result */ }
      // U-2 — app-scaffold quality defaults BY DEFAULT. After a successful build with an index.html,
      // deterministically ensure SEO/OG meta, viewport, html lang, theme-color, a web manifest + a real
      // installable icon, robots.txt, and an offline-first service worker (+ its registration) — the same
      // by-default discipline as the auto-test pass above, instead of hoping the model calls the tool.
      // Pure + idempotent: only MISSING tags/files are added, existing files are never clobbered. Additive
      // and best-effort — never blocks or fails the build.
      try {
        if (result.ok && expectsArtifacts && writtenFiles.size > 0) {
          const idxPath = writtenFiles.has('index.html') ? 'index.html' : (writtenFiles.has('public/index.html') ? 'public/index.html' : 'index.html');
          let indexHtml: string | null = writtenFiles.get(idxPath) ?? null;
          if (indexHtml == null) {
            try { indexHtml = await actuator.readFile(workspaceId, idxPath); } catch { indexHtml = null; }
          }
          const appName = deriveTitle(prompt) || 'App';
          const defaults = planAppDefaults(indexHtml, appName);
          const savedDefaults: Record<string, string> = {};
          // Patch index.html only when the generator actually changed it.
          if (defaults.indexHtml != null && indexHtml != null && defaults.indexHtml !== indexHtml) {
            try {
              await actuator.writeFile(workspaceId, idxPath, defaults.indexHtml);
              writtenFiles.set(idxPath, defaults.indexHtml);
              try { getWorkspaceMemory(workspaceId).indexFile(idxPath, defaults.indexHtml); } catch { /* index best-effort */ }
              savedDefaults[idxPath] = defaults.indexHtml;
            } catch { /* one write failing must not block the rest */ }
          }
          // Standalone files (manifest, robots, icon, sw) — write only when ABSENT (never clobber a real one).
          // FRAMEWORK-AWARE PATH (deploy-report autopsy 2026-08-03): a Vite app ships ONLY what's under
          // public/, so these must land in public/ or `npm run build` drops them from dist/ and the deploy
          // 404s them (which made a real build grind 7 rebuilds copying them by hand). defaultAssetPath →
          // public/<file> for a Vite framework, root otherwise. Kill switch AGENTV3_VITE_PUBLIC_ASSETS=off.
          const publicAssets = (process.env.AGENTV3_VITE_PUBLIC_ASSETS ?? '').trim().toLowerCase() !== 'off';
          for (const [rel, content] of Object.entries(defaults.files)) {
            const target = publicAssets ? defaultAssetPath(rel, framework) : rel;
            if (writtenFiles.has(target)) continue;
            let exists = false;
            try { await actuator.readFile(workspaceId, target); exists = true; } catch { exists = false; }
            if (exists) continue;
            try {
              await actuator.writeFile(workspaceId, target, content);
              writtenFiles.set(target, content);
              try { getWorkspaceMemory(workspaceId).indexFile(target, content); } catch { /* index best-effort */ }
              savedDefaults[target] = content;
            } catch { /* best-effort per file */ }
          }
          if (Object.keys(savedDefaults).length > 0) {
            await saveWorkspaceFiles(workspaceId, savedDefaults).catch(() => {});
            if (defaults.added.length > 0) {
              events.emit({ type: 'narration', agent: 'architect', text: `🧩 Added production defaults: ${defaults.added.join(', ')} + a web manifest, icon, robots.txt and an offline service worker.`, ts: Date.now() });
            }
          }
        }
      } catch { /* app-scaffold defaults are best-effort — never affect the build result */ }
      // ENTRY-FILE DUPLICATE-IMPORT SWEEP (build-report + IMG autopsy 2026-08-02, RECURRING): the entry file
      // (src/main.tsx) repeatedly shipped BOTH `import ErrorBoundary from './ErrorBoundary'` AND
      // `import { ErrorBoundary } from './ErrorBoundary'` → babel/Vite hard-fail "Duplicate declaration
      // 'ErrorBoundary'" → the in-browser preview won't compile AND the dev server never binds its port
      // ("Closed Port Error on 5173"), so the whole app white-screens. The write-time guards (ToolDispatcher
      // #1999 / full-stack guards) only run on the paths THEY own, and the entry file can be shaped by the
      // scaffold + a post-build injector too — so a duplicate slips through on the vite-react path. This is
      // the LAST choke point before the app is declared done: after every write, sweep the entry file with
      // the same deterministic same-module dedupe (keep the first binding, drop a later redundant one). Pure
      // + safe (only removes a binding that already exists); best-effort — never affects the build result.
      try {
        if (result.ok && expectsArtifacts && writtenFiles.size > 0) {
          const entryFromWrites = ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'main.tsx', 'main.jsx']
            .find((p) => writtenFiles.has(p));
          let entryResolved: string | undefined = entryFromWrites;
          let entrySrc: string | null = entryFromWrites ? (writtenFiles.get(entryFromWrites) ?? null) : null;
          // The entry may live only on disk (written by the scaffold, not this turn's writtenFiles map).
          if (!entrySrc) {
            for (const cand of ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx']) {
              try { entrySrc = await actuator.readFile(workspaceId, cand); entryResolved = cand; break; } catch { /* try next */ }
            }
          }
          if (entryResolved && entrySrc) {
            const deduped = dedupeSameModuleImports(entryResolved, entrySrc);
            if (deduped !== entrySrc) {
              await actuator.writeFile(workspaceId, entryResolved, deduped);
              writtenFiles.set(entryResolved, deduped);
              try { getWorkspaceMemory(workspaceId).indexFile(entryResolved, deduped); } catch { /* index best-effort */ }
              await saveWorkspaceFiles(workspaceId, { [entryResolved]: deduped }).catch(() => {});
              events.emit({ type: 'narration', agent: 'architect', text: `🔧 Removed a duplicate import in \`${entryResolved}\` that would have broken the preview ("Duplicate declaration").`, ts: Date.now() });
            }
          }
        }
      } catch { /* entry-file dedupe is best-effort — never affects the build result */ }
      // P-UX.7 — surface the build's token count to the client (in + out) for a usage badge. 0 → omitted.
      const totalTokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      // SOFTWARE PROJECT MODE (SPM-2): a successful MODULE turn with plan modules still buildable
      // marks the result `resumable`, so the existing Layer-3 client auto-continue drives the next
      // module without the user typing "continue". Only on ok (a failed module stops the loop for
      // an explicit user decision) and only when the plan can actually advance (never on blocked).
      const projectContinue = projectPlanRef && result.ok && !planComplete(projectPlanRef) && nextBuildableModule(projectPlanRef)
        ? { resumable: true, planRemaining: projectPlanRef.modules.filter((m) => m.status !== 'done').length }
        : {};
      // T1-budget-ux: a budget-cap stop is an honest PAUSE (budgetReached flows through `...result`). It is
      // deliberately NOT marked `resumable` — the client must NOT silently auto-continue and keep spending;
      // the user chooses "Continue" explicitly (each continue is a fresh run with a fresh budget window).
      // T1-health-card: derive the objective build-health verdict from the diagnostics the build already
      // computed (zero extra cost) and ship it with the result — the reducer + <BuildHealthCard/> already
      // render it. Additive: the field is optional and the client no-ops when it's absent.
      const buildHealth = buildHealthFromDiagnostics(diagnostics, result.ok);
      // T1-cost-transparency: the "why this build cost ₹X" breakdown — token split, tier, markup, base cost.
      // Only when the build was actually billed (>0); a free build has no charge to explain.
      // Cost transparency — the user-facing "what this build cost" breakdown. ANONYMIZED (admin rule
      // 2026-07-15): tokens + the real bill + the user's tier, branded NavBharatAI — never a provider/
      // model name or our internal cost/markup (those stay in the admin diagnostics report only). One
      // consistent shape for every tier, so the client render can never crash on a per-tier mismatch.
      const costBreakdown = effectiveBilledUsd <= 0
        ? null
        : userCostBreakdown(buildUsage.total(), effectiveBilledUsd, powerLevelReqEffective, usdInrRate());
      // WEAK-TIER FAILURE GUIDANCE (admin spec 2026-08-02): when a real build attempt FAILS on the weak
      // tier (the free engine, or a paid user who picked Weak), tell the user — in their OWN language —
      // the honest, actionable reason: a complex app needs a stronger tier, switchable via the ⚙️ options
      // button. Gated to `!result.ok && noClaudeBuild && expectsArtifacts` so it only fires on a genuine
      // failed build on the weak tier — infra/sandbox failures short-circuit earlier and never reach here,
      // so the tier is never blamed for a platform outage. White-label safe (names tiers, never a model).
      // Kill switch AGENTV3_WEAK_FAIL_NOTICE=off. Appended to the failure summary so it rides the same bubble.
      if (!result.ok && noClaudeBuild && expectsArtifacts && (process.env.AGENTV3_WEAK_FAIL_NOTICE ?? '').trim().toLowerCase() !== 'off') {
        const failLang = detectLanguageHint(prompt)?.code ?? null;
        result = { ...result, summary: `${result.summary ? `${result.summary}\n\n` : ''}${weakTierBuildFailedNotice(failLang)}` };
      }
      // "WHAT THIS APP NEEDS FROM YOU" (admin question 2026-08-03: can v5.0 handle DB / multi-feature apps,
      // and should it tell the user to paste keys in Settings?). A built app can be technically perfect and
      // STILL have a Pay button that cannot charge, because the gateway key can only come from the user's
      // OWN account — that is precisely the "looks done but does nothing" state the second absolute rule
      // forbids. So on a SUCCESSFUL build we read the real output (declared packages + the env-vars the code
      // actually references), subtract every secret the user has ALREADY saved, and append a SHORT localized
      // checklist naming the exact key names and the exact settings path.
      // Deliberately NOT a blocker and NOT a pre-build questionnaire: the app is built and shown first, the
      // sandbox Postgres is still auto-provisioned silently (kind 'auto' is never surfaced), and a plain app
      // — the overwhelmingly common case — produces an empty string and no extra line at all. Zero LLM cost:
      // the detector is pure static analysis. Kill switch AGENTV3_APP_REQUIREMENTS=off.
      if (result.ok && expectsArtifacts && (process.env.AGENTV3_APP_REQUIREMENTS ?? '').trim().toLowerCase() !== 'off') {
        try {
          const missing = unconfiguredRequirements(detectAppRequirements({ files: writtenFiles, prompt }), vaultSecrets);
          const notice = appRequirementsNotice(missing, detectLanguageHint(prompt)?.code ?? null);
          if (notice) {
            result = { ...result, summary: `${result.summary ? `${result.summary}\n\n` : ''}${notice}` };
            buildDiag.record({
              phase: 'build', severity: 'info', code: 'APP_REQUIREMENTS_SURFACED', autoResolved: false,
              message: `Told the user which of their own credentials this app still needs: ${missing.map((r) => r.id).join(', ')}`.slice(0, 400),
            });
          }
        } catch {
          // A notice is never worth failing a successful build over — stay silent and ship the app.
        }
      }
      emit({ type: 'result', ...result, ...projectContinue, buildId, promptHash, billedUsd: effectiveBilledUsd, billedInr: Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100, ...(totalTokens > 0 ? { tokens: totalTokens } : {}), ...(walletDebit && walletDebit.tokensDebited > 0 ? { walletTokensDebited: walletDebit.tokensDebited, walletTokenBalance: walletDebit.tokenBalance } : {}), ...(diagnostics ? { diagnostics } : {}), ...(costBreakdown ? { costBreakdown } : {}), readiness: buildHealth });
      // Native push notification (admin 2026-07-26): fire-and-forget — never delays or fails the
      // response the client already has. A resumable module turn is an intermediate step, not a
      // finished build, so it's excluded (the user is mid-flow inside the app already).
      if (!projectContinue.resumable) void notifyBuildComplete(userId, result.ok);
    } catch (err) {
      // Capture the crash in the diagnostics report too. NOTE: onUpdate only refreshes the per-instance
      // in-memory cache (lastDiagnostics) — it does NOT write to Firestore on every tick — so a crash
      // must explicitly durable-save here, or this report is lost the moment the instance recycles
      // (exactly the "empty build report" DiagnosticsStore.ts exists to prevent, but this path missed it).
      const errMsg = err instanceof Error ? err.message : String(err);
      // Hoisted out of the try below so the client `error` emit can carry the crash report (see the
      // emit at the end of this catch) — a bare error message never told the user WHAT went wrong.
      let crashReportForClient: unknown = undefined;
      try {
        buildDiagRef?.record({ phase: 'build', severity: 'error', code: 'BUILD_EXCEPTION', message: errMsg, autoResolved: false });
        buildDiagRef?.finish(false);
        const crashReport = buildDiagRef?.report();
        if (crashReport) {
          crashReportForClient = crashReport;
          lastDiagnostics.set(buildKey, crashReport);
          saveDiagnostics(workspaceId, crashReport).catch(() => {});
          saveDiagnosticsHistory(workspaceId, crashReport).catch(() => {});
          // Durable per-USER "latest report" so even a crashed build's report is retrievable by userId
          // alone (across cold starts / new sessions) — the whole point of "gayab na ho".
          saveLatestForUser(userId, crashReport).catch(() => {});
        }
      } catch { /* diagnostics are best-effort */ }
      // BUILD-FAIL CHAT PERSIST (admin 2026-07-12: "fail par na chat milti hai na report") — a build
      // that crashes BEFORE/OUTSIDE the agentic runner (setup/sandbox/import errors, or a fast-lane-only
      // failure) never persisted a conversation, so the user's own chat vanished. Save it here so EVERY
      // failed build leaves a retrievable chat that also shows WHY it failed. Dedup-safe: if the runner
      // already saved this conversation (mid-run crash), append only the failure line (no duplicate
      // prompt); otherwise create it with the prompt + the failure. Best-effort — never blocks the emit.
      try {
        const convId = conversationIdForWorkspace(workspaceId);
        const store = getConversationStore();
        const failTurn = { role: 'assistant' as const, content: `❌ Build failed: ${errMsg}`, ts: Date.now() };
        const existing = await store.get(convId).catch(() => null);
        if (existing) {
          await store.appendMessages(convId, [failTurn], { status: 'error', updatedAt: Date.now() }).catch(() => {});
        } else {
          await upsertConversationTurn(store, {
            conversationId: convId,
            userId: userId ?? 'anon',
            workspaceId,
            title: deriveTitle(prompt),
            turn: [{ role: 'user' as const, content: prompt, ts: Date.now() - 1000 }, failTurn],
            patch: { status: 'error', updatedAt: Date.now() },
          }).catch(() => {});
        }
      } catch { /* chat persist is best-effort — never blocks the error emit */ }
      // Same durable-file-save guarantee as the deadline-timeout path: a crash mid-build must not
      // strand whatever files WERE captured behind only the flaky fire-and-forget 3s debounce. In its
      // own try/catch — `writtenFiles` may not be declared yet if the crash happened very early (before
      // any file was written), which would throw a ReferenceError here and must not block the error emit.
      try {
        if (writtenFiles.size > 0) {
          saveWorkspaceFiles(workspaceId, Object.fromEntries(writtenFiles)).catch(() => {});
        }
      } catch { /* writtenFiles not yet in scope (crash before any write), or save failed — best-effort */ }
      // Surface the crash report to the client so the user SEES what happened. The report was already
      // durable-saved above; attaching it here (same shape the success path emits) makes the failure
      // card / "Build report" render immediately instead of a bare error with no detail.
      emit({ type: 'error', message: errMsg, ts: Date.now(), ...(crashReportForClient ? { diagnostics: crashReportForClient } : {}) });
      void notifyBuildComplete(userId, false);
    } finally {
      // GREEN FREEZE — clear this workspace's green latch no matter how the build ended, so a stale
      // latch can never freeze the EARLY writes of the NEXT build for the same workspace.
      try { clearGreenLatch(workspaceId); } catch { /* best-effort */ }
      try { disposeGreenFreezeObserver?.(); } catch { /* best-effort */ }
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
      // ADMIN-ONLY infra cost: how long this build held a real VM. A build is billed by WALL-CLOCK as
      // well as by tokens, and until now only the token half was visible — so "why is the E2B bill this
      // size?" had no answer in the product. Never part of the user's charge; omitted by construction
      // from the user-facing report (allow-list). Best-effort, and honestly absent when unmeasurable.
      // THE SESSION, measured at the END so the number is the real one (see the read near the start).
      try {
        if (sessionHistoryForSummary) {
          const { history, startedAt } = sessionHistoryForSummary;
          const summary = summarizeSession(history, startedAt, Date.now(), 50);
          buildDiagRef?.setSession({ ...summary, line: sessionSummaryLine(summary) });
        }
      } catch { /* the session line is reporting, never a reason to affect a build */ }
      try {
        const held = typeof (actuator as any).sandboxHeldSeconds === 'function'
          ? (actuator as any).sandboxHeldSeconds(workspaceId) as number | null
          : null;
        buildDiagRef?.setSandboxSeconds(held);
        // SAY WHETHER IT REACHED THE BILL, and why (admin 2026-08-11). Without this line the admin
        // cannot tell "we charged for the VM" from "we absorbed it" — and the difference is a config
        // flag plus a rate they alone can supply. ADMIN-ONLY: the user never sees an infrastructure
        // line item (White-Label Law §3).
        buildDiagRef?.record({
          phase: 'build', severity: 'info', code: 'SANDBOX_BILLING',
          message: sandboxBillingNote(sandboxCost(held)),
          autoResolved: true,
        });
      } catch { /* a cost measurement must never affect a build */ }
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
      // TERMINAL STATUS STAMP (build-report + IMG autopsy 2026-08-02): persistSessionTimeline writes the
      // finalState done-footer + timeline but NEVER the record's `status`, and the only status:'complete'/
      // 'error' write is the fallback block that is SKIPPED once a runner has persisted a turn — so a normal
      // build left the durable record at status:'running'. A client that dropped before the `result` event
      // then reopened/resumed to a verdict-less record and saw neither success nor fail nor billing, just
      // "that build isn't running anymore — send your message again". Stamp the terminal verdict here so a
      // reopen always shows the truth. Only when the build DEFINITIVELY settled (buildResultRef set) — a
      // resumable wall-clock pause leaves buildResultRef null → status stays 'running' (never clobbered).
      // Best-effort; a store failure never affects the build or the already-emitted result.
      try {
        const terminalStatus = terminalConversationStatus(buildResultRef);
        if (terminalStatus) {
          const store = getConversationStore();
          const convId = conversationIdForWorkspace(workspaceId);
          if (await store.get(convId).catch(() => null)) {
            await store.update(convId, {
              status: terminalStatus,
              ...(typeof buildResultRef?.billedUsd === 'number' ? { billedUsd: buildResultRef.billedUsd } : {}),
              updatedAt: Date.now(),
            }).catch(() => {});
          }
        }
      } catch { /* terminal-status stamp is best-effort — never affects the build */ }
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
