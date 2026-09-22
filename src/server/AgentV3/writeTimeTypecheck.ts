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
 *
 * ⚠️ IT WATCHES ONE LANE, AND THE REPORT MUST SAY SO. Every call site is in `ToolDispatcher`, so the
 * check sees the ARCHITECT's writes (its own and its sub-agents'). The FAST LANE writes through
 * `deps.writeFiles` and verifies once with a `tsc` of its own — by design, since its files are
 * generated concurrently and a per-file compile would report errors from files not yet written. So a
 * fast-lane build leaves these counters untouched, which is correct; what was NOT correct is that the
 * summary read that silence as "no TypeScript source was written this build". See
 * `writeTypecheckUntouched` and `writeTypecheckSummary`'s third argument.
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
  /**
   * 🔴 THE TWO REASONS A WRITE IS SKIPPED ARE DIFFERENT FACTS, AND MERGING THEM PRINTED A FALSE
   * SENTENCE (autopsy bb688add, 2026-09-20).
   *
   * That build wrote `src/types/invitation.ts`, `src/data/invitation.ts`, `src/hooks/useInvitation.ts`,
   * `src/components/Invitation.tsx`, `src/App.tsx` and `src/main.tsx` — and its report read
   * *"no TypeScript source was written this build (22 write(s) skipped as not TypeScript)"*. Six
   * TypeScript files is not none. The counter could not tell "this write was a `.css` file" from
   * "we judged the project non-TypeScript", so the summary asserted the first about a build where
   * the second had happened — and the reader is sent looking for a project that has no TypeScript
   * in it, which is the one thing that was certainly not true.
   *
   * The cost was not the sentence. It was that the check which exists to catch exactly that build's
   * eleven `TS2339` errors AT WRITE TIME stood down, and the build ground them through three repair
   * passes over five minutes instead.
   */
  skippedNotTs: number;
  /** Writes of REAL TypeScript that were skipped because the project was judged non-TypeScript. */
  skippedNoTsconfig: number;
  /**
   * How many times the `tsconfig.json` probe THREW rather than answering.
   *
   * Recorded because a throw and a genuine absence are different facts (`probeFailures > 0` with
   * `skippedNoTsconfig > 0` is the shape of a check that disabled itself on a read error), and
   * because this report is the only place that distinction can ever be seen.
   */
  probeFailures: number;
  disabledReason: string | null;
}

export function emptyWriteTypecheckStats(): WriteTypecheckStats {
  return {
    runs: 0, cleanRuns: 0, ownErrorsSurfaced: 0, elapsedMs: 0, timeouts: 0,
    skipped: 0, skippedNotTs: 0, skippedNoTsconfig: 0, probeFailures: 0, disabledReason: null,
  };
}

/**
 * How many times a FAILED `tsconfig.json` probe is retried before the project is accepted as non-TS.
 *
 * 🔑 A PROBE THAT THREW IS NOT AN ANSWER. The old code latched `_isTsProject = false` inside the
 * `catch`, so ONE unreadable read — a sandbox hiccup, a timeout, a file written a moment later —
 * switched the check off for the whole build, silently and permanently. That is this repo's oldest
 * class, applied to a compiler: *"we could not look"* recorded as *"there is nothing there"*.
 *
 * Three is deliberate rather than infinite: a project that genuinely has no `tsconfig.json` must not
 * pay a failed read on every single write for the rest of the build.
 */
export const MAX_TSCONFIG_PROBES = 3;

/** The three answers a `tsconfig.json` probe can give. `unknown` is the one the old code could not express. */
export type TsProjectVerdict = 'yes' | 'no' | 'unknown';

/**
 * Should the probe be attempted (again)?
 *
 * `unknown` means a previous attempt threw: retry while attempts remain, then accept 'no' so a real
 * JS project is not re-probed for ever. Pure.
 */
export function shouldProbeTsconfig(verdict: TsProjectVerdict, attempts: number): boolean {
  if (verdict === 'yes' || verdict === 'no') return false;
  return attempts < MAX_TSCONFIG_PROBES;
}

/**
 * Did this read fail because the file is genuinely ABSENT, rather than because we could not look?
 *
 * ⚠️ PRECISION-FIRST, AND THE ASYMMETRY IS THE WHOLE POINT. A false "absent" is the bug this autopsy
 * is about — it switches the compiler off for the rest of the build. A false "could not look" costs
 * at most `MAX_TSCONFIG_PROBES - 1` extra file reads on a project that really has no TypeScript in
 * it. So only the unmistakable not-found shapes count, and every other failure (a timeout, a dead
 * sandbox, a network error, an empty message) stays unknown and is retried. Pure.
 */
export function isMissingFileError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return false;
  const m = msg.toLowerCase();
  // A DEAD SANDBOX CAN SAY "no such file or directory" ABOUT THE WHOLE WORKSPACE — this repo records
  // exactly that string (`[not_found] lstat /home/user/workspace: no such file or directory`). That is
  // not a missing tsconfig, it is a missing machine, and treating it as an answer would be the same
  // mistake one level up. A message naming the workspace root is never a verdict about one file.
  if (m.includes('/home/user/workspace:') || m.includes('workspace: no such file')) return false;
  return m.includes('enoent') || m.includes('no such file') || m.includes('not_found') || m.includes('not found');
}

/** After `MAX_TSCONFIG_PROBES` failed reads, an unknown is finally treated as "not a TypeScript project". Pure. */
export function tsProjectSettled(verdict: TsProjectVerdict, attempts: number): boolean {
  return verdict !== 'unknown' || attempts >= MAX_TSCONFIG_PROBES;
}

/**
 * Was this stats object NEVER TOUCHED — i.e. not one write of any kind reached the check?
 *
 * 🔴 THE DISTINCTION THIS EXISTS FOR, and it is this module's own rule applied to itself: *"we did
 * not look"* is not *"there is nothing there"*. Every counter at zero means no write was ever
 * offered to the check — which is a fact about the CHECK's reach, never a fact about the BUILD's
 * files. Reporting it as "no TypeScript source was written" states the second from the first.
 *
 * ⚠️ `runs === 0` alone is NOT this. A build that skipped twenty `.css` writes has runs at zero and
 * was genuinely consulted; it has something true to say. Pure.
 */
export function writeTypecheckUntouched(s: WriteTypecheckStats): boolean {
  return s.runs === 0 && s.skipped === 0 && s.skippedNotTs === 0
    && s.skippedNoTsconfig === 0 && s.probeFailures === 0 && s.disabledReason === null;
}

/**
 * The admin-only report line. Says plainly when the check never ran and why. Pure.
 *
 * 🔴 `tsFilesWritten` IS THE EVIDENCE, AND WITHOUT IT THIS LINE COULD ONLY GUESS (autopsy 2026-09-22).
 *
 * The check's four call sites all live in `ToolDispatcher`, so it observes ONE lane: the architect's
 * tools. The FAST LANE writes through `deps.writeFiles` and verifies once with a `tsc` of its own —
 * so on every successful fast-lane build this stats object stays untouched, and the report read
 * *"no TypeScript source was written this build (0 write(s) skipped as not TypeScript)"* about a
 * build that had just written a whole app. Both counters zero was already named as the tell in
 * `sharedWriteTypecheckStats` when sub-agents produced the same all-zero state (autopsy 3ce8459b);
 * that instance was fixed by sharing the object and **the fast-lane sibling was never hunted** —
 * this repo's headline class, and the third time this one sentence has been wrong.
 *
 * So the caller passes the build's OWN count of model-authored TypeScript files (from `writtenFiles`,
 * the one set every writer feeds). With it, "no TypeScript source was written" is said only when a
 * real count says so; without it the line says what it actually knows and no more. `null` means the
 * count was not supplied — never zero, because a missing measurement is not a measurement of zero.
 */
export function writeTypecheckSummary(s: WriteTypecheckStats, enabled: boolean, tsFilesWritten: number | null = null): string {
  if (!enabled) return 'Write-time typecheck: OFF (AGENTV3_WRITE_TYPECHECK=off) — the first compile is whenever the model asks for one.';
  if (s.runs === 0) {
    if (s.disabledReason) return `Write-time typecheck: never ran — ${s.disabledReason}.`;
    // A lane that does not write through the build's tools is the commonest reason this check sees
    // nothing, and it is the one the old wording asserted the opposite of.
    const elsewhere = typeof tsFilesWritten === 'number' && tsFilesWritten > 0
      ? `${tsFilesWritten} TypeScript file(s) written by a lane that does not write through the build's tools `
        + `(the fast lane writes its whole file list at once and runs a single typecheck of its own) — nothing here says whether THAT check passed`
      : '';
    if (writeTypecheckUntouched(s)) {
      if (elsewhere) return `Write-time typecheck: never ran — not one write reached it, and ${elsewhere}.`;
      if (tsFilesWritten === 0) return 'Write-time typecheck: no TypeScript source was written this build.';
      return 'Write-time typecheck: never ran — not one write reached it. Whether another lane wrote TypeScript is not recorded here.';
    }
    // THE SKIPPED WRITES ARE REPORTED BY REASON, because the reasons mean opposite things to whoever
    // reads this next. TypeScript that was written and not checked is a DEFECT in this check; a build
    // of `.css` and `.html` files is this check correctly having nothing to do.
    if (s.skippedNoTsconfig > 0) {
      const why = s.probeFailures > 0
        ? `the tsconfig.json probe could not be read (${s.probeFailures} failed attempt(s))`
        : 'no tsconfig.json was found';
      return `Write-time typecheck: never ran although ${s.skippedNoTsconfig} TypeScript write(s) happened — ${why}, so the project was treated as non-TypeScript.`;
    }
    const seen = `${s.skippedNotTs || s.skipped} write(s) skipped as not TypeScript`;
    // ⚠️ THE SAME CORRECTION APPLIES HERE, not only to the untouched case: the check can be consulted
    // about a handful of `.css` writes while ANOTHER lane writes the TypeScript. Saying "none was
    // written" would then be false for exactly the same reason, one branch along.
    if (elsewhere) return `Write-time typecheck: never ran — the writes it saw were not TypeScript (${seen}), and ${elsewhere}.`;
    return `Write-time typecheck: no TypeScript source was written this build (${seen}).`;
  }
  const avg = Math.round(s.elapsedMs / s.runs / 100) / 10;
  return `Write-time typecheck: ${s.runs} run(s), ${s.cleanRuns} clean, ${s.ownErrorsSurfaced} error(s) quoted back in the file just written, `
    + `${Math.round(s.elapsedMs / 1000)}s total (~${avg}s each)`
    + (s.timeouts ? `, ${s.timeouts} timeout(s)` : '')
    + (s.disabledReason ? ` — then stood down: ${s.disabledReason}` : '')
    + '.';
}
