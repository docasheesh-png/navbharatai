/**
 * Phase 1.1 — UnifiedBuildOrchestrator: the single typed interface that both
 * Pro Chat (/api/build-stream) and Engineer AI (/api/engineer-chat) route through.
 *
 * Design rules:
 *  - Defines the contract (types) in this file; the v2 engine is runProEngine.
 *  - `runUnifiedBuild` converts runProEngine's callback pattern to an async
 *    generator so callers can `for await` events without managing callbacks.
 *  - ENGINE=v2 (default) routes /api/build-stream here.
 *    ENGINE=v1 forces the old runBuild path (zero-downtime rollback).
 *  - Never throws — engine errors surface as `{ type: '_error' }` events.
 */
import type { ModelCall } from './aiEdits';
import type { DbProviderConfig } from '../EngineerAI/EngineerAITypes';
import type { BuildProgressEvent } from './BuildPipeline';
import {
  runProEngine,
  type ProEngineResult,
  type ExecutionTier,
} from '../EngineerAI/ProEngineRunner';
import type { VerifyResult } from './ProjectVerifier';
import type { ValidationReport } from './ValidationPipeline';

// ─── Input ───────────────────────────────────────────────────────────────────

export type BuildMode = 'fresh_build' | 'edit' | 'chat' | 'plan_only';

export interface UnifiedBuildInput {
  prompt: string;
  files?: Record<string, string>;
  callModel: ModelCall;
  mode: BuildMode;
  sessionId?: string;
  userE2bKey?: string;
  githubToken?: string;
  dbConfig?: DbProviderConfig;
  signal?: AbortSignal;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** Mirrored result returned via the `_done` terminal event. */
export interface UnifiedBuildComplete {
  usable: boolean;
  partial: boolean;
  ok: boolean;
  files: Record<string, string>;
  fileCount: number;
  previewAllowed: boolean;
  tier: ExecutionTier;
  verify: VerifyResult;
  validation: ValidationReport;
}

/**
 * The full event union yielded by `runUnifiedBuild`.
 * `_done` and `_error` are terminal — the generator ends after emitting one.
 * All other events are progress events passed through from runProEngine.
 */
export type UnifiedEvent =
  | (BuildProgressEvent & { _terminal?: never })
  | { type: '_done'; result: UnifiedBuildComplete }
  | { type: '_error'; message: string };

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Run a build and yield events as an async generator.
 * Wraps runProEngine's callback-based API into a pull-based stream.
 * Route handlers iterate this and pipe events to SSE/NDJSON.
 */
export async function* runUnifiedBuild(
  input: UnifiedBuildInput,
): AsyncGenerator<UnifiedEvent> {
  // Simple queue + promise bridge: callback pushes, generator pulls.
  const queue: UnifiedEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;

  const enqueue = (ev: UnifiedEvent) => {
    queue.push(ev);
    const n = notify;
    notify = null;
    n?.();
  };

  // Fire runProEngine — it drives the queue via `send`; its final result
  // arrives as a `_done` (or `_error`) event that marks the generator done.
  runProEngine({
    prompt: input.prompt,
    files: input.files,
    callModel: input.callModel,
    isEdit: input.mode === 'edit',
    sessionId: input.sessionId,
    userE2bKey: input.userE2bKey,
    githubToken: input.githubToken,
    dbConfig: input.dbConfig,
    send: ev => enqueue(ev),
    signal: input.signal,
  }).then((result: ProEngineResult) => {
    enqueue({ type: '_done', result });
    finished = true;
    const n = notify; notify = null; n?.();
  }).catch((err: unknown) => {
    enqueue({ type: '_error', message: (err as any)?.message || 'Build failed' });
    finished = true;
    const n = notify; notify = null; n?.();
  });

  // Drain the queue, waiting for new events when it's empty.
  while (true) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (finished && queue.length === 0) break;
    await new Promise<void>(resolve => { notify = resolve; });
  }
}

/** True when the ENGINE env var routes Pro Chat through the unified engine (default). */
export function isUnifiedEngineEnabled(): boolean {
  return process.env.ENGINE !== 'v1';
}
