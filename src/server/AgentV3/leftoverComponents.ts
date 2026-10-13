// A COMPONENT NOBODY ASKED FOR AND NOTHING SHOWS IS REMOVED, NOT SHIPPED (autopsy db07e0af, 2026-10-12).
//
// 🔴 WHAT HAPPENED. "Banao" built a todo app whose plan included `src/components/LoadingSpinner.tsx` — an app that
// keeps its tasks in browser storage has nothing to load. Nothing imported it. The end-of-turn hand-back named it
// (Q-202), the model called no tool and answered with a closing sentence, and the file shipped: dead code in the
// user's project and a readiness warning in the report.
//
// 🔑 THE TWO LAYERS (the 50/50 law). Layer one stops it being written: both planners are told to plan only what a
// screen shows (Q-925). Layer two, here, is the deterministic net for when a model writes one anyway and then
// ignores the hand-back: a file the import graph PROVES nothing reaches cannot be part of what the user sees, so
// removing it cannot change the app.
//
// 🔒 IT NEVER REMOVES WHAT THE USER MAY HAVE ASKED FOR. The list it is handed is already the strict one
// (`orphansToHandBack`: written by THIS build, provably unreferenced, not a test, type file or UI-kit part). On top,
// a file whose name shares a word with the user's request ("add a loading spinner" → LoadingSpinner) is KEPT: then
// it is an unfinished request, which the warning must keep showing, never a leftover to tidy away.
// Kill switch: AGENTV3_LEFTOVER_REMOVE=off. PURE, except `applyLeftoverNet` at the end (the route's one call).

export function leftoverRemovalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_LEFTOVER_REMOVE ?? '').trim().toLowerCase() !== 'off';
}

/** The words of a component's file name: `LoadingSpinner.tsx` → loading, spinner; `todo-item.tsx` → todo, item. */
export function nameWords(path: string): string[] {
  const base = String(path ?? '').split('/').pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '');
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3);
}

export interface LeftoverDecision {
  remove: string[];
  keep: Array<{ path: string; word: string }>;
}

/** Which of these unreferenced files this build wrote are leftovers to remove, and which the request may name. PURE. */
export function leftoversToRemove(orphans: readonly string[], request: string, env: NodeJS.ProcessEnv = process.env): LeftoverDecision {
  if (!leftoverRemovalEnabled(env)) return { remove: [], keep: [] };
  const asked = new Set(String(request ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const remove: string[] = [];
  const keep: Array<{ path: string; word: string }> = [];
  for (const path of [...new Set(orphans)].filter(Boolean)) {
    const word = nameWords(path).find((w) => asked.has(w) || asked.has(`${w}s`) || (w.endsWith('s') && asked.has(w.slice(0, -1))));
    if (word) keep.push({ path, word });
    else remove.push(path);
  }
  return { remove, keep };
}

/** The report line. '' when nothing was removed or kept. PURE. */
export function leftoverNote(removed: readonly string[], kept: ReadonlyArray<{ path: string; word: string }>): string {
  const parts: string[] = [];
  if (removed.length) {
    parts.push(`Removed ${removed.length} component file(s) this build wrote that nothing in the app imports and the request never named: ${removed.join(', ')} — the hand-back named them and the model left them; nothing on screen changes.`);
  }
  if (kept.length) {
    parts.push(`Kept ${kept.map((k) => `${k.path} (the request says "${k.word}")`).join(', ')} — unreferenced, but the user may have asked for it, so it stays an open warning.`);
  }
  return parts.join(' ');
}

/** What `applyLeftoverNet` needs from the dispatcher and the report — narrow on purpose. */
export interface LeftoverNetDeps {
  undefinedClassesNow(): Promise<{ orphans?: string[] }>;
  removeLeftoverFiles(paths: readonly string[]): Promise<string[]>;
}
export interface LeftoverNetReport {
  record(issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): void;
  retract(code: string, messageIncludes: string, why: string): number;
}

/**
 * The route's one call, after the build loop: remove the leftovers, record what was removed and kept, and withdraw
 * the readiness line that named them once it is false. Best-effort: any failure leaves the hand-back and the
 * warning exactly as they were. Never throws.
 */
export async function applyLeftoverNet(dispatcher: LeftoverNetDeps, report: LeftoverNetReport, request: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  try {
    if (!leftoverRemovalEnabled(env)) return [];
    const orphans = (await dispatcher.undefinedClassesNow()).orphans ?? [];
    if (orphans.length === 0) return [];
    const decision = leftoversToRemove(orphans, request, env);
    const removed = decision.remove.length ? await dispatcher.removeLeftoverFiles(decision.remove) : [];
    const line = leftoverNote(removed, decision.keep);
    if (line) report.record({ phase: 'build', severity: 'info', code: 'LEFTOVER_COMPONENTS', message: line, autoResolved: true });
    // Only the line that counted exactly these files: Readiness counts every unused component, including the
    // user's own, and a line naming more than we removed is still true.
    if (removed.length && removed.length === orphans.length) {
      report.retract('READINESS_WARNING', `${removed.length} component(s) created but never used: ${removed[0]}`, `removed as leftovers nothing imports (${removed.join(', ')})`);
    }
    return removed;
  } catch {
    return [];
  }
}
