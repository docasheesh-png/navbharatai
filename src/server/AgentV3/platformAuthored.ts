// WHO WROTE THIS FILE — the OTHER half of the question, and the one that keeps being answered wrong.
//
// 🔴 ROOT CAUSE (autopsy 2b0a3ed5, 2026-09-17). A user asked for a calculator, waited 66 seconds and
// pressed stop. The model wrote ZERO files — its one and only turn read `src/App.tsx` and nothing
// else. The build report nevertheless carried, as an UNRESOLVED PROBLEM against the user's app:
//
//     Design consistency 68/100 (C) across 8 file(s)
//       ⚠ 20 distinct colours — consolidate into a small palette (≤ 12)
//       ⚠ 11 spacing values are off the 4px grid
//
// Those eight files are NAVBHARATAI'S OWN golden Calculator template. We graded our own scaffold and
// filed the C against a user who had not written a line.
//
// 🔴 AND THIS EXACT BUG WAS "FIXED" SIX HOURS EARLIER, IN THE PREVIOUS AUTOPSY (fdd59ef8). That fix
// was:
//
//     const hasUserApp = Object.keys(storeFiles).length > 0 || writtenFiles.size > 0;
//
// It held only because that build's durable store happened to be empty. It asks *"is there anything
// in this project?"* when the question is *"did anyone AUTHOR anything?"* — and the golden-scaffold
// pre-seed does `writtenFiles.set(gp, gc)` for all twelve of its files and then persists them, so it
// makes BOTH halves of that test true by itself. The instance was fixed; the class was not.
//
// 🔎 THE CLASS, named so it is recognised rather than re-discovered: **`writtenFiles` conflates "the
// model wrote this" with "the platform seeded this"**, and THREE subsystems now depend on telling
// them apart:
//   1. this quality lint ("is there a user app to grade at all?"),
//   2. `ToolDispatcher.setAuthoredFiles(() => writtenFiles.keys())` — the authorship set added by
//      the readiness-gate fix (#2997) THE SAME DAY, whose own module header states *"SCAFFOLD FILES
//      ARE NOT IN THE AUTHORED SET"*. That is true of the actuator's boilerplate, which never goes
//      through a write tool, and FALSE of the golden scaffold, which explicitly does. So that gate
//      would blame a build for a placeholder in our own template,
//   3. the stop message *"Your files so far are saved"*, said to a user whose files are all ours.
//
// 🔑 WHY THIS IS ANSWERED BY CONTENT AND NOT BY A FLAG. A flag set at seed time answers only for the
// request that did the seeding: the very next turn ("continue") loads the same twelve files out of
// the durable store with no flag anywhere, and grades the template all over again. Persisting a list
// would work and would then have to be kept correct for ever, per workspace, across restores.
// Content is stateless and self-evidently right: a file whose bytes are EXACTLY what we seed is our
// template, and the moment the model changes one byte of it, it is the user's.
//
// 🔒 THE SAFE DIRECTION IS "THE USER'S", ALWAYS. Anything we do not positively recognise as our own
// seeded content counts as user code — so an unknown file, a customised scaffold file, a renamed
// path and a future template we forget to register all keep today's behaviour (the gate runs, the
// lint reports). Only a byte-exact match is ever excused. Over-attributing to the user costs an
// advisory nobody acts on; under-attributing hides a real defect in a real app.
//
// Pure, cached, dependency-free beyond the two scaffold registries. Never throws.

import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from './goldenScaffolds/registry';
import { SCAFFOLD_BOILERPLATE } from './scaffoldBoilerplate';
import { normalizeAuthoredPath } from './buildAuthorship';

/**
 * path → every byte-exact content NavBharatAI itself seeds at that path.
 *
 * A SET per path, not one string: `index.html` carries the template's own `<title>`, and
 * `src/App.tsx` differs per template, so one path legitimately has as many seeded forms as there are
 * scaffolds. Built once on first use — forty scaffolds × ~12 files of module-constant strings, which
 * are already resident, so this adds references rather than copies.
 */
let seededIndex: Map<string, Set<string>> | null = null;

function buildSeededIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const add = (path: string, content: string) => {
    if (typeof path !== 'string' || typeof content !== 'string') return;
    const key = normalizeAuthoredPath(path);
    if (!key) return;
    let set = index.get(key);
    if (!set) { set = new Set<string>(); index.set(key, set); }
    set.add(content);
  };
  try {
    for (const scaffold of GOLDEN_SCAFFOLDS) {
      for (const [p, c] of Object.entries(goldenScaffoldFiles(scaffold))) add(p, c);
    }
  } catch { /* a broken registry must never break a gate — it just means fewer known-ours files */ }
  try {
    for (const [p, c] of Object.entries(SCAFFOLD_BOILERPLATE)) add(p, c);
  } catch { /* same */ }
  return index;
}

function index(): Map<string, Set<string>> {
  if (!seededIndex) seededIndex = buildSeededIndex();
  return seededIndex;
}

/** Test seam — rebuilds the cache. Never call from production code. */
export function _resetPlatformSeededIndex(): void {
  seededIndex = null;
}

/**
 * Is this exact file — path AND bytes — something NavBharatAI seeded rather than something anybody
 * authored? PURE.
 *
 * ⚠️ Byte-exact on purpose, with no trimming or whitespace tolerance. A "nearly ours" file is one the
 * model touched, and a match rule loose enough to forgive an edit is loose enough to excuse the
 * user's real code from a correctness gate. Cheap, too: the path lookup fails for almost every file
 * in a real app, so the content comparison rarely runs at all.
 */
export function isPlatformSeededFile(path: string | null | undefined, content: string | null | undefined): boolean {
  if (typeof path !== 'string' || typeof content !== 'string') return false;
  const key = normalizeAuthoredPath(path);
  if (!key) return false;
  const forms = index().get(key);
  return forms ? forms.has(content) : false;
}

/**
 * The paths in `files` that somebody actually AUTHORED — everything we do not recognise, byte for
 * byte, as our own seeded content. PURE. Order follows the input.
 */
export function userAuthoredPaths(files: Record<string, string> | null | undefined): string[] {
  if (!files || typeof files !== 'object') return [];
  const out: string[] = [];
  for (const [p, c] of Object.entries(files)) {
    if (!isPlatformSeededFile(p, c)) out.push(p);
  }
  return out;
}

/**
 * Is there a user app here AT ALL — one file that is not our untouched template? PURE.
 *
 * This is what the quality lint must ask before it reports a grade. An empty project is no, a
 * pre-seeded but untouched template is no, and a template with one line changed is YES — from that
 * moment the app is theirs and its design is fair to grade.
 */
export function projectHasUserCode(files: Record<string, string> | null | undefined): boolean {
  if (!files || typeof files !== 'object') return false;
  for (const [p, c] of Object.entries(files)) {
    if (!isPlatformSeededFile(p, c)) return true;
  }
  return false;
}

/**
 * The subset of a build's written files that the MODEL is answerable for.
 *
 * This is what belongs in the readiness gate's authorship set. Handed the map the route keeps, it
 * removes the entries the golden-scaffold pre-seed put there — so a placeholder in our own template
 * is our template's defect, exactly as `buildAuthorship.ts` already says it should be.
 */
export function modelAuthoredPaths(written: ReadonlyMap<string, string> | null | undefined): string[] {
  const out: string[] = [];
  if (!written || typeof (written as ReadonlyMap<string, string>).forEach !== 'function') return out;
  try {
    written.forEach((content, path) => {
      if (!isPlatformSeededFile(path, content)) out.push(path);
    });
  } catch { /* a hostile map must never break a gate */ }
  return out;
}
