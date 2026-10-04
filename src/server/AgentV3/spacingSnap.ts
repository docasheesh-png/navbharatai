// AgentV3 — SNAP SPACING TO THE 4px GRID, deterministically, with no model call.
//
// 🔴 WHY (autopsy 536c8189, 2026-10-01 — the FIRST real evidence of the off-grid hand-back shipped by
// #3458). A Duolingo-style app finished green, and the `DESIGN_CONSISTENCY` finding named a handful of
// padding/gap values off the 4px grid. The end-of-turn hand-back (`stylePolishResume.ts`) gave that list
// to the MODEL with the instruction *"change each to the nearest multiple of 4px"*. What came back was
// three ad-hoc `node -e` scripts that string-sliced and rewrote the whole 634-line `src/index.css`, one
// `edit_file` that failed with `old_string is not unique in src/index.css (80 matches)`, ~45 seconds and
// three extra model calls — and one of those scripts contained, verbatim:
//
//     .replace(/padding: 4px 8px/g, 'padding: 2px 6px')
//     .replace(/gap: 4px;/g,        'gap: 6px;')
//
// It moved values that were ALREADY ON the grid OFF it. The build still ended at `DESIGN_CONSISTENCY`
// 98/100 with values off the grid. So the hand-back cost real money and made the stylesheet worse.
//
// 🔑 THE CLASS, named so it is recognised again: `round(v / 4) * 4` HAS EXACTLY ONE RIGHT ANSWER, so a
// model must never be asked for it. This repo already draws that line in the other direction and says so
// in `buildQualityLint.ts`: *"a name for an icon button has to MEAN something, so it is never guessed by
// a deterministic pass."* The converse is this module. Arithmetic with one answer is OUR job; judgement
// is the model's. Handing arithmetic to a model buys three ways to be wrong (it mis-derives which values
// are off-grid, it rewrites by regex over a file it cannot see whole, and it charges for both).
//
// 🔒 WHAT IT WILL NEVER DO:
//   • touch a file this build did not write — a value in the user's own code is the user's (Q-015), and
//     the same rule the retired `offGridHandBack` applied;
//   • fire below the finding's own threshold (`MAX_OFFGRID`), so nothing is edited over a value the
//     report would not even have named;
//   • overrule an app that is coherently on a DIFFERENT rhythm — a file whose off-grid values share a
//     real divisor (6px, 18px, 30px) has its own system and is left exactly as written
//     (`isCoherentOtherGrid`);
//   • remove spacing — a value that would snap to 0 goes to 4 instead;
//   • read or write anything outside a padding/margin/gap declaration: no colours, no font sizes, no
//     borders, no `width`, and nothing inside a comment.
//
// Ties go to the SMALLER multiple (6px → 4px, 10px → 8px): a layout that grows can overflow a phone
// screen — which `mobileLayoutCheck` then reports — and a layout that tightens cannot.
//
// Kill switch: AGENTV3_SPACING_SNAP=off. PURE — the caller writes the files.

import { stripCommentsForMarkup } from './stripCodeComments';
import {
  SPACING_DECL_RE_SOURCE, SPACING_PX_RE_SOURCE, SPACING_GRID, MAX_OFFGRID,
  extractSpacingPx, offGridSpacing,
} from '../AppMakerLab/intelligence/DesignLinter';
import { LINTABLE_DESIGN_FILE, NOT_APP_DESIGN_FILE, GENERATED_FILE } from './buildQualityLint';

/** Kill switch. Default ON. */
export function spacingSnapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SPACING_SNAP ?? '').trim().toLowerCase() !== 'off';
}

/** At most this many values changed in one file — a cap, never a reason to half-fix one. */
export const MAX_SNAPS_PER_FILE = 60;

/** At most this many files in one pass. */
export const MAX_SNAP_FILES = 8;

export interface SpacingSnapPatch {
  path: string;
  content: string;
  /** What moved, smallest first: `['6px → 4px', '10px → 8px']`. For the admin report only. */
  changes: string[];
}

/**
 * The nearest multiple of the grid, ties to the smaller, never zero. PURE.
 *
 * This is the whole decision the model was being paid to make.
 */
export function snapToGrid(value: number, grid: number = SPACING_GRID): number {
  const g = grid > 0 ? grid : SPACING_GRID;
  if (!Number.isFinite(value) || value <= 0) return value;
  const low = Math.floor(value / g) * g;
  const high = low + g;
  const to = value - low <= high - value ? low : high;
  return to === 0 ? g : to;
}

/** A px length a snap would move. PURE. */
function isOffGrid(value: number, grid: number = SPACING_GRID): boolean {
  return offGridSpacing([value], grid).length > 0;
}

/** At least this many off-grid values before their common rhythm is believed. Two prove nothing. */
export const MIN_OTHER_GRID_SAMPLE = 3;

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/**
 * Is this file on a COHERENT grid of its own, rather than merely sloppy? PURE.
 *
 * 🔑 THE RULE, and the first draft of it was wrong in a way worth recording: "more values off the grid
 * than on it" ALSO describes the sloppy stylesheet this module exists to tidy, so it stood down on
 * exactly the case it was built for. What actually distinguishes a design system from a mess is that
 * its values share a rhythm — `6px, 18px, 30px, 42px` have a common divisor of 6; `10px, 6px, 14px` have
 * a common divisor of 2, and a 2px "grid" is not a system (4 is a multiple of 2, so a real 2px rhythm
 * would put half its values on the 4px grid anyway). So: a shared divisor of at least 5 that is not
 * itself a multiple of the grid, over enough values to mean something.
 */
export function isCoherentOtherGrid(offGrid: readonly number[], grid: number = SPACING_GRID): boolean {
  const whole = offGrid.filter((v) => Number.isInteger(v) && v > 0);
  if (whole.length < MIN_OTHER_GRID_SAMPLE || whole.length !== offGrid.length) return false;
  const common = whole.reduce((a, b) => gcd(a, b));
  return common >= 5 && common % (grid > 0 ? grid : SPACING_GRID) !== 0;
}

/**
 * Rewrite one file's off-grid spacing. Returns null when nothing changes, or when the file carries its
 * own rhythm (more off-grid values than on-grid ones — see `otherGrid` above). PURE.
 */
export function snapSpacingInSource(source: string, grid: number = SPACING_GRID): { content: string; changes: string[] } | null {
  if (typeof source !== 'string' || source.length === 0) return null;
  // The lint judges the SHIPPED markup, so a commented-out value is neither counted nor rewritten. The
  // offsets of a stripped copy do not line up with the original, so the comment ranges are what the
  // rewrite skips — computed once, from the same helper the lint uses.
  const stripped = stripCommentsForMarkup(source);
  const off = offGridSpacing(extractSpacingPx(stripped), grid);
  if (off.length === 0) return null;
  if (isCoherentOtherGrid(off, grid)) return null;

  const commented = commentRanges(source);
  const inComment = (index: number): boolean => commented.some(([a, b]) => index >= a && index < b);

  const decl = new RegExp(SPACING_DECL_RE_SOURCE, 'gi');
  const changes: string[] = [];
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(source)) !== null) {
    if (changes.length >= MAX_SNAPS_PER_FILE) break;
    const value = m[1];
    const valueStart = m.index + m[0].length - value.length;
    if (inComment(m.index)) continue;
    const px = new RegExp(SPACING_PX_RE_SOURCE, 'g');
    let rewritten = '';
    let cursor = 0;
    let n: RegExpExecArray | null;
    while ((n = px.exec(value)) !== null) {
      const num = parseFloat(n[1]);
      if (!isOffGrid(num, grid) || changes.length >= MAX_SNAPS_PER_FILE) continue;
      const to = snapToGrid(num, grid);
      if (to === num) continue;
      rewritten += value.slice(cursor, n.index) + `${to}px`;
      cursor = n.index + n[0].length;
      changes.push(`${n[1]}px → ${to}px`);
    }
    if (cursor === 0) continue; // nothing in this declaration moved
    rewritten += value.slice(cursor);
    out += source.slice(last, valueStart) + rewritten;
    last = valueStart + value.length;
  }
  if (changes.length === 0) return null;
  out += source.slice(last);
  return { content: out, changes: [...new Set(changes)] };
}

/** `[start, end)` of every block and line comment, so a rewrite can skip them. PURE. */
function commentRanges(source: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * The files to rewrite, from the project as it is and the paths THIS build wrote. Same file selection and
 * same threshold as the `DESIGN_CONSISTENCY` finding, so the snap and the finding can never disagree
 * about scope. PURE.
 */
export function spacingSnapPatches(
  files: Record<string, string>,
  written: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): SpacingSnapPatch[] {
  if (!spacingSnapEnabled(env)) return [];
  const wrote = new Set([...(written ?? [])].map((p) => String(p).replace(/^\.?\/+/, '')));
  const candidates: SpacingSnapPatch[] = [];
  let total = 0;
  for (const [path, content] of Object.entries(files || {})) {
    if (!wrote.has(path) || typeof content !== 'string') continue;
    if (!LINTABLE_DESIGN_FILE.test(path) || NOT_APP_DESIGN_FILE.test(path) || GENERATED_FILE.test(path)) continue;
    let off = 0;
    try { off = offGridSpacing(extractSpacingPx(stripCommentsForMarkup(content)), SPACING_GRID).length; } catch { continue; }
    if (off === 0) continue;
    total += off;
    let patch: { content: string; changes: string[] } | null = null;
    try { patch = snapSpacingInSource(content, SPACING_GRID); } catch { patch = null; }
    if (patch && patch.content !== content) candidates.push({ path, content: patch.content, changes: patch.changes });
  }
  // THE FINDING'S OWN THRESHOLD: below it the report says nothing, so neither does this.
  if (total <= MAX_OFFGRID) return [];
  return candidates.sort((a, b) => (b.changes.length - a.changes.length) || a.path.localeCompare(b.path)).slice(0, MAX_SNAP_FILES);
}

/** One sentence for the admin report — never user-facing, so it may name the mechanism. */
export function spacingSnapNote(patches: readonly SpacingSnapPatch[]): string {
  const values = patches.reduce((n, p) => n + p.changes.length, 0);
  const shown = [...new Set(patches.flatMap((p) => p.changes))].slice(0, 8).join(', ');
  const where = patches.map((p) => p.path).join(', ');
  return `${values} spacing value(s) in ${patches.length} file(s) this build wrote were off the ${SPACING_GRID}px grid `
    + `and were snapped to the nearest multiple, deterministically, with no model call — ${where}: ${shown}. `
    + 'Until 2026-10-01 this list was handed to the model at the end of its turn (autopsy 536c8189), which '
    + 'spent three calls writing regex scripts over the stylesheet and moved on-grid values off the grid.';
}
