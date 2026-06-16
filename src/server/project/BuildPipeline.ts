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
import { verifyProject, type VerifyResult } from './ProjectVerifier';
import { autoRepair, type FixGenerator } from './RepairLoop';
import { detectFramework, scaffold, type Framework } from './Scaffold';
import { runValidation, type ValidationReport } from './ValidationPipeline';
import { selectArchitecture } from './ArchitectureManifest';

export type EditGenerator = (prompt: string, vfs: VirtualFileSystem) => Promise<FileEdit[]>;

export interface BuildPipelineInput {
  prompt: string;
  files?: Record<string, string>;
  generate: EditGenerator;
  fix: FixGenerator;
  maxRepairAttempts?: number;
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

  // 1. Generate + apply the requested change.
  const edits = await input.generate(input.prompt, vfs);
  const applyRes = applyEdits(vfs, edits, versions, 'build: generated edits');

  // 2. Verify + iteratively self-repair real errors.
  const repair = await autoRepair(vfs, {
    generateFixes: input.fix,
    versions,
    maxAttempts: input.maxRepairAttempts ?? 3,
  });

  // Final validation gates → structured report + preview decision (no fake success).
  const validation = runValidation(vfs, selectArchitecture(input.prompt));

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
