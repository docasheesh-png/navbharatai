/**
 * Phase 72 — Multi-Agent Orchestration for Pro builds.
 *
 * Detects "full-stack" tasks and fans out to TWO parallel focused generation
 * calls (one for the backend/API layer, one for the frontend/UI layer), then
 * merges the resulting FileEdit sets. Paths that appear in both sets are
 * deduplicated (frontend wins for shared config files like package.json).
 *
 * Additive: falls back to a single generation call for non-full-stack tasks so
 * the existing pipeline is completely unchanged for simple projects.
 */

import type { VirtualFileSystem } from '../project/ProjectModel';
import type { FileEdit } from '../project/EditEngine';
import { makeAiEditGenerator, type ModelCall } from '../project/aiEdits';

const FULLSTACK_PATTERNS = [
  /\bfull[- ]?stack\b/i,
  /\b(backend|api|server).{1,40}(frontend|ui|client)\b/i,
  /\b(frontend|ui|client).{1,40}(backend|api|server)\b/i,
  /\b(react|vue|angular|svelte|next\.?js).{1,40}(node|express|fastapi|django|flask|spring|gin|axum|rails)\b/i,
  /\b(node|express|fastapi|django|flask|spring|gin|axum|rails).{1,40}(react|vue|angular|svelte|next\.?js)\b/i,
];

export function isFullStackTask(prompt: string): boolean {
  return FULLSTACK_PATTERNS.some((p) => p.test(prompt));
}

const FRONTEND_FOCUS =
  '[FOCUS: UI/frontend layer only — React/HTML/CSS/TypeScript components, routing, and ' +
  'client-side state. Match your API calls to the backend contract but do NOT generate ' +
  'any backend or server files (no Express routes, no Python/Go server code, no DB models).]';

const BACKEND_FOCUS =
  '[FOCUS: backend/API layer only — server routes, DB models, auth middleware, business logic. ' +
  'Do NOT generate any frontend UI files (no React components, no CSS, no HTML page content).]';

/**
 * Generate file edits for a Pro build request.
 *
 * For full-stack tasks: runs FRONTEND and BACKEND generation in parallel and
 * merges the results (frontend takes precedence on shared paths like
 * package.json, tsconfig.json, README). Falls back silently on any error.
 *
 * For all other tasks: delegates directly to the standard single-call generator.
 */
export async function orchestrateGenerate(
  prompt: string,
  vfs: VirtualFileSystem,
  callModel: ModelCall,
): Promise<FileEdit[]> {
  if (!isFullStackTask(prompt)) {
    const { generate } = makeAiEditGenerator(callModel);
    return generate(prompt, vfs);
  }

  const { generate: genFrontend } = makeAiEditGenerator(callModel);
  const { generate: genBackend } = makeAiEditGenerator(callModel);

  const [frontendEdits, backendEdits] = await Promise.all([
    genFrontend(`${FRONTEND_FOCUS}\n\n${prompt}`, vfs).catch(() => [] as FileEdit[]),
    genBackend(`${BACKEND_FOCUS}\n\n${prompt}`, vfs).catch(() => [] as FileEdit[]),
  ]);

  // Merge: backend edits first, then frontend; for duplicate write paths the
  // LATER entry wins (frontend overwrites shared config files).
  const seen = new Map<string, number>();
  const merged: FileEdit[] = [];
  for (const edit of [...backendEdits, ...frontendEdits]) {
    const key = edit.op === 'rename' ? edit.path : edit.path;
    const existing = seen.get(key);
    if (edit.op === 'write' && existing !== undefined) {
      merged[existing] = edit; // overwrite in place
    } else {
      seen.set(key, merged.length);
      merged.push(edit);
    }
  }
  return merged;
}
