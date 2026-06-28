// AgentV3 — OneShot fast lane (additive; the agentic loop is untouched).
//
// A simple app (todo, landing, form, small CRUD) does NOT need the full multi-agent ReAct loop
// (architect → plan → delegate → per-file tool calls → readiness gate → retry → escalate). That
// loop is powerful but expensive and fragile for trivial apps (the "$26 failed todo"). The OneShot
// lane builds such an app in ONE cheap text-generation call: the model returns EVERY file at once,
// we write them in a single batch, start the preview, and we're done — no per-file round-trips, no
// sub-agents, no Opus, no rebuild spiral.
//
// SAFETY: OneShot is a best-effort FIRST attempt. If it produces nothing usable (or throws), the
// caller falls through to the normal agentic loop — so the worst case is exactly today's behavior.
// It can never make things worse; it can only make a simple build cheap when it works.
//
// This module is dependency-light and the side-effects (model call, file writes, preview) are
// INJECTED, so the parsing/classification/prompt logic is fully unit-testable without a sandbox.

import type { StartTier } from './RequestAnalyser';

/** Whether this build should TRY the OneShot lane. Simple/medium tiers (gemini/haiku) → yes;
 *  complex tiers (sonnet/opus) keep the full agentic loop. Pure + exported for testing. */
export function classifyForOneShot(startTier: StartTier | undefined): boolean {
  return startTier === 'gemini' || startTier === 'haiku';
}

/** Whether the OneShot lane is enabled. On by default (the agentic loop is the safety net);
 *  AGENTV3_ONESHOT=off instantly disables it (rollback to pure-loop behavior). */
export function oneShotEnabled(): boolean {
  return process.env.AGENTV3_ONESHOT !== 'off';
}

export interface OneShotFile { path: string; content: string; }

/**
 * Parse the model's one-shot output into files. The model is instructed to emit each file as:
 *   <<<FILE path/to/file.ext>>>
 *   ...content...
 *   <<<ENDFILE>>>
 * This delimiter survives code that itself contains ``` fences or JSON, so it is far more robust
 * than markdown fences or a single JSON blob for source code. Pure + exported for testing.
 */
export function parseFileBlocks(text: string): OneShotFile[] {
  const files: OneShotFile[] = [];
  if (!text) return files;
  const re = /<<<FILE\s+(.+?)>>>\r?\n([\s\S]*?)\r?\n?<<<ENDFILE>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim().replace(/^["'`]|["'`]$/g, '');
    const content = m[2];
    // Reject empty / unsafe paths (no absolute, no traversal).
    if (!path || path.startsWith('/') || path.includes('..') || path.length > 300) continue;
    files.push({ path, content });
  }
  // De-dupe by path — the LAST block for a path wins (model may correct itself).
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(f.path, f.content);
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

/** The system prompt for the one-shot generation (no tools — pure structured text). */
export function oneShotSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} engineer. Build a COMPLETE, working, polished app in ONE response.`,
    '',
    'OUTPUT FORMAT — emit EVERY file the app needs, each wrapped exactly like this:',
    '<<<FILE relative/path/from/project/root.ext>>>',
    '...the full file content...',
    '<<<ENDFILE>>>',
    '',
    'RULES:',
    '- Output ONLY file blocks. No prose, no explanation, no markdown fences around the blocks.',
    '- Produce a FULLY WORKING app — real logic, real UI, no TODOs, no placeholders, no "..." stubs.',
    '- Edit/replace the scaffolded entry files (e.g. src/App.tsx or index.html) — do not nest a subfolder.',
    '- Keep the dev server config intact (host:true / 0.0.0.0) so the preview works.',
    '- Only include files you actually need; do not touch node_modules or lockfiles.',
  ].join('\n');
}

/** The user prompt: what to build + the existing scaffold the app starts from. */
export function oneShotUserPrompt(prompt: string, scaffoldPaths: string[]): string {
  const scaffold = scaffoldPaths.length
    ? `The project is already scaffolded with these files (edit/extend them, root is the project root):\n${scaffoldPaths.slice(0, 60).map((p) => `  - ${p}`).join('\n')}`
    : 'The project starts empty — create all files at the project root.';
  return `Build this app:\n\n${prompt}\n\n${scaffold}\n\nReturn every file as <<<FILE …>>> … <<<ENDFILE>>> blocks now.`;
}

export interface OneShotResult {
  ok: boolean;
  filesWritten: number;
  summary: string;
  /** Why it did not succeed — used by the caller to fall back and by diagnostics. */
  reason?: string;
}

export interface OneShotDeps {
  prompt: string;
  framework: string;
  scaffoldPaths: string[];
  /** ONE cheap text-generation call (Haiku/Gemini/Grok). Returns the raw model text. */
  generate: (system: string, user: string) => Promise<string>;
  /** Write the generated files (single batch). Throws on a hard failure. */
  writeFiles: (files: OneShotFile[]) => Promise<void>;
  /** Start the dev server + publish the preview. Best-effort — a failure does not fail OneShot. */
  startPreview?: () => Promise<void>;
  /** Surface a status line to the user. */
  log?: (msg: string) => void;
  /** Minimum files a real one-shot build must produce (default 1). */
  minFiles?: number;
}

/**
 * Run the OneShot lane. Best-effort: returns ok:false (never throws) when it could not produce a
 * usable app, so the caller falls through to the agentic loop. On success the build is DONE — the
 * files are written, the preview is starting, and no loop/escalation runs.
 */
export async function runOneShot(deps: OneShotDeps): Promise<OneShotResult> {
  const minFiles = deps.minFiles ?? 1;
  try {
    deps.log?.('Trying a fast one-shot build…');
    const text = await deps.generate(oneShotSystemPrompt(deps.framework), oneShotUserPrompt(deps.prompt, deps.scaffoldPaths));
    const files = parseFileBlocks(text);
    if (files.length < minFiles) {
      return { ok: false, filesWritten: 0, summary: 'One-shot produced no usable files — switching to the full builder.', reason: 'no_files_parsed' };
    }
    await deps.writeFiles(files);
    deps.log?.(`Generated ${files.length} file(s) in one shot.`);
    if (deps.startPreview) {
      try { await deps.startPreview(); } catch { /* preview is best-effort; files are already written */ }
    }
    return { ok: true, filesWritten: files.length, summary: `Built your app in one shot — ${files.length} file(s).` };
  } catch (e) {
    return { ok: false, filesWritten: 0, summary: 'One-shot attempt failed — switching to the full builder.', reason: e instanceof Error ? e.message : String(e) };
  }
}
