// CHECKPOINT DIFF — "what changed between then and now", answered from the checkpoints' own git
// history (ROADMAP 8B item B6; the version-history capability Lovable/v0 market that we lacked).
//
// WHY THIS SHAPE. Checkpoints ARE git commits in the sandbox repository, so the truthful diff is
// `git diff` between two shas — never a reconstruction from stored file maps, which would be a second
// source of truth that drifts. It follows versionPreview.ts's architecture exactly: pure command
// builders + a pure parser here (unit-testable), the route supplies an actuator-backed runner.
//
// 🔒 COST RULE, same as the per-version preview: this runs in the sandbox the user ALREADY has warm
// and never boots one. A diff is a convenience; waking a billed VM for it would spend real money on a
// glance. Cold sandbox ⇒ an honest "open the app first", not a boot.
//
// 🔒 NUMSTAT, not the patch. The full patch of two distant checkpoints can be megabytes and is not
// what the History screen needs — the question is "which files, how much". Per-file line counts + an
// honest summary answer it in one bounded round-trip. A file-level patch view can build on this later.

import { WORKSPACE_ROOT, isValidSha } from './versionPreview';

export type CheckpointDiffReason =
  | 'ok'
  | 'sandbox-cold'
  | 'version-not-in-sandbox'
  | 'diff-failed';

export interface DiffFileRow {
  path: string;
  /** Lines added/removed; null for a binary file (git prints "-"). */
  added: number | null;
  removed: number | null;
  /** Present only when git reported a rename ("old => new"). */
  renamedFrom?: string;
}

export interface CheckpointDiffResult {
  ok: boolean;
  reason: CheckpointDiffReason;
  from: string;
  to: string;
  files: DiffFileRow[];
  /** Totals across text files. */
  added: number;
  removed: number;
  /** Plain-language line for the panel — always present, honest on every branch. */
  message: string;
  /** True when the file list was cut at the cap; the summary says so too. */
  truncated: boolean;
}

/** The History panel shows a list, not a repository browser — beyond this the summary carries it. */
export const DIFF_FILES_MAX = 200;

/** Both commits must really be in this sandbox's object store (a re-created sandbox loses history). */
export function shaPairExistsCommand(from: string, to: string): string {
  return `git -C ${WORKSPACE_ROOT} cat-file -e ${from}^{commit} 2>/dev/null && git -C ${WORKSPACE_ROOT} cat-file -e ${to}^{commit} 2>/dev/null && echo HAVE_BOTH`;
}

/**
 * The diff itself. `-M` so a renamed file reads as one rename, not a 400-line delete plus a 400-line
 * add — the difference between "you renamed Header.tsx" and a terrifying red wall. `-z` is NOT used:
 * numstat's tab-separated lines are unambiguous for the paths git itself writes, and the parser below
 * treats the line defensively anyway.
 */
export function diffNumstatCommand(from: string, to: string): string {
  return `git -C ${WORKSPACE_ROOT} diff --numstat -M ${from} ${to}`;
}

/** One `added\tremoved\tpath` line → a row. Exported for the parser tests. */
export function parseNumstatLine(line: string): DiffFileRow | null {
  const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
  if (!m) return null;
  const num = (s: string): number | null => (s === '-' ? null : Number(s));
  let path = m[3];
  let renamedFrom: string | undefined;
  // Rename forms git emits with -M: "old => new" and "dir/{old => new}/file".
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace) {
    renamedFrom = `${brace[1]}${brace[2]}${brace[4]}`.replace(/\/\//g, '/');
    path = `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, '/');
  } else {
    const arrow = /^(.+) => (.+)$/.exec(path);
    if (arrow) {
      renamedFrom = arrow[1];
      path = arrow[2];
    }
  }
  return { path, added: num(m[1]), removed: num(m[2]), ...(renamedFrom ? { renamedFrom } : {}) };
}

export function parseNumstat(stdout: string): DiffFileRow[] {
  return String(stdout ?? '')
    .split('\n')
    .map((l) => parseNumstatLine(l.trim()))
    .filter((r): r is DiffFileRow => r !== null);
}

/** The plain sentence above the file list. Pure, so the wording is test-locked. */
export function diffSummaryMessage(files: DiffFileRow[], truncated: boolean): string {
  if (files.length === 0) return 'These two versions have identical files — nothing changed between them.';
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const binaries = files.filter((f) => f.added === null).length;
  const parts = [
    `${files.length}${truncated ? '+' : ''} file${files.length === 1 ? '' : 's'} changed`,
    `${added} line${added === 1 ? '' : 's'} added`,
    `${removed} removed`,
  ];
  if (binaries > 0) parts.push(`${binaries} binary file${binaries === 1 ? '' : 's'}`);
  return parts.join(' · ') + (truncated ? ` (showing the first ${DIFF_FILES_MAX})` : '');
}

export function checkpointDiffMessage(reason: CheckpointDiffReason): string {
  switch (reason) {
    case 'sandbox-cold':
      return 'Your app is not running right now, so the versions cannot be compared. Open the app (or start a build) and try again.';
    case 'version-not-in-sandbox':
      return 'One of these versions is from an older session whose history is no longer in the current workspace, so it cannot be compared here. Its Restore and Preview may still work.';
    case 'diff-failed':
      return 'Could not compare these two versions this time. Nothing was changed.';
    default:
      return '';
  }
}

export interface CheckpointDiffDeps {
  run: (command: string) => Promise<{ stdout: string }>;
  sandboxWarm: () => Promise<boolean>;
}

/** Compare two checkpoints. Every branch returns an honest result; nothing here writes anything. */
export async function runCheckpointDiff(
  fromRaw: unknown,
  toRaw: unknown,
  deps: CheckpointDiffDeps,
): Promise<CheckpointDiffResult> {
  const fail = (reason: CheckpointDiffReason): CheckpointDiffResult => ({
    ok: false, reason, from: String(fromRaw ?? ''), to: String(toRaw ?? ''),
    files: [], added: 0, removed: 0, truncated: false, message: checkpointDiffMessage(reason),
  });
  if (!isValidSha(fromRaw) || !isValidSha(toRaw)) return fail('diff-failed');
  const from = fromRaw;
  const to = toRaw;
  if (!(await deps.sandboxWarm().catch(() => false))) return fail('sandbox-cold');

  const have = await deps.run(shaPairExistsCommand(from, to)).then((r) => r.stdout).catch(() => '');
  if (!/HAVE_BOTH/.test(have)) return fail('version-not-in-sandbox');

  let stdout: string;
  try {
    stdout = (await deps.run(diffNumstatCommand(from, to))).stdout;
  } catch {
    return fail('diff-failed');
  }
  const all = parseNumstat(stdout);
  const truncated = all.length > DIFF_FILES_MAX;
  const files = truncated ? all.slice(0, DIFF_FILES_MAX) : all;
  return {
    ok: true,
    reason: 'ok',
    from,
    to,
    files,
    added: files.reduce((n, f) => n + (f.added ?? 0), 0),
    removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
    truncated,
    message: diffSummaryMessage(files, truncated),
  };
}
