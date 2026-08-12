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

/**
 * Whether a NEW build should try the deterministic SIMPLE-BUILDER lane first (manifest → shared
 * contract → every file generated in its own focused pass → tsc verify → bounded repair).
 *
 * ROOT CAUSE this fixes (admin, 2026-07-06: "v5.0 complete app bana nahi pa raha"): sonnet-tier NEW
 * builds went straight to the free-form multi-agent loop, and two real reports show that path churning
 * on even a landing page — sub-agents re-exploring the project from scratch, creating files beyond
 * scope, deleting and rebuilding them — 98 steps/10 min and 148 steps/29 min, both dead at the wall
 * clock with no complete app. The Simple-Builder lane already runs on SONNET (fastBuildModel — model
 * strength was never the gate), plans the COMPLETE file list up front (manifest, up to 40 files),
 * freezes a shared contract, builds every file, and verifies with tsc + bounded repair — today's
 * reports show it winning every time it ran (27 steps/1m23s, 33 steps/2m52s). So sonnet-tier new
 * builds now take this deterministic complete-app lane FIRST; the agentic loop remains the automatic
 * FALLBACK when the lane genuinely fails, and still owns edits, imports, and project-module turns.
 * Opus/power mode keeps the full agentic experience the user explicitly paid for. Pure + tested.
 */
export function classifyForSimpleLane(startTier: StartTier | undefined): boolean {
  return startTier === 'gemini' || startTier === 'haiku' || startTier === 'sonnet';
}

/**
 * After the SIMPLE-BUILDER lane has failed, is the ONE-SHOT lane still worth attempting?
 *
 * ROOT CAUSE (admin report 2026-08-12, the dukaan stock app). The build's first seven minutes:
 *
 *     0s    setup begins
 *     107s  first model call (the user waits through every second of the 107)
 *     260s  SIMPLE_BUILD_FALLBACK — "could not produce the app"      ← 153s spent
 *     260s  "Trying a fast one-shot build…"
 *     410s  ONESHOT_FALLBACK — "could not generate the app"          ← 150s more
 *     422s  the real builder finally starts
 *
 * Five minutes into two lanes that both failed. The one-shot's failure was not bad luck — it was
 * PREDICTABLE, from evidence the platform already held. This lane exists, in its own caller's words,
 * for "a TRIVIAL one-file app the manifest skips". The manifest had not skipped: it planned EIGHT
 * files, and the narration said so out loud ("Building 8 file(s) — one focused pass each…"). A single
 * ~8k-token call cannot emit an eight-file app — that truncation limit is the documented reason the
 * simple lane was built to replace this one.
 *
 * So the one-shot was asked to do something the platform had just measured to be impossible, and the
 * user paid 150 seconds and a full generation call for the answer. The measurement existed the whole
 * time; it simply died with the closure that made it.
 *
 * This is a strict NARROWING of an existing gate: `classifyForOneShot` still decides eligibility by
 * tier, and this only declines the attempt when the sibling lane has already PROVEN the app is
 * multi-file. Unknown (no manifest — the plan call itself failed or returned nothing parseable) stays
 * VIABLE, because a lane that never planned has proven nothing. Pure + tested.
 */
export function oneShotStillViable(sb: { plannedFiles?: number } | null | undefined): boolean {
  const planned = sb?.plannedFiles;
  if (typeof planned !== 'number' || !Number.isFinite(planned) || planned <= 0) return true; // never measured
  // ONE file is exactly the case this lane owns. TWO or more is an app a single call truncates.
  return planned <= 1;
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
  // Terminate a file's content at the FIRST of: its own `<<<ENDFILE>>>`, the NEXT `<<<FILE` header,
  // or end of input. Before this, the lazy content group was only bounded by `<<<ENDFILE>>>`, so a
  // single missing ENDFILE made file A's content run through the next `<<<FILE b>>>` header until the
  // following ENDFILE — merging two files into one corrupt file and silently DROPPING file B. The
  // `<<<FILE` lookahead + `$` terminator recover file B (and a lone trailing file with no ENDFILE).
  const re = /<<<FILE\s+(.+?)>>>\r?\n([\s\S]*?)(?:\r?\n?<<<ENDFILE>>>|(?=\r?\n?<<<FILE\s)|$)/g;
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
  /**
   * Hard cap (ms) on how long we WAIT for startPreview before completing the build anyway.
   * Critical: a dev server (`npm run dev`) never exits, and on some sandboxes its command
   * promise never resolves — without this cap the build would hang at "working…" forever even
   * though the files are already written. Preview is best-effort, so on timeout we just finish.
   * Default 90 s.
   */
  previewTimeoutMs?: number;
  /**
   * Hard cap (ms) on the WHOLE one-shot attempt (generate + writeFiles + preview). If any step
   * hangs (e.g. the model call never returns because the HTTP request stalls), the attempt is
   * abandoned and returns ok:false so the caller FALLS BACK to the agentic loop fast, instead of
   * the build spinning at "working…" for 10+ minutes. Default 180 s.
   */
  overallTimeoutMs?: number;
}

/** Resolve `p`, but reject with a timeout error if it has not settled within `ms`. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`operation did not finish within ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Run the OneShot lane. Best-effort: returns ok:false (never throws) when it could not produce a
 * usable app, so the caller falls through to the agentic loop. On success the build is DONE — the
 * files are written and no loop/escalation runs.
 *
 * STICKY SUCCESS: the generate+write phase is time-bounded (a stalled model call falls back fast),
 * but ONCE THE FILES ARE WRITTEN the success is LOCKED IN — a slow/hanging preview can never
 * downgrade it to a fallback. (Previously a successful one-shot whose preview was merely slow got
 * discarded, which re-ran the heavy agentic loop on top and blew the whole time budget → 12-min
 * timeout. The app was already built; the preview is just a bonus.)
 */
export async function runOneShot(deps: OneShotDeps): Promise<OneShotResult> {
  const minFiles = deps.minFiles ?? 1;
  let files: OneShotFile[];
  try {
    deps.log?.('Trying a fast one-shot build…');
    // Bound the ENTIRE generate+parse+write phase together (audit P0-B): writeFiles was previously
    // outside the timeout, so a stalled sandbox write hung the lane indefinitely. Now a stall in any
    // of generate / write falls back fast to the agentic loop.
    files = await withTimeout((async () => {
      const text = await deps.generate(oneShotSystemPrompt(deps.framework), oneShotUserPrompt(deps.prompt, deps.scaffoldPaths));
      const parsed = parseFileBlocks(text);
      if (parsed.length < minFiles) throw new Error('no_files_parsed');
      await deps.writeFiles(parsed);
      return parsed;
    })(), deps.overallTimeoutMs ?? 150_000);
  } catch (e) {
    // Generation / write failed or timed out → no app produced, fall back to the full builder.
    const reason = e instanceof Error ? e.message : String(e);
    const summary = reason === 'no_files_parsed'
      ? 'One-shot produced no usable files — switching to the full builder.'
      : 'One-shot could not generate the app — switching to the full builder.';
    return { ok: false, filesWritten: 0, summary, reason };
  }

  // ── FILES ARE WRITTEN → the app is BUILT. Success is LOCKED IN from here. ──
  // The preview is a best-effort BONUS, separately bounded: if it is slow or hangs we STILL return
  // ok:true, so the caller never discards a finished build to re-run the heavy loop.
  deps.log?.(`Generated ${files.length} file(s) in one shot.`);
  if (deps.startPreview) {
    try {
      await withTimeout(deps.startPreview(), deps.previewTimeoutMs ?? 90_000);
    } catch {
      deps.log?.('Preview is still starting — your files are ready; opening the preview will reconnect it.');
    }
  }
  return { ok: true, filesWritten: files.length, summary: `Built your app in one shot — ${files.length} file(s).` };
}
