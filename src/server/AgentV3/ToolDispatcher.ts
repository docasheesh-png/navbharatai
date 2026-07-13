import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ToolUse } from './ClaudeClient';
import type { AgentRole, ToolName, TodoItem, TodoStatus } from './types';
import type { Checkpointer } from './GitManager';
import { isWorkerRole } from './AgentRegistry';
import { getWorkspaceMemory } from './WorkspaceMemory';
import { detectTestPlan, parseTestOutcome } from './testRunner';
import { whoImports, dependenciesOf, impactOf, definitionsOf, resolveGraphFile } from './codeGraph';
import { detectChecks, parseCheckOutcome } from './crossLangCheck';
import { detectLinters, parseLintOutcome, type LintOutcome } from './lintRunner';
import { lintGateVerdict, type LintGateVerdict } from './LintGate';
import { analyzePackageHealth, packageHealthSummary } from './packageHealth';
import { assessFullRewrite } from './rewriteRisk';
import { analyzeToolchain } from './toolchainPins';
import { planAppDefaults } from './appDefaults';
import { computeMove, type MoveFile } from './codemodMoveFile';
import { buildArchitectureMap, renderArchitectureMap } from './architectureMap';
import { findUnwiredFiles, unwiredFilesSummary } from './deadCode';
import { buildApiGraph } from './apiGraph';
import { mapWithConcurrency, withTimeout } from './asyncUtils';
import { analyzeArchitecture, architectureSummary, generateArchitectureDoc } from './ArchitectureAnalysis';
import { securitySummary } from './SecurityAnalysis';
import { applyPreviewDomain } from './PreviewDomain';
import { parseDevServerHealthLine } from './sandbox/EngineerAI/actuators/DevServerRecovery';
import { scanAuthenticity, authenticitySummary } from './AuthenticityAnalysis';
import type { AuthenticityIssue } from './AuthenticityAnalysis';
import { scanAccessibility, accessibilitySummary } from './AccessibilityAnalysis';
import type { AccessibilityIssue } from './AccessibilityAnalysis';
import {
  scanCompliance, complianceSummary,
  detectsPiiCollection, detectsTracker, detectsConsentUI, looksLikePrivacyPolicy,
} from './ComplianceAnalysis';
import type { ComplianceIssue, ComplianceSeverity } from './ComplianceAnalysis';
import type { DependencyIssue } from './DependencyAnalysis';
import type { EnvVarIssue } from './EnvVarAnalysis';
import { computeBuildConfidence, buildConfidenceSummary, type SeverityTally } from './BuildConfidence';
import { classifyCommandRisk, governanceNote } from './CommandGovernance';
import { scaffoldGuard, scaffoldGuardMessage } from './ScaffoldGuard';
import { previewGuard, previewGuardMessage } from './PreviewGuard';
import { ensureViteAllowedHosts } from './ViteConfigGuard';
import { ViteReactProvider } from './sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { TemplateRegistry } from './sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { analyzeDependencies, dependencySummary } from './DependencyAnalysis';
import { analyzeMaintainability, maintainabilitySummary } from './maintainabilityAnalysis';
import { analyzeLockfiles, lockfileSummary, detectPackageManager, packageManagerSummary } from './lockfileAnalysis';
import { planDependencyAutoFix, dependencyAutoFixSummary } from './DependencyAutoFix';
import { analyzePwa, pwaSummary } from './PwaAnalysis';
import { extractEnvRefs, parseEnvKeys, analyzeEnvVars, envVarSummary } from './EnvVarAnalysis';
import { resolveLocalImport } from './ArchitectureAnalysis';
import { assessReadiness, readinessVerdict, type ExtraFinding, type ReadinessReport } from './Readiness';
import { analyzeHooksRules } from './HooksRulesAnalysis';
import { analyzeImportExports } from './ImportExportAnalysis';
import { reconcileImportExports, addMissingProjectImports } from './ImportExportReconcile';
import { analyzeJsxComponents } from './JsxComponentAnalysis';
import { analyzeUndefinedHooks } from './UndefinedHookAnalysis';
import { analyzeDependencyConstraints } from '../AI/reasoning/ConstraintSolver';
import { analyzeTestCoverage, testCoverageSummary } from './TestCoverageAnalysis';
import { analyzeRequirementCoverage, requirementCoverageSummary } from './RequirementCoverage';
import { generateReadme } from './ReadmeGenerator';
import { generateEnvExample } from './EnvExampleGenerator';
import { generateGitignore } from './GitignoreGenerator';
import { generateOpenApi, type RouteSpec } from '../lib/OpenApiGenerator';
import { generateApiDocs, type RouteDoc } from '../lib/DocGenerator';
import { generateUnitTest, type FunctionDef } from '../lib/TestSkeletonGenerator';
import { generateObservability, type ObservabilityTarget } from '../AppMakerLab/generator/ObservabilityGenerator';
import { generateBundleOptimization } from '../AppMakerLab/generator/BundleOptimizationGenerator';
import { generateSeedData, type EntitySpec } from '../AppMakerLab/generator/MockDataGenerator';
import { generateAuthCode, type AuthType } from '../AppMakerLab/generator/AuthCodeGenerator';
import { generateMigration, type MigrationEntity, type MigrationDialect, type SqlProvider } from '../AppMakerLab/generator/MigrationGenerator';
import { generateDeployArtifacts, type DeployArtifactInput, type PackageManager } from '../lib/DeployArtifactGenerator';
import { replaceSymbol } from '../AppMakerLab/generator/ASTPatching';
import { analyzeConventions, type IdentifierKind } from '../lib/ConventionEngine';
import { generateReleaseNote } from '../lib/ReleaseNotesGenerator';
import { analyzeRunnability, runnabilitySummary } from './RunnabilityAnalysis';
import { analyzeSeo, seoSummary } from './SeoAnalysis';
import { lintDesign, designSummary } from '../AppMakerLab/intelligence/DesignLinter';
import { summarizeBundle, bundleSummaryLine } from './BundleSize';
import { livenessLine } from './PostDeployLiveness';
import { analyzeProjectHygiene, projectHygieneSummary } from './ProjectHygieneAnalysis';
import { hasErrorBoundarySignal, analyzeErrorBoundary, errorBoundarySummary } from './ErrorBoundaryAnalysis';
import { scanSecurityConfig, securityConfigSummary, type SecConfigIssue } from './SecurityConfigAnalysis';
import { analyzeSecretLeak, secretLeakSummary } from './SecretLeakAnalysis';
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
import { getEmbeddingStore } from './EmbeddingSearch';
import { redactSecrets, redactDeep } from './SecretRedactor';

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
  /** Runtime browser errors (console.error / uncaught / failed requests) since `sinceMs`. */
  getConsoleErrors?(
    workspaceId: string,
    sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[] }>;
  /** The built static site (dist/) as path→bytes, for a real persistent deploy. */
  downloadDistFiles?(workspaceId: string): Promise<Map<string, Buffer>>;
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
    const permissive: ReadinessReport = { score: 100, ready: true, blockers: [], warnings: [] };
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
   * Called when the scaffold guard blocks a create-* command — best-effort, never throws.
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
        await this.actuator.writeFile(this.workspaceId, path, content).catch(() => {});
      }
    } catch {
      /* self-heal is best-effort; the redirect message still guides the agent */
    }
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
   * Best-effort security-configuration scan over the project's source files
   * (insecure TLS verification, wildcard CORS). Bounded and wrapped so any
   * listing/read failure degrades to no issues — never breaks evaluate.
   */
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
      const visual = call.name === 'screenshot' || call.name === 'browser_action'
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
    if (call.name === 'screenshot') {
      if (!this.actuator.screenshot) {
        return { content: 'Screenshots require a real cloud sandbox (set E2B_API_KEY) — not available here.' };
      }
      const url = reqStr(input, 'url');
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

  private async run(call: ToolUse, agent: AgentRole): Promise<string> {
    const input = call.input;
    switch (call.name) {
      case 'read_file': {
        const full = await this.actuator.readFile(this.workspaceId, reqStr(input, 'path'));
        // RANGED READ (Fix 36b — HMS report 2026-07-07): a big file's tool result gets its middle
        // trimmed by the transcript ceiling, and a plain re-read returns the SAME trimmed view — the
        // model concluded the FILE was "truncated at exactly N lines" and destructively 'repaired' a
        // healthy file. start_line/end_line make any slice of a large file genuinely readable.
        const sl = typeof (input as Record<string, unknown>).start_line === 'number' ? Math.max(1, Math.floor((input as Record<string, unknown>).start_line as number)) : null;
        const el = typeof (input as Record<string, unknown>).end_line === 'number' ? Math.max(1, Math.floor((input as Record<string, unknown>).end_line as number)) : null;
        if (sl === null && el === null) return full;
        const lines = full.split('\n');
        const from = (sl ?? 1) - 1;
        const to = el ?? lines.length;
        const slice = lines.slice(from, to).join('\n');
        return `[lines ${from + 1}-${Math.min(to, lines.length)} of ${lines.length} — the file is complete on disk]\n${slice}`;
      }

      case 'write_file': {
        const path = reqStr(input, 'path');
        // Deterministic backstop: a Vite config must always allow the E2B preview host, or the
        // preview shows "Blocked request … is not allowed" instead of the app. No-op for non-configs
        // or a config that already sets allowedHosts. (Mirrors ScaffoldGuard: prompts are advisory.)
        const content = ensureViteAllowedHosts(path, reqStr(input, 'content'));
        let kind: 'create' | 'modify' = 'create';
        let existingContent = '';
        try {
          existingContent = await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
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
            reviewNote + cascadeNote + testHint
          );
        }
        return `Created ${path} (${content.length} bytes).` + reviewNote + cascadeNote + testHint;
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
          // Same Vite-preview-host backstop as write_file, applied per batched file.
          return { path: p, content: ensureViteAllowedHosts(p, reqStr(obj, 'content')) };
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
        // Write every file in bounded parallel (mirrors fastWrite's mapWithConcurrency(files, 6, …)).
        // A serial loop cost 2 remote round-trips PER file (create-vs-modify probe + write) — ~6-12s
        // for a 20-file batch, the single biggest "why is it so slow" in a large build. Distinct paths
        // are order-independent (final sandbox state is identical regardless of write order) and each
        // file's create-vs-modify verdict depends only on whether it pre-existed the batch, not on its
        // siblings — so bounded concurrency is safe. mapWithConcurrency is order-preserving, so the
        // summary arrays below stay in topo order. JS is single-threaded, so the in-worker hooks never
        // interleave mid-statement.
        const perFile = await mapWithConcurrency(sorted, 6, async (file) => {
          // Detect create-vs-modify like write_file does, so the recorded change + the UI diff are
          // honest and an accidental wholesale overwrite of an existing file is not silently a "create".
          let kind: 'create' | 'modify' = 'create';
          let priorContent = '';
          try { priorContent = await this.actuator.readFile(this.workspaceId, file.path); kind = 'modify'; } catch { kind = 'create'; }
          // Forensic edit-discipline (parity with write_file): a batched wholesale rewrite that is
          // materially smaller than the file it replaced likely DROPPED code — flag it honestly below.
          const shrink = kind === 'modify' && assessFullRewrite(priorContent, file.content).level === 'shrink';
          await this.actuator.writeFile(this.workspaceId, file.path, file.content);
          // Consistency with write_file: run the per-write hook (security scan / durable tracking) —
          // batch-written files were previously skipping it entirely. Best-effort + '?.'-guarded.
          this.onFileWrite?.(file.path, file.content);
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
        const written: string[] = perFile.map((r) => r.path);
        const overwritten: string[] = perFile.filter((r) => r.kind === 'modify').map((r) => r.path); // existing files this batch REPLACED wholesale
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
        return `Wrote ${written.length} file(s) in dependency order: ${written.join(', ')}.${overwriteWarning}${contentLossWarning}`;
      }

      case 'edit_file': {
        const path = reqStr(input, 'path');
        const oldStr = reqStr(input, 'old_string');
        const newStr = reqStr(input, 'new_string');
        const existing = await this.actuator.readFile(this.workspaceId, path);
        // Exact match first, with a whitespace-tolerant fallback so a patch whose
        // indentation/spacing is slightly off still applies (still required to be
        // unique). applyEdit throws the same honest "not found" / "not unique" errors.
        const { updated: edited, matchedOld, note } = applyEdit(existing, oldStr, newStr, path);
        // If an edit to a Vite config left it without allowedHosts, restore the preview-host backstop.
        const updated = ensureViteAllowedHosts(path, edited);
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
        return `Edited ${path}.${note}` + editReviewNote + editCascadeNote + editTestHint;
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
        const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, command);
        // #3 — hand the raw result to the diagnosis bundle (best-effort; never breaks the build).
        try {
          this.onCommand?.({ command, exitCode, stdout, stderr, durationMs: Date.now() - cmdStartedAt });
        } catch { /* diagnostics capture is best-effort */ }
        // T1-sec-redact: a command can print a secret (`cat .env`, `printenv`, `echo $API_KEY`).
        // Command stdout/stderr is NEVER an edit_file match source, so — unlike read_file content —
        // it is safe to mask here, closing the leak into BOTH the model transcript and the terminal.
        let out =
          `exit=${exitCode}\n${redactSecrets(stdout)}` + (stderr ? `\n[stderr]\n${redactSecrets(stderr)}` : '');
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
        const requestText = mem
          .snapshot()
          .episodes.filter((e) => e.kind === 'request')
          .map((e) => e.text)
          .join('\n');
        const reqCoverage = analyzeRequirementCoverage(requestText, mem.graph());
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
        );
        // Best-effort security-config pass (Section I #4): insecure TLS/CORS config.
        const securityConfig = this.collectSecurityConfigIssues(snap.sources);
        // Best-effort secret-leak pass (Section I #4): a real .env not gitignored.
        const secretLeak = analyzeSecretLeak(hygieneFiles, gitignoreContent);
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
        if (portBindings.length) extra.push({ severity: 'medium', label: `${portBindings.length} hardcoded server port(s) (use process.env.PORT)` });
        if (viteEnv.length) extra.push({ severity: 'medium', label: `${viteEnv.length} non-VITE_ import.meta.env reference(s) (undefined in the browser)` });
        if (asyncPatterns.length) extra.push({ severity: 'medium', label: `${asyncPatterns.length} forEach(async …) loop(s) that do not await` });
        for (const f of reqCoverage.findings) extra.push({ severity: 'medium', label: `Requested feature not found: ${f.feature}` });
        if (errorBoundary.findings.length) extra.push({ severity: 'medium', label: 'React app has no error boundary' });
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
                astFiles[fx.file] = content;
                try { await this.actuator.writeFile(this.workspaceId, fx.file, content); } catch { /* best-effort */ }
                try { this.onFileWrite?.(fx.file, content); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(fx.file, content); } catch { /* best-effort */ }
              }
              this.events?.emit({ type: 'narration', agent: 'architect', text: `🔧 Auto-fixed ${rec.fixes.length} import(s) (named↔default mismatch) so the build isn't blocked by a wrong import kind.`, ts: Date.now() });
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
                astFiles[file] = content;
                try { await this.actuator.writeFile(this.workspaceId, file, content); } catch { /* best-effort */ }
                try { this.onFileWrite?.(file, content); } catch { /* best-effort */ }
                try { getWorkspaceMemory(this.workspaceId).indexFile(file, content); } catch { /* best-effort */ }
              }
              this.events?.emit({ type: 'narration', agent: 'architect', text: `🔧 Added ${addRes.added.length} missing import(s) (a shared symbol was used but not imported) so the app doesn't crash at runtime.`, ts: Date.now() });
            }
          } catch { /* best-effort — a failure just leaves the honest finding below */ }
        }
        const [hooksRep, importRep, jsxRep, undefHookRep] = await Promise.all([
          analyzeHooksRules(astFiles),
          analyzeImportExports(astFiles),
          analyzeJsxComponents(astFiles),
          analyzeUndefinedHooks(astFiles),
        ]);
        if (hooksRep.violations.length) {
          const sample = hooksRep.violations.slice(0, 3).map((v) => `${v.hook}@${v.file}:${v.line}`).join(', ');
          extra.push({ severity: 'high', label: `${hooksRep.violations.length} React Rules-of-Hooks violation(s) (crash at runtime): ${sample}${hooksRep.violations.length > 3 ? ', …' : ''}` });
        }
        if (importRep.mismatches.length) {
          const sample = importRep.mismatches.slice(0, 3).map((m) => `${m.imported}←${m.from}@${m.file}:${m.line}`).join(', ');
          extra.push({ severity: 'high', label: `${importRep.mismatches.length} broken import(s) — a name is imported that the module does not export (the build fails): ${sample}${importRep.mismatches.length > 3 ? ', …' : ''}` });
        }
        if (jsxRep.undefinedComponents.length) {
          const sample = jsxRep.undefinedComponents.slice(0, 3).map((c) => `<${c.component}>@${c.file}:${c.line}`).join(', ');
          extra.push({ severity: 'high', label: `${jsxRep.undefinedComponents.length} undefined JSX component(s) — used but never imported/defined (crash at runtime): ${sample}${jsxRep.undefinedComponents.length > 3 ? ', …' : ''}` });
        }
        if (undefHookRep.undefinedHooks.length) {
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
        return `${verdict}\n\n${buildConfidenceSummary(confidence)}\n\n${architectureSummary(archReport)}\n\n${securitySummary(findings)}\n\n${authenticitySummary(issues)}\n\n${dependencySummary(depIssues)}\n\n${envVarSummary(envIssues)}\n\n${accessibilitySummary(a11yIssues)}\n\n${complianceSummary(complianceIssues)}\n\n${testCoverageSummary(testCoverage)}\n\n${requirementCoverageSummary(reqCoverage)}\n\n${runnabilitySummary(runnability)}\n\n${seoSummary(seo)}\n\n${projectHygieneSummary(hygiene)}\n\n${errorBoundarySummary(errorBoundary)}\n\n${securityConfigSummary(securityConfig)}\n\n${secretLeakSummary(secretLeak)}\n\n${hardcodedUrlSummary(hardcodedUrls)}\n\n${portBindingSummary(portBindings)}\n\n${viteEnvSummary(viteEnv)}\n\n${envTemplateSecretSummary(envTemplateSecrets)}\n\n${asyncPatternSummary(asyncPatterns)}\n\n${designSummary(design)}\n\n${maintainabilitySummary(analyzeMaintainability(snap.sources))}\n\n${lockfileSummary(analyzeLockfiles(snap.files))}${(() => { const pm = packageManagerSummary(detectPackageManager(snap.files)); return pm ? `\n\n${pm}` : ''; })()}${depAutoFix ? `\n\n${depAutoFix}` : ''}${pwaLine ? `\n\n${pwaLine}` : ''}`;
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
        const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, plan.command);
        try { this.onCommand?.({ command: plan.command, exitCode, stdout, stderr, durationMs: Date.now() - started }); } catch { /* diagnostics best-effort */ }
        const outcome = parseTestOutcome(plan, exitCode, stdout, stderr);
        const mem = getWorkspaceMemory(this.workspaceId);
        if (outcome.ok) {
          mem.recordAudit(`run_tests PASS — ${outcome.summary} (${plan.command})`);
        } else {
          mem.recordError(
            `run_tests FAIL — ${outcome.summary}` +
            (outcome.failingTests.length ? ` — failing: ${outcome.failingTests.slice(0, 10).join(', ')}` : ''),
          );
        }
        const detail =
          `${outcome.summary}\n` +
          `command: ${plan.command} — ${plan.reason}\n` +
          (outcome.failingTests.length ? `failing:\n  ${outcome.failingTests.slice(0, 20).join('\n  ')}\n` : '') +
          `\n[stdout tail]\n${stdout.slice(-1500)}` +
          (stderr ? `\n[stderr tail]\n${stderr.slice(-800)}` : '');
        this.state?.appendTerminal(detail);
        return detail;
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

      case 'typecheck': {
        // B6 — cross-language compile/typecheck (TS + Python + Java + Go), not just frontend tsc.
        // "Verified" must mean every language in the workspace compiles. Detection/parsing are pure
        // (crossLangCheck.ts); this runs each detected check in the sandbox and aggregates honestly.
        const files = await this.actuator.listFiles(this.workspaceId).catch(() => [] as string[]);
        let pkgRaw: string | undefined;
        try { pkgRaw = await this.actuator.readFile(this.workspaceId, 'package.json'); } catch { pkgRaw = undefined; }
        const plans = detectChecks(files, pkgRaw);
        if (!plans.length) {
          const msg = 'typecheck: no compilable sources detected (no tsconfig+TS, Python, Maven/Gradle JVM, or Go). Nothing to type-check.';
          this.state?.appendTerminal(msg);
          return msg;
        }
        const mem = getWorkspaceMemory(this.workspaceId);
        const parts: string[] = [];
        let allOk = true;
        for (const plan of plans) {
          const started = Date.now();
          const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, plan.command);
          try { this.onCommand?.({ command: plan.command, exitCode, stdout, stderr, durationMs: Date.now() - started }); } catch { /* diagnostics best-effort */ }
          const outcome = parseCheckOutcome(plan, exitCode, stdout, stderr);
          if (!outcome.ok) allOk = false;
          if (outcome.ok) mem.recordAudit(`typecheck PASS — ${outcome.summary} (${plan.command})`);
          else mem.recordError(`typecheck FAIL — ${outcome.summary}${outcome.firstErrors.length ? '\n' + outcome.firstErrors.join('\n') : ''}`);
          parts.push(
            `${outcome.summary} — ${plan.command}` +
            (outcome.firstErrors.length ? `\n  ${outcome.firstErrors.join('\n  ')}` : ''),
          );
        }
        const detail = `${allOk ? 'ALL LANGUAGES OK' : 'TYPECHECK FAILED'} (${plans.length} language${plans.length === 1 ? '' : 's'})\n` + parts.join('\n');
        this.state?.appendTerminal(detail);
        return detail;
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
        const type: AuthType = rawType === 'firebase' ? 'firebase' : 'jwt';
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
        if (include.has('compose')) genInput.compose = { port };
        if (include.has('ci')) genInput.ci = { nodeVersion, installCmd, lintCmd, testCmd, buildCmd, packageManager };
        const artifacts = generateDeployArtifacts(genInput);
        const toWrite: Array<{ path: string; content: string }> = [];
        if (artifacts.dockerfile) toWrite.push({ path: 'Dockerfile', content: artifacts.dockerfile });
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
        // §12: v3.0-built apps are previewed under the platform's E2B custom domain
        // (mitrify.xyz) instead of the raw *.e2b.app host. Idempotent + scoped to v3.0.
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

      case 'deploy': {
        if (!this.deploy) {
          return 'Deployment is not configured in this context.';
        }
        if (!this.actuator.downloadDistFiles) {
          return 'Deployment requires a real cloud sandbox (set E2B_API_KEY) — not available here.';
        }
        let files: Map<string, Buffer>;
        try {
          files = await this.actuator.downloadDistFiles(this.workspaceId);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          return `Could not read the built site: ${m}. Run "npm run build" first so a dist/ directory exists.`;
        }
        if (files.size === 0) {
          return 'No built files found. Run "npm run build" to produce dist/ before deploying.';
        }
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
        return `Deployed to a permanent public URL: ${url} (${files.size} files).${bundleLine ? ` ${bundleLine}` : ''}${liveLine} This stays live after the sandbox stops.`;
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
        // Read all TS/TSX source files (capped at 50 for performance).
        const CODE = /\.(t|j)sx?$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const codeFiles = files.filter((f) => CODE.test(f) && !SKIP.test(f)).slice(0, 50);
        const fileContents: CodemodeFile[] = [];
        for (const f of codeFiles) {
          try {
            fileContents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) });
          } catch { /* skip unreadable file */ }
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
        return result.summary || `Renamed "${oldName}" → "${newName}" in ${result.changes.length} file(s).`;
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
        const CODE = /\.(t|j)sx?$/;
        const SKIP = /(node_modules|dist|build|coverage|\.next|\.git)/;
        const tsxFiles = files.filter((f) => CODE.test(f) && !SKIP.test(f)).slice(0, 50);
        const fileContents: CodemodeFile[] = [];
        for (const f of tsxFiles) {
          try {
            fileContents.push({ path: f, content: await this.actuator.readFile(this.workspaceId, f) });
          } catch { /* skip */ }
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
        return result.summary || `Added prop "${propName}" to ${componentName} in ${result.changes.length} file(s).`;
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
  const v = input[key];
  if (typeof v !== 'string') throw new Error(`Missing/invalid string argument: ${key}`);
  return v;
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
    // Give the model the current file so it can craft the correct old_string without
    // an extra read_file round-trip, which wastes a step.
    const contentPreview =
      existing.length <= 1500
        ? existing
        : existing.slice(0, 1500) + '\n…(truncated — call read_file for full content)';
    throw new Error(
      `edit_file: old_string not found in ${path}. ` +
        `The string you supplied does not appear verbatim (or close enough) in the current file. ` +
        `Current file content:\n\`\`\`\n${contentPreview}\n\`\`\`\n` +
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

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
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
