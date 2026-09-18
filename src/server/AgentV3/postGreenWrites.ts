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
// PURE — the route owns the clock, the observer and the timeline.

export interface PostGreenWrite {
  path: string;
  /** The named pass that wrote (greenFreeze.runInPass), or null for the build loop itself. */
  pass: string | null;
  at: number;
}

export type EndVerdict = 'rendered' | 'broken' | 'unchecked';

/** The label a null pass gets — the architect and its sub-agents write outside any named pass. */
export const BUILD_LOOP_LABEL = 'build loop';

/** How many distinct passes are named in the summary before "and N more". */
export const MAX_NAMED_PASSES = 6;

/** Group writes by who made them, most writes first. PURE. */
export function groupPostGreenWrites(writes: ReadonlyArray<PostGreenWrite>): Array<{ pass: string; files: number; paths: string[] }> {
  const by = new Map<string, Set<string>>();
  for (const w of writes) {
    const key = w.pass ?? BUILD_LOOP_LABEL;
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
  const who = `After the app first rendered ${secs}s in, ${files} file(s) were written by ${groups.length} writer(s): ${named}${more}.`;
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
