// AgentV3 — TRUNCATION RECOVERY (Connectly autopsy 2026-07-21).
//
// ROOT CAUSE it closes: a cheap model (kimi/GLM) writing a file as a `<<<FILE path>>>…` TEXT block
// (not a write_file TOOL call) hit its output-token ceiling (kimi stopped at 8000 tokens mid
// `<<<FILE src/index.css>>>`). The main agentic loop only writes files from TOOL calls — a file emitted
// as assistant TEXT is treated as narration and NEVER written. So the truncated `index.css` was lost
// entirely: `main.tsx` imported it, the preview stubbed the missing file, and the site shipped unstyled.
//
// The existing truncation guard only re-checked JS/TS files written via write_file/write_files_batch
// (esbuild parse) — it could not see a file the model tried to write as TEXT, and it skipped non-JS files
// like CSS/JSON that esbuild cannot parse. This module adds the deterministic, PURE decision that names
// those lost/partial files so the very next turn rewrites them with the tool.

import { parseFileBlocks } from './OneShotBuilder';
import type { SyntaxErrorInfo } from './SyntaxCheck';
import { PARTIAL_CONTENT_KEY, resumeTruncatedEnabled } from './reliability/resumeWrite';

/**
 * The file paths a TRUNCATED turn tried to emit as `<<<FILE …>>>` TEXT markers. These never became
 * write_file tool calls (the turn was cut off), so the main loop never wrote them — they are missing or
 * partial and MUST be rewritten. Pure; safe on any/empty text. Applies the same path-safety filter as
 * parseFileBlocks (no absolute paths, no traversal).
 */
export function textMarkerFilePaths(turnText: string | undefined | null): string[] {
  if (!turnText || !turnText.includes('<<<FILE')) return [];
  return parseFileBlocks(turnText).map((f) => f.path);
}

/** The part of a turn this module reads — a subset of TurnResult, so the predicates stay pure. */
export interface TruncatableTurn {
  text?: string;
  toolUses?: ReadonlyArray<{ name: string; input: unknown }>;
  truncated?: boolean;
  stopReason?: string | null;
}

/**
 * What a CUT-OFF turn produced, sorted into what was kept and what was THROWN AWAY. PURE.
 *
 * - `written` — files a write_file / write_files_batch call carried whole; the loop writes them.
 * - `truncatedToolPaths` — a write sliced mid-`content` at the token limit: the adapter salvaged the path
 *   but there is no content, so nothing was written. When resuming is on and the partial was buffered,
 *   it is NOT lost (append_file carries on from it), so it is not listed.
 * - `textMarkerPaths` — files emitted as `<<<FILE …>>>` TEXT, which the main loop never writes.
 *
 * ONE implementation, read by the truncation guard (which asks for the lost files again) AND by the bill
 * (Q-166 — the output of a turn whose cut-off part was thrown away is not billed), so what the user is
 * told was lost and what they are not charged for can never disagree.
 */
export function lostTruncatedOutput(turn: TruncatableTurn, resumeEnabled: boolean): {
  written: Record<string, string>;
  truncatedToolPaths: string[];
  textMarkerPaths: string[];
} {
  const written: Record<string, string> = {};
  const truncatedToolPaths: string[] = [];
  for (const tu of turn.toolUses ?? []) {
    // Cover write_file AND write_files_batch — a batch write is just as truncatable.
    if (tu.name === 'write_file') {
      const inp = tu.input as { path?: unknown; content?: unknown } | null | undefined;
      if (typeof inp?.path === 'string' && typeof inp?.content === 'string') written[inp.path] = inp.content;
      // P2b — a buffered cut-off write is resumed with append_file, so it is not lost.
      else if (typeof inp?.path === 'string' && inp?.content === undefined && !(resumeEnabled && typeof (tu.input as Record<string, unknown>)?.[PARTIAL_CONTENT_KEY] === 'string')) truncatedToolPaths.push(inp.path);
    } else if (tu.name === 'write_files_batch') {
      const b = tu.input as { files?: unknown } | null | undefined;
      if (Array.isArray(b?.files)) {
        for (const f of b.files) {
          const ff = f as { path?: unknown; content?: unknown };
          if (typeof ff?.path === 'string' && typeof ff?.content === 'string') written[ff.path] = ff.content;
          else if (typeof ff?.path === 'string' && ff?.content === undefined) truncatedToolPaths.push(ff.path);
        }
      }
    }
  }
  // A path also written whole is not lost.
  const writtenPaths = new Set(Object.keys(written));
  return {
    written,
    truncatedToolPaths: truncatedToolPaths.filter((p) => !writtenPaths.has(p)),
    textMarkerPaths: textMarkerFilePaths(turn.text).filter((p) => !writtenPaths.has(p)),
  };
}

/**
 * Did this turn end at the output limit AND have its cut-off part thrown away? PURE.
 *
 * True only when the platform DISCARDED something — a write with no content, or a text-marker file. A
 * cut-off write that was written (and may be repaired) or buffered for resuming is not discarded. Its
 * OUTPUT is then left out of the user's bill (Q-166, admin 2026-10-11): the whole turn's output, because a
 * provider reports one output count per call and any split of it by characters would be a guess.
 */
export function turnDiscardedTruncatedOutput(turn: TruncatableTurn | null | undefined, resumeEnabled: boolean = resumeTruncatedEnabled()): boolean {
  if (!turn || !(turn.truncated || turn.stopReason === 'max_tokens')) return false;
  const lost = lostTruncatedOutput(turn, resumeEnabled);
  return lost.truncatedToolPaths.length + lost.textMarkerPaths.length > 0;
}

/**
 * Build the model-facing steer for a truncated turn, or null when there is nothing to recover. Two
 * independent sources of a lost/broken file after a max-token cut-off:
 *   • `brokenJs`   — JS/TS files it wrote via a tool call that no longer PARSE (existing esbuild check).
 *   • `textMarkerPaths` — files it tried to write as `<<<FILE>>>` TEXT (never written by the main loop).
 * Deduplicates, bounds the list, and always tells the model to keep the next response small. Pure +
 * unit-testable — the esbuild parses and the text-marker parse are injected as already-computed inputs.
 */
export function truncationRecoverySteer(input: {
  brokenJs?: readonly SyntaxErrorInfo[];
  textMarkerPaths?: readonly string[];
  /** Files whose write_file TOOL CALL was cut off mid-arguments — the path survived (salvaged) but the
   *  `content` did not, so nothing was written. The bare "Unterminated string in JSON" case, now named. */
  truncatedToolPaths?: readonly string[];
  /**
   * Paths this guard has ALREADY steered a rewrite of, earlier in the same run.
   *
   * 🔴 THE REPORT (cc8c9075, 2026-09-17). `src/App.tsx` was cut off mid-`content` at **exactly 9,833
   * output tokens** — the whole authorised ceiling. The guard told the model to *"rewrite the file
   * COMPLETELY … write ONE file per response if a file is large"*. It WAS already writing one file,
   * and that one file does not fit in 9,833 tokens. So the guard asked for the identical thing at the
   * identical bound, got the identical failure, and did it again: **two calls, 158 seconds each, 5.3
   * minutes of a 13-minute build, both ending in the same "Missing/invalid string argument: content".**
   * The user stopped the build.
   *
   * 🔒 A REPEAT IS NOT THE SAME EVENT AS A FIRST TRY. Advice that failed once at a fixed ceiling
   * cannot succeed on a second identical attempt — the only strategy that fits under that ceiling is
   * a SMALLER file now and the rest afterwards. So the second steer says that instead.
   */
  previouslyTruncatedPaths?: readonly string[];
}): string | null {
  const brokenJs = input.brokenJs ?? [];
  const textMarkerPaths = input.textMarkerPaths ?? [];
  const truncatedToolPaths = input.truncatedToolPaths ?? [];
  const seenBefore = new Set(input.previouslyTruncatedPaths ?? []);
  const brokenSet = new Set(brokenJs.map((b) => b.path));
  // A file that BOTH failed to parse and was in the text markers is listed once, under "broken".
  const lostOnly = textMarkerPaths.filter((p) => !brokenSet.has(p));
  // A salvaged truncated tool write already covered by a broken/text entry is not repeated.
  const textSet = new Set(textMarkerPaths);
  const truncatedOnly = truncatedToolPaths.filter((p) => !brokenSet.has(p) && !textSet.has(p));
  if (brokenJs.length === 0 && lostOnly.length === 0 && truncatedOnly.length === 0) return null;

  const lines: string[] = [];
  const repeats: string[] = [];
  // `path` is the repeat KEY; `label` is what the model reads (it may carry a line number). Keeping
  // them separate preserves the existing "src/App.tsx:42" wording that the suite pins.
  const note = (path: string, why: string, label = path) => {
    if (seenBefore.has(path)) { repeats.push(path); lines.push(`- ${label} — ${why}, for the SECOND time`); }
    else lines.push(`- ${label} — ${why}`);
  };
  for (const b of brokenJs.slice(0, 15)) {
    note(b.path, `${b.message} (written, but does NOT parse)`, `${b.path}${b.line ? `:${b.line}` : ''}`);
  }
  for (const p of lostOnly.slice(0, 15)) {
    note(p, 'you wrote this as TEXT, not with the write_file tool, so it was NOT saved');
  }
  for (const p of truncatedOnly.slice(0, 15)) {
    note(p, 'your write_file call was cut off mid-content, so it was NOT saved');
  }

  // 🔑 THE SECOND ATTEMPT GETS DIFFERENT ADVICE, because repeating the first is a guaranteed loop.
  // "Write one file per response" is already satisfied when the ONE file is itself over the ceiling.
  if (repeats.length > 0) {
    return `[TRUNCATION GUARD — SECOND CUT-OFF] Your response hit the max-token limit AGAIN on the same ` +
      `file(s):\n${lines.join('\n')}\n\nRewriting ${repeats.length === 1 ? 'it' : 'them'} whole does NOT ` +
      `fit in one response — that has now failed twice at the same limit, so do NOT try it a third time. ` +
      `Instead: write a SMALLER but WORKING first version of ${repeats.join(', ')} now — the main screen ` +
      `only, no extra sections, no long data arrays — and save it with write_file. Then ADD the rest in ` +
      `later responses with edit_file, a few sections at a time. A small file that runs beats a large ` +
      `one that is never saved.`;
  }

  return `[TRUNCATION GUARD] Your previous response hit the max-token limit, so the following file(s) are ` +
    `missing or broken:\n${lines.join('\n')}\n\nRewrite each listed file COMPLETELY using the write_file ` +
    `tool (never emit file contents as plain text) before doing anything else. Keep each response small ` +
    `enough not to hit the token limit again — write ONE file per response if a file is large.`;
}

/** Every path a steer names, so the caller can remember them for the next turn's repeat check. Pure. */
export function truncationSteeredPaths(input: {
  brokenJs?: readonly SyntaxErrorInfo[];
  textMarkerPaths?: readonly string[];
  truncatedToolPaths?: readonly string[];
}): string[] {
  return [
    ...(input.brokenJs ?? []).map((b) => b.path),
    ...(input.textMarkerPaths ?? []),
    ...(input.truncatedToolPaths ?? []),
  ];
}

/**
 * A short human narration for the timeline when a truncated turn is being recovered. Pure.
 */
export function truncationRecoveryNarration(brokenCount: number, lostCount: number): string {
  const total = brokenCount + lostCount;
  return `⚠️ The last response was cut off at the token limit and ${total} file(s) are missing or broken — rewriting them before moving on.`;
}
