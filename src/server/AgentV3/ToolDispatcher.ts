import { repeatedReadNotice } from './repeatedReads';
import { healWouldOscillate } from './HealLedger';
import type { AgentEventStream } from './AgentEventStream';
import { parseNpmAuditSummary, looksLikeDependencyInstall } from './npmAuditSummary';
import { shouldRunAuditFix, auditFixOutcome, AUDIT_FIX_COMMAND } from './npmAuditFix';
import { narrationText, type NarrationId, type NarrationParams } from './narrationCatalogue';
import { noteHeal } from './HealLedger';
import { decideSupersede } from './previewSupersede';
import { sandboxStore } from './SandboxStore';
import { buildPreKillPortCommand } from './sandbox/EngineerAI/actuators/devServerHost';
import { pipedGateExitCodeWarning } from './pipedGateExitCode';
import { verifyInjectedSecrets, preflightNarration, type SecretVerdict } from './secretPreflight';
import { inspectCredentials } from './credentialSafety';
import { probeCredentials, realProbeFetch, credentialProbeEnabled, relevantToApp, type ProbeVerdict } from './credentialProbe';
import { planSecretRequest, secretRequestPrompt, secretRequestResult, type SecretAsk } from './secretRequest';

/**
 * Sentinel command that forces the user's vault secrets onto disk regardless of the "is this an app
 * command?" gate.
 *
 * ROOT CAUSE it closes (mitrify autopsy 2026-08-04, and the admin's direct question — "agar user keys daal
 * bhi de, to kya app un keys ko padh payega?"): the secrets `.env` was written LAZILY, from inside
 * `run_command`, the first time a command looked like npm/node/vite. But a managed preview — an import
 * turn, the Diagnose button, `update_preview` — starts the dev server through the ACTUATOR, never through
 * `run_command`. On those paths no `.env` was ever written, so the app booted with none of the keys the
 * user had carefully saved in Settings. The keys were stored correctly, the app read `.env` correctly, and
 * the two were never introduced. Now the write is also driven explicitly, before any dev server can start.
 */
export const ALWAYS_WRITE_SECRETS = '__navbharatai_always_write_secrets__';
import type { WorkspaceState } from './WorkspaceState';
import type { ToolUse } from './ClaudeClient';
import type { AgentRole, ToolName, TodoItem, TodoStatus } from './types';
import type { Checkpointer } from './GitManager';
import { isWorkerRole } from './AgentRegistry';
import { getWorkspaceMemory } from './WorkspaceMemory';
import { robustTscCommand } from './tscCommand';
import { parseTscErrors } from './EndgameRepair';
import { pathMissHint } from './suggestFilePath';
import { analyzeCodeSmells, renderCodeSmells } from './CodeSmellAnalyzer';
import { detectTestPlan, parseTestOutcome, withSandboxBrowsers, withTestFilter } from './testRunner';
import { detectTypecheckPlan, parseTypecheckOutcome, typecheckSummary, type TypecheckOutcome } from './crossLangTypecheck';
import { whoImports, dependenciesOf, impactOf, definitionsOf, referencesOf, resolveGraphFile } from './codeGraph';
import { findSyntaxErrors, syntaxRepairInstruction, firstSyntaxError, writeParseGuardEnabled, parseGuardDecision } from './SyntaxCheck';
import { checkPreviewCompiles, previewDivergenceBlocksDelivery } from '../runtime/PreviewCompileCheck';
import { detectLinters, parseLintOutcome, type LintOutcome } from './lintRunner';
import { lintGateVerdict, type LintGateVerdict } from './LintGate';
import { analyzePackageHealth, packageHealthSummary } from './packageHealth';
import { assessFullRewrite } from './rewriteRisk';
import { analyzeToolchain } from './toolchainPins';
import { planAppDefaults } from './appDefaults';
import { computeMove, type MoveFile } from './codemodMoveFile';
import { buildArchitectureMap, renderArchitectureMap } from './architectureMap';
import { findUnwiredFiles, unwiredFilesSummary } from './deadCode';
import { buildApiGraph, apiWiringSummary, apiEndpointBlastReport } from './apiGraph';
import { analyzeSchemaGraph, schemaGraphSummary, analyzeSqlSchema, sqlSchemaSummary, schemaGraphReport } from './schemaGraph';
import { generateSchemaTypes } from './schemaTypeGen';
import { analyzeCiWorkflow, ciWorkflowSummary, repairCiWorkflow, ciPlatform } from './ciWorkflowAnalysis';
import { mapWithConcurrency, withTimeout } from './asyncUtils';
import { analyzeArchitecture, architectureSummary, generateArchitectureDoc } from './ArchitectureAnalysis';
import { securitySummary } from './SecurityAnalysis';
import { applyPreviewDomain } from './PreviewDomain';
import { injectAppSignature, hasAppSignature } from './appSignature';
import { mergeDotEnv, gitignoreWithEnv, dotEnvValue } from '../secrets/appSecretsEnv';
import { ensureBootEnv, ENV_SCAN_COMMAND } from './devSecretsBoot';
import { envNamesFromGrep } from './ImportPreview';
import { parseDevServerHealthLine } from './sandbox/EngineerAI/actuators/DevServerRecovery';
import { collectWorkspaceFiles } from './WorkspaceFiles';
import { importCheckNote } from './writeTimeImportCheck';
import { scanAuthenticity, authenticitySummary } from './AuthenticityAnalysis';
import type { AuthenticityIssue } from './AuthenticityAnalysis';
import { scanAccessibility, accessibilitySummary } from './AccessibilityAnalysis';
import type { AccessibilityIssue } from './AccessibilityAnalysis';
import { scanObservability, observabilitySummary } from './ObservabilityAnalysis';
import { scanGracefulShutdown, gracefulShutdownSummary } from './GracefulShutdownAnalysis';
import { scanSecurityHeaders, securityHeadersSummary } from './SecurityHeadersAnalysis';
import { scanProjectSri, sriSummary } from './SriAnalysis';
import { scanProjectCsp, cspSummary } from './CspMetaAnalysis';
import { scanProjectCommentLanguage, commentLanguageSummary } from './CommentLanguageAnalysis';
import { scanProjectUploadValidation, uploadValidationSummary } from './UploadValidationAnalysis';
import {
  scanCompliance, complianceSummary,
  detectsPiiCollection, detectsTracker, detectsConsentUI, looksLikePrivacyPolicy,
} from './ComplianceAnalysis';
import type { ComplianceIssue, ComplianceSeverity } from './ComplianceAnalysis';
import { redactCredentialLogs } from './credentialLogRedaction';
import type { DependencyIssue } from './DependencyAnalysis';
import type { EnvVarIssue } from './EnvVarAnalysis';
import { computeBuildConfidence, buildConfidenceSummary, type SeverityTally } from './BuildConfidence';
import { classifyCommandRisk, governanceNote, destructiveSourceDeletionTarget, destructiveSourceDeletionMessage, isDestructiveEmptyOverwrite, emptyOverwriteMessage, singleSourceDeleteTargets, importedFileDeletionMessage, wouldEraseUserSecrets, eraseUserSecretsMessage } from './CommandGovernance';
import { scaffoldGuard, scaffoldGuardMessage } from './ScaffoldGuard';
import { dependencyMutationGuard, dependencyMutationGuardMessage } from './DependencyMutationGuard';
import { previewGuard, previewGuardMessage } from './PreviewGuard';
import { ensureViteAllowedHosts, ensureViteResolveAlias } from './ViteConfigGuard';
import { ensureTsconfigBaseUrl } from './TsconfigGuard';
import { applyFullStackGuards, dedupeSameModuleImports } from './FullStackGuards';
import { duplicateModuleTarget } from './ProjectIntegrityChecks';

/**
 * Deterministic config backstops applied to EVERY file write (each no-ops for a non-matching path):
 * Vite preview-host allowance, the dep-free `@`→/src alias, and tsconfig baseUrl/paths restoration — so a
 * model rewrite of vite.config/tsconfig can never silently re-break the preview or baseUrl-"src" resolution.
 */
function guardConfigContent(path: string, content: string): string {
  return applyFullStackGuards(path, ensureTsconfigBaseUrl(path, ensureViteResolveAlias(path, ensureViteAllowedHosts(path, content))));
}
import { ViteReactProvider } from './sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { TemplateRegistry } from './sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { analyzeDependencies, dependencySummary } from './DependencyAnalysis';
import { analyzeMaintainability, maintainabilitySummary } from './maintainabilityAnalysis';
import { analyzeLockfiles, lockfileSummary, detectPackageManager, packageManagerSummary } from './lockfileAnalysis';
import { detectMonorepo, monorepoSummary } from './monorepoAnalysis';
import { analyzeThreatModel, threatModelSummary } from './threatModelAnalysis';
import { analyzeHeavyImports, heavyImportSummary } from './heavyImportAnalysis';
import { analyzeQueryPatterns, queryPatternSummary } from './queryPatternAnalysis';
import { analyzeEffectCleanup, effectCleanupSummary } from './effectCleanupAnalysis';
import { analyzeCoupling, couplingSummary } from './couplingAnalysis';
import { analyzeQueryOptimizer, queryOptimizerSummary } from './queryOptimizerAnalysis';
import { optimizeInfra, infraOptimizeSummary } from '../lib/InfraOptimizer';
import { planDependencyAutoFix, dependencyAutoFixSummary, applyWellKnownMissingDeps, pinKnownDepsInInstallCommand, pinKnownDepsInPackageJson, ensureFrameworkCoreDeps, npmInstallMaskedFailure } from './DependencyAutoFix';
import { quoteShellRouteGroupPaths } from './shellCommandSafety';
import { resolveStringArg, missingArgMessage } from './toolArgRepair';
import { prismaRepairHint, isPrismaCliMissingError } from './prismaRepairHint';
import { provisionPathSummary } from './sandbox/dbProvisionVerify';
import { sandboxPostgresEnabled, commandNeedsLiveDatabase, schemaTargetsPostgres, postgresEnvLines, schemaTargetsSqlite, revertSqliteToPostgres, postgresPreflightProbeCommand, shouldPreflightPostgres, canAttemptPostgresRevival, isUserOwnedDatabaseUrl } from './postgresProvision';
import { looksLikeDbUnreachable } from './sandbox/EngineerAI/actuators/sandboxHealth';
import { extractMissingPrismaExports, isEnumConsumerFile, fixDanglingEnumConsumer } from './prismaEnumConsumers';
import type { BackendProvisionResult } from './sandbox/EngineerAI/actuators/IEngineerActuator';
import { nextBuildRepairHint, nextMiddlewareCorrectPath } from './frameworkBuildHints';
import { analyzePwa, pwaSummary } from './PwaAnalysis';
import { extractEnvRefs, parseEnvKeys, analyzeEnvVars, envVarSummary } from './EnvVarAnalysis';
import { resolveLocalImport } from './ArchitectureAnalysis';
import { assessReadiness, readinessVerdict, type ExtraFinding, type ReadinessReport } from './Readiness';
import { analyzeHooksRules, hookViolationWriteNote } from './HooksRulesAnalysis';
import { dedupeDuplicateImports } from './DuplicateImportGuard';
import { isReactFamilyFramework } from './frameworkFamily';
import { analyzeImportExports } from './ImportExportAnalysis';
import { reconcileImportExports, addMissingProjectImports, fixWrongSourceImports } from './ImportExportReconcile';
import { analyzeJsxComponents } from './JsxComponentAnalysis';
import { analyzeUndefinedHooks } from './UndefinedHookAnalysis';
import { analyzeDependencyConstraints } from '../AI/reasoning/ConstraintSolver';
import { analyzeTestCoverage, testCoverageSummary } from './TestCoverageAnalysis';
import { analyzeRequirementCoverage, requirementCoverageSummary, currentRequestForCoverage } from './RequirementCoverage';
import { generateReadme } from './ReadmeGenerator';
import { generateEnvExample } from './EnvExampleGenerator';
import { generateGitignore } from './GitignoreGenerator';
import { generateOpenApi, type RouteSpec } from '../lib/OpenApiGenerator';
import { generateApiDocs, type RouteDoc } from '../lib/DocGenerator';
import { generateDevGuide, type DevGuideScript } from '../lib/DeveloperGuideGenerator';
import { generateUnitTest, type FunctionDef } from '../lib/TestSkeletonGenerator';
import { generateIntegrationTests } from '../lib/IntegrationTestGenerator';
import { planE2eScaffold, e2eScaffoldSummary } from './e2eScaffold';
import { pickDevScript, parsePackageJson } from './devScript';
import { generateObservability, type ObservabilityTarget } from '../AppMakerLab/generator/ObservabilityGenerator';
import { generateBundleOptimization } from '../AppMakerLab/generator/BundleOptimizationGenerator';
import { generateSeedData, type EntitySpec } from '../AppMakerLab/generator/MockDataGenerator';
import { generateAuthCode, type AuthType } from '../AppMakerLab/generator/AuthCodeGenerator';
import { generateMigration, type MigrationEntity, type MigrationDialect, type SqlProvider } from '../AppMakerLab/generator/MigrationGenerator';
import { generateDeployArtifacts, type DeployArtifactInput, type PackageManager } from '../lib/DeployArtifactGenerator';
import { generateDeployConfig, isDeployTarget } from '../lib/DeployConfigGenerator';
import { generateK8sManifests, generateHelmChart, generateTerraformCloudRun, generateAnsiblePlaybook, type IaCOptions } from '../lib/IaCGenerator';
import { resolveDependencies, scanVulnerabilities, vulnScanSummary } from '../lib/VulnScanner';
import { analyzeAppDependencies, licenseAdvisorySummary } from '../AppMakerLab/SBOMGenerator';
import { dependencyHealthVerdict } from './DependencyHealthGate';
import { prettierGateResult, prettierAdvisory } from './PrettierGate';
import { injectObservabilityFixes } from './ObservabilityInjector';
import { wireOrphanPages } from './orphanPageWiring';
import { detectMigrationPlan, migrationPlanSummary } from './MigrationPlanner';
import { planProductionMigration, isProductionSafeCommand, migrationOutcome } from './productionMigration';
import { loadMigrationHistory, recordMigrationRun, summarizeMigrationHistory } from './migrationHistory';
import { generateDbConfig, isDbProvider } from '../lib/DbConfigGenerator';
import { generatePaymentIntegration, isPaymentProvider } from '../lib/PaymentGenerator';
import { generateOtpIntegration, isOtpProvider } from '../lib/OtpGenerator';
import { generateTotpIntegration } from '../lib/TotpGenerator';
import { generateIndianValidatorsIntegration } from '../lib/IndianValidatorsGenerator';
import { generateAnalyticsIntegration, isAnalyticsProvider } from '../lib/AnalyticsGenerator';
import { generateMapIntegration, isMapProvider } from '../lib/MapGenerator';
import { generateJobsIntegration, isJobsProvider } from '../lib/JobsGenerator';
import { generateSchedulerIntegration } from '../lib/SchedulerGenerator';
import { generateSmsIntegration, isSmsProvider } from '../lib/SmsGenerator';
import { generatePasswordIntegration } from '../lib/PasswordGenerator';
import { generateRateLimitIntegration, isRateLimitStore } from '../lib/RateLimitGenerator';
import { generateApiVersionIntegration } from '../lib/ApiVersionGenerator';
import { generateCrudResource } from '../lib/CrudGenerator';
import { generateBookingIntegration } from '../lib/BookingGenerator';
import { generateInventoryIntegration } from '../lib/InventoryGenerator';
import { generateCrmIntegration } from '../lib/CrmGenerator';
import { generateHospitalErpIntegration } from '../lib/HospitalErpGenerator';
import { generateSchoolErpIntegration } from '../lib/SchoolErpGenerator';
import { generateCourierIntegration } from '../lib/CourierGenerator';
import { generateRestaurantPosIntegration } from '../lib/RestaurantPosGenerator';
import { generateRealEstateIntegration } from '../lib/RealEstateGenerator';
import { generateFitnessIntegration } from '../lib/FitnessGenerator';
import { generatePharmacyIntegration } from '../lib/PharmacyGenerator';
import { generateRecruitmentIntegration } from '../lib/RecruitmentGenerator';
import { generateInvoicingIntegration } from '../lib/InvoicingGenerator';
import { generateHelpdeskIntegration } from '../lib/HelpdeskGenerator';
import { generateEventsIntegration } from '../lib/EventsGenerator';
import { generateSubscriptionIntegration } from '../lib/SubscriptionGenerator';
import { generatePollsIntegration } from '../lib/PollsGenerator';
import { generateBlogIntegration } from '../lib/BlogGenerator';
import { generateReviewsIntegration } from '../lib/ReviewsGenerator';
import { generateLoyaltyIntegration } from '../lib/LoyaltyGenerator';
import { generateReferralsIntegration } from '../lib/ReferralsGenerator';
import { generateCommentsIntegration } from '../lib/CommentsGenerator';
import { generateMessagingIntegration } from '../lib/MessagingGenerator';
import { generateListingsIntegration } from '../lib/ListingsGenerator';
import { generateJobBoardIntegration } from '../lib/JobBoardGenerator';
import { shellQuote } from '../lib/shellQuote';
import { generateWishlistIntegration } from '../lib/WishlistGenerator';
import { generateAddressesIntegration } from '../lib/AddressesGenerator';
import { generateCouponsIntegration } from '../lib/CouponsGenerator';
import { generateKanbanIntegration } from '../lib/KanbanGenerator';
import { generateTimesheetIntegration } from '../lib/TimesheetGenerator';
import { generateLeaderboardIntegration } from '../lib/LeaderboardGenerator';
import { generateWaitlistIntegration } from '../lib/WaitlistGenerator';
import { generateTagsIntegration } from '../lib/TagsGenerator';
import { generateExperimentsIntegration } from '../lib/ExperimentsGenerator';
import { generateShortLinksIntegration } from '../lib/ShortLinksGenerator';
import { generateFeedbackIntegration } from '../lib/FeedbackGenerator';
import { generateConsentIntegration } from '../lib/ConsentGenerator';
import { generateActivityFeedIntegration } from '../lib/ActivityFeedGenerator';
import { generateCartIntegration } from '../lib/CartGenerator';
import { generateReactionsIntegration } from '../lib/ReactionsGenerator';
import { generateOrdersIntegration } from '../lib/OrdersGenerator';
import { generateFaqIntegration } from '../lib/FaqGenerator';
import { generateQuizIntegration } from '../lib/QuizGenerator';
import { generateAvailabilityIntegration } from '../lib/AvailabilityGenerator';
import { generateAnnouncementsIntegration } from '../lib/AnnouncementsGenerator';
import { generateCollectionsIntegration } from '../lib/CollectionsGenerator';
import { generateContactFormIntegration } from '../lib/ContactFormGenerator';
import { generatePageViewsIntegration } from '../lib/PageViewsGenerator';
import { generateGiftCardsIntegration } from '../lib/GiftCardsGenerator';
import { generateTeamsIntegration } from '../lib/TeamsGenerator';
import { generateStatusPageIntegration } from '../lib/StatusPageGenerator';
import { generateSurveyIntegration } from '../lib/SurveyGenerator';
import { generateSupportTicketIntegration } from '../lib/SupportTicketGenerator';
import { generateGraphqlIntegration } from '../lib/GraphqlGenerator';
import { generatePaginationIntegration } from '../lib/PaginationGenerator';
import { generateRbac } from '../lib/RbacGenerator';
import { generateIdIntegration } from '../lib/IdGenerator';
import { generateAdmin } from '../lib/AdminGenerator';
import { generateSettingsScaffoldIntegration } from '../lib/SettingsScaffoldGenerator';
import { generateDashboard } from '../lib/DashboardGenerator';
import { generateBackup } from '../lib/BackupGenerator';
import { analyzeRequirementGaps, renderRequirementGaps } from '../lib/RequirementGapAnalyzer';
import { generateI18n } from '../lib/I18nGenerator';
import { generateMotion } from '../lib/MotionGenerator';
import { generateGameRuntime } from '../lib/GameRuntimeGenerator';
import { generateGame3D } from '../lib/Game3DGenerator';
import { generateGameController } from '../lib/GameControllerGenerator';
import { generateGameVfxAudio } from '../lib/GameVfxAudioGenerator';
import { generateGameShell } from '../lib/GameShellGenerator';
import { generateGameSystems } from '../lib/GameSystemsGenerator';
import { generateUiStates } from '../lib/UiStatesGenerator';
import { generateFrontendStateIntegration } from '../lib/FrontendStateGenerator';
import { generateImageOptimization } from '../lib/ImageOptGenerator';
import { generateSsoIntegration } from '../lib/SsoGenerator';
import { generateAbac } from '../lib/AbacGenerator';
import { generateMetrics } from '../lib/MetricsGenerator';
import { generateTracing } from '../lib/TracingGenerator';
import { generateErrorTrackingIntegration, isErrorTrackingProvider } from '../lib/ErrorTrackingGenerator';
import { generateFeatureFlagIntegration, isFeatureFlagProvider } from '../lib/FeatureFlagGenerator';
import { generateAiIntegration, isAiProvider } from '../lib/AiGenerator';
import { generateGeocodingIntegration, isGeocodingProvider } from '../lib/GeocodingGenerator';
import { generateTranslationIntegration, isTranslationProvider } from '../lib/TranslationGenerator';
import { generateModerationIntegration, isModerationProvider } from '../lib/ModerationGenerator';
import { generateCaptchaIntegration } from '../lib/CaptchaGenerator';
import { generateCacheIntegration, isCacheProvider } from '../lib/CacheGenerator';
import { generateRetryIntegration } from '../lib/RetryGenerator';
import { generateHttpClientIntegration } from '../lib/HttpClientGenerator';
import { generateIdempotencyIntegration } from '../lib/IdempotencyGenerator';
import { generateNewsletterIntegration, isNewsletterProvider } from '../lib/NewsletterGenerator';
import { generateEmailTemplateIntegration } from '../lib/EmailTemplateGenerator';
import { generateCurrencyIntegration, isCurrencyProvider } from '../lib/CurrencyGenerator';
import { generateMoneyFormatIntegration } from '../lib/MoneyFormatGenerator';
import { generateWeatherIntegration, isWeatherProvider } from '../lib/WeatherGenerator';
import { generateDateTimeIntegration } from '../lib/DateTimeGenerator';
import { generateNotifyIntegration, isNotifyProvider } from '../lib/NotifyGenerator';
import { generateNotificationCenterIntegration } from '../lib/NotificationCenterGenerator';
import { generateEnvValidation } from '../lib/EnvValidationGenerator';
import { generateCorsIntegration } from '../lib/CorsGenerator';
import { generateCsrfIntegration } from '../lib/CsrfGenerator';
import { generateSlugIntegration } from '../lib/SlugGenerator';
import { generateValidationIntegration } from '../lib/ValidationGenerator';
import { generateSanitizeHtmlIntegration } from '../lib/SanitizeHtmlGenerator';
import { generateMarkdownIntegration } from '../lib/MarkdownGenerator';
import { generateQrIntegration } from '../lib/QrGenerator';
import { generateUpiIntegration } from '../lib/UpiGenerator';
import { generatePdfIntegration } from '../lib/PdfGenerator';
import { generateCsvIntegration } from '../lib/CsvGenerator';
import { generateAuditLogIntegration } from '../lib/AuditLogGenerator';
import { generateSoftDeleteIntegration } from '../lib/SoftDeleteGenerator';
import { generateImageIntegration } from '../lib/ImageGenerator';
import { generateLoggingIntegration } from '../lib/LoggingGenerator';
import { generateRequestIdIntegration } from '../lib/RequestIdGenerator';
import { generateFileUploadIntegration } from '../lib/FileUploadGenerator';
import { generateGracefulShutdownIntegration } from '../lib/GracefulShutdownGenerator';
import { generateMaintenanceIntegration } from '../lib/MaintenanceModeGenerator';
import { generateSecurityHeadersIntegration } from '../lib/SecurityHeadersGenerator';
import { generateSeoIntegration } from '../lib/SeoGenerator';
import { generateWebhookIntegration } from '../lib/WebhookGenerator';
import { generateWebhookSenderIntegration } from '../lib/WebhookSenderGenerator';
import { generateEmailIntegration, isEmailProvider } from '../lib/EmailGenerator';
import { generateStorageIntegration, isStorageProvider } from '../lib/StorageGenerator';
import { generateMcpServer, normalizeMcpTables } from '../lib/McpServerGenerator';
import { analyzeServiceSplit } from './ServiceSplitAnalysis';
import { generateArchitectureScaffold, isArchitectureStyle } from '../lib/ArchitectureScaffold';
import { generateRealtimeIntegration, isRealtimeProvider } from '../lib/RealtimeGenerator';
import { generateSearchIntegration, isSearchProvider } from '../lib/SearchGenerator';
import { generateMobileExport } from '../lib/MobileExportGenerator';
import { generateDesktopExport } from '../lib/DesktopExportGenerator';
import { generateExtensionExport } from '../lib/ExtensionExportGenerator';
import { replaceSymbol } from '../AppMakerLab/generator/ASTPatching';
import { analyzeConventions, type IdentifierKind } from '../lib/ConventionEngine';
import { generateReleaseNote } from '../lib/ReleaseNotesGenerator';
import { analyzeRunnability, runnabilitySummary } from './RunnabilityAnalysis';
import { analyzeSeo, seoSummary } from './SeoAnalysis';
import { lintDesign, designSummary } from '../AppMakerLab/intelligence/DesignLinter';
import { publishableVerdict, entryPagesOf } from './publishablePayload';
import { detectServerNeed } from './staticPublishGuard';
import { PUBLISH_NOT_REQUESTED } from './publishConsent';
import { summarizeBundle, bundleSummaryLine } from './BundleSize';
import { livenessLine } from './PostDeployLiveness';
import { analyzeProjectHygiene, projectHygieneSummary } from './ProjectHygieneAnalysis';
import { hasErrorBoundarySignal, analyzeErrorBoundary, errorBoundarySummary, looksLikeBrokenErrorBoundary } from './ErrorBoundaryAnalysis';
import { scanSecurityConfig, securityConfigSummary, type SecConfigIssue } from './SecurityConfigAnalysis';
import { analyzeSecretLeak, secretLeakSummary, gitignoreWithEnvCoverage } from './SecretLeakAnalysis';
import { scanHardcodedUrls, hardcodedUrlSummary, type HardcodedUrlIssue } from './HardcodedUrlAnalysis';
import { scanPortBinding, portBindingSummary, type PortBindingIssue } from './PortBindingAnalysis';
import { scanViteEnvExposure, hasCustomEnvPrefix, viteEnvSummary, type ViteEnvIssue } from './ViteEnvAnalysis';
import { scanEnvTemplateSecrets, envTemplateSecretSummary, type EnvTemplateSecretIssue } from './EnvSecretValueAnalysis';
import { scanAsyncPatterns, asyncPatternSummary, type AsyncPatternIssue } from './AsyncPatternAnalysis';
import type { SecondOpinion } from './SecondOpinion';
import type { Consensus } from './Consensus';
import type { WebSearchFn } from './WebSearch';
import type { DeployFn } from './Deployment';
import { reviewEdit, formatReviewResult } from './PostEditReviewer';
import { renameSymbol, addComponentProp } from './CodemodeExecutor';
import type { CodemodeFile } from './CodemodeExecutor';
import { containsSymbol } from './codemodScope';
import { codemodTruncationNote } from './codemodTruncation';
import { getEmbeddingStore } from './EmbeddingSearch';
import { redactSecrets, redactDeep } from './SecretRedactor';
// Where the sandbox browser may go: its own preview, or the real public web — never an internal
// infrastructure address. Handing a model a browser with an unrestricted address bar is an SSRF
// primitive; see lib/browseTarget.ts.
import { classifyBrowseTarget } from '../lib/browseTarget';
import { formatUiFindings, type ScannedElement } from './UiElementFinder';
import { envKillSwitch } from '../lib/envFlag';
import { webFetchUrl, formatWebFetchResult } from './webFetch';
import { matchingIgnoreRule, protectedWriteMessage, type IgnoreRule } from './ignoreRules';

/**
 * Spawns a specialist sub-agent for the `task` tool and returns its result.
 * Injected (not imported) so ToolDispatcher stays decoupled from AgentRunner —
 * the composition root wires the real implementation (see SubAgent.ts).
 */
export type SubAgentSpawn = (role: AgentRole, instruction: string) => Promise<{ ok: boolean; summary: string }>;

/** The browser interactions browser_action supports (mirrors the actuator's union). */
export const BROWSER_ACTIONS = ['click', 'type', 'navigate', 'scroll', 'press', 'wait', 'hover', 'double_click', 'select_option'] as const;
export type BrowserActionName = (typeof BROWSER_ACTIONS)[number];

/**
 * ActuatorPort — the narrow slice of the sandbox actuator the dispatcher needs.
 * The real `IEngineerActuator` (E2B/Docker/Local) structurally satisfies this,
 * and tests can implement just these four methods. Interface segregation keeps
 * the dispatcher decoupled from the full actuator surface.
 */
export interface ActuatorPort {
  readFile(workspaceId: string, filePath: string): Promise<string>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  listFiles(workspaceId: string): Promise<string[]>;
  runCommand(
    workspaceId: string,
    command: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /**
   * Provision backend services (a local PostgreSQL, auth/storage scaffolds) inside the sandbox and
   * return the resulting env (e.g. DATABASE_URL). Real sandboxes only (E2BActuator installs + starts
   * Postgres); LocalActuator throws. Optional — a sandbox without it degrades honestly. Used lazily by
   * the bash path to give a `provider="postgresql"` build a real DB before `prisma migrate`/seed.
   */
  provisionBackend?(workspaceId: string, features: ('db' | 'auth' | 'storage')[]): Promise<BackendProvisionResult>;
  /** Public HTTPS URL for a port in the sandbox (real sandboxes only). Optional. */
  getPortUrl?(workspaceId: string, port: number): Promise<string>;
  /** Capture a PNG screenshot of a URL from inside the sandbox (real sandboxes only). */
  screenshot?(
    workspaceId: string,
    url: string,
    viewport?: { width: number; height: number },
  ): Promise<{ base64: string; mimeType: 'image/png' }>;
  /** Drive a real headless browser (click/type/navigate/…) and return a screenshot + result. */
  browserAction?(
    workspaceId: string,
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option',
    args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down' },
  ): Promise<{ screenshot: string; result: string; cursorX?: number; cursorY?: number }>;
  /**
   * Scan the rendered page for visible elements + where they come from (see find_ui_element).
   * `scanned:false` means the browser could not look — never treat it as "the element is absent".
   */
  scanUiElements?(workspaceId: string, url: string): Promise<{ elements: unknown[]; scanned: boolean }>;
  /**
   * Runtime browser errors (console.error / uncaught / failed requests) since `sinceMs`.
   * `captured` reports whether a real browser session was actually read: `true` = the console was
   * captured (an empty `errors` then genuinely means "ran clean"); `false` = no live session, so an empty
   * `errors` means "could NOT check", NOT "clean"; omitted = unknown (treated as captured for back-compat).
   * This lets the auto-fix loop tell an honest "runtime clean" from an honest "runtime unchecked".
   */
  getConsoleErrors?(
    workspaceId: string,
    sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[]; captured?: boolean }>;
  /** The built static site (dist/) as path→bytes, for a real persistent deploy. */
  downloadDistFiles?(workspaceId: string): Promise<Map<string, Buffer>>;
  /** Hold the idle sweep off a workspace while its build runs — see markBuildActive. */
  setBuildActive?(workspaceId: string, active: boolean): void;
}

/** One source file read into the shared evaluate snapshot (path + content). */
interface EvalSourceFile {
  path: string;
  content: string;
}

/** The result of executing one tool — appended to the transcript as a tool_result. */
export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
  /** Optional screenshot to feed back to the model as a vision block (browser tools). */
  image?: { base64: string; mimeType: string };
}

const MAX_SUMMARY = 200;

/**
 * ToolDispatcher — maps a Claude `tool_use` block to a real action on the
 * sandbox actuator, records the effect on WorkspaceState, broadcasts tool_call/
 * tool_result/diff events to the surfaces, and returns a tool_result for the
 * transcript. Every failure is returned as an honest is_error result (never a
 * fake success), so the model can see and recover from it.
 */
export class ToolDispatcher {
  /**
   * May this dispatcher publish? DENIED unless the composition root grants it — see the `deploy` case.
   * Not a constructor parameter on purpose: the constructor is already 14 positional arguments deep,
   * and a 15th optional boolean is exactly the kind of thing a later call site gets wrong by silence.
   */
  private _publishConsent = false;

  /** Grant permission to publish for this dispatcher's lifetime (one turn). */
  setPublishConsent(granted: boolean): void { this._publishConsent = granted === true; }

  constructor(
    private readonly actuator: ActuatorPort,
    private readonly workspaceId: string,
    private readonly state?: WorkspaceState,
    private readonly events?: AgentEventStream,
    private readonly spawnSubAgent?: SubAgentSpawn,
    private readonly checkpointer?: Checkpointer,
    private readonly secondOpinion?: SecondOpinion,
    private readonly consensus?: Consensus,
    private readonly webSearch?: WebSearchFn,
    private readonly deploy?: DeployFn,
    /**
     * Called with the path + FINAL content on every successful write_file/edit_file, so the
     * composition root can durably persist exactly what the agent wrote (not relying on a later,
     * sometimes-empty, sandbox listFiles). This is what makes a build's files survive a sandbox
     * loss / the next message getting a fresh sandbox.
     */
    private readonly onFileWrite?: (path: string, content: string) => void,
    /** Framework id from FrameworkRegistry (e.g. 'nextjs', 'vue'). Defaults to 'vite-react'. */
    private readonly framework?: string,
    /**
     * AI Diagnosis Bundle #3 — called with the RAW result of every sandbox `bash` command
     * (full stdout/stderr/exit code + duration). The composition root forwards it to
     * BuildDiagnostics.recordCommand so a failing npm install / tsc / vite build is captured in
     * full — the single highest-value "why won't the app run" signal. Best-effort; never blocks.
     */
    private readonly onCommand?: (result: { command: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number }) => void,
  ) {}

  // Preview loop-breaker state (build-diagnostics root cause: with no cross-call memory the model
  // re-ran update_preview + npm run dev in a loop until the step cap — ~10 min burned on an
  // unreachable preview). Counted per dispatcher (= per build for the Architect).
  private previewFails = 0;
  private previewGaveUp = false;

  /**
   * "made by NavBharatAI" app-signature toggle (admin 2026-07-16). Default ON (the viral-growth
   * mechanic): every built app gets a bottom-right badge linking to navbharatai.com. The user can
   * turn it OFF from Settings → General; the build request carries that choice and the composition
   * root sets it here before the build runs. See appSignature.ts + injectAppSignatureIntoIndexHtml.
   */
  private signatureEnabled = true;

  /** Set by the composition root from the build request's `appSignature` flag (default ON). */
  setSignatureEnabled(enabled: boolean): void {
    this.signatureEnabled = enabled !== false;
  }

  /**
   * C2 — paths the project owner declared off-limits in `.navbharataiignore`. Empty by default, so a
   * project without the file behaves exactly as before.
   */
  private ignoreRules: IgnoreRule[] = [];

  /** Set by the composition root once per build, from the project's own ignore file. */
  setIgnoreRules(rules: IgnoreRule[]): void {
    this.ignoreRules = Array.isArray(rules) ? rules : [];
  }

  /**
   * C2 — refuse a write to a protected path.
   *
   * THROWS rather than returning a string. A returned string is a SUCCESSFUL tool result here, so the
   * model would read "BLOCKED" as "done" and move on believing it had made the change. Throwing makes
   * `dispatch` emit a tool_result with `is_error: true`, which the model must actually handle — the
   * same lesson the deploy tool learned when its failure messages were being RETURNED and the build
   * timeline recorded two successful no-op deploys.
   */
  private assertWritable(path: string): void {
    if (this.ignoreRules.length === 0) return;
    const rule = matchingIgnoreRule(path, this.ignoreRules);
    if (!rule) return;
    try { getWorkspaceMemory(this.workspaceId).recordAudit(`[PROTECTED] refused write to ${path} (${rule.source})`); } catch { /* audit best-effort */ }
    throw new Error(protectedWriteMessage(path, rule));
  }


  /**
   * Emit one platform narration line. THE choke point: call sites name a message id, never a
   * sentence, so a new line is translatable by construction and no call site can forget the
   * language. Best-effort like every other narration — it must never be able to break a build.
   */
  private narrate<K extends NarrationId>(id: K, params: NarrationParams[K], agent: AgentRole = 'architect'): void {
    this.events?.emit({ type: 'narration', agent, text: narrationText(id, params), ts: Date.now() });
  }

  /**
   * Bake the "made by NavBharatAI" badge into the app's HTML entry so it ships with the live
   * preview AND any later deploy (both serve the workspace files). Idempotent (never a second
   * badge) and best-effort — a failure here must NEVER break a build or block the preview (first
   * absolute rule). No-op when the user turned the signature OFF or the app has no HTML entry
   * (a pure API/back-end build has no page to sign). Persists through onFileWrite too, so the
   * durable store (and therefore a deploy) sees the signed index.html, not just the live sandbox.
   */
  private async injectAppSignatureIntoIndexHtml(): Promise<void> {
    if (!this.signatureEnabled) return;
    const candidates = ['index.html', 'public/index.html'];
    for (const htmlPath of candidates) {
      let html: string;
      try {
        html = await withTimeout(this.actuator.readFile(this.workspaceId, htmlPath), 5_000, 'signature-read');
      } catch {
        continue; // no such HTML entry — try the next candidate
      }
      if (!html || hasAppSignature(html)) return; // already signed (idempotent) or empty
      const signed = injectAppSignature(html);
      if (signed === html) return;
      try {
        await this.actuator.writeFile(this.workspaceId, htmlPath, signed);
        try { this.onFileWrite?.(htmlPath, signed); } catch { /* durable-store record is best-effort */ }
      } catch {
        /* couldn't write (read-only FS / sandbox gone) — leave the app unsigned rather than fail */
      }
      return; // signed the first HTML entry we found
    }
  }

  /**
   * The user's OWN vault secrets (Settings → Secrets & API Keys), decrypted, to inject into the environment
   * of the app they build (admin 2026-07-17). The composition root loads them (loadUserVaultSecrets) and
   * sets them here before the build runs. Empty = nothing to inject (no-op). These are the USER's keys —
   * never NavBharatAI's platform keys (the loader deliberately never reads process.env).
   */
  private userSecretsEnv: Record<string, string> = {};
  private secretsEnvWritten = false;
  /** The self-issued dev-secret check runs at most once per build (see ensureSelfIssuedDevSecrets). */
  private selfSecretsChecked = false;
  /** Set once a local Postgres has been provisioned for this build's `provider="postgresql"` schema. */
  private postgresProvisioned = false;
  /** When the provision (or last successful revival) completed — gates the preflight probe so a freshly
   *  verified DB isn't immediately re-probed. */
  private postgresProvisionedAt = 0;
  /** Set once this app is known to target PostgreSQL — locks the datasource against a silent SQLite downgrade. */
  private postgresIntended = false;
  /** Mid-build Postgres revivals attempted so far (bounded by POSTGRES_MAX_REVIVALS — a 60-min two-window
   *  build can see the sandbox reap Postgres more than once; once-only forced a needless SQLite downgrade). */
  private postgresReprovisionAttempts = 0;
  /** Postgres died mid-build and could NOT be brought back — the lock RELEASES so the app can fall to SQLite. */
  private postgresConfirmedDead = false;

  /**
   * Asked ONCE, only when the sandbox could not give the app a working database, and only by a caller
   * that can genuinely act on the user's answer — see ensureSandboxPostgres. Returns the env pairs of a
   * real database, or null if the user declined, was never asked, or provisioning failed.
   *
   * Injected rather than imported so the dispatcher stays free of Supabase, Firestore and approval
   * plumbing: it knows only "someone may be able to get me a database", which is all it needs.
   */
  private onDatabaseUnavailable?: () => Promise<Record<string, string> | null>;

  /** Wire the fallback above. The composition root supplies it only when it can really deliver. */
  setDatabaseFallback(fn: () => Promise<Record<string, string> | null>): void {
    this.onDatabaseUnavailable = fn;
  }

  /**
   * Ask the USER for credentials the app needs, mid-build.
   *
   * Injected for the same reason as the database fallback: the dispatcher must not know about the
   * vault, Firestore or the approval plumbing — only that "someone can ask the user for these names".
   * The composition root supplies it when there is a verified user to ask.
   *
   * Returns the env pairs that were saved (read back from the vault by the caller), or null if the
   * user skipped, the ask timed out, or nothing could be saved. THE VALUES NEVER TRAVEL THROUGH THE
   * BUILD'S EVENT STREAM — the client writes them straight to the encrypted vault and the caller reads
   * them back server-side (see secretRequest.ts).
   */
  private onSecretsNeeded?: (asks: SecretAsk[]) => Promise<Record<string, string> | null>;

  /** Wire the ask above. Supplied only when there is a verified user whose vault we can write to. */
  setSecretRequestHandler(fn: (asks: SecretAsk[]) => Promise<Record<string, string> | null>): void {
    this.onSecretsNeeded = fn;
  }

  /** Names already in the user's vault, so the build never asks twice for the same key. */
  private savedSecretNames: string[] = [];
  setSavedSecretNames(names: string[]): void {
    this.savedSecretNames = Array.isArray(names) ? names : [];
  }

  /** Set by the composition root from the user's decrypted vault (Settings → Secrets & API Keys). */
  setUserSecrets(env: Record<string, string>): void {
    this.secretsEnvWritten = false; // a fresh secret set must be able to reach disk even if a write already ran
    this.userSecretsEnv = env && typeof env === 'object' ? env : {};
  }

  /**
   * Write the user's vault secrets into the app's `.env` the FIRST time the app is about to install /
   * build / run — so the running preview AND any later deploy use real credentials, and the user never
   * had to paste a key into chat. Done once per build, best-effort, and only for real app commands.
   *
   * SECURITY: `.env` is force-added to `.gitignore` so the user's real keys can NEVER reach their git
   * repo; command output that prints a secret is already masked by redactSecrets on the way back. The
   * vault OVERRIDES any generated placeholder (mergeDotEnv), and existing .env lines are preserved.
   * Never throws — a failure just means the app runs without the injected keys (honest degradation).
   */
  /**
   * Give the app the secrets it mints for ITSELF, so it can boot at all.
   *
   * 🔒 ROOT CAUSE (admin 2026-08-21, "preview mar gaya" — Mitrify, the SECOND time). `ensureUserSecretsEnvFile`
   * below opens with `if (names.length === 0) return`, so a user with NO saved vault secrets got **no
   * `.env` written at all**. A live `.env` is deliberately never imported and never persisted durably
   * (the user's secrets stay theirs), so any sandbox that was recycled or rebuilt came back without
   * one — express-session threw "secret option required" and EVERY page request returned 500. The
   * app was fine; it had no key to sign a cookie with. The import turn conjured these correctly; no
   * later turn ever did.
   *
   * This is PREVENTION, not a heal: the failure class stops being possible instead of being detected
   * afterwards by the log classifier. A session secret is not a credential anyone issued the user —
   * it is a random string the app mints for itself, and one per sandbox is entirely valid for a dev
   * preview. Only self-issued names are filled; a third-party API key is NEVER invented (a fake one
   * makes the app fire real requests with garbage credentials and fail in confusing ways).
   *
   * Deterministic and cheap: ONE grep in the sandbox, no model call. Never overwrites a value that
   * already exists, and never throws — a failure here just leaves the app as it was.
   *
   * ⚠️ CALLED FROM `update_preview` ONLY, deliberately. My first version also hung it off the generic
   * bash path beside `ensureUserSecretsEnvFile` — which put a grep in front of EVERY command the
   * model runs, for a value that only matters when a server boots. The dispatcher's own tests caught
   * it (they assert the exact command sequence), and they were right to: `update_preview` is the
   * managed dev-server start, which is precisely the choke point this needs to guard.
   */
  private async ensureSelfIssuedDevSecrets(): Promise<void> {
    if (this.selfSecretsChecked) return;
    this.selfSecretsChecked = true;
    // ONE implementation, shared with the wake/diagnose route — see devSecretsBoot.ts. Two copies of
    // "write the dev .env" is exactly the drift that caused the original bug: this path learned to
    // conjure secrets in July and the wake path never did. The vault half is already on disk by now
    // (ensureUserSecretsEnvFile ran immediately before), so nothing is passed here.
    try {
      const io = {
        readFile: (w: string, p: string) => withTimeout(this.actuator.readFile(w, p), 5_000, 'boot-env-read'),
        writeFile: async (w: string, p: string, c: string) => {
          await this.actuator.writeFile(w, p, c);
          try { this.onFileWrite?.(p, c); } catch { /* durable record is best-effort */ }
        },
        runCommand: (w: string, c: string) => withTimeout(this.actuator.runCommand(w, c), 8_000, 'boot-env-scan'),
      };
      await ensureBootEnv(io, this.workspaceId);
    } catch { /* the app boots as it would have — this can only ever help */ }
  }

  async ensureUserSecretsEnvFile(command: string): Promise<void> {
    if (this.secretsEnvWritten) return;
    const names = Object.keys(this.userSecretsEnv);
    if (names.length === 0) return;
    // Only right before the app actually installs/builds/runs — that is when a .env must be on disk.
    // `ALWAYS` is the explicit bypass used by the pre-flight write below and by update_preview, where a
    // dev server is about to start WITHOUT any run_command having gone through this gate.
    if (command !== ALWAYS_WRITE_SECRETS
      && !/\b(?:npm|pnpm|yarn|bun|vite|next|node|nodemon|tsx|ts-node|deno|python|pip|uvicorn|gunicorn|flask)\b/i.test(command)) return;
    this.secretsEnvWritten = true; // attempt once regardless of outcome — never rewrite on every command
    try {
      let existing = '';
      try { existing = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'env-read'); } catch { existing = ''; }
      const merged = mergeDotEnv(existing, this.userSecretsEnv);
      await this.actuator.writeFile(this.workspaceId, '.env', merged);
      try { this.onFileWrite?.('.env', merged); } catch { /* durable-store record is best-effort */ }
      // Keep .env out of git — always, even if the app already had one.
      try {
        let gi = '';
        try { gi = await withTimeout(this.actuator.readFile(this.workspaceId, '.gitignore'), 5_000, 'gi-read'); } catch { gi = ''; }
        const nextGi = gitignoreWithEnv(gi);
        if (nextGi !== gi) {
          await this.actuator.writeFile(this.workspaceId, '.gitignore', nextGi);
          try { this.onFileWrite?.('.gitignore', nextGi); } catch { /* best-effort */ }
        }
      } catch { /* gitignore hardening is best-effort */ }
      // PROVE IT, THEN SAY IT (admin finding 3, 2026-08-06). The old line here announced the COPY —
      // "Loaded 3 of your saved keys" — and said nothing about whether any of them work. A stale or
      // mistyped connection string got the same confident sentence as a live one, and the user found out
      // minutes later from a preview that would not load, with nothing tying the failure back to the
      // screen that fixes it. Now the one class of secret we can genuinely verify is verified, and the
      // narration distinguishes proven / broken / untested instead of blurring all three into a count.
      // Bounded and best-effort: costs nothing when no connection string is saved, and a verification
      // that itself fails degrades to "untested" — it never withholds a key the user chose to save.
      // Both checks run CONCURRENTLY, under their own budgets. Run in sequence they would add their
      // deadlines together on every build that saves a credential; side by side the cost is the slower
      // of the two. They test different transports (a database connection vs an HTTPS read) and neither
      // depends on the other's answer, so there is nothing to serialize.
      let verdicts: SecretVerdict[] = [];
      let probed: ProbeVerdict[] = [];
      try {
        [verdicts, probed] = await Promise.all([
          verifyInjectedSecrets(this.userSecretsEnv).catch(() => [] as SecretVerdict[]),
          credentialProbeEnabled()
            ? probeCredentials(this.userSecretsEnv, realProbeFetch).catch(() => [] as ProbeVerdict[])
            : Promise.resolve([] as ProbeVerdict[]),
        ]);
      } catch { verdicts = []; probed = []; }
      if (verdicts.length === 0) {
        this.narrate('secrets.loaded', { count: names.length });
      } else {
        const { loaded, problems } = preflightNarration(verdicts);
        this.events?.emit({ type: 'narration', agent: 'architect', text: loaded, ts: Date.now() });
        for (const p of problems) this.events?.emit({ type: 'narration', agent: 'architect', text: p, ts: Date.now() });
      }
      // TWO FAILURES THE VERDICTS ABOVE CANNOT SEE, because in both the credential WORKS (2026-08-17).
      // A live secret saved under a VITE_/NEXT_PUBLIC_ name is inlined into the JavaScript every visitor
      // downloads — the app runs flawlessly and the key is public. A sandbox key charges an imaginary
      // card perfectly and no money ever arrives, which the user discovers days later from a missing
      // settlement. Deterministic and catalogue-driven, so a clean vault costs nothing and an
      // unrecognised value says nothing at all. Advisory only — it can never block or fail a build.
      // ── WHICH VARIABLES DOES *THIS* APP ACTUALLY READ? (admin 2026-08-25: "har ek build report me
      // yeh message kyu aata hai?") ───────────────────────────────────────────────────────────────
      // The whole vault is merged into every app's `.env` above, and both notices below were then
      // aimed at the VAULT rather than at this app — so a Razorpay key saved once for one payment app
      // was re-checked, and re-complained about, while building a racing game or a to-do list. A
      // warning that appears on every build and is never about what the user is doing is a warning
      // they stop reading, and the next one will matter.
      //
      // ONE bounded grep — the same scan the boot path already runs, and this whole method runs once
      // per build — answers it. `null` means we could not scan, and null keeps EVERYTHING: ignorance
      // must never silently delete a real warning.
      let referencedEnvNames: string[] | null = null;
      let credWarnings: ReturnType<typeof inspectCredentials> = [];
      try { credWarnings = inspectCredentials(this.userSecretsEnv); } catch { credWarnings = []; }
      if (probed.length > 0 || credWarnings.length > 0) {
        try {
          const scan = await withTimeout(this.actuator.runCommand(this.workspaceId, ENV_SCAN_COMMAND), 10_000, 'probe-relevance');
          referencedEnvNames = envNamesFromGrep(scan?.stdout ?? '');
        } catch { referencedEnvNames = null; /* could not tell → say everything, exactly as before */ }
      }
      try {
        for (const w of credWarnings) {
          // A LEAKED SECRET IS ALWAYS SAID, RELEVANT OR NOT — and that asymmetry is deliberate. A value
          // saved under a VITE_/NEXT_PUBLIC_ name must be rotated at the provider whatever this app
          // does with it, so relevance cannot make it safe to withhold. The test-key notice is the
          // opposite: it says "this app will look like it takes money and will not", which is a
          // statement about an app that actually charges — meaningless on one that does not.
          if (w.kind !== 'exposed-secret' && relevantToApp([{ names: [w.name] }], referencedEnvNames).length === 0) continue;
          this.events?.emit({ type: 'narration', agent: 'architect', text: w.message, ts: Date.now() });
        }
      } catch { /* a warning that fails is silence, never a broken build */ }
      // …and what the providers themselves said. Only a REJECTED key and a PROVEN one are worth a line:
      // "we could not reach Stripe" is noise on a build the user is watching, and it is already recorded
      // for the admin report. A key that works earns its green tick because it was actually checked.
      // Same relevance rule as above — a verdict about a key this app never reads is not this build's
      // business, and saying it anyway is what made the message appear on every single build.
      for (const p of relevantToApp(probed, referencedEnvNames)) {
        if (p.status !== 'rejected' && p.status !== 'working') continue;
        this.events?.emit({ type: 'narration', agent: 'architect', text: p.message, ts: Date.now() });
      }
    } catch { /* best-effort — never block the build; the app just runs without injected keys */ }
  }

  /**
   * LAZY POSTGRES PROVISIONING (MediConnect autopsy 2026-07-19). The first time the builder is about to
   * run a command that needs a LIVE database (`prisma migrate` / `db push` / seed), AND the app's Prisma
   * schema targets `provider="postgresql"`, provision a real local Postgres in the sandbox and write its
   * DATABASE_URL into `.env` (Prisma auto-loads `.env`). This is the from-scratch counterpart of the
   * imported-app provisioning — the exact gap that left MediConnect with nothing at localhost:5432, so
   * `prisma migrate dev` failed with P1001 and the builder improvised a broken SQLite downgrade.
   *
   * Fires at most ONCE per build, only for postgres schemas, and never throws — a provisioning failure
   * degrades honestly (the migrate then reports its real DB-unreachable error via Slice 1's DB_UNREACHABLE).
   * Kill switch: AGENTV3_SANDBOX_POSTGRES=off. A sandbox without provisionBackend (LocalActuator) is a no-op.
   */
  private async ensureSandboxPostgres(command: string): Promise<void> {
    if (this.postgresProvisioned) return;
    if (!sandboxPostgresEnabled()) return;
    if (!commandNeedsLiveDatabase(command)) return;
    if (typeof this.actuator.provisionBackend !== 'function') return; // e.g. LocalActuator — honest no-op
    // Only for a Postgres-targeting schema — a sqlite/mysql app must not trigger a Postgres install.
    let schema = '';
    try { schema = await withTimeout(this.actuator.readFile(this.workspaceId, 'prisma/schema.prisma'), 5_000, 'schema-read'); } catch { schema = ''; }
    if (!schemaTargetsPostgres(schema)) return;
    this.postgresIntended = true;    // lock the datasource against a later silent SQLite downgrade
    // THE USER'S OWN DATABASE ALWAYS WINS (admin question 2026-08-06: "user apna db ka link credentials
    // dega"). A user who connected their database in Settings → App Settings → Database has their
    // DATABASE_URL injected into this app's `.env` before the build runs. Provisioning a sandbox-local
    // Postgres here would merge `postgresql://postgres@localhost:5432/myapp` OVER it — the newer value
    // wins in mergeDotEnv — so the app would silently point at a throwaway database instead of the one
    // the user chose, and nothing would say so. Read the `.env` rather than this dispatcher's in-memory
    // copy: only the composition root calls setUserSecrets, while every dispatcher and sub-agent in the
    // build shares the same file, so the file is the one source of truth all of them agree on.
    let envNow = '';
    try { envNow = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'env-read'); } catch { envNow = ''; }
    const connectedUrl = dotEnvValue(envNow, 'DATABASE_URL') ?? this.userSecretsEnv?.DATABASE_URL ?? '';
    if (isUserOwnedDatabaseUrl(connectedUrl)) {
      this.postgresProvisioned = true; // decided — never reconsider mid-build
      this.narrate('db.usingConnected', {});
      return;
    }
    this.postgresProvisioned = true; // attempt once regardless of outcome — never reinstall on every migrate
    this.postgresProvisionedAt = Date.now();
    try {
      this.narrate('db.provisioning', {});
      // NOTE: the E2B provisionBackend arms the in-sandbox keepalive watchdog itself (single choke
      // point) — every provisioning path (first provision, mid-build revival, preview-boot revival)
      // gets the keepalive without each caller re-wiring it.
      const prov = await withTimeout(this.actuator.provisionBackend(this.workspaceId, ['db']), 130_000, 'sandbox-postgres-provision');
      const lines = postgresEnvLines(prov?.envVars?.DATABASE_URL ?? prov?.dbUrl);
      if (Object.keys(lines).length > 0) {
        let existing = '';
        try { existing = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'env-read'); } catch { existing = ''; }
        const merged = mergeDotEnv(existing, lines);
        await this.actuator.writeFile(this.workspaceId, '.env', merged);
        try { this.onFileWrite?.('.env', merged); } catch { /* durable-store record is best-effort */ }
        // Keep .env out of git.
        try {
          let gi = '';
          try { gi = await withTimeout(this.actuator.readFile(this.workspaceId, '.gitignore'), 5_000, 'gi-read'); } catch { gi = ''; }
          const nextGi = gitignoreWithEnv(gi);
          if (nextGi !== gi) { await this.actuator.writeFile(this.workspaceId, '.gitignore', nextGi); try { this.onFileWrite?.('.gitignore', nextGi); } catch { /* best-effort */ } }
        } catch { /* gitignore hardening is best-effort */ }
        // "✅ ready" is EARNED, not inferred from a URL existing (admin task 1, 2026-08-05 — the
        // Mitrify false-success class): provisionBackend returns a fallback URL even when Postgres
        // never came up, so this line used to promise a database the very next migrate could not
        // reach. Only a real SELECT 1 gets the checkmark; anything else says what actually happened.
        // THE FRESH-BUILD PATH MUST LEAVE EVIDENCE TOO (admin 2026-08-06). The import path records which
        // route the sandbox got its PostgreSQL from; this one only narrated to the user, so a from-scratch
        // build proved nothing about whether the fetched-Postgres path fired. provisionBackend talks to
        // the sandbox directly rather than through runCommand, so the report never saw its output either.
        // Recorded as a command entry — the channel the report already reads — so both paths are equally
        // answerable from a single build.
        try {
          this.onCommand?.({
            command: 'nbai: provision sandbox postgres',
            exitCode: prov?.dbVerified === true ? 0 : 1,
            stdout: `${provisionPathSummary(prov?.dbDiagnostics)}\n${prov?.dbDiagnostics ?? ''}`.trim(),
            stderr: '',
            durationMs: Date.now() - this.postgresProvisionedAt,
          });
        } catch { /* diagnostics are best-effort and must never affect the build */ }
        if (prov?.dbVerified === false) {
          // THE SANDBOX COULD NOT GIVE THE APP A DATABASE. Until now this was the end of the road: we
          // wrote a DATABASE_URL pointing at a Postgres that was never running, said we would "retry
          // it", and every later step failed with ECONNREFUSED — which is how an app ends up serving
          // "Cannot GET /" with no explanation. There IS another real database available (one in the
          // user's own account), so ASK for it rather than continuing toward a certain failure.
          const rescued = await this.rescueDatabase();
          if (!rescued) {
            this.narrate('db.connectionTestFailed', {});
          }
        } else {
          this.narrate('db.ready', {});
        }
      }
    } catch {
      // Provisioning genuinely failed — do NOT fake it. Offer the real alternative first (the same ask
      // as the failed-verification branch above); if that is unavailable or declined, the migrate
      // command runs next and its real DB-unreachable output is surfaced honestly (Slice 1
      // DB_UNREACHABLE). Never block the build.
      await this.rescueDatabase().catch(() => false);
    }
  }

  /**
   * Last resort when the sandbox has no working database: ask whoever wired setDatabaseFallback.
   *
   * WHY THIS IS AN ASK AND NOT AN AUTOMATIC ACTION (admin 2026-08-06: "user se puchona chahiye na!").
   * The alternative is a database created inside the USER's own account, which consumes one of the two
   * projects their free plan allows. Spending that silently is not ours to do. The callback owns the
   * asking; this method owns making the answer real — writing the returned connection into the app's
   * `.env` so a build ALREADY IN FLIGHT uses it, because the vault is only read at the start of a build.
   *
   * Returns whether the app now has a real database. Never throws.
   */
  /**
   * Apply the app's own migrations to the DURABLE database it will live on, right after a publish.
   *
   * Returns a user-facing sentence to append to the deploy result, or '' when there is nothing worth
   * saying. NEVER throws and never fails the deploy: the app is already live at this point, and a
   * migration problem must be reported, not converted into a failed publish.
   *
   * The safety decision is NOT made here — `planProductionMigration` owns it, and it refuses anything
   * that is not a documented forward-only apply verb. This method only carries out an already-approved
   * plan and reports honestly on what the commands really did.
   */
  private async migrateProductionDatabase(): Promise<string> {
    // The live database is whatever the app's own .env says, which is where the vault's DATABASE_URL
    // and any rescue/provisioning result all land — one source of truth, the same one the running app
    // will use. A sandbox-local URL is not a production database and is skipped by the planner.
    let envNow = '';
    try { envNow = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'prod-migrate-env'); } catch { return ''; }
    const productionUrl = dotEnvValue(envNow, 'DATABASE_URL');
    if (!productionUrl || !isUserOwnedDatabaseUrl(productionUrl)) return '';

    let files: string[] = [];
    try { files = await this.actuator.listFiles(this.workspaceId); } catch { return ''; }
    let pkgRaw: string | undefined;
    try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }

    const decision = planProductionMigration({ plans: detectMigrationPlan(files, pkgRaw), productionUrl });
    // A refusal is only worth a sentence when the user can act on it. "This app has no migration tool"
    // is true but useless noise on a successful publish, so it stays silent.
    if (!decision.ok) return decision.reason === 'no-migrations' || decision.reason === 'no-database' ? '' : ` ${decision.message}`;

    this.events?.emit({ type: 'narration', agent: 'architect', text: `🗄️ ${decision.summary}`, ts: Date.now() });
    // No env override, and that is deliberate. The app's `.env` ALREADY holds this exact URL — that is
    // where it was read from a few lines above — so the migration tools pick it up on their own. The
    // alternative, prefixing the command with `DATABASE_URL=…`, would write the user's live database
    // password into `buildDiag.recordCommand`, which stores the raw command string UNREDACTED. That is
    // the same leak class as the plaintext `.env` display fixed earlier today; not worth re-opening to
    // save a line.
    let lastOutput = '';
    for (const command of decision.commands) {
      // Re-checked at the moment of execution, not only at planning time. The plan and the run are
      // separated by awaits, and this is the last line before a command touches live data.
      if (!isProductionSafeCommand(command)) return ' Your app\'s database setup was skipped as a precaution.';
      let exitCode = 1;
      try {
        const r = await withTimeout(this.actuator.runCommand(this.workspaceId, command), 180_000, 'prod-migrate');
        exitCode = typeof r?.exitCode === 'number' ? r.exitCode : 1;
        lastOutput = String(r?.stdout ?? '') + String(r?.stderr ?? '');
      } catch {
        return ' Your app is published, but its database tables could not be set up just now — it will not be able to save data until they are.';
      }
      const step = migrationOutcome(exitCode, lastOutput);
      if (step.outcome === 'failed') return ` ${step.message}`;
    }
    return ` ${migrationOutcome(0, lastOutput).message}`;
  }

  private async rescueDatabase(): Promise<boolean> {
    if (!this.onDatabaseUnavailable) return false;
    let env: Record<string, string> | null = null;
    try { env = await this.onDatabaseUnavailable(); } catch { env = null; }
    // No DATABASE_URL means nothing changed for a server-side app, so claiming a rescue would be the
    // nearly-true report this whole path exists to avoid.
    if (!env || !env.DATABASE_URL) return false;
    try {
      let existing = '';
      try { existing = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'env-read'); } catch { existing = ''; }
      // Written LAST, so it wins over the sandbox-local URL merged moments earlier.
      const merged = mergeDotEnv(existing, env);
      await this.actuator.writeFile(this.workspaceId, '.env', merged);
      try { this.onFileWrite?.('.env', merged); } catch { /* durable-store record is best-effort */ }
      try {
        let gi = '';
        try { gi = await withTimeout(this.actuator.readFile(this.workspaceId, '.gitignore'), 5_000, 'gi-read'); } catch { gi = ''; }
        const nextGi = gitignoreWithEnv(gi);
        if (nextGi !== gi) { await this.actuator.writeFile(this.workspaceId, '.gitignore', nextGi); try { this.onFileWrite?.('.gitignore', nextGi); } catch { /* best-effort */ } }
      } catch { /* gitignore hardening is best-effort */ }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * POSTGRES-PROVIDER LOCK (LedgerLoop autopsy 2026-07-20). Applied to a `prisma/schema.prisma` write
   * BEFORE the config guards run. Two jobs:
   *   • learn intent: the FIRST time a schema targets postgresql, remember it (postgresIntended),
   *   • enforce it: once the app is known to target Postgres, a write that flips the datasource to sqlite
   *     is reverted to postgresql — killing the silent SQLite downgrade the builder does when it misreads
   *     a schema/connection error as "no database". The builder is nudged to fix the schema instead.
   * Runs BEFORE guardConfigContent so the reverted (postgres) content never triggers the sqlite enum-strip.
   * Only touches schema.prisma; a genuine sqlite app (never postgres) is untouched. Kill switch reuses
   * AGENTV3_SANDBOX_POSTGRES=off (the same DB-provisioning regime).
   */
  private applyPostgresProviderLock(path: string, content: string): string {
    if (!/(^|\/)schema\.prisma$/.test(path) || typeof content !== 'string') return content;
    if (!sandboxPostgresEnabled()) return content;
    // If Postgres died in the sandbox and could not be restarted, the lock RELEASES — forcing a dead DB
    // is an unwinnable loop (FleetOps autopsy). Let the SQLite fallback through so the app can still run.
    if (this.postgresConfirmedDead) return content;
    if (schemaTargetsPostgres(content)) { this.postgresIntended = true; return content; }
    if (this.postgresIntended && schemaTargetsSqlite(content)) {
      const { content: fixed, reverted } = revertSqliteToPostgres(content);
      if (reverted) {
        getWorkspaceMemory(this.workspaceId).recordAudit('postgres-lock: reverted a schema downgrade to sqlite back to postgresql');
        this.narrate('db.postgresLocked', {});
        return fixed;
      }
    }
    return content;
  }

  /**
   * The structured readiness verdict from the most recent `evaluate` run. Captured as a
   * side-effect so the mandatory end-of-build gate (assessBuildReadiness) can reuse the exact
   * same objective scan the agent uses — never a second, divergent implementation.
   */
  private lastReadiness: ReadinessReport | null = null;

  /**
   * Run the real `evaluate` scan and return its structured readiness verdict (R2 §1.1).
   * Used by AgentRunner to make the quality gate MANDATORY: a build cannot be reported as a
   * clean success while `ready` is false (a build-breaker, secret leak, fake code, or an app
   * that cannot run). Best-effort: if the scan throws, returns a permissive READY so the gate
   * never wrongly fails a real build on an internal error.
   */
  async assessBuildReadiness(): Promise<ReadinessReport> {
    const permissive: ReadinessReport = { score: 100, ready: true, blockers: [], warnings: [], tier: 'enterprise' };
    try {
      // OVERALL TIMEOUT (audit P0-C): the readiness gate runs AFTER the last agent turn, so the
      // build's wall-clock deadline can no longer interrupt it. Without this bound a single stalled
      // file read here hangs a build whose app is ALREADY built, until the 12-min cap kills it as a
      // "failure". On timeout we return a PERMISSIVE verdict — the gate is best-effort and must never
      // fail a real build on its own slowness.
      return await withTimeout((async () => {
        // CRITICAL — seed the project graph from the REAL workspace before judging it.
        // The in-memory graph is otherwise populated ONLY by the indexing write-tools
        // (write_file / edit_file / apply_patch); files seeded by the actuator scaffold
        // or created via bash/npm — and the index.html entry — never enter the graph.
        // The architecture pass then flags their imports as "unresolved import" and
        // runnability claims "no index.html", both HARD blockers, so the gate falsely
        // reports a real, working build as NOT READY ("build did not complete").
        // Reading the actual file tree first makes the gate judge the app that exists.
        await this.seedGraphFromWorkspace();
        await this.run({ id: '_readiness_gate', name: 'evaluate', input: {} } as ToolUse, 'architect');
        return this.lastReadiness ?? permissive;
      })(), 45_000, 'assessBuildReadiness');
    } catch {
      return permissive;
    }
  }

  /**
   * U-1 — run the project's OWN ESLint (+ Prettier) and return the lint-gate verdict (ESLint errors
   * block; warnings/formatting do not). Default-OFF gate: AgentRunner only calls this when the admin
   * enables AGENTV3_LINT_GATE. Best-effort + timeout-bounded: on no linter, an internal error, or a
   * slow run it returns a NON-blocking verdict so it can never fail a real build on its own trouble.
   */
  async assessLintGate(): Promise<LintGateVerdict> {
    const permissive: LintGateVerdict = { blocked: false, errorCount: 0, blockers: [], summary: 'Lint gate: not assessed.' };
    try {
      return await withTimeout((async () => {
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        const plans = detectLinters(files, pkgRaw);
        if (!plans.length) return permissive; // no ESLint/Prettier configured → nothing to gate on
        const outcomes: LintOutcome[] = [];
        for (const plan of plans) {
          const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, plan.command);
          outcomes.push(parseLintOutcome(plan, exitCode, stdout, stderr));
        }
        return lintGateVerdict(outcomes);
      })(), 45_000, 'assessLintGate');
    } catch {
      return permissive;
    }
  }

  /**
   * P-PIPE — run the project's dependency-health checks (OSV/CVE + strong-copyleft license) at BUILD-END and
   * return one advisory block for the build summary. ADVISORY-ONLY: never blocks a build. Best-effort +
   * timeout-bounded (parity with assessLintGate): on no package.json, an unreachable OSV API, an invalid
   * lockfile, or a slow scan it returns '' (clean) so it can never fail a real build on its own trouble.
   * AgentRunner only calls this when AGENTV3_DEPHEALTH_GATE is enabled.
   */
  async assessDependencyHealthGate(): Promise<string> {
    try {
      return await withTimeout((async () => {
        let vulnFindings = 0;
        let vulnSummary = '';
        let copyleftStrong = 0;
        let licenseSummary = '';

        // 1) CVE / OSV supply-chain scan (needs package.json; lockfile improves resolution).
        let pkgJson: string | undefined;
        try { pkgJson = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgJson = undefined; }
        if (typeof pkgJson === 'string') {
          let lockJson: string | undefined;
          try { lockJson = await this.actuator.readFile(this.workspaceId, 'package-lock.json'); } catch { lockJson = undefined; }
          const deps = resolveDependencies(pkgJson, lockJson);
          const result = await scanVulnerabilities(deps);
          if (result.ok && result.findings.length > 0) {
            vulnFindings = result.findings.length;
            vulnSummary = vulnScanSummary(result);
          }
        }

        // 2) Strong-copyleft license classification (needs package-lock.json; pure, no network).
        let lockRaw: string | undefined;
        try { lockRaw = await this.actuator.readFile(this.workspaceId, 'package-lock.json'); } catch { lockRaw = undefined; }
        if (typeof lockRaw === 'string') {
          try {
            const analysis = analyzeAppDependencies(JSON.parse(lockRaw));
            if (analysis.hasCopyleftRisk) {
              copyleftStrong = analysis.copyleft.strong.length;
              licenseSummary = licenseAdvisorySummary(analysis);
            }
          } catch { /* invalid lockfile — skip the license half, never throw */ }
        }

        return dependencyHealthVerdict({ vulnFindings, vulnSummary, copyleftStrong, licenseSummary }).summary;
      })(), 45_000, 'assessDependencyHealthGate');
    } catch {
      return '';
    }
  }

  /**
   * P-PIPE — build-end PRETTIER advisory (default-OFF, AGENTV3_PRETTIER_GATE=on). Runs the project's own
   * `prettier --check` (only when prettier is configured) and returns a non-blocking advisory listing the
   * unformatted files, or '' when clean / not-configured / could-not-run. Timeout-bounded and fully guarded
   * (parity with assessLintGate / assessDependencyHealthGate): any trouble returns '' so it can never fail a
   * real build on its own account. AgentRunner only calls this when the gate is enabled.
   */
  async assessPrettierGate(): Promise<string> {
    try {
      return await withTimeout((async () => {
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        const plan = detectLinters(files, pkgRaw).find((p) => p.tool === 'prettier');
        if (!plan) return ''; // prettier not configured → nothing to advise
        const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, plan.command);
        return prettierAdvisory(prettierGateResult(exitCode, stdout, stderr));
      })(), 45_000, 'assessPrettierGate');
    } catch {
      return '';
    }
  }

  /**
   * Cap-4 injection — deterministically add a `/health` route to an Express server entry that lacks one, then
   * persist it through the SAME durable write path a normal write_file uses (sandbox + durable mirror +
   * graph/UI), so nothing downstream diverges. Returns a short honest note when it injected, '' otherwise
   * (no Express entry, already has a health route, or an ambiguous/multi-entry project — the pure injector
   * declines those). Best-effort + timeout-bounded — a read/write error degrades to '' and never fails a
   * build. AgentRunner only calls this when AGENTV3_OBSERVABILITY_INJECT is enabled.
   */
  /** HEAL-THEN-JUDGE (CLAUDE.md 50/50 law): wire orphaned page components into the app's react-router
   *  <Routes> BEFORE the readiness gate judges — so a page the builder created but forgot to route is
   *  made reachable and stops being an orphan blocker, rather than the gate merely REPORTING it. A real
   *  deterministic fix, additive-only + idempotent + a no-op on an ambiguous router (orphanPageWiring.ts),
   *  so it can never break a working router. Best-effort. Kill switch: AGENTV3_ORPHAN_PAGE_GUARD=off. */
  async healOrphanPages(): Promise<string> {
    if (envKillSwitch('AGENTV3_ORPHAN_PAGE_GUARD')) return '';
    try {
      return await withTimeout((async () => {
        const { files } = await collectWorkspaceFiles(this.actuator, this.workspaceId);
        const result = wireOrphanPages(files);
        if (result.wired.length === 0) return '';
        for (const [path, content] of Object.entries(result.files)) {
          if (files[path] === content) continue; // only the one router file actually changed
          await this.actuator.writeFile(this.workspaceId, path, content);
          try { this.onFileWrite?.(path, content); } catch { /* durable mirror is best-effort */ }
          try { this.state?.recordFileChange({ path, kind: 'modify' }, 'architect'); } catch { /* UI count is best-effort */ }
        }
        try { getWorkspaceMemory(this.workspaceId).recordAudit(`orphan-page wiring: routed ${result.wired.join(', ')}.`); } catch { /* audit best-effort */ }
        const names = result.wired.map((w) => (w.split(' ')[0].split('/').pop() || '').replace(/\.(?:t|j)sx$/, '')).filter(Boolean);
        return `🧭 Wired ${result.wired.length} page(s) into the router so they are actually reachable: ${names.join(', ')}.`;
      })(), 20_000, 'healOrphanPages');
    } catch {
      return '';
    }
  }

  /** HEAL-THEN-JUDGE (CLAUDE.md 50/50 law, SaaS-dashboard autopsy 2026-07-22): deterministically redact
   *  console.* statements that log a credential/token BEFORE the readiness gate judges — so a single
   *  `pii-in-logs` line (the gate's ONLY high-severity privacy/compliance class, a HARD block) stops
   *  failing an otherwise-complete app, rather than the gate merely blocking on it. A debug log that
   *  prints a password is never app logic, so stripping its arguments both removes the real leak AND
   *  clears the block — a real security fix, not a cosmetic patch. Provably non-breaking (single-line,
   *  statement-leading, paren-balanced calls only; anything ambiguous is left as an honest finding),
   *  idempotent, persisted through the same durable write path. Kill switch: AGENTV3_CRED_LOG_GUARD=off. */
  async healCredentialLogs(): Promise<string> {
    if (envKillSwitch('AGENTV3_CRED_LOG_GUARD')) return '';
    try {
      return await withTimeout((async () => {
        const { files } = await collectWorkspaceFiles(this.actuator, this.workspaceId);
        const result = redactCredentialLogs(files);
        if (result.redactions.length === 0) return '';
        for (const [path, content] of Object.entries(result.files)) {
          if (files[path] === content) continue; // only the files that actually changed
          await this.actuator.writeFile(this.workspaceId, path, content);
          try { this.onFileWrite?.(path, content); } catch { /* durable mirror is best-effort */ }
          try { this.state?.recordFileChange({ path, kind: 'modify' }, 'architect'); } catch { /* UI count is best-effort */ }
        }
        const changed = [...new Set(result.redactions.map((r) => r.file))];
        try { getWorkspaceMemory(this.workspaceId).recordAudit(`credential-log redaction: cleared ${result.redactions.length} leak(s) across ${changed.join(', ')}.`); } catch { /* audit best-effort */ }
        return `🔒 Redacted ${result.redactions.length} console log(s) that leaked a credential/token so nothing sensitive is printed to the browser console (${changed.length} file(s)).`;
      })(), 20_000, 'healCredentialLogs');
    } catch {
      return '';
    }
  }

  async injectObservability(): Promise<string> {
    try {
      return await withTimeout((async () => {
        const { files } = await collectWorkspaceFiles(this.actuator, this.workspaceId);
        const result = injectObservabilityFixes(files);
        if (!result) return '';
        await this.actuator.writeFile(this.workspaceId, result.path, result.newContent);
        try { this.onFileWrite?.(result.path, result.newContent); } catch { /* durable mirror is best-effort */ }
        try { this.state?.recordFileChange({ path: result.path, kind: 'modify' }, 'architect'); } catch { /* UI count is best-effort */ }
        const labels: Record<'request-logger' | 'health' | 'error-handler', string> = {
          'request-logger': 'a request logger',
          health: 'a /health route',
          'error-handler': 'an error handler',
        };
        const what = result.added.map((a) => labels[a]).join(' and ');
        try { getWorkspaceMemory(this.workspaceId).recordAudit(`observability: injected ${result.added.join(' + ')} (on ${result.appVar}) into ${result.path}.`); } catch { /* audit best-effort */ }
        return `🩺 Observability: added ${what} to ${result.path} so deploy/uptime probes and thrown errors are handled cleanly.`;
      })(), 20_000, 'injectObservability');
    } catch {
      return '';
    }
  }

  /**
   * Index the real workspace files into the project graph so a graph-based scan
   * (architecture / runnability) sees the actual app, not just files written via
   * the indexing tools. Best-effort: never throws, capped, skips heavy/generated
   * dirs. Already-indexed files are left untouched (write-tool facts win).
   */
  private async seedGraphFromWorkspace(): Promise<void> {
    try {
      const mem = getWorkspaceMemory(this.workspaceId);
      const tree = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
      const EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__|coverage)\//;
      // Code (for import resolution) + index.html (runnability/SEO) + key configs.
      const INDEXABLE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|css|scss|json)$/i;
      const known = new Set(mem.graph().files);
      const targets = tree
        .filter((p) => !EXCLUDE.test(p) && INDEXABLE.test(p) && !known.has(p))
        .slice(0, 500);
      // PARALLEL + per-file timeout (audit P0-C): reading up to 500 files one-at-a-time over the
      // sandbox cost 50-160s and could hang on a single stalled read. Read in bounded-concurrency
      // batches, each call capped at 5s, then index sequentially (graph mutation is synchronous).
      const reads = await mapWithConcurrency(targets, 12, async (p) => ({
        p,
        content: await withTimeout(this.actuator.readFile(this.workspaceId, p), 5_000, 'readFile').catch(() => ''),
      }));
      for (const { p, content } of reads) {
        if (typeof content === 'string' && content && content.length <= 250_000) mem.indexFile(p, content);
      }
    } catch { /* best-effort pre-seed — never blocks the gate */ }
  }

  /**
   * Self-heal the workspace scaffold using the configured framework template.
   * The actuator normally seeds a starter at workspace creation; this is the
   * safety net for when no package.json (or equivalent entry file) is present.
   * Called when the scaffold guard blocks a create-* command AND once at the start
   * of every agentic run (see ensureScaffoldOnce) — best-effort, never throws.
   *
   * NON-DESTRUCTIVE by file (NotesNest autopsy 2026-07-16): each template file is
   * written ONLY if that path is absent. The fallback-after-salvage workspace has
   * real generated src files but no package.json — blanket-writing the starter
   * would clobber the salvaged work with "Hello World".
   */
  private async ensureViteScaffold(): Promise<void> {
    const entryFile = this.frameworkEntryFile();
    try {
      await this.actuator.readFile(this.workspaceId, entryFile);
      return; // root already scaffolded — nothing to do
    } catch {
      /* missing — write the starter below */
    }
    try {
      const registry = new TemplateRegistry();
      const frameworkId = this.framework ?? 'vite-react';
      const provider = (() => {
        try { return registry.getProvider(frameworkId); } catch { return new ViteReactProvider(); }
      })();
      const files = provider.getFiles([]);
      for (const [path, content] of Object.entries(files)) {
        const exists = await this.actuator.readFile(this.workspaceId, path).then(() => true).catch(() => false);
        if (exists) continue; // never clobber real (e.g. salvaged) work with the starter
        await this.actuator.writeFile(this.workspaceId, path, content).catch(() => {});
      }
    } catch {
      /* self-heal is best-effort; the redirect message still guides the agent */
    }
  }

  /**
   * ENDGAME REPAIR I/O (QuizArena autopsy 2026-07-17, Slice 1) — the bounded sandbox surface the
   * step-cap endgame uses to fix remaining compile errors WITHOUT agent round-trips: run tsc, read
   * the full project map, persist a repaired file (sandbox + durable mirror + graph/state, the same
   * side-effects a normal write_file performs, so nothing downstream diverges).
   */
  /** Framework id for prompt construction (endgame repair). */
  get frameworkId(): string {
    return this.framework ?? 'vite-react';
  }

  /**
   * WRITE-TIME PARSE GUARD (deep-test 2026-07-18). Returns a rejection message when writing `newContent`
   * to `path` would turn a previously-CLEAN (or new) source file into one that does NOT parse — the exact
   * recurring break (a DUPLICATE `handleExportCSV` declaration, an unwrapped JSX sibling, a missing `)`).
   * Returns null (allow) when the guard is off, the file isn't parseable source, the new content parses,
   * or the file was ALREADY broken (so a repair-in-progress is never blocked). Best-effort: if the parse
   * itself throws, allow the write (never block on the guard's own failure). Records a blocked-write audit.
   */
  private async parseGuardRejection(path: string, oldContent: string, newContent: string): Promise<string | null> {
    if (!writeParseGuardEnabled()) return null;
    try {
      const errNew = await firstSyntaxError(path, newContent);
      if (!errNew) return null; // parses clean → nothing to block (skips the second parse in the common case)
      const errOld = await firstSyntaxError(path, oldContent);
      const rejection = parseGuardDecision(path, errOld, errNew, true);
      if (rejection) {
        try { getWorkspaceMemory(this.workspaceId).recordError(`[BLOCKED-SYNTAX] refused write that would break ${path}: ${errNew.message}`); } catch { /* audit best-effort */ }
      }
      return rejection;
    } catch { return null; /* never block a write on the guard's own failure */ }
  }

  endgameIo(): { runTsc: () => Promise<string>; readFiles: () => Promise<Record<string, string>>; writeFile: (path: string, content: string) => Promise<void> } {
    return {
      runTsc: async () => {
        // Slice 4 — INCREMENTAL tsc: the .tsbuildinfo cache makes every peek after the first
        // ~0.3-0.8s instead of ~2s, so the 25-step trend checkpoint and the endgame re-verifies are
        // near-free. The cache lives in /tmp (ephemeral, never collected into the durable store).
        // Deliberately NOT `tsc --watch`: a watcher's log can be read mid-recompile and report a
        // STALE "clean" — a synchronous incremental run is always honest about the current tree.
        const r = await this.actuator.runCommand(
          this.workspaceId,
          // Robust tsc — the LOCAL binary (never `npx tsc`, which can hit the `tsc@2.0.4` squatter's
          // help page and never typecheck; build report 2026-07-21). See tscCommand.ts.
          robustTscCommand('--noEmit --incremental --tsBuildInfoFile /tmp/agentv3.tsbuildinfo', '2>&1 | head -80'),
        );
        return `${r.stdout || ''}\n${r.stderr || ''}`.trim();
      },
      readFiles: async () => (await collectWorkspaceFiles(this.actuator, this.workspaceId)).files,
      writeFile: async (path: string, content: string) => {
        await this.actuator.writeFile(this.workspaceId, path, content);
        try { this.onFileWrite?.(path, content); } catch { /* durable mirror is best-effort */ }
        try { this.state?.recordFileChange({ path, kind: 'modify' }, 'architect'); } catch { /* UI count is best-effort */ }
      },
    };
  }

  // PRE-FLIGHT SCAFFOLD (NotesNest autopsy 2026-07-16): both StudySync and NotesNest hit
  // "npm error enoent: no package.json" AFTER the fast-lane fallback — the full builder then
  // hand-wrote its own minimal package.json/tsconfig (drifted: a strict hand-made tsconfig cost
  // 6 wasted tsc-repair rounds on an unused variable). The self-heal above only ran when the
  // scaffold GUARD tripped, which a plain `npm install` never does. Now the FIRST tool call of a
  // run ensures the scaffold once (one readFile probe when already scaffolded — ~free).
  private scaffoldEnsured = false;
  private async ensureScaffoldOnce(): Promise<void> {
    if (this.scaffoldEnsured) return;
    this.scaffoldEnsured = true; // set first — a probe failure must not re-run this every call
    // Only when the FRAMEWORK is known (the real build dispatcher always passes it) — without it we
    // could seed the wrong starter into a workspace we know nothing about (and unit tests construct
    // bare dispatchers that must stay byte-for-byte unaffected).
    if (!this.framework) return;
    await this.ensureViteScaffold().catch(() => {});
  }

  /** Returns the canonical entry file to probe for an existing scaffold (framework-aware). */
  private frameworkEntryFile(): string {
    switch (this.framework) {
      case 'python-fastapi':
      case 'flask': return 'requirements.txt';
      case 'django': return 'manage.py';
      case 'static': return 'index.html';
      default: return 'package.json';
    }
  }

  // --- Background, serialized git checkpoints (OFF the build's critical path) ---------------------
  // A checkpoint is a History/restore convenience, NOT required for build correctness or the preview,
  // so it must never make the agent wait. Earlier each file write AWAITED `git add -A && git commit`;
  // that put git on the hot path and (pre-gitignore) cost ~45s/file → 18-min timeouts. Now writes
  // only SCHEDULE a checkpoint and return immediately. The scheduler is:
  //   • single-flight — at most ONE git op runs at a time (concurrent architect/frontend writes would
  //     otherwise race on git's index.lock and corrupt/fail the commit), and
  //   • coalescing — N rapid writes collapse into the next single commit (git add -A captures the
  //     whole tree anyway, so one commit still snapshots every file).
  // A flushCheckpoints() at build end awaits the last commit so the final state is captured before
  // the sandbox can be reaped.
  private _cpChain: Promise<void> = Promise.resolve();
  private _cpPending: string | null = null;

  /** Fire-and-forget: request a checkpoint with the latest message. NEVER blocks the caller. */
  private scheduleCheckpoint(message: string): void {
    if (!this.checkpointer) return;
    this._cpPending = message;
    this._cpChain = this._cpChain.then(() => this._runOneCheckpoint());
  }

  /** Runs one coalesced checkpoint: commits the LATEST pending message, then clears it. */
  private async _runOneCheckpoint(): Promise<void> {
    const message = this._cpPending;
    if (message === null) return; // already captured by an earlier link in the chain (coalesced)
    this._cpPending = null;
    try {
      const cp = await this.checkpointer!.checkpoint(message);
      if (cp) this.state?.addCheckpoint(cp);
    } catch {
      /* checkpointing never blocks or breaks a build */
    }
  }

  /** Await any in-flight/pending checkpoint — call once at build end so the final state is committed. */
  /**
   * Tell the sandbox a build is IN FLIGHT / finished, so the idle sweep never pauses a live one.
   *
   * Idle is measured from the last SANDBOX operation, and a long model call is not one — while the AI
   * is thinking nothing touches the sandbox, and that silence is indistinguishable from an abandoned
   * session. Without this, a short idle window pauses a sandbox mid-build: a broken app for a real
   * user, which no amount of saved compute is worth.
   *
   * Marked from the dispatcher because it is built once per build and already holds both the actuator
   * and the workspace. `endBuild` is called from the build's `finally`, so it runs however the build
   * ended; and the flag EXPIRES on its own besides, so a crash between the two can never leave a
   * sandbox alive for ever (which would cost more than the sweep saves).
   */
  markBuildActive(active: boolean): void {
    try { this.actuator.setBuildActive?.(this.workspaceId, active); } catch { /* never affects a build */ }
  }

  async flushCheckpoints(): Promise<void> {
    try { await this._cpChain; } catch { /* best-effort */ }
  }

  /**
   * Read the project's source files ONCE for the evaluate pass: a single listFiles
   * plus a single read per source file. Previously each evaluate dimension listed +
   * re-read the tree itself (~7 listings, each file read ~5×); sharing this snapshot
   * cuts that to one pass — much less sandbox I/O (faster + cheaper evaluate). Returns
   * the full file list too (for the name-only dimensions: hygiene, secret-leak).
   */
  /**
   * Detect the project's package manager from its ROOT lockfile (pnpm → yarn → bun → npm; undefined when
   * none present). Shared by the deploy-artifact + README generators so their commands match the project
   * instead of always assuming npm. Cheap best-effort probe; a read error just means "not present".
   */
  private async detectWorkspacePackageManager(): Promise<PackageManager | undefined> {
    const probes: Array<[string, PackageManager]> = [
      ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm'],
    ];
    for (const [file, pm] of probes) {
      try { await this.actuator.readFile(this.workspaceId, file); return pm; } catch { /* absent */ }
    }
    return undefined;
  }

  private async readEvalSnapshot(): Promise<{ files: string[]; sources: EvalSourceFile[] }> {
    const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|py|rb|java|php|go)$/i;
    const SKIP_DIR = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)/i;
    let files: string[] = [];
    const sources: EvalSourceFile[] = [];
    try {
      // Bound the listing (15s) so a stalled sandbox can't hang the gate before any read starts.
      files = await withTimeout(this.actuator.listFiles(this.workspaceId), 15_000, 'listFiles');
      const candidates = files.filter((p) => SOURCE.test(p) && !SKIP_DIR.test(p)).slice(0, 300);
      // PARALLEL + per-file timeout (audit P0-C): 300 sequential reads after the app is already
      // built was the #1 "fully-built app dies at the readiness gate" cause. Read in bounded batches,
      // each capped at 5s; a slow/unreadable file is dropped, never breaks evaluate.
      const reads = await mapWithConcurrency(candidates, 12, async (p) => {
        try {
          const content = await withTimeout(this.actuator.readFile(this.workspaceId, p), 5_000, 'readFile');
          return content.length > 200_000 ? null : { path: p, content };
        } catch {
          return null;
        }
      });
      for (const r of reads) if (r) sources.push(r);
    } catch {
      /* listing failed — degrade to an empty snapshot */
    }
    return { files, sources };
  }

  /**
   * Authenticity/completeness scan over the source snapshot (fake/incomplete code).
   * Synchronous over the shared snapshot — see readEvalSnapshot.
   */
  private collectAuthenticityIssues(sources: EvalSourceFile[]): AuthenticityIssue[] {
    const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|vue|svelte|go|rb|java|php)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: AuthenticityIssue[] = [];
    for (const { path, content } of sources) {
      if (!SOURCE_EXT.test(path) || SKIP.test(path)) continue;
      issues.push(...scanAuthenticity(path, content));
    }
    return issues;
  }

  /**
   * Best-effort accessibility (a11y) scan over the project's FRONT-END files.
   * Reads real markup via the actuator and runs scanAccessibility on each (only
   * .tsx/.jsx/.vue/.svelte/.html etc. carry a11y semantics). Wrapped so any
   * file-access error degrades gracefully to an empty issue list — the evaluate
   * tool still returns its other dimensions.
   */
  private collectAccessibilityIssues(sources: EvalSourceFile[]): AccessibilityIssue[] {
    const FRONTEND = /\.(tsx|jsx|vue|svelte|html?|astro)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: AccessibilityIssue[] = [];
    for (const { path, content } of sources) {
      if (!FRONTEND.test(path) || SKIP.test(path)) continue;
      issues.push(...scanAccessibility(path, content));
    }
    return issues;
  }

  /**
   * Best-effort observability scan over the project's BACKEND files (Cap-4 advisory
   * half). Aggregated at the project level — the backend is detected once, then the
   * health-endpoint / error-handler / request-logging gaps are checked across all its
   * files. A static front-end SPA (no server) correctly yields zero findings. Wrapped
   * so any read error degrades to an empty list — never breaks evaluate.
   */
  private collectObservabilityIssues(sources: EvalSourceFile[]): ReturnType<typeof scanObservability> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanObservability(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort graceful-shutdown scan over the project's BACKEND files. Detects a long-lived HTTP server
   * that binds a port but never handles SIGTERM/SIGINT to drain in-flight requests before exit — the defect
   * that drops requests on every Cloud Run / k8s redeploy. Serverless and framework-managed runtimes are not
   * flagged. Wrapped so any read error degrades to an empty list — never breaks evaluate.
   */
  private collectGracefulShutdownIssues(sources: EvalSourceFile[]): ReturnType<typeof scanGracefulShutdown> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanGracefulShutdown(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort security-headers scan over the project's BACKEND files. Detects an Express/Koa server that
   * sets no core HTTP security headers (neither helmet() nor manual CSP/X-Frame-Options/HSTS/nosniff),
   * leaving served pages open to clickjacking/MIME-sniffing/XSS. Fastify/Nest/Hono are not false-flagged.
   * Wrapped so any read error degrades to an empty list — never breaks evaluate.
   */
  private collectSecurityHeaderIssues(sources: EvalSourceFile[]): ReturnType<typeof scanSecurityHeaders> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanSecurityHeaders(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort security-configuration scan over the project's source files
   * (insecure TLS verification, wildcard CORS). Bounded and wrapped so any
   * listing/read failure degrades to no issues — never breaks evaluate.
   */
  private collectSriIssues(sources: EvalSourceFile[]): ReturnType<typeof scanProjectSri> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanProjectSri(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort CSP-meta pass: a STATIC SPA (no server) that loads a third-party
   * `<script src="https://…">` with no `<meta http-equiv="Content-Security-Policy">`.
   * Advisory (lowers score, never blocks). Any failure degrades to no issues.
   */
  private collectCspIssues(sources: EvalSourceFile[]): ReturnType<typeof scanProjectCsp> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanProjectCsp(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort comment-language pass: Hindi/Devanagari in CODE COMMENTS (a NavBharatAI
   * professional-English-comments standard violation). Hindi UI strings are never flagged.
   * Advisory (lowers score, never blocks). Any failure degrades to no issues.
   */
  private collectCommentLanguageIssues(sources: EvalSourceFile[]): ReturnType<typeof scanProjectCommentLanguage> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanProjectCommentLanguage(record);
    } catch {
      return [];
    }
  }

  /**
   * Best-effort upload-validation pass: a multer file-upload endpoint with no fileFilter / MIME check
   * (accepts ANY file type — a path to stored-XSS / malware hosting). Advisory (lowers score, never
   * blocks). Any failure degrades to no issues.
   */
  private collectUploadValidationIssues(sources: EvalSourceFile[]): ReturnType<typeof scanProjectUploadValidation> {
    try {
      const record: Record<string, string> = {};
      for (const { path, content } of sources) {
        if (typeof content === 'string') record[path] = content;
      }
      return scanProjectUploadValidation(record);
    } catch {
      return [];
    }
  }

  private collectSecurityConfigIssues(sources: EvalSourceFile[]): SecConfigIssue[] {
    const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: SecConfigIssue[] = [];
    for (const { path, content } of sources) {
      if (!CODE.test(path) || SKIP.test(path)) continue;
      issues.push(...scanSecurityConfig(path, content));
    }
    return issues;
  }

  /**
   * Best-effort scan for hardcoded localhost URLs across the project's source
   * files (env-var fallbacks are excluded by the analyser). Bounded and wrapped.
   */
  private collectHardcodedUrlIssues(sources: EvalSourceFile[]): HardcodedUrlIssue[] {
    const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: HardcodedUrlIssue[] = [];
    for (const { path, content } of sources) {
      if (!CODE.test(path) || SKIP.test(path)) continue;
      issues.push(...scanHardcodedUrls(path, content));
    }
    return issues;
  }

  /**
   * Deployment readiness (Section I #11 v2): a server bound to a hardcoded port
   * instead of process.env.PORT — managed hosts (Cloud Run/Heroku/Render) inject
   * PORT and route only to it, so a literal port means no traffic ever reaches the
   * app. Env-var fallbacks are excluded by the analyser. Bounded and wrapped.
   */
  private collectPortBindingIssues(sources: EvalSourceFile[]): PortBindingIssue[] {
    const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: PortBindingIssue[] = [];
    for (const { path, content } of sources) {
      if (!CODE.test(path) || SKIP.test(path)) continue;
      issues.push(...scanPortBinding(path, content));
    }
    return issues;
  }

  /**
   * Frontend runtime readiness (Section I #5): non-VITE_ import.meta.env references are
   * undefined in the browser. The caller skips this when vite config customises
   * envPrefix. Bounded and wrapped.
   */
  private collectViteEnvIssues(sources: EvalSourceFile[]): ViteEnvIssue[] {
    const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: ViteEnvIssue[] = [];
    for (const { path, content } of sources) {
      if (!CODE.test(path) || SKIP.test(path)) continue;
      issues.push(...scanViteEnvExposure(path, content));
    }
    return issues;
  }

  /**
   * Correctness (Section I #6): `forEach(async …)` does not await — the loop races and
   * rejections are swallowed. Bounded and wrapped.
   */
  private collectAsyncPatternIssues(sources: EvalSourceFile[]): AsyncPatternIssue[] {
    const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: AsyncPatternIssue[] = [];
    for (const { path, content } of sources) {
      if (!CODE.test(path) || SKIP.test(path)) continue;
      issues.push(...scanAsyncPatterns(path, content));
    }
    return issues;
  }

  /**
   * Best-effort scan for an error-boundary signal across the project's FRONT-END
   * files. Returns true as soon as one is found; any listing/read failure degrades
   * to false (which, combined with a real component count, surfaces the gap).
   */
  private collectHasErrorBoundary(sources: EvalSourceFile[]): boolean {
    const FRONTEND = /\.(tsx|jsx)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    for (const { path, content } of sources) {
      if (!FRONTEND.test(path) || SKIP.test(path)) continue;
      if (hasErrorBoundarySignal(content)) return true;
    }
    return false;
  }

  /**
   * Files that are NAMED like an error boundary but implement none. See looksLikeBrokenErrorBoundary:
   * without this, such a file produces "React app has no error boundary", which invites a repair pass to
   * ADD one beside the broken one — the duplicate-ErrorBoundary failure this repo has already paid for
   * twice.
   */
  private collectBrokenErrorBoundaries(sources: EvalSourceFile[]): string[] {
    const FRONTEND = /\.(tsx|jsx)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const out: string[] = [];
    for (const { path, content } of sources) {
      if (!FRONTEND.test(path) || SKIP.test(path)) continue;
      if (looksLikeBrokenErrorBoundary(path, content)) out.push(path);
    }
    return out;
  }

  /**
   * Best-effort trust/safety/compliance scan (Layer 77 "Bharosa") over the
   * project's source files. Combines file-local privacy defects (PII in logs,
   * sensitive values in browser storage, cookies without SameSite, personal data
   * over plain http) with two PROJECT-LEVEL rules that need whole-project context:
   *   • the app collects personal data but ships NO privacy policy, and
   *   • a third-party tracker runs with NO cookie-consent surface.
   * Wrapped so any file-access error degrades to a clean compliance report — the
   * evaluate tool still returns its other dimensions and an honest certificate.
   */
  private collectComplianceIssues(sources: EvalSourceFile[]): ComplianceIssue[] {
    const CODE = /\.(tsx?|jsx?|vue|svelte|astro|html?|mjs|cjs)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: ComplianceIssue[] = [];
    let collectsPii = false;
    let hasPrivacyPolicy = false;
    let hasTracker = false;
    let hasConsentUI = false;
    let trackerFile = '';
    for (const { path: p, content } of sources) {
      if (!CODE.test(p) || SKIP.test(p)) continue;
      issues.push(...scanCompliance(p, content));
      if (detectsPiiCollection(content)) collectsPii = true;
      if (!hasPrivacyPolicy && looksLikePrivacyPolicy(p, content)) hasPrivacyPolicy = true;
      if (detectsTracker(content)) { hasTracker = true; if (!trackerFile) trackerFile = p; }
      if (detectsConsentUI(content)) hasConsentUI = true;
    }
    // Project-level rule: collecting personal data with no privacy policy matters for a
    // PUBLIC launch (DPDP/GDPR) — but it is ADVISORY, not a readiness blocker.
    // ROOT-CAUSE FIX (2026-07-04, from a real blocked build): virtually every CRUD app has a
    // name/phone/email form, so as a `high` this rule hard-blocked a huge class of complete,
    // working apps (a Hospital-OPD demo the user explicitly asked for was scored 0/100). The
    // user never asked for a privacy-policy page; refusing READY for omitting an unrequested
    // page is a wrong verdict. Medium = surfaced honestly in the report, never a blocker.
    if (collectsPii && !hasPrivacyPolicy) {
      issues.push({ file: '(project)', line: 0, kind: 'missing-privacy-policy', severity: 'medium',
        snippet: 'App collects personal data (forms/inputs) but ships no privacy policy — add one before a public launch.' });
    }
    // Project-level rule: a tracker without a consent surface drops cookies
    // before consent — a GDPR/ePrivacy violation in the EU.
    if (hasTracker && !hasConsentUI) {
      issues.push({ file: trackerFile || '(project)', line: 0, kind: 'tracker-without-consent', severity: 'medium',
        snippet: 'Third-party tracker/analytics loads with no cookie-consent surface.' });
    }
    return issues;
  }

  /**
   * Best-effort dependency-consistency report over the project graph vs the root
   * package.json. Collects the EXTERNAL imports from the graph (specifiers that
   * do not resolve to a local file — i.e. not relative and not a known module),
   * reads package.json via the actuator, and runs analyzeDependencies. Wrapped so
   * any graph/file-access error degrades gracefully — the evaluate tool still
   * returns its architecture + security + authenticity result.
   */
  private async collectDependencyIssues(): Promise<DependencyIssue[]> {
    try {
      const graph = getWorkspaceMemory(this.workspaceId).graph();
      const files = new Set(graph.files);
      const external = new Set<string>();
      for (const [file, specs] of Object.entries(graph.imports)) {
        for (const spec of specs) {
          // External = not a resolvable local import. Relative specs resolve via
          // resolveLocalImport; everything else (bare/scoped/alias) is external
          // and analyzeDependencies decides if it is a real npm package.
          if (spec.startsWith('.')) {
            if (resolveLocalImport(file, spec, files)) continue;
            // An unresolved relative import is a local defect (architecture's job),
            // not an npm dependency — skip it here.
            continue;
          }
          external.add(spec);
        }
      }
      let pkg: string | null = null;
      try {
        pkg = await this.actuator.readFile(this.workspaceId, 'package.json');
      } catch {
        pkg = null; // no manifest reachable — analyzeDependencies returns []
      }
      return analyzeDependencies([...external], pkg);
    } catch {
      // Any failure: return no issues so evaluate's other sections stand.
      return [];
    }
  }

  /**
   * Best-effort environment-variable completeness report over the project's source
   * vs its `.env.example`. Collects every `process.env.X` / `import.meta.env.X`
   * reference from real source, reads `.env.example` (falling back to `.env`), and
   * runs analyzeEnvVars. Wrapped so any file-access error degrades gracefully — the
   * evaluate tool still returns its architecture + security + authenticity +
   * dependency result. A missing/undocumented env var is the classic "your app won't
   * run for the user" defect: the code needs it but the user is never told to set it.
   */
  /**
   * Extract every `process.env.X` / `import.meta.env.X` reference from the source
   * snapshot. Synchronous over the shared snapshot. Used by the env-var evaluate
   * pass and the `generate_env_example` tool.
   */
  private collectEnvRefs(sources: EvalSourceFile[]): string[] {
    const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|vue|svelte|go|rb|java|php)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const refs = new Set<string>();
    for (const { path, content } of sources) {
      if (!SOURCE_EXT.test(path) || SKIP.test(path)) continue;
      for (const name of extractEnvRefs(path, content)) refs.add(name);
    }
    return [...refs];
  }

  private async collectEnvVarIssues(sources: EvalSourceFile[]): Promise<EnvVarIssue[]> {
    try {
      const refs = new Set<string>(this.collectEnvRefs(sources));
      let envExample: string | null = null;
      try {
        envExample = await this.actuator.readFile(this.workspaceId, '.env.example');
      } catch {
        try {
          envExample = await this.actuator.readFile(this.workspaceId, '.env');
        } catch {
          envExample = null; // no env file reachable — every referenced var is undocumented
        }
      }
      return analyzeEnvVars([...refs], parseEnvKeys(envExample));
    } catch {
      // Any failure: return no issues so evaluate's other sections stand.
      return [];
    }
  }

  /**
   * Every file this build has read, with its last-seen content — the basis for the repeated-read
   * nudge. Per dispatcher, so it lives exactly as long as one build and never leaks across users.
   * Content is held rather than hashed: the bodies are already in memory on the way past, and an exact
   * comparison cannot produce a false "unchanged" the way a truncated hash could.
   */
  private _readLedger = new Map<string, { count: number; content: string }>();

  /** Read counts for the build report. Exposed so the route can NAME the waste, not only nudge it. */
  readLedgerCounts(): Map<string, number> {
    return new Map([...this._readLedger].map(([p, r]) => [p, r.count]));
  }

  async dispatch(call: ToolUse, agent: AgentRole = 'architect'): Promise<ToolResult> {
    // Secret redaction (R1.1, roadmap §3.2): tool_call input and tool_result summaries are
    // streamed to the user's screen, so a command/output that inlines an API key, a .env value
    // or a connection-string password must be masked BEFORE it is shown. We redact ONLY the
    // user-visible event surface (input + summary + error message) — the model-facing `content`
    // is left intact so edit_file's exact-string matching never breaks on a redacted value.
    this.events?.emit({
      type: 'tool_call',
      agent,
      tool: call.name as ToolName,
      input: redactDeep(call.input),
      callId: call.id,
      ts: Date.now(),
    });
    try {
      // Browser tools return a screenshot image alongside their text; everything else is text.
      const visual = call.name === 'screenshot' || call.name === 'browser_action' || call.name === 'find_ui_element'
        ? await this.runVisual(call)
        : null;
      const content = visual ? visual.content : await this.run(call, agent);
      this.events?.emit({
        type: 'tool_result',
        agent,
        callId: call.id,
        ok: true,
        summary: redactSecrets(summarize(content)),
        ts: Date.now(),
      });
      return { tool_use_id: call.id, content, is_error: false, image: visual?.image };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events?.emit({
        type: 'tool_result',
        agent,
        callId: call.id,
        ok: false,
        summary: redactSecrets(message),
        ts: Date.now(),
      });
      return { tool_use_id: call.id, content: `Error: ${message}`, is_error: true };
    }
  }

  /**
   * Browser tools (screenshot / browser_action) — return a text summary PLUS the screenshot so
   * the model can SEE the page. Requires a real sandbox with a browser; degrades to an honest
   * "not available" message on Local/Docker actuators (or any actuator that lacks the method).
   */
  private async runVisual(call: ToolUse): Promise<{ content: string; image?: { base64: string; mimeType: string } }> {
    const input = call.input;
    if (call.name === 'find_ui_element') {
      if (!this.actuator.scanUiElements) {
        return { content: 'find_ui_element requires a real cloud sandbox (set E2B_API_KEY) — not available here.' };
      }
      const url = reqStr(input, 'url');
      const query = reqStr(input, 'query');
      const target = classifyBrowseTarget(url);
      if (target.kind === 'blocked') return { content: `Cannot open that address. ${target.reason}` };
      const scan = await this.actuator.scanUiElements(this.workspaceId, url);
      // A FAILED scan and an EMPTY page are different facts, and conflating them would manufacture a
      // false "it is not there" — the opposite of what this tool exists to guarantee.
      if (!scan.scanned) {
        return { content: `Could not scan ${url} — the headless browser was unavailable or the page did not load. This is NOT evidence that the element is absent; say so honestly and try the preview URL again, rather than concluding anything about the element.` };
      }
      return { content: formatUiFindings(scan.elements as ScannedElement[], query) };
    }
    if (call.name === 'screenshot') {
      if (!this.actuator.screenshot) {
        return { content: 'Screenshots require a real cloud sandbox (set E2B_API_KEY) — not available here.' };
      }
      const url = reqStr(input, 'url');
      // The sandbox browser may reach its own dev server or the public web — never an internal
      // infrastructure address. See lib/browseTarget.ts for why this guard exists.
      const target = classifyBrowseTarget(url);
      if (target.kind === 'blocked') return { content: `Cannot open that address. ${target.reason}` };
      const width = typeof input.width === 'number' ? input.width : undefined;
      const height = typeof input.height === 'number' ? input.height : undefined;
      const viewport = width && height ? { width, height } : undefined;
      const shot = await this.actuator.screenshot(this.workspaceId, url, viewport);
      return {
        content: `Screenshot of ${url} captured (${viewport ? `${viewport.width}×${viewport.height}` : '1280×720'}). The image is attached — inspect it for layout/visual issues.`,
        image: { base64: shot.base64, mimeType: shot.mimeType },
      };
    }
    // browser_action
    if (!this.actuator.browserAction) {
      return { content: 'Browser interaction requires a real cloud sandbox (set E2B_API_KEY) — not available here.' };
    }
    const action = reqStr(input, 'action');
    if (!BROWSER_ACTIONS.includes(action as BrowserActionName)) {
      return { content: `browser_action: unknown action "${action}". Valid: ${BROWSER_ACTIONS.join(', ')}.` };
    }
    const navUrl = optStr(input, 'url');
    if (navUrl) {
      const target = classifyBrowseTarget(navUrl);
      if (target.kind === 'blocked') return { content: `Cannot open that address. ${target.reason}` };
    }
    const dir = input.direction;
    const direction: 'up' | 'down' | undefined = dir === 'up' ? 'up' : dir === 'down' ? 'down' : undefined;
    const args = {
      selector: optStr(input, 'selector'),
      text: optStr(input, 'text'),
      url: optStr(input, 'url'),
      direction,
    };
    const res = await this.actuator.browserAction(this.workspaceId, action as BrowserActionName, args);
    return {
      content: `Browser ${action}${args.selector ? ` on "${args.selector}"` : ''}${args.url ? ` → ${args.url}` : ''}: ${res.result}. Screenshot attached.`,
      image: res.screenshot ? { base64: res.screenshot, mimeType: 'image/png' } : undefined,
    };
  }

  /**
   * Refuse CREATING a parallel copy of a module that already exists under a different convention root
   * (app/ vs src/ vs src/app/) — the TaskForge duplicate-tree origin. Returns a refusal message, or null
   * when the write is fine. Uses the in-memory graph (no I/O); a stale/incomplete graph only ever misses
   * a duplicate (safe), never wrongly refuses. Kill switch: AGENTV3_DUP_MODULE_GUARD=off.
   */
  private duplicateModuleRefusal(path: string): string | null {
    if (envKillSwitch('AGENTV3_DUP_MODULE_GUARD')) return null;
    let known: string[] = [];
    try { known = getWorkspaceMemory(this.workspaceId).graph().files; } catch { return null; }
    const dup = duplicateModuleTarget(path, known);
    if (!dup) return null;
    try {
      getWorkspaceMemory(this.workspaceId).recordAudit(`[BLOCKED-DUPLICATE-MODULE] refused parallel copy ${path} (module already at ${dup})`);
    } catch { /* audit best-effort */ }
    return `❌ A copy of this module already exists at "${dup}". Do NOT create a second copy at "${path}" ` +
      `under a different directory convention (app/ vs src/ vs src/app/) — two copies of the same component ` +
      `drift apart and break the build. EDIT the existing file at "${dup}" in place, or import from it. Use ` +
      `ONE directory convention for the whole app.`;
  }

  /**
   * WRITE-TIME Rules-of-Hooks guard (M1-S1.1, prevent-not-heal): after a React file is written/edited,
   * return a steering note for any Rules-of-Hooks violation so the model fixes the runtime-crashing hook
   * IN THE SAME TURN — before the build ships it (the post-build readiness gate stays the backstop). The
   * deterministic AST analysis is fast and gated to React source internally; best-effort ('' on anything),
   * never blocks a write. Kill switch AGENTV3_HOOKS_WRITE_GUARD=off.
   */
  /**
   * WRITE-TIME duplicate-import guard (build-report autopsy 2026-08-01, buildId 1047276c): a weak model
   * re-imports a symbol already imported (e.g. main.tsx default-imports ErrorBoundary and the model adds a
   * named import of the same) — esbuild parses it clean, so nothing catches it, but the in-browser preview
   * rejects it with "Duplicate declaration" and the user sees a BROKEN preview. Remove the fully-redundant
   * duplicate here so it is never born. Pure + safe (only drops a binding that already exists); emits an
   * honest narration when it fires. Source files only. Kill switch AGENTV3_DUP_IMPORT_GUARD=off.
   */
  private dedupeImportsForSource(path: string, content: string, agent: AgentRole): string {
    if (envKillSwitch('AGENTV3_DUP_IMPORT_GUARD')) return content;
    if (!/\.(tsx?|jsx?|mjs|cjs)$/i.test(path || '')) return content;
    try {
      const { content: next, removed } = dedupeDuplicateImports(content);
      if (removed.length > 0) {
        this.narrate('fix.duplicateImports', { count: removed.length, file: path }, agent);
        try { getWorkspaceMemory(this.workspaceId).recordAudit(`[DUP-IMPORT] removed ${removed.length} duplicate import(s) in ${path}: ${removed.join('; ')}`); } catch { /* audit best-effort */ }
      }
      return next;
    } catch { return content; }
  }

  private async hookWriteNote(files: Record<string, string>): Promise<string> {
    if (envKillSwitch('AGENTV3_HOOKS_WRITE_GUARD')) return '';
    if (!files || Object.keys(files).length === 0) return '';
    try {
      const report = await analyzeHooksRules(files);
      return hookViolationWriteNote(report);
    } catch {
      return '';
    }
  }

  /**
   * Force known-breaking dep versions (Prisma → ^6) to their known-good major when the agent WRITES a
   * package.json — the sibling choke point to pinKnownDepsInInstallCommand (#1526), which only catches
   * explicit install commands. Path-gated (fast no-op for every non-package.json write), best-effort,
   * and emits an honest narration when it corrects a version. LearnLoop autopsy 2026-07-18. Kill switch
   * AGENTV3_PKG_PIN_GUARD=off.
   */
  private pinPackageJsonContent(path: string, content: string): string {
    if (envKillSwitch('AGENTV3_PKG_PIN_GUARD')) return content;
    if (!/(^|\/)package\.json$/.test(path)) return content;
    try {
      let out = content;
      const pinned = pinKnownDepsInPackageJson(out);
      if (pinned.changed.length > 0) {
        out = pinned.content;
        try {
          getWorkspaceMemory(this.workspaceId).recordAudit(`[PKG-PIN] pinned breaking deps in ${path}: ${pinned.changed.join('; ')}`);
        } catch { /* audit best-effort */ }
        this.narrate('fix.pinnedDeps', { changed: pinned.changed.join('; ') });
      }
      // FRAMEWORK CORE-DEPS GUARD (CargoPilot autopsy 2026-07-19): a written package.json must never
      // DROP the framework's own runtime deps (next/react/vite/…). If it does, a later `npm install`
      // prunes the framework binary from node_modules (`next: not found`) and the dev server dies.
      // Re-add any fully-absent core dep so the binary can never vanish. Add-only, never downgrades.
      const core = ensureFrameworkCoreDeps(out, this.framework);
      if (core.added.length > 0) {
        out = core.content;
        try {
          getWorkspaceMemory(this.workspaceId).recordAudit(`[PKG-CORE] restored framework core deps in ${path}: ${core.added.join('; ')}`);
        } catch { /* audit best-effort */ }
        this.narrate('fix.coreDeps', { added: core.added.join('; ') });
      }
      return out;
    } catch {
      return content; // never let a pin failure block a write
    }
  }

  private async run(call: ToolUse, agent: AgentRole): Promise<string> {
    // Pre-flight: the very first tool touch of a run guarantees the framework scaffold exists in
    // the sandbox (non-destructive; ~one readFile probe when already scaffolded). Kills the whole
    // "npm enoent package.json → builder hand-writes a drifted scaffold" class on fallback builds.
    await this.ensureScaffoldOnce();
    const input = call.input;
    switch (call.name) {
      case 'read_file': {
        const reqPath = reqStr(input, 'path');
        let full: string;
        try {
          full = await this.actuator.readFile(this.workspaceId, reqPath);
        } catch (err) {
          // PATH-MISS RECOVERY (build-report autopsy 2026-08-01): a bare "does not exist" made the builder
          // loop 12 times guessing the same wrong root (created src/components/ui/X.tsx, read
          // src/components/X.tsx). Look up the real file by basename across everything the workspace already
          // knows (cheap, in-memory), then across the on-disk list, and hand back the ACTUAL path(s). Any path
          // drift — a missing folder segment, a case difference, a .ts↔.tsx mixup — self-corrects on the first
          // miss instead of stalling. Honest: a suggestion is only ever a path that genuinely exists.
          const base = (err instanceof Error ? err.message : String(err)) || `read_file: ${reqPath} does not exist.`;
          let known: string[] = [];
          try { known = getWorkspaceMemory(this.workspaceId).knownFilePaths(); } catch { /* memory best-effort */ }
          let hint = pathMissHint(reqPath, known);
          if (!hint) {
            // In-memory index missed it — fall back to the actuator's authoritative on-disk list (a miss is
            // already the stuck/error path, so one listFiles to unstick the agent is worth the latency).
            try { hint = pathMissHint(reqPath, await this.actuator.listFiles(this.workspaceId)); } catch { /* list best-effort */ }
          }
          // Re-throw so the miss stays an honest is_error result (the outer catch formats it), but with the
          // real path(s) appended — the agent gets to correct itself on the FIRST miss instead of looping.
          throw new Error(`${base}${hint}`.trim());
        }
        // RANGED READ (Fix 36b — HMS report 2026-07-07): a big file's tool result gets its middle
        // trimmed by the transcript ceiling, and a plain re-read returns the SAME trimmed view — the
        // model concluded the FILE was "truncated at exactly N lines" and destructively 'repaired' a
        // healthy file. start_line/end_line make any slice of a large file genuinely readable.
        const sl = typeof (input as Record<string, unknown>).start_line === 'number' ? Math.max(1, Math.floor((input as Record<string, unknown>).start_line as number)) : null;
        const el = typeof (input as Record<string, unknown>).end_line === 'number' ? Math.max(1, Math.floor((input as Record<string, unknown>).end_line as number)) : null;
        // ⚠️ THE SAME FILE, AGAIN, UNCHANGED — measured at 84% of all reads in a real build (see
        // repeatedReads.ts for the numbers, and for why this is a NUDGE and not a cache: a cache saves
        // a 200ms round-trip and none of what actually costs, because the turn is already spent and the
        // body is already on its way into the context either way).
        //
        // The content is ALWAYS returned in full. Suppressing it would save real tokens and is exactly
        // the wrong trade — if the model's context has been trimmed, "you already have this" leaves it
        // unable to proceed at all.
        const prior = this._readLedger.get(reqPath);
        const readCount = (prior?.count ?? 0) + 1;
        const unchanged = prior !== undefined && prior.content === full;
        this._readLedger.set(reqPath, { count: readCount, content: full });
        const notice = repeatedReadNotice(reqPath, readCount, unchanged);

        if (sl === null && el === null) return notice ? `${notice}${full}` : full;
        const lines = full.split('\n');
        const from = (sl ?? 1) - 1;
        const to = el ?? lines.length;
        const slice = lines.slice(from, to).join('\n');
        return `${notice}[lines ${from + 1}-${Math.min(to, lines.length)} of ${lines.length} — the file is complete on disk]\n${slice}`;
      }

      case 'write_file': {
        let path = reqStr(input, 'path');
        // NEXT.JS MIDDLEWARE LOCATION FIX (CargoPilot autopsy 2026-07-19): Next.js runs middleware ONLY
        // from the project root (`middleware.ts`) or `src/middleware.ts` — a `app/middleware.*` is
        // SILENTLY ignored, so the route guards / auth it holds never run and every guarded route is
        // unprotected while the app looks fine. Relocate the misplaced file to where Next actually reads
        // it. Deterministic (Next semantics are unambiguous — app/middleware is ALWAYS wrong). Kill
        // switch AGENTV3_NEXT_MW_FIX=off.
        if (process.env.AGENTV3_NEXT_MW_FIX !== 'off' && (this.framework === 'nextjs' || this.framework === 'next')) {
          const corrected = nextMiddlewareCorrectPath(path);
          if (corrected && corrected !== path) {
            this.narrate('fix.nextMiddlewareMoved', { from: path, to: corrected }, agent);
            try { getWorkspaceMemory(this.workspaceId).recordAudit(`[NEXT-MW] relocated misplaced middleware ${path} → ${corrected}`); } catch { /* audit best-effort */ }
            path = corrected;
          }
        }
        // Deterministic backstop: a Vite config must always allow the E2B preview host, or the
        // preview shows "Blocked request … is not allowed" instead of the app. No-op for non-configs
        // or a config that already sets allowedHosts. (Mirrors ScaffoldGuard: prompts are advisory.)
        this.assertWritable(path); // C2 — checked AFTER any relocation, so the REAL destination is judged
        let content = guardConfigContent(path, this.applyPostgresProviderLock(path, reqStr(input, 'content')));
        // PACKAGE.JSON DEP PIN (LearnLoop autopsy 2026-07-18): force known-breaking deps (Prisma → ^6)
        // to their known-good major IN the written package.json, so a later plain `npm install` (which
        // carries no package tokens, so pinKnownDepsInInstallCommand can't fire) never pulls a breaking
        // version. This is the sibling choke point to the install-command pin (#1526).
        content = this.pinPackageJsonContent(path, content);
        content = this.dedupeImportsForSource(path, content, agent);
        let kind: 'create' | 'modify' = 'create';
        let existingContent = '';
        try {
          existingContent = await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        // Self-destruct guard (StudySync autopsy 2026-07-16): refuse to BLANK a populated source file.
        // Overwriting src/App.tsx with "" deletes its code and breaks every importer — the same
        // catastrophe as `rm`, but via the tool path (bypasses the shell guard). Checked BEFORE writing
        // so the file survives; a legitimate full-content rewrite (non-empty) is never blocked.
        if (isDestructiveEmptyOverwrite(path, existingContent, content)) {
          const blockMsg = emptyOverwriteMessage(path);
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-DESTRUCTIVE] refused empty-overwrite of source file: ${path}`,
          );
          return blockMsg;
        }
        // THE USER'S OWN KEYS ARE NOT OURS TO DELETE (admin build transcript 2026-08-12). The platform
        // writes .env from the user's saved secrets; twenty-five seconds later the builder "fixed" the
        // hardcoded secrets it found there, and the app's database and payments were dead — reported as
        // "your source files are untouched". A prompt asking the model not to would be one more
        // instruction to forget; this makes the write impossible.
        const erasedKeys = wouldEraseUserSecrets(path, existingContent, content);
        if (erasedKeys.length > 0) {
          const blockMsg = eraseUserSecretsMessage(path, erasedKeys);
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-DESTRUCTIVE] refused to erase ${erasedKeys.length} user secret(s) in ${path}`,
          );
          return blockMsg;
        }
        // DUPLICATE-MODULE guard (TaskForge autopsy 2026-07-18): the ORIGIN of the 2-hour failure was the
        // builder CREATING the same component under two convention roots (app/ AND src/), whose interfaces
        // then drift and break the build. Refuse to create a parallel copy of a module that already exists
        // under a different root — the duplicate is never born, so it can never drift. Only on a fresh
        // create (an edit-in-place is always allowed); kill switch AGENTV3_DUP_MODULE_GUARD=off.
        if (kind === 'create') {
          const dup = this.duplicateModuleRefusal(path);
          if (dup) return dup;
        }
        // Parse guard: refuse a write that would break a clean file (duplicate declaration / broken JSX).
        const writeParseReject = await this.parseGuardRejection(path, existingContent, content);
        if (writeParseReject) return writeParseReject;
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.onFileWrite?.(path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        // E7 — stream the written content to the UI Diff tab as a live diff event (create → additions
        // only; wholesale rewrite → removed+added), bounded so a large file can't produce a huge event.
        // Previously only edit_file emitted a diff, so the Diff tab stayed empty through a fresh build.
        this.events?.emit({
          type: 'diff', agent,
          diff: { path, patch: boundedWholeFileDiff(kind === 'modify' ? existingContent : '', content) },
          ts: Date.now(),
        });
        const mem = getWorkspaceMemory(this.workspaceId);
        mem.indexFile(path, content);
        // Level 3: update embedding index for semantic search (best-effort, async, non-blocking).
        getEmbeddingStore(this.workspaceId).addFile(path, content).catch(() => {});
        this.scheduleCheckpoint(`${kind} ${path}`);
        // Level 4: post-write static review — flag missing imports, typos, stub files.
        const review = reviewEdit(path, content);
        const reviewNote = formatReviewResult(review, path);
        // Level 5: impact cascade — warn the agent which files import the edited file.
        const { direct: impactFiles } = mem.impactRadius(path);
        const cascadeNote =
          impactFiles.length > 0
            ? `\nIMPACT: ${impactFiles.length} file(s) import ${path}: ${impactFiles.slice(0, 5).join(', ')}${impactFiles.length > 5 ? '…' : ''}. Verify they still compile.`
            : '';
        // Level 6: test file hint — if a test file exists, suggest running it.
        const testHint = testFileHint(path);
        // WRITE-TIME IMPORT CHECK (admin report 2026-08-11): a generated TEST importing a member its
        // component does not export failed a user's APK build on GitHub. Detection and a deterministic
        // fixer both already existed but ran at the END, by which time "the agent's intent was
        // elsewhere and these files are never revisited". Told here, it is fixed in the same turn.
        // Never blocks the write; any failure inside it yields no note at all.
        const importNote = await importCheckNote(path, content, {
          readFile: (p: string) => this.actuator.readFile(this.workspaceId, p),
        });
        // M1-S1.1 (prevent-not-heal): write-time Rules-of-Hooks guard — steer the model to fix a
        // runtime-crashing hook THIS turn, before the build ships it (readiness gate stays the backstop).
        const hooksNote = await this.hookWriteNote({ [path]: content });
        if (kind === 'modify') {
          // write_file replaced an EXISTING file wholesale. For anything except a
          // deliberate full-rewrite, this risks silently dropping unrelated code.
          // Return the CURRENT (pre-overwrite) content so the agent can immediately
          // issue a precise edit_file call instead — no extra read_file round-trip.
          // The write already happened above; we can't undo it, but we make the next
          // step as cheap as possible and strongly discourage this pattern.
          const preview =
            existingContent.length <= 2000
              ? existingContent
              : existingContent.slice(0, 2000) + '\n…(truncated — use read_file for full content)';
          // Forensic edit-discipline verdict: a rewrite materially smaller than the file it replaced
          // is the classic "model regenerated from memory and dropped code" signature — say so honestly.
          const risk = assessFullRewrite(existingContent, content);
          return (
            `Updated ${path} (${content.length} bytes).\n` +
            `${risk.message} The file content BEFORE this overwrite was:\n\`\`\`\n${preview}\n\`\`\`` +
            reviewNote + cascadeNote + testHint + hooksNote + importNote
          );
        }
        return `Created ${path} (${content.length} bytes).` + reviewNote + cascadeNote + testHint + hooksNote + importNote;
      }

      case 'write_files_batch': {
        const rawFiles = (input as Record<string, unknown>)?.files;
        if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
          return 'write_files_batch: files array is empty or missing.';
        }
        const parsedFiles: { path: string; content: string }[] = rawFiles.map((f: unknown) => {
          if (typeof f !== 'object' || f === null) throw new Error('Each file entry must be an object.');
          const obj = f as Record<string, unknown>;
          const p = reqStr(obj, 'path');
          this.assertWritable(p); // C2 — one protected entry fails the whole batch, never half-applies
          // Same Vite-preview-host backstop as write_file, applied per batched file.
          return { path: p, content: guardConfigContent(p, this.applyPostgresProviderLock(p, reqStr(obj, 'content'))) };
        });
        // Collapse duplicate paths within one batch to their LAST entry (last write wins — the same
        // final state the old serial loop produced), so the parallel writers below never race two
        // writes on the same path (a race would leave nondeterministic content on disk).
        const dedupedByPath = new Map<string, { path: string; content: string }>();
        for (const f of parsedFiles) dedupedByPath.set(f.path, f);
        // Sort by import dependencies: files that import others go after their deps. Purely for a
        // readable, deterministic result summary — writes are order-independent across distinct paths.
        const sorted = topoSortBatch([...dedupedByPath.values()]);
        const batchMem = getWorkspaceMemory(this.workspaceId);
        // DUPLICATE-MODULE guard (batch parity, TaskForge autopsy 2026-07-18): drop any batched file that
        // would create a SECOND copy of a module already present — in the workspace OR earlier in THIS
        // batch — under a different convention root (app/ vs src/ vs src/app/). The parallel copy is never
        // written, so it can never drift and break the build. An edit of an existing exact path is always
        // kept. Kill switch AGENTV3_DUP_MODULE_GUARD=off (parity with write_file).
        const dupGuardOn = process.env.AGENTV3_DUP_MODULE_GUARD !== 'off';
        const dupSkipped: string[] = [];
        let toWrite = sorted;
        if (dupGuardOn) {
          const known = new Set<string>();
          try { for (const f of batchMem.graph().files) known.add(f); } catch { /* best-effort */ }
          toWrite = sorted.filter((file) => {
            if (known.has(file.path)) return true; // modify of an existing exact path — always allowed
            const dup = duplicateModuleTarget(file.path, known);
            if (dup) { dupSkipped.push(`${file.path} (already at ${dup})`); return false; }
            known.add(file.path); // this new module now exists for the rest of the batch
            return true;
          });
          for (const s of dupSkipped) {
            try { batchMem.recordAudit(`[BLOCKED-DUPLICATE-MODULE] skipped parallel copy in batch: ${s}`); } catch { /* best-effort */ }
          }
        }
        // Write every file in bounded parallel (mirrors fastWrite's mapWithConcurrency(files, 6, …)).
        // A serial loop cost 2 remote round-trips PER file (create-vs-modify probe + write) — ~6-12s
        // for a 20-file batch, the single biggest "why is it so slow" in a large build. Distinct paths
        // are order-independent (final sandbox state is identical regardless of write order) and each
        // file's create-vs-modify verdict depends only on whether it pre-existed the batch, not on its
        // siblings — so bounded concurrency is safe. mapWithConcurrency is order-preserving, so the
        // summary arrays below stay in topo order. JS is single-threaded, so the in-worker hooks never
        // interleave mid-statement.
        const perFile = await mapWithConcurrency(toWrite, 6, async (file) => {
          // Detect create-vs-modify like write_file does, so the recorded change + the UI diff are
          // honest and an accidental wholesale overwrite of an existing file is not silently a "create".
          let kind: 'create' | 'modify' = 'create';
          let priorContent = '';
          try { priorContent = await this.actuator.readFile(this.workspaceId, file.path); kind = 'modify'; } catch { kind = 'create'; }
          // Self-destruct guard (parity with write_file): refuse to BLANK a populated source file — the
          // same catastrophe as deleting it, via the tool path. Skip this one file's write; the rest of
          // the batch proceeds. A legitimate full-content rewrite is never blocked (only empty content is).
          if (isDestructiveEmptyOverwrite(file.path, priorContent, file.content)) {
            getWorkspaceMemory(this.workspaceId).recordAudit(
              `[BLOCKED-DESTRUCTIVE] refused empty-overwrite of source file (batch): ${file.path}`,
            );
            return { path: file.path, kind, shrink: false, blocked: true };
          }
          // Secrets guard PARITY — a guard that only covers write_file is one tool call from bypassed.
          const batchErased = wouldEraseUserSecrets(file.path, priorContent, file.content);
          if (batchErased.length > 0) {
            getWorkspaceMemory(this.workspaceId).recordAudit(
              `[BLOCKED-DESTRUCTIVE] refused to erase ${batchErased.length} user secret(s) in ${file.path} (batch)`,
            );
            return { path: file.path, kind, shrink: false, blocked: true };
          }
          // DUPLICATE-MODULE guard PARITY (admin 2026-08-02: "duplicate file bane hi na"). write_file has
          // refused a parallel copy under a second convention root (app/ vs src/) since the TaskForge
          // autopsy — but write_files_batch never did, so the whole guard was one tool call away from being
          // bypassed and a batch could quietly create the drifting second copy. Same decision, same refusal:
          // block just this file and let the rest of the batch through.
          if (kind === 'create' && this.duplicateModuleRefusal(file.path)) {
            return { path: file.path, kind, shrink: false, blocked: true };
          }
          // Forensic edit-discipline (parity with write_file): a batched wholesale rewrite that is
          // materially smaller than the file it replaced likely DROPPED code — flag it honestly below.
          const shrink = kind === 'modify' && assessFullRewrite(priorContent, file.content).level === 'shrink';
          // PACKAGE.JSON DEP PIN (parity with write_file, LearnLoop autopsy 2026-07-18): force known-
          // breaking deps to their known-good major so a later plain `npm install` can't pull a breaker.
          const writtenContent = this.dedupeImportsForSource(file.path, this.pinPackageJsonContent(file.path, file.content), agent);
          await this.actuator.writeFile(this.workspaceId, file.path, writtenContent);
          // Consistency with write_file: run the per-write hook (security scan / durable tracking) —
          // batch-written files were previously skipping it entirely. Best-effort + '?.'-guarded.
          this.onFileWrite?.(file.path, writtenContent);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          // E7 — stream each batched write to the Diff tab too (reusing the probe content we already
          // read for the create-vs-modify verdict, so no extra round-trip). Bounded per file.
          this.events?.emit({
            type: 'diff', agent,
            diff: { path: file.path, patch: boundedWholeFileDiff(kind === 'modify' ? priorContent : '', file.content) },
            ts: Date.now(),
          });
          batchMem.indexFile(file.path, file.content);
          getEmbeddingStore(this.workspaceId).addFile(file.path, file.content).catch(() => {});
          return { path: file.path, kind, shrink };
        });
        const blocked: string[] = perFile.filter((r) => (r as { blocked?: boolean }).blocked).map((r) => r.path); // empty-overwrite refusals — NOT written
        const written: string[] = perFile.filter((r) => !(r as { blocked?: boolean }).blocked).map((r) => r.path);
        const overwritten: string[] = perFile.filter((r) => r.kind === 'modify' && !(r as { blocked?: boolean }).blocked).map((r) => r.path); // existing files this batch REPLACED wholesale
        const shrunk: string[] = perFile.filter((r) => r.shrink).map((r) => r.path); // rewrites that likely DROPPED code
        // Checkpoint ONCE for the whole batch — NOT once per file. A git commit per file made an
        // N-file batch cost N commits (with `git add -A` each ~45s pre-gitignore), which is exactly
        // what pushed builds past the wall-clock cap. One commit per batch is both correct (the batch
        // is one logical change) and fast.
        this.scheduleCheckpoint(`write ${written.length} file(s): ${written.slice(0, 5).join(', ')}${written.length > 5 ? '…' : ''}`);
        const overwriteWarning = overwritten.length
          ? `\n⚠️  FULL-REWRITE WARNING: ${overwritten.length} of these already existed and were REPLACED wholesale (${overwritten.slice(0, 8).join(', ')}${overwritten.length > 8 ? '…' : ''}). Unless a full rewrite was intended, use edit_file (old_string → new_string) for surgical changes so unrelated code isn't dropped.`
          : '';
        // Escalate the honest verdict for files that shrank sharply — the classic "regenerated from memory
        // and dropped code" signature (parity with the single-file write_file path).
        const contentLossWarning = shrunk.length
          ? `\n⚠️  LIKELY CONTENT LOSS: ${shrunk.length} of these rewrites came back much smaller than the file they replaced (${shrunk.slice(0, 8).join(', ')}${shrunk.length > 8 ? '…' : ''}) — a wholesale write commonly drops code the model forgot. Re-read those files and restore anything you did not intend to delete.`
          : '';
        // Self-destruct guard: any file whose write was refused for being an empty-overwrite of populated source.
        const blockedWarning = blocked.length
          ? `\n[GOVERNANCE BLOCKED] ${blocked.length} file(s) were NOT written — refused to blank populated source (${blocked.slice(0, 8).join(', ')}${blocked.length > 8 ? '…' : ''}). Write their FULL new content, or leave them untouched.`
          : '';
        const dupWarning = dupSkipped.length
          ? `\n[DUPLICATE MODULE BLOCKED] ${dupSkipped.length} file(s) were NOT written — they would create a SECOND copy of a module that already exists under a different directory convention (${dupSkipped.slice(0, 8).join('; ')}${dupSkipped.length > 8 ? '…' : ''}). Two copies drift and break the build — EDIT the existing file(s) in place. Use ONE directory convention for the whole app.`
          : '';
        // M1-S1.2 (prevent-not-heal): write-time Rules-of-Hooks guard on the batch's written files —
        // the same steering as write_file/edit_file, extended to the multi-file create path so a new
        // component with a runtime-crashing hook is fixed this turn, not caught post-build. Run across
        // all written files at once (cross-file context); the note names each violating file.
        const writtenSet = new Set(written);
        const writtenRecord: Record<string, string> = {};
        for (const f of parsedFiles) if (writtenSet.has(f.path)) writtenRecord[f.path] = f.content;
        const batchHooksNote = await this.hookWriteNote(writtenRecord);
        return `Wrote ${written.length} file(s) in dependency order: ${written.join(', ')}.${overwriteWarning}${contentLossWarning}${blockedWarning}${dupWarning}${batchHooksNote}`;
      }

      case 'edit_file': {
        const path = reqStr(input, 'path');
        this.assertWritable(path); // C2 — an edit is a write; the same protection applies
        const oldStr = reqStr(input, 'old_string');
        const newStr = reqStr(input, 'new_string');
        const existing = await this.actuator.readFile(this.workspaceId, path);
        // Exact match first, with a whitespace-tolerant fallback so a patch whose
        // indentation/spacing is slightly off still applies (still required to be
        // unique). applyEdit throws the same honest "not found" / "not unique" errors.
        const { updated: edited, matchedOld, note } = applyEdit(existing, oldStr, newStr, path);
        // If an edit to a Vite/tsconfig left it missing a critical backstop, restore it.
        const updated = this.dedupeImportsForSource(path, guardConfigContent(path, this.applyPostgresProviderLock(path, edited)), agent);
        // Self-destruct guard: an edit that reduces a populated source file to empty/whitespace blanks it
        // — same catastrophe as deletion. Refuse before writing so the file survives (StudySync autopsy).
        if (isDestructiveEmptyOverwrite(path, existing, updated)) {
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-DESTRUCTIVE] refused empty-overwrite of source file (edit): ${path}`,
          );
          return emptyOverwriteMessage(path);
        }
        // Parse guard: refuse an edit that would break a clean file (duplicate declaration / broken JSX),
        // so a syntactically-broken version is never saved — the model gets the exact spot + a fix hint.
        const editParseReject = await this.parseGuardRejection(path, existing, updated);
        if (editParseReject) return editParseReject;
        await this.actuator.writeFile(this.workspaceId, path, updated);
        this.onFileWrite?.(path, updated);
        this.state?.recordFileChange({ path, kind: 'modify' }, agent);
        const editMem = getWorkspaceMemory(this.workspaceId);
        editMem.indexFile(path, updated);
        // Level 3: update embedding index (best-effort, non-blocking).
        getEmbeddingStore(this.workspaceId).addFile(path, updated).catch(() => {});
        this.events?.emit({
          type: 'diff',
          agent,
          // Show the text that was ACTUALLY replaced (verbatim from the file) so the
          // diff is honest even when a whitespace-flexible match was used.
          diff: { path, patch: miniDiff(matchedOld, newStr) },
          ts: Date.now(),
        });
        this.scheduleCheckpoint(`edit ${path}`);
        // Level 4: post-edit static review — catch missing imports, typos, stub content.
        const editReview = reviewEdit(path, updated);
        const editReviewNote = formatReviewResult(editReview, path);
        // Level 5: impact cascade — warn about files that import the changed file.
        const { direct: editImpact } = editMem.impactRadius(path);
        const editCascadeNote =
          editImpact.length > 0
            ? `\nIMPACT: ${editImpact.length} file(s) import ${path}: ${editImpact.slice(0, 5).join(', ')}${editImpact.length > 5 ? '…' : ''}. Check they still compile.`
            : '';
        // Level 6: test file hint.
        const editTestHint = testFileHint(path);
        // M1-S1.1 (prevent-not-heal): write-time Rules-of-Hooks guard on the edited content.
        const editHooksNote = await this.hookWriteNote({ [path]: updated });
        return `Edited ${path}.${note}` + editReviewNote + editCascadeNote + editTestHint + editHooksNote;
      }

      case 'bash': {
        const command = reqStr(input, 'command');
        // Scaffold guard: create-* generators (`npm create vite`, `npx create-*`,
        // `npm init <gen>`) require a newer Node than the fixed-version sandbox and
        // FAIL — after which the agent tends to improvise a nested project subdir.
        // A Vite+React+TS scaffold already lives at the workspace root, so short-
        // circuit the doomed command and redirect the agent there instead of
        // running something we KNOW fails and burning build turns.
        const guard = scaffoldGuard(command);
        if (guard.blocked) {
          await this.ensureViteScaffold();
          const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
          const msg = scaffoldGuardMessage(guard.reason ?? '', files);
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `scaffold-guard blocked create-* generator: ${command.slice(0, 160)}`,
          );
          this.state?.appendTerminal(msg);
          return msg;
        }
        // Preview guard: the live preview is MANAGED (E2BActuator detects `npm run dev` and binds
        // host / pins port / sets allowedHosts / health-checks / publishes the URL). When it looks
        // blank the agent tends to improvise — `pkill -f vite`, `serve dist`, `vite preview`,
        // port-hopping — none of which the preview proxy serves (two real reports burned 8+ min in
        // this loop). Redirect those to the one managed path instead of running them.
        const preview = previewGuard(command);
        if (preview.redirect) {
          const pmsg = previewGuardMessage(preview.reason ?? '');
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `preview-guard redirected manual preview command: ${command.slice(0, 160)}`,
          );
          this.state?.appendTerminal(pmsg);
          return pmsg;
        }
        // Governance (Layer 58): classify the command's risk BEFORE execution.
        // DESTRUCTIVE SOURCE-DIR DELETION — BLOCKED (deep-test "PaisaTrack", 2026-07-15). The builder
        // ran `rm -rf src/components src/hooks src/types src/utils` to "fix" two trivial tsc errors,
        // wiping the feature components → the app shipped with orphaned/missing features. Recursively
        // deleting a source directory during a build almost always destroys working app code; refuse it
        // and tell the model to fix the specific error in-file instead. Checked BEFORE the generic risk
        // classifier so the message is the actionable one.
        const destructiveTarget = destructiveSourceDeletionTarget(command);
        if (destructiveTarget) {
          const blockMsg = destructiveSourceDeletionMessage(destructiveTarget);
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-DESTRUCTIVE] refused source-dir delete: ${command.slice(0, 200)}`,
          );
          this.state?.appendTerminal(blockMsg);
          return blockMsg;
        }
        // STILL-IMPORTED FILE DELETION — BLOCKED (admin 2026-08-02: "galat tarah se file delete ho hi na").
        // The bulk guard above deliberately allows deleting ONE stale file by name — right for genuinely
        // dead code, catastrophic for a module other files still import: it vanishes, every importer breaks
        // and the app stops building. The project's own import graph already knows who depends on what, so
        // refuse EXACTLY the deletes that would orphan a live importer and allow the rest. Honest cleanup
        // keeps working; a build-killing delete becomes impossible. Kill switch AGENTV3_DELETE_GUARD=off.
        if (process.env.AGENTV3_DELETE_GUARD !== 'off') {
          for (const target of singleSourceDeleteTargets(command)) {
            let importers: string[] = [];
            try { importers = getWorkspaceMemory(this.workspaceId).impactRadius(target).direct; } catch { importers = []; }
            if (importers.length > 0) {
              const blockMsg = importedFileDeletionMessage(target, importers);
              try {
                getWorkspaceMemory(this.workspaceId).recordAudit(
                  `[BLOCKED-DESTRUCTIVE] refused delete of still-imported file ${target} (${importers.length} importer(s))`,
                );
              } catch { /* audit best-effort */ }
              this.state?.appendTerminal(blockMsg);
              return blockMsg;
            }
          }
        }
        // DESTRUCTIVE DEPENDENCY MUTATION — BLOCKED (deep-test SaaS dashboard, build 5ed0424a). The
        // preview was LIVE (Vite v5, dev server up), then the agent ran `npm audit fix --force` to "fix
        // vulnerabilities" — which force-upgraded Vite v5→v8 (a MAJOR break), crashed the running dev
        // server and KILLED the live preview, costing ~7 min to recover. A preview build never needs a
        // security audit, and force/moving-tag upgrades of a core tool only break the working app. Refuse
        // it and tell the model to keep the pinned versions. Checked BEFORE the generic risk classifier so
        // the message is the actionable one (pure guard: DependencyMutationGuard.ts).
        const depMutation = dependencyMutationGuard(command);
        if (depMutation) {
          const blockMsg = dependencyMutationGuardMessage(depMutation);
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-DEPMUTATION:${depMutation.kind}] refused: ${command.slice(0, 200)}`,
          );
          this.state?.appendTerminal(blockMsg);
          return blockMsg;
        }
        // HIGH-risk commands are BLOCKED outright — they are irreversible, exfiltrate
        // secrets, or execute remote code. MEDIUM commands run but carry a warning.
        const risk = classifyCommandRisk(command);
        if (risk.level === 'high') {
          const blockMsg = `[GOVERNANCE BLOCKED] Command not executed — HIGH-risk operation detected:\n  ${risk.reasons.join('\n  ')}\n  Command: ${command.slice(0, 300)}\n\nIf this was a legitimate need, rephrase the task to avoid dangerous shell patterns.`;
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[BLOCKED-HIGH] refused: ${command.slice(0, 200)} — ${risk.reasons.join('; ')}`,
          );
          this.state?.appendTerminal(blockMsg);
          return blockMsg;
        }
        const cmdStartedAt = Date.now();
        // Pin bare installs of known-volatile packages to their known-good range BEFORE running
        // (EventHive/MelodyBox autopsies): a bare `npm install prisma @prisma/client` otherwise pulls the
        // LATEST — Prisma 7's breaking config/seed (or vue-router 5's Vite-7 peer) then bricks the build.
        // Only bare package tokens in an install sub-command are pinned; `npx prisma generate` and
        // explicit versions are untouched. This is the ONLY choke point that catches the agent's own install.
        // Quote Next.js route-group paths (`mkdir -p src/app/(auth)/login`) BEFORE running — unquoted
        // parens are a bash subshell → exit 2 syntax error, so the dirs are never made (PulseBoard autopsy).
        const effectiveCommand = quoteShellRouteGroupPaths(pinKnownDepsInInstallCommand(command));
        // Inject the user's own vault secrets (Settings → Secrets & API Keys) into the app's .env the first
        // time it installs/builds/runs — so the app runs with real keys the user never pasted in chat.
        await this.ensureUserSecretsEnvFile(effectiveCommand);
        // Provision a real local Postgres BEFORE a migrate/seed if the app targets postgres (MediConnect
        // autopsy): without this the from-scratch build hit P1001 at localhost:5432 and downgraded to a
        // broken SQLite schema. Best-effort + once-per-build; a failure degrades to an honest DB error.
        await this.ensureSandboxPostgres(effectiveCommand);
        // PREFLIGHT (last-5-reports class fix, 2026-07-20): a provisioned Postgres is routinely reaped by
        // the sandbox between touchpoints — five consecutive reports hit some flavour of this. Instead of
        // letting the command FAIL with P1001 and reviving reactively (a full failed-command cycle plus
        // the LLM turns spent reading the error), probe liveness for a millisecond BEFORE a live-DB
        // command and revive first, so the command runs ONCE against a live DB. Shares the bounded
        // revival budget with the reactive net below; entirely best-effort — a probe/revive failure just
        // leaves today's reactive behaviour.
        if (shouldPreflightPostgres({
          provisioned: this.postgresProvisioned,
          confirmedDead: this.postgresConfirmedDead,
          needsLiveDb: commandNeedsLiveDatabase(effectiveCommand),
          provisionedAtMs: this.postgresProvisionedAt,
          nowMs: Date.now(),
        })) {
          try {
            const probe = await this.actuator.runCommand(this.workspaceId, postgresPreflightProbeCommand());
            if (/\bPG_DOWN\b/.test(probe.stdout) && canAttemptPostgresRevival(this.postgresReprovisionAttempts) && typeof this.actuator.provisionBackend === 'function') {
              this.postgresReprovisionAttempts += 1;
              this.narrate('db.asleepRestarting', {});
              await withTimeout(this.actuator.provisionBackend(this.workspaceId, ['db']), 130_000, 'sandbox-postgres-preflight-revive');
              this.postgresProvisionedAt = Date.now();
            }
          } catch { /* best-effort — the reactive DB-unreachable net below still catches a dead DB honestly */ }
        }
        let { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, effectiveCommand);
        // PRISMA RELATION SELF-HEAL (ShopKhata autopsy 2026-07-17): an LLM-written schema routinely
        // ships a HALF-relation ("user User?" with no opposite field / no references) — prisma
        // generate then fails with a validation error whose OWN message says the fix: "run `prisma
        // format`". ShopKhata burned 3 generate + 2 seed failures re-discovering this. Deterministic
        // close: on that exact failure class, run prisma format (completes the relation mechanically),
        // retry the original command ONCE, and report the successful retry honestly. Any other
        // failure — or a failed retry — falls through to the normal honest error path.
        if (
          exitCode !== 0 &&
          /\bprisma\s+(generate|db\s+push|migrate)\b/.test(command) &&
          /(missing an opposite relation field|specify the `references` argument|P1012)/i.test(`${stdout}\n${stderr}`)
        ) {
          try {
            const dirMatch = /^\s*cd\s+([^\s&;|]+)\s*&&/.exec(command);
            const fmtCmd = `${dirMatch ? `cd ${dirMatch[1]} && ` : ''}npx --no-install prisma format`;
            const fmt = await this.actuator.runCommand(this.workspaceId, fmtCmd);
            if (fmt.exitCode === 0) {
              const retry = await this.actuator.runCommand(this.workspaceId, command);
              if (retry.exitCode === 0) {
                ({ exitCode, stdout, stderr } = retry);
                this.narrate('fix.prismaRelation', {});
                // The formatter rewrote schema.prisma in the sandbox — sync the durable copy so
                // restores/edits see the completed relation, not the broken original.
                const schemaPath = `${dirMatch ? `${dirMatch[1].replace(/\/+$/, '')}/` : ''}prisma/schema.prisma`;
                try {
                  const fixedSchema = await this.actuator.readFile(this.workspaceId, schemaPath);
                  this.onFileWrite?.(schemaPath, fixedSchema);
                  this.state?.recordFileChange({ path: schemaPath, kind: 'modify' }, 'architect');
                } catch { /* durable sync is best-effort */ }
              }
            }
          } catch { /* self-heal is best-effort — the original failure is still reported */ }
        }
        // PRISMA-CLI-NOT-INSTALLED SELF-HEAL (Bazaar-era autopsy 2026-07-20): a `prisma generate` (or any
        // prisma command) fails because the `prisma` CLI is NOT in node_modules — either package.json never
        // declared it, or a sandbox recycle wiped node_modules. `npx prisma generate` then tries to
        // auto-FETCH the latest (`prisma@7.8.0`) and, being non-interactive, aborts with
        // "npx canceled due to missing packages and no YES option". The model brute-forced this ~13 times
        // over ~10 MINUTES before it finally ran `npm install -D prisma` — burning the build's whole
        // window so the app shipped incomplete (59 files planned, ~43 built). Deterministic close: on that
        // exact "prisma package missing" signal, install prisma + @prisma/client (pinned to ^6 by
        // pinKnownDepsInInstallCommand — never v7) and retry the original command ONCE. Mirrors the other
        // prisma self-heals; best-effort, never blocks. Kill switch reuses AGENTV3_PRISMA_HINT=off.
        if (
          exitCode !== 0 &&
          process.env.AGENTV3_PRISMA_HINT !== 'off' &&
          /\bprisma\b/.test(command) &&
          isPrismaCliMissingError(`${stdout}\n${stderr}`)
        ) {
          try {
            const dirMatch = /^\s*cd\s+([^\s&;|]+)\s*&&/.exec(command);
            const cd = dirMatch ? `cd ${dirMatch[1]} && ` : '';
            const installCmd = pinKnownDepsInInstallCommand(`${cd}npm install -D prisma @prisma/client`);
            const inst = await this.actuator.runCommand(this.workspaceId, installCmd);
            if (inst.exitCode === 0) {
              const retry = await this.actuator.runCommand(this.workspaceId, command);
              if (retry.exitCode === 0) {
                ({ exitCode, stdout, stderr } = retry);
                this.narrate('fix.toolkitInstalled', {});
              }
            }
          } catch { /* self-heal is best-effort — the original failure is still reported */ }
        }
        // PRISMA CLIENT-NOT-GENERATED SELF-HEAL (TaskForge fresh-build autopsy 2026-07-18): a seed step
        // (`prisma db seed`, `tsx prisma/seed.ts`, `ts-node seed`, `node dist/seed.js`, …) that RUNS BEFORE
        // `prisma generate` fails with "@prisma/client did not initialize yet — please run `prisma generate`"
        // / "@prisma/client has not been generated" / "did you mean `prisma generate`". TaskForge looped this
        // seed failure and burned wall-clock budget re-discovering the ordering. Deterministic close: on that
        // exact failure class (and only when the command is NOT itself a `prisma generate`), run
        // `npx prisma generate` once, then retry the original command ONCE. Any other failure — or a failed
        // retry — falls through to the normal honest error path. Mirrors the relation self-heal above.
        if (
          exitCode !== 0 &&
          !/\bprisma\s+generate\b/.test(command) &&
          /(@prisma\/client did not initialize|@prisma\/client has not been (generated|initialized)|did you mean to run [`']?prisma generate|Please run [`']?prisma generate|Cannot find module ['"]?\.prisma\/client|the client hasn'?t been generated)/i.test(
            `${stdout}\n${stderr}`,
          )
        ) {
          try {
            const dirMatch = /^\s*cd\s+([^\s&;|]+)\s*&&/.exec(command);
            const genCmd = `${dirMatch ? `cd ${dirMatch[1]} && ` : ''}npx prisma generate`;
            const gen = await this.actuator.runCommand(this.workspaceId, genCmd);
            if (gen.exitCode === 0) {
              const retry = await this.actuator.runCommand(this.workspaceId, command);
              if (retry.exitCode === 0) {
                ({ exitCode, stdout, stderr } = retry);
                this.narrate('fix.clientGenerated', {});
              }
            }
          } catch { /* self-heal is best-effort — the original failure is still reported */ }
        }
        // PRISMA STRIPPED-ENUM CONSUMER SELF-HEAL (MediConnect autopsy 2026-07-19): a SQLite schema has
        // no enums, so FullStackGuards strips them to String — but a seed/route that still does
        // `import { AppointmentStatus } from '@prisma/client'` then crashes at load with
        // "does not provide an export named 'AppointmentStatus'" and the seed (exit 1) never runs.
        // Deterministic close: find the files importing the missing enum, make them coherent with a
        // String enum (drop the import name, `Enum.MEMBER` → 'MEMBER', `: Enum` → `: string`), and retry
        // the command ONCE. Mirrors the relation/generate self-heals above; best-effort, never blocks.
        if (exitCode !== 0) {
          const missingEnums = extractMissingPrismaExports(`${stdout}\n${stderr}`);
          if (missingEnums.length > 0) {
            try {
              const { files } = await collectWorkspaceFiles(this.actuator, this.workspaceId);
              let fixedAny = false;
              for (const [p, original] of Object.entries(files)) {
                if (!isEnumConsumerFile(p)) continue;
                let next = original;
                for (const enumName of missingEnums) next = fixDanglingEnumConsumer(p, next, enumName);
                if (next !== original) {
                  await this.actuator.writeFile(this.workspaceId, p, next);
                  try { this.onFileWrite?.(p, next); } catch { /* durable sync best-effort */ }
                  this.state?.recordFileChange({ path: p, kind: 'modify' }, 'architect');
                  fixedAny = true;
                }
              }
              if (fixedAny) {
                const retry = await this.actuator.runCommand(this.workspaceId, command);
                if (retry.exitCode === 0) {
                  ({ exitCode, stdout, stderr } = retry);
                  this.narrate('fix.enumOnSqlite', { enums: missingEnums.join(', ') });
                }
              }
            } catch { /* self-heal is best-effort — the original failure is still reported */ }
          }
        }
        // POSTGRES DIED MID-BUILD → RE-PROVISION ONCE, then RELEASE the lock (FleetOps autopsy 2026-07-20).
        // The sandbox Postgres we provisioned was reaped ~2.5 min into the build (P1001). The builder could
        // not restart it (`pg_ctl`/`pg_ctlcluster` are exit 127 in its shell), and the provider-LOCK then
        // forced ~4 min of futile postgres retries until the builder escaped via `sed`. The correct
        // behaviour: (1) the ENGINE re-provisions Postgres via the actuator (the mechanism that actually
        // works), retry once; (2) if it STILL can't come back, mark it confirmed-dead so the lock releases
        // and the app degrades to SQLite gracefully instead of an unwinnable loop. Bounded to ONE re-provision.
        if (
          this.postgresProvisioned && !this.postgresConfirmedDead &&
          looksLikeDbUnreachable(`${stdout}\n${stderr}`)
        ) {
          if (canAttemptPostgresRevival(this.postgresReprovisionAttempts) && typeof this.actuator.provisionBackend === 'function') {
            this.postgresReprovisionAttempts += 1;
            try {
              this.narrate('db.wentAwayRestarting', {});
              const prov = await withTimeout(this.actuator.provisionBackend(this.workspaceId, ['db']), 130_000, 'sandbox-postgres-reprovision');
              const lines = postgresEnvLines(prov?.envVars?.DATABASE_URL ?? prov?.dbUrl);
              if (Object.keys(lines).length > 0) {
                let existing = '';
                try { existing = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'env-read'); } catch { existing = ''; }
                await this.actuator.writeFile(this.workspaceId, '.env', mergeDotEnv(existing, lines)).catch(() => {});
              }
              const retry = await this.actuator.runCommand(this.workspaceId, command);
              if (!looksLikeDbUnreachable(`${retry.stdout}\n${retry.stderr}`)) {
                ({ exitCode, stdout, stderr } = retry);
                this.postgresProvisionedAt = Date.now(); // revival verified — reset the preflight gate
                this.narrate('db.backOnline', {});
              } else {
                // The revival itself could not bring the DB back — another attempt would repeat the same
                // failure, so this is genuinely dead (not merely reaped). Confirm + release the lock now.
                this.postgresConfirmedDead = true;
              }
            } catch {
              this.postgresConfirmedDead = true;
            }
          } else {
            // Revival budget exhausted (POSTGRES_MAX_REVIVALS) or no provisioner, and it's STILL
            // unreachable → give up on Postgres for this preview and let the app fall to SQLite
            // (the lock now releases).
            this.postgresConfirmedDead = true;
          }
          if (this.postgresConfirmedDead) {
            getWorkspaceMemory(this.workspaceId).recordAudit('postgres confirmed dead in sandbox — releasing the provider lock so the app can use SQLite for the preview');
            this.narrate('db.fellBackToSqlite', {});
          }
        }
        // #3 — hand the raw result to the diagnosis bundle (best-effort; never breaks the build).
        try {
          this.onCommand?.({ command, exitCode, stdout, stderr, durationMs: Date.now() - cmdStartedAt });
        } catch { /* diagnostics capture is best-effort */ }
        /**
         * SECURITY REMEDIATION (admin 2026-08-12). THIS is where the dukaan build's 8 vulnerabilities
         * came from — the agent's own `npm install react-router-dom @neondatabase/serverless bcryptjs
         * jsonwebtoken express cors multer uuid`, whose output said "8 vulnerabilities (4 moderate,
         * 4 high)" and was read by nobody.
         *
         * When high/critical ones are present and the admin has switched this on, apply npm's OWN
         * SemVer-compatible fixes. Never `--force`: that applies breaking major upgrades and is a way
         * to break a working app while claiming to secure it (see npmAuditFix.ts).
         *
         * The fix is recorded as its own command, so the report's vulnerability count comes from the
         * tree the app ACTUALLY ships with rather than the one it started from — and the outcome line
         * states plainly what happened, including "could not fix any of them" and "the result could
         * not be re-read". A remediation step that quietly reports success is worse than one that
         * never ran, because the count it leaves behind is the one the admin will trust.
         *
         * Best-effort throughout: securing dependencies must never be able to fail a working build.
         */
        if (exitCode === 0 && looksLikeDependencyInstall(command)) {
          try {
            const before = parseNpmAuditSummary(`${stdout}\n${stderr}`);
            if (shouldRunAuditFix(before)) {
              const fixStartedAt = Date.now();
              const fix = await this.actuator.runCommand(this.workspaceId, AUDIT_FIX_COMMAND).catch(() => null);
              const after = fix ? parseNpmAuditSummary(`${fix.stdout}\n${fix.stderr}`) : null;
              // Recorded like any other command, so the post-fix count replaces the pre-fix one through
              // the SAME path every install already uses — no second, divergent reporting route.
              try {
                this.onCommand?.({
                  command: AUDIT_FIX_COMMAND, exitCode: fix ? fix.exitCode : null,
                  stdout: fix?.stdout ?? '', stderr: fix?.stderr ?? '', durationMs: Date.now() - fixStartedAt,
                });
              } catch { /* diagnostics capture is best-effort */ }
              // The COUNT reaches the report through the recorded command above (the same path every
              // install already uses). This leaves the WORDS — which matter most in the awkward cases:
              // "could not fix any of them" and "the result could not be re-read" are both outcomes a
              // bare number would quietly round to something more flattering.
              const note = auditFixOutcome(before, after, !!fix);
              if (note) getWorkspaceMemory(this.workspaceId).recordAudit(note);
            }
          } catch { /* a security step must never break the command it followed */ }
        }
        // T1-sec-redact: a command can print a secret (`cat .env`, `printenv`, `echo $API_KEY`).
        // Command stdout/stderr is NEVER an edit_file match source, so — unlike read_file content —
        // it is safe to mask here, closing the leak into BOTH the model transcript and the terminal.
        let out =
          `exit=${exitCode}\n${redactSecrets(stdout)}` + (stderr ? `\n[stderr]\n${redactSecrets(stderr)}` : '');
        // THE PIPE ATE THE EXIT CODE (autopsy 56ee622f, 2026-08-04). `tsc --noEmit 2>&1 | head -30`
        // exits 0 because `head` succeeds — a pipeline reports its LAST command's status. The agent
        // verified its work with exactly that, was told "exit 0", moved on, and shipped an app with ~10
        // real TypeScript errors whose preview then refused to start. It asked the only question it could
        // and got a truthful-looking lie. We do not rewrite the shell (`set -o pipefail` is a bashism this
        // repo has already been burned by); we read the output the command already produced and tell the
        // agent the truth. Silent unless a gate tool was piped, exit was 0, AND the output carries a real
        // compiler/test error. Kill switch AGENTV3_PIPED_GATE_CHECK=off.
        if ((process.env.AGENTV3_PIPED_GATE_CHECK ?? '').trim().toLowerCase() !== 'off') {
          const lie = pipedGateExitCodeWarning(command, exitCode, `${stdout}\n${stderr}`);
          if (lie) out = `${out}\n\n${lie}`;
        }
        // PRISMA SCHEMA REPAIR HINT (widen the relation self-heal beyond the `prisma format` class):
        // when a prisma command STILL fails with a schema-validation error that `prisma format` cannot
        // mechanically fix (ambiguous relation, missing @id/@unique, missing fields/references, SQLite
        // enum, unset DATABASE_URL), append a deterministic, targeted fix instruction to the tool result
        // so the builder converges in ONE directed turn instead of re-discovering the fix by trial and
        // error (the LearnLoop/ShopKhata Prisma struggle). Guidance ONLY — it never edits the schema, so
        // it can never break a build. Kill switch: AGENTV3_PRISMA_HINT=off.
        if (exitCode !== 0 && process.env.AGENTV3_PRISMA_HINT !== 'off') {
          try {
            const hint = prismaRepairHint(`${stdout}\n${stderr}`);
            if (hint) out = `${out}\n\n[schema-repair hint] ${hint}`;
          } catch { /* hint is best-effort — the raw error is still reported */ }
        }
        // NEXT.JS BUILD-ERROR HINT (CargoPilot autopsy 2026-07-19): a `next build` that fails with a
        // framework-specific error (App-Router `export const config` deprecation, getServerSideProps in
        // app/, a missing "use client" directive) gets a targeted fix instruction appended so the builder
        // converges in one directed turn. Guidance only — never edits code. Also runs when the piped exit
        // is 0 but the output shows "Build error occurred" (next build hides its failure behind `| tail`).
        if (process.env.AGENTV3_NEXT_HINT !== 'off' && (exitCode !== 0 || /Build error occurred|Failed to compile/i.test(`${stdout}\n${stderr}`))) {
          try {
            const nHint = nextBuildRepairHint(`${stdout}\n${stderr}`);
            if (nHint) out = `${out}\n\n[next-build hint] ${nHint}`;
          } catch { /* hint is best-effort — the raw error is still reported */ }
        }
        // NPM MASKED-FAILURE HONESTY (CargoPilot autopsy 2026-07-19): `npm install … 2>&1 | tail -30`
        // reports the PIPE's exit 0 while npm actually FAILED (e.g. ERESOLVE) — so a broken install
        // looks successful and the build proceeds on a corrupt dependency tree until it dies later
        // (missing `next` binary). When the output betrays an npm failure behind an exit-0 pipe, say so
        // plainly so the builder re-runs it honestly instead of trusting the fake success.
        if (exitCode === 0 && process.env.AGENTV3_NPM_HONESTY !== 'off') {
          try {
            if (npmInstallMaskedFailure(command, `${stdout}\n${stderr}`)) {
              out = `${out}\n\n[install honesty] ⚠️ This install is piped to \`tail\`/\`head\`, so the shell reported exit 0 but npm actually FAILED (see the npm error above). The dependency tree is NOT installed. Re-run the install WITHOUT the \`| tail\`/\`| head\` so the real exit code is visible, and resolve the peer conflict (add \`--legacy-peer-deps\`, or pin the offending package to a compatible major) before continuing.`;
            }
          } catch { /* honesty hint is best-effort — never blocks the build */ }
        }
        if (risk.level !== 'none') {
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[${risk.level}] ran: ${command.slice(0, 200)} — ${risk.reasons.join('; ')}`,
          );
          out = `${governanceNote(risk)}\n${out}`;
        }
        this.state?.appendTerminal(out);
        // Remember real failures so the team can recall what went wrong (error memory) — redacted, since
        // recalled lessons are shown back to the model/user later.
        if (exitCode !== 0) {
          getWorkspaceMemory(this.workspaceId).recordError(redactSecrets(`bash failed (exit ${exitCode}): ${command}\n${stderr.slice(0, 300)}`));
        } else {
          // Verification ledger (slice 4): record successful installs/typechecks so delegated
          // specialists don't redundantly re-run them (they receive verificationStatus()).
          const mem = getWorkspaceMemory(this.workspaceId);
          if (/\bnpm\s+(ci|install|i)\b/.test(command) || /\b(pnpm|yarn)\s+(install|add)\b/.test(command)) mem.markDepsInstalled();
          if (/\btsc\b[^&|;]*--noEmit/.test(command)) mem.markTscClean();
        }
        return out;
      }

      case 'grep': {
        const pattern = reqStr(input, 'pattern');
        const path = optStr(input, 'path') ?? '.';
        const { stdout } = await this.actuator.runCommand(
          this.workspaceId,
          `grep -rn ${shellQuote(pattern)} ${shellQuote(path)} || true`,
        );
        // T1-sec-redact: grep can surface a secret sitting in a matched line (e.g. `grep KEY .env`).
        return redactSecrets(stdout.trim()) || '(no matches)';
      }

      case 'glob': {
        const pattern = reqStr(input, 'pattern');
        const files = await this.actuator.listFiles(this.workspaceId);
        const re = globToRegExp(pattern);
        const matched = files.filter((f) => re.test(f));
        return matched.length ? matched.join('\n') : '(no files match)';
      }

      case 'recall': {
        const query = reqStr(input, 'query');
        const hits = getWorkspaceMemory(this.workspaceId).recall(query, 12);
        if (hits.length === 0) return `No project memory matches "${query}" yet.`;
        return hits
          .map((h) => {
            if (h.type === 'symbol') return `symbol ${h.ref} (${h.detail}) in ${h.file}`;
            if (h.type === 'file') return `file ${h.ref}`;
            return `${h.detail}: ${h.ref}`;
          })
          .join('\n');
      }

      case 'evaluate': {
        const mem = getWorkspaceMemory(this.workspaceId);
        const archReport = analyzeArchitecture(mem.graph());
        const findings = mem.securityFindings();
        // Read the source tree ONCE and share it across every file-scanning dimension
        // (was ~7 directory listings + each file read ~5×). `snap.files` is the full
        // name-only list for hygiene/secret-leak; `snap.sources` carries content.
        const snap = await this.readEvalSnapshot();
        // Best-effort authenticity/completeness pass — never throws.
        const issues = this.collectAuthenticityIssues(snap.sources);
        // Best-effort dependency-consistency pass — graph-based; never throws.
        const depIssues = await this.collectDependencyIssues();
        // Best-effort environment-variable completeness pass — never throws.
        const envIssues = await this.collectEnvVarIssues(snap.sources);
        // Best-effort accessibility pass — never throws.
        const a11yIssues = this.collectAccessibilityIssues(snap.sources);
        // Best-effort observability pass (Cap-4 advisory) — backend health/error-handler/logging gaps. Never throws.
        const obsIssues = this.collectObservabilityIssues(snap.sources);
        // Best-effort graceful-shutdown pass — long-lived server with no SIGTERM drain. Never throws.
        const shutdownIssues = this.collectGracefulShutdownIssues(snap.sources);
        // Best-effort security-headers pass — Express/Koa server with no helmet/manual headers. Never throws.
        const secHeaderIssues = this.collectSecurityHeaderIssues(snap.sources);
        // Best-effort SRI pass: a third-party <script src="https://cdn…"> without an integrity hash —
        // a compromised CDN could inject code into the shipped app. Advisory (lowers score, never blocks).
        const sriIssues = this.collectSriIssues(snap.sources);
        // Best-effort CSP-meta pass: a static SPA (no server) loading third-party scripts with no
        // Content-Security-Policy meta — defense-in-depth against injected script. Advisory (lowers
        // score, never blocks). Complements SRI (integrity of known scripts) + SecurityHeaders (server headers).
        const cspIssues = this.collectCspIssues(snap.sources);
        // Best-effort comment-language pass: Hindi/Devanagari in code COMMENTS (standard violation).
        // Hindi UI text is never flagged. Advisory (lowers score, never blocks).
        const commentLangIssues = this.collectCommentLanguageIssues(snap.sources);
        // Best-effort upload-validation pass: a multer upload with no fileFilter/MIME check accepts any
        // file type (stored-XSS / malware). Advisory (lowers score, never blocks).
        const uploadIssues = this.collectUploadValidationIssues(snap.sources);
        // Best-effort trust/safety/compliance pass (Layer 77 "Bharosa") — never throws.
        const complianceIssues = this.collectComplianceIssues(snap.sources);
        // Calibrated build confidence (Layer 74 "Sahyog") — an honest synthesis of
        // all eight dimensions with an explanation, surfaced right after the verdict.
        const tally = (xs: ReadonlyArray<{ severity: 'high' | 'medium' | 'low' }>): SeverityTally => ({
          high: xs.filter((x) => x.severity === 'high').length,
          medium: xs.filter((x) => x.severity === 'medium').length,
          low: xs.filter((x) => x.severity === 'low').length,
        });
        const complianceTally: SeverityTally = {
          high: complianceIssues.filter((x) => x.severity === ('high' as ComplianceSeverity)).length,
          medium: complianceIssues.filter((x) => x.severity === ('medium' as ComplianceSeverity)).length,
          low: complianceIssues.filter((x) => x.severity === ('low' as ComplianceSeverity)).length,
        };
        // Best-effort test-coverage pass (Phase 6 — Testing & Autonomous Loops):
        // a PURE read of the project graph, so it never throws and never breaks
        // evaluate. Surfaces which modules/components have no test so the agent
        // closes the plan → build → TEST → validate loop instead of assuming.
        const testCoverage = analyzeTestCoverage(mem.graph());
        // Best-effort requirement-coverage pass (Phase 10 — Product Understanding):
        // PURE comparison of the user's original request against what was built, so
        // it never throws and never breaks evaluate. Flags a clearly-named feature
        // (login, dashboard, cart, …) that was asked for but has no matching surface.
        // ROOT-CAUSE FIX (real report 1682cd03): audit coverage against the CURRENT turn's request,
        // not the cumulative join of every request the workspace ever saw — otherwise a tiny edit
        // re-audits the whole original spec and falsely re-flags long-settled features (see
        // currentRequestForCoverage). A first build has one request episode → unchanged.
        const requestEpisodes = mem
          .snapshot()
          .episodes.filter((e) => e.kind === 'request')
          .map((e) => e.text);
        const requestText = currentRequestForCoverage(requestEpisodes);
        // The file BODIES are passed alongside the graph so a feature built INLINE (a search box
        // inside a list page owns no file of its own) is seen as built instead of reported missing —
        // and so a feature found in neither names nor bodies is a CONFIRMED absence rather than a
        // guess. Everything readiness needs is already in `snap.sources`; this analyzer simply was
        // never given it.
        const reqCoverage = analyzeRequirementCoverage(requestText, mem.graph(), snap.sources);
        // Best-effort runnability pass (Phase 6 — Execution Quality): can the app
        // actually start/build? Reads package.json; never throws, never breaks
        // evaluate. "Preview is EARNED" — a build that compiles can still not run.
        let pkgForRun: string | null = null;
        try {
          pkgForRun = await this.actuator.readFile(this.workspaceId, 'package.json');
        } catch {
          pkgForRun = null; // no manifest — runnability is simply "not assessable"
        }
        const runnability = analyzeRunnability(mem.graph(), pkgForRun);
        // Best-effort SEO/metadata pass (Section I #19): reads the HTML entry and
        // checks the discoverability essentials. Never throws, never breaks evaluate.
        let indexHtml: string | null = null;
        try {
          const htmlPath = mem.graph().files.find((f) => /(^|\/)index\.html$/.test(f)) || 'index.html';
          indexHtml = await this.actuator.readFile(this.workspaceId, htmlPath);
        } catch {
          indexHtml = null; // no HTML entry (e.g. a pure API) — SEO is "not assessable"
        }
        const seo = analyzeSeo(indexHtml);
        // Read .gitignore once — reused by both project-hygiene (does it cover
        // node_modules?) and the secret-leak pass (does it cover .env?).
        let gitignoreContent: string | null = null;
        try {
          gitignoreContent = await this.actuator.readFile(this.workspaceId, '.gitignore');
        } catch {
          gitignoreContent = null;
        }
        // Best-effort project-hygiene pass (Section I #22): checks the REAL file list
        // (from the shared snapshot) for .gitignore / tsconfig / lockfile, and whether
        // an existing .gitignore actually covers node_modules.
        const hygieneFiles = snap.files;
        const hygiene = analyzeProjectHygiene(hygieneFiles, pkgForRun !== null, gitignoreContent);
        // Best-effort error-boundary pass (Section I #5): a real React app with no
        // error boundary white-screens on any render error. Never throws.
        const errorBoundary = analyzeErrorBoundary(
          mem.graph().components.length,
          this.collectHasErrorBoundary(snap.sources),
          this.collectBrokenErrorBoundaries(snap.sources),
        );
        // Best-effort security-config pass (Section I #4): insecure TLS/CORS config.
        const securityConfig = this.collectSecurityConfigIssues(snap.sources);
        // Best-effort secret-leak pass (Section I #4): a real .env not gitignored.
        let secretLeak = analyzeSecretLeak(hygieneFiles, gitignoreContent);
        // DETERMINISTIC ROOT-CAUSE HEAL (deep-test App #7 + #8): don't just DETECT the leak
        // and block at 0/100 — actually FIX it. When a real .env is exposed, deterministically
        // add it to .gitignore (creating the file when absent), then re-assess so the readiness
        // blocker clears in the same pass. Never throws, never breaks evaluate; a gitignore rule
        // has zero runtime effect, it only stops secrets reaching git.
        if (secretLeak.findings.length) {
          const healed = gitignoreWithEnvCoverage(gitignoreContent, secretLeak.exposed);
          if (healed) {
            try {
              await this.actuator.writeFile(this.workspaceId, '.gitignore', healed);
              gitignoreContent = healed;
              secretLeak = analyzeSecretLeak(hygieneFiles, gitignoreContent);
            } catch {
              // Couldn't write .gitignore (read-only FS / sandbox gone) — keep the honest
              // detection so the blocker still surfaces rather than silently vanishing.
            }
          }
        }
        // Best-effort env-template-secret pass (Section I #4 v7): a REAL secret left in a
        // committed .env.example/.sample/.template is a permanent git-history leak.
        const envTemplateSecrets: EnvTemplateSecretIssue[] = [];
        for (const name of ['.env.example', '.env.sample', '.env.template']) {
          let tplContent: string | null = null;
          try {
            tplContent = await this.actuator.readFile(this.workspaceId, name);
          } catch {
            tplContent = null;
          }
          if (tplContent) envTemplateSecrets.push(...scanEnvTemplateSecrets(name, tplContent));
        }
        // Best-effort hardcoded-URL pass (Section I #11): localhost baked into code.
        const hardcodedUrls = this.collectHardcodedUrlIssues(snap.sources);
        // Best-effort port-binding pass (Section I #11 v2): a hardcoded listen port
        // means a managed host can never route traffic to the deployed app.
        const portBindings = this.collectPortBindingIssues(snap.sources);
        // Best-effort Vite client-env pass (Section I #5): a non-VITE_ import.meta.env
        // reference is undefined in the browser. Skipped when vite config customises
        // envPrefix (then other prefixes may be valid and we cannot be sure).
        let viteConfig: string | null = null;
        for (const candidate of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
          try {
            viteConfig = await this.actuator.readFile(this.workspaceId, candidate);
            if (viteConfig !== null) break;
          } catch {
            viteConfig = null;
          }
        }
        const viteEnv = hasCustomEnvPrefix(viteConfig) ? [] : this.collectViteEnvIssues(snap.sources);
        // Best-effort async-pattern pass (Section I #6): forEach(async …) does not await.
        const asyncPatterns = this.collectAsyncPatternIssues(snap.sources);
        // Fold the critical new dimensions into the readiness gate: a secret leak,
        // an app that can't run, or a high-severity security misconfig must BLOCK
        // "READY" — not merely be reported. The rest lower the score as warnings.
        const extra: ExtraFinding[] = [];
        // Fake/incomplete code (not-implemented, placeholder, lorem-ipsum, fake-data)
        // is a hard blocker — the constitution forbids shipping it as "done".
        const authHigh = issues.filter((i) => i.severity === 'high').length;
        if (authHigh) extra.push({ severity: 'high', label: `${authHigh} fake/incomplete code issue(s) (placeholder / not-implemented / fake data)` });
        // Serious privacy/compliance violations (PII in logs, plaintext sensitive
        // storage, personal data over http) block "launch-safe" (Layer 77).
        const complianceHigh = complianceIssues.filter((i) => i.severity === ('high' as ComplianceSeverity)).length;
        if (complianceHigh) extra.push({ severity: 'high', label: `${complianceHigh} serious privacy/compliance issue(s)` });
        if (secretLeak.findings.length) extra.push({ severity: 'high', label: 'Secret leak: a real .env is not gitignored' });
        if (envTemplateSecrets.length) extra.push({ severity: 'high', label: `${envTemplateSecrets.length} real secret(s) committed in an .env template` });
        for (const f of runnability.findings) extra.push({ severity: f.level === 'high' ? 'high' : 'medium', label: `Runnability: ${f.message}` });
        for (const i of securityConfig) extra.push({ severity: i.severity === 'high' ? 'high' : 'medium', label: `Security config (${i.rule})` });
        if (hardcodedUrls.length) extra.push({ severity: 'medium', label: `${hardcodedUrls.length} hardcoded localhost URL(s)` });
        if (sriIssues.length) extra.push({ severity: 'medium', label: `${sriIssues.length} third-party <script> without an integrity hash (SRI)` });
        if (cspIssues.length) extra.push({ severity: 'medium', label: `${cspIssues.length} static-SPA page(s) with third-party scripts but no Content-Security-Policy` });
        if (commentLangIssues.length) extra.push({ severity: 'medium', label: `${commentLangIssues.length} non-English code comment(s) (professional-English standard)` });
        if (uploadIssues.length) extra.push({ severity: 'medium', label: `${uploadIssues.length} file-upload endpoint(s) with no MIME/type validation (multer, no fileFilter)` });
        if (portBindings.length) extra.push({ severity: 'medium', label: `${portBindings.length} hardcoded server port(s) (use process.env.PORT)` });
        if (viteEnv.length) extra.push({ severity: 'medium', label: `${viteEnv.length} non-VITE_ import.meta.env reference(s) (undefined in the browser)` });
        if (asyncPatterns.length) extra.push({ severity: 'medium', label: `${asyncPatterns.length} forEach(async …) loop(s) that do not await` });
        // A CONFIRMED absence says so plainly. The old single wording — "not found" — read like a
        // lookup that came up empty, which is exactly how a true finding gets skimmed past: in the
        // dukaan report the user had literally written "upar search box ho", no search existed, this
        // line said so, and the build shipped anyway. "not built" is what actually happened.
        for (const f of reqCoverage.findings) {
          extra.push({ severity: 'medium', label: f.confirmed ? `Requested feature NOT BUILT: ${f.feature}` : `Requested feature not found: ${f.feature}` });
        }
        // A boundary that EXISTS but does not work is a different instruction from one that is absent —
        // see looksLikeBrokenErrorBoundary. The old single label said "has no error boundary" for both,
        // which is what invites a duplicate.
        if (errorBoundary.findings.length) {
          extra.push({ severity: 'medium', label: errorBoundary.brokenBoundaries.length > 0
            ? `${errorBoundary.brokenBoundaries[0]} is named like an error boundary but implements none — fix that file, do NOT add another`
            : 'React app has no error boundary' });
        }
        if (testCoverage.findings.some((f) => f.level === 'high')) extra.push({ severity: 'medium', label: 'No tests at all' });
        // Best-effort design-consistency pass (P-PIPE.C stage 32 — advisory, NEVER a readiness
        // blocker, exactly like SEO): lint the generated style-bearing code for palette/typography/
        // spacing/token consistency so a build reports its visual polish, not just its correctness.
        // Pure + never throws. Not pushed into `extra`, so it can never fail an otherwise-ready build.
        const DESIGN_EXT = /\.(css|scss|sass|less|tsx|jsx|vue|svelte|html?)$/i;
        const designCode = snap.sources
          .filter((s) => DESIGN_EXT.test(s.path))
          .map((s) => s.content)
          .join('\n')
          .slice(0, 400_000);
        const design = lintDesign(designCode);
        // P-PIPE.40 — advisory dependency auto-fix: for each imported-but-undeclared package, suggest an
        // exact `name@^range` when it's a known npm package, else soften to "verify (may be a local
        // alias)". Advisory only — it never mutates package.json or the install path (the builder applies
        // fixes with edit_file under its own judgment). Pure; never a readiness blocker.
        const depAutoFix = dependencyAutoFixSummary(planDependencyAutoFix(depIssues.filter((d) => d.kind === 'missing')));
        // P-PIPE.84 — PWA/installability advisory. Silent (omitted) unless the app shows PWA intent
        // (manifest / service worker / PWA meta / PWA plugin), so it never nags a plain app. Pure;
        // never a readiness blocker.
        const pwaLine = pwaSummary(analyzePwa(snap.sources, snap.files, mem.graph().dependencies));
        // AST-accurate build-breaker checks (hooks / import-export / JSX resolution). Each of these
        // genuinely crashes the app or fails the build, so a real finding is a HARD readiness blocker —
        // this is what makes the builder SELF-CORRECT them (the end-of-build gate feeds the blockers
        // back to the agent to fix). Conservative + never-throw (an empty result on any parse/lib issue),
        // so they degrade to "no finding" rather than ever false-blocking a working build.
        const astFiles: Record<string, string> = {};
        for (const s of snap.sources) astFiles[s.path] = s.content;
        // DETERMINISTIC IMPORT SELF-HEAL (root cause — recurring generator bug, admin reports
        // fae70e42 / Notes / Car / Watch): before the import/export gate can flag a build-breaking
        // "broken import", auto-repair the UNAMBIGUOUS named<->default mismatches — e.g. a generated
        // test file `import { App }` for a default-exported `App`. Intent-preserving + proven safe
        // (only acts when the exact name is exported the opposite way), so it can only turn a broken
        // build into a working one. Corrected files persist via the SAME durable write path as any
        // file write (actuator + onFileWrite), and the reconciled content feeds the analyzers below so
        // the readiness verdict reflects the repair. Kill switch: AGENTV3_IMPORT_RECONCILE=off.
        if (process.env.AGENTV3_IMPORT_RECONCILE !== 'off') {
          try {
            const rec = await reconcileImportExports(astFiles);
            if (rec.fixes.length) {
              for (const fx of rec.fixes) {
                const content = rec.files[fx.file];
                if (typeof content !== 'string') continue;
                // What THIS pass read, captured before the snapshot is updated — comparing it with what
                // the previous heal left is what tells a lost write apart from a re-firing detector.
                const before = astFiles[fx.file];
                // ⚠️ STOP AN OSCILLATION, don't just record it (admin report 2026-08-25: src/main.tsx
                // healed ×4 with our own write intact each time). Three import fixers run over the same
                // file; if two disagree about a symbol it goes X → Y → X for as many passes as the
                // build allows, costing a write and a step every round and converging on nothing.
                if (healWouldOscillate(this.workspaceId, fx.file, content)) continue;
                astFiles[fx.file] = content;
                try { await this.actuator.writeFile(this.workspaceId, fx.file, content); } catch { /* best-effort */ }
                try { this.onFileWrite?.(fx.file, content); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(fx.file, content); } catch { /* best-effort */ }
                noteHeal(this.workspaceId, fx.file, content, before);
              }
              this.narrate('fix.importKind', { count: rec.fixes.length });
            }
          } catch { /* reconcile is best-effort — a failure just leaves the honest blocker below */ }
          // MISSING-IMPORT SELF-HEAL (root cause — admin jungle-game report 104f5b09): a generated file
          // used a shared const (CANVAS_HEIGHT) but forgot to import it → runtime ReferenceError crashed
          // the preview. Deterministically ADD the forgotten import when the bare value-identifier is
          // exported by exactly one project module and is not declared/imported in the file. Same durable
          // write path; feeds the analyzers below.
          try {
            const addRes = await addMissingProjectImports(astFiles);
            if (addRes.added.length) {
              const changedFiles = new Set(addRes.added.map((a) => a.file));
              for (const file of changedFiles) {
                const content = addRes.files[file];
                if (typeof content !== 'string') continue;
                const before = astFiles[file];
                // Same oscillation guard as the reconcile above — every heal site, or the loop survives
                // through whichever one was left out.
                if (healWouldOscillate(this.workspaceId, file, content)) continue;
                astFiles[file] = content;
                try { await this.actuator.writeFile(this.workspaceId, file, content); } catch { /* best-effort */ }
                try { this.onFileWrite?.(file, content); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(file, content); } catch { /* best-effort */ }
                // This heal was MISSING from the ledger, and it is the one the 2026-08-09 report showed
                // repeating first ("Added 2 missing import(s)" at t=126s/216s/313s) — so the very
                // evidence the ledger exists to capture was being dropped for it.
                noteHeal(this.workspaceId, file, content, before);
              }
              this.narrate('fix.missingImports', { count: addRes.added.length });
            }
          } catch { /* best-effort — a failure just leaves the honest finding below */ }
          // WRONG-SOURCE SELF-HEAL (Kanban build 2026-07-13): a NAMED import points at a module that does
          // NOT export it, while exactly one OTHER project module DOES — the import is simply the wrong
          // source. Deterministically re-point it (unique-owner only; never a guess). Same durable write path.
          try {
            const wrongRes = await fixWrongSourceImports(astFiles);
            if (wrongRes.fixes.length) {
              const changedFiles = new Set(wrongRes.fixes.map((f) => f.file));
              for (const file of changedFiles) {
                const content = wrongRes.files[file];
                if (typeof content !== 'string') continue;
                const before = astFiles[file];
                // Same oscillation guard as the reconcile above — every heal site, or the loop survives
                // through whichever one was left out.
                if (healWouldOscillate(this.workspaceId, file, content)) continue;
                astFiles[file] = content;
                try { await this.actuator.writeFile(this.workspaceId, file, content); } catch { /* best-effort */ }
                try { this.onFileWrite?.(file, content); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(file, content); } catch { /* best-effort */ }
                noteHeal(this.workspaceId, file, content, before);
              }
              this.narrate('fix.repointedImports', { count: wrongRes.fixes.length });
            }
          } catch { /* best-effort — a failure just leaves the honest finding below */ }
          // DUPLICATE-IMPORT SELF-HEAL (build-report autopsy 2026-08-02, RECURRING): the double
          // `import ErrorBoundary from './ErrorBoundary'` + `import { ErrorBoundary } from './ErrorBoundary'`
          // that BABEL rejects as "Duplicate declaration" — but esbuild AND tsc silently ACCEPT (a real
          // compiler divergence), so the write-time guards and the type-checker miss it, and it white-screens
          // the preview + refuses the dev-server port. Runs HERE, before the readiness gate, so the duplicate
          // is removed on EVERY build — success, failure, OR wall-clock-capped alike (the route's post-build
          // sweep ran too late and only on result.ok, so a 30-min capped build kept the duplicate). Pure +
          // safe (dedupeSameModuleImports keeps the first binding, drops a later same-module redundant one);
          // same durable write path; the cleaned file feeds the readiness gate below so its verdict is honest.
          try {
            for (const [file, content] of Object.entries(astFiles)) {
              if (typeof content !== 'string') continue;
              const deduped = dedupeSameModuleImports(file, content);
              // Same oscillation guard as the reconcile above — whichever pair disagrees, the loop ends.
              if (deduped !== content && !healWouldOscillate(this.workspaceId, file, deduped)) {
                astFiles[file] = deduped;
                try { await this.actuator.writeFile(this.workspaceId, file, deduped); } catch { /* best-effort */ }
                try { this.onFileWrite?.(file, deduped); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(file, deduped); } catch { /* best-effort */ }
                // Evidence for the "a heal did not survive" root cause — see HealLedger's header.
                // This one already holds both halves: `content` is what it read, `deduped` what it wrote.
                noteHeal(this.workspaceId, file, deduped, content);
                this.narrate('fix.duplicateImport', { file });
              }
            }
          } catch { /* best-effort — a failure just leaves the honest blocker below */ }
          // DEPENDENCY RECONCILE (P-PIPE): a package imported but not in package.json fails install/runtime
          // with "Cannot find module". For the curated well-known allowlist (real npm packages, version-
          // pinned; alias-colliding names excluded) add it to package.json deterministically so the app
          // installs. The existing `package.json -nt node_modules` reinstall gate picks it up before preview;
          // if for any reason it doesn't, the readiness gate still flags it honestly (no regression). Kill
          // switch: AGENTV3_DEP_RECONCILE=off.
          if (process.env.AGENTV3_DEP_RECONCILE !== 'off') {
            try {
              let pkgJson: string | undefined;
              try { pkgJson = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgJson = undefined; }
              if (typeof pkgJson === 'string') {
                const depRes = applyWellKnownMissingDeps({ 'package.json': pkgJson, ...astFiles });
                if (depRes.added.length) {
                  const newPkg = depRes.files['package.json'];
                  try { await this.actuator.writeFile(this.workspaceId, 'package.json', newPkg); } catch { /* best-effort */ }
                  try { this.onFileWrite?.('package.json', newPkg); } catch { /* best-effort */ }
                  this.narrate('fix.missingDeps', { count: depRes.added.length, packages: depRes.added.map((d) => d.package).join(', ') });
                }
              }
            } catch { /* best-effort — a failure just leaves the honest 'missing dependency' finding below */ }
          }
        }
        const [hooksRep, importRep, jsxRep, undefHookRep] = await Promise.all([
          analyzeHooksRules(astFiles),
          analyzeImportExports(astFiles),
          analyzeJsxComponents(astFiles),
          analyzeUndefinedHooks(astFiles),
        ]);
        // FRAMEWORK-GATE the React-SPECIFIC analyzers (ShopSphere/Nuxt autopsy 2026-07-19): Rules-of-Hooks,
        // JSX-component and undefined-hook analysis are about REACT — a Vue/Nuxt `useFetch`/`useProducts`
        // composable is NOT a React hook, and a Nuxt AUTO-IMPORTED composable is NOT "never imported". Run
        // against a non-React app these produced FALSE high-severity BLOCKERS that failed a correct build.
        // Import/export consistency stays (it is framework-neutral: a written import must resolve anywhere).
        const reactLint = isReactFamilyFramework(this.framework);
        if (reactLint && hooksRep.violations.length) {
          const sample = hooksRep.violations.slice(0, 3).map((v) => `${v.hook}@${v.file}:${v.line}`).join(', ');
          extra.push({ severity: 'high', label: `${hooksRep.violations.length} React Rules-of-Hooks violation(s) (crash at runtime): ${sample}${hooksRep.violations.length > 3 ? ', …' : ''}` });
        }
        if (importRep.mismatches.length) {
          const sample = importRep.mismatches.slice(0, 3).map((m) => `${m.imported}←${m.from}@${m.file}:${m.line}`).join(', ');
          extra.push({ severity: 'high', label: `${importRep.mismatches.length} broken import(s) — a name is imported that the module does not export (the build fails): ${sample}${importRep.mismatches.length > 3 ? ', …' : ''}` });
        }
        if (reactLint && jsxRep.undefinedComponents.length) {
          const sample = jsxRep.undefinedComponents.slice(0, 3).map((c) => `<${c.component}>@${c.file}:${c.line}`).join(', ');
          extra.push({ severity: 'high', label: `${jsxRep.undefinedComponents.length} undefined JSX component(s) — used but never imported/defined (crash at runtime): ${sample}${jsxRep.undefinedComponents.length > 3 ? ', …' : ''}` });
        }
        if (reactLint && undefHookRep.undefinedHooks.length) {
          const sample = undefHookRep.undefinedHooks.slice(0, 3).map((h) => `${h.hook}()@${h.file}:${h.line}`).join(', ');
          extra.push({ severity: 'high', label: `${undefHookRep.undefinedHooks.length} hook(s) called but never imported/defined (crash at runtime): ${sample}${undefHookRep.undefinedHooks.length > 3 ? ', …' : ''}` });
        }
        // Dependency version conflicts (P-AI.14 ConstraintSolver): a react/react-dom major mismatch crashes
        // React at render (HIGH blocker); duplicate/`@types` drift lowers the score as a warning. Pure, sync.
        // Uses the already-read root package.json (pkgForRun) — package.json is not in snap.sources.
        if (pkgForRun) {
          for (const c of analyzeDependencyConstraints({ 'package.json': pkgForRun }).conflicts) {
            extra.push({ severity: c.severity, label: `Dependency conflict (${c.kind}): ${c.detail}` });
          }
        }
        // PREVIEW-COMPILE HONESTY BLOCKER (readiness-honesty autopsy 2026-08-02): the "Build health"
        // verdict was computed WITHOUT the in-browser preview compiler, so a build whose ENTRY file will not
        // compile still scored "READY · 70/100" while the live preview white-screened and the dev server
        // refused its port. The classic case is the recurring duplicate `ErrorBoundary` import that BABEL
        // (the in-browser preview's compiler) rejects as "Duplicate declaration" but esbuild — and thus tsc
        // and vite — silently ACCEPT (a real compiler divergence, verified). So the esbuild/parse gates miss
        // it. Run the SAME babel dry-compile the preview uses (checkPreviewCompiles) and, when a guaranteed-
        // reachable ENTRY file (main/App/index) diverges, feed it in as a HARD blocker — the health card can
        // then never call a white-screening build READY (it now agrees with the route's already-honest
        // "preview does not compile → not charged" verdict). A non-entry divergence (a possibly-never-
        // imported file) stays advisory — no false block, matching PreviewCompileCheck's reachability scoping.
        try {
          const pc = checkPreviewCompiles(astFiles);
          if (!pc.ok && previewDivergenceBlocksDelivery(pc.errors)) {
            const entryErr = pc.errors.find((e) => previewDivergenceBlocksDelivery([e]));
            extra.push({ severity: 'high', label: `the live preview will not compile — ${entryErr?.file ?? 'entry file'}: ${(entryErr?.message ?? 'compile error').slice(0, 160)}` });
          }
        } catch { /* the preview-compile gate is best-effort — a compiler failure never fabricates a blocker */ }
        const readiness = assessReadiness(archReport, findings, extra);
        // Stash for the mandatory end-of-build gate (R2 §1.1) — same scan, no divergence.
        this.lastReadiness = readiness;
        const verdict = readinessVerdict(readiness);
        const confidence = computeBuildConfidence({
          readinessScore: readiness.score,
          ready: readiness.ready,
          architecture: {
            unresolvedImports: archReport.unresolvedImports.length,
            cycles: archReport.cycles.length,
            layering: archReport.layeringViolations.length,
          },
          security: tally(findings),
          authenticity: issues.length,
          dependencies: {
            missing: depIssues.filter((d) => d.kind === 'missing').length,
            unused: depIssues.filter((d) => d.kind === 'unused').length,
          },
          envVarsMissing: envIssues.filter((e) => e.severity === 'high').length,
          accessibility: tally(a11yIssues),
          compliance: complianceTally,
        });
        // GA-16 — N+1 query anti-pattern (a DB query per loop iteration). Advisory-only; async (ts-morph).
        const queryPatternLine = queryPatternSummary(await analyzeQueryPatterns(snap.sources).catch(() => []));
        // GA-16 — memory leak: a useEffect that starts a timer/listener/subscription with no cleanup. Advisory.
        const effectLeakLine = effectCleanupSummary(await analyzeEffectCleanup(snap.sources).catch(() => []));
        // GA-16 — query optimizer: SELECT * / unbounded findMany/find / whole-table deleteMany/updateMany. Advisory.
        const queryOptLine = queryOptimizerSummary(await analyzeQueryOptimizer(snap.sources).catch(() => []));
        // GA-12 — coupling: fan-in hotspots (a module imported by many others) + high fan-out God modules. Advisory.
        const couplingLine = couplingSummary(await analyzeCoupling(snap.sources).catch(() => []));
        // GA-5 — API wiring: frontend calls with no matching backend route (likely broken). Advisory-only.
        const apiWiringLine = (() => { try { return apiWiringSummary(buildApiGraph(snap.sources)); } catch { return ''; } })();
        // GA-13 — threat model: high-precision own-code security defects (client secret, wildcard-CORS+creds,
        // SQL string-interp, XSS via dangerouslySetInnerHTML, eval on non-literal). Advisory.
        const threatLine = threatModelSummary(analyzeThreatModel(snap.sources));
        // D12 — monorepo: detect turbo/nx/pnpm-workspaces and advise the correct scoped install/build/test. Advisory.
        const monorepoLine = (() => {
          try {
            const contents = Object.fromEntries(snap.sources.map((s) => [s.path, s.content]));
            const pm = detectPackageManager(snap.files)?.manager || 'npm';
            return monorepoSummary(detectMonorepo(snap.files, contents), pm);
          } catch { return ''; }
        })();
        // GA-5 — schema/FK graph: a Prisma relation or SQL foreign key to a model/table the schema never
        // defines (breaks the DB migration). .prisma/.sql files are not in the shared source snapshot, so read
        // them separately (bounded, once). Both summaries are advisory-only.
        const { schemaLine, sqlSchemaLine } = await (async () => {
          try {
            const schemaFiles = snap.files.filter((p) => /\.(prisma|sql)$/i.test(p) && !/(^|[\\/])node_modules([\\/]|$)/.test(p)).slice(0, 30);
            if (schemaFiles.length === 0) return { schemaLine: '', sqlSchemaLine: '' };
            const contents: Array<{ path: string; content: string }> = [];
            for (const p of schemaFiles) {
              try { contents.push({ path: p, content: await withTimeout(this.actuator.readFile(this.workspaceId, p), 5_000, 'readFile') }); } catch { /* skip unreadable */ }
            }
            return { schemaLine: schemaGraphSummary(analyzeSchemaGraph(contents)), sqlSchemaLine: sqlSchemaSummary(analyzeSqlSchema(contents)) };
          } catch { return { schemaLine: '', sqlSchemaLine: '' }; }
        })();
        // GA-14 — CI workflow: a generated GitHub Actions workflow that will fail deterministically (npm ci
        // with no lockfile, cache-manager mismatch, missing script). Read the workflows + package.json (not in
        // the source snapshot) + lockfile presence, bounded. Advisory-only; the repair_ci_workflow tool fixes.
        const ciWorkflowLine = await (async () => {
          try {
            const workflows = snap.files.filter((p) => ciPlatform(p) !== null).slice(0, 15);
            if (workflows.length === 0) return '';
            const map: Record<string, string> = {};
            for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']) {
              if (snap.files.includes(lock)) map[lock] = '';
            }
            for (const p of [...workflows, ...(snap.files.includes('package.json') ? ['package.json'] : [])]) {
              try { map[p] = await withTimeout(this.actuator.readFile(this.workspaceId, p), 5_000, 'readFile'); } catch { /* skip unreadable */ }
            }
            return ciWorkflowSummary(analyzeCiWorkflow(map));
          } catch { return ''; }
        })();
        return `${verdict}\n\n${buildConfidenceSummary(confidence)}\n\n${architectureSummary(archReport)}\n\n${securitySummary(findings)}\n\n${authenticitySummary(issues)}\n\n${dependencySummary(depIssues)}\n\n${envVarSummary(envIssues)}\n\n${accessibilitySummary(a11yIssues)}\n\n${observabilitySummary(obsIssues)}\n\n${gracefulShutdownSummary(shutdownIssues)}\n\n${securityHeadersSummary(secHeaderIssues)}\n\n${sriSummary(sriIssues)}\n\n${cspSummary(cspIssues)}\n\n${commentLanguageSummary(commentLangIssues)}\n\n${uploadValidationSummary(uploadIssues)}\n\n${complianceSummary(complianceIssues)}\n\n${testCoverageSummary(testCoverage)}\n\n${requirementCoverageSummary(reqCoverage)}\n\n${runnabilitySummary(runnability)}\n\n${seoSummary(seo)}\n\n${projectHygieneSummary(hygiene)}\n\n${errorBoundarySummary(errorBoundary)}\n\n${securityConfigSummary(securityConfig)}\n\n${secretLeakSummary(secretLeak)}\n\n${hardcodedUrlSummary(hardcodedUrls)}\n\n${portBindingSummary(portBindings)}\n\n${viteEnvSummary(viteEnv)}\n\n${envTemplateSecretSummary(envTemplateSecrets)}\n\n${asyncPatternSummary(asyncPatterns)}\n\n${designSummary(design)}\n\n${maintainabilitySummary(analyzeMaintainability(snap.sources))}\n\n${heavyImportSummary(analyzeHeavyImports(snap.sources))}${queryPatternLine ? `\n\n${queryPatternLine}` : ''}${effectLeakLine ? `\n\n${effectLeakLine}` : ''}${queryOptLine ? `\n\n${queryOptLine}` : ''}${couplingLine ? `\n\n${couplingLine}` : ''}${apiWiringLine ? `\n\n${apiWiringLine}` : ''}${threatLine ? `\n\n${threatLine}` : ''}${monorepoLine ? `\n\n${monorepoLine}` : ''}${schemaLine ? `\n\n${schemaLine}` : ''}${sqlSchemaLine ? `\n\n${sqlSchemaLine}` : ''}${ciWorkflowLine ? `\n\n${ciWorkflowLine}` : ''}\n\n${lockfileSummary(analyzeLockfiles(snap.files))}${(() => { const pm = packageManagerSummary(detectPackageManager(snap.files)); return pm ? `\n\n${pm}` : ''; })()}${depAutoFix ? `\n\n${depAutoFix}` : ''}${pwaLine ? `\n\n${pwaLine}` : ''}`;
      }

      case 'update_todo': {
        const todos = parseTodos(input);
        this.state?.setTodos(todos);
        return `Updated ${todos.length} todo(s).`;
      }

      case 'generate_readme': {
        const path = optStr(input, 'path') || 'README.md';
        const projectName = optStr(input, 'project_name');
        let pkg: string | null = null;
        try {
          pkg = await this.actuator.readFile(this.workspaceId, 'package.json');
        } catch {
          pkg = null; // no manifest — generateReadme still produces an honest minimal README
        }
        const graph = getWorkspaceMemory(this.workspaceId).graph();
        const packageManager = await this.detectWorkspacePackageManager();
        const content = generateReadme({ projectName, graph, packageJson: pkg, packageManager });
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} from the project graph (${content.length} bytes).`;
      }

      case 'generate_architecture_docs': {
        // P-PIPE.112 — write a real ARCHITECTURE.md (module dependency map + component/route inventory
        // + honest structural notes) from the project graph. Deterministic; mirrors generate_readme.
        const path = optStr(input, 'path') || 'ARCHITECTURE.md';
        const graph = getWorkspaceMemory(this.workspaceId).graph();
        const content = generateArchitectureDoc(graph, analyzeArchitecture(graph));
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — the real module dependency map + structural notes (${content.length} bytes).`;
      }

      case 'generate_dev_guide': {
        // Roadmap BUILD-NOW #15 — a human DEVELOPER_GUIDE.md (how to run, where code lives, how to add a
        // page/route/component/endpoint, test, deploy, troubleshoot). Distinct from generate_readme (what the
        // app IS) and generate_architecture_docs (structure). Derived from the app's REAL package.json +
        // env refs. Pure gen in DeveloperGuideGenerator.ts. No env keys.
        const dgPath = optStr(input, 'path') || 'DEVELOPER_GUIDE.md';
        // Best-effort: read the real package.json for name / scripts / framework detection.
        let dgName = optStr(input, 'name') || '';
        let dgScripts: DevGuideScript[] = [];
        let dgFramework = optStr(input, 'framework') || '';
        try {
          const pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json');
          const pkg = JSON.parse(pkgRaw) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
          if (!dgName && typeof pkg.name === 'string') dgName = pkg.name;
          if (pkg.scripts && typeof pkg.scripts === 'object') {
            dgScripts = Object.entries(pkg.scripts)
              .filter(([n, c]) => typeof n === 'string' && typeof c === 'string')
              .map(([n, c]) => ({ name: n, cmd: c }));
          }
          if (!dgFramework) {
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps.next) dgFramework = 'next';
            else if (deps['@sveltejs/kit'] || deps.svelte) dgFramework = 'svelte';
            else if (deps['solid-js']) dgFramework = 'solid';
            else if (deps.vue) dgFramework = 'vue';
            else if (deps.react) dgFramework = 'react';
            else if (deps.express) dgFramework = 'express';
            else dgFramework = 'node';
          }
        } catch {
          // no package.json (e.g. a Python app) — fall back to inputs / generic guidance
        }
        // Real env keys referenced by the code (same source generate_env_example uses).
        let dgEnvKeys: string[] = [];
        try {
          dgEnvKeys = this.collectEnvRefs((await this.readEvalSnapshot()).sources);
        } catch {
          dgEnvKeys = [];
        }
        const dg = generateDevGuide({
          name: dgName || undefined,
          framework: dgFramework || undefined,
          packageManager: optStr(input, 'package_manager') || undefined,
          scripts: dgScripts,
          envKeys: dgEnvKeys,
        });
        const dgContent = dg.files['DEVELOPER_GUIDE.md'];
        let dgKind: 'create' | 'modify' = 'create';
        try { await this.actuator.readFile(this.workspaceId, dgPath); dgKind = 'modify'; } catch { dgKind = 'create'; }
        await this.actuator.writeFile(this.workspaceId, dgPath, dgContent);
        this.state?.recordFileChange({ path: dgPath, kind: dgKind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(dgPath, dgContent);
        this.scheduleCheckpoint(`${dgKind} ${dgPath}`);
        return `${dgKind === 'create' ? 'Created' : 'Updated'} ${dgPath} — a developer onboarding guide (setup, project layout, how to add features, testing, deploy, troubleshooting).\n\n${dg.instructions}`;
      }

      case 'generate_env_example': {
        const path = optStr(input, 'path') || '.env.example';
        const refs = this.collectEnvRefs((await this.readEvalSnapshot()).sources);
        let existing: string | null = null;
        try {
          existing = await this.actuator.readFile(this.workspaceId, path);
        } catch {
          existing = null; // none yet — generate fresh from the referenced variables
        }
        const content = generateEnvExample(refs, existing);
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} with ${refs.length} referenced variable(s).`;
      }

      case 'generate_gitignore': {
        const path = optStr(input, 'path') || '.gitignore';
        const content = generateGitignore({ dependencies: getWorkspaceMemory(this.workspaceId).graph().dependencies });
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} (stack-aware).`;
      }

      case 'generate_app_defaults': {
        // U-2 — apply the quality basics BY DEFAULT (SEO/OG meta, viewport, html lang, web manifest,
        // robots.txt), adding only what's missing. Idempotent planning lives in appDefaults.ts.
        const appName = (optStr(input, 'app_name') || 'App').trim() || 'App';
        // Find a standard index.html to patch (Vite/CRA/static). If none, only the standalone files apply.
        let htmlPath: string | null = null;
        let indexHtml: string | null = null;
        for (const p of ['index.html', 'public/index.html']) {
          try { indexHtml = await this.actuator.readFile(this.workspaceId, p); htmlPath = p; break; } catch { /* try next */ }
        }
        const plan = planAppDefaults(indexHtml, appName);
        const written: string[] = [];
        // Patch index.html only if the planner actually changed it.
        if (htmlPath && plan.indexHtml && plan.indexHtml !== indexHtml) {
          await this.actuator.writeFile(this.workspaceId, htmlPath, plan.indexHtml);
          this.state?.recordFileChange({ path: htmlPath, kind: 'modify' }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(htmlPath, plan.indexHtml);
          written.push(htmlPath);
        }
        // Write standalone files only when absent (never clobber a real manifest/robots the app already has).
        for (const [rel, content] of Object.entries(plan.files)) {
          const exists = await this.actuator.readFile(this.workspaceId, rel).then(() => true).catch(() => false);
          if (exists) continue;
          await this.actuator.writeFile(this.workspaceId, rel, content);
          this.state?.recordFileChange({ path: rel, kind: 'create' }, agent);
          written.push(rel);
        }
        if (!written.length) return 'generate_app_defaults: the app already has SEO meta, lang, manifest and robots — nothing to add.';
        this.scheduleCheckpoint('generate app defaults');
        const noHtml = !htmlPath ? ' (no index.html found — wrote standalone files only; for Next.js set metadata in the App Router instead.)' : '';
        return `Applied app defaults — wrote ${written.join(', ')}.${plan.added.length ? ' Added to head: ' + plan.added.join(', ') + '.' : ''}${noHtml}`;
      }

      case 'generate_openapi': {
        const rawRoutes = (input as Record<string, unknown>)?.routes;
        if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
          return 'generate_openapi: routes array is empty or missing. Pass the API routes you built: [{ method, path, summary? }].';
        }
        const routes: RouteSpec[] = rawRoutes.map((r: unknown) => {
          if (typeof r !== 'object' || r === null) throw new Error('Each route entry must be an object with method + path.');
          const obj = r as Record<string, unknown>;
          return { method: reqStr(obj, 'method'), path: reqStr(obj, 'path'), summary: optStr(obj, 'summary') };
        });
        const path = optStr(input, 'path') || 'openapi.json';
        const doc = generateOpenApi(routes, { title: optStr(input, 'title'), version: optStr(input, 'version') });
        const content = JSON.stringify(doc, null, 2);
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — OpenAPI 3.0.3 contract for ${routes.length} route(s).`;
      }

      case 'generate_api_docs': {
        const rawRoutes = (input as Record<string, unknown>)?.routes;
        if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
          return 'generate_api_docs: routes array is empty or missing. Pass the API routes you built: [{ method, path, description?, auth? }].';
        }
        const routes: RouteDoc[] = rawRoutes.map((r: unknown) => {
          if (typeof r !== 'object' || r === null) throw new Error('Each route entry must be an object with method + path.');
          const obj = r as Record<string, unknown>;
          return { method: reqStr(obj, 'method'), path: reqStr(obj, 'path'), description: optStr(obj, 'description'), auth: obj.auth === true };
        });
        const path = optStr(input, 'path') || 'API.md';
        const content = generateApiDocs(routes);
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — API reference for ${routes.length} route(s).`;
      }

      case 'generate_tests': {
        const path = optStr(input, 'path');
        const modulePath = optStr(input, 'module_path');
        if (!path || !modulePath) {
          return 'generate_tests: both "path" (output test file) and "module_path" (import specifier) are required.';
        }
        const rawFns = (input as Record<string, unknown>)?.functions;
        if (!Array.isArray(rawFns) || rawFns.length === 0) {
          return 'generate_tests: functions array is empty or missing. Pass the exported functions to scaffold: [{ name, params?, async? }].';
        }
        const functions: FunctionDef[] = rawFns.map((f: unknown) => {
          if (typeof f !== 'object' || f === null) throw new Error('Each function entry must be an object with a name.');
          const obj = f as Record<string, unknown>;
          const params = Array.isArray(obj.params) ? obj.params.filter((p): p is string => typeof p === 'string') : undefined;
          return { name: reqStr(obj, 'name'), params, async: obj.async === true };
        });
        const content = generateUnitTest({ modulePath, functions });
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — Vitest skeleton for ${functions.length} function(s). Fill in the TODO assertions to verify real behaviour.`;
      }

      case 'generate_integration_tests': {
        // Roadmap BUILD-NOW #14 — REAL integration tests (not TODO skeletons). Emits a full CRUD lifecycle
        // supertest suite with real body assertions PLUS a working in-memory reference app, so the suite is
        // green out of the box; swap the app import to test the real backend. Pure gen in IntegrationTestGenerator.ts.
        const itRec = (input as Record<string, unknown>) || {};
        const itResource = optStr(input, 'resource') || undefined;
        const itBasePath = optStr(input, 'base_path') || undefined;
        const itFields = Array.isArray(itRec.fields)
          ? itRec.fields
              .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
              .map((f) => ({
                name: typeof f.name === 'string' ? f.name : '',
                type:
                  f.type === 'number' || f.type === 'boolean' || f.type === 'string'
                    ? (f.type as 'number' | 'boolean' | 'string')
                    : undefined,
              }))
              .filter((f) => f.name)
          : undefined;
        const itCfg = generateIntegrationTests({ resource: itResource, basePath: itBasePath, fields: itFields });
        const itWritten: string[] = [];
        for (const [path, content] of Object.entries(itCfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          itWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('integration tests');
        const itDeps = itCfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a real integration-test suite:\n${itWritten.join('\n')}\nAdd the dev dependencies: ${itDeps}\n\n${itCfg.instructions}`;
      }

      case 'generate_e2e': {
        // Cap-2 — Playwright E2E scaffold: a real end-to-end setup that DRIVES the running app in a browser
        // and fails on a blank screen / error overlay / console error (render-not-compile). Pure generator
        // (e2eScaffold.ts); this wires it to the workspace (writes files create-only, adds the dep + scripts).
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        // Derive the dev command + a per-route smoke list from the real project (best-effort).
        // Shared derivation (devScript.ts) — this used to be a local copy that knew only dev/start, so
        // a project whose only script is `preview` was told to run `npm run dev` and the generated E2E
        // config pointed at a server that never starts.
        const devCommand = `npm run ${pickDevScript(parsePackageJson(pkgRaw)?.scripts)}`;
        const routes = getWorkspaceMemory(this.workspaceId).graph().routes || [];
        const plan = planE2eScaffold({ appName: optStr(input, 'app_name') || undefined, devCommand, routes });
        const written: string[] = [];
        for (const [p, content] of Object.entries(plan.files)) {
          let exists = false;
          try { await this.actuator.readFile(this.workspaceId, p); exists = true; } catch { exists = false; }
          if (exists) continue; // never clobber an existing E2E config/spec
          await this.actuator.writeFile(this.workspaceId, p, content);
          this.state?.recordFileChange({ path: p, kind: 'create' }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(p, content);
          written.push(p);
        }
        // Add the devDependency + scripts to package.json (best-effort; never clobber an existing entry).
        if (pkgRaw) {
          try {
            const pj = JSON.parse(pkgRaw);
            pj.devDependencies = pj.devDependencies || {};
            let changed = false;
            for (const dep of plan.devDependencies) if (!pj.devDependencies[dep] && !(pj.dependencies && pj.dependencies[dep])) { pj.devDependencies[dep] = '^1.48.0'; changed = true; }
            pj.scripts = pj.scripts || {};
            for (const [k, v] of Object.entries(plan.scripts)) if (!pj.scripts[k]) { pj.scripts[k] = v; changed = true; }
            if (changed) {
              const next = JSON.stringify(pj, null, 2) + '\n';
              await this.actuator.writeFile(this.workspaceId, 'package.json', next);
              getWorkspaceMemory(this.workspaceId).indexFile('package.json', next);
            }
          } catch { /* package.json update is best-effort */ }
        }
        this.scheduleCheckpoint('generate_e2e');
        if (written.length === 0) return 'generate_e2e: a Playwright config + smoke spec already exist — nothing to add.';
        return e2eScaffoldSummary(plan);
      }

      case 'run_tests': {
        // B4 — detect and RUN the project's OWN test suite (vitest/jest/playwright/pytest/Maven/Gradle/go),
        // then read honest pass/fail counts. Stronger evidence than `tsc` alone: the build is EARNED.
        // Detection + parsing are pure (testRunner.ts); this only wires them to the sandbox actuator.
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        const plan = detectTestPlan(files, pkgRaw);
        if (!plan) {
          const msg = 'run_tests: no test suite detected (no real npm "test" script, no vitest/jest/playwright ' +
            'config, no pytest/Maven/Gradle/go tests). Seed real tests with generate_tests, then run_tests again — ' +
            'do NOT report the build verified without running tests.';
          this.state?.appendTerminal(msg);
          return msg;
        }
        const started = Date.now();
        // B4 — run ONE test instead of the whole suite while iterating on a failure. The suite was
        // re-run in full after every fix attempt, spending the user's sandbox minutes (real money)
        // and their wall clock re-proving tests that already passed. The filter is model-written text
        // going into a shell command, so `withTestFilter` quotes it; a runner we cannot filter safely
        // leaves the command ALONE and says so, because a silently-dropped filter would let a green
        // full-suite run be read as proof that one fix worked.
        const filtered = withTestFilter(plan, typeof input?.filter === 'string' ? input.filter : undefined);
        // Make the browser the sandbox ALREADY downloaded visible to a browser suite — without it a
        // perfectly good Playwright run dies on "Executable doesn't exist at …" and we report the
        // app's tests as unverifiable for a reason that was ours, not the app's.
        const testCommand = withSandboxBrowsers(filtered.command, plan.framework);
        const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, testCommand);
        try { this.onCommand?.({ command: testCommand, exitCode, stdout, stderr, durationMs: Date.now() - started }); } catch { /* diagnostics best-effort */ }
        const outcome = parseTestOutcome(plan, exitCode, stdout, stderr);
        const mem = getWorkspaceMemory(this.workspaceId);
        // 🔒 A FILTERED PASS IS NOT A SUITE PASS. Recorded without this, "run_tests PASS" would sit in
        // project memory as evidence the app's tests are green when only one of them ran — and the
        // readiness gate reads that memory. The whole-suite claim has to be earned by a whole-suite run.
        const partial = filtered.applied ? ' (PARTIAL — only tests matching the filter ran)' : '';
        if (outcome.ok) {
          mem.recordAudit(`run_tests PASS${partial} — ${outcome.summary} (${filtered.command})`);
        } else {
          mem.recordError(
            `run_tests FAIL${partial} — ${outcome.summary}` +
            (outcome.failingTests.length ? ` — failing: ${outcome.failingTests.slice(0, 10).join(', ')}` : ''),
          );
        }
        const detail =
          `${outcome.summary}${partial}\n` +
          // The command that ACTUALLY ran, not the unfiltered plan — reporting the plan here would
          // describe a run that did not happen.
          `command: ${filtered.command} — ${plan.reason}\n` +
          (filtered.note ? `${filtered.note}\n` : '') +
          (filtered.applied
            ? 'This was a FILTERED run. Run run_tests with no filter before calling the build done.\n'
            : '') +
          (outcome.failingTests.length ? `failing:\n  ${outcome.failingTests.slice(0, 20).join('\n  ')}\n` : '') +
          `\n[stdout tail]\n${stdout.slice(-1500)}` +
          (stderr ? `\n[stderr tail]\n${stderr.slice(-800)}` : '');
        this.state?.appendTerminal(detail);
        return detail;
      }

      case 'typecheck': {
        // B6 — cross-language TYPE-CHECK beyond tsc: run mypy (Python) + javac/Maven/Gradle (Java) +
        // `go build ./...` (Go) so a polyglot app's non-TS code is type/compile-checked too. Detection +
        // parsing are pure (crossLangTypecheck.ts); this wires them to the sandbox actuator. Honest: a
        // missing toolchain reports "could not run", never a fake pass.
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        // FRONTEND SYNTAX LOCATOR (deep-test 2026-07-18). A model verifying "does it compile?" runs
        // `tsc` by hand — but `tsc | head` masks the exit code and tsc never crisply pinpoints a JSX PARSE
        // error (an unbalanced tag, a duplicate declaration), so the model burned ~40 steps hand-counting
        // <div> tags with grep/awk/python and never converged. esbuild reports the EXACT file:line:col for
        // every unparseable frontend file — surface it FIRST so the model fixes the precise location in one
        // step instead of flailing. Best-effort (bounded to 20 frontend files); never breaks typecheck.
        let syntaxHeader = '';
        try {
          const jsFiles = files.filter((f) => /\.(mjs|cjs|jsx?|tsx?)$/i.test(f) && !/\.d\.ts$/i.test(f)).slice(0, 20);
          const fileMap: Record<string, string> = {};
          for (const p of jsFiles) { try { fileMap[p] = await this.actuator.readFile(this.workspaceId, p); } catch { /* skip unreadable */ } }
          const se = await findSyntaxErrors(fileMap);
          if (se.length > 0) {
            getWorkspaceMemory(this.workspaceId).recordError(`syntax: ${se.length} file(s) do not parse.`);
            syntaxHeader = `SYNTAX ERROR(S) — the app will NOT compile. Fix these EXACT locations (do NOT hand-count tags/braces):\n${syntaxRepairInstruction(se)}\n\n`;
          }
        } catch { /* frontend syntax locator is best-effort — never breaks the tool */ }
        const configs: Record<string, string> = {};
        for (const cfg of ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt']) {
          try { configs[cfg] = await this.actuator.readFile(this.workspaceId, cfg); } catch { /* absent */ }
        }
        const plans = detectTypecheckPlan(files, configs);
        let crossLang = '';
        if (plans.length > 0) {
          const outcomes: TypecheckOutcome[] = [];
          for (const plan of plans) {
            let r: { exitCode: number; stdout: string; stderr: string };
            try { r = await this.actuator.runCommand(this.workspaceId, plan.command); }
            catch (e) { r = { exitCode: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }; }
            outcomes.push(parseTypecheckOutcome(plan.lang, r.exitCode, r.stdout, r.stderr));
          }
          const failing = outcomes.filter((o) => o.ran && !o.ok);
          if (failing.length) getWorkspaceMemory(this.workspaceId).recordError(`typecheck: ${failing.map((o) => `${o.lang} ${o.errorCount} error(s)`).join(', ')}.`);
          crossLang = typecheckSummary(outcomes);
        }
        // REAL semantic type-check (deep-test autopsy 2026-08-01): esbuild's frontend check above only
        // catches PARSE errors — it is BLIND to SEMANTIC TypeScript errors (a duplicate identifier, an
        // `import type` used as a value, a class that doesn't extend Component so `this.state`/`this.props`
        // "do not exist", a value used as a type). A real SaaS-dashboard build spent 30 min getting
        // false-green esbuild typechecks, then failed the final `tsc && vite build` on exactly those
        // (TS2300 duplicate 'Team', TS1361 import-type, TS2339 ErrorBoundary state/props, TS2749). Running
        // the REAL, incremental `tsc --noEmit` HERE surfaces them per file so the agent fixes them the
        // moment they appear — not 30 minutes later at the final build. Only for a TS project; a syntax
        // break is fixed FIRST (tsc on unparseable code just echoes parse noise). Honest: a tsc that can't
        // run is silently skipped (the esbuild note still stands) — never a fake pass.
        let tscHeader = '';
        let tscRanClean = false;
        const isTsProject = files.includes('tsconfig.json')
          && files.some((f) => /\.tsx?$/i.test(f) && !/\.d\.ts$/i.test(f));
        if (isTsProject && !syntaxHeader) {
          try {
            const r = await withTimeout(
              this.actuator.runCommand(
                this.workspaceId,
                robustTscCommand('--noEmit --incremental --tsBuildInfoFile /tmp/agentv3.tsbuildinfo', '2>&1 | head -60'),
              ),
              30_000,
              'typecheck-tsc',
            );
            const combined = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
            const tscErrs = parseTscErrors(combined);
            if (tscErrs.length > 0) {
              getWorkspaceMemory(this.workspaceId).recordError(`typecheck: ${tscErrs.length} TypeScript error(s).`);
              tscHeader = `TYPE ERROR(S) — the production build (\`tsc && vite build\`) will FAIL until these are fixed. esbuild's parse-only check does NOT catch them; fix the EXACT file:line locations below:\n${combined}\n\n`;
            } else {
              tscRanClean = true;
            }
          } catch { /* real-tsc pass is best-effort — a toolchain miss must never fake a pass */ }
        }
        if (syntaxHeader || tscHeader) {
          return `${syntaxHeader}${tscHeader}${crossLang || 'No Python/Java/Go sources to check.'}`.trim();
        }
        const feHeadline = tscRanClean
          ? 'frontend parses clean (esbuild) AND type-checks clean (tsc --noEmit)'
          : 'frontend parses clean (esbuild)';
        return crossLang || `typecheck: ${feHeadline}; no Python, Java, or Go sources detected.`;
      }

      case 'code_graph': {
        // A1 — QUERY the repo's structure (who-imports / change-impact / local deps / where-defined)
        // from the indexed project graph, instead of prompt-stuffing or grepping. Pure logic lives in
        // codeGraph.ts; this reads the live WorkspaceMemory graph. Cheap, deterministic, read-only.
        const q = optStr(input, 'query') || 'impact';
        const target = reqStr(input, 'target');
        const graph = getWorkspaceMemory(this.workspaceId).graph();
        if (q === 'defines') {
          const defs = definitionsOf(graph, target);
          return defs.length
            ? `"${target}" is defined in:\n` + defs.map(d => `  ${d.file} (${d.kind})`).join('\n')
            : `No exported symbol named "${target}" in the index. Use grep for a non-exported/local name.`;
        }
        if (q === 'references' || q === 'who_calls' || q === 'where_used') {
          const users = referencesOf(graph, target);
          const defs = definitionsOf(graph, target);
          const defNote = defs.length ? ` (defined in ${defs.map(d => d.file).join(', ')})` : '';
          return users.length
            ? `"${target}"${defNote} is used in ${users.length} file(s):\n` + users.map(f => `  ${f}`).join('\n')
            : `"${target}"${defNote} is not referenced by any indexed file (unused, or referenced only where it is defined).`;
        }
        const file = resolveGraphFile(graph, target);
        if (!file) {
          return `code_graph: "${target}" did not resolve to a single indexed file. Pass an exact workspace path (e.g. src/App.tsx), or use query="defines" for a symbol.`;
        }
        if (q === 'who_imports') {
          const who = whoImports(graph, file);
          return who.length
            ? `${file} is imported by ${who.length} file(s):\n` + who.map(f => `  ${f}`).join('\n')
            : `Nothing imports ${file} (an entry point, or possibly dead code).`;
        }
        if (q === 'depends_on') {
          const deps = dependenciesOf(graph, file);
          return deps.length
            ? `${file} imports (local) ${deps.length} file(s):\n` + deps.map(f => `  ${f}`).join('\n')
            : `${file} has no local imports.`;
        }
        // default: impact
        const impact = impactOf(graph, file);
        return impact.length
          ? `Changing ${file} may affect ${impact.length} file(s) that import it directly or transitively — review these before/after the edit:\n` + impact.map(f => `  ${f}`).join('\n')
          : `Changing ${file} affects no other files (nothing imports it).`;
      }

      case 'architecture_map': {
        // A2 — a cheap "how is this app structured / where do I start" orientation from the A1 import
        // graph: entry points, the most-imported core modules, structural areas, key deps + a reading
        // order. Read-only; use it to onboard to an unfamiliar/imported app before editing.
        const map = buildArchitectureMap(getWorkspaceMemory(this.workspaceId).graph());
        return renderArchitectureMap(map);
      }

      case 'find_dead_code': {
        // Surface built-but-unwired modules (nothing imports them, and they aren't entries/tests/configs/
        // routes) — a common "created it, forgot to wire it in" bug. Reuses the A1 import graph. Advisory.
        const files = findUnwiredFiles(getWorkspaceMemory(this.workspaceId).graph());
        if (files.length) getWorkspaceMemory(this.workspaceId).recordAudit(`find_dead_code: ${files.length} unwired file(s) (e.g. ${files[0]}).`);
        const summary = unwiredFilesSummary(files);
        this.state?.appendTerminal(summary);
        return summary;
      }

      case 'find_code_smells': {
        // T3 — advisory scan for magic numbers + duplicate blocks. Pure analyzer in CodeSmellAnalyzer.ts.
        let csFiles: string[];
        try { csFiles = await this.actuator.listFiles(this.workspaceId); }
        catch { return 'find_code_smells: failed to list workspace files.'; }
        const CS_CODE = /\.(t|j)sx?$/;
        const CS_SKIP = /(node_modules|dist|build|coverage|\.next|\.git|\.test\.|\.spec\.)/;
        const csCode = csFiles.filter((f) => CS_CODE.test(f) && !CS_SKIP.test(f)).slice(0, 300);
        const csContents: { path: string; content: string }[] = [];
        for (const f of csCode) {
          try { csContents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); }
          catch { /* skip unreadable */ }
        }
        const csOut = renderCodeSmells(analyzeCodeSmells(csContents));
        this.state?.appendTerminal(csOut);
        return csOut;
      }

      case 'api_graph': {
        // GA-5 — map backend routes vs frontend API calls and flag calls with NO matching route (the
        // classic silent full-stack bug: compiles + preview loads, feature broken at runtime). Best-effort
        // (reads call sites, not a running server); pure logic in apiGraph.ts.
        let files: string[];
        try { files = await this.actuator.listFiles(this.workspaceId); }
        catch { return 'api_graph: failed to list workspace files.'; }
        const CODE = /\.(t|j)sx?$|\.py$|\.java$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const codeFiles = files.filter(f => CODE.test(f) && !SKIP.test(f)).slice(0, 300);
        const contents: { path: string; content: string }[] = [];
        for (const f of codeFiles) {
          try { contents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); }
          catch { /* skip unreadable */ }
        }
        const g = buildApiGraph(contents);
        if (!g.defined.length && !g.called.length) return 'api_graph: no HTTP routes or API calls detected in the workspace.';
        // GA-5 drill-down: `endpoint="METHOD /path"` → the change-propagation blast radius for that one
        // route (which frontend call sites depend on it), mirroring schema_graph's `model=` drill-down.
        const endpointTarget = optStr(input, 'endpoint');
        if (endpointTarget) return apiEndpointBlastReport(g, endpointTarget);
        const lines: string[] = [`API graph — ${g.defined.length} route(s) defined, ${g.called.length} frontend call site(s).`];
        if (g.missing.length) {
          lines.push(`\nMISSING — ${g.missing.length} frontend call(s) with NO matching backend route (likely broken; add the route or fix the path/method):`);
          for (const m of g.missing.slice(0, 20)) lines.push(`  ${m.method} ${m.path}  (${m.file})`);
          getWorkspaceMemory(this.workspaceId).recordError(`api_graph: ${g.missing.length} frontend call(s) with no backend route (e.g. ${g.missing[0].method} ${g.missing[0].path}).`);
        } else if (g.defined.length) {
          lines.push('\nOK — every detected frontend call matches a defined backend route.');
        }
        if (g.unused.length) {
          lines.push(`\n${g.unused.length} defined route(s) with no detected caller (dead, or called from outside this repo):`);
          for (const u of g.unused.slice(0, 15)) lines.push(`  ${u.method} ${u.path}  (${u.file})`);
        }
        this.state?.appendTerminal(lines.join('\n'));
        return lines.join('\n');
      }

      case 'lint': {
        // GA-12 — run the project's OWN ESLint + Prettier (real bug/style class tsc doesn't cover).
        // Detection/parsing are pure (lintRunner.ts); this runs each configured linter in the sandbox.
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        const plans = detectLinters(files, pkgRaw);
        if (!plans.length) {
          const msg = 'lint: no ESLint or Prettier config detected — nothing to lint. (typecheck still covers type errors.)';
          this.state?.appendTerminal(msg);
          return msg;
        }
        const mem = getWorkspaceMemory(this.workspaceId);
        const parts: string[] = [];
        let allOk = true;
        for (const plan of plans) {
          const started = Date.now();
          const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, plan.command);
          try { this.onCommand?.({ command: plan.command, exitCode, stdout, stderr, durationMs: Date.now() - started }); } catch { /* best-effort */ }
          const outcome = parseLintOutcome(plan, exitCode, stdout, stderr);
          if (!outcome.ok) allOk = false;
          if (outcome.ok) mem.recordAudit(`lint PASS — ${outcome.summary}`);
          else mem.recordError(`lint FAIL — ${outcome.summary}${outcome.firstIssues.length ? '\n' + outcome.firstIssues.join('\n') : ''}`);
          parts.push(`${outcome.summary}${outcome.firstIssues.length ? '\n  ' + outcome.firstIssues.join('\n  ') : ''}`);
        }
        const detail = `${allOk ? 'LINT OK' : 'LINT FAILED'} (${plans.length} linter${plans.length === 1 ? '' : 's'})\n` + parts.join('\n');
        this.state?.appendTerminal(detail);
        return detail;
      }

      case 'check_package': {
        // GA-3 — catch package.json foot-guns other tools miss: an npm script that runs a build tool the
        // project never installed (fails with "command not found"), and a dep declared twice. Pure logic.
        let pkgRaw: string;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); }
        catch { return 'check_package: no package.json in the workspace.'; }
        const result = analyzePackageHealth(pkgRaw);
        if (!result.ok) {
          getWorkspaceMemory(this.workspaceId).recordError(`check_package: ${result.issues.map(i => i.detail).join(' | ')}`);
        }
        const summary = packageHealthSummary(result);
        this.state?.appendTerminal(summary);
        return summary;
      }

      case 'check_toolchain': {
        // D11 — surface the toolchain the project DECLARES (.nvmrc/engines/.python-version/go.mod/
        // Maven pom.xml + Gradle build.gradle Java) and flag internal contradictions (two files
        // disagreeing) — a silent cause of build drift. Pure logic.
        const wanted = ['.nvmrc', '.node-version', 'package.json', '.python-version', 'runtime.txt', 'pyproject.toml', '.java-version', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod'];
        const map: Record<string, string> = {};
        for (const f of wanted) {
          try { map[f] = await this.actuator.readFile(this.workspaceId, f); } catch { /* file not present */ }
        }
        const r = analyzeToolchain(map);
        if (r.inconsistencies.length) getWorkspaceMemory(this.workspaceId).recordError(`check_toolchain: ${r.inconsistencies.join(' | ')}`);
        const detail = r.summary + (r.inconsistencies.length ? '\n' + r.inconsistencies.map(i => '  • ' + i).join('\n') : '');
        this.state?.appendTerminal(detail);
        return detail;
      }

      case 'generate_observability': {
        const rawTarget = optStr(input, 'target');
        const target: ObservabilityTarget = rawTarget === 'frontend' || rawTarget === 'backend' ? rawTarget : 'both';
        const { files, summary } = generateObservability({ target });
        const written: string[] = [];
        const wiring: string[] = [];
        for (const file of files) {
          let kind: 'create' | 'modify' = 'create';
          try {
            await this.actuator.readFile(this.workspaceId, file.path);
            kind = 'modify';
          } catch {
            kind = 'create';
          }
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(file.path, file.content);
          written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${file.path}`);
          wiring.push(`• ${file.path}: ${file.wiring}`);
        }
        if (written.length === 0) return 'generate_observability: nothing generated.';
        this.scheduleCheckpoint(`observability (${target})`);
        return `${summary}\n${written.join('\n')}\nWire each in with edit_file:\n${wiring.join('\n')}`;
      }

      case 'generate_bundle_optimization': {
        let hasViteConfig = false;
        try {
          await this.actuator.readFile(this.workspaceId, 'vite.config.ts');
          hasViteConfig = true;
        } catch {
          try {
            await this.actuator.readFile(this.workspaceId, 'vite.config.js');
            hasViteConfig = true;
          } catch {
            hasViteConfig = false;
          }
        }
        const { files, manualChunksSnippet, summary } = generateBundleOptimization({ hasViteConfig });
        const written: string[] = [];
        for (const file of files) {
          let kind: 'create' | 'modify' = 'create';
          try {
            await this.actuator.readFile(this.workspaceId, file.path);
            kind = 'modify';
          } catch {
            kind = 'create';
          }
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(file.path, file.content);
          written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${file.path}`);
        }
        this.scheduleCheckpoint('bundle optimization');
        const mergeNote = hasViteConfig
          ? `\nMerge this into your vite.config.ts (inside defineConfig({ ... })):\n${manualChunksSnippet}`
          : '';
        return `${summary}\n${written.join('\n')}${mergeNote}`;
      }

      case 'generate_seed_data': {
        const rawEntities = (input as Record<string, unknown>)?.entities;
        if (!Array.isArray(rawEntities) || rawEntities.length === 0) {
          return 'generate_seed_data: entities array is empty or missing. Pass [{ name, fields: [{ name, type? }] }].';
        }
        const entities: EntitySpec[] = rawEntities.map((e: unknown) => {
          if (typeof e !== 'object' || e === null) throw new Error('Each entity must be an object with name + fields.');
          const obj = e as Record<string, unknown>;
          const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
          const fields = rawFields
            .map((f: unknown) => {
              if (typeof f !== 'object' || f === null) return null;
              const fo = f as Record<string, unknown>;
              const name = typeof fo.name === 'string' ? fo.name : '';
              return name ? { name, type: typeof fo.type === 'string' ? fo.type : undefined } : null;
            })
            .filter((f): f is { name: string; type: string | undefined } => f !== null);
          return { name: reqStr(obj, 'name'), fields };
        });
        const countRaw = (input as Record<string, unknown>)?.count;
        const count = typeof countRaw === 'number' && countRaw > 0 ? Math.floor(countRaw) : 10;
        const path = optStr(input, 'path') || 'fixtures/seed.json';
        const { json, summary } = generateSeedData(entities, count);
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, json);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, json);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — ${summary}`;
      }

      case 'generate_auth': {
        const rawType = optStr(input, 'type');
        // 'supabase' is the ZERO-SETUP path (ROADMAP #1 Phase 1.3): when one-click provisioning has
        // already put VITE_SUPABASE_URL/ANON_KEY in the workspace, the generated auth works on the
        // first build with nothing for the user to configure.
        const type: AuthType = rawType === 'firebase' || rawType === 'supabase' ? rawType : 'jwt';
        const { files, dependencies, summary } = generateAuthCode({ type });
        const written: string[] = [];
        const wiring: string[] = [];
        for (const file of files) {
          let kind: 'create' | 'modify' = 'create';
          try {
            await this.actuator.readFile(this.workspaceId, file.path);
            kind = 'modify';
          } catch {
            kind = 'create';
          }
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(file.path, file.content);
          written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${file.path}`);
          wiring.push(`• ${file.path}: ${file.wiring}`);
        }
        this.scheduleCheckpoint(`auth (${type})`);
        const depNote = dependencies.length ? `\nInstall: npm i ${dependencies.join(' ')}` : '';
        return `${summary}\n${written.join('\n')}${depNote}\nWire in with edit_file:\n${wiring.join('\n')}`;
      }

      case 'generate_migration': {
        const rawEntities = (input as Record<string, unknown>)?.entities;
        if (!Array.isArray(rawEntities) || rawEntities.length === 0) {
          return 'generate_migration: entities array is empty or missing. Pass [{ name, fields: [{ name, type? }] }].';
        }
        const entities: MigrationEntity[] = rawEntities.map((e: unknown) => {
          if (typeof e !== 'object' || e === null) throw new Error('Each entity must be an object with name + fields.');
          const obj = e as Record<string, unknown>;
          const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
          const fields = rawFields
            .map((f: unknown) => {
              if (typeof f !== 'object' || f === null) return null;
              const fo = f as Record<string, unknown>;
              const name = typeof fo.name === 'string' ? fo.name : '';
              return name ? { name, type: typeof fo.type === 'string' ? fo.type : undefined } : null;
            })
            .filter((f): f is { name: string; type: string | undefined } => f !== null);
          return { name: reqStr(obj, 'name'), fields };
        });
        const rawDialect = optStr(input, 'dialect');
        const dialect: MigrationDialect = rawDialect === 'prisma' || rawDialect === 'sql' ? rawDialect : 'both';
        const rawProvider = optStr(input, 'provider');
        const provider: SqlProvider = rawProvider === 'mysql' || rawProvider === 'sqlite' ? rawProvider : 'postgresql';
        const { files, summary } = generateMigration(entities, { dialect, provider });
        if (files.length === 0) return 'generate_migration: nothing generated.';
        const written: string[] = [];
        for (const file of files) {
          let kind: 'create' | 'modify' = 'create';
          try {
            await this.actuator.readFile(this.workspaceId, file.path);
            kind = 'modify';
          } catch {
            kind = 'create';
          }
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(file.path, file.content);
          written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${file.path}`);
        }
        this.scheduleCheckpoint(`migration (${provider})`);
        return `${summary}\n${written.join('\n')}`;
      }

      case 'generate_crud': {
        // T1.2 recipe — a COMPLETE CRUD REST resource on Prisma (zod validation + paginated/filtered/
        // sorted list + validated create/update + SOFT delete). Pure generator in CrudGenerator.ts;
        // pairs with generate_migration's schema (soft-delete deletedAt + timestamps).
        const crudRec = (input as Record<string, unknown>) || {};
        const crudName = typeof crudRec.name === 'string' ? crudRec.name : '';
        if (!crudName) return 'generate_crud: pass the resource "name" (e.g. "Post") and its "fields".';
        const crudRawFields = Array.isArray(crudRec.fields) ? crudRec.fields : [];
        const crudFields = crudRawFields
          .map((f: unknown) => {
            if (typeof f !== 'object' || f === null) return null;
            const fo = f as Record<string, unknown>;
            const fname = typeof fo.name === 'string' ? fo.name : '';
            return fname ? { name: fname, type: typeof fo.type === 'string' ? fo.type : undefined } : null;
          })
          .filter((f): f is { name: string; type: string | undefined } => f !== null);
        const crud = generateCrudResource({ name: crudName, fields: crudFields }, { protected: crudRec.protected === true });
        const crudWritten: string[] = [];
        for (const [path, content] of Object.entries(crud.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          crudWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint(`crud resource (${crudName})`);
        const crudDeps = crud.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a CRUD resource for ${crudName}:\n${crudWritten.join('\n')}\nAdd the dependencies: ${crudDeps}\n\n${crud.instructions}`;
      }

      case 'generate_booking': {
        // Breadth recipe (domain vertical) — booking/appointments (server/booking/): a real BookingService
        // with CORRECT double-booking prevention + an Express router. Pure generator in BookingGenerator.ts.
        const bkcfg = generateBookingIntegration();
        const bkWritten: string[] = [];
        for (const [path, content] of Object.entries(bkcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          bkWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('booking starter');
        const bkDeps = bkcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a booking/appointment backend:\n${bkWritten.join('\n')}\nAdd the dependencies: ${bkDeps}\n\n${bkcfg.instructions}`;
      }

      case 'generate_inventory': {
        // Breadth recipe (domain vertical) — inventory/stock (server/inventory/): a real InventoryService with
        // NO-OVERSELL reserve + an Express router. Pure generator in InventoryGenerator.ts.
        const invcfg = generateInventoryIntegration();
        const invWritten: string[] = [];
        for (const [path, content] of Object.entries(invcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          invWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('inventory starter');
        const invDeps = invcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an inventory/stock backend:\n${invWritten.join('\n')}\nAdd the dependencies: ${invDeps}\n\n${invcfg.instructions}`;
      }

      case 'generate_crm': {
        // Breadth recipe (domain vertical) — CRM/lead-pipeline (server/crm/): a real CrmService with a
        // sales-stage STATE-MACHINE + open-pipeline value + an Express router. Pure gen in CrmGenerator.ts.
        const crmcfg = generateCrmIntegration();
        const crmWritten: string[] = [];
        for (const [path, content] of Object.entries(crmcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          crmWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('crm starter');
        const crmDeps = crmcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a CRM / lead-pipeline backend:\n${crmWritten.join('\n')}\nAdd the dependencies: ${crmDeps}\n\n${crmcfg.instructions}`;
      }

      case 'generate_hospital_erp': {
        // Breadth recipe (domain vertical) — Hospital-ERP / EMR (server/hospital/): a real HospitalService
        // with THREE guarantees — no doctor double-booking (409), RBAC on patient-record writes (403), and an
        // immutable audit log — plus an Express router. Pure gen in HospitalErpGenerator.ts.
        const hospcfg = generateHospitalErpIntegration();
        const hospWritten: string[] = [];
        for (const [path, content] of Object.entries(hospcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          hospWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('hospital-erp starter');
        const hospDeps = hospcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Hospital-ERP / EMR backend:\n${hospWritten.join('\n')}\nAdd the dependencies: ${hospDeps}\n\n${hospcfg.instructions}`;
      }

      case 'generate_school_erp': {
        // Breadth recipe (domain vertical) — School / Education-ERP (server/school/): a real SchoolService
        // with THREE guarantees — idempotent attendance, valid grades (0..maxMarks), and an exact fee ledger
        // (balance = invoiced − paid, never negative) — plus an Express router. Pure gen in SchoolErpGenerator.ts.
        const schoolcfg = generateSchoolErpIntegration();
        const schoolWritten: string[] = [];
        for (const [path, content] of Object.entries(schoolcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          schoolWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('school-erp starter');
        const schoolDeps = schoolcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a School / Education-ERP backend:\n${schoolWritten.join('\n')}\nAdd the dependencies: ${schoolDeps}\n\n${schoolcfg.instructions}`;
      }

      case 'generate_courier': {
        // Breadth recipe (domain vertical) — Courier / Logistics (server/courier/): a real CourierService
        // with a shipment STATE-MACHINE (invalid jumps → 409), append-only tracking history and unique
        // tracking numbers, plus an Express router. Pure gen in CourierGenerator.ts.
        const courriercfg = generateCourierIntegration();
        const courierWritten: string[] = [];
        for (const [path, content] of Object.entries(courriercfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          courierWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('courier starter');
        const courierDeps = courriercfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Courier / Logistics backend:\n${courierWritten.join('\n')}\nAdd the dependencies: ${courierDeps}\n\n${courriercfg.instructions}`;
      }

      case 'generate_restaurant_pos': {
        // Breadth recipe (domain vertical) — Restaurant / POS (server/restaurant/): a real RestaurantService
        // with a table STATE-MACHINE + KOT order lifecycle (invalid jumps → 409) + an EXACT GST bill, plus an
        // Express router. Pure gen in RestaurantPosGenerator.ts.
        const restcfg = generateRestaurantPosIntegration();
        const restWritten: string[] = [];
        for (const [path, content] of Object.entries(restcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          restWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('restaurant-pos starter');
        const restDeps = restcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Restaurant / POS backend:\n${restWritten.join('\n')}\nAdd the dependencies: ${restDeps}\n\n${restcfg.instructions}`;
      }

      case 'generate_real_estate': {
        // Breadth recipe (domain vertical) — Real-estate / property portal (server/realestate/): a real
        // RealEstateService with a listing STATE-MACHINE (invalid jumps → 409) + append-only price history +
        // on-market-only inquiries, plus an Express router. Pure gen in RealEstateGenerator.ts.
        const recfg = generateRealEstateIntegration();
        const reWritten: string[] = [];
        for (const [path, content] of Object.entries(recfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          reWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('real-estate starter');
        const reDeps = recfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Real-estate / property-portal backend:\n${reWritten.join('\n')}\nAdd the dependencies: ${reDeps}\n\n${recfg.instructions}`;
      }

      case 'generate_fitness': {
        // Breadth recipe (domain vertical) — Fitness / gym (server/fitness/): a real FitnessService with a
        // membership validity gate (inactive → 409), deterministic renew/freeze date-math, and idempotent
        // check-ins, plus an Express router. Pure gen in FitnessGenerator.ts.
        const fitcfg = generateFitnessIntegration();
        const fitWritten: string[] = [];
        for (const [path, content] of Object.entries(fitcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          fitWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('fitness starter');
        const fitDeps = fitcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Fitness / gym backend:\n${fitWritten.join('\n')}\nAdd the dependencies: ${fitDeps}\n\n${fitcfg.instructions}`;
      }

      case 'generate_pharmacy': {
        // Breadth recipe (domain vertical) — Pharmacy (server/pharmacy/): a real PharmacyService with an
        // expiry gate (409), FEFO dispensing that never oversells (409), and a controlled-substance Rx gate
        // (403), plus an Express router. Pure gen in PharmacyGenerator.ts.
        const phcfg = generatePharmacyIntegration();
        const phWritten: string[] = [];
        for (const [path, content] of Object.entries(phcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          phWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('pharmacy starter');
        const phDeps = phcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Pharmacy backend:\n${phWritten.join('\n')}\nAdd the dependencies: ${phDeps}\n\n${phcfg.instructions}`;
      }

      case 'generate_recruitment': {
        // Breadth recipe (domain vertical) — Recruitment / job-board (server/recruitment/): a real
        // RecruitmentService with a hiring-pipeline STATE-MACHINE (invalid jumps → 409), one-application-per-
        // candidate-per-job, and a closed-job guard, plus an Express router. Pure gen in RecruitmentGenerator.ts.
        const rccfg = generateRecruitmentIntegration();
        const rcWritten: string[] = [];
        for (const [path, content] of Object.entries(rccfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('recruitment starter');
        const rcDeps = rccfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Recruitment / job-board backend:\n${rcWritten.join('\n')}\nAdd the dependencies: ${rcDeps}\n\n${rccfg.instructions}`;
      }

      case 'generate_invoicing': {
        // Breadth recipe (domain vertical) — Invoicing / billing (server/invoicing/): a real InvoicingService
        // with an invoice STATE-MACHINE (invalid jumps → 409), an exact payment ledger (no overpay → 409,
        // auto-paid at zero), and a DERIVED overdue status, plus an Express router. Pure gen in InvoicingGenerator.ts.
        const invcfg = generateInvoicingIntegration();
        const invWritten: string[] = [];
        for (const [path, content] of Object.entries(invcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          invWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('invoicing starter');
        const invDeps = invcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an Invoicing / billing backend:\n${invWritten.join('\n')}\nAdd the dependencies: ${invDeps}\n\n${invcfg.instructions}`;
      }

      case 'generate_helpdesk': {
        // Breadth recipe (domain vertical) — Helpdesk / ticketing (server/helpdesk/): a real HelpdeskService
        // with a ticket STATE-MACHINE (invalid jumps → 409), priority-driven SLA breach detection, and an
        // append-only thread, plus an Express router. Pure gen in HelpdeskGenerator.ts.
        const hdcfg = generateHelpdeskIntegration();
        const hdWritten: string[] = [];
        for (const [path, content] of Object.entries(hdcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          hdWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('helpdesk starter');
        const hdDeps = hdcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a Helpdesk / ticketing backend:\n${hdWritten.join('\n')}\nAdd the dependencies: ${hdDeps}\n\n${hdcfg.instructions}`;
      }

      case 'generate_events': {
        // Breadth recipe (domain vertical) — events/RSVP (server/events/): a real EventService with CAPACITY
        // enforcement + a waitlist (auto-promote on cancel) + an Express router. Pure gen in EventsGenerator.ts.
        const evcfg = generateEventsIntegration();
        const evWritten: string[] = [];
        for (const [path, content] of Object.entries(evcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          evWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('events starter');
        const evDeps = evcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an events/RSVP backend:\n${evWritten.join('\n')}\nAdd the dependencies: ${evDeps}\n\n${evcfg.instructions}`;
      }

      case 'generate_subscriptions': {
        // Breadth recipe (domain vertical) — subscriptions/recurring billing (server/subscriptions/): a real
        // SubscriptionService with a lifecycle STATE-MACHINE + renewal-date math + an Express router. Pure gen
        // in SubscriptionGenerator.ts.
        const subcfg = generateSubscriptionIntegration();
        const subWritten: string[] = [];
        for (const [path, content] of Object.entries(subcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          subWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('subscriptions starter');
        const subDeps = subcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a subscriptions / recurring-billing backend:\n${subWritten.join('\n')}\nAdd the dependencies: ${subDeps}\n\n${subcfg.instructions}`;
      }

      case 'generate_polls': {
        // Breadth recipe (domain vertical) — polls/surveys (server/polls/): a real PollService with VOTE
        // INTEGRITY (one vote per voter) + tally + an Express router. Pure gen in PollsGenerator.ts.
        const plcfg = generatePollsIntegration();
        const plWritten: string[] = [];
        for (const [path, content] of Object.entries(plcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          plWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('polls starter');
        const plDeps = plcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a polls/surveys backend:\n${plWritten.join('\n')}\nAdd the dependencies: ${plDeps}\n\n${plcfg.instructions}`;
      }

      case 'generate_blog': {
        // Breadth recipe (domain vertical) — blog/CMS (server/blog/): a real BlogService with a publish
        // STATE-MACHINE (draft↔published↔archived) + UNIQUE-slug generation + an Express router. Pure gen
        // in BlogGenerator.ts.
        const blogcfg = generateBlogIntegration();
        const blogWritten: string[] = [];
        for (const [path, content] of Object.entries(blogcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          blogWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('blog starter');
        const blogDeps = blogcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a blog/CMS backend:\n${blogWritten.join('\n')}\nAdd the dependencies: ${blogDeps}\n\n${blogcfg.instructions}`;
      }

      case 'generate_reviews': {
        // Breadth recipe (domain vertical) — reviews/ratings (server/reviews/): a real ReviewService with
        // RATING INTEGRITY (1..5 bounds, one review per (item,user), exact aggregate) + an Express router.
        // Pure gen in ReviewsGenerator.ts.
        const revcfg = generateReviewsIntegration();
        const revWritten: string[] = [];
        for (const [path, content] of Object.entries(revcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          revWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('reviews starter');
        const revDeps = revcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a reviews/ratings backend:\n${revWritten.join('\n')}\nAdd the dependencies: ${revDeps}\n\n${revcfg.instructions}`;
      }

      case 'generate_loyalty': {
        // Breadth recipe (domain vertical) — loyalty/points-wallet (server/loyalty/): a real LoyaltyService
        // with LEDGER INTEGRITY (balance = sum(earned) − sum(redeemed), never negative; no overdraft) + an
        // Express router. Pure gen in LoyaltyGenerator.ts.
        const loycfg = generateLoyaltyIntegration();
        const loyWritten: string[] = [];
        for (const [path, content] of Object.entries(loycfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          loyWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('loyalty starter');
        const loyDeps = loycfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a loyalty/points-wallet backend:\n${loyWritten.join('\n')}\nAdd the dependencies: ${loyDeps}\n\n${loycfg.instructions}`;
      }

      case 'generate_referrals': {
        // Breadth recipe (growth vertical) — referral/invite (server/referrals/): a real ReferralService with
        // ATTRIBUTION INTEGRITY (unique code, refer-once, no self-referral, credit-once) + an Express router.
        // Pure gen in ReferralsGenerator.ts.
        const refcfg = generateReferralsIntegration();
        const refWritten: string[] = [];
        for (const [path, content] of Object.entries(refcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          refWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('referrals starter');
        const refDeps = refcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a referral/invite backend:\n${refWritten.join('\n')}\nAdd the dependencies: ${refDeps}\n\n${refcfg.instructions}`;
      }

      case 'generate_comments': {
        // Breadth recipe (domain vertical) — threaded comments (server/comments/): a real CommentService with
        // THREAD INTEGRITY (reply needs an existing parent, computed depth, soft-delete keeps children) + an
        // Express router. Pure gen in CommentsGenerator.ts.
        const cmtcfg = generateCommentsIntegration();
        const cmtWritten: string[] = [];
        for (const [path, content] of Object.entries(cmtcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          cmtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('comments starter');
        const cmtDeps = cmtcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a threaded-comments backend:\n${cmtWritten.join('\n')}\nAdd the dependencies: ${cmtDeps}\n\n${cmtcfg.instructions}`;
      }

      case 'generate_messaging': {
        // Breadth recipe (domain vertical) — direct messaging (server/messaging/): a real MessagingService with
        // CONVERSATION INTEGRITY (canonical participant pairing, exact unread, monotonic read cursor) + an
        // Express router. Pure gen in MessagingGenerator.ts.
        const msgcfg = generateMessagingIntegration();
        const msgWritten: string[] = [];
        for (const [path, content] of Object.entries(msgcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          msgWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('messaging starter');
        const msgDeps = msgcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a direct-messaging backend:\n${msgWritten.join('\n')}\nAdd the dependencies: ${msgDeps}\n\n${msgcfg.instructions}`;
      }

      case 'generate_listings': {
        // Breadth recipe (domain vertical) — marketplace listings (server/listings/): a real ListingService with
        // SALE INTEGRITY (lifecycle draft→active→sold/removed, sell-once, no self-purchase) + an Express router.
        // Pure gen in ListingsGenerator.ts.
        const lstcfg = generateListingsIntegration();
        const lstWritten: string[] = [];
        for (const [path, content] of Object.entries(lstcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          lstWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('listings starter');
        const lstDeps = lstcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a marketplace-listings backend:\n${lstWritten.join('\n')}\nAdd the dependencies: ${lstDeps}\n\n${lstcfg.instructions}`;
      }

      case 'generate_job_board': {
        // Breadth recipe (domain vertical) — job board / applicant tracking (server/jobboard/): a real
        // JobBoardService with APPLICATION INTEGRITY (apply-once per candidate/job + hiring state-machine) + an
        // Express router. Pure gen in JobBoardGenerator.ts.
        const jbcfg = generateJobBoardIntegration();
        const jbWritten: string[] = [];
        for (const [path, content] of Object.entries(jbcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          jbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('job board starter');
        const jbDeps = jbcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a job-board / applicant-tracking backend:\n${jbWritten.join('\n')}\nAdd the dependencies: ${jbDeps}\n\n${jbcfg.instructions}`;
      }

      case 'generate_wishlist': {
        // Breadth recipe (domain vertical) — wishlist / favorites / likes (server/favorites/): a real
        // FavoritesService with IDEMPOTENT MEMBERSHIP (favorite-once + exact count) + an Express router.
        // Pure gen in WishlistGenerator.ts.
        const wlcfg = generateWishlistIntegration();
        const wlWritten: string[] = [];
        for (const [path, content] of Object.entries(wlcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          wlWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('wishlist starter');
        const wlDeps = wlcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a wishlist/favorites backend:\n${wlWritten.join('\n')}\nAdd the dependencies: ${wlDeps}\n\n${wlcfg.instructions}`;
      }

      case 'generate_addresses': {
        // Breadth recipe (domain vertical) — address book (server/addresses/): a real AddressBook with the
        // AT-MOST-ONE-DEFAULT invariant (first=default, setDefault unsets previous, delete-default promotes) +
        // an Express router. Pure gen in AddressesGenerator.ts.
        const adcfg = generateAddressesIntegration();
        const adWritten: string[] = [];
        for (const [path, content] of Object.entries(adcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          adWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('addresses starter');
        const adDeps = adcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an address-book backend:\n${adWritten.join('\n')}\nAdd the dependencies: ${adDeps}\n\n${adcfg.instructions}`;
      }

      case 'generate_coupons': {
        // Breadth recipe (domain vertical) — coupons / discount codes (server/coupons/): a real CouponService
        // with REDEMPTION INTEGRITY (total + per-user caps, expiry/active/min-order, percent/fixed discount
        // math) + an Express router. Pure gen in CouponsGenerator.ts.
        const cpcfg = generateCouponsIntegration();
        const cpWritten: string[] = [];
        for (const [path, content] of Object.entries(cpcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          cpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('coupons starter');
        const cpDeps = cpcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a coupons/discount-codes backend:\n${cpWritten.join('\n')}\nAdd the dependencies: ${cpDeps}\n\n${cpcfg.instructions}`;
      }

      case 'generate_kanban': {
        // Breadth recipe (domain vertical) — kanban board (server/kanban/): a real KanbanService with BOARD
        // INTEGRITY (contiguous card ordering + per-column WIP limit) + an Express router. Pure gen in
        // KanbanGenerator.ts.
        const kbcfg = generateKanbanIntegration();
        const kbWritten: string[] = [];
        for (const [path, content] of Object.entries(kbcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          kbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('kanban starter');
        const kbDeps = kbcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a kanban board backend:\n${kbWritten.join('\n')}\nAdd the dependencies: ${kbDeps}\n\n${kbcfg.instructions}`;
      }

      case 'generate_timesheet': {
        // Breadth recipe (domain vertical) — time tracking (server/timesheet/): a real Timesheet with SESSION
        // INTEGRITY (at most one open entry per user + exact duration) + an Express router. Pure gen in
        // TimesheetGenerator.ts.
        const tscfg = generateTimesheetIntegration();
        const tsWritten: string[] = [];
        for (const [path, content] of Object.entries(tscfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          tsWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('timesheet starter');
        const tsDeps = tscfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a time-tracking backend:\n${tsWritten.join('\n')}\nAdd the dependencies: ${tsDeps}\n\n${tscfg.instructions}`;
      }

      case 'generate_leaderboard': {
        // Breadth recipe (domain vertical) — leaderboard / rankings (server/leaderboard/): a real
        // LeaderboardService with RANK INTEGRITY (best-kept score + deterministic earlier-achiever tie-break) +
        // an Express router. Pure gen in LeaderboardGenerator.ts.
        const lbcfg = generateLeaderboardIntegration();
        const lbWritten: string[] = [];
        for (const [path, content] of Object.entries(lbcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          lbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('leaderboard starter');
        const lbDeps = lbcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a leaderboard backend:\n${lbWritten.join('\n')}\nAdd the dependencies: ${lbDeps}\n\n${lbcfg.instructions}`;
      }

      case 'generate_waitlist': {
        // Breadth recipe (domain vertical) — launch waitlist (server/waitlist/): a real Waitlist with QUEUE
        // INTEGRITY (email dedup + FIFO position + invite-front-N-in-order) + an Express router. Pure gen in
        // WaitlistGenerator.ts.
        const wtcfg = generateWaitlistIntegration();
        const wtWritten: string[] = [];
        for (const [path, content] of Object.entries(wtcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          wtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('waitlist starter');
        const wtDeps = wtcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a launch-waitlist backend:\n${wtWritten.join('\n')}\nAdd the dependencies: ${wtDeps}\n\n${wtcfg.instructions}`;
      }

      case 'generate_tags': {
        // Breadth recipe (domain vertical) — tags / taxonomy (server/tags/): a real TagService with TAG
        // INTEGRITY (canonical dedup + idempotent attach + rename-cascade/merge + exact counts) + an Express
        // router. Pure gen in TagsGenerator.ts.
        const tgcfg = generateTagsIntegration();
        const tgWritten: string[] = [];
        for (const [path, content] of Object.entries(tgcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          tgWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('tags starter');
        const tgDeps = tgcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a tags/taxonomy backend:\n${tgWritten.join('\n')}\nAdd the dependencies: ${tgDeps}\n\n${tgcfg.instructions}`;
      }

      case 'generate_experiments': {
        // Breadth recipe (domain vertical) — A/B testing (server/experiments/): a real ExperimentService with
        // DETERMINISTIC STICKY ASSIGNMENT (pure hash bucketing + weighted variants + exposure counts) + an
        // Express router. Pure gen in ExperimentsGenerator.ts.
        const excfg = generateExperimentsIntegration();
        const exWritten: string[] = [];
        for (const [path, content] of Object.entries(excfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          exWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('experiments starter');
        const exDeps = excfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an A/B testing backend:\n${exWritten.join('\n')}\nAdd the dependencies: ${exDeps}\n\n${excfg.instructions}`;
      }

      case 'generate_short_links': {
        // Breadth recipe (domain vertical) — URL shortener (server/shortlinks/): a real ShortLinkService with
        // LINK INTEGRITY (unique codes + exact click counts + expiry/disable) + an Express router. Pure gen in
        // ShortLinksGenerator.ts.
        const slcfg = generateShortLinksIntegration();
        const slWritten: string[] = [];
        for (const [path, content] of Object.entries(slcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          slWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('short links starter');
        const slDeps = slcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a URL-shortener backend:\n${slWritten.join('\n')}\nAdd the dependencies: ${slDeps}\n\n${slcfg.instructions}`;
      }

      case 'generate_feedback': {
        // Breadth recipe (domain vertical) — feedback / feature-request board (server/feedback/): a real
        // FeedbackService with VOTE + STATUS INTEGRITY (upvote-once + exact counts + status lifecycle) + an
        // Express router. Pure gen in FeedbackGenerator.ts.
        const fbcfg = generateFeedbackIntegration();
        const fbWritten: string[] = [];
        for (const [path, content] of Object.entries(fbcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          fbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('feedback starter');
        const fbDeps = fbcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a feedback board backend:\n${fbWritten.join('\n')}\nAdd the dependencies: ${fbDeps}\n\n${fbcfg.instructions}`;
      }

      case 'generate_consent': {
        // Breadth recipe (domain vertical) — GDPR consent log (server/consent/): a real ConsentService with an
        // APPEND-ONLY event log where hasConsent() is the most-recent grant/withdraw (latest wins) + an Express
        // router. Pure generator in ConsentGenerator.ts.
        const cscfg = generateConsentIntegration();
        const csWritten: string[] = [];
        for (const [path, content] of Object.entries(cscfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          csWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('consent starter');
        const csDeps = cscfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a GDPR consent-log backend:\n${csWritten.join('\n')}\nAdd the dependencies: ${csDeps}\n\n${cscfg.instructions}`;
      }

      case 'generate_activity_feed': {
        // Breadth recipe (domain vertical) — activity feed / timeline (server/activity/): a real
        // ActivityFeedService whose core guarantee is STABLE CURSOR PAGINATION (monotonic event ids paged by
        // id < cursor never duplicate or skip as new events append) + an Express router. Pure gen in
        // ActivityFeedGenerator.ts.
        const afcfg = generateActivityFeedIntegration();
        const afWritten: string[] = [];
        for (const [path, content] of Object.entries(afcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          afWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('activity feed starter');
        const afDeps = afcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an activity-feed backend:\n${afWritten.join('\n')}\nAdd the dependencies: ${afDeps}\n\n${afcfg.instructions}`;
      }

      case 'generate_cart': {
        // Breadth recipe (domain vertical) — shopping cart (server/cart/): a real CartService whose core
        // guarantee is CART INTEGRITY (adding the same product MERGES quantities into one line, and the total
        // is the EXACT sum of unitPrice×qty in integer minor units) + an Express router. Pure gen in
        // CartGenerator.ts.
        const crtcfg = generateCartIntegration();
        const crtWritten: string[] = [];
        for (const [path, content] of Object.entries(crtcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          crtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('cart starter');
        const crtDeps = crtcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a shopping-cart backend:\n${crtWritten.join('\n')}\nAdd the dependencies: ${crtDeps}\n\n${crtcfg.instructions}`;
      }

      case 'generate_reactions': {
        // Breadth recipe (domain vertical) — emoji reactions (server/reactions/): a real ReactionService whose
        // core guarantee is REACTION INTEGRITY (an idempotent per-user toggle, at most one emoji per target, so
        // per-emoji counts stay exact) + an Express router. Pure gen in ReactionsGenerator.ts.
        const rxcfg = generateReactionsIntegration();
        const rxWritten: string[] = [];
        for (const [path, content] of Object.entries(rxcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rxWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('reactions starter');
        const rxDeps = rxcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an emoji-reactions backend:\n${rxWritten.join('\n')}\nAdd the dependencies: ${rxDeps}\n\n${rxcfg.instructions}`;
      }

      case 'generate_orders': {
        // Breadth recipe (domain vertical) — ecommerce order lifecycle (server/orders/): a real OrderService
        // whose core guarantee is ORDER IMMUTABILITY (a placed order snapshots its items + total; later price
        // changes can't alter it) + a status STATE-MACHINE (placed→paid→shipped→delivered; cancel until ship) +
        // an Express router. Pure gen in OrdersGenerator.ts.
        const orcfg = generateOrdersIntegration();
        const orWritten: string[] = [];
        for (const [path, content] of Object.entries(orcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          orWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('orders starter');
        const orDeps = orcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an ecommerce orders backend:\n${orWritten.join('\n')}\nAdd the dependencies: ${orDeps}\n\n${orcfg.instructions}`;
      }

      case 'generate_faq': {
        // Breadth recipe (domain vertical) — FAQ / knowledge base (server/faq/): a real FaqService whose core
        // guarantee is the PUBLISH GATE (a draft entry is never returned by the public list/search) + helpfulness
        // voting + category/keyword search + an Express router. Pure gen in FaqGenerator.ts.
        const fqcfg = generateFaqIntegration();
        const fqWritten: string[] = [];
        for (const [path, content] of Object.entries(fqcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          fqWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('faq starter');
        const fqDeps = fqcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a FAQ / knowledge-base backend:\n${fqWritten.join('\n')}\nAdd the dependencies: ${fqDeps}\n\n${fqcfg.instructions}`;
      }

      case 'generate_quiz': {
        // Breadth recipe (domain vertical) — quiz / assessment (server/quizzes/): a real QuizService whose core
        // guarantee is GRADING INTEGRITY (a submission is scored against the stored key into an EXACT score +
        // pass/fail, and the correct-answer key is never exposed to the taker) + an Express router. Pure gen in
        // QuizGenerator.ts.
        const qzcfg = generateQuizIntegration();
        const qzWritten: string[] = [];
        for (const [path, content] of Object.entries(qzcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          qzWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('quiz starter');
        const qzDeps = qzcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a quiz / assessment backend:\n${qzWritten.join('\n')}\nAdd the dependencies: ${qzDeps}\n\n${qzcfg.instructions}`;
      }

      case 'generate_availability': {
        // Breadth recipe (domain vertical) — availability / opening hours (server/availability/): a real
        // AvailabilityService whose core guarantee is CORRECT OPEN/CLOSED RESOLUTION (weekly windows + date
        // exceptions + OVERNIGHT spans that cross midnight) + an Express router. Pure gen in
        // AvailabilityGenerator.ts.
        const avcfg = generateAvailabilityIntegration();
        const avWritten: string[] = [];
        for (const [path, content] of Object.entries(avcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          avWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('availability starter');
        const avDeps = avcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired an opening-hours backend:\n${avWritten.join('\n')}\nAdd the dependencies: ${avDeps}\n\n${avcfg.instructions}`;
      }

      case 'generate_announcements': {
        // Breadth recipe (domain vertical) — site announcements/banners (server/announcements/): a real
        // AnnouncementService whose core guarantee is SCHEDULED VISIBILITY + DISMISS-ONCE (a banner is active
        // only inside its [startsAt,endsAt] window, and a user who dismisses it never sees it again) + an
        // Express router. Pure gen in AnnouncementsGenerator.ts.
        const ancfg = generateAnnouncementsIntegration();
        const anWritten: string[] = [];
        for (const [path, content] of Object.entries(ancfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          anWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('announcements starter');
        const anDeps = ancfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a site-announcements backend:\n${anWritten.join('\n')}\nAdd the dependencies: ${anDeps}\n\n${ancfg.instructions}`;
      }

      case 'generate_collections': {
        // Breadth recipe (domain vertical) — saved collections/boards (server/collections/): a real
        // CollectionService whose core guarantee is MEMBERSHIP INTEGRITY (an item lives in many collections,
        // idempotent saves, removing from one never affects the others) + an Express router. Pure gen in
        // CollectionsGenerator.ts.
        const clcfg = generateCollectionsIntegration();
        const clWritten: string[] = [];
        for (const [path, content] of Object.entries(clcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          clWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('collections starter');
        const clDeps = clcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a saved-collections backend:\n${clWritten.join('\n')}\nAdd the dependencies: ${clDeps}\n\n${clcfg.instructions}`;
      }

      case 'generate_contact_form': {
        // Breadth recipe (domain vertical) — contact form (server/contact/): a real ContactService whose core
        // guarantee is VALIDATED CAPTURE + SPAM REJECTION (name/email/message validated, a filled honeypot is
        // dropped as spam, accepted messages have a new→read→archived lifecycle) + an Express router. Pure gen
        // in ContactFormGenerator.ts.
        const cfcfg = generateContactFormIntegration();
        const cfWritten: string[] = [];
        for (const [path, content] of Object.entries(cfcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          cfWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('contact form starter');
        const cfDeps = cfcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a contact-form backend:\n${cfWritten.join('\n')}\nAdd the dependencies: ${cfDeps}\n\n${cfcfg.instructions}`;
      }

      case 'generate_pageviews': {
        // Breadth recipe (domain vertical) — self-hosted page-view counter (server/pageviews/): a real
        // PageViewService whose core guarantee is UNIQUE-VISITOR DEDUP (total counts every hit; a salted-hash
        // visitor counts unique only once per day; raw IP never stored) + an Express router. Pure gen in
        // PageViewsGenerator.ts.
        const pvcfg = generatePageViewsIntegration();
        const pvWritten: string[] = [];
        for (const [path, content] of Object.entries(pvcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          pvWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('pageviews starter');
        const pvDeps = pvcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a self-hosted page-view counter:\n${pvWritten.join('\n')}\nAdd the dependencies: ${pvDeps}\n\n${pvcfg.instructions}`;
      }

      case 'generate_gift_cards': {
        // Breadth recipe (domain vertical) — gift cards / store credit (server/giftcards/): a real
        // GiftCardService whose core guarantee is BALANCE INTEGRITY (a monetary balance in integer minor units;
        // redeem debits atomically and can never overdraw; exact remainder) + an Express router. Pure gen in
        // GiftCardsGenerator.ts.
        const gccfg = generateGiftCardsIntegration();
        const gcWritten: string[] = [];
        for (const [path, content] of Object.entries(gccfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('gift cards starter');
        const gcDeps = gccfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a gift-card / store-credit backend:\n${gcWritten.join('\n')}\nAdd the dependencies: ${gcDeps}\n\n${gccfg.instructions}`;
      }

      case 'generate_teams': {
        // Breadth recipe (domain vertical) — teams / workspaces (server/teams/): a real TeamService whose core
        // guarantee is MEMBERSHIP INTEGRITY (multi-workspace membership with per-workspace roles, single-use
        // invites, a workspace always keeps at least one owner) + an Express router. Pure gen in TeamsGenerator.ts.
        const tmcfg = generateTeamsIntegration();
        const tmWritten: string[] = [];
        for (const [path, content] of Object.entries(tmcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          tmWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('teams starter');
        const tmDeps = tmcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a teams / workspaces backend:\n${tmWritten.join('\n')}\nAdd the dependencies: ${tmDeps}\n\n${tmcfg.instructions}`;
      }

      case 'generate_status_page': {
        // Breadth recipe (domain vertical) — public status page (server/status/): a real StatusPageService whose
        // core guarantee is DERIVED OVERALL STATUS (worst component status) + an APPEND-ONLY INCIDENT TIMELINE
        // (a resolved incident can't be updated) + an Express router. Pure gen in StatusPageGenerator.ts.
        const spcfg = generateStatusPageIntegration();
        const spWritten: string[] = [];
        for (const [path, content] of Object.entries(spcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          spWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('status page starter');
        const spDeps = spcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a public status-page backend:\n${spWritten.join('\n')}\nAdd the dependencies: ${spDeps}\n\n${spcfg.instructions}`;
      }

      case 'generate_survey': {
        // Breadth recipe (domain vertical) — multi-question survey (server/surveys/): a real SurveyService whose
        // core guarantee is SCHEMA-VALIDATED RESPONSES + EXACT AGGREGATION (typed questions, invalid responses
        // rejected, per-question tallies) + an Express router. Pure gen in SurveyGenerator.ts.
        const svcfg = generateSurveyIntegration();
        const svWritten: string[] = [];
        for (const [path, content] of Object.entries(svcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          svWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('survey starter');
        const svDeps = svcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a survey backend:\n${svWritten.join('\n')}\nAdd the dependencies: ${svDeps}\n\n${svcfg.instructions}`;
      }

      case 'generate_support_tickets': {
        // Breadth recipe (domain vertical) — support tickets/helpdesk (server/tickets/): a real TicketService
        // with a status STATE-MACHINE + an Express router. Pure generator in SupportTicketGenerator.ts.
        const tkcfg = generateSupportTicketIntegration();
        const tkWritten: string[] = [];
        for (const [path, content] of Object.entries(tkcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          tkWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('support tickets');
        const tkDeps = tkcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a support-ticket backend:\n${tkWritten.join('\n')}\nAdd the dependencies: ${tkDeps}\n\n${tkcfg.instructions}`;
      }

      case 'generate_graphql': {
        // Roadmap BUILD-NOW #8 — a real runnable GraphQL API (graphql + graphql-yoga): schema + mountable
        // yoga handler with an example Query/Mutation. Pure generator in GraphqlGenerator.ts. No env keys.
        const gql = generateGraphqlIntegration();
        const gqlWritten: string[] = [];
        for (const [path, content] of Object.entries(gql.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gqlWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('graphql api');
        const gqlDeps = gql.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired a GraphQL API:\n${gqlWritten.join('\n')}\nAdd the dependencies: ${gqlDeps}\n\n${gql.instructions}`;
      }

      case 'generate_pagination': {
        // U-4 recipe — safe list pagination (server/lib/pagination.ts): parsePagination (clamps limit/page,
        // DoS-safe) + pageMeta. Dependency-free. Pure generator in PaginationGenerator.ts. No env keys.
        const pgcfg = generatePaginationIntegration();
        const pgWritten: string[] = [];
        for (const [path, content] of Object.entries(pgcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          pgWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('pagination');
        return `Wired list pagination:\n${pgWritten.join('\n')}\n(No npm dependency needed — plain query clamping + page math.)\n\n${pgcfg.instructions}`;
      }

      case 'generate_rbac': {
        // T1.3 recipe — a dependency-free RBAC layer (Role hierarchy + hasRole + requireRole guard).
        // Pure generator in RbacGenerator.ts; pairs with generate_auth (sets req.user.role) + generate_crud.
        const rbacRec = (input as Record<string, unknown>) || {};
        const rbacRoles = Array.isArray(rbacRec.roles) ? rbacRec.roles.filter((r): r is string => typeof r === 'string') : [];
        if (rbacRoles.length === 0) return 'generate_rbac: pass roles as a non-empty array, highest → lowest (e.g. ["admin","editor","viewer"]).';
        const rbac = generateRbac(rbacRoles);
        const rbacWritten: string[] = [];
        for (const [path, content] of Object.entries(rbac.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rbacWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('rbac');
        return `Wired RBAC:\n${rbacWritten.join('\n')}\n\n${rbac.instructions}`;
      }

      case 'generate_ids': {
        // U-4 recipe — secure IDs/tokens (server/lib/ids.ts): newId (UUID v4) + shortId + secureToken +
        // hashToken via node:crypto CSPRNG. Dependency-free. Pure generator in IdGenerator.ts. No env keys.
        const idcfg = generateIdIntegration();
        const idWritten: string[] = [];
        for (const [path, content] of Object.entries(idcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          idWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('secure ids');
        return `Wired secure IDs/tokens:\n${idWritten.join('\n')}\n(No npm dependency needed — node:crypto CSPRNG.)\n\n${idcfg.instructions}`;
      }

      case 'generate_admin': {
        // T1.3 recipe — a React admin page (paginated table + delete) bound to generate_crud's endpoints.
        // Pure generator in AdminGenerator.ts; guard the route with generate_rbac's requireRole('admin').
        const adminRec = (input as Record<string, unknown>) || {};
        const adminName = typeof adminRec.name === 'string' ? adminRec.name : '';
        if (!adminName) return 'generate_admin: pass the resource "name" (e.g. "Post") and its "fields".';
        const adminRawFields = Array.isArray(adminRec.fields) ? adminRec.fields : [];
        const adminFields = adminRawFields
          .map((f: unknown) => {
            if (typeof f !== 'object' || f === null) return null;
            const fo = f as Record<string, unknown>;
            const fname = typeof fo.name === 'string' ? fo.name : '';
            return fname ? { name: fname, type: typeof fo.type === 'string' ? fo.type : undefined } : null;
          })
          .filter((f): f is { name: string; type: string | undefined } => f !== null);
        const admin = generateAdmin({ name: adminName, fields: adminFields });
        const adminWritten: string[] = [];
        for (const [path, content] of Object.entries(admin.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          adminWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint(`admin (${adminName})`);
        return `Wired an admin page for ${adminName}:\n${adminWritten.join('\n')}\n\n${admin.instructions}`;
      }

      case 'generate_settings': {
        // Roadmap BUILD-NOW #10 (other half) — a settings scaffold (dependency-free React): a persisted
        // SettingsProvider that APPLIES the theme + a SettingsPage. Pure generator in SettingsScaffoldGenerator.ts.
        const st = generateSettingsScaffoldIntegration();
        const stWritten: string[] = [];
        for (const [path, content] of Object.entries(st.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          stWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('settings scaffold');
        return `Wired a settings scaffold:\n${stWritten.join('\n')}\n(No npm dependency — React Context + localStorage; applies the theme.)\n\n${st.instructions}`;
      }

      case 'generate_dashboard': {
        // T1.3 recipe — a stats dashboard (GET /api/dashboard/stats aggregation + React tiles page).
        // Pure generator in DashboardGenerator.ts; reuses generate_crud's prisma client + error handler.
        const dashRec = (input as Record<string, unknown>) || {};
        const dashModels = Array.isArray(dashRec.models) ? dashRec.models.filter((m): m is string => typeof m === 'string') : [];
        if (dashModels.length === 0) return 'generate_dashboard: pass models as a non-empty array (e.g. ["Post","User"]).';
        const dash = generateDashboard(dashModels);
        const dashWritten: string[] = [];
        for (const [path, content] of Object.entries(dash.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          dashWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('dashboard');
        return `Wired a dashboard:\n${dashWritten.join('\n')}\n\n${dash.instructions}`;
      }

      case 'generate_backup': {
        // T1.3 recipe — a JSON data-export ("backup") endpoint. Pure generator in BackupGenerator.ts;
        // reuses generate_crud's prisma client + error handler. Guard with generate_rbac's requireRole('admin').
        const bkRec = (input as Record<string, unknown>) || {};
        const bkModels = Array.isArray(bkRec.models) ? bkRec.models.filter((m): m is string => typeof m === 'string') : [];
        if (bkModels.length === 0) return 'generate_backup: pass models as a non-empty array (e.g. ["Post","User"]).';
        const bk = generateBackup(bkModels);
        const bkWritten: string[] = [];
        for (const [path, content] of Object.entries(bk.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          bkWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('backup');
        return `Wired a backup endpoint:\n${bkWritten.join('\n')}\n\n${bk.instructions}`;
      }

      case 'analyze_requirements': {
        // T1.4 (safe slice) — surface the likely domain, commonly-missing features, non-functional signals
        // and clarifying questions for a prompt. Pure analyzer in RequirementGapAnalyzer.ts; no file writes.
        const arRec = (input as Record<string, unknown>) || {};
        const arPrompt = typeof arRec.prompt === 'string' ? arRec.prompt : '';
        if (!arPrompt.trim()) return 'analyze_requirements: pass the "prompt" to analyze.';
        return renderRequirementGaps(analyzeRequirementGaps(arPrompt));
      }

      case 'generate_i18n': {
        // T2.5 recipe — real react-i18next infrastructure (init + per-language locale files + a language
        // switch hook). Pure generator in I18nGenerator.ts. English is always kept as the fallback.
        const i18nRec = (input as Record<string, unknown>) || {};
        const i18nLangs = Array.isArray(i18nRec.languages) ? i18nRec.languages.filter((l): l is string => typeof l === 'string') : [];
        const i18nCfg = generateI18n(i18nLangs);
        const i18nWritten: string[] = [];
        for (const [path, content] of Object.entries(i18nCfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          i18nWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('i18n');
        const i18nDeps = i18nCfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired i18n:\n${i18nWritten.join('\n')}\nAdd the dependencies: ${i18nDeps}\n\n${i18nCfg.instructions}`;
      }

      case 'generate_ui_states': {
        // T2.5 recipe — a dependency-free React UI-states pack (spinner/skeleton/empty/error-boundary +
        // useAsync + useOptimisticList). Pure generator in UiStatesGenerator.ts.
        const uiRec = (input as Record<string, unknown>) || {};
        const uiInclude = Array.isArray(uiRec.include) ? uiRec.include.filter((s): s is string => typeof s === 'string') : undefined;
        const ui = generateUiStates(uiInclude);
        const uiWritten: string[] = [];
        for (const [path, content] of Object.entries(ui.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          uiWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('ui-states');
        return `Wired a UI-states pack:\n${uiWritten.join('\n')}\n\n${ui.instructions}`;
      }

      case 'request_secrets': {
        // ASK THE USER FOR A KEY, MID-BUILD (admin 2026-08-08). Previously the build either wrote a
        // placeholder and carried on toward a feature that could never work, or finished and told the
        // user afterwards which keys to go and paste. Both put the dead end AFTER the build.
        //
        // The VALUE never passes through here: the popup writes it straight to the encrypted vault
        // through the authenticated secrets API, and this only learns the names and reads them back.
        // Sending a live credential up the build's event stream would put it in the transcript and the
        // admin report, both of which are stored.
        const reqRec = (input as Record<string, unknown>) || {};
        const rawAsks = Array.isArray(reqRec.secrets) ? (reqRec.secrets as Array<Partial<SecretAsk>>) : [];
        const plan = planSecretRequest(rawAsks, this.savedSecretNames);

        // Report the filtered-out names to the AGENT rather than dropping them silently — it needs to
        // know a key it planned for is already present (so it can wire it) or was refused (so it stops
        // planning around it).
        const notes: string[] = [];
        if (plan.alreadyHave.length) notes.push(`Already saved (no need to ask): ${plan.alreadyHave.join(', ')}.`);
        if (plan.rejected.length) notes.push(`Refused — not a usable app key: ${plan.rejected.join(', ')}. Do not ask for NavBharatAI's own provider keys.`);
        if (plan.ask.length === 0) {
          return notes.length ? notes.join(' ') : 'request_secrets: nothing to ask for — the app already has every key it named.';
        }
        if (!this.onSecretsNeeded) {
          // An offer we cannot honour is worse than none: without a verified user there is no vault to
          // save into, so say so instead of showing a popup that would lose the input.
          return `Cannot ask for keys in this session (no signed-in user). Tell the user to add ${plan.ask.map((a) => a.name).join(', ')} in Settings → Secrets & API Keys. ${notes.join(' ')}`.trim();
        }

        this.events?.emit({ type: 'narration', agent: 'architect', text: `🔑 ${secretRequestPrompt(plan)}`, ts: Date.now() });
        let saved: Record<string, string> | null = null;
        try { saved = await this.onSecretsNeeded(plan.ask); } catch { saved = null; }

        const askedNames = plan.ask.map((a) => a.name);
        if (!saved || Object.keys(saved).length === 0) {
          const line = secretRequestResult('skipped', askedNames);
          this.events?.emit({ type: 'narration', agent: 'architect', text: line, ts: Date.now() });
          // The build CONTINUES. Skipping is a real answer, and the agent is told to leave the feature
          // visibly disabled rather than fake it.
          return `${line} Build the rest of the app normally and leave that feature as a visibly disabled "needs setup" state — never a fake success. ${notes.join(' ')}`.trim();
        }

        // Merge into the app's .env NOW. The vault is only read at build START, so a key saved
        // mid-build would otherwise not exist for the running app until the next build — which is
        // exactly the gap `rescueDatabase` was written to close for the database.
        let wrote = false;
        try {
          let existing = '';
          try { existing = await withTimeout(this.actuator.readFile(this.workspaceId, '.env'), 5_000, 'secrets-env-read'); } catch { existing = ''; }
          const merged = mergeDotEnv(existing, saved);
          await this.actuator.writeFile(this.workspaceId, '.env', merged);
          try { this.onFileWrite?.('.env', merged); } catch { /* durable record is best-effort */ }
          // The user's real keys must never reach their git repo.
          try {
            let gi = '';
            try { gi = await withTimeout(this.actuator.readFile(this.workspaceId, '.gitignore'), 5_000, 'secrets-gi-read'); } catch { gi = ''; }
            const nextGi = gitignoreWithEnv(gi);
            if (nextGi !== gi) { await this.actuator.writeFile(this.workspaceId, '.gitignore', nextGi); try { this.onFileWrite?.('.gitignore', nextGi); } catch { /* best-effort */ } }
          } catch { /* gitignore hardening is best-effort */ }
          wrote = true;
        } catch { wrote = false; }

        // Keep the in-memory set current so a later ask in the SAME build does not re-request these.
        this.savedSecretNames = [...this.savedSecretNames, ...Object.keys(saved)];

        const savedNames = Object.keys(saved);
        if (!wrote) {
          // Saved to the vault but not written to this sandbox — true, and the difference matters: the
          // key is safe and will apply next build, but the app running right now still lacks it.
          const line = `🔐 Saved ${savedNames.join(', ')} to your keys. They could not be written into the running app just now — they will apply on the next build.`;
          this.events?.emit({ type: 'narration', agent: 'architect', text: line, ts: Date.now() });
          return `${line} ${notes.join(' ')}`.trim();
        }
        const okLine = secretRequestResult('saved', savedNames);
        this.events?.emit({ type: 'narration', agent: 'architect', text: okLine, ts: Date.now() });
        return `${okLine} They are in the app's .env now — read them with process.env / import.meta.env and build the feature for real. ${notes.join(' ')}`.trim();
      }

      case 'generate_game_systems': {
        // PHASE 6. Combat, AI, projectiles and waves — written as PURE arithmetic so the rules that a
        // hand-written version gets wrong (i-frames, segment collision, separation, de-aggro
        // hysteresis, single death) are provable rather than approximated.
        const gsyRec = (input as Record<string, unknown>) || {};
        const gsyInclude = Array.isArray(gsyRec.include)
          ? gsyRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const gsy = generateGameSystems(gsyInclude);
        const gsyWritten: string[] = [];
        for (const [path, content] of Object.entries(gsy.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gsyWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('gameplay systems');
        return `Wired the gameplay systems:\n${gsyWritten.join('\n')}\n\n${gsy.instructions}`;
      }

      case 'generate_game_shell': {
        // PHASE 5, and the one that makes the other four pay off. Composition is where a first build
        // goes wrong — physics in the render callback, one particle layer added, audio never unlocked,
        // a leaked WebGL context on unmount. All invisible in review, all obvious when played.
        const gshRec = (input as Record<string, unknown>) || {};
        const gshInclude = Array.isArray(gshRec.include)
          ? gshRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const gsh = generateGameShell(gshInclude);
        const gshWritten: string[] = [];
        for (const [path, content] of Object.entries(gsh.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gshWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('game shell');
        return `Composed the game shell:\n${gshWritten.join('\n')}\n\n${gsh.instructions}`;
      }

      case 'generate_game_vfx': {
        // PHASE 4. The value is not the particle system — it is bindGameFeedback, ONE table mapping each
        // event to particle + sound + trauma + hit-stop. Authored anywhere else it drifts, and half the
        // game ends up feeling weaker than the other half for no reason anyone can name.
        const gfxRec = (input as Record<string, unknown>) || {};
        const gfxInclude = Array.isArray(gfxRec.include)
          ? gfxRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const gfx = generateGameVfxAudio(gfxInclude);
        const gfxWritten: string[] = [];
        for (const [path, content] of Object.entries(gfx.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gfxWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('game VFX and audio');
        return `Wired VFX and audio:\n${gfxWritten.join('\n')}\n\n${gfx.instructions}`;
      }

      case 'generate_game_controller': {
        // PHASE 3. The feel lives in a PURE motor (coyote time, jump buffering, variable jump height,
        // air control, slope limit, ground snap) so those rules are testable arithmetic rather than
        // something a human has to sense in a browser; the three.js class on top only raycasts.
        const gcRec = (input as Record<string, unknown>) || {};
        const gcInclude = Array.isArray(gcRec.include)
          ? gcRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const gc = generateGameController(gcInclude);
        const gcWritten: string[] = [];
        for (const [path, content] of Object.entries(gc.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('character controller');
        return `Wired the character controller:\n${gcWritten.join('\n')}\n\n${gc.instructions}`;
      }

      case 'generate_game_3d': {
        // PHASE 2 of game building. What makes a three.js scene look good is colour management, lighting
        // shape, fitted shadows and restraint in post — not asset detail. Those decisions live in the
        // generated code so the model does not have to rediscover them (and get them wrong) each time.
        const g3Rec = (input as Record<string, unknown>) || {};
        const g3Include = Array.isArray(g3Rec.include)
          ? g3Rec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const g3 = generateGame3D(g3Include);
        const g3Written: string[] = [];
        for (const [path, content] of Object.entries(g3.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          g3Written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('3D layer');
        // Naming the install is not optional: a 3D layer whose `three` dependency is never added
        // produces an app that cannot build, which is the honest-failure rule applied to a generator.
        const g3Deps = g3.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired the 3D layer:\n${g3Written.join('\n')}\nAdd the dependency: ${g3Deps} (and @types/three)\n\n${g3.instructions}`;
      }

      case 'generate_game_runtime': {
        // THE ENGINE LAYER (admin 2026-08-09). AI-generated games play badly far more often because the
        // model hand-rolls the runtime than because the art is simple: a raw-delta loop makes physics
        // frame-rate dependent, event-driven input drops presses, and allocating bullets in the loop
        // hands the GC work every frame. This ships a runtime that has already solved those, so every
        // later generator (world, enemies, VFX) inherits a correct foundation. Pure generator in
        // GameRuntimeGenerator.ts; no dependency, engine-agnostic.
        const grRec = (input as Record<string, unknown>) || {};
        const grInclude = Array.isArray(grRec.include)
          ? grRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const gr = generateGameRuntime(grInclude);
        const grWritten: string[] = [];
        for (const [path, content] of Object.entries(gr.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          grWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('game runtime');
        return `Wired the game runtime:\n${grWritten.join('\n')}\n\n${gr.instructions}`;
      }

      case 'generate_animation': {
        // The audit's last frontend ❌ — micro-interactions were LLM-authored ad hoc, so most builds got
        // a different hand-rolled transition or none at all. Pure generator in MotionGenerator.ts:
        // dependency-free CSS (transform/opacity only, so it stays smooth on low-end phones) plus a
        // scroll-reveal hook, and every effect self-disables under prefers-reduced-motion.
        const motionRec = (input as Record<string, unknown>) || {};
        const motionInclude = Array.isArray(motionRec.include)
          ? motionRec.include.filter((v): v is string => typeof v === 'string')
          : undefined;
        const motion = generateMotion(motionInclude);
        const motionWritten: string[] = [];
        for (const [path, content] of Object.entries(motion.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          motionWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('motion pack');
        return `Wired a motion pack:\n${motionWritten.join('\n')}\n\n${motion.instructions}`;
      }

      case 'generate_state': {
        // Roadmap BUILD-NOW #9 — GLOBAL state management (Zustand store + selector hooks). Distinct from
        // generate_ui_states' LOCAL useOptimisticList. Pure generator in FrontendStateGenerator.ts. No env keys.
        const fs = generateFrontendStateIntegration();
        const fsWritten: string[] = [];
        for (const [path, content] of Object.entries(fs.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          fsWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('global state store');
        const fsDeps = fs.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired global state management:\n${fsWritten.join('\n')}\nAdd the dependency: ${fsDeps}\n\n${fs.instructions}`;
      }

      case 'generate_image_optimization': {
        // T2.6 recipe — a sharp server helper + a CLS-safe lazy <img>. Pure generator in ImageOptGenerator.ts.
        const io = generateImageOptimization();
        const ioWritten: string[] = [];
        for (const [path, content] of Object.entries(io.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          ioWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('image-optimization');
        const ioDeps = io.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired image optimization:\n${ioWritten.join('\n')}\nAdd the dependencies: ${ioDeps}\n\n${io.instructions}`;
      }

      case 'generate_sso': {
        // T2.7 recipe — real OIDC SSO (any provider). Pure generator in SsoGenerator.ts. BYO credentials;
        // never overwrites an existing .env.example.
        const sso = generateSsoIntegration();
        const ssoWritten: string[] = [];
        for (const [path, content] of Object.entries(sso.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); ssoWritten.push(`Kept existing ${path} (add: ${sso.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          ssoWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('sso');
        const ssoDeps = sso.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired OIDC SSO:\n${ssoWritten.join('\n')}\nAdd the dependencies: ${ssoDeps}\n\n${sso.instructions}`;
      }

      case 'generate_abac': {
        // T2.7 recipe — attribute-based access control (policy registry + authorize guard). Pure generator.
        const abac = generateAbac();
        const abacWritten: string[] = [];
        for (const [path, content] of Object.entries(abac.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          abacWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('abac');
        return `Wired ABAC:\n${abacWritten.join('\n')}\n\n${abac.instructions}`;
      }

      case 'generate_metrics': {
        // T2.8 recipe — Prometheus metrics (registry + request middleware + /metrics route) plus the
        // runnable Grafana stack under monitoring/. Pure generator.
        const met = generateMetrics({
          appPort: typeof input?.port === 'number' ? input.port : undefined,
          appName: typeof input?.app_name === 'string' ? input.app_name : undefined,
          includeGrafanaStack: input?.grafana !== false,
        });
        const metWritten: string[] = [];
        for (const [path, content] of Object.entries(met.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          metWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('metrics');
        const metDeps = met.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired Prometheus metrics + Grafana dashboard:\n${metWritten.join('\n')}\nAdd the dependencies: ${metDeps}\n\n${met.instructions}`;
      }

      case 'generate_tracing': {
        // T2.8 recipe — OpenTelemetry distributed tracing (NodeSDK + auto-instrumentation + OTLP). Pure
        // generator in TracingGenerator.ts. BYO collector endpoint; never overwrites an existing .env.example.
        const trc = generateTracing();
        const trcWritten: string[] = [];
        for (const [path, content] of Object.entries(trc.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); trcWritten.push(`Kept existing ${path} (add: ${trc.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          trcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('tracing');
        const trcDeps = trc.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired OpenTelemetry tracing:\n${trcWritten.join('\n')}\nAdd the dependencies: ${trcDeps}\n\n${trc.instructions}`;
      }

      case 'generate_deploy_artifacts': {
        const rec = (input as Record<string, unknown>) || {};
        const includeRaw = Array.isArray(rec.include) ? rec.include.filter((x): x is string => typeof x === 'string') : [];
        const include = new Set(includeRaw.length ? includeRaw : ['docker', 'compose', 'ci']);
        const nodeVersion = optStr(input, 'nodeVersion') || undefined;
        const port = typeof rec.port === 'number' && rec.port > 0 ? rec.port : undefined;
        const installCmd = optStr(input, 'installCmd') || undefined;
        const buildCmd = optStr(input, 'buildCmd') || undefined;
        const startCmd = optStr(input, 'startCmd') || undefined;
        const lintCmd = optStr(input, 'lintCmd') || undefined;
        const testCmd = optStr(input, 'testCmd') || undefined;
        const multiStage = rec.multiStage === false ? false : undefined;
        // Match the generated artifacts to the project's package manager (a pnpm/yarn/bun project
        // otherwise gets a broken `npm ci` workflow/Dockerfile). An explicit installCmd still overrides.
        const packageManager = (include.has('ci') || include.has('docker'))
          ? await this.detectWorkspacePackageManager()
          : undefined;
        const genInput: DeployArtifactInput = {};
        if (include.has('docker')) genInput.docker = { nodeVersion, port, installCmd, buildCmd, startCmd, multiStage, packageManager };
        if (include.has('compose')) genInput.compose = { port, dependencies: getWorkspaceMemory(this.workspaceId).graph().dependencies };
        if (include.has('ci')) genInput.ci = { nodeVersion, installCmd, lintCmd, testCmd, buildCmd, packageManager };
        const artifacts = generateDeployArtifacts(genInput);
        const toWrite: Array<{ path: string; content: string }> = [];
        if (artifacts.dockerfile) toWrite.push({ path: 'Dockerfile', content: artifacts.dockerfile });
        if (artifacts.dockerignore) toWrite.push({ path: '.dockerignore', content: artifacts.dockerignore });
        if (artifacts.dockerCompose) toWrite.push({ path: 'docker-compose.yml', content: artifacts.dockerCompose });
        if (artifacts.ciWorkflow) toWrite.push({ path: '.github/workflows/ci.yml', content: artifacts.ciWorkflow });
        if (toWrite.length === 0) return 'generate_deploy_artifacts: nothing to write — pass include: ["docker","compose","ci"].';
        const written: string[] = [];
        for (const file of toWrite) {
          let kind: 'create' | 'modify' = 'create';
          try {
            await this.actuator.readFile(this.workspaceId, file.path);
            kind = 'modify';
          } catch {
            kind = 'create';
          }
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          this.state?.recordFileChange({ path: file.path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(file.path, file.content);
          written.push(`${kind === 'create' ? 'Created' : 'Updated'} ${file.path}`);
        }
        this.scheduleCheckpoint('deploy artifacts');
        return `Generated ${written.length} deployment artifact(s):\n${written.join('\n')}`;
      }

      case 'generate_deploy_config': {
        // Roadmap BUILD-NOW #7 — platform deploy config for a git-push PaaS (Railway/Render/Fly). Pure
        // generator in DeployConfigGenerator.ts; emits the one config file the target needs. No env keys.
        const dcTarget = optStr(input, 'target');
        if (!isDeployTarget(dcTarget)) return 'generate_deploy_config: pass target = "railway" | "render" | "fly".';
        const dc = generateDeployConfig(dcTarget);
        const dcWritten: string[] = [];
        for (const [path, content] of Object.entries(dc.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          dcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint(`deploy config (${dcTarget})`);
        return `Wired ${dcTarget} deploy config:\n${dcWritten.join('\n')}\n\n${dc.instructions}`;
      }

      case 'generate_iac': {
        // GA-15 — Infrastructure-as-Code: real Kubernetes manifests + a Helm chart + Cloud Run Terraform,
        // generated deterministically from the app's image/port/env. Pure builders in IaCGenerator.ts.
        const rec = (input as Record<string, unknown>) || {};
        const includeRaw = Array.isArray(rec.include) ? rec.include.filter((x): x is string => typeof x === 'string') : [];
        const include = new Set(includeRaw.length ? includeRaw : ['k8s', 'helm', 'terraform', 'ansible']);
        const port = typeof rec.port === 'number' && rec.port > 0 ? rec.port : undefined;
        const replicas = typeof rec.replicas === 'number' && rec.replicas > 0 ? rec.replicas : undefined;
        const env = Array.isArray(rec.env) ? rec.env.filter((x): x is string => typeof x === 'string') : undefined;
        const iacOpts: IaCOptions = {
          appName: optStr(input, 'appName') || undefined,
          image: optStr(input, 'image') || undefined,
          port, replicas, env,
          host: optStr(input, 'host') || undefined,
          healthPath: optStr(input, 'healthPath') || undefined,
        };
        const all: Record<string, string> = {};
        if (include.has('k8s')) all['k8s/manifests.yaml'] = generateK8sManifests(iacOpts);
        if (include.has('helm')) Object.assign(all, generateHelmChart(iacOpts));
        if (include.has('terraform')) Object.assign(all, generateTerraformCloudRun(iacOpts));
        if (include.has('ansible')) Object.assign(all, generateAnsiblePlaybook(iacOpts));
        const iacPaths = Object.keys(all);
        if (iacPaths.length === 0) return 'generate_iac: nothing to write — pass include: ["k8s","helm","terraform","ansible"].';
        const iacWritten: string[] = [];
        for (const p of iacPaths) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, p); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, p, all[p]);
          this.state?.recordFileChange({ path: p, kind }, agent);
          iacWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${p}`);
        }
        this.scheduleCheckpoint('iac artifacts');
        return `Generated ${iacWritten.length} IaC artifact(s) (kubectl apply / helm install / terraform apply):\n${iacWritten.join('\n')}`;
      }

      case 'scan_vulnerabilities': {
        // GA-13 — real CVE/OSV supply-chain scan of the declared dependencies against OSV.dev. Honest:
        // an unreachable API reports "scan unavailable", NEVER a fake clean bill of health. Logic + parsing
        // in VulnScanner.ts (unit-tested with an injected fetch); the live HTTP call runs in the sandbox.
        let pkgJson: string | undefined;
        try { pkgJson = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgJson = undefined; }
        if (typeof pkgJson !== 'string') return 'scan_vulnerabilities: no package.json in the workspace — nothing to scan.';
        let lockJson: string | undefined;
        try { lockJson = await this.actuator.readFile(this.workspaceId, 'package-lock.json'); } catch { lockJson = undefined; }
        const deps = resolveDependencies(pkgJson, lockJson);
        const result = await scanVulnerabilities(deps);
        if (result.ok && result.findings.length > 0) {
          getWorkspaceMemory(this.workspaceId).recordAudit(`scan_vulnerabilities: ${result.findings.length} vulnerable dep(s) (e.g. ${result.findings[0].package}).`);
        }
        return vulnScanSummary(result);
      }

      case 'check_licenses': {
        // PPIPE-gates — license/copyleft advisory over the app's package-lock.json (SPDX classification
        // via SBOMGenerator). Flags strong-copyleft (GPL/AGPL) deps that could impose source-disclosure
        // obligations. Pure analysis (no network); advisory only, never blocks. Parity with the on-demand
        // scan_vulnerabilities CVE tool; the automatic build-end wiring is a separate slice.
        let lockRaw: string | undefined;
        try { lockRaw = await this.actuator.readFile(this.workspaceId, 'package-lock.json'); } catch { lockRaw = undefined; }
        if (typeof lockRaw !== 'string') return 'check_licenses: no package-lock.json in the workspace — run an install first, then re-check.';
        let lock: unknown;
        try { lock = JSON.parse(lockRaw); } catch { return 'check_licenses: package-lock.json is not valid JSON — cannot classify licenses.'; }
        const analysis = analyzeAppDependencies(lock);
        const summary = licenseAdvisorySummary(analysis);
        if (analysis.hasCopyleftRisk) {
          getWorkspaceMemory(this.workspaceId).recordAudit(`check_licenses: ${analysis.copyleft.strong.length} strong-copyleft dep(s) (e.g. ${analysis.copyleft.strong[0].name}).`);
        }
        return summary || 'check_licenses: no dependency components found in the lockfile.';
      }

      case 'threat_model': {
        // GA-13 — threat model over the app's OWN code (not deps): high-precision STRIDE-style scan for a
        // client-shipped secret, wildcard CORS + credentials, SQL string-interpolation, XSS via
        // dangerouslySetInnerHTML from a non-constant, and eval on a non-literal. Pure; advisory only.
        let files: string[];
        try { files = await this.actuator.listFiles(this.workspaceId); }
        catch { return 'threat_model: failed to list workspace files.'; }
        const CODE = /\.(t|j)sx?$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const codeFiles = files.filter((f) => CODE.test(f) && !SKIP.test(f)).slice(0, 300);
        const sources: { path: string; content: string }[] = [];
        for (const f of codeFiles) {
          try { sources.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); }
          catch { /* skip unreadable */ }
        }
        const findings = analyzeThreatModel(sources);
        if (findings.some((x) => x.severity === 'high')) {
          getWorkspaceMemory(this.workspaceId).recordAudit(`threat_model: ${findings.filter((x) => x.severity === 'high').length} high-severity issue(s) (e.g. ${findings[0].kind}).`);
        }
        return threatModelSummary(findings) || 'threat_model: no high-signal security issues found in the app\'s own code.';
      }

      case 'run_migrations': {
        // GA-10 — apply the database schema before the app runs. Detects the migration tool (Prisma/Knex/
        // Drizzle/TypeORM/Sequelize/Flyway/Alembic) deterministically, then RUNS each command in the sandbox
        // and reports the REAL exit code + output — never a fake "migrated ✓". Detection is pure + tested;
        // execution rides the actuator. `dryRun: true` reports the plan without running it.
        const dryRun = (input as Record<string, unknown>)?.dryRun === true;
        let pkgJson: string | undefined;
        try { pkgJson = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgJson = undefined; }
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        const plans = detectMigrationPlan(files.filter((p) => !/^(node_modules|\.git)\//.test(p)), pkgJson);
        // GA-6 — read the persisted migration history back so the agent SEES what schema was already
        // applied (and when / whether it succeeded) before it re-runs. Best-effort; never blocks.
        const histBlock = summarizeMigrationHistory(await loadMigrationHistory(this.workspaceId).catch(() => []));
        const histPrefix = histBlock ? `${histBlock}\n\n` : '';
        if (plans.length === 0 || dryRun) return `${histPrefix}${migrationPlanSummary(plans)}`;
        const out: string[] = [];
        let allOk = true;
        for (const plan of plans) {
          const exitCodes: number[] = [];
          let planOk = true;
          for (const cmd of plan.commands) {
            let r: { exitCode: number; stdout: string; stderr: string };
            try { r = await this.actuator.runCommand(this.workspaceId, cmd); }
            catch (e) { r = { exitCode: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }; }
            const ok = r.exitCode === 0;
            allOk = allOk && ok;
            planOk = planOk && ok;
            exitCodes.push(r.exitCode);
            out.push(`${ok ? '✓' : '✗'} [${plan.tool}] ${cmd} → exit ${r.exitCode}${ok ? '' : `\n${(r.stderr || r.stdout || '').slice(-600)}`}`);
            if (!ok) break; // a failed step blocks the rest of this tool's chain — report honestly, don't push on
          }
          // GA-6 — persist THIS plan's run (tool, commands, outcome, exit codes) so a later build remembers it.
          void recordMigrationRun(this.workspaceId, {
            tool: plan.tool,
            commands: [...plan.commands],
            ok: planOk,
            exitCodes,
            ranAt: new Date().toISOString(),
          });
        }
        if (!allOk) getWorkspaceMemory(this.workspaceId).recordAudit('run_migrations: a migration command failed.');
        return `${histPrefix}${allOk ? '✅ Migrations applied.' : '⚠️ Migration FAILED (schema may be incomplete — fix before relying on the DB).'}\n${out.join('\n')}`;
      }

      case 'generate_db_config': {
        // db-provision (BYO half): wire the app to CONNECT to the user's own database (Supabase/Neon/
        // Firebase/Postgres) — a real client module + .env.example keys + the dependency. The user pastes
        // their credentials (NavBharatAI never stores them); one-click AUTO-CREATE of the DB needs an
        // external broker and is not this tool. Pure generator in DbConfigGenerator.ts.
        const provider = optStr(input, 'provider');
        if (!isDbProvider(provider)) return 'generate_db_config: pass provider = "supabase" | "neon" | "firebase" | "postgres".';
        const cfg = generateDbConfig(provider);
        const dbWritten: string[] = [];
        for (const [path, content] of Object.entries(cfg.files)) {
          // Never clobber an existing .env.example the user may have filled — only create it if absent.
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); dbWritten.push(`Kept existing ${path} (add: ${cfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          dbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('db config');
        return `Wired ${provider} database connection:\n${dbWritten.join('\n')}\nAdd the dependency: ${cfg.dependency.name}@${cfg.dependency.version}\n\n${cfg.instructions}`;
      }

      case 'generate_payment': {
        // U-4 recipe — a real Bring-Your-Own-keys payment integration (Razorpay/Stripe): a server route
        // (order/session + signature verification) + a client checkout helper. The user pastes their keys
        // into .env (NavBharatAI never stores them). Pure generator in PaymentGenerator.ts.
        const pProvider = optStr(input, 'provider');
        if (!isPaymentProvider(pProvider)) return 'generate_payment: pass provider = "razorpay" | "stripe".';
        const pcfg = generatePaymentIntegration(pProvider);
        const payWritten: string[] = [];
        for (const [path, content] of Object.entries(pcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); payWritten.push(`Kept existing ${path} (add: ${pcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          payWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('payment integration');
        return `Wired ${pProvider} payments:\n${payWritten.join('\n')}\nAdd the dependency: ${pcfg.dependency.name}@${pcfg.dependency.version}\n\n${pcfg.instructions}`;
      }

      case 'generate_email': {
        // U-4 recipe — a real BYO transactional-email helper (Resend/SendGrid). Pure generator in EmailGenerator.ts.
        const eProvider = optStr(input, 'provider');
        if (!isEmailProvider(eProvider)) return 'generate_email: pass provider = "resend" | "sendgrid".';
        const ecfg = generateEmailIntegration(eProvider);
        const emWritten: string[] = [];
        for (const [path, content] of Object.entries(ecfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); emWritten.push(`Kept existing ${path} (add: ${ecfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          emWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('email integration');
        return `Wired ${eProvider} email:\n${emWritten.join('\n')}\nAdd the dependency: ${ecfg.dependency.name}@${ecfg.dependency.version}\n\n${ecfg.instructions}`;
      }

      case 'analyze_service_split': {
        // ROADMAP §2 — turns the coupling score into a priced split decision. READ-ONLY: it never
        // rewrites the app, because auto-splitting a working app is a harmful refactor, not a feature.
        const { files: splitFiles } = await collectWorkspaceFiles(this.actuator, this.workspaceId);
        const split = analyzeServiceSplit(splitFiles);
        const seamLines = split.seams.slice(0, 8).map((s) => `- ${s.cluster} [${s.verdict}] ${s.reason}`);
        return `${split.verdict}\n\nLooked at ${split.filesScanned} files.\n${seamLines.join('\n')}`;
      }

      case 'setup_architecture': {
        const archStyle = optStr(input, 'style');
        if (!isArchitectureStyle(archStyle)) return 'setup_architecture: pass style = "clean" | "ddd" | "mvc" | "hexagonal".';
        const arch = generateArchitectureScaffold(archStyle);
        const archWritten: string[] = [];
        for (const [path, content] of Object.entries(arch.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          archWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('architecture scaffold');
        return `${archWritten.join('\n')}\nAdd the dependency: ${arch.dependencies.map((d) => `${d.name}@${d.version}`).join(', ')}\n\n${arch.instructions}`;
      }

      case 'generate_mcp_server': {
        // ROADMAP §2 — the USER's app becomes usable from Claude Desktop / Cursor. Pure generator.
        const mcpTables = normalizeMcpTables((input as Record<string, unknown>)?.tables);
        if (!mcpTables.ok) return `generate_mcp_server: ${mcpTables.message}`;
        const mcpCfg = generateMcpServer({
          tables: mcpTables.tables,
          allowWrites: (input as Record<string, unknown>)?.allowWrites === true,
          appName: optStr(input, 'appName') || undefined,
        });
        const mcpWritten: string[] = [];
        for (const [path, content] of Object.entries(mcpCfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mcpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('MCP server');
        const mcpDeps = mcpCfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `${mcpWritten.join('\n')}\nAdd the dependencies: ${mcpDeps}\n\n${mcpCfg.instructions}`;
      }

      case 'generate_storage': {
        // U-4 recipe — real BYO file uploads (S3-compatible presigned / Cloudinary signed). Pure generator.
        const sProvider = optStr(input, 'provider');
        if (!isStorageProvider(sProvider)) return 'generate_storage: pass provider = "supabase" (zero setup) | "s3" | "cloudinary".';
        const scfg = generateStorageIntegration(sProvider);
        const stWritten: string[] = [];
        for (const [path, content] of Object.entries(scfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); stWritten.push(`Kept existing ${path} (add: ${scfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          stWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('storage integration');
        const deps = scfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${sProvider} file uploads:\n${stWritten.join('\n')}\nAdd the dependencies: ${deps}\n\n${scfg.instructions}`;
      }

      case 'generate_realtime': {
        // U-4 recipe — real BYO realtime pub/sub (Pusher/Ably): server publish() + client subscribe() that
        // returns an unsubscribe cleanup. Pure generator in RealtimeGenerator.ts.
        const rtProvider = optStr(input, 'provider');
        if (!isRealtimeProvider(rtProvider)) return 'generate_realtime: pass provider = "pusher" | "ably".';
        const rcfg = generateRealtimeIntegration(rtProvider);
        const rtWritten: string[] = [];
        for (const [path, content] of Object.entries(rcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); rtWritten.push(`Kept existing ${path} (add: ${rcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('realtime integration');
        const rtDeps = rcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${rtProvider} realtime:\n${rtWritten.join('\n')}\nAdd the dependencies: ${rtDeps}\n\n${rcfg.instructions}`;
      }

      case 'generate_search': {
        // U-4 recipe — real BYO full-text search (Algolia/Meilisearch): server indexer (admin key) + client
        // search (search-only key). Pure generator in SearchGenerator.ts.
        const scProvider = optStr(input, 'provider');
        if (!isSearchProvider(scProvider)) return 'generate_search: pass provider = "algolia" | "meilisearch".';
        const sccfg = generateSearchIntegration(scProvider);
        const scWritten: string[] = [];
        for (const [path, content] of Object.entries(sccfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); scWritten.push(`Kept existing ${path} (add: ${sccfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          scWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('search integration');
        const scDeps = sccfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${scProvider} search:\n${scWritten.join('\n')}\nAdd the dependencies: ${scDeps}\n\n${sccfg.instructions}`;
      }

      case 'generate_otp': {
        // U-4 recipe — real BYO phone-OTP verification (MSG91 India-first / Twilio Verify): a server route that
        // sends + verifies the OTP server-side + a client sendOtp/verifyOtp helper. Pure generator in
        // OtpGenerator.ts. MSG91 uses global fetch (no dependency); Twilio needs the `twilio` package.
        const oProvider = optStr(input, 'provider');
        if (!isOtpProvider(oProvider)) return 'generate_otp: pass provider = "msg91" | "twilio".';
        const ocfg = generateOtpIntegration(oProvider);
        const otpWritten: string[] = [];
        for (const [path, content] of Object.entries(ocfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); otpWritten.push(`Kept existing ${path} (add: ${ocfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          otpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('otp integration');
        const otpDepLine = ocfg.dependency ? `\nAdd the dependency: ${ocfg.dependency.name}@${ocfg.dependency.version}` : '\n(No npm dependency needed — MSG91 v5 is called with the built-in fetch.)';
        return `Wired ${oProvider} phone-OTP:\n${otpWritten.join('\n')}${otpDepLine}\n\n${ocfg.instructions}`;
      }

      case 'generate_totp': {
        // Breadth recipe — RFC 6238 authenticator-app 2FA (server/lib/totp.ts): dependency-free node:crypto
        // secret + otpauth:// URI + constant-time verify with drift window. Distinct from generate_otp (SMS).
        // Pure generator in TotpGenerator.ts. No env keys.
        const totp = generateTotpIntegration();
        const totpWritten: string[] = [];
        for (const [path, content] of Object.entries(totp.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          totpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('totp 2fa');
        return `Wired authenticator-app 2FA (TOTP):\n${totpWritten.join('\n')}\n(No npm dependency needed — RFC 6238 via node:crypto.)\n\n${totp.instructions}`;
      }

      case 'generate_indian_validators': {
        // U-4 recipe — Indian identity/format validators (server/lib/indianValidators.ts): PAN/GSTIN/Aadhaar/
        // IFSC/PIN/UPI/mobile, with the REAL GSTIN mod-36 + Aadhaar Verhoeff checksums. Dependency-free.
        const ivcfg = generateIndianValidatorsIntegration();
        const ivWritten: string[] = [];
        for (const [path, content] of Object.entries(ivcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          ivWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('indian validators');
        return `Wired Indian validators:\n${ivWritten.join('\n')}\n(No npm dependency needed — real GSTIN/Aadhaar checksums.)\n\n${ivcfg.instructions}`;
      }

      case 'generate_analytics': {
        // U-4 recipe — real BYO product analytics (PostHog/Mixpanel): a server capture helper (private key) +
        // a client init/track/identify helper (public key). Pure generator in AnalyticsGenerator.ts.
        const anProvider = optStr(input, 'provider');
        if (!isAnalyticsProvider(anProvider)) return 'generate_analytics: pass provider = "posthog" | "mixpanel".';
        const ancfg = generateAnalyticsIntegration(anProvider);
        const anWritten: string[] = [];
        for (const [path, content] of Object.entries(ancfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); anWritten.push(`Kept existing ${path} (add: ${ancfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          anWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('analytics integration');
        const anDeps = ancfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${anProvider} analytics:\n${anWritten.join('\n')}\nAdd the dependencies: ${anDeps}\n\n${ancfg.instructions}`;
      }

      case 'generate_map': {
        // U-4 recipe — real BYO interactive maps (Google Maps/Mapbox): a client createMap/addMarker helper
        // using the PUBLIC browser map key. Pure generator in MapGenerator.ts.
        const mpProvider = optStr(input, 'provider');
        if (!isMapProvider(mpProvider)) return 'generate_map: pass provider = "googlemaps" | "mapbox".';
        const mpcfg = generateMapIntegration(mpProvider);
        const mpWritten: string[] = [];
        for (const [path, content] of Object.entries(mpcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); mpWritten.push(`Kept existing ${path} (add: ${mpcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('map integration');
        const mpDeps = mpcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${mpProvider} maps:\n${mpWritten.join('\n')}\nAdd the dependencies: ${mpDeps}\n\n${mpcfg.instructions}`;
      }

      case 'generate_jobs': {
        // U-4 recipe — real BYO background jobs / task queue (BullMQ over Redis / pg-boss over Postgres): a
        // server enqueueJob + processJobs helper. Pure generator in JobsGenerator.ts.
        const jbProvider = optStr(input, 'provider');
        if (!isJobsProvider(jbProvider)) return 'generate_jobs: pass provider = "bullmq" | "pgboss".';
        const jbcfg = generateJobsIntegration(jbProvider);
        const jbWritten: string[] = [];
        for (const [path, content] of Object.entries(jbcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); jbWritten.push(`Kept existing ${path} (add: ${jbcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          jbWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('jobs integration');
        const jbDeps = jbcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${jbProvider} background jobs:\n${jbWritten.join('\n')}\nAdd the dependencies: ${jbDeps}\n\n${jbcfg.instructions}`;
      }

      case 'generate_scheduler': {
        // U-4 recipe — dependency-free in-process job scheduler (server/lib/scheduler.ts): scheduleEvery +
        // scheduleDailyUtc (drift-free, error-isolated). Distinct from generate_jobs (queue). Pure generator
        // in SchedulerGenerator.ts. No env keys.
        const schcfg = generateSchedulerIntegration();
        const schWritten: string[] = [];
        for (const [path, content] of Object.entries(schcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          schWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('scheduler');
        return `Wired job scheduler:\n${schWritten.join('\n')}\n(No npm dependency needed — native timers.)\n\n${schcfg.instructions}`;
      }

      case 'generate_sms': {
        // U-4 recipe — real BYO transactional SMS (Twilio/Vonage): a server sendSms(to, body) helper. Distinct
        // from generate_otp (login/verification). Pure generator in SmsGenerator.ts.
        const smProvider = optStr(input, 'provider');
        if (!isSmsProvider(smProvider)) return 'generate_sms: pass provider = "twilio" | "vonage".';
        const smcfg = generateSmsIntegration(smProvider);
        const smWritten: string[] = [];
        for (const [path, content] of Object.entries(smcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); smWritten.push(`Kept existing ${path} (add: ${smcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          smWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('sms integration');
        return `Wired ${smProvider} transactional SMS:\n${smWritten.join('\n')}\nAdd the dependency: ${smcfg.dependency.name}@${smcfg.dependency.version}\n\n${smcfg.instructions}`;
      }

      case 'generate_password': {
        // U-4 recipe — secure password hashing (bcryptjs): hashPassword + verifyPassword + needsRehash
        // (server/lib/password.ts). Complements generate_auth (session AFTER verify). Pure generator in
        // PasswordGenerator.ts. No env keys.
        const pwcfg = generatePasswordIntegration();
        const pwWritten: string[] = [];
        for (const [path, content] of Object.entries(pwcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          pwWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('password hashing');
        return `Wired password hashing:\n${pwWritten.join('\n')}\nAdd the dependency: ${pwcfg.dependency.name}@${pwcfg.dependency.version}\n\n${pwcfg.instructions}`;
      }

      case 'generate_ratelimit': {
        // U-4 recipe — real API rate limiting (express-rate-limit) with a "memory" (single instance) or
        // "redis" (distributed) store. Pure generator in RateLimitGenerator.ts.
        const rlStore = optStr(input, 'store');
        if (!isRateLimitStore(rlStore)) return 'generate_ratelimit: pass store = "memory" | "redis".';
        const rlcfg = generateRateLimitIntegration(rlStore);
        const rlWritten: string[] = [];
        for (const [path, content] of Object.entries(rlcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); rlWritten.push(`Kept existing ${path} (add: ${rlcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rlWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('rate-limit integration');
        const rlDeps = rlcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${rlStore}-store API rate limiting:\n${rlWritten.join('\n')}\nAdd the dependencies: ${rlDeps}\n\n${rlcfg.instructions}`;
      }

      case 'generate_api_versioning': {
        // Breadth recipe — API versioning middleware (server/lib/apiVersion.ts): resolves the requested
        // version from X-API-Version/Accept-Version, validates against the supported list (406 when unknown),
        // defaults + echoes it. Dependency-free. Pure generator in ApiVersionGenerator.ts. No env keys.
        const avcfg = generateApiVersionIntegration();
        const avWritten: string[] = [];
        for (const [path, content] of Object.entries(avcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          avWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('api versioning');
        return `Wired API versioning:\n${avWritten.join('\n')}\n(No npm dependency needed — plain Express middleware.)\n\n${avcfg.instructions}`;
      }

      case 'generate_error_tracking': {
        // U-4 recipe — real BYO error/exception tracking (Sentry/Rollbar): a server + client init +
        // captureError helper. Pure generator in ErrorTrackingGenerator.ts.
        const etProvider = optStr(input, 'provider');
        if (!isErrorTrackingProvider(etProvider)) return 'generate_error_tracking: pass provider = "sentry" | "rollbar".';
        const etcfg = generateErrorTrackingIntegration(etProvider);
        const etWritten: string[] = [];
        for (const [path, content] of Object.entries(etcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); etWritten.push(`Kept existing ${path} (add: ${etcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          etWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('error-tracking integration');
        const etDeps = etcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired ${etProvider} error tracking:\n${etWritten.join('\n')}\nAdd the dependencies: ${etDeps}\n\n${etcfg.instructions}`;
      }

      case 'generate_feature_flags': {
        // U-4 recipe — real BYO server-side feature flags (LaunchDarkly/Unleash): a per-user
        // isFeatureEnabled(flag, userKey) helper for gradual rollouts / A-B / kill switches. Pure generator
        // in FeatureFlagGenerator.ts.
        const ffProvider = optStr(input, 'provider');
        if (!isFeatureFlagProvider(ffProvider)) return 'generate_feature_flags: pass provider = "launchdarkly" | "unleash".';
        const ffcfg = generateFeatureFlagIntegration(ffProvider);
        const ffWritten: string[] = [];
        for (const [path, content] of Object.entries(ffcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); ffWritten.push(`Kept existing ${path} (add: ${ffcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          ffWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('feature-flags integration');
        return `Wired ${ffProvider} feature flags:\n${ffWritten.join('\n')}\nAdd the dependency: ${ffcfg.dependency.name}@${ffcfg.dependency.version}\n\n${ffcfg.instructions}`;
      }

      case 'generate_ai': {
        // U-4 recipe — real BYO AI text generation on the USER's own key (OpenAI/Anthropic): a server
        // generateText + chat helper. Never uses NavBharatAI's own AI account. Pure generator in AiGenerator.ts.
        const aiProvider = optStr(input, 'provider');
        if (!isAiProvider(aiProvider)) return 'generate_ai: pass provider = "openai" | "anthropic".';
        const aicfg = generateAiIntegration(aiProvider);
        const aiWritten: string[] = [];
        for (const [path, content] of Object.entries(aicfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); aiWritten.push(`Kept existing ${path} (add: ${aicfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          aiWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('ai integration');
        return `Wired ${aiProvider} AI text generation (on the user's own key):\n${aiWritten.join('\n')}\nAdd the dependency: ${aicfg.dependency.name}@${aicfg.dependency.version}\n\n${aicfg.instructions}`;
      }

      case 'generate_geocoding': {
        // U-4 recipe — real BYO geocoding address<->coordinates (Google/Mapbox): a server geocode +
        // reverseGeocode helper (REST via fetch, no dependency). Pure generator in GeocodingGenerator.ts.
        const gcProvider = optStr(input, 'provider');
        if (!isGeocodingProvider(gcProvider)) return 'generate_geocoding: pass provider = "google" | "mapbox".';
        const gccfg = generateGeocodingIntegration(gcProvider);
        const gcWritten: string[] = [];
        for (const [path, content] of Object.entries(gccfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); gcWritten.push(`Kept existing ${path} (add: ${gccfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gcWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('geocoding integration');
        const gcDepLine = gccfg.dependency ? `\nAdd the dependency: ${gccfg.dependency.name}@${gccfg.dependency.version}` : '\n(No npm dependency needed — the geocoding REST API is called with the built-in fetch.)';
        return `Wired ${gcProvider} geocoding:\n${gcWritten.join('\n')}${gcDepLine}\n\n${gccfg.instructions}`;
      }

      case 'generate_translation': {
        // U-4 recipe — real BYO text translation (Google Translate/DeepL): a server translate(text, target,
        // source?) helper (REST via fetch, no dependency). Pure generator in TranslationGenerator.ts.
        const trProvider = optStr(input, 'provider');
        if (!isTranslationProvider(trProvider)) return 'generate_translation: pass provider = "google" | "deepl".';
        const trcfg = generateTranslationIntegration(trProvider);
        const trWritten: string[] = [];
        for (const [path, content] of Object.entries(trcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); trWritten.push(`Kept existing ${path} (add: ${trcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          trWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('translation integration');
        const trDepLine = trcfg.dependency ? `\nAdd the dependency: ${trcfg.dependency.name}@${trcfg.dependency.version}` : '\n(No npm dependency needed — the translation REST API is called with the built-in fetch.)';
        return `Wired ${trProvider} translation:\n${trWritten.join('\n')}${trDepLine}\n\n${trcfg.instructions}`;
      }

      case 'generate_moderation': {
        // U-4 recipe — real BYO content moderation (OpenAI Moderation/Perspective): a server moderate(text)
        // -> { flagged, score } helper (REST via fetch, no dependency). Pure generator in ModerationGenerator.ts.
        const mdProvider = optStr(input, 'provider');
        if (!isModerationProvider(mdProvider)) return 'generate_moderation: pass provider = "openai" | "perspective".';
        const mdcfg = generateModerationIntegration(mdProvider);
        const mdWritten: string[] = [];
        for (const [path, content] of Object.entries(mdcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); mdWritten.push(`Kept existing ${path} (add: ${mdcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mdWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('moderation integration');
        const mdDepLine = mdcfg.dependency ? `\nAdd the dependency: ${mdcfg.dependency.name}@${mdcfg.dependency.version}` : '\n(No npm dependency needed — the moderation REST API is called with the built-in fetch.)';
        return `Wired ${mdProvider} content moderation:\n${mdWritten.join('\n')}${mdDepLine}\n\n${mdcfg.instructions}`;
      }

      case 'generate_captcha': {
        // U-4 recipe — CAPTCHA/bot-protection verify (Turnstile/hCaptcha/reCAPTCHA): a server verifyCaptcha(token)
        // that checks the token against the provider siteverify endpoint (fetch, no dependency), fails CLOSED.
        // Pure generator in CaptchaGenerator.ts. Keeps an existing .env.example.
        const cpcfg = generateCaptchaIntegration();
        const cpWritten: string[] = [];
        for (const [path, content] of Object.entries(cpcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); cpWritten.push(`Kept existing ${path} (add: ${cpcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          cpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('captcha verification');
        return `Wired CAPTCHA verification:\n${cpWritten.join('\n')}\n(No npm dependency needed — provider siteverify via fetch.)\n\n${cpcfg.instructions}`;
      }

      case 'generate_cache': {
        // U-4 recipe — real BYO key/value caching (Redis over TCP / Upstash over HTTP): a server
        // cacheGet/cacheSet(TTL)/cacheDel helper. Pure generator in CacheGenerator.ts.
        const caProvider = optStr(input, 'provider');
        if (!isCacheProvider(caProvider)) return 'generate_cache: pass provider = "redis" | "upstash".';
        const cacfg = generateCacheIntegration(caProvider);
        const caWritten: string[] = [];
        for (const [path, content] of Object.entries(cacfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); caWritten.push(`Kept existing ${path} (add: ${cacfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          caWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('cache integration');
        return `Wired ${caProvider} caching:\n${caWritten.join('\n')}\nAdd the dependency: ${cacfg.dependency.name}@${cacfg.dependency.version}\n\n${cacfg.instructions}`;
      }

      case 'generate_retry': {
        // U-4 recipe — retry with exponential backoff + full jitter (server/lib/retry.ts). Dependency-free;
        // shouldRetry predicate + AbortSignal; rethrows last error. Pure generator in RetryGenerator.ts.
        const rtcfg = generateRetryIntegration();
        const rtWritten: string[] = [];
        for (const [path, content] of Object.entries(rtcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          rtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('retry backoff');
        return `Wired retry with backoff:\n${rtWritten.join('\n')}\n(No npm dependency needed — plain backoff + jitter.)\n\n${rtcfg.instructions}`;
      }

      case 'generate_http_client': {
        // U-4 recipe — resilient HTTP client (server/lib/http.ts): fetchJson with a real timeout + HttpError on
        // non-2xx. Dependency-free (native fetch + AbortController). Pure generator in HttpClientGenerator.ts.
        const httpcfg = generateHttpClientIntegration();
        const httpWritten: string[] = [];
        for (const [path, content] of Object.entries(httpcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          httpWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('http client');
        return `Wired resilient HTTP client:\n${httpWritten.join('\n')}\n(No npm dependency — native fetch + AbortController; pairs with generate_retry.)\n\n${httpcfg.instructions}`;
      }

      case 'generate_idempotency': {
        // U-4 recipe — idempotency-key middleware (server/lib/idempotency.ts): createMemoryStore + idempotency
        // Express middleware that replays the cached response per Idempotency-Key (no double-charge on retry).
        // Dependency-free. Pure generator in IdempotencyGenerator.ts. No env keys.
        const idmcfg = generateIdempotencyIntegration();
        const idmWritten: string[] = [];
        for (const [path, content] of Object.entries(idmcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          idmWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('idempotency');
        return `Wired idempotency middleware:\n${idmWritten.join('\n')}\n(No npm dependency needed — in-process store; swap for Redis to scale.)\n\n${idmcfg.instructions}`;
      }

      case 'generate_newsletter': {
        // U-4 recipe — real BYO newsletter/mailing-list signup (Mailchimp/Brevo): a server subscribe(email,
        // name?) helper (REST via fetch, no dependency). Distinct from generate_email (transactional send).
        // Pure generator in NewsletterGenerator.ts.
        const nlProvider = optStr(input, 'provider');
        if (!isNewsletterProvider(nlProvider)) return 'generate_newsletter: pass provider = "mailchimp" | "brevo".';
        const nlcfg = generateNewsletterIntegration(nlProvider);
        const nlWritten: string[] = [];
        for (const [path, content] of Object.entries(nlcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); nlWritten.push(`Kept existing ${path} (add: ${nlcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          nlWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('newsletter integration');
        const nlDepLine = nlcfg.dependency ? `\nAdd the dependency: ${nlcfg.dependency.name}@${nlcfg.dependency.version}` : '\n(No npm dependency needed — the provider REST API is called with the built-in fetch.)';
        return `Wired ${nlProvider} newsletter signup:\n${nlWritten.join('\n')}${nlDepLine}\n\n${nlcfg.instructions}`;
      }

      case 'generate_email_template': {
        // U-4 recipe — responsive HTML email template builder (server/lib/emailTemplate.ts): renderEmail →
        // { html, text }, table-based + inline styles + escaped. Dependency-free. Pure generator in
        // EmailTemplateGenerator.ts. No env keys.
        const etcfg = generateEmailTemplateIntegration();
        const etWritten: string[] = [];
        for (const [path, content] of Object.entries(etcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          etWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('email template');
        return `Wired HTML email template:\n${etWritten.join('\n')}\n(No npm dependency needed — table-based, escaped, html + text.)\n\n${etcfg.instructions}`;
      }

      case 'generate_currency': {
        // U-4 recipe — real BYO currency conversion (ExchangeRate-API/Fixer): a server getRate + convert
        // helper (REST via fetch, no dependency). Pure generator in CurrencyGenerator.ts.
        const cuProvider = optStr(input, 'provider');
        if (!isCurrencyProvider(cuProvider)) return 'generate_currency: pass provider = "exchangerate" | "fixer".';
        const cucfg = generateCurrencyIntegration(cuProvider);
        const cuWritten: string[] = [];
        for (const [path, content] of Object.entries(cucfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); cuWritten.push(`Kept existing ${path} (add: ${cucfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          cuWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('currency integration');
        return `Wired ${cuProvider} currency conversion:\n${cuWritten.join('\n')}\n(No npm dependency needed — the exchange-rate REST API is called with the built-in fetch.)\n\n${cucfg.instructions}`;
      }

      case 'generate_money_format': {
        // U-4 recipe — Indian money/number formatting (server/lib/money.ts). Dependency-free (Intl en-IN);
        // lakh/crore grouping + amount-in-words. Pure generator in MoneyFormatGenerator.ts. No env keys.
        const mfcfg = generateMoneyFormatIntegration();
        const mfWritten: string[] = [];
        for (const [path, content] of Object.entries(mfcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mfWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('money formatting');
        return `Wired Indian money/number formatting:\n${mfWritten.join('\n')}\n(No npm dependency needed — native Intl en-IN.)\n\n${mfcfg.instructions}`;
      }

      case 'generate_weather': {
        // U-4 recipe — real BYO current-weather lookup (OpenWeatherMap/WeatherAPI): a server getWeather(city)
        // helper (REST via fetch, no dependency). Pure generator in WeatherGenerator.ts.
        const weProvider = optStr(input, 'provider');
        if (!isWeatherProvider(weProvider)) return 'generate_weather: pass provider = "openweathermap" | "weatherapi".';
        const wecfg = generateWeatherIntegration(weProvider);
        const weWritten: string[] = [];
        for (const [path, content] of Object.entries(wecfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); weWritten.push(`Kept existing ${path} (add: ${wecfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          weWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('weather integration');
        return `Wired ${weProvider} weather:\n${weWritten.join('\n')}\n(No npm dependency needed — the weather REST API is called with the built-in fetch.)\n\n${wecfg.instructions}`;
      }

      case 'generate_datetime': {
        // U-4 recipe — IST-pinned date/time formatting (server/lib/datetime.ts). Dependency-free (Intl,
        // timeZone Asia/Kolkata) + relativeTime. Pure generator in DateTimeGenerator.ts. No env keys.
        const dtcfg = generateDateTimeIntegration();
        const dtWritten: string[] = [];
        for (const [path, content] of Object.entries(dtcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          dtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('datetime formatting');
        return `Wired IST date/time formatting:\n${dtWritten.join('\n')}\n(No npm dependency needed — native Intl, Asia/Kolkata.)\n\n${dtcfg.instructions}`;
      }

      case 'generate_notify': {
        // U-4 recipe — real BYO team notifications (Slack/Discord incoming webhooks): a server notify(message)
        // helper (webhook POST via fetch, no dependency). Pure generator in NotifyGenerator.ts.
        const noProvider = optStr(input, 'provider');
        if (!isNotifyProvider(noProvider)) return 'generate_notify: pass provider = "slack" | "discord".';
        const nocfg = generateNotifyIntegration(noProvider);
        const noWritten: string[] = [];
        for (const [path, content] of Object.entries(nocfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); noWritten.push(`Kept existing ${path} (add: ${nocfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          noWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('notify integration');
        return `Wired ${noProvider} team notifications:\n${noWritten.join('\n')}\n(No npm dependency needed — the incoming webhook is called with the built-in fetch.)\n\n${nocfg.instructions}`;
      }

      case 'generate_notification_center': {
        // Roadmap BUILD-NOW #10 — in-app notification CENTER (dependency-free React: provider + bell + badge).
        // Distinct from generate_notify (OUTBOUND channel). Pure generator in NotificationCenterGenerator.ts.
        const ncfg = generateNotificationCenterIntegration();
        const ncWritten: string[] = [];
        for (const [path, content] of Object.entries(ncfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          ncWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('notification center');
        return `Wired an in-app notification center:\n${ncWritten.join('\n')}\n(No npm dependency — React Context + localStorage.)\n\n${ncfg.instructions}`;
      }

      case 'generate_env_validation': {
        // U-4 recipe — real fail-fast env validator (server/lib/env.ts). Adds no env keys, no .env.example.
        // Pure generator in EnvValidationGenerator.ts.
        const rawKeys = input.keys;
        const keys = Array.isArray(rawKeys) ? rawKeys.filter((k): k is string => typeof k === 'string') : [];
        const evcfg = generateEnvValidation(keys);
        const evWritten: string[] = [];
        for (const [path, content] of Object.entries(evcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          evWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('env validation');
        const evKeyLine = evcfg.validatedKeys.length ? `\nValidated keys: ${evcfg.validatedKeys.join(', ')}` : '';
        return `Wired fail-fast env validation:\n${evWritten.join('\n')}${evKeyLine}\n(No npm dependency needed — plain process.env.)\n\n${evcfg.instructions}`;
      }

      case 'generate_cors': {
        // U-4 recipe — safe allowlist CORS middleware (server/lib/cors.ts). Dependency-free. Pure generator
        // in CorsGenerator.ts. Never overwrites an existing .env.example.
        const cocfg = generateCorsIntegration();
        const coWritten: string[] = [];
        for (const [path, content] of Object.entries(cocfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); coWritten.push(`Kept existing ${path} (add: ${cocfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          coWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('cors config');
        return `Wired safe CORS:\n${coWritten.join('\n')}\n(No npm dependency needed — plain response headers.)\n\n${cocfg.instructions}`;
      }

      case 'generate_csrf': {
        // U-4 recipe — CSRF protection (double-submit cookie) at server/lib/csrf.ts. Dependency-free
        // (node:crypto), constant-time compare. Pure generator in CsrfGenerator.ts. No env keys.
        const csrfcfg = generateCsrfIntegration();
        const csrfWritten: string[] = [];
        for (const [path, content] of Object.entries(csrfcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          csrfWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('csrf protection');
        return `Wired CSRF protection (double-submit cookie):\n${csrfWritten.join('\n')}\n(No npm dependency — node:crypto, constant-time compare; guard cookie-session mutating routes.)\n\n${csrfcfg.instructions}`;
      }

      case 'generate_slug': {
        // U-4 recipe — Unicode-aware URL slug generator (server/lib/slug.ts). Dependency-free; keeps Indic
        // combining marks so Hindi slugs are correct. Pure generator in SlugGenerator.ts. No env keys.
        const slcfg = generateSlugIntegration();
        const slWritten: string[] = [];
        for (const [path, content] of Object.entries(slcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          slWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('slug generation');
        return `Wired URL slug generation:\n${slWritten.join('\n')}\n(No npm dependency needed — native Unicode normalize.)\n\n${slcfg.instructions}`;
      }

      case 'generate_validation': {
        // U-4 recipe — real request validation (zod): validateBody + validate() middleware (server/lib/
        // validate.ts). Pure generator in ValidationGenerator.ts. No env keys, no .env.example.
        const vacfg = generateValidationIntegration();
        const vaWritten: string[] = [];
        for (const [path, content] of Object.entries(vacfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          vaWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('request validation');
        return `Wired request validation:\n${vaWritten.join('\n')}\nAdd the dependency: ${vacfg.dependency.name}@${vacfg.dependency.version}\n\n${vacfg.instructions}`;
      }

      case 'generate_sanitize_html': {
        // U-4 recipe — HTML sanitization / XSS prevention (sanitize-html): sanitizeHtml + sanitizeToText
        // (server/lib/sanitize.ts). Pure generator in SanitizeHtmlGenerator.ts. No env keys, no .env.example.
        const szcfg = generateSanitizeHtmlIntegration();
        const szWritten: string[] = [];
        for (const [path, content] of Object.entries(szcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          szWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('html sanitization');
        return `Wired HTML sanitization (XSS prevention):\n${szWritten.join('\n')}\nAdd the dependency: ${szcfg.dependency.name}@${szcfg.dependency.version}\n\n${szcfg.instructions}`;
      }

      case 'generate_markdown': {
        // U-4 recipe — Markdown → SAFE HTML (marked + sanitize-html): renderMarkdown renders AND sanitizes in
        // one call (safe by construction). Pure generator in MarkdownGenerator.ts. No env keys.
        const mkcfg = generateMarkdownIntegration();
        const mkWritten: string[] = [];
        for (const [path, content] of Object.entries(mkcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mkWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('markdown rendering');
        const mkDeps = mkcfg.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        return `Wired Markdown rendering:\n${mkWritten.join('\n')}\nAdd the dependencies: ${mkDeps}\n\n${mkcfg.instructions}`;
      }

      case 'generate_qr': {
        // U-4 recipe — real QR generation (qrcode): a server generateQr(text) → PNG data-URL + generateQrSvg
        // (server/lib/qr.ts). Pure generator in QrGenerator.ts. No env keys.
        const qrcfg = generateQrIntegration();
        const qrWritten: string[] = [];
        for (const [path, content] of Object.entries(qrcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          qrWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('qr generation');
        return `Wired QR code generation:\n${qrWritten.join('\n')}\nAdd the dependency: ${qrcfg.dependency.name}@${qrcfg.dependency.version}\n\n${qrcfg.instructions}`;
      }

      case 'generate_upi': {
        // U-4 recipe — UPI payment deep-link + VPA validation (src/lib/upi.ts). Dependency-free, keyless,
        // India-first: a `upi://pay?...` intent link that opens GPay/PhonePe/Paytm/BHIM with no gateway.
        // Pure generator in UpiGenerator.ts. No env keys.
        const upicfg = generateUpiIntegration();
        const upiWritten: string[] = [];
        for (const [path, content] of Object.entries(upicfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          upiWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('upi link');
        return `Wired UPI payment deep-link:\n${upiWritten.join('\n')}\n(No npm dependency, no API key — pairs with generate_qr for scan-to-pay.)\n\n${upicfg.instructions}`;
      }

      case 'generate_pdf': {
        // U-4 recipe — real PDF generation (pdfkit): a server createPdf + createInvoicePdf helper
        // (server/lib/pdf.ts). Pure generator in PdfGenerator.ts. No env keys.
        const pdfcfg = generatePdfIntegration();
        const pdfWritten: string[] = [];
        for (const [path, content] of Object.entries(pdfcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          pdfWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('pdf generation');
        return `Wired PDF generation:\n${pdfWritten.join('\n')}\nAdd the dependency: ${pdfcfg.dependency.name}@${pdfcfg.dependency.version}\n\n${pdfcfg.instructions}`;
      }

      case 'generate_csv': {
        // U-4 recipe — real CSV import/export (papaparse): a server toCsv + parseCsv helper
        // (server/lib/csv.ts) with RFC-4180-correct quoting. Pure generator in CsvGenerator.ts. No env keys.
        const csvcfg = generateCsvIntegration();
        const csvWritten: string[] = [];
        for (const [path, content] of Object.entries(csvcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          csvWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('csv import/export');
        return `Wired CSV import/export:\n${csvWritten.join('\n')}\nAdd the dependency: ${csvcfg.dependency.name}@${csvcfg.dependency.version}\n\n${csvcfg.instructions}`;
      }

      case 'generate_audit': {
        // U-4 recipe — tamper-evident hash-chained audit log (server/lib/audit.ts). Dependency-free
        // (node:crypto), storage-agnostic. Pure generator in AuditLogGenerator.ts. No env keys.
        const auditcfg = generateAuditLogIntegration();
        const auditWritten: string[] = [];
        for (const [path, content] of Object.entries(auditcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          auditWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('audit log');
        return `Wired tamper-evident audit log:\n${auditWritten.join('\n')}\n(No npm dependency — node:crypto hash chain; you back it with your own DB store.)\n\n${auditcfg.instructions}`;
      }

      case 'generate_soft_delete': {
        // Breadth recipe — soft delete / trash & restore (server/lib/softDelete.ts): dependency-free,
        // storage-agnostic softDelete/restore/isDeleted + activeOnly/trashedOnly filters + SQL WHERE clauses.
        // Pure generator in SoftDeleteGenerator.ts. No env keys.
        const sdcfg = generateSoftDeleteIntegration();
        const sdWritten: string[] = [];
        for (const [path, content] of Object.entries(sdcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          sdWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('soft delete');
        return `Wired soft delete (trash & restore):\n${sdWritten.join('\n')}\n(No npm dependency — plain deletedAt stamping + SQL clause helpers.)\n\n${sdcfg.instructions}`;
      }

      case 'generate_image': {
        // U-4 recipe — real image processing (sharp): resizeImage + makeThumbnail (server/lib/image.ts).
        // Pure generator in ImageGenerator.ts. No env keys.
        const imgcfg = generateImageIntegration();
        const imgWritten: string[] = [];
        for (const [path, content] of Object.entries(imgcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          imgWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('image processing');
        return `Wired image processing:\n${imgWritten.join('\n')}\nAdd the dependency: ${imgcfg.dependency.name}@${imgcfg.dependency.version}\n\n${imgcfg.instructions}`;
      }

      case 'generate_logging': {
        // U-4 recipe — structured logging (pino): a configured logger + a secret-safe request-logger
        // middleware (server/lib/logger.ts). Pure generator in LoggingGenerator.ts. Never overwrites .env.example.
        const lgcfg = generateLoggingIntegration();
        const lgWritten: string[] = [];
        for (const [path, content] of Object.entries(lgcfg.files)) {
          if (path === '.env.example') {
            try { await this.actuator.readFile(this.workspaceId, path); lgWritten.push(`Kept existing ${path} (add: ${lgcfg.envKeys.join(', ')})`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          lgWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('logging');
        return `Wired structured logging:\n${lgWritten.join('\n')}\nAdd the dependency: ${lgcfg.dependency.name}@${lgcfg.dependency.version}\n\n${lgcfg.instructions}`;
      }

      case 'generate_request_id': {
        // Breadth recipe — correlation-id middleware (server/lib/requestId.ts): reuses a safe inbound
        // X-Request-Id or mints a UUID, sets req.id + echoes the response header. Dependency-free (node:crypto).
        // Pairs with generate_logging/generate_tracing. Pure generator in RequestIdGenerator.ts. No env keys.
        const ricfg = generateRequestIdIntegration();
        const riWritten: string[] = [];
        for (const [path, content] of Object.entries(ricfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          riWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('request id');
        return `Wired correlation IDs:\n${riWritten.join('\n')}\n(No npm dependency needed — node:crypto randomUUID.)\n\n${ricfg.instructions}`;
      }

      case 'generate_file_upload': {
        // U-4 recipe — file-upload validation by MAGIC BYTES (server/lib/upload.ts). Dependency-free; detects
        // the TRUE type from content, not the forgeable client mime/ext. Pure generator in FileUploadGenerator.ts.
        const upcfg = generateFileUploadIntegration();
        const upWritten: string[] = [];
        for (const [path, content] of Object.entries(upcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          upWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('file-upload validation');
        return `Wired file-upload validation:\n${upWritten.join('\n')}\n(No npm dependency needed — magic-byte content sniffing.)\n\n${upcfg.instructions}`;
      }

      case 'generate_graceful_shutdown': {
        // U-4 recipe — graceful shutdown (SIGTERM drain, server/lib/shutdown.ts). Dependency-free. Pure
        // generator in GracefulShutdownGenerator.ts. Writes no .env.example.
        const gscfg = generateGracefulShutdownIntegration();
        const gsWritten: string[] = [];
        for (const [path, content] of Object.entries(gscfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          gsWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('graceful shutdown');
        return `Wired graceful shutdown:\n${gsWritten.join('\n')}\n(No npm dependency needed — Node signals + server.close().)\n\n${gscfg.instructions}`;
      }

      case 'generate_maintenance': {
        // Breadth recipe — maintenance mode (server/lib/maintenance.ts): dependency-free Express middleware
        // that returns 503 + Retry-After when on, allow-lists health checks, supports a bypass token, and a
        // runtime setMaintenance() toggle. Pure generator in MaintenanceModeGenerator.ts. Env: MAINTENANCE_MODE.
        const mmcfg = generateMaintenanceIntegration();
        const mmWritten: string[] = [];
        for (const [path, content] of Object.entries(mmcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          mmWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('maintenance mode');
        return `Wired maintenance mode:\n${mmWritten.join('\n')}\n(No npm dependency needed — plain Express middleware. Env: MAINTENANCE_MODE.)\n\n${mmcfg.instructions}`;
      }

      case 'generate_security_headers': {
        // U-4 recipe — safe security headers middleware (server/lib/securityHeaders.ts). Dependency-free,
        // CSP left commented (a wrong CSP breaks the app). Pure generator in SecurityHeadersGenerator.ts.
        const shcfg = generateSecurityHeadersIntegration();
        const shWritten: string[] = [];
        for (const [path, content] of Object.entries(shcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          shWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('security headers');
        return `Wired security headers:\n${shWritten.join('\n')}\n(No npm dependency needed — plain response headers.)\n\n${shcfg.instructions}`;
      }

      case 'generate_seo': {
        // U-4 recipe — SEO essentials (server/lib/seo.ts): buildMetaTags (OpenGraph/Twitter, escaped) +
        // buildSitemap + buildRobotsTxt. Dependency-free. Pure generator in SeoGenerator.ts. No env keys.
        const seocfg = generateSeoIntegration();
        const seoWritten: string[] = [];
        for (const [path, content] of Object.entries(seocfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          seoWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('seo');
        return `Wired SEO essentials:\n${seoWritten.join('\n')}\n(No npm dependency needed — escaped meta/sitemap/robots builders.)\n\n${seocfg.instructions}`;
      }

      case 'generate_webhook': {
        // U-4 recipe — incoming-webhook HMAC signature verification (server/lib/webhook.ts). Dependency-free
        // (node:crypto), constant-time compare over the RAW body. Pure generator in WebhookGenerator.ts.
        const whcfg = generateWebhookIntegration();
        const whWritten: string[] = [];
        for (const [path, content] of Object.entries(whcfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          whWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('webhook verification');
        return `Wired webhook signature verification:\n${whWritten.join('\n')}\n(No npm dependency needed — node:crypto.)\n\n${whcfg.instructions}`;
      }

      case 'generate_webhook_sender': {
        // U-4 recipe — outgoing signed webhook sender (server/lib/webhookSender.ts): sendWebhook HMAC-signs the
        // body in the same sha256=<hex> format generate_webhook verifies, with a timeout. Dependency-free.
        const wscfg = generateWebhookSenderIntegration();
        const wsWritten: string[] = [];
        for (const [path, content] of Object.entries(wscfg.files)) {
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          wsWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('webhook sender');
        return `Wired outgoing webhook sender:\n${wsWritten.join('\n')}\n(No npm dependency needed — node:crypto + fetch.)\n\n${wscfg.instructions}`;
      }

      case 'generate_mobile_export': {
        // UT-2 — wrap the generated web app as a native mobile project via Capacitor. Pure generator in
        // MobileExportGenerator.ts; emits config + runbook. Never clobbers an existing capacitor.config.ts.
        const meResult = generateMobileExport({
          appName: optStr(input, 'appName'),
          appId: optStr(input, 'appId'),
          webDir: optStr(input, 'webDir'),
        });
        const meWritten: string[] = [];
        for (const [path, content] of Object.entries(meResult.files)) {
          if (path === 'capacitor.config.ts') {
            try { await this.actuator.readFile(this.workspaceId, path); meWritten.push(`Kept existing ${path}`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          meWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('mobile export');
        const meDeps = meResult.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        const meScripts = Object.entries(meResult.scripts).map(([k, v]) => `"${k}": "${v}"`).join(', ');
        return `Mobile export (Capacitor):\n${meWritten.join('\n')}\nAdd the dependencies: ${meDeps}\nAdd the scripts: ${meScripts}\n\n${meResult.instructions}`;
      }

      case 'generate_desktop_export': {
        // UT-1 — wrap the generated web app as an Electron desktop project. Pure generator in
        // DesktopExportGenerator.ts; emits main + builder config + runbook. Never clobbers electron-builder.yml.
        const deResult = generateDesktopExport({
          appName: optStr(input, 'appName'),
          appId: optStr(input, 'appId'),
          webDir: optStr(input, 'webDir'),
        });
        const deWritten: string[] = [];
        for (const [path, content] of Object.entries(deResult.files)) {
          if (path === 'electron-builder.yml') {
            try { await this.actuator.readFile(this.workspaceId, path); deWritten.push(`Kept existing ${path}`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          deWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('desktop export');
        const deDeps = deResult.dependencies.map((d) => `${d.name}@${d.version}`).join(', ');
        const deScripts = Object.entries(deResult.scripts).map(([k, v]) => `"${k}": "${v}"`).join(', ');
        return `Desktop export (Electron):\n${deWritten.join('\n')}\nSet package.json "main": "${deResult.mainEntry}"\nAdd the devDependencies: ${deDeps}\nAdd the scripts: ${deScripts}\n\n${deResult.instructions}`;
      }

      case 'generate_extension_export': {
        // UT-3 — wrap the generated web app as a Manifest V3 browser extension. Pure generator in
        // ExtensionExportGenerator.ts. Never clobbers an existing manifest.json.
        const xtResult = generateExtensionExport({
          appName: optStr(input, 'appName'),
          description: optStr(input, 'description'),
          webDir: optStr(input, 'webDir'),
        });
        const xtWritten: string[] = [];
        for (const [path, content] of Object.entries(xtResult.files)) {
          if (path === 'manifest.json') {
            try { await this.actuator.readFile(this.workspaceId, path); xtWritten.push(`Kept existing ${path}`); continue; } catch { /* absent → create */ }
          }
          let kind: 'create' | 'modify' = 'create';
          try { await this.actuator.readFile(this.workspaceId, path); kind = 'modify'; } catch { kind = 'create'; }
          await this.actuator.writeFile(this.workspaceId, path, content);
          this.state?.recordFileChange({ path, kind }, agent);
          getWorkspaceMemory(this.workspaceId).indexFile(path, content);
          xtWritten.push(`${kind === 'create' ? 'Created' : 'Updated'} ${path}`);
        }
        this.scheduleCheckpoint('extension export');
        return `Browser extension export (Manifest V3):\n${xtWritten.join('\n')}\n\n${xtResult.instructions}`;
      }

      case 'repair_ci_workflow': {
        // GA-14 — detect + fix a generated GitHub Actions workflow that will fail deterministically. Pure
        // logic in ciWorkflowAnalysis.ts; reads the project's workflows + package.json + lockfile presence.
        let allFiles: string[] = [];
        try { allFiles = await this.actuator.listFiles(this.workspaceId); } catch { return 'repair_ci_workflow: could not list workspace files.'; }
        const workflows = allFiles.filter((p) => ciPlatform(p) !== null).slice(0, 15);
        if (workflows.length === 0) return 'repair_ci_workflow: no CI files found (.github/workflows/*.yml, .gitlab-ci.yml, or Jenkinsfile).';
        const map: Record<string, string> = {};
        for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']) {
          if (allFiles.includes(lock)) map[lock] = '';
        }
        for (const p of [...workflows, ...(allFiles.includes('package.json') ? ['package.json'] : [])]) {
          try { map[p] = await this.actuator.readFile(this.workspaceId, p); } catch { /* skip unreadable */ }
        }
        const issues = analyzeCiWorkflow(map);
        const applied: string[] = [];
        for (const wf of workflows) {
          const { content, fixes } = repairCiWorkflow(wf, map);
          if (fixes.length > 0 && content && content !== map[wf]) {
            await this.actuator.writeFile(this.workspaceId, wf, content);
            this.state?.recordFileChange({ path: wf, kind: 'modify' }, agent);
            getWorkspaceMemory(this.workspaceId).indexFile(wf, content);
            applied.push(`Fixed ${wf}: ${fixes.join('; ')}`);
          }
        }
        if (applied.length > 0) this.scheduleCheckpoint('ci workflow repair');
        const manual = issues.filter((i) => !i.autoFixable).map((i) => `  • ${i.file}:${i.line} — ${i.message}`);
        if (applied.length === 0 && manual.length === 0) return 'repair_ci_workflow: no CI-workflow problems detected — the workflows look runnable.';
        return `CI workflow repair:\n${applied.length ? applied.join('\n') : 'No auto-fixable issues.'}${manual.length ? `\n\nNeeds a manual fix (cannot auto-repair):\n${manual.join('\n')}` : ''}`;
      }

      case 'optimize_infra': {
        // GA-15 — static infra optimizer: scan the workspace's Dockerfile / K8s / Terraform for real
        // anti-patterns. Pure logic in InfraOptimizer.ts.
        let ioFiles: string[] = [];
        try { ioFiles = await this.actuator.listFiles(this.workspaceId); } catch { return 'optimize_infra: could not list workspace files.'; }
        const candidates = ioFiles.filter((p) => {
          const b = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
          return (b === 'dockerfile' || b.endsWith('.dockerfile') || b.startsWith('dockerfile.') || /\.(tf|ya?ml)$/i.test(p)) && !/(^|\/)node_modules(\/|$)/.test(p);
        }).slice(0, 40);
        const contents: Array<{ path: string; content: string }> = [];
        for (const p of candidates) {
          try { contents.push({ path: p, content: await withTimeout(this.actuator.readFile(this.workspaceId, p), 5_000, 'readFile') }); } catch { /* skip */ }
        }
        return infraOptimizeSummary(optimizeInfra(contents));
      }

      case 'schema_graph': {
        // GA-5 — the DB schema relationship graph + change-propagation blast radius: what depends on a
        // model/table before you rename/drop it. Pure logic in schemaGraph.ts; reads .prisma/.sql separately.
        let sgFiles: string[] = [];
        try { sgFiles = await this.actuator.listFiles(this.workspaceId); } catch { return 'schema_graph: could not list workspace files.'; }
        const schemaPaths = sgFiles.filter((p) => /\.(prisma|sql)$/i.test(p) && !/(^|[\\/])node_modules([\\/]|$)/.test(p)).slice(0, 30);
        if (schemaPaths.length === 0) return 'schema_graph: no .prisma or .sql schema files found.';
        const sgSources: Array<{ path: string; content: string }> = [];
        for (const p of schemaPaths) {
          try { sgSources.push({ path: p, content: await this.actuator.readFile(this.workspaceId, p) }); } catch { /* skip */ }
        }
        const target = optStr(input, 'model');
        const prismaReport = schemaGraphReport(analyzeSchemaGraph(sgSources), target);
        const sqlReport = schemaGraphReport(analyzeSqlSchema(sgSources), target);
        const parts = [prismaReport, sqlReport].filter(Boolean);
        if (parts.length === 0) return target ? `schema_graph: '${target}' is not a defined model/table.` : 'schema_graph: no models/tables detected in the schema files.';
        return parts.join('\n\n');
      }

      case 'generate_types': {
        // GA-10 — generate TypeScript interfaces from the DB schema (.prisma models / SQL tables) so the
        // frontend + backend share one typed shape. Pure logic in schemaTypeGen.ts.
        let gtFiles: string[] = [];
        try { gtFiles = await this.actuator.listFiles(this.workspaceId); } catch { return 'generate_types: could not list workspace files.'; }
        const gtPaths = gtFiles.filter((p) => /\.(prisma|sql)$/i.test(p) && !/(^|[\\/])node_modules([\\/]|$)/.test(p)).slice(0, 30);
        if (gtPaths.length === 0) return 'generate_types: no .prisma or .sql schema files found to generate types from.';
        const gtSources: Array<{ path: string; content: string }> = [];
        for (const p of gtPaths) {
          try { gtSources.push({ path: p, content: await this.actuator.readFile(this.workspaceId, p) }); } catch { /* skip */ }
        }
        const gen = generateSchemaTypes(gtSources);
        if (!gen) return 'generate_types: no models/tables were parseable from the schema — nothing to generate.';
        const outPath = optStr(input, 'outPath') || 'src/types/db.ts';
        let kind: 'create' | 'modify' = 'create';
        try { await this.actuator.readFile(this.workspaceId, outPath); kind = 'modify'; } catch { kind = 'create'; }
        await this.actuator.writeFile(this.workspaceId, outPath, gen.fileContent);
        this.state?.recordFileChange({ path: outPath, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(outPath, gen.fileContent);
        this.scheduleCheckpoint('schema types');
        return `${kind === 'create' ? 'Created' : 'Updated'} ${outPath} — ${gen.types.length} type(s) from your ${gen.source} schema (${gen.types.map((t) => t.name).slice(0, 12).join(', ')}${gen.types.length > 12 ? '…' : ''}). Import them in the frontend + backend for one shared typed shape.`;
      }

      case 'replace_symbol': {
        const path = optStr(input, 'path');
        const symbol = optStr(input, 'symbol');
        const code = typeof (input as Record<string, unknown>)?.code === 'string' ? (input as Record<string, unknown>).code as string : '';
        if (!path || !symbol || !code.trim()) {
          return 'replace_symbol: "path", "symbol" and "code" are all required.';
        }
        let current: string;
        try {
          current = await this.actuator.readFile(this.workspaceId, path);
        } catch {
          return `replace_symbol: file not found: ${path}. Use write_file to create it first.`;
        }
        const result = replaceSymbol(current, symbol, code);
        if (!result.ok || typeof result.content !== 'string') {
          return result.error || `replace_symbol: could not replace "${symbol}" in ${path}.`;
        }
        if (result.content === current) {
          return `replace_symbol: no change — the new code for "${symbol}" is identical.`;
        }
        await this.actuator.writeFile(this.workspaceId, path, result.content);
        this.state?.recordFileChange({ path, kind: 'modify' }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, result.content);
        this.scheduleCheckpoint(`replace ${symbol} in ${path}`);
        return `Replaced top-level symbol "${symbol}" in ${path} (AST-safe — surrounding code untouched).`;
      }

      case 'check_conventions': {
        const rec = (input as Record<string, unknown>) || {};
        const files = Array.isArray(rec.files) ? rec.files.filter((f): f is string => typeof f === 'string') : [];
        const imports = Array.isArray(rec.imports) ? rec.imports.filter((i): i is string => typeof i === 'string') : [];
        const VALID_KINDS = new Set<IdentifierKind>(['function', 'variable', 'constant', 'component', 'type']);
        const identifiers = (Array.isArray(rec.identifiers) ? rec.identifiers : [])
          .map((x: unknown) => {
            if (typeof x !== 'object' || x === null) return null;
            const o = x as Record<string, unknown>;
            const name = typeof o.name === 'string' ? o.name : '';
            const kind = o.kind as IdentifierKind;
            return name && VALID_KINDS.has(kind) ? { name, kind } : null;
          })
          .filter((x): x is { name: string; kind: IdentifierKind } => x !== null);
        if (files.length === 0 && imports.length === 0 && identifiers.length === 0) {
          return 'check_conventions: pass at least one of files[], identifiers[], or imports[] to check.';
        }
        const report = analyzeConventions({ files, identifiers, imports });
        if (report.violationCount === 0) {
          return '✓ No naming/convention violations found — files, identifiers and import order are consistent.';
        }
        const lines: string[] = [`Found ${report.violationCount} convention violation(s):`];
        for (const f of report.files) {
          if (!f.ok) lines.push(`• file ${f.path}: expected ${f.expectedCase}${f.suggestion ? ` → ${f.suggestion}` : ''} (${f.reason})`);
        }
        for (const i of report.identifiers) {
          if (!i.ok) lines.push(`• ${i.kind} "${i.name}": expected ${i.expectedCase}${i.suggestion ? ` → ${i.suggestion}` : ''}`);
        }
        if (report.importOrder?.changed) {
          lines.push('• imports are not in the conventional order. Suggested order:');
          for (const l of report.importOrder.ordered) if (l) lines.push(`    ${l}`);
        }
        lines.push('Apply these with edit_file to keep the code consistent.');
        return lines.join('\n');
      }

      case 'generate_release_notes': {
        const rec = (input as Record<string, unknown>) || {};
        const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const features = strArr(rec.features);
        if (features.length === 0) {
          return 'generate_release_notes: pass the current "features" array (the app\'s user-visible features).';
        }
        const previousFeatures = strArr(rec.previous_features);
        const note = generateReleaseNote(
          { name: optStr(input, 'name'), features, techStack: strArr(rec.tech_stack) },
          previousFeatures.length > 0 ? { features: previousFeatures } : null,
          { version: optStr(input, 'version'), date: new Date().toISOString().slice(0, 10) },
        );
        const path = optStr(input, 'path') || 'RELEASE_NOTES.md';
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, note.markdown);
        this.state?.recordFileChange({ path, kind }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, note.markdown);
        this.scheduleCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} — ${note.version}: ${note.summary}`;
      }

      case 'update_preview': {
        const port = reqNum(input, 'port');
        if (!this.actuator.getPortUrl) {
          throw new Error('Live preview is not available in this sandbox.');
        }
        // The user's own keys MUST be on disk before a dev server starts. This path can start one via the
        // actuator without any run_command having gone through the lazy gate, which is how an imported app
        // booted with none of the keys its owner had saved in Settings (mitrify autopsy 2026-08-04).
        await this.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
        // …and the secrets the app mints for ITSELF. The call above returns early when the user has
        // no saved secrets, which is exactly when an app with a session middleware cannot boot.
        await this.ensureSelfIssuedDevSecrets();
        // LOOP-BREAKER (build-diagnostics root cause): once preview has DEFINITIVELY failed —
        // including a managed dev-server start — stop the retry loop cold. Without this the model
        // re-ran update_preview / npm run dev until the step cap (~10 min burned, build reported
        // failed even though the code was finished).
        if (this.previewGaveUp) {
          return 'FINAL: the live preview could not be brought up in this sandbox (a managed dev-server start was already attempted). Do NOT call update_preview or restart the dev server again. Finish the build now and tell the user honestly: the files are complete and saved, but the live preview is unavailable in this environment.';
        }
        // Verify the port is actually listening before publishing. Bounded TWO ways so this tool can
        // NEVER hang the whole build (the real freeze we saw: a single sandbox runCommand stalled and
        // update_preview sat in-flight for 15 min until the wall-clock cap). (1) Each port check is
        // wrapped in withTimeout so one stalled `nc` can't block forever; (2) the whole poll has a
        // hard wall-clock budget so it always exits regardless of how the actuator behaves.
        // Tool-agnostic, IPv4-forced check (same fix as the dev-server launcher): the old
        // `nc -z localhost` read a HEALTHY server as DOWN when the sandbox image lacks `nc`, or
        // when `localhost` resolves to IPv6 ::1 while Vite binds IPv4 0.0.0.0. nc → curl → /dev/tcp.
        const pollPort = async (budgetMs: number): Promise<boolean> => {
          const deadline = Date.now() + budgetMs;
          for (let attempt = 0; attempt < 30 && Date.now() < deadline; attempt++) {
            try {
              const chk = await withTimeout(
                this.actuator.runCommand(
                  this.workspaceId,
                  `if nc -z 127.0.0.1 ${port} 2>/dev/null || curl -s -o /dev/null --max-time 2 http://127.0.0.1:${port} 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then echo PORT_UP; else echo PORT_DOWN; fi`,
                ),
                4_000,
                'preview-port-check',
              );
              if (chk.stdout.includes('PORT_UP')) return true;
            } catch { /* a stalled/failed check just counts as not-ready — keep polling within budget */ }
            if (Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
          }
          return false;
        };
        let portReady = await pollPort(6_000);
        // SELF-HEAL: the preview must not depend on the model having started the dev server
        // correctly (running `npm run dev` as a plain foreground bash returns in ~2s and the
        // process dies — the diagnostics' exact loop). When the port is down and this is a node
        // project, launch the dev server through the actuator's managed long-running path
        // (backgrounded + deps check + port pin + recovery), then re-poll. Bounded.
        let healNote = '';
        if (!portReady) {
          const hasPkg = await this.actuator.readFile(this.workspaceId, 'package.json').then(() => true).catch(() => false);
          if (hasPkg) {
            let healConfirmedUp = false;
            try {
              const heal = await withTimeout(
                this.actuator.runCommand(this.workspaceId, `PORT=${port} npm run dev`),
                240_000,
                'preview-managed-dev-start',
              );
              const healOut = `${heal.stdout || ''}\n${heal.stderr || ''}`;
              const tail = healOut.trim().slice(-200);
              healNote = ` A managed dev-server start was attempted${tail ? ` (${tail})` : ''}.`;
              // AUTHORITATIVE VERDICT: the managed launcher runs the SAME port check (buildPortWaitCommand)
              // that pollPort re-runs, then prints its result. When it confirms the port UP, TRUST it — a
              // second, independent inline re-poll must NEVER override a launcher-confirmed UP to DOWN. That
              // "two drifting truths, the flaky one wins" bug reported a genuinely-booted app as "the live
              // preview didn't start automatically" (build report 2026-07-06: npm run dev → "dev server is UP
              // on port 5173", yet update_preview's re-poll missed it → no preview published, BUILD_PARTIAL).
              // A health-UP can only ever CONFIRM up; we still fall back to the inline poll when there's no
              // verdict, and getPortUrl below still gates the actual URL — so we never publish a dead preview.
              const verdict = parseDevServerHealthLine(healOut);
              if (verdict?.up) { portReady = true; healConfirmedUp = true; }
            } catch (err) {
              healNote = ` A managed dev-server start was attempted but did not finish in time (${err instanceof Error ? err.message : String(err)}).`;
            }
            if (!healConfirmedUp) portReady = await pollPort(10_000);
          }
        }
        // §12: v5.0-built apps are previewed under the platform's E2B custom domain
        // (mitrify.xyz) instead of the raw *.e2b.app host. Idempotent + scoped to v5.0.
        // Bounded too — getPortUrl talks to the sandbox SDK and must not hang the build.
        let rawUrl: string;
        try {
          rawUrl = await withTimeout(this.actuator.getPortUrl(this.workspaceId, port), 10_000, 'preview-get-url');
        } catch {
          return `WARNING: could not resolve the preview URL for port ${port} (the sandbox did not respond in time) — preview NOT published. Make sure the dev server is up, then call update_preview again.`;
        }
        const url = applyPreviewDomain(rawUrl);
        if (!portReady) {
          // Audit P2: do NOT emit a preview URL the user would click into a blank/502 page — the
          // "preview is EARNED" rule.
          this.previewFails++;
          if (this.previewFails >= 2) {
            this.previewGaveUp = true;
            return `WARNING: port ${port} is still not responding even after a managed dev-server start.${healNote} Preview NOT published. Do NOT retry update_preview or the dev server — finish the build now and tell the user honestly that the live preview is unavailable; their files are complete and saved.`;
          }
          return `WARNING: port ${port} did not respond.${healNote} Preview NOT published. If dependencies were still installing, you may call update_preview ONE more time; do not retry beyond that.`;
        }
        this.previewFails = 0;
        /**
         * 🔒 THE OLD APP MUST ACTUALLY LEAVE (admin 2026-08-25 — the piano-instead-of-UPI-API preview).
         *
         * This is the one moment we hold PROOF about the new app: its port was just verified UP. Any
         * port this workspace's own records name that differs from it belongs to the PREVIOUS app —
         * whose dev server, left running in the resumed sandbox, wins every honest probe the preview
         * door makes (a live listener is a live listener; the door verified the wrong app perfectly).
         * So: stop that server, retire the recipe that pointed at it, and record the new port as the
         * declared one. Only record-named ports are ever freed — never a swept or guessed list — and
         * database ports never (see previewSupersede.ts). Best-effort: a failure here degrades the
         * preview, it must never touch a build that already succeeded.
         */
        try {
          const [recipe, record] = await Promise.all([
            sandboxStore.getRecipe(this.workspaceId),
            sandboxStore.getRecord(this.workspaceId),
          ]);
          const decision = decideSupersede({ newPort: port, recipe, declaredPort: record?.declaredPort });
          if (decision.staleports.length > 0) {
            await withTimeout(
              this.actuator.runCommand(this.workspaceId, buildPreKillPortCommand(decision.staleports)),
              8_000, 'preview-supersede-kill',
            ).catch(() => { /* the old server surviving is the status quo, not a new failure */ });
          }
          if (decision.retireRecipe || decision.staleports.length > 0) {
            await sandboxStore.supersedeRecipe(this.workspaceId, port);
            // Through the event stream, which BuildDiagnostics already listens to — this dispatcher
            // holds no diagnostics handle of its own, and the user deserves the sentence too: it is
            // the honest explanation of why the preview may have LOOKED like a different app until now.
            if (decision.note) {
              this.events?.emit({ type: 'narration', agent: 'architect', text: `🧹 ${decision.note}`, ts: Date.now() });
            }
          } else {
            // Same app, same port — just keep the declared port fresh for the door.
            await sandboxStore.saveDeclaredPort(this.workspaceId, port);
          }
        } catch { /* superseding is insurance for the NEXT view — never this build's problem */ }
        // Bake the "made by NavBharatAI" badge into the app's index.html the moment the preview is
        // genuinely up (port verified) — so the very preview the user sees, and any later deploy of
        // these same files, carries the signature. Gated by the user's Settings → General toggle;
        // best-effort so it can never break/block a working preview.
        await this.injectAppSignatureIntoIndexHtml();
        this.events?.emit({ type: 'preview', url, ts: Date.now() });
        return `Live preview published at ${url} (port ${port} verified UP)`;
      }

      case 'task': {
        if (!this.spawnSubAgent) {
          throw new Error('The task tool is not available in this context.');
        }
        const role = reqStr(input, 'role');
        const instruction = reqStr(input, 'instruction');
        if (!isWorkerRole(role)) {
          throw new Error(`task: unknown role "${role}".`);
        }
        this.events?.emit({ type: 'agent_spawned', agent: role, task: instruction, ts: Date.now() });
        const result = await this.spawnSubAgent(role, instruction);
        return result.ok ? `[${role}] ${result.summary}` : `[${role}] FAILED: ${result.summary}`;
      }

      case 'second_opinion': {
        const prompt = reqStr(input, 'prompt');
        if (!this.secondOpinion) {
          return 'Second opinion is not available in this context.';
        }
        const review = await this.secondOpinion(prompt);
        return review;
      }

      case 'consensus': {
        const question = reqStr(input, 'question');
        if (!this.consensus) {
          return 'Consensus is not available in this context.';
        }
        return await this.consensus(question);
      }

      case 'web_search': {
        const query = reqStr(input, 'query');
        if (!this.webSearch) {
          return 'Web search is not available in this context.';
        }
        const limit = typeof input.limit === 'number' ? input.limit : 5;
        return await this.webSearch(query, limit);
      }

      case 'web_fetch': {
        // A3 — read ONE user-supplied URL. All SSRF defence lives in webFetch.ts (shared ssrfGuard,
        // redirect refusal, streamed size cap, timeout); this case only turns the result into the
        // tool's contract. A failure THROWS, like every other tool here, so the agent reads it as a
        // TOOL_ERROR with an honest sentence and can choose what to do next.
        const url = reqStr(input, 'url');
        return formatWebFetchResult(url, await webFetchUrl(url));
      }

      case 'deploy': {
        // PUBLISHING IS THE USER'S DECISION (admin 2026-09-01).
        //
        // A user typed "continue". The build finished and the agent decided by itself — "Build
        // successful! Ab deploy karta hoon." — and their app went onto a public URL. The only thing
        // between a private app and the open internet was a SENTENCE in this tool's description
        // ("use when the user asks to deploy/publish/go live"), and the model did not follow it. A
        // permission enforced by asking the model nicely is not a permission.
        //
        // So it is a gate now, and it DENIES by default: the composition root grants it only for the
        // explicit Publish button or a turn where the user actually asked. The asymmetry is what sets
        // that default — refusing someone who wanted it live costs one sentence and the button is
        // right there, while allowing it wrongly puts unfinished work in public.
        //
        // Refused as a normal tool result, not a throw: the model should RELAY this ("your app is
        // ready, press Publish"), and an error would read to it as the app being unfit to publish.
        if (!this._publishConsent) return PUBLISH_NOT_REQUESTED;

        // A DEPLOY THAT DID NOT DEPLOY MUST NOT REPORT SUCCESS (autopsy build aed2906d, 2026-08-09).
        //
        // Every branch below used to RETURN a sentence. A returned string is a SUCCESSFUL tool result, so
        // the build timeline recorded `✓ deploy (0s)` twice, no URL was ever emitted, and the agent was
        // left guessing — it went off running `ls -la dist/` and `pwd && ls -la` trying to work out what
        // had happened. The user had asked for one thing, a live link, and got neither the link nor an
        // error. THROWING is how every other tool reports a failure here (it becomes a TOOL_ERROR the
        // agent can read and act on), so deploy now uses the same convention as the rest of the catalog.
        // The message text is unchanged — it was already the right explanation, it was just being
        // delivered as if it were good news.
        if (!this.deploy) {
          throw new Error('Deployment is not configured in this context.');
        }
        if (!this.actuator.downloadDistFiles) {
          throw new Error('Deployment requires a real cloud sandbox (set E2B_API_KEY) — not available here.');
        }
        let files: Map<string, Buffer>;
        try {
          files = await this.actuator.downloadDistFiles(this.workspaceId);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          throw new Error(`Could not read the built site: ${m}. Run "npm run build" first so a dist/ directory exists.`);
        }
        if (files.size === 0) {
          throw new Error('No built files found. Run "npm run build" to produce dist/ before deploying.');
        }
        // …AND IT MUST BE THE USER'S APP, not the starter page (admin 2026-08-25). A publish reported
        // success and handed over a link to "Welcome to Navbharat AI Sandbox — ask AI to build
        // something". Every gate had passed and each was individually right: the build exited 0, an
        // output directory existed, and five files is not zero. Emptiness was the only thing anyone
        // checked, and a placeholder is not empty. See publishablePayload.ts for why this is ONE
        // signal and why it refuses to guess at a second.
        //
        // The SECOND signal needs the workspace's own file list. Best-effort and deliberately so: if
        // the listing fails we pass `undefined`, the check skips, and behaviour is exactly today's. A
        // publish blocked by OUR blindness is the failure mode this guard exists to prevent, so it
        // must never be the thing that stops one.
        let sourcePaths: string[] | undefined;
        try { sourcePaths = await this.actuator.listFiles(this.workspaceId); } catch { sourcePaths = undefined; }
        const publishable = publishableVerdict(entryPagesOf(files), {
          distPaths: [...files.keys()],
          sourcePaths,
        });
        if (!publishable.ok) throw new Error(publishable.reason);
        const url = await this.deploy(this.workspaceId, files);
        this.events?.emit({ type: 'preview', url, ts: Date.now() });
        // P-PIPE.78 — honest bundle size from the dist map we already downloaded (zero extra I/O,
        // pure, never throws). Tells the user how heavy their shipped app is.
        let bundleLine = '';
        try { bundleLine = bundleSummaryLine(summarizeBundle(files)); } catch { /* size is best-effort */ }
        // P-PIPE.116 — post-deploy liveness: one bounded GET to the published URL so the user learns the
        // site actually responds. Best-effort + honest (never claims failure for a still-propagating URL);
        // a transport error / timeout only ADDS a soft note and never affects the deploy success above.
        let liveLine = '';
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5_000);
          try {
            const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
            liveLine = ` ${livenessLine({ kind: 'http', status: res.status })}`;
          } catch (e) {
            const reason = e instanceof Error && e.name === 'AbortError' ? 'timed out after 5s' : 'connection failed';
            liveLine = ` ${livenessLine({ kind: 'unreachable', reason })}`;
          } finally {
            clearTimeout(timer);
          }
        } catch { /* liveness is best-effort — never affects the deploy result */ }
        // THE PRODUCTION DATABASE (admin's own "asli gap: PRODUCTION DB"). The sandbox's Postgres dies
        // with the build, so a published app points at the user's durable database — which has NO
        // TABLES IN IT. The page loads and then every signup, order and booking fails against a schema
        // that was never created there. Everything up to this point was already built (provisioning,
        // connecting, Studio, the publish gate); this is the step that was missing.
        //
        // Runs the app's OWN migrations, with DATABASE_URL pointed at the live database for these
        // commands only — the sandbox `.env` is untouched, so the preview keeps its throwaway DB. Every
        // command is re-checked against the production allowlist at the moment it would run
        // (productionMigration.ts): `prisma migrate deploy` is allowed, `migrate reset` can never be.
        // Best-effort by design — a migration problem must not turn a successful publish into a
        // failure, so it degrades to an honest line telling the user their app is live but cannot yet
        // save data.
        const migrationLine = await this.migrateProductionDatabase().catch(() => '');
        // THE SERVER HALF THAT DOES NOT COME WITH IT (admin autopsy 2026-09-01).
        //
        // A user's ad-blocker browser was built as TWO processes: `server.ts`, an Express proxy that
        // fetched pages and stripped the ads — the entire product — and a Vite frontend whose
        // dev-server proxy forwarded `/api` to it. Both ran in the sandbox and the platform PROVED it
        // (`curl :3001/health` ok, `curl :3001/api/fetch` returned a real page). Then this tool
        // published the static build, and the summary told the user their browser was ready and would
        // block ads. It could not: a Vite `server.proxy` does not exist after `vite build`, and static
        // hosting cannot run a Node process, so the ad-blocking half was live nowhere. The user saw a
        // site that worked while it was being built and stopped working once it was "finished", and
        // reasonably concluded we had broken it. Nothing broke — the working half was never published.
        //
        // Every existing gate asked "did files come out?" — dist was non-empty and was not the starter
        // page, so `publishableVerdict` passed, correctly. Nobody asked "can what we are publishing
        // actually RUN where we are putting it?"
        //
        // This never blocks the publish: the frontend really is live and taking that away would remove
        // something that works. It removes the false CLAIM instead, by putting the truth in the tool
        // result the agent writes its summary from. Best-effort throughout — a guard that could fail a
        // working publish would be a worse bug than the one it closes.
        let serverNeedLine = '';
        try {
          const [pkg, cfg] = await Promise.all([
            this.actuator.readFile(this.workspaceId, 'package.json').catch(() => undefined),
            (async () => {
              for (const c of ['vite.config.ts', 'vite.config.js', 'webpack.config.js']) {
                try { return await this.actuator.readFile(this.workspaceId, c); } catch { /* next */ }
              }
              return undefined;
            })(),
          ]);
          const verdict = detectServerNeed({ sourcePaths, packageJson: pkg, buildConfig: cfg });
          if (verdict.needsServer) serverNeedLine = ` ${verdict.note}`;
        } catch { /* the guard is advisory — it can never affect a publish */ }
        return `Deployed to a permanent public URL: ${url} (${files.size} files).${bundleLine ? ` ${bundleLine}` : ''}${liveLine}${migrationLine}${serverNeedLine} This stays live after the sandbox stops.`;
      }

      case 'console_errors': {
        if (!this.actuator.getConsoleErrors) {
          return 'Runtime console errors require a real cloud sandbox — not available here.';
        }
        const sinceSec = typeof input.since_seconds === 'number' ? input.since_seconds : 120;
        const since = Date.now() - Math.max(1, sinceSec) * 1000;
        const { errors } = await this.actuator.getConsoleErrors(this.workspaceId, since);
        if (errors.length === 0) return 'No runtime browser errors captured in the window — the page ran clean.';
        return `Runtime browser errors (${errors.length}):\n` + errors.slice(0, 30).map((e) => `- [${e.kind}] ${e.text}`).join('\n');
      }

      // Level 7: structural codemods (AST-safe cross-file refactoring via ts-morph).
      case 'codemod_rename': {
        const oldName = reqStr(input, 'old_name');
        const newName = reqStr(input, 'new_name');
        let files: string[];
        try {
          files = await this.actuator.listFiles(this.workspaceId);
        } catch {
          return 'codemod_rename: failed to list workspace files.';
        }
        // SCOPED read (default, T3): read code files but KEEP only those referencing the symbol as a
        // whole token, so a repo-wide rename is COMPLETE on 200/1000/5000-file apps — not silently capped
        // at 50 (which left files 51…N with the OLD name → a broken build reported as success). Kill
        // switch AGENTV3_CODEMOD_SCOPED=off restores the exact legacy 50-file behaviour.
        const CODE = /\.(t|j)sx?$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const codeFilesAll = files.filter((f) => CODE.test(f) && !SKIP.test(f));
        const fileContents: CodemodeFile[] = [];
        let renameSkipped = 0;
        if (envKillSwitch('AGENTV3_CODEMOD_SCOPED')) {
          for (const f of codeFilesAll.slice(0, 50)) {
            try { fileContents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); } catch { /* skip */ }
          }
        } else {
          for (const f of codeFilesAll.slice(0, 6000)) { // hard I/O bound; the AST cost stays on the shortlist
            try {
              const content = await this.actuator.readFile(this.workspaceId, f);
              if (!containsSymbol(content, oldName)) continue;
              if (fileContents.length >= 2000) { renameSkipped++; continue; } // safety cap → honest report, never a silent drop
              fileContents.push({ path: f, content });
            } catch { /* skip unreadable file */ }
          }
        }
        const result = await renameSymbol(fileContents, oldName, newName);
        if (!result.ok) return `codemod_rename failed: ${result.error}`;
        // Write back changed files.
        for (const { path, after } of result.changes) {
          try {
            await this.actuator.writeFile(this.workspaceId, path, after);
            getWorkspaceMemory(this.workspaceId).indexFile(path, after);
          } catch { /* best-effort */ }
        }
        this.scheduleCheckpoint(`codemod rename ${oldName} → ${newName}`);
        const renameBase = result.summary || `Renamed "${oldName}" → "${newName}" in ${result.changes.length} file(s).`;
        const renameNote = codemodTruncationNote('codemod_rename', renameSkipped);
        return renameNote ? `${renameBase}\n${renameNote}` : renameBase;
      }

      case 'codemod_add_prop': {
        const componentName = reqStr(input, 'component_name');
        const propName = reqStr(input, 'prop_name');
        const propType = reqStr(input, 'prop_type');
        const defaultValue = optStr(input, 'default_value');
        let files: string[];
        try {
          files = await this.actuator.listFiles(this.workspaceId);
        } catch {
          return 'codemod_add_prop: failed to list workspace files.';
        }
        // SCOPED read (default, T3): only files referencing the component as a whole token — so adding a
        // prop reaches every definition + call site across a large repo, not a blind first-50. Kill switch
        // AGENTV3_CODEMOD_SCOPED=off restores the exact legacy 50-file behaviour.
        const CODE = /\.(t|j)sx?$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const codeFilesAll = files.filter((f) => CODE.test(f) && !SKIP.test(f));
        const fileContents: CodemodeFile[] = [];
        let addPropSkipped = 0;
        if (envKillSwitch('AGENTV3_CODEMOD_SCOPED')) {
          for (const f of codeFilesAll.slice(0, 50)) {
            try { fileContents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); } catch { /* skip */ }
          }
        } else {
          for (const f of codeFilesAll.slice(0, 6000)) {
            try {
              const content = await this.actuator.readFile(this.workspaceId, f);
              if (!containsSymbol(content, componentName)) continue;
              if (fileContents.length >= 2000) { addPropSkipped++; continue; }
              fileContents.push({ path: f, content });
            } catch { /* skip unreadable file */ }
          }
        }
        const result = await addComponentProp(fileContents, componentName, propName, propType, defaultValue);
        if (!result.ok) return `codemod_add_prop failed: ${result.error}`;
        for (const { path, after } of result.changes) {
          try {
            await this.actuator.writeFile(this.workspaceId, path, after);
            getWorkspaceMemory(this.workspaceId).indexFile(path, after);
          } catch { /* best-effort */ }
        }
        this.scheduleCheckpoint(`codemod add prop ${propName} to ${componentName}`);
        const addPropBase = result.summary || `Added prop "${propName}" to ${componentName} in ${result.changes.length} file(s).`;
        const addPropNote = codemodTruncationNote('codemod_add_prop', addPropSkipped);
        return addPropNote ? `${addPropBase}\n${addPropNote}` : addPropBase;
      }

      case 'codemod_move_file': {
        // C7 — move/rename a file and rewrite EVERY importer's specifier in one surgical step, instead
        // of hand-editing each caller. Uses the A1 code graph to read only the affected files (the
        // moved file, its importers, and its own import targets), then applies the pure computeMove plan.
        // Paths are workspace-relative; the actuator sanitizes on write, computeMove refuses any
        // `from` that isn't a real indexed file (so the rm below only ever targets a legit file),
        // and the rm itself is additionally guarded against shell metacharacters + traversal.
        const from = reqStr(input, 'from').trim().replace(/^\.?\//, '');
        const to = reqStr(input, 'to').trim().replace(/^\.?\//, '');
        if (!from || !to) return 'codemod_move_file: both "from" and "to" workspace paths are required.';
        // C2 — BOTH ends. Moving a protected file OUT is as destructive as editing it, and moving one
        // INTO a protected folder plants a file the owner said to leave alone.
        this.assertWritable(from);
        this.assertWritable(to);
        const graph = getWorkspaceMemory(this.workspaceId).graph();
        // Affected set: the moved file + who imports it + what it imports (all from the indexed graph).
        const needed = new Set<string>([from, ...whoImports(graph, from), ...dependenciesOf(graph, from)]);
        // Fallback: if the graph didn't know this file yet, scan the workspace so importers aren't missed.
        if (needed.size <= 1) {
          try {
            const CODE = /\.(t|j)sx?$/;
            const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
            for (const f of await this.actuator.listFiles(this.workspaceId)) {
              if (CODE.test(f) && !SKIP.test(f)) needed.add(f);
            }
          } catch { /* fall through with what we have */ }
        }
        const contents: MoveFile[] = [];
        for (const f of needed) {
          try { contents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) }); }
          catch { /* skip unreadable/nonexistent */ }
        }
        const result = computeMove(contents, from, to);
        if (!result.ok) return `codemod_move_file failed: ${result.error}`;
        for (const { path, after } of result.changes) {
          try {
            await this.actuator.writeFile(this.workspaceId, path, after);
            getWorkspaceMemory(this.workspaceId).indexFile(path, after);
          } catch { /* best-effort per file */ }
        }
        this.state?.recordFileChange({ path: to, kind: 'create' }, agent);
        // Complete the move: remove the old path. Guard against shell metacharacters; report honestly on failure.
        let removed = false;
        if (/^[A-Za-z0-9._/-]+$/.test(from) && !from.split('/').includes('..')) {
          const rm = await this.actuator
            .runCommand(this.workspaceId, `rm -f '${from}'`)
            .catch(() => ({ exitCode: -1, stdout: '', stderr: '' }));
          removed = rm.exitCode === 0;
          if (removed) this.state?.recordFileChange({ path: from, kind: 'delete' }, agent);
        }
        this.scheduleCheckpoint(`codemod move ${from} → ${to}`);
        return result.summary + (removed ? '' : `\nNOTE: could not delete the old file ${from} — remove it manually (its importers already point to ${to}).`);
      }

      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  }
}

/**
 * Topological sort for write_files_batch: ensures dependency files are written
 * before files that import them. Handles cycles safely (cycle → original order for
 * affected nodes). Pure, no I/O.
 */
function topoSortBatch(
  files: { path: string; content: string }[],
): { path: string; content: string }[] {
  if (files.length <= 1) return files;
  const pathSet = new Set(files.map(f => f.path));
  const fileMap = new Map(files.map(f => [f.path, f]));

  // For each file, find which other batch files it imports (relative imports only).
  const getDeps = (file: { path: string; content: string }): string[] => {
    const deps: string[] = [];
    const importRe = /from\s+['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(file.content)) !== null) {
      const spec = m[1].replace(/^\.\.?\//, ''); // strip leading ./ or ../
      for (const p of pathSet) {
        if (p === file.path) continue;
        const base = p.replace(/\.(ts|tsx|js|jsx)$/, '');
        const tail = base.split('/').slice(-1)[0] ?? '';
        if (tail === spec || base.endsWith('/' + spec) || base === spec) {
          deps.push(p);
        }
      }
    }
    return deps;
  };

  const sorted: { path: string; content: string }[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (path: string): void => {
    if (visited.has(path)) return;
    if (visiting.has(path)) return; // cycle — skip to avoid infinite loop
    visiting.add(path);
    for (const dep of getDeps(fileMap.get(path)!)) {
      if (pathSet.has(dep)) visit(dep);
    }
    visiting.delete(path);
    visited.add(path);
    sorted.push(fileMap.get(path)!);
  };

  for (const file of files) visit(file.path);
  return sorted;
}

/**
 * Level 6 — Test file hint: if a matching test file name can be inferred from
 * the given path, return a short note suggesting the test command. Pure, no I/O.
 */
function testFileHint(filePath: string): string {
  const CODE = /\.(t|j)sx?$/;
  if (!CODE.test(filePath)) return '';
  const base = filePath.replace(/\.(t|j)sx?$/, '');
  const basename = base.split('/').pop() ?? '';
  // Emit a hint so the agent knows to look for a test file and run it.
  return (
    `\nTEST HINT: if a test file exists (e.g. ${basename}.test.tsx), run it to verify: ` +
    `npm test -- --run ${basename}`
  );
}

function reqStr(input: Record<string, unknown>, key: string): string {
  // MALFORMED-CALL REPAIR (CrewHub autopsy 2026-07-20: 9 wasted turns on `{"file": …}` instead of
  // `{"path": …}`): accept a well-known alias when the canonical key is absent, and when nothing
  // matches, throw an INSTRUCTIVE error that teaches the model the exact retry shape.
  const resolved = resolveStringArg(input, key);
  if (resolved) return resolved.value;
  throw new Error(missingArgMessage(input, key));
}

function reqNum(input: Record<string, unknown>, key: string): number {
  const v = input[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`Missing/invalid number argument: ${key}`);
  return n;
}

function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' ? v : undefined;
}

function parseTodos(input: Record<string, unknown>): TodoItem[] {
  const raw = input.todos;
  if (!Array.isArray(raw)) throw new Error('update_todo: todos must be an array.');
  const valid: TodoStatus[] = ['pending', 'in_progress', 'done', 'blocked'];
  return raw.map((item, i) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : String(i + 1);
    const title = typeof obj.title === 'string' ? obj.title : '';
    if (!title) throw new Error(`update_todo: item ${i} is missing a title.`);
    const status = valid.includes(obj.status as TodoStatus) ? (obj.status as TodoStatus) : 'pending';
    const owner = typeof obj.owner === 'string' ? (obj.owner as AgentRole) : undefined;
    return owner ? { id, title, status, owner } : { id, title, status };
  });
}

function summarize(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_SUMMARY ? oneLine.slice(0, MAX_SUMMARY) + '…' : oneLine;
}

function miniDiff(oldStr: string, newStr: string): string {
  const minus = oldStr.split('\n').map((l) => `- ${l}`).join('\n');
  const plus = newStr.split('\n').map((l) => `+ ${l}`).join('\n');
  return `${minus}\n${plus}`;
}

/**
 * E7 — a BOUNDED whole-file diff for the live `diff` event emitted on write_file / write_files_batch,
 * so a CREATE (or a wholesale rewrite) streams its content to the UI Diff tab as it happens — instead
 * of the Diff tab staying empty through an all-creates fresh build. A create (empty old) shows
 * additions only; a rewrite shows removed then added. Each side is capped at `maxLines` with a
 * "… (N more lines)" note so a large file never produces an unbounded event payload. Pure + tested.
 */
export function boundedWholeFileDiff(oldStr: string, newStr: string, maxLines = 160): string {
  const clip = (text: string, prefix: '+' | '-'): string[] => {
    const arr = text.split('\n');
    if (arr.length <= maxLines) return arr.map((l) => `${prefix} ${l}`);
    const shown = arr.slice(0, maxLines).map((l) => `${prefix} ${l}`);
    shown.push(`… (${arr.length - maxLines} more line${arr.length - maxLines === 1 ? '' : 's'})`);
    return shown;
  };
  const parts: string[] = [];
  if (oldStr.length > 0) parts.push(...clip(oldStr, '-'));
  parts.push(...clip(newStr, '+'));
  return parts.join('\n');
}

/**
 * Build a regex that matches `literal` but treats every run of whitespace as
 * flexible (\s+), so an edit whose indentation/spacing is slightly off still
 * matches. Regex metacharacters are escaped first, so the ONLY special behavior
 * is the whitespace flexibility — there are no nested quantifiers, so it cannot
 * backtrack catastrophically. Returns null for whitespace-only input (a
 * meaningless flexible match).
 */
function flexibleWhitespaceRegex(literal: string): RegExp | null {
  if (!literal.trim()) return null;
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s+');
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}

/**
 * When an edit_file `old_string` doesn't match, show the region of the file the model most likely MEANT
 * to edit — anchored to the closest actual line — instead of always the first 1500 chars.
 *
 * ROOT CAUSE (deep-test build #5, 2026-07-17): on a large, growing file (App.tsx reached 600+ lines while
 * the SVG-charts feature was added) an edit near the END drifts (the model works from a stale view). The
 * old "not found" error showed only the FILE HEAD (imports + interface) — useless for a target near line
 * 600 — so the agent had to spend an extra read_file, then re-drifted, then failed again, burning steps
 * toward the 120-step cap it ultimately hit. Anchoring the preview to the closest real line lets the model
 * copy the correct current text in ONE retry. Pure + deterministic; bounded so a huge file can't blow the
 * message. Copy-safe: NO line-number prefixes inside the fenced block (the range is stated in the header),
 * so the model can copy the shown lines verbatim into a new old_string.
 */
export function nearestEditRegion(existing: string, oldStr: string, windowLines = 24, maxChars = 2400): string {
  const lines = existing.split('\n');
  // Distinctive anchors from the intended edit: longest trimmed lines first — a token-bearing line like
  // `const categoryTotals = expenses.reduce(...)` locates the region far better than a bare `}` / `return (`.
  const anchors = oldStr.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && /[A-Za-z0-9]/.test(l))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
  let hit = -1;
  for (const a of anchors) { const i = lines.findIndex((l) => l.trim() === a); if (i >= 0) { hit = i; break; } }
  if (hit < 0) for (const a of anchors) { const i = lines.findIndex((l) => l.includes(a)); if (i >= 0) { hit = i; break; } }
  if (hit < 0) {
    // No anchor located anywhere — the intended text may be entirely gone/hallucinated. Show the head,
    // honestly labelled as such (not the target), so the model re-reads instead of trusting a wrong region.
    const head = existing.length <= maxChars ? existing : existing.slice(0, maxChars) + '\n…(truncated — call read_file for the region you want)';
    return `Current file content (top of file — your target text was not located anywhere):\n\`\`\`\n${head}\n\`\`\`\n`;
  }
  const from = Math.max(0, hit - windowLines);
  const to = Math.min(lines.length, hit + windowLines + 1);
  let window = lines.slice(from, to).join('\n');
  if (window.length > maxChars) window = window.slice(0, maxChars) + '\n…(truncated — call read_file for more)';
  return `Current file content around your closest match (lines ${from + 1}-${to}, nearest at line ${hit + 1}):\n\`\`\`\n${window}\n\`\`\`\n`;
}

/** Result of applying a single edit_file replacement. */
export interface EditResult {
  /** The full file content after the replacement. */
  updated: string;
  /** The exact text that was replaced (verbatim from the file) — used for the diff. */
  matchedOld: string;
  /** Human-readable note ('' on an exact hit; explains a whitespace-flexible match). */
  note: string;
}

/**
 * Apply one edit_file replacement with a whitespace-tolerant fallback.
 *
 *  0. APPEND: an EMPTY `old_string` is the model's signal to ADD content (not to
 *     search) — append `new_string` to the END of the file.
 *  1. EXACT: if `oldStr` occurs exactly once, replace it. More than once →
 *     ambiguous, throw (the model must add surrounding context).
 *  2. FLEXIBLE: if `oldStr` is not found exactly (0 matches), retry treating any
 *     run of whitespace as flexible. This rescues edits where the model's
 *     indentation or spacing is slightly off. The flexible match must STILL be
 *     unique — 0 or >1 flexible matches throw the same honest errors.
 *
 * Pure and deterministic — unit-testable without a sandbox. The `path` is only
 * used to make error messages specific.
 */
export function applyEdit(existing: string, oldStr: string, newStr: string, path = 'file'): EditResult {
  // APPEND MODE (Connectly Edit #1 autopsy 2026-07-21): the model wanted to ADD styles to Navbar.css and
  // called edit_file with an EMPTY old_string. An empty string "matches" at every character position, so
  // the old code reported `not unique (1377 matches)` and the model then flailed read→append for several
  // turns. An empty old_string has one sensible meaning — append the new content to the end of the file.
  // Deterministic + SAFE: an empty old_string previously only ERRORED, so no working behaviour changes.
  if (oldStr === '') {
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    return { updated: existing + sep + newStr, matchedOld: '', note: 'empty old_string → appended new_string to the end of the file' };
  }
  const exact = existing.split(oldStr).length - 1;
  if (exact === 1) {
    // Slice-concatenate (NOT String.replace) so a `$` in newStr is inserted LITERALLY. JS's
    // String.prototype.replace treats `$&`, `$1`, `` $` ``, `$'`, `$$` in the replacement string as
    // SPECIAL patterns — and those are everywhere in real code (template literals `${x}`, jQuery `$`,
    // regex, Tailwind arbitrary values). Using replace here silently corrupted any edit whose
    // new_string contained a `$` (the "editing gadbad kar deta hai" bug). Mirrors the whitespace-
    // flexible path below, which already concatenates safely.
    const idx = existing.indexOf(oldStr);
    return { updated: existing.slice(0, idx) + newStr + existing.slice(idx + oldStr.length), matchedOld: oldStr, note: '' };
  }
  if (exact > 1) {
    throw new Error(
      `edit_file: old_string is not unique in ${path} (${exact} matches) — include more surrounding context.`,
    );
  }
  // exact === 0 → whitespace-flexible fallback.
  const flexible = flexibleWhitespaceRegex(oldStr);
  const matches = flexible ? [...existing.matchAll(flexible)] : [];
  if (matches.length === 0) {
    // Give the model the current text AROUND ITS INTENDED TARGET (not just the file head) so it can craft
    // the correct old_string in ONE retry without a wasteful read_file round-trip — the step-burn that
    // helped push deep-test build #5 into its 120-step cap. See nearestEditRegion.
    throw new Error(
      `edit_file: old_string not found in ${path}. ` +
        `The string you supplied does not appear verbatim (or close enough) in the current file. ` +
        `${nearestEditRegion(existing, oldStr)}` +
        `Copy the exact lines you want to change from the content above and retry.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `edit_file: old_string is not unique in ${path} (${matches.length} whitespace-flexible matches) — include more surrounding context.`,
    );
  }
  const m = matches[0];
  const start = m.index ?? 0;
  const matchedOld = m[0];
  const updated = existing.slice(0, start) + newStr + existing.slice(start + matchedOld.length);
  return { updated, matchedOld, note: ' (matched ignoring whitespace differences)' };
}


function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}
