// AgentV3 — a platform write says WHICH files it wrote (build report 9c612cdb, Q-982).
//
// 🔴 WHAT HAPPENED. The fast lane writes through the model's own write door (`write_file`), one dispatch per
// file. `ToolDispatcher.dispatch` catches every failure and hands it back as `{ is_error: true }` — a guard
// refusal, a sandbox that could not read the file it was about to replace, a parse guard — and the lane's
// writer threw that answer away. So `writeFiles` RESOLVED whether or not a file reached the workspace, and
// everything downstream read "resolved" as "written": the hand-off's `salvagedPaths`, the `filesWritten`
// counts, the SIMPLE_BUILD_SALVAGE line, and the CONTINUE prompt's list of files the next builder is told are
// "in the workspace now". The redundant second write of the same files after a hand-off was, by accident, the
// only retry a failed early save ever got — which is why the double write could not simply be removed.
//
// 🔑 THE CLASS: a platform write whose per-file outcome is discarded, after which the file is counted, named or
// recorded as written. The fix is structural: every platform write returns one outcome per file, and a writer
// that reports nothing (a test double, an old caller) is read as "unknown" — today's assumption, never a new
// failure. Reading an outcome is additive: nothing here throws where nothing threw before.
//
// `readWriteOutcomes` is PURE. `writePlatformFiles` is the one place a platform `write_file` is dispatched.
import { runAsUnreadWrites } from './unreadWrites';
import { mapWithConcurrency } from './asyncUtils';

/** One file's result from a workspace write. `ok` is false when the workspace refused or failed it. */
export interface WriteOutcome {
  path: string;
  ok: boolean;
  /** The workspace's own words when it refused (first line, capped) — evidence for the report. */
  error?: string;
}

/** A write's answer, read back against the files it was given. */
export interface ReadOutcomes<F extends { path: string }> {
  /** The writer reported, per file, what happened. False for a writer that returns nothing. */
  known: boolean;
  /** The files now in the workspace — every file when the outcome is unknown (today's assumption). */
  landed: F[];
  /** The files the writer reported as NOT written, with its reason when it gave one. */
  failed: Array<{ path: string; error?: string }>;
}

/**
 * Read what a write reported about `files`. PURE.
 *
 * A writer that returned nothing (or anything that is not a list) is UNKNOWN, and every file is assumed
 * written — exactly what every caller assumed before outcomes existed, so a void writer changes nothing. A
 * list that is silent about a file does not confirm it: an outcome is evidence, and silence is not.
 */
export function readWriteOutcomes<F extends { path: string }>(
  files: readonly F[],
  outcomes: readonly WriteOutcome[] | void | null | undefined,
): ReadOutcomes<F> {
  if (!Array.isArray(outcomes)) return { known: false, landed: [...files], failed: [] };
  const byPath = new Map<string, WriteOutcome>();
  for (const o of outcomes) if (o && typeof o.path === 'string') byPath.set(o.path, o);
  const landed: F[] = [];
  const failed: Array<{ path: string; error?: string }> = [];
  for (const f of files) {
    const o = byPath.get(f.path);
    if (o?.ok === true) landed.push(f);
    else failed.push({ path: f.path, ...(o?.error ? { error: o.error } : o ? {} : { error: 'the writer reported nothing for this file' }) });
  }
  return { known: true, landed, failed };
}

/** The part of a tool dispatcher a platform write needs — a function, so it is testable without one. */
export type DispatchWrite = (call: { id: string; name: string; input: Record<string, unknown> }) => Promise<{ is_error?: boolean; content?: unknown } | null | undefined>;

/** The workspace's refusal, short enough for a report line. */
function refusalText(result: { content?: unknown } | null | undefined): string {
  const text = typeof result?.content === 'string' ? result.content : '';
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  return (first.trim() || 'the write failed without a reason').slice(0, 240);
}

/**
 * Write `files` as the PLATFORM through the model's write door — every guard of that door still applies, and
 * no steering note is composed for a writer that reads none (`runAsUnreadWrites`, autopsy db07e0af) — and
 * return each file's outcome. `ok` is true only when the dispatch says `is_error: false`.
 *
 * Order-preserving; `concurrency` 1 writes one file at a time, as the post-build passes always did. A throw
 * out of the dispatcher still propagates exactly as it did before (the dispatcher catches its own failures,
 * so in practice it never throws); only the answer that used to be dropped is now returned.
 */
export async function writePlatformFiles(
  dispatch: DispatchWrite,
  files: ReadonlyArray<{ path: string; content: string }>,
  opts: { idPrefix: string; concurrency?: number },
): Promise<WriteOutcome[]> {
  return mapWithConcurrency([...files], opts.concurrency ?? 1, async (f, i) => {
    const result = await runAsUnreadWrites(() => dispatch({ id: `${opts.idPrefix}${i}`, name: 'write_file', input: { path: f.path, content: f.content } }));
    return result && result.is_error === false
      ? { path: f.path, ok: true }
      : { path: f.path, ok: false, error: refusalText(result) };
  });
}
