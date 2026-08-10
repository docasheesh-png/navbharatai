/**
 * Phase 4 — Build pipeline (the orchestration brain).
 *
 * Ties the real engine together for building/editing an app from a prompt:
 *   1. lift current files into a VFS (+ snapshot for rollback)
 *   2. ask the generator for surgical FileEdits → apply via EditEngine
 *   3. verify (ProjectVerifier) and auto-repair (RepairLoop) until clean/stuck
 *   4. return the resulting files + verification report (+ optional preview)
 *
 * The `generate` and `fix` functions (AI calls) are INJECTED so the whole flow
 * is unit-testable without a live model; the HTTP layer wires real aiCalls-based
 * implementations. This replaces the old "fire-and-forget full rewrite" path.
 */
import { VirtualFileSystem } from './ProjectModel';
import { ProjectVersionStore } from './VersionStore';
import { applyEdits, type FileEdit } from './EditEngine';
import { type VerifyResult } from './ProjectVerifier';
import { autoRepair, type FixGenerator } from './RepairLoop';
import { detectFramework, scaffold, type Framework } from './Scaffold';
import { runValidation, type ValidationReport, MIN_FEATURE_COVERAGE } from './ValidationPipeline';
import { syncDependencies } from './DependencySync';
import { selectArchitecture } from './ArchitectureManifest';
import { computeFeatureCoverage } from './FeatureCoverage';
import { checkSyntax } from './SyntaxCheck';

export type EditGenerator = (prompt: string, vfs: VirtualFileSystem) => Promise<FileEdit[]>;
/** Implement still-missing requested features into the existing project (agentic). */
export type FeatureCompleter = (prompt: string, missing: string[], vfs: VirtualFileSystem) => Promise<FileEdit[]>;

/** Live progress events emitted during a build (for SSE → real chat progress). */
export type BuildProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'module'; name: string; state: 'start' | 'done' | 'failed'; coverage?: number }
  | { type: 'files'; paths: string[] }
  /** G12 — real-time file content streamed as agent writes each file. */
  | { type: 'file'; fileName: string; content: string }
  | { type: 'terminal'; command: string; output: string; exitCode: number }
  | { type: 'preview_url'; url: string }
  | { type: 'plan'; steps: string[] }
  | { type: 'plan_step_start'; stepIndex: number; description: string }
  | { type: 'plan_step_done'; stepIndex: number }
  | { type: 'thinking'; content: string }
  | { type: 'screenshot'; base64: string; url?: string };

export interface BuildPipelineInput {
  prompt: string;
  files?: Record<string, string>;
  generate: EditGenerator;
  fix: FixGenerator;
  /** Optional: drives feature-coverage to >= 80% by re-generating missing features. */
  completeFeatures?: FeatureCompleter;
  maxRepairAttempts?: number;
  /** Max feature-completion passes (default 2). */
  maxFeatureAttempts?: number;
  /**
   * Modular mode: implement ONE missing module per model call, verifying between
   * each, until coverage is reached. Used by the streaming build (SSE keeps the
   * connection open, so the many small calls don't hit the gateway 504).
   */
  modular?: boolean;
  /**
   * This is an EDIT of an existing app (not a fresh build). When true, the
   * agentic feature-completion loop is SKIPPED — the user's edit instruction is
   * not a full feature spec, so running coverage against it would spuriously
   * "add missing features" and could undo the very change just made.
   */
  isEdit?: boolean;
  /** Live progress callback (drives the SSE stream / chat progress). */
  onProgress?: (ev: BuildProgressEvent) => void;
  /**
   * Seed a runnable framework skeleton for FRESH builds (no existing files).
   * Defaults to true; pass false to let the generator produce every file.
   */
  scaffold?: boolean;
}

export interface BuildPipelineResult {
  ok: boolean;
  files: Record<string, string>;
  applied: number;
  failed: number;
  verify: VerifyResult;
  repairAttempts: number;
  /** Snapshot id of the pre-build state (full rollback point). */
  baselineSnapshotId: string;
  fileCount: number;
  /** Framework skeleton seeded for a fresh build, if any. */
  scaffolded?: Framework;
  /** Structured validation report — gates, quality score, preview decision. */
  validation: ValidationReport;
  /** Preview is a privilege: only true when critical gates pass (no fake success). */
  previewAllowed: boolean;
}

/**
 * If any JS file in the VFS uses ES6 static import/export, upgrade every
 * bare <script src="*.js"> in index.html to <script type="module" src="*.js">.
 * This is a deterministic safety net — it runs even when the AI ignores the
 * manifest instruction to use type="module".
 */
function fixEsModuleScriptTag(vfs: VirtualFileSystem): void {
  const html = vfs.readText('index.html');
  if (!html) return;
  const jsFiles = vfs.paths().filter(p => /\.(js|mjs)$/.test(p));
  if (!jsFiles.length) return;
  const hasEsModuleSyntax = jsFiles.some(p => {
    const c = vfs.readText(p) || '';
    return /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(c);
  });
  if (!hasEsModuleSyntax) return;
  const fixed = html.replace(
    /<script(\s[^>]*)?\bsrc=["'][^"']*\.(?:js|mjs)["'][^>]*>/gi,
    (match) => {
      if (/\btype\s*=\s*["']module["']/i.test(match)) return match;
      return match.replace(/^<script/i, '<script type="module"');
    },
  );
  if (fixed !== html) vfs.write('index.html', fixed);
}

export async function runBuild(input: BuildPipelineInput): Promise<BuildPipelineResult> {
  const vfs = VirtualFileSystem.fromRecord(input.files);
  const versions = new ProjectVersionStore();

  // 0. Fresh build → seed a runnable framework skeleton so the generator edits
  //    a working foundation instead of inventing all wiring from scratch.
  let scaffolded: Framework | undefined;
  if (input.scaffold !== false && vfs.count === 0) {
    scaffolded = scaffold(vfs, detectFramework(input.prompt)) ?? undefined;
  }

  const baselineSnapshotId = versions.takeSnapshot(vfs, 'before build').id;
  const progress = input.onProgress ?? (() => {});

  // 1. Generate + apply the core of the app (shell + a few modules).
  progress({ type: 'status', message: 'Generating the app foundation…' });
  const edits = await input.generate(input.prompt, vfs);
  const applyRes = applyEdits(vfs, edits, versions, 'build: generated edits');
  progress({ type: 'files', paths: vfs.paths() });

  // 2. Verify + iteratively self-repair real errors.
  const repair = await autoRepair(vfs, {
    generateFixes: input.fix,
    versions,
    maxAttempts: input.maxRepairAttempts ?? 3,
  });

  // Agentic feature completion. MODULAR mode: implement ONE missing module per
  // call, verifying (syntax) between each, until coverage is reached — this is
  // what makes a 10-module app come out ~complete instead of truncated. Bounded,
  // but high (modular runs under SSE, so the many small calls can't 504).
  if (input.completeFeatures && input.prompt.trim() && !input.isEdit) {
    const modular = input.modular === true;
    const maxAttempts = modular ? 14 : (input.maxFeatureAttempts ?? 2);
    // Track modules that didn't improve so we move on instead of retrying a
    // stuck one forever (which would starve the remaining modules).
    const stuck = new Set<string>();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const cov = computeFeatureCoverage(input.prompt, vfs);
      progress({ type: 'status', message: `Coverage ${cov.coverage}% (${cov.implemented}/${cov.requested})` });
      if (cov.requested === 0 || cov.coverage >= MIN_FEATURE_COVERAGE) break;
      const missingItems = cov.items.filter((i) => i.status === 'fail' && !stuck.has(i.label));
      if (!missingItems.length) break;
      // Modular → one module at a time; batch mode → all missing at once.
      const target = modular ? [missingItems[0].label] : missingItems.map((i) => i.label);
      const label = target.join(', ');
      progress({ type: 'module', name: label, state: 'start', coverage: cov.coverage });
      const fEdits = await input.completeFeatures(input.prompt, target, vfs);
      if (!fEdits.length) {
        progress({ type: 'module', name: label, state: 'failed' });
        if (modular) { stuck.add(target[0]); continue; } else break;
      }
      applyEdits(vfs, fEdits, versions, `feature completion: ${label}`);
      await autoRepair(vfs, { generateFixes: input.fix, versions, maxAttempts: 1 });
      const after = computeFeatureCoverage(input.prompt, vfs);
      // If a modular module still isn't implemented, mark it stuck so we advance.
      if (modular && after.items.find((i) => i.label === target[0])?.status === 'fail') stuck.add(target[0]);
      progress({ type: 'module', name: label, state: 'done', coverage: after.coverage });
    }
  }
  progress({ type: 'status', message: 'Verifying the build…' });

  // G6 — dependency hardening: declare every imported package in package.json so
  // the generated app actually installs and runs (critical for VFS-tier builds).
  try {
    const depSync = syncDependencies(vfs);
    const totalAdded = depSync.added.length + depSync.addedDev.length;
    if (totalAdded) {
      const all = [...depSync.added, ...depSync.addedDev.map(d => `${d} (dev)`)].join(', ');
      const noun = totalAdded === 1 ? 'dependency' : 'dependencies';
      progress({ type: 'status', message: `Declared ${totalAdded} missing ${noun}: ${all}` });
    }
  } catch { /* dep sync never blocks the build */ }

  // Auto-fix: if any JS file uses ES6 import/export, ensure index.html has type="module"
  // Belt-and-suspenders guard for when the AI ignores the manifest instruction.
  fixEsModuleScriptTag(vfs);

  // Syntax/compile gate: parse every source file (esbuild). The model sometimes
  // emits malformed JSX (e.g. an unclosed <Router>) that passes every other gate
  // and then crashes the preview at compile time. Catch it, try ONE targeted
  // repair, and fold the result into the preview decision (no fake "live").
  let syntaxIssues = await checkSyntax(vfs);
  if (syntaxIssues.length && input.fix) {
    try {
      const fixes = await input.fix(syntaxIssues, vfs);
      if (fixes.length) {
        applyEdits(vfs, fixes, versions, 'syntax repair');
        syntaxIssues = await checkSyntax(vfs);
      }
    } catch { /* keep original syntax issues */ }
  }

  // Final validation gates → structured report + preview decision (no fake success).
  const validation = runValidation(vfs, selectArchitecture(input.prompt), input.prompt);

  // Merge the syntax gate into the report — a file that won't compile must BLOCK
  // preview and be reported honestly.
  if (syntaxIssues.length) {
    validation.gates.push({
      id: 'syntax',
      name: `Syntax / Compile (${syntaxIssues.length} file(s) fail to parse)`,
      status: 'fail',
      severity: 'critical',
      messages: syntaxIssues.map((i) => `${i.file}: ${i.message}`),
    });
    validation.previewAllowed = false;
    validation.status = 'FAILED';
    validation.blockingReasons = [...validation.blockingReasons, ...syntaxIssues.map((i) => `${i.file}: ${i.message}`)];
    validation.qualityScore = Math.max(0, validation.qualityScore - 45);
  }

  return {
    ok: repair.finalVerify.ok,
    files: vfs.toRecord(),
    applied: applyRes.applied,
    failed: applyRes.failed,
    verify: repair.finalVerify,
    repairAttempts: repair.attempts,
    baselineSnapshotId,
    fileCount: vfs.count,
    scaffolded,
    validation,
    previewAllowed: validation.previewAllowed,
  };
}
