/**
 * ProEngineRunner — the additive bridge that lets NavBharatAI Pro use the
 * EngineerAI agentic edit loop (read → reason → act → verify → self-heal) as its
 * PRIMARY edit engine, with a TIERED execution backend selected by app size.
 *
 * Tiers (escalate by size, each one availability-gated with graceful downgrade so
 * the app can NEVER break on a missing backend):
 *   - 'vfs'      : in-memory VirtualFileSystem. No infra, no cost. Always available.
 *   - 'cloudrun' : real container (DockerActuator) — real npm install/build/test.
 *                  Available only when DOCKER_ENABLED=true (a Docker daemon exists).
 *   - 'e2b'      : real cloud VM (E2BActuator) — full build/test/browser/DB.
 *                  Available only when a user (or env) E2B API key is present.
 *
 * Design rules:
 *  - The agentic loop runs UNCHANGED. We inject a router (Pro's own model) and a
 *    tier-appropriate actuator, and translate the loop's events into Pro's SSE
 *    contract so the UI is untouched.
 *  - This runner NEVER emits Pro's terminal `complete`/`error` event — it streams
 *    only progress and returns control to the route, which owns the terminal
 *    emission. That is what makes the server-side fallback to `runBuild` invisible.
 *  - If the selected backend is unavailable, we DOWNGRADE to the next lower tier
 *    (ultimately 'vfs'). If a sandbox run throws, we return `usable:false` so the
 *    route falls back to the legacy pipeline. The app survives every failure mode.
 */
import { analyzeProject } from '../runtime/RuntimeRouter';
import { VirtualFileSystem } from '../project/ProjectModel';
import { verifyProject, type VerifyResult } from '../project/ProjectVerifier';
import { checkSyntax } from '../project/SyntaxCheck';
import { runValidation, type ValidationReport } from '../project/ValidationPipeline';
import { selectArchitecture } from '../project/ArchitectureManifest';
import type { BuildProgressEvent } from '../project/BuildPipeline';
import type { ModelCall } from '../project/aiEdits';
import { EngineerAgentLoop } from './EngineerAgentLoop';
import { ProAgentRouter } from './AI/ProAgentRouter';
import { VfsActuator } from './actuators/VfsActuator';
import { DockerActuator } from './actuators/DockerActuator';
import { E2BActuator } from './actuators/E2BActuator';
import type { IEngineerActuator } from './actuators/IEngineerActuator';
import type { EngineerTask } from './EngineerAITypes';

export type ExecutionTier = 'vfs' | 'cloudrun' | 'e2b';

// Tier thresholds (single source of truth — tuned conservatively).
const VFS_MAX_FILES = 40;
const VFS_MAX_BYTES = 512 * 1024;
const CLOUDRUN_MAX_FILES = 150;
const CLOUDRUN_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Pick the DESIRED execution tier for a project by size/needs (pure + unit-tested).
 * `clampToVfs` forces 'vfs' regardless of size (used by callers that want to stay
 * in-memory). The actual backend used may be downgraded by `resolveBackend` when
 * the desired tier's infra isn't available.
 */
export function selectTier(vfs: VirtualFileSystem, clampToVfs = true): ExecutionTier {
  if (clampToVfs) return 'vfs';
  const profile = analyzeProject(vfs);
  const big = vfs.count > CLOUDRUN_MAX_FILES || vfs.totalBytes > CLOUDRUN_MAX_BYTES;
  if (big) return 'e2b';
  const medium = profile.needsNodeServer || vfs.count > VFS_MAX_FILES || vfs.totalBytes > VFS_MAX_BYTES;
  if (medium) return 'cloudrun';
  return 'vfs';
}

/** True when a local Docker daemon is available for the container tier. */
export function dockerAvailable(): boolean {
  return process.env.DOCKER_ENABLED === 'true';
}

interface ResolvedBackend {
  /** The EFFECTIVE tier after availability downgrade (what actually runs). */
  tier: ExecutionTier;
  actuator: IEngineerActuator;
  /** True for real container/VM backends (need file seed + collect + cleanup). */
  sandbox: boolean;
}

/**
 * Resolve the desired tier to the highest AVAILABLE backend at or below it,
 * downgrading gracefully so we never select a backend that can't run. Order of
 * preference for the higher tiers: a real cloud VM (E2B, when a key exists) →
 * a local container (Docker, when enabled) → in-memory VFS.
 */
export function resolveBackend(
  desired: ExecutionTier,
  vfs: VirtualFileSystem,
  userE2bKey?: string,
): ResolvedBackend {
  const e2bKey = userE2bKey || process.env.E2B_API_KEY || '';
  const vfsBackend = (): ResolvedBackend => ({ tier: 'vfs', actuator: new VfsActuator(vfs), sandbox: false });
  const e2bBackend = (): ResolvedBackend => ({ tier: 'e2b', actuator: new E2BActuator(userE2bKey || undefined), sandbox: true });
  const dockerBackend = (): ResolvedBackend => ({ tier: 'cloudrun', actuator: new DockerActuator(), sandbox: true });

  if (desired === 'e2b') {
    if (e2bKey) return e2bBackend();
    if (dockerAvailable()) return dockerBackend();
    return vfsBackend();
  }
  if (desired === 'cloudrun') {
    if (dockerAvailable()) return dockerBackend();
    if (e2bKey) return e2bBackend();
    return vfsBackend();
  }
  return vfsBackend();
}

export interface ProEngineOptions {
  prompt: string;
  files?: Record<string, string>;
  callModel: ModelCall;
  isEdit?: boolean;
  sessionId?: string;
  /** User's own E2B API key — unlocks the top tier for large apps (billed to them). */
  userE2bKey?: string;
  send: (ev: BuildProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ProEngineResult {
  /** True when the loop produced usable file edits (route should emit complete). */
  usable: boolean;
  /** True when the run was cut short by the abort signal (soft deadline) — the
   *  files are real but the work isn't finished, so the caller can offer/auto-run
   *  a "continue" turn. The user always gets whatever was built so far. */
  partial: boolean;
  ok: boolean;
  files: Record<string, string>;
  fileCount: number;
  verify: VerifyResult;
  validation: ValidationReport;
  previewAllowed: boolean;
  /** The tier that actually executed (after any availability downgrade). */
  tier: ExecutionTier;
}

const ACTION_ICON: Record<string, string> = {
  bash: '⌨️', edit_file: '✏️', patch_file: '🩹', browse: '🌐', screenshot: '📸',
  browser_action: '🖱️', web_search: '🔎', drive: '🚗', restore: '↩️',
  provision_db: '🗄️', deploy: '🚀', done: '✅',
};

/**
 * A short, model-facing preamble telling the agent which execution tier it runs
 * in. Keeps the loop UNCHANGED while steering it away from capabilities the
 * in-memory tier can't provide. Sandbox tiers get the full toolset (no preamble).
 */
function tierPreamble(tier: ExecutionTier): string {
  if (tier !== 'vfs') return '';
  return (
    '[EXECUTION TIER: in-memory]\n' +
    'There is NO shell, dev server, or browser in this tier. Do all work with ' +
    'edit_file / patch_file, and verify with the `done` action (it runs a static ' +
    'build + syntax gate and reports real errors to fix). Do NOT use bash, ' +
    'screenshot, browser_action, drive, deploy, or provision_db.\n\n'
  );
}

/**
 * Run the agentic engine for one Pro request. Streams progress via `send`,
 * returns the final files + validation. The caller decides — based on `usable` —
 * whether to emit the terminal event or fall back to the legacy pipeline.
 */
export async function runProEngine(opts: ProEngineOptions): Promise<ProEngineResult> {
  const { prompt, files, callModel, isEdit, sessionId, userE2bKey, send, signal } = opts;

  const inputVfs = VirtualFileSystem.fromRecord(files);
  // Phase 6: always prefer E2B (real cloud VM) for Pro — resolveBackend() downgrades
  // to Docker or VFS automatically when E2B key is unavailable. This makes real
  // execution the default, not just a large-project escalation.
  const e2bKey = userE2bKey || process.env.E2B_API_KEY || '';
  const desired: ExecutionTier = e2bKey ? 'e2b' : selectTier(inputVfs, /* clampToVfs */ false);
  const backend = resolveBackend(desired, inputVfs, userE2bKey);

  const workspaceId = sessionId || `pro-${Date.now()}`;
  const router = new ProAgentRouter(callModel);
  // Pro uses Claude Opus (200k context) — give the agent a much larger context
  // budget so it can see more files and larger file contents per prompt step.
  const loop = new EngineerAgentLoop(router, backend.actuator, {
    contextBudget: { total: 140_000, perFile: 20_000, maxFiles: 80 },
  });
  const task: EngineerTask = {
    workspaceId,
    instruction: tierPreamble(backend.tier) + prompt,
    projectType: 'auto',
  };

  if (backend.tier !== 'vfs') {
    send({ type: 'status', message: `⚙️ Running in ${backend.tier === 'e2b' ? 'a cloud VM' : 'a real container'} (full build + test)…` });
  }

  let didEdit = false;
  let sawError = false;
  let aborted = false;
  let runError = false;
  // For 'vfs' the actuator wraps inputVfs directly; for sandbox tiers we collect
  // the result back into a fresh VFS after the run.
  let outVfs: VirtualFileSystem = inputVfs;

  try {
    // Seed existing files into a real sandbox before the loop starts (skipped for
    // fresh builds so the actuator can scaffold its own starter template).
    if (backend.sandbox && inputVfs.count > 0) {
      await backend.actuator.ensureWorkspace(workspaceId);
      for (const f of inputVfs.list()) {
        if (f.encoding === 'base64') await backend.actuator.writeBinaryFile(workspaceId, f.path, f.content);
        else await backend.actuator.writeFile(workspaceId, f.path, f.content);
      }
    }

    for await (const ev of loop.run(task, signal)) {
      switch (ev.type) {
        case 'status':
          send({ type: 'status', message: ev.message });
          break;
        case 'action_start':
          send({ type: 'status', message: `${ACTION_ICON[ev.action] || '•'} ${ev.thought || ev.action}` });
          break;
        case 'command_result':
          send({ type: 'status', message: `$ ${ev.command} → exit ${ev.exitCode}` });
          break;
        case 'build_result':
          send({ type: 'module', name: 'verify', state: ev.success ? 'done' : 'failed' });
          send({ type: 'status', message: ev.logs.split('\n').slice(0, 4).join(' · ').slice(0, 240) });
          break;
        case 'files_changed':
          didEdit = true;
          send({ type: 'files', paths: ev.files.map((f) => f.path) });
          break;
        case 'checkpoint_created':
        case 'server_ready':
        case 'screenshot_result':
        case 'browser_action_result':
        case 'drive_frame':
        case 'console_error':
        case 'search_result':
        case 'backend_ready':
        case 'backend_provisioned':
        case 'deployed':
        case 'deploy_result':
        case 'workspace_saved':
        case 'browse_result':
          send({ type: 'status', message: summarizeEvent(ev) });
          break;
        case 'chat_reply':
          send({ type: 'status', message: ev.message.slice(0, 200) });
          break;
        case 'complete':
        case 'max_steps_reached':
          break;
        case 'error':
          sawError = true;
          break;
        case 'aborted':
          aborted = true;
          break;
      }
      if (ev.type === 'complete' || ev.type === 'max_steps_reached' || ev.type === 'error' || ev.type === 'aborted') break;
    }

    // Collect the result out of a real sandbox into a VFS (skip node_modules etc. —
    // the actuator's listFiles already excludes them).
    if (backend.sandbox) {
      const collected = new VirtualFileSystem();
      for (const p of await backend.actuator.listFiles(workspaceId)) {
        try {
          collected.write(p, await backend.actuator.readFile(workspaceId, p));
        } catch { /* unreadable/binary — skip */ }
      }
      outVfs = collected;
    }
  } catch (err: any) {
    // Any backend/infra failure → don't break the build; signal the route to fall
    // back to the legacy pipeline.
    runError = true;
    send({ type: 'status', message: 'Sandbox unavailable — falling back to the standard pipeline…' });
    console.warn('[PRO-ENGINE] backend run failed:', err?.message || err);
  } finally {
    // Best-effort: pause/stop the sandbox so it stops consuming resources.
    if (backend.sandbox) {
      try {
        const sid = await backend.actuator.getSandboxId(workspaceId);
        if (sid) await backend.actuator.pauseSandbox(sid);
      } catch { /* non-fatal */ }
    }
  }

  // The agent loop persists its own cross-session bookkeeping under `.engineer/`
  // (e.g. the PlannerAgent writes `.engineer/memory.md`). Strip it so it never
  // pollutes the user's project, file list, preview, or validation gates.
  for (const p of outVfs.paths()) {
    if (p === '.engineer' || p.startsWith('.engineer/')) outVfs.delete(p);
  }

  // ── Finalize: run the same validation/preview gate the legacy pipeline uses
  //    (mirrors BuildPipeline.runBuild's tail) so `complete` is identical-shape.
  const finalFiles = outVfs.toRecord();
  const verify = verifyProject(outVfs);
  const validation = runValidation(outVfs, selectArchitecture(prompt), prompt);
  const syntaxIssues = await checkSyntax(outVfs);
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

  // An aborted run (soft deadline) still counts as usable when it produced edits —
  // we keep the partial work instead of throwing it away, and flag it `partial` so
  // the caller can continue it. Only a hard error / infra failure blocks usability.
  const usable = !sawError && !runError && didEdit && Object.keys(finalFiles).length > 0;

  return {
    usable,
    partial: aborted,
    ok: verify.ok,
    files: finalFiles,
    fileCount: outVfs.count,
    verify,
    validation,
    previewAllowed: validation.previewAllowed,
    tier: backend.tier,
  };
}

function summarizeEvent(ev: { type: string } & Record<string, any>): string {
  switch (ev.type) {
    case 'checkpoint_created': return '💾 Checkpoint saved';
    case 'server_ready': return `🟢 Server ready: ${ev.url}`;
    case 'screenshot_result': return '📸 Captured screenshot';
    case 'browser_action_result': return `🖱️ ${ev.detail || ev.action}`;
    case 'drive_frame': return `🚗 ${ev.stepDetail || 'browsing'}`;
    case 'console_error': return `⚠️ ${ev.errors?.length || 0} runtime error(s)`;
    case 'search_result': return `🔎 ${ev.query}`;
    case 'backend_ready': return `🗄️ Backend ready (${(ev.features || []).join(', ')})`;
    case 'backend_provisioned': return `🗄️ ${ev.provider} configured`;
    case 'deployed': return `🚀 Deployed (port ${ev.port})`;
    case 'deploy_result': return `🚀 Live: ${ev.url}`;
    case 'workspace_saved': return '💾 Workspace saved';
    case 'browse_result': return `🌐 Fetched ${ev.url}`;
    default: return '…';
  }
}
