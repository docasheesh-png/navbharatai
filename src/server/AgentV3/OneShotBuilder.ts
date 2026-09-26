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
// ONE timeout helper for the whole build pipeline. This module used to carry its own private copy,
// and that duplication is the direct reason the July zombie-write fix landed in `SimpleBuilder` and
// not here: a grep for the shared helper simply did not reach this file, so the sibling was never
// hunted (fourth absolute rule, step 3) and the same failure returned two months later. Centralised
// so a future reader finds every lane that races a deadline in one search.
import { withTimeout } from './asyncUtils';

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
export function oneShotStillViable(sb: { plannedFiles?: number; reason?: string } | null | undefined): boolean {
  // A LANE THAT TIMED OUT HAS PROVEN SOMETHING ABOUT THE PROVIDER, NOT JUST ABOUT THE APP
  // (autopsy a38c6fef, 2026-09-13). The rule above reads "no manifest" as "never measured, so still
  // worth a try". That was right about the app's SIZE and wrong about everything else: when the
  // sibling lane died because its own model call never came back, we have just watched this build's
  // provider stall. Sending it a STRICTLY LARGER single call is not an unknown bet — it is a worse
  // one on a stalling provider, and it is the exact 150 seconds this build spent to learn nothing.
  //
  // It also mattered far beyond the time: that abandoned one-shot is what came back seventeen minutes
  // later and overwrote the finished app. The cheapest way to never have a zombie lane is to not open
  // one we can already see is doomed.
  //
  // Deliberately narrow: only a TIMEOUT declines. A lane that failed to parse, or failed verify, met a
  // provider that WAS answering — a single call may genuinely do better there, so that stays viable.
  // The full agentic builder remains the safety net in every case, so declining only ever costs a lane
  // we had measured to be a bad bet.
  if (typeof sb?.reason === 'string' && sb.reason.includes('timed out')) return false;
  const planned = sb?.plannedFiles;
  if (typeof planned !== 'number' || !Number.isFinite(planned) || planned <= 0) return true; // never measured
  // ONE file is exactly the case this lane owns. TWO or more is an app a single call truncates.
  return planned <= 1;
}

/**
 * The honest, specific sentence for why the one-shot lane was declined — the report must say WHICH of
 * the two measurements ruled it out, never a single stock line that is now true only half the time
 * (rule 5: fix the system's honesty alongside the code). Pure; returns `null` when the lane is viable.
 */
export function oneShotSkipReason(sb: { plannedFiles?: number; reason?: string } | null | undefined): string | null {
  if (oneShotStillViable(sb)) return null;
  if (typeof sb?.reason === 'string' && sb.reason.includes('timed out')) {
    return 'Skipped the one-shot fast lane: the previous lane had just timed out waiting on the engine, '
      + 'so a single, larger call to the same engine was a worse bet, not an untried one — going straight '
      + 'to the full builder instead of spending another generation call and another two minutes proving it.';
  }
  return `Skipped the one-shot fast lane: the file plan had already found ${sb?.plannedFiles} files, and that `
    + 'lane only fits a single-file app — going straight to the full builder instead of spending a generation '
    + 'call proving it.';
}

/** Whether the OneShot lane is enabled. On by default (the agentic loop is the safety net);
 *  AGENTV3_ONESHOT=off instantly disables it (rollback to pure-loop behavior). */
export function oneShotEnabled(): boolean {
  return process.env.AGENTV3_ONESHOT !== 'off';
}

export interface OneShotFile { path: string; content: string; }

/**
 * Is this block the OUTPUT-FORMAT EXAMPLE copied back, rather than a file?
 *
 * Autopsy eed79815 (2026-09-26): a repair pass answered with the format example from its own prompt —
 * `<<<FILE relative/path.ext>>>` with the body `...content...` — followed by a skeleton of an app nobody
 * asked for (`src/pages/LoginPage.jsx`, `src/styles/globals.css`, …), every body a placeholder. The
 * parser accepted all of it: the JS files were refused later by the syntax gate, but the stylesheets and
 * `relative/path.ext` were written, one stylesheet was wired into `main.tsx`, and the next turn's
 * production build failed on `...content...`. A placeholder is never a file, so it is refused here,
 * where every reader of model file blocks passes.
 *
 * Two tests, either one sufficient:
 *   - the extension is `.ext` — not a real file type, only ever the example's;
 *   - every non-blank line of the body is an ellipsis line (`...content...`, `… rest unchanged …`).
 *     A real file always has at least one line of code; a spread like `...state,` sits among others.
 * An EMPTY body is not treated as a placeholder: an empty file can be legitimate (`.gitkeep`). PURE.
 */
export function isEchoedFormatExample(path: string, content: string): boolean {
  if (/\.ext$/i.test(path.trim())) return true;
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  const ellipsisLine = /^(?:\/\/|\/\*|#|<!--|\{\/\*)?\s*(?:\.{3}|\u2026)[^\n]{0,80}$/;
  return lines.every((l) => ellipsisLine.test(l));
}

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
  //
  // The terminator also accepts `<<<ENDFILE>>` and `<<<ENDFILE>` (autopsy eed79815, 2026-09-26): a model
  // that dropped one `>` left the marker INSIDE the file, and a stylesheet ending in `<<<ENDFILE>>`
  // broke the production build on the next turn.
  const re = /<<<FILE\s+(.+?)>>>\r?\n([\s\S]*?)(?:\r?\n?<<<ENDFILE>{1,3}|(?=\r?\n?<<<FILE\s)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim().replace(/^["'`]|["'`]$/g, '');
    const content = m[2];
    // Reject empty / unsafe paths (no absolute, no traversal).
    if (!path || path.startsWith('/') || path.includes('..') || path.length > 300) continue;
    // Reject the FORMAT EXAMPLE echoed back as if it were a file — see isEchoedFormatExample.
    if (isEchoedFormatExample(path, content)) continue;
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
  // ZOMBIE-WRITE KILL (autopsy a38c6fef, 2026-09-13 — the SIBLING of the StudySync fix that
  // `SimpleBuilder` got in July and this lane did not). `withTimeout` only RACES: losing the race
  // abandons the WAIT, never the WORK. In the real failure this closure kept generating for a further
  // seventeen minutes — through two output-ceiling continuations — and then wrote its fourteen files
  // straight over the app the full builder had finished in the meantime. The debris it left behind
  // (eleven unused components in `src/icons.tsx`) cost 66 readiness points and turned a working,
  // real-browser-verified build RED.
  //
  // `lapsed` flips the instant the race is lost, so the orphan refuses to write even though its own
  // generation succeeded. It is the lane's own conscience; the caller's write fence
  // (`laneWriteFence.ts`) is the architecture that no longer depends on every lane having one.
  let lapsed = false;
  try {
    deps.log?.('Trying a fast one-shot build…');
    // Bound the ENTIRE generate+parse+write phase together (audit P0-B): writeFiles was previously
    // outside the timeout, so a stalled sandbox write hung the lane indefinitely. Now a stall in any
    // of generate / write falls back fast to the agentic loop.
    files = await withTimeout((async () => {
      const text = await deps.generate(oneShotSystemPrompt(deps.framework), oneShotUserPrompt(deps.prompt, deps.scaffoldPaths));
      // Checked BEFORE parsing as well as before writing: a lane that has already been handed off must
      // stop at the first opportunity, not merely stop short of the damage.
      if (lapsed) throw new Error('one-shot-cancelled');
      const parsed = parseFileBlocks(text);
      if (parsed.length < minFiles) throw new Error('no_files_parsed');
      if (lapsed) throw new Error('one-shot-cancelled');
      await deps.writeFiles(parsed);
      return parsed;
    })(), deps.overallTimeoutMs ?? 150_000, 'one-shot');
  } catch (e) {
    lapsed = true; // from this instant the orphaned closure can never touch the workspace
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
      await withTimeout(deps.startPreview(), deps.previewTimeoutMs ?? 90_000, 'one-shot-preview');
    } catch {
      deps.log?.('Preview is still starting — your files are ready; opening the preview will reconnect it.');
    }
  }
  return { ok: true, filesWritten: files.length, summary: `Built your app in one shot — ${files.length} file(s).` };
}
