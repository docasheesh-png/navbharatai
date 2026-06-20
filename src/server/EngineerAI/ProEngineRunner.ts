/**
 * ProEngineRunner — the additive bridge that lets NavBharatAI Pro use the
 * EngineerAI agentic edit loop (read → reason → act → verify → self-heal) as its
 * PRIMARY edit engine, with a tiered execution backend selected by app size.
 *
 * Design rules (see plan):
 *  - The agentic loop runs UNCHANGED. We only inject a router (wrapping Pro's own
 *    model) and a tier-appropriate actuator, and translate the loop's events into
 *    Pro's existing SSE contract so the UI is untouched.
 *  - This runner NEVER emits Pro's terminal `complete`/`error` event — it streams
 *    only progress (`status`/`module`/`files`) and returns control to the route,
 *    which owns the single terminal emission (memory refresh + preview). That is
 *    what makes the server-side fallback to `runBuild` transparent.
 *  - Phase 1 ships the VFS tier only (`selectTier` clamps to 'vfs'); Cloud Run
 *    and E2B tiers are added in later phases behind the same selector.
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
import type { EngineerTask } from './EngineerAITypes';

export type ExecutionTier = 'vfs' | 'cloudrun' | 'e2b';

// Tier thresholds (single source of truth — tuned conservatively). Phase 1 only
// the 'vfs' tier is reachable; the higher tiers are wired in Phases 2–3.
const VFS_MAX_FILES = 40;
const VFS_MAX_BYTES = 512 * 1024;
const CLOUDRUN_MAX_FILES = 150;
const CLOUDRUN_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Pick the execution tier for a project. Pure + unit-tested. `clampToVfs` keeps
 * Phase 1 strictly in-memory regardless of size (the higher-tier backends don't
 * exist yet); pass false once Phases 2–3 land.
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

export interface ProEngineOptions {
  prompt: string;
  files?: Record<string, string>;
  callModel: ModelCall;
  isEdit?: boolean;
  sessionId?: string;
  send: (ev: BuildProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ProEngineResult {
  /** True when the loop produced usable file edits (route should emit complete). */
  usable: boolean;
  ok: boolean;
  files: Record<string, string>;
  fileCount: number;
  verify: VerifyResult;
  validation: ValidationReport;
  previewAllowed: boolean;
  tier: ExecutionTier;
}

const ACTION_ICON: Record<string, string> = {
  bash: '⌨️', edit_file: '✏️', patch_file: '🩹', browse: '🌐', screenshot: '📸',
  browser_action: '🖱️', web_search: '🔎', drive: '🚗', restore: '↩️',
  provision_db: '🗄️', deploy: '🚀', done: '✅',
};

/**
 * A short, model-facing preamble that tells the agent which execution tier it is
 * running in. Keeps the loop UNCHANGED while steering it away from capabilities
 * the in-memory tier can't provide.
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
  const { prompt, files, callModel, isEdit, sessionId, send, signal } = opts;

  const vfs = VirtualFileSystem.fromRecord(files);
  const tier = selectTier(vfs, /* clampToVfs (Phase 1) */ true);

  const actuator = new VfsActuator(vfs);
  const router = new ProAgentRouter(callModel);
  const loop = new EngineerAgentLoop(router, actuator);

  const task: EngineerTask = {
    workspaceId: sessionId || `pro-${Date.now()}`,
    instruction: tierPreamble(tier) + prompt,
    projectType: 'auto',
  };

  let didEdit = false;
  let sawError = false;
  let aborted = false;

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
        // No dedicated Pro SSE field — surface a brief status line so the UI shows progress.
        send({ type: 'status', message: summarizeEvent(ev) });
        break;
      case 'chat_reply':
        // Conversational-only reply (no edits) → not a usable build result; let the
        // route fall back to the standard pipeline which handles chat vs build.
        send({ type: 'status', message: ev.message.slice(0, 200) });
        break;
      case 'complete':
      case 'max_steps_reached':
        // Loop finished — break out and finalize below.
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

  // ── Finalize: pull files back + run the same validation/preview gate the legacy
  //    pipeline uses (mirrors BuildPipeline.runBuild's tail), so `complete` carries
  //    an identical-shape payload. ─────────────────────────────────────────────
  const finalFiles = vfs.toRecord();
  const verify = verifyProject(vfs);
  const validation = runValidation(vfs, selectArchitecture(prompt), prompt);
  const syntaxIssues = await checkSyntax(vfs);
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

  const usable = !sawError && !aborted && didEdit && Object.keys(finalFiles).length > 0;

  return {
    usable,
    ok: verify.ok,
    files: finalFiles,
    fileCount: vfs.count,
    verify,
    validation,
    previewAllowed: validation.previewAllowed,
    tier,
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
