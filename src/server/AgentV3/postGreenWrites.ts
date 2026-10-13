// AgentV3 — WHO WROTE AFTER THE APP WAS GREEN: the measurement that decides the next protection.
//
// ADMIN 2026-09-18: "app banne ke baad tutni nahi chahiye." Option A (inBuildGreen.ts) makes sure a
// working app is never LOST. This module answers the question A leaves open and that every stronger
// protection depends on: after the app first rendered, WHO kept writing to it, and did it survive?
//
// WHY MEASURE BEFORE BUILDING MORE. Two candidate fixes exist for "the build keeps editing a working
// app": verify-and-revert after every post-green write (costly on every edit), and arming the green
// freeze before the ~36-pass gate stretch (which silently disables any pass nobody classified). Both
// are real changes with real costs — and as of this date NO report shows a pass breaking a green app.
// PR #3084 found the same thing for the build loop and shipped `READY_BEFORE_END` first. This is the
// render-side sibling: one number for "when did it first work", one ledger for "who touched it after".
//
// 🔴 "BUILD LOOP" WAS THE DEFAULT, AND THE DEFAULT LIED (autopsy 9c612cdb, 2026-10-12). Every write with no pass name
// was labelled the build loop. That report read "build loop (5 files)" for a model that had written nothing after its
// final summary: the five were the unused-import sweep (2), the end-to-end scaffold (2) and the architecture note (1),
// platform steps that named no pass. The label is now earned: "build loop" means a tool call the model asked for in
// the user's own build (modelToolWrites.ts). A write that is neither named nor the model's is said to be an UNNAMED
// platform step — a defect in attribution, reported as such, never blamed on the model.
//
// PURE — the route owns the clock, the observer and the timeline.
import type { ModelToolOrigin } from './modelToolWrites';

export interface PostGreenWrite {
  path: string;
  /** The named pass that wrote (greenFreeze.runInPass), or null when the writer named none. */
  pass: string | null;
  /**
   * Whether a model asked for the write (modelToolWrites.ts): 'build' for the user's own build, 'platform-repair'
   * for a repair run the platform started. Absent or null means NO model did — never assumed to be the build loop.
   */
  model?: ModelToolOrigin | null;
  at: number;
}

export type EndVerdict = 'rendered' | 'broken' | 'unchecked';

/** A write inside a tool call the model made in the user's own build — the architect and the sub-agents it delegates to. */
export const BUILD_LOOP_LABEL = 'build loop';

/** A write inside a tool call made by a repair run the platform started, where the run named no pass. */
export const UNNAMED_MODEL_REPAIR_LABEL = 'unnamed model repair';

/** A write no model asked for, by platform code that named no pass. Which step it was is not known. */
export const UNNAMED_PLATFORM_LABEL = 'unnamed platform step';

/** Who made one write, as every ledger names it. A pass name wins; "build loop" only on positive evidence. PURE. */
export function writerLabel(w: { pass: string | null; model?: ModelToolOrigin | null }): string {
  if (w.pass) return w.pass;
  if (w.model === 'build') return BUILD_LOOP_LABEL;
  if (w.model === 'platform-repair') return UNNAMED_MODEL_REPAIR_LABEL;
  return UNNAMED_PLATFORM_LABEL;
}

/** The same writer as a phrase inside a sentence ("… by the e2e-scaffold pass", "… by the build loop"). PURE. */
export function writerPhrase(w: { pass: string | null; model?: ModelToolOrigin | null }): string {
  if (w.pass) return `the ${w.pass} pass`;
  if (w.model === 'build') return `the ${BUILD_LOOP_LABEL}`;
  return `an ${writerLabel(w)}`;
}

/** How many distinct passes are named in the summary before "and N more". */
export const MAX_NAMED_PASSES = 6;

/** Group writes by who made them, most writes first. PURE. */
export function groupPostGreenWrites(writes: ReadonlyArray<PostGreenWrite>): Array<{ pass: string; files: number; paths: string[] }> {
  const by = new Map<string, Set<string>>();
  for (const w of writes) {
    const key = writerLabel(w);
    if (!by.has(key)) by.set(key, new Set());
    by.get(key)!.add(w.path);
  }
  return [...by.entries()]
    .map(([pass, paths]) => ({ pass, files: paths.size, paths: [...paths].sort() }))
    .sort((a, b) => b.files - a.files || a.pass.localeCompare(b.pass));
}

/**
 * The one line an autopsy reads. Its SEVERITY is the finding:
 *   • nobody wrote after green                → info: the protection has nothing to protect against
 *   • writes happened and the app still rendered → info: edits on a green app survived (this build)
 *   • writes happened and the app ended BROKEN → WARNING, naming who wrote — the evidence B/C wait for
 *   • writes happened and the end was unchecked → info, said plainly: nothing is known either way
 * PURE.
 */
export function postGreenWritesNote(input: {
  writes: ReadonlyArray<PostGreenWrite>;
  firstRenderAt: number;
  buildStartedAt: number;
  end: EndVerdict;
}): { code: 'POST_GREEN_WRITES'; severity: 'info' | 'warning'; message: string; autoResolved: boolean } {
  const secs = Math.max(0, Math.round((input.firstRenderAt - input.buildStartedAt) / 1000));
  const groups = groupPostGreenWrites(input.writes);
  const files = new Set(input.writes.map((w) => w.path)).size;
  if (groups.length === 0) {
    return {
      code: 'POST_GREEN_WRITES', severity: 'info', autoResolved: true,
      message: `The app first rendered ${secs}s in and nothing wrote to it afterwards.`,
    };
  }
  const named = groups.slice(0, MAX_NAMED_PASSES).map((g) => `${g.pass} (${g.files} file${g.files === 1 ? '' : 's'})`).join(', ');
  const more = groups.length > MAX_NAMED_PASSES ? ` and ${groups.length - MAX_NAMED_PASSES} more` : '';
  // An unnamed bucket may hold several steps, so the count of writers is a floor there, and the reader is told why.
  const unnamedLabels = [UNNAMED_PLATFORM_LABEL, UNNAMED_MODEL_REPAIR_LABEL].filter((l) => groups.some((g) => g.pass === l));
  const unnamed = unnamedLabels.length > 0
    ? ` The ${unnamedLabels.map((l) => `"${l}"`).join(' and ')} writes came from platform code that named no pass, so which step made them is not known; they were not the build loop.`
    : '';
  const who = `After the app first rendered ${secs}s in, ${files} file(s) were written by ${groups.length} writer(s): ${named}${more}.${unnamed}`;
  switch (input.end) {
    case 'rendered':
      return { code: 'POST_GREEN_WRITES', severity: 'info', autoResolved: true, message: `${who} At the end the app still rendered.` };
    case 'broken':
      return {
        code: 'POST_GREEN_WRITES', severity: 'warning', autoResolved: false,
        message: `${who} At the end the app was PROVEN BROKEN — one of these writers broke a working app. This is the evidence the post-green protections are waiting for; the writers are named above.`,
      };
    default:
      return { code: 'POST_GREEN_WRITES', severity: 'info', autoResolved: true, message: `${who} The end state could not be checked, so nothing is known about whether they broke it.` };
  }
}

/** Which of the end-of-build facts the route already holds is the verdict. PURE. */
export function endVerdictFrom(previewGreen: boolean, previewProvenBroken: boolean): EndVerdict {
  if (previewGreen) return 'rendered';
  if (previewProvenBroken) return 'broken';
  return 'unchecked';
}
