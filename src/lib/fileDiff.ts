/**
 * FILE DIFF + REVERT — the shared engine behind "what did the AI change, and put that bit back".
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * The Diff view could already SHOW every change a build made (side-by-side or unified, with merge
 * conflict resolution). What it could not do was undo one. The user could see that the AI had
 * rewritten a function they liked and had exactly two options: keep it, or restore the entire
 * project from History and lose everything else the build did too.
 *
 * That is the gap this closes, and it matters more for a non-technical user than for a developer.
 * A developer reads the diff and fixes it by hand. Someone who does not write code has no way back
 * at all — so "the AI changed something I did not want" becomes "I have to rebuild and hope". The
 * fear that the AI has quietly broken your work is the single most common reason people stop
 * trusting a builder, and a visible, per-change undo is the honest answer to it.
 *
 * The diff maths lived inside the DiffViewer component. It is here now because revert needs the
 * SAME line classification the view is showing — if the two ever disagreed, the user would click
 * revert on one hunk and get another. One implementation, so they cannot drift apart.
 *
 * Everything here is PURE: strings in, strings out. No React, no DOM, no I/O.
 */

export type DiffLineType = 'added' | 'removed' | 'unchanged';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface Hunk {
  lines: DiffLine[];
  /**
   * Where each of `lines` sits in the full diff.
   *
   * This is what makes revert possible at all. The view shows hunks with a few lines of context
   * around each change, so a hunk is a WINDOW onto the diff, not a slice of the file — and
   * reconstructing the file needs to know which positions in the whole diff that window covers.
   * Without it, "revert hunk 2" could only be matched back by comparing line contents, which breaks
   * the moment a file repeats a line (every `}` in the file looks identical).
   */
  indices: number[];
}

/** Longest-common-subsequence table. O(n·m) — fine for source files, and exact. */
function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/** Classify every line as unchanged / added / removed, in file order. */
export function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const dp = lcs(oldLines, newLines);
  let i = oldLines.length;
  let j = newLines.length;
  const ops: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNo: i, newLineNo: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'added', content: newLines[j - 1], oldLineNo: null, newLineNo: j });
      j--;
    } else {
      ops.push({ type: 'removed', content: oldLines[i - 1], oldLineNo: i, newLineNo: null });
      i--;
    }
  }
  return ops.reverse();
}

/** Group changes into hunks with surrounding context, carrying each line's position in the diff. */
export function buildHunks(diffLines: DiffLine[], contextLines = 5): Hunk[] {
  const near = new Set<number>();
  diffLines.forEach((line, idx) => {
    if (line.type === 'unchanged') return;
    const from = Math.max(0, idx - contextLines);
    const to = Math.min(diffLines.length - 1, idx + contextLines);
    for (let c = from; c <= to; c++) near.add(c);
  });
  if (near.size === 0) return [];

  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  diffLines.forEach((line, idx) => {
    if (!near.has(idx)) { current = null; return; }
    if (!current) { current = { lines: [], indices: [] }; hunks.push(current); }
    current.lines.push(line);
    current.indices.push(idx);
  });
  return hunks;
}

export function diffStats(diffLines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.type === 'added') added++;
    else if (line.type === 'removed') removed++;
  }
  return { added, removed };
}

/**
 * Split text into lines the way the diff does, so a revert reassembles exactly what was compared.
 *
 * ⚠️ The trailing-newline case is the one that silently corrupts files. `"a\nb\n".split('\n')` gives
 * `['a','b','']` — that empty last element is not a line, it is the end of the file. Diffing it as a
 * line makes a final-newline change look like an added blank line, and reassembling drops or doubles
 * the newline. So it is recorded separately and put back exactly as it was.
 */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === '') return { lines: [], trailingNewline: false };
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), trailingNewline };
}

/** Reassemble, restoring the trailing newline exactly as it was. */
export function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  if (lines.length === 0) return trailingNewline ? '\n' : '';
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * Put ONE hunk back to how it was, leaving every other change in place.
 *
 * The rule is one line long and is the whole feature: for positions inside the reverted hunk take the
 * OLD side of the diff, and everywhere else take the NEW side. So a `removed` line comes back, an
 * `added` line goes away, and nothing outside that hunk moves.
 *
 * Returns the new file content, or `null` when the hunk index does not exist — a caller that has
 * gone stale (the file changed under it) gets an honest refusal rather than a corrupted file.
 */
export function revertHunk(
  oldText: string,
  newText: string,
  hunkIndex: number,
  contextLines = 5,
): string | null {
  const oldSide = splitLines(oldText);
  const newSide = splitLines(newText);
  const diff = computeDiff(oldSide.lines, newSide.lines);
  const hunks = buildHunks(diff, contextLines);
  if (hunkIndex < 0 || hunkIndex >= hunks.length) return null;

  const reverted = new Set(hunks[hunkIndex].indices);
  const out: string[] = [];
  diff.forEach((line, idx) => {
    if (reverted.has(idx)) {
      // OLD side: keep what was there before, drop what the build added.
      if (line.type !== 'added') out.push(line.content);
    } else {
      // NEW side: keep the build's work everywhere the user did not object to.
      if (line.type !== 'removed') out.push(line.content);
    }
  });

  // A revert that undoes the ONLY change should give back the original byte-for-byte, trailing
  // newline included — so the file's ending follows whichever side each part came from.
  const trailing = hunks.length === 1 ? oldSide.trailingNewline : newSide.trailingNewline;
  return joinLines(out, trailing);
}

/**
 * Put a whole file back to how it was before the build.
 *
 * Deliberately returns the previous text verbatim rather than reverting every hunk in turn: for the
 * whole-file case the answer is not an approximation of the old file, it IS the old file, and going
 * through the diff could only introduce a way to get it wrong.
 *
 * `null` when there is nothing to go back to — a file the build CREATED has no previous version, and
 * offering "revert" on it would promise something this function cannot do. Deleting it is a different
 * action with different consequences, and the caller must decide that explicitly.
 */
export function revertFile(previousText: string | undefined): string | null {
  return previousText === undefined ? null : previousText;
}

/** Did this build change the file at all? Used to hide a revert control that would do nothing. */
export function hasChanges(oldText: string, newText: string): boolean {
  return oldText !== newText;
}
