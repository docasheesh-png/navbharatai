import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ToolUse } from './ClaudeClient';
import type { AgentRole, ToolName, TodoItem, TodoStatus } from './types';
import type { Checkpointer } from './GitManager';
import { isWorkerRole } from './AgentRegistry';
import { getWorkspaceMemory } from './WorkspaceMemory';
import { analyzeArchitecture, architectureSummary } from './ArchitectureAnalysis';
import { securitySummary } from './SecurityAnalysis';
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
import { analyzeDependencies, dependencySummary } from './DependencyAnalysis';
import { extractEnvRefs, parseEnvKeys, analyzeEnvVars, envVarSummary } from './EnvVarAnalysis';
import { resolveLocalImport } from './ArchitectureAnalysis';
import { assessReadiness, readinessVerdict } from './Readiness';
import { analyzeTestCoverage, testCoverageSummary } from './TestCoverageAnalysis';
import { analyzeRequirementCoverage, requirementCoverageSummary } from './RequirementCoverage';
import { generateReadme } from './ReadmeGenerator';
import type { SecondOpinion } from './SecondOpinion';
import type { Consensus } from './Consensus';

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
   * Best-effort authenticity/completeness scan over the project's source files.
   * Reads real source via the actuator and runs scanAuthenticity on each. Wrapped
   * so any file-access error degrades gracefully to an empty issue list — the
   * evaluate tool still returns its architecture + security result.
   */
  private async collectAuthenticityIssues(): Promise<AuthenticityIssue[]> {
    const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|vue|svelte|go|rb|java|php)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: AuthenticityIssue[] = [];
    try {
      const paths = await this.actuator.listFiles(this.workspaceId);
      const candidates = paths.filter((p) => SOURCE_EXT.test(p) && !SKIP.test(p)).slice(0, 200);
      for (const p of candidates) {
        try {
          const content = await this.actuator.readFile(this.workspaceId, p);
          if (content.length > 200_000) continue;
          issues.push(...scanAuthenticity(p, content));
        } catch {
          /* skip a single unreadable file — never break evaluate */
        }
      }
    } catch {
      /* listing failed — fall back to no authenticity issues */
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
  private async collectAccessibilityIssues(): Promise<AccessibilityIssue[]> {
    const FRONTEND = /\.(tsx|jsx|vue|svelte|html?|astro)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: AccessibilityIssue[] = [];
    try {
      const paths = await this.actuator.listFiles(this.workspaceId);
      const candidates = paths.filter((p) => FRONTEND.test(p) && !SKIP.test(p)).slice(0, 200);
      for (const p of candidates) {
        try {
          const content = await this.actuator.readFile(this.workspaceId, p);
          if (content.length > 200_000) continue;
          issues.push(...scanAccessibility(p, content));
        } catch {
          /* skip a single unreadable file — never break evaluate */
        }
      }
    } catch {
      /* listing failed — fall back to no accessibility issues */
    }
    return issues;
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
  private async collectComplianceIssues(): Promise<ComplianceIssue[]> {
    const CODE = /\.(tsx?|jsx?|vue|svelte|astro|html?|mjs|cjs)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    const issues: ComplianceIssue[] = [];
    let collectsPii = false;
    let hasPrivacyPolicy = false;
    let hasTracker = false;
    let hasConsentUI = false;
    let trackerFile = '';
    try {
      const paths = await this.actuator.listFiles(this.workspaceId);
      const candidates = paths.filter((p) => CODE.test(p) && !SKIP.test(p)).slice(0, 250);
      for (const p of candidates) {
        try {
          const content = await this.actuator.readFile(this.workspaceId, p);
          if (content.length > 200_000) continue;
          issues.push(...scanCompliance(p, content));
          if (detectsPiiCollection(content)) collectsPii = true;
          if (!hasPrivacyPolicy && looksLikePrivacyPolicy(p, content)) hasPrivacyPolicy = true;
          if (detectsTracker(content)) { hasTracker = true; if (!trackerFile) trackerFile = p; }
          if (detectsConsentUI(content)) hasConsentUI = true;
        } catch {
          /* skip a single unreadable file — never break evaluate */
        }
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
    } catch {
      /* listing failed — return whatever issues were gathered (often none) */
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
  private async collectEnvVarIssues(): Promise<EnvVarIssue[]> {
    const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|vue|svelte|go|rb|java|php)$/i;
    const SKIP = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;
    try {
      const refs = new Set<string>();
      try {
        const paths = await this.actuator.listFiles(this.workspaceId);
        const candidates = paths.filter((p) => SOURCE_EXT.test(p) && !SKIP.test(p)).slice(0, 200);
        for (const p of candidates) {
          try {
            const content = await this.actuator.readFile(this.workspaceId, p);
            if (content.length > 200_000) continue;
            for (const name of extractEnvRefs(p, content)) refs.add(name);
          } catch {
            /* skip a single unreadable file — never break evaluate */
          }
        }
      } catch {
        /* listing failed — fall back to no references */
      }
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
        getWorkspaceMemory(this.workspaceId).indexFile(path, content);
        await this.maybeCheckpoint(`${kind} ${path}`);
        return `${kind === 'create' ? 'Created' : 'Updated'} ${path} (${content.length} bytes).`;
      }

      case 'edit_file': {
        const path = reqStr(input, 'path');
        const oldStr = reqStr(input, 'old_string');
        const newStr = reqStr(input, 'new_string');
        const existing = await this.actuator.readFile(this.workspaceId, path);
        const occurrences = existing.split(oldStr).length - 1;
        if (occurrences === 0) {
          throw new Error(`edit_file: old_string not found in ${path}.`);
        }
        if (occurrences > 1) {
          throw new Error(
            `edit_file: old_string is not unique in ${path} (${occurrences} matches) — include more surrounding context.`,
          );
        }
        const updated = existing.replace(oldStr, newStr);
        await this.actuator.writeFile(this.workspaceId, path, updated);
        this.state?.recordFileChange({ path, kind: 'modify' }, agent);
        getWorkspaceMemory(this.workspaceId).indexFile(path, updated);
        this.events?.emit({
          type: 'diff',
          agent,
          diff: { path, patch: miniDiff(oldStr, newStr) },
          ts: Date.now(),
        });
        await this.maybeCheckpoint(`edit ${path}`);
        return `Edited ${path}.`;
      }

      case 'bash': {
        const command = reqStr(input, 'command');
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
        const readiness = assessReadiness(archReport, findings);
        const verdict = readinessVerdict(readiness);
        // Best-effort authenticity/completeness pass — never throws, never breaks
        // evaluate if file access fails. On any error we fall back to no issues.
        const issues = await this.collectAuthenticityIssues();
        // Best-effort dependency-consistency pass — never throws, never breaks
        // evaluate if graph access or package.json read fails. On any error the
        // prior four sections are still returned in full.
        const depIssues = await this.collectDependencyIssues();
        // Best-effort environment-variable completeness pass — never throws, never
        // breaks evaluate if file access fails. On any error the prior five sections
        // are still returned in full.
        const envIssues = await this.collectEnvVarIssues();
        // Best-effort accessibility pass — never throws, never breaks evaluate if
        // file access fails. On any error the prior six sections are still returned.
        const a11yIssues = await this.collectAccessibilityIssues();
        // Best-effort trust/safety/compliance pass (Layer 77 "Bharosa") — never
        // throws, never breaks evaluate. Ends with an honest launch-safe certificate.
        const complianceIssues = await this.collectComplianceIssues();
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
        return `${verdict}\n\n${buildConfidenceSummary(confidence)}\n\n${architectureSummary(archReport)}\n\n${securitySummary(findings)}\n\n${authenticitySummary(issues)}\n\n${dependencySummary(depIssues)}\n\n${envVarSummary(envIssues)}\n\n${accessibilitySummary(a11yIssues)}\n\n${complianceSummary(complianceIssues)}\n\n${testCoverageSummary(testCoverage)}\n\n${requirementCoverageSummary(reqCoverage)}`;
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

      case 'update_preview': {
        const port = reqNum(input, 'port');
        if (!this.actuator.getPortUrl) {
          throw new Error('Live preview is not available in this sandbox.');
        }
        const url = await this.actuator.getPortUrl(this.workspaceId, port);
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

      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  }
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
