/**
 * WRITE-TIME TYPECHECK — the compiler answers after EVERY file, not after twenty (admin 2026-09-17:
 * "incremental typecheck wala PR bana do", from autopsy e706e068).
 *
 * 🔴 THE STRUGGLE THIS KILLS. The School ERP build wrote 20 files before its first `tsc` ran, 12 minutes
 * in. That run returned 21 errors from the cheap rung's own output — a missing `useEffect` import, a
 * `Notification` type with the wrong fields, a `Calendar` page shadowing its own icon import — and the
 * build then spent SEVEN minutes grinding them: six more `tsc` runs, an endgame batch repair, a
 * "repeated step is not making progress" nudge, read → edit → tsc, one file at a time. Every one of
 * those errors was visible the moment its file was written. Nothing looked.
 *
 * THE RULE: write → typecheck → next. After a TypeScript file is written or edited, the dispatcher runs
 * the same incremental `tsc --noEmit` the endgame and the `typecheck` tool already use (one shared
 * `.tsbuildinfo` cache, so a run after the first costs well under a second) and appends the errors IN
 * THAT FILE to the tool result. The model is still holding the file; its intent is exactly there; the
 * fix lands in the same turn instead of twelve minutes later as an entry on a 21-line list. Errors
 * elsewhere are counted and named briefly, never dumped — the dump is what made the endgame's list
 * unreadable in the first place.
 *
 * 🔒 IT NEVER BLOCKS A WRITE, NEVER FAILS A BUILD, AND NEVER LIES. A check that could not run says
 * nothing (a missing compiler, a JS project, a timeout) — "we did not look" must not read as "clean".
 * Two consecutive timeouts switch it off for the rest of the build, because a project whose incremental
 * check takes over thirty seconds is one where this costs more than it saves. Every run is reported
 * through the same `onCommand` bridge the `typecheck` tool uses, so the release gate's typecheck
 * evidence sees these runs too (autopsy e4ebcb5f). Kill switch: `AGENTV3_WRITE_TYPECHECK=off`.
 *
 * Runs are COALESCED per build: parallel writers (write_files_batch, sub-agents) never stack ten
 * compiles — one runs, everyone waiting shares the next one. PURE core; the dispatcher supplies the
 * sandbox I/O.
 */
import { robustTscCommand } from './tscCommand';
import type { TscError } from './EndgameRepair';
import { tscErrorCauses, tscCauseNote } from './tscErrorCause';

/** The ONE cache every in-build typecheck shares (endgame, `typecheck` tool, this). Ephemeral, never durable. */
export const WRITE_TYPECHECK_TSBUILDINFO = '/tmp/agentv3.tsbuildinfo';
/** A single incremental run may take this long before it is abandoned. */
export const WRITE_TYPECHECK_TIMEOUT_MS = 30_000;
/** Consecutive timeouts after which the check stands down for the rest of the build. */
export const MAX_WRITE_TYPECHECK_TIMEOUTS = 2;
/** How many of the written file's own errors are quoted in full. */
export const MAX_OWN_ERRORS_QUOTED = 10;
/** How many errors elsewhere are named (file:line only) before "…and N more". */
export const MAX_OTHER_ERRORS_NAMED = 3;

/** Default ON. `off` restores the pre-change behaviour exactly: the first typecheck is whenever the model runs one. */
export function writeTypecheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_WRITE_TYPECHECK ?? '').trim().toLowerCase() !== 'off';
}

/** TypeScript SOURCE only. A `.d.ts` is types, not code; JS is not the compiler's to judge. */
export function shouldTypecheckWrite(path: string): boolean {
  const p = String(path ?? '');
  return /\.tsx?$/i.test(p) && !/\.d\.ts$/i.test(p);
}

/** The command — the robust local binary, incremental, on the shared cache. Pure. */
export function writeTypecheckCommand(): string {
  return robustTscCommand(`--noEmit --incremental --tsBuildInfoFile ${WRITE_TYPECHECK_TSBUILDINFO}`, '2>&1 | head -120');
}

function normalizePath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Errors in the files just written, and the rest. Pure. */
export function splitByWrittenFiles(errors: TscError[], written: string[]): { own: TscError[]; others: TscError[] } {
  const set = new Set(written.map(normalizePath));
  const own: TscError[] = [];
  const others: TscError[] = [];
  for (const e of errors || []) (set.has(normalizePath(e.file)) ? own : others).push(e);
  return { own, others };
}

const fmt = (e: TscError) => `${e.file}(${e.line},${e.col}): ${e.code} ${e.message}`;

/**
 * The note appended to the write's tool result — '' when the tree is clean.
 *
 * The written file's errors are quoted in full (they are the ones the model can fix while it still
 * holds the file); errors elsewhere are counted and a few named, so an old problem never floods the
 * result of an unrelated write. Plain instructions, in the order the model should act. Pure.
 */
export function writeTypecheckNote(
  errors: TscError[],
  written: string[],
  sources: Readonly<Record<string, string>> = {},
): string {
  const { own, others } = splitByWrittenFiles(errors, written);
  if (own.length === 0 && others.length === 0) return '';
  const files = written.map(normalizePath).join(', ');
  const parts: string[] = [];
  if (own.length > 0) {
    const quoted = own.slice(0, MAX_OWN_ERRORS_QUOTED).map(fmt);
    const more = own.length > MAX_OWN_ERRORS_QUOTED ? `\n…and ${own.length - MAX_OWN_ERRORS_QUOTED} more in the same file(s).` : '';
    parts.push(
      `⛔ TYPECHECK after this write: ${own.length} error(s) in ${files} — fix them NOW, in this turn, before writing the next file `
      + `(the production build fails until they are gone):\n${quoted.join('\n')}${more}`,
    );
  }
  if (others.length > 0) {
    const named = others.slice(0, MAX_OTHER_ERRORS_NAMED).map((e) => `${e.file}:${e.line} ${e.code}`).join(', ');
    const more = others.length > MAX_OTHER_ERRORS_NAMED ? `, …and ${others.length - MAX_OTHER_ERRORS_NAMED} more` : '';
    parts.push(
      own.length === 0
        ? `ℹ️ TYPECHECK after this write: ${files} is clean, but ${others.length} error(s) remain elsewhere (${named}${more}). They fail the production build — fix them before you finish.`
        : `Also ${others.length} error(s) elsewhere (${named}${more}).`,
    );
  }
  // WHAT THE ERROR MEANS, not just what it says (autopsy baa0b3c7). A missing-declaration error points
  // at the file where the symbol is USED, so its remedy appears nowhere in the message and the code under
  // the cursor looks broken — which is how a correct file gets rewritten six times. Diagnosed here, at the
  // earliest moment there is anything to diagnose, and costing no model call. Empty for every other error.
  return `\n\n${parts.join('\n')}${tscCauseNote(tscErrorCauses([...own, ...others], sources))}`;
}

/**
 * ONE compile at a time per build, and everyone who arrives during it shares the NEXT one.
 *
 * `write_files_batch` writes in parallel and sub-agents write concurrently; without this a burst of
 * ten writes would queue ten compiles of the same tree. With it, a burst costs at most two — the one
 * already running (whose result is stale for the new writes) and one more that covers all of them.
 */
export class WriteTypecheckQueue<R> {
  private inFlight: Promise<R> | null = null;
  private pending: Promise<R> | null = null;

  run(exec: () => Promise<R>): Promise<R> {
    if (!this.inFlight) {
      this.inFlight = exec().finally(() => { this.inFlight = null; });
      return this.inFlight;
    }
    if (!this.pending) {
      const current = this.inFlight;
      this.pending = current.catch(() => undefined as unknown as R).then(() => {
        this.pending = null;
        return this.run(exec);
      });
    }
    return this.pending;
  }
}

export interface WriteTypecheckStats {
  /** Compiles actually run at write time. */
  runs: number;
  /** Runs that found no error anywhere. */
  cleanRuns: number;
  /** Errors quoted back to the model in the written file(s), summed over runs. */
  ownErrorsSurfaced: number;
  /** Sandbox time spent, in total. */
  elapsedMs: number;
  timeouts: number;
  /** Writes of TS files that were NOT checked, and why the check stood down (if it did). */
  skipped: number;
  disabledReason: string | null;
}

export function emptyWriteTypecheckStats(): WriteTypecheckStats {
  return { runs: 0, cleanRuns: 0, ownErrorsSurfaced: 0, elapsedMs: 0, timeouts: 0, skipped: 0, disabledReason: null };
}

/** The admin-only report line. Says plainly when the check never ran and why. Pure. */
export function writeTypecheckSummary(s: WriteTypecheckStats, enabled: boolean): string {
  if (!enabled) return 'Write-time typecheck: OFF (AGENTV3_WRITE_TYPECHECK=off) — the first compile is whenever the model asks for one.';
  if (s.runs === 0) {
    return s.disabledReason
      ? `Write-time typecheck: never ran — ${s.disabledReason}.`
      : `Write-time typecheck: no TypeScript source was written this build (${s.skipped} write(s) skipped as not TypeScript).`;
  }
  const avg = Math.round(s.elapsedMs / s.runs / 100) / 10;
  return `Write-time typecheck: ${s.runs} run(s), ${s.cleanRuns} clean, ${s.ownErrorsSurfaced} error(s) quoted back in the file just written, `
    + `${Math.round(s.elapsedMs / 1000)}s total (~${avg}s each)`
    + (s.timeouts ? `, ${s.timeouts} timeout(s)` : '')
    + (s.disabledReason ? ` — then stood down: ${s.disabledReason}` : '')
    + '.';
}
