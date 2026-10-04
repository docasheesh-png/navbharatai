// AgentV3 — a project-module turn withdraws the whole-app time estimate (autopsy 0311186f, 2026-10-04).
//
// The ETA is computed from the REQUEST before Software Project Mode decides that this turn builds only
// one module of it. An 8-module forex app was promised "~9–10 min — how long 28 recent builds of this kind
// of app took", and the turn, which built two type files, ended in 1.9 min; the next turn, "continue", was
// promised 7–12 min and took 1.5. The report then judged both turns "0.2× the midpoint and UNDER the band",
// a measurement of the estimate against a job it never described.
//
// No module-sized estimate is invented here: nothing measures how long a module takes yet, and a guess
// in place of the withdrawn figure would repeat the mistake. The user is told the earlier figure was for
// the whole app; the elapsed-time heartbeat still runs. PURE.

/** The line that replaces the opening ETA when a turn builds one module. */
export function moduleTurnEtaLine(done: number, total: number, moduleName: string, estimateShown = true): string {
  const n = Math.max(0, Math.floor(Number(done) || 0)) + 1;
  const of = Math.max(n, Math.floor(Number(total) || 0));
  const name = String(moduleName ?? '').trim();
  const head = `⏱️ This round builds one part of your app: module ${n} of ${of}${name ? ` ("${name}")` : ''}.`;
  return estimateShown
    ? `${head} The time estimate above was for the whole app, so it does not apply to this round.`
    : head;
}

/**
 * Is this turn a "continue" of a stored project plan that still has a module to build? Then the opening
 * ETA is not shown at all (autopsy Sur Taal, 2026-10-04): it described the whole app and was withdrawn
 * a few seconds later on every module turn, so the user read a promise and its retraction back to back.
 * A first turn of a NEW plan still shows it — the plan does not exist until after the estimate. PURE.
 */
export function skipsOpeningEta(
  plan: { modules: ReadonlyArray<{ status?: string }> } | null | undefined,
  continuation: boolean,
  hasBuildableModule: (plan: any) => boolean,
): boolean {
  if (!continuation || !plan || !Array.isArray(plan.modules) || plan.modules.length === 0) return false;
  if (plan.modules.every((m) => m.status === 'done')) return false;
  try { return hasBuildableModule(plan); } catch { return false; }
}

/** The admin line recording the withdrawal. */
export function moduleTurnEtaNote(done: number, total: number, moduleName: string): string {
  return `ETA withdrawn: this turn builds module ${Math.max(0, Math.floor(Number(done) || 0)) + 1} of `
    + `${Math.max(1, Math.floor(Number(total) || 0))} ("${String(moduleName ?? '').trim()}"), and the opening estimate `
    + 'described the whole request. The accuracy line is not computed for this turn.';
}
