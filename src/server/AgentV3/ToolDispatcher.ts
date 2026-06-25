import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ToolUse } from './ClaudeClient';
import type { AgentRole, ToolName, TodoItem, TodoStatus } from './types';
import type { Checkpointer } from './GitManager';
import { isWorkerRole } from './AgentRegistry';
import { getWorkspaceMemory } from './WorkspaceMemory';
import { analyzeArchitecture, architectureSummary } from './ArchitectureAnalysis';
import { securitySummary } from './SecurityAnalysis';
import { applyPreviewDomain } from './PreviewDomain';
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
import { ViteReactProvider } from '../AppMakerLab/generator/templates/ViteReactProvider';
import { analyzeDependencies, dependencySummary } from './DependencyAnalysis';
import { extractEnvRefs, parseEnvKeys, analyzeEnvVars, envVarSummary } from './EnvVarAnalysis';
import { resolveLocalImport } from './ArchitectureAnalysis';
import { assessReadiness, readinessVerdict, type ExtraFinding } from './Readiness';
import { analyzeTestCoverage, testCoverageSummary } from './TestCoverageAnalysis';
import { analyzeRequirementCoverage, requirementCoverageSummary } from './RequirementCoverage';
import { generateReadme } from './ReadmeGenerator';
import { generateEnvExample } from './EnvExampleGenerator';
import { generateGitignore } from './GitignoreGenerator';
import { analyzeRunnability, runnabilitySummary } from './RunnabilityAnalysis';
import { analyzeSeo, seoSummary } from './SeoAnalysis';
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
import { reviewEdit, formatReviewResult } from './PostEditReviewer';
import { renameSymbol, addComponentProp } from './CodemodeExecutor';
import type { CodemodeFile } from './CodemodeExecutor';
import { getEmbeddingStore } from './EmbeddingSearch';

/**
 * Spawns a specialist sub-agent for the `task` tool and returns its result.
 * Injected (not imported) so ToolDispatcher stays decoupled from AgentRunner —
 * the composition root wires the real implementation (see SubAgent.ts).
 */
export type SubAgentSpawn = (role: AgentRole, instruction: string) => Promise<{ ok: boolean; summary: string }>;

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
  ) {}

  /**
   * Self-heal the workspace scaffold. The actuator normally seeds a Vite+React+TS
   * starter at the root when the workspace is created; this is the safety net for
   * the case where the root has no package.json (unknown project type, or a seed
   * that silently failed). Called when the scaffold guard blocks a create-* command
   * so the redirect it returns is always actionable. Best-effort — never throws.
   */
  private async ensureViteScaffold(): Promise<void> {
    try {
      await this.actuator.readFile(this.workspaceId, 'package.json');
      return; // root already scaffolded — nothing to do
    } catch {
      /* missing — write the starter below */
    }
    try {
      const files = new ViteReactProvider().getFiles([]);
      for (const [path, content] of Object.entries(files)) {
        await this.actuator.writeFile(this.workspaceId, path, content).catch(() => {});
      }
    } catch {
      /* self-heal is best-effort; the redirect message still guides the agent */
    }
  }

  /** Create a real git checkpoint after a change (best-effort; emits on success). */
  private async maybeCheckpoint(message: string): Promise<void> {
    if (!this.checkpointer) return;
    try {
      const cp = await this.checkpointer.checkpoint(message);
      if (cp) this.state?.addCheckpoint(cp);
    } catch {
      /* checkpointing never blocks a build */
    }
  }

  /**
   * Read the project's source files ONCE for the evaluate pass: a single listFiles
   * plus a single read per source file. Previously each evaluate dimension listed +
   * re-read the tree itself (~7 listings, each file read ~5×); sharing this snapshot
   * cuts that to one pass — much less sandbox I/O (faster + cheaper evaluate). Returns
   * the full file list too (for the name-only dimensions: hygiene, secret-leak).
   */
  private async readEvalSnapshot(): Promise<{ files: string[]; sources: EvalSourceFile[] }> {
    const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|py|rb|java|php|go)$/i;
    const SKIP_DIR = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)/i;
    let files: string[] = [];
    const sources: EvalSourceFile[] = [];
    try {
      files = await this.actuator.listFiles(this.workspaceId);
      const candidates = files.filter((p) => SOURCE.test(p) && !SKIP_DIR.test(p)).slice(0, 300);
      for (const p of candidates) {
        try {
          const content = await this.actuator.readFile(this.workspaceId, p);
          if (content.length > 200_000) continue;
          sources.push({ path: p, content });
        } catch {
          /* skip a single unreadable file — never break evaluate */
        }
      }
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
    // Project-level rule: collecting personal data with no privacy policy is a
    // hard DPDP/GDPR blocker for a public launch.
    if (collectsPii && !hasPrivacyPolicy) {
      issues.push({ file: '(project)', line: 0, kind: 'missing-privacy-policy', severity: 'high',
        snippet: 'App collects personal data (forms/inputs) but ships no privacy policy.' });
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
    this.events?.emit({
      type: 'tool_call',
      agent,
      tool: call.name as ToolName,
      input: call.input,
      callId: call.id,
      ts: Date.now(),
    });
    try {
      const content = await this.run(call, agent);
      this.events?.emit({
        type: 'tool_result',
        agent,
        callId: call.id,
        ok: true,
        summary: summarize(content),
        ts: Date.now(),
      });
      return { tool_use_id: call.id, content, is_error: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events?.emit({
        type: 'tool_result',
        agent,
        callId: call.id,
        ok: false,
        summary: message,
        ts: Date.now(),
      });
      return { tool_use_id: call.id, content: `Error: ${message}`, is_error: true };
    }
  }

  private async run(call: ToolUse, agent: AgentRole): Promise<string> {
    const input = call.input;
    switch (call.name) {
      case 'read_file':
        return this.actuator.readFile(this.workspaceId, reqStr(input, 'path'));

      case 'write_file': {
        const path = reqStr(input, 'path');
        const content = reqStr(input, 'content');
        let kind: 'create' | 'modify' = 'create';
        try {
          await this.actuator.readFile(this.workspaceId, path);
          kind = 'modify';
        } catch {
          kind = 'create';
        }
        await this.actuator.writeFile(this.workspaceId, path, content);
        this.state?.recordFileChange({ path, kind }, agent);
        const mem = getWorkspaceMemory(this.workspaceId);
        mem.indexFile(path, content);
        // Level 3: update embedding index for semantic search (best-effort, async, non-blocking).
        getEmbeddingStore(this.workspaceId).addFile(path, content).catch(() => {});
        await this.maybeCheckpoint(`${kind} ${path}`);
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
          // write_file replaced an EXISTING file wholesale. For a small change this
          // is wasteful and risks dropping unrelated code — nudge the agent toward
          // edit_file (surgical patch) so it makes minimum, targeted changes.
          return (
            `Updated ${path} (${content.length} bytes).\n` +
            `NOTE: ${path} already existed and write_file replaced the ENTIRE file. ` +
            `For a small, targeted change, prefer edit_file (old_string → new_string) ` +
            `so you don't risk dropping unrelated code.` +
            reviewNote + cascadeNote + testHint
          );
        }
        return `Created ${path} (${content.length} bytes).` + reviewNote + cascadeNote + testHint;
      }

      case 'edit_file': {
        const path = reqStr(input, 'path');
        const oldStr = reqStr(input, 'old_string');
        const newStr = reqStr(input, 'new_string');
        const existing = await this.actuator.readFile(this.workspaceId, path);
        // Exact match first, with a whitespace-tolerant fallback so a patch whose
        // indentation/spacing is slightly off still applies (still required to be
        // unique). applyEdit throws the same honest "not found" / "not unique" errors.
        const { updated, matchedOld, note } = applyEdit(existing, oldStr, newStr, path);
        await this.actuator.writeFile(this.workspaceId, path, updated);
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
        await this.maybeCheckpoint(`edit ${path}`);
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
        // Governance (Layer 58): classify the command's risk before it runs so the
        // result carries an honest warning and a decision-audit episode is recorded.
        const risk = classifyCommandRisk(command);
        const { exitCode, stdout, stderr } = await this.actuator.runCommand(this.workspaceId, command);
        let out =
          `exit=${exitCode}\n${stdout}` + (stderr ? `\n[stderr]\n${stderr}` : '');
        if (risk.level !== 'none') {
          getWorkspaceMemory(this.workspaceId).recordAudit(
            `[${risk.level}] ran: ${command.slice(0, 200)} — ${risk.reasons.join('; ')}`,
          );
          out = `${governanceNote(risk)}\n${out}`;
        }
        this.state?.appendTerminal(out);
        // Remember real failures so the team can recall what went wrong (error memory).
        if (exitCode !== 0) {
          getWorkspaceMemory(this.workspaceId).recordError(`bash failed (exit ${exitCode}): ${command}\n${stderr.slice(0, 300)}`);
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
        return stdout.trim() || '(no matches)';
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
        const readiness = assessReadiness(archReport, findings, extra);
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
        return `${verdict}\n\n${buildConfidenceSummary(confidence)}\n\n${architectureSummary(archReport)}\n\n${securitySummary(findings)}\n\n${authenticitySummary(issues)}\n\n${dependencySummary(depIssues)}\n\n${envVarSummary(envIssues)}\n\n${accessibilitySummary(a11yIssues)}\n\n${complianceSummary(complianceIssues)}\n\n${testCoverageSummary(testCoverage)}\n\n${requirementCoverageSummary(reqCoverage)}\n\n${runnabilitySummary(runnability)}\n\n${seoSummary(seo)}\n\n${projectHygieneSummary(hygiene)}\n\n${errorBoundarySummary(errorBoundary)}\n\n${securityConfigSummary(securityConfig)}\n\n${secretLeakSummary(secretLeak)}\n\n${hardcodedUrlSummary(hardcodedUrls)}\n\n${portBindingSummary(portBindings)}\n\n${viteEnvSummary(viteEnv)}\n\n${envTemplateSecretSummary(envTemplateSecrets)}\n\n${asyncPatternSummary(asyncPatterns)}`;
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
        const content = generateReadme({ projectName, graph, packageJson: pkg });
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
        await this.maybeCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} from the project graph (${content.length} bytes).`;
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
        await this.maybeCheckpoint(`${kind} ${path}`);
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
        await this.maybeCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} (stack-aware).`;
      }

      case 'update_preview': {
        const port = reqNum(input, 'port');
        if (!this.actuator.getPortUrl) {
          throw new Error('Live preview is not available in this sandbox.');
        }
        const rawUrl = await this.actuator.getPortUrl(this.workspaceId, port);
        // §12: v3.0-built apps are previewed under the platform's E2B custom domain
        // (mitrify.xyz) instead of the raw *.e2b.app host. Idempotent + scoped to v3.0.
        const url = applyPreviewDomain(rawUrl);
        this.events?.emit({ type: 'preview', url, ts: Date.now() });
        return `Live preview published at ${url}`;
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
        await this.maybeCheckpoint(`codemod rename ${oldName} → ${newName}`);
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
        await this.maybeCheckpoint(`codemod add prop ${propName} to ${componentName}`);
        return result.summary || `Added prop "${propName}" to ${componentName} in ${result.changes.length} file(s).`;
      }

      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  }
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
    return { updated: existing.replace(oldStr, newStr), matchedOld: oldStr, note: '' };
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
    throw new Error(`edit_file: old_string not found in ${path}.`);
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
