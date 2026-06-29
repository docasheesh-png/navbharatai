/**
 * P-DEV.4 — dependency-free 3-way merge engine + conflict-marker tooling.
 *
 * Powers the merge-conflict resolver: a classic line-based diff3 (`merge3(base, ours, theirs)`)
 * that auto-merges non-overlapping changes and emits Git-style conflict markers only where both
 * sides changed the same region differently; plus `parseConflicts()` to read a file that already
 * contains `<<<<<<< / ======= / >>>>>>>` markers into structured hunks, and `resolveConflicts()`
 * to turn a per-hunk choice (ours / theirs / both) back into clean content.
 *
 * Pure + dependency-free (no `diff3`/`diff` package), matching this codebase's no-new-dep culture,
 * and exhaustively unit-tested.
 */

function splitLines(s: string): string[] {
  return s.length === 0 ? [] : s.split('\n');
}

function eqArr(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** LCS-matched index pairs [iInA, jInB], increasing. */
function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return pairs.reverse();
}

export interface MergeConflict {
  ours: string[];
  base: string[];
  theirs: string[];
}

export interface Merge3Result {
  /** Merged text. Conflicts are rendered with Git-style markers. */
  merged: string;
  /** The conflicting regions (empty when the merge is clean). */
  conflicts: MergeConflict[];
  hasConflicts: boolean;
}

export interface Merge3Options {
  oursLabel?: string;
  theirsLabel?: string;
}

function conflictBlock(c: MergeConflict, opts: Merge3Options): string[] {
  return [
    `<<<<<<< ${opts.oursLabel ?? 'ours'}`,
    ...c.ours,
    '=======',
    ...c.theirs,
    `>>>>>>> ${opts.theirsLabel ?? 'theirs'}`,
  ];
}

/**
 * Three-way merge of line-based text. Regions changed on only one side are taken automatically;
 * regions both sides changed identically collapse to that change; regions both sides changed
 * differently become conflicts (rendered with markers in `merged`).
 */
export function merge3(base: string, ours: string, theirs: string, opts: Merge3Options = {}): Merge3Result {
  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);

  const oursMap = new Map<number, number>(lcsMatches(b, o)); // baseIdx -> oursIdx
  const theirsMap = new Map<number, number>(lcsMatches(b, t)); // baseIdx -> theirsIdx
  // Sync points: base lines matched in BOTH ours and theirs (monotonic in all three).
  const sync = [...oursMap.keys()].filter((k) => theirsMap.has(k)).sort((x, y) => x - y);

  const out: string[] = [];
  const conflicts: MergeConflict[] = [];
  let bPrev = -1;
  let oPrev = -1;
  let tPrev = -1;

  const emitRegion = (bLo: number, bHi: number, oLo: number, oHi: number, tLo: number, tHi: number) => {
    const baseRegion = b.slice(bLo, bHi);
    const oursRegion = o.slice(oLo, oHi);
    const theirsRegion = t.slice(tLo, tHi);
    if (eqArr(oursRegion, baseRegion)) { out.push(...theirsRegion); return; }     // only theirs changed
    if (eqArr(theirsRegion, baseRegion)) { out.push(...oursRegion); return; }     // only ours changed
    if (eqArr(oursRegion, theirsRegion)) { out.push(...oursRegion); return; }     // both made the same change
    const c: MergeConflict = { ours: oursRegion, base: baseRegion, theirs: theirsRegion };
    conflicts.push(c);
    out.push(...conflictBlock(c, opts));
  };

  for (const bIdx of sync) {
    const oIdx = oursMap.get(bIdx)!;
    const tIdx = theirsMap.get(bIdx)!;
    emitRegion(bPrev + 1, bIdx, oPrev + 1, oIdx, tPrev + 1, tIdx); // region before this sync line
    out.push(b[bIdx]);                                             // the stable sync line itself
    bPrev = bIdx; oPrev = oIdx; tPrev = tIdx;
  }
  // Tail region after the last sync point.
  emitRegion(bPrev + 1, b.length, oPrev + 1, o.length, tPrev + 1, t.length);

  return { merged: out.join('\n'), conflicts, hasConflicts: conflicts.length > 0 };
}

// ── Conflict-marker parsing / resolution (for files that already contain markers) ──

export type ConflictSegment =
  | { type: 'stable'; lines: string[] }
  | { type: 'conflict'; ours: string[]; theirs: string[]; base?: string[] };

export interface ParsedConflicts {
  segments: ConflictSegment[];
  conflictCount: number;
  hasConflicts: boolean;
}

const RE_START = /^<{7}(\s|$)/;
const RE_BASE = /^\|{7}(\s|$)/;
const RE_SEP = /^={7}(\s|$)/;
const RE_END = /^>{7}(\s|$)/;

/** Parse a file's content into stable + conflict segments. Tolerates diff3-style `|||||||` bases. */
export function parseConflicts(content: string): ParsedConflicts {
  const lines = splitLines(content);
  const segments: ConflictSegment[] = [];
  let stable: string[] = [];
  let i = 0;
  let conflictCount = 0;

  const flushStable = () => { if (stable.length) { segments.push({ type: 'stable', lines: stable }); stable = []; } };

  while (i < lines.length) {
    if (RE_START.test(lines[i])) {
      flushStable();
      const ours: string[] = [];
      const base: string[] = [];
      const theirs: string[] = [];
      let section: 'ours' | 'base' | 'theirs' = 'ours';
      i++; // skip <<<<<<<
      while (i < lines.length && !RE_END.test(lines[i])) {
        if (RE_BASE.test(lines[i])) { section = 'base'; i++; continue; }
        if (RE_SEP.test(lines[i])) { section = 'theirs'; i++; continue; }
        if (section === 'ours') ours.push(lines[i]);
        else if (section === 'base') base.push(lines[i]);
        else theirs.push(lines[i]);
        i++;
      }
      i++; // skip >>>>>>>
      segments.push({ type: 'conflict', ours, theirs, ...(base.length ? { base } : {}) });
      conflictCount++;
    } else {
      stable.push(lines[i]);
      i++;
    }
  }
  flushStable();
  return { segments, conflictCount, hasConflicts: conflictCount > 0 };
}

export type Resolution = 'ours' | 'theirs' | 'both' | 'base';

/**
 * Resolve parsed conflicts into clean content. `choices[k]` is the choice for the k-th conflict
 * (in order); a missing choice defaults to `defaultChoice` ('ours'). 'both' = ours then theirs.
 */
export function resolveConflicts(parsed: ParsedConflicts, choices: Resolution[], defaultChoice: Resolution = 'ours'): string {
  const out: string[] = [];
  let k = 0;
  for (const seg of parsed.segments) {
    if (seg.type === 'stable') { out.push(...seg.lines); continue; }
    const choice = choices[k] ?? defaultChoice;
    k++;
    if (choice === 'ours') out.push(...seg.ours);
    else if (choice === 'theirs') out.push(...seg.theirs);
    else if (choice === 'base') out.push(...(seg.base ?? []));
    else out.push(...seg.ours, ...seg.theirs); // both
  }
  return out.join('\n');
}

/** Quick check used to decide whether to offer the merge editor for a file. */
export function hasConflictMarkers(content: string): boolean {
  return splitLines(content).some((l) => RE_START.test(l));
}
