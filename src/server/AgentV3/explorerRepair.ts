// AgentV3 — A BUTTON THE CLICK EXPLORER FOUND BROKEN GETS ONE VERIFIED REPAIR (admin 2026-09-28:
// "han dono ho jaye to bahut accha rahe! aap isko real engineering kar ke, world class banao").
//
// THE GAP. `clickExplorer.ts` presses every safe control of a finished app in a real browser and
// names the ones that crash it, blank it, lead nowhere or throw. Until now it could only REPORT them:
// the user read "Pressing "Settings" left the screen blank" in their build card and had to ask for a
// fix themselves. That is the one kind of bug this platform has the strongest evidence for — a real
// browser, a real press, a real failure, attributable to exactly one control — and it was the one
// kind nothing ever repaired.
//
// WHAT THIS DOES. One bounded repair pass, handed the failures in plain words (which control, on
// which screen, what happened, what the browser said). Then the app is opened again in a real browser
// and EVERY button is pressed again, not only the broken ones. The change is kept only when all three
// are true:
//   • the app still renders;
//   • at least one control that was broken now works — PRESSED, not merely present (a repair that
//     deletes the broken button has not fixed it, and is not counted as having done so);
//   • no control that worked before is broken now.
// Anything else is undone to the exact version that rendered, and the user is told the truth.
//
// 🔒 WHY THIS IS STRICTER THAN `verifyAfterFix` ALONE. That helper KEEPS a change whose re-check
// could not run ("unproven"), which is right for a crash the user can see and wrong for an edit to a
// working app. Here an unfinished repair, a re-check that threw, and a re-check that proved nothing
// all UNDO the change (`strictReverify`). On a working app an unproven edit is never kept.
//
// 🔒 IT NEVER COSTS THE USER FOR NOTHING. The repair runs inside its own billing phase; when it is
// undone, that phase is barren and its cost is ours (`PHASE_EXPLORER_REPAIR`, billingPhase.ts).
//
// PURE. Every side effect (snapshot, repair, re-render, re-explore, revert) is injected, so the whole
// keep-or-undo decision is unit-tested without a sandbox, a browser or a model.

import { pressName, FAILING_VERDICTS, type ExploreRun, type PressResult, type PressVerdict, type UserProof } from './clickExplorer';
import { strictReverify, verifyAfterFix } from './verifyAfterFix';
import { PLATFORM_CHECKS_THE_FIX } from './repairScope';

/** The green-freeze pass name (greenFreeze.ts ALLOWED_PASSES) and the billing phase share this word. */
export const EXPLORER_REPAIR_PASS = 'explorer-repair';

/** Kill switch. Default ON; `off` restores report-only exactly. */
export function explorerRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_EXPLORER_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

// The explorer's own set, never a copy: a failure kind it reports is one this repairs (see FAILING_VERDICTS).
const FAILING: ReadonlySet<PressVerdict> = FAILING_VERDICTS;

/** At most this many broken controls are handed to one pass — one focused repair, not a rebuild. */
export const MAX_REPAIR_TARGETS = 5;

/** The failures one repair may take on, de-duplicated by the name a person reads. PURE. */
export function repairTargets(run: ExploreRun | null | undefined): PressResult[] {
  const out: PressResult[] = [];
  const seen = new Set<string>();
  for (const p of run?.presses ?? []) {
    if (!FAILING.has(p.verdict)) continue;
    const key = pressName(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= MAX_REPAIR_TARGETS) break;
  }
  return out;
}

/**
 * 🔴 A REPAIR THAT INVENTS THE RESULT IS NOT A REPAIR (autopsy a9f8d186, 2026-09-30).
 *
 * "Start Recognition" threw `NotFoundError: Requested device not found` — the checking browser has no
 * microphone. The instruction was "fix it so the control does what its label says", which with no
 * microphone can only be met by pretending: the repair made a missing microphone show a DEMO TRACK as
 * the identified song after four seconds, the re-press saw no error, and the fake was kept and shipped.
 *
 * A control whose failure is a missing DEVICE (camera, microphone, location) or a refused permission is
 * fixed by handling that case honestly, never by fabricating what the device would have produced.
 */
const ABSENT_DEVICE_ERROR = /NotFoundError|NotAllowedError|NotReadableError|OverconstrainedError|requested device not found|permission (?:denied|dismissed)|getUserMedia|mediaDevices|geolocation|could not start (?:audio|video) source/i;

export function needsAbsentDevice(errors: readonly string[]): boolean {
  return errors.some((e) => ABSENT_DEVICE_ERROR.test(String(e ?? '')));
}

const DEVICE_FIX = 'The checking browser has no camera or microphone, so this is the case a real user hits when their device has none or they refuse permission. Catch that error where the device is requested and show a clear message on screen (for example "No microphone found" or "Microphone permission was refused — allow it in your browser settings"), leaving the control usable so the user can try again.';

const NO_INVENTED_RESULT = 'Never make the control appear to work by showing sample, demo or random data in place of the real result.';

/**
 * One concrete instruction per broken control, in the words a developer can act on. Each names the
 * control, where it lives, what the browser saw, and — the part a model most needs told — that
 * removing or disabling the control is not a fix. PURE.
 */
export function explorerRepairFindings(targets: PressResult[]): string[] {
  return targets.map((p) => {
    const where = p.via ? ` (it appears after opening "${p.via}")` : '';
    const said = p.errors.length ? ` The browser reported: "${p.errors[0].replace(/\s+/g, ' ').slice(0, 180)}".` : '';
    const doing = p.kind === 'type' ? 'typing into' : p.kind === 'pick' ? 'changing' : 'pressing';
    const what = p.verdict === 'crashed'
      ? 'crashes the app into an error screen'
      : p.verdict === 'blank'
        ? 'leaves the whole screen blank'
        : p.verdict === 'broken-link'
          ? 'opens a page that does not exist'
          : p.verdict === 'unresponsive'
            ? `changes nothing on the screen (${p.note})`
            : p.verdict === 'covered'
              ? `is impossible — ${p.note}, so a user cannot reach the control at all`
              : 'throws an error in the app';
    const fix = p.verdict === 'broken-link'
      ? 'Create the page it points to with real content, or point it at a page that exists.'
      : p.verdict === 'unresponsive'
        ? (p.kind === 'pick'
          ? 'Wire the menu to the list it sits above so choosing an option really sorts or filters that list.'
          : 'Wire the box to the list it sits above so typing really filters that list as the user types.')
        : p.verdict === 'covered'
          ? 'Fix the stacking so the control sits ABOVE whatever is over it and can be clicked: give the menu or overlay that holds it a higher z-index than the element on top, and make sure a full-screen canvas, image or backdrop does not sit over the controls (or does not receive pointer events) while they are meant to be used.'
          : needsAbsentDevice(p.errors)
            ? DEVICE_FIX
            : 'Find the cause in the code that runs when it is used and fix it so the control does what its label says.';
    return `In a real browser, ${doing} "${p.label}"${where} ${what}.${said} ${fix} Do not remove, hide or disable the control — that is not a fix. ${NO_INVENTED_RESULT}`;
  });
}

/**
 * The explorer repair's own instruction (autopsy 6cd698cc). It used to be handed the code reviewer's prompt —
 * "a strict code review found…", ending "After fixing, verify the app builds and the requested feature genuinely
 * works" — so a correct fix was followed by the model's own build, dev server and browser, the budget ran out
 * mid-press and the fix was undone. The evidence here is a real browser press, and the platform presses every
 * button again itself (repairScope.ts). PURE.
 */
export function explorerRepairPrompt(userRequest: string, findings: readonly string[]): string {
  const list = findings.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    'The app for this request is ALREADY built in the current workspace and it renders. A real browser test then',
    'pressed its controls one by one and found these problems:',
    '',
    list,
    '',
    'Read the code that runs for each control and FIX the cause by editing the existing files (never rebuild,',
    'keep everything that works).',
    '',
    PLATFORM_CHECKS_THE_FIX,
    '',
    `Original request, for reference: ${String(userRequest ?? '').slice(0, 800)}`,
  ].join('\n');
}

// ── The budget ──────────────────────────────────────────────────────────────────────────────────────

/** One re-render (35 s) plus the full re-explore (its 75 s budget and the 20 s wrapper around it). */
export const EXPLORER_REPAIR_VERIFY_RESERVE_MS = 35_000 + 75_000 + 20_000;
/** Room after verification for the build's own settle and a possible revert. */
export const EXPLORER_REPAIR_SETTLE_SLACK_MS = 30_000;
/** Below this there is no honest repair to attempt; the failures stay reported. */
export const EXPLORER_REPAIR_MIN_MS = 40_000;
/** Never more than this, however much time is left — it is one focused pass. */
export const EXPLORER_REPAIR_MAX_MS = 150_000;

/**
 * How long the repair may run, sized from the BUILD's remaining wall clock so the whole attempt —
 * repair, re-render, re-press, revert — finishes inside it. 0 ⇒ do not start. `headroomMs` is Infinity
 * when the build has no wall clock. PURE.
 */
export function explorerRepairPlan(headroomMs: number): { repairMs: number } {
  if (Number.isNaN(headroomMs)) return { repairMs: 0 };
  const usable = headroomMs - EXPLORER_REPAIR_VERIFY_RESERVE_MS - EXPLORER_REPAIR_SETTLE_SLACK_MS;
  if (!(usable >= EXPLORER_REPAIR_MIN_MS)) return { repairMs: 0 };
  return { repairMs: Math.min(usable, EXPLORER_REPAIR_MAX_MS) };
}

// ── Who may be repaired, and who pays ───────────────────────────────────────────────────────────────

export type ExplorerRepairTierGate =
  | { attempt: true; countAgainstWeakBudget: boolean }
  | { attempt: false; reason: string };

/**
 * Normal and Strong: always — the user is paying for a working app and this is how they get one.
 * Weak: under the platform's daily allowance (`explorerRepairBudget.ts`), because on the free tier the
 * spend is NavBharatAI's own gift credit. A free-listed account is neither counted nor refused: it is
 * how the repair gets verified at all. `weakAllowed` is the budget's answer; unreadable ⇒ refused
 * (the budget fails closed). PURE.
 */
export function explorerRepairTierGate(input: { tier: string; freeListed: boolean; weakAllowed: boolean | null }): ExplorerRepairTierGate {
  const weak = String(input.tier ?? '').trim().toLowerCase() === 'weak';
  if (!weak || input.freeListed) return { attempt: true, countAgainstWeakBudget: false };
  if (input.weakAllowed === true) return { attempt: true, countAgainstWeakBudget: true };
  return { attempt: false, reason: input.weakAllowed === null
    ? 'the free tier\'s daily repair allowance could not be read'
    : 'the free tier\'s daily repair allowance is used up' };
}

// ── The judgement ───────────────────────────────────────────────────────────────────────────────────

export interface ExplorerRepairJudgement {
  keep: boolean;
  /** Broken before, pressed and working after. The only thing that counts as fixed. */
  fixed: string[];
  /** Broken before and still broken, or not reached again, after. */
  stillBroken: string[];
  /** Worked before and broken after — any one of these undoes the repair. */
  regressions: string[];
  /**
   * EVERY control the re-press found failing, targets or not. Empty only when the explorer looked
   * again and saw nothing broken — the one condition under which its earlier `EXPLORE_FAILED` may be
   * cleared (BuildDiagnostics.resolveOnRecheck).
   */
  remaining: string[];
  /** Why the change was not kept, in one clause; '' when kept. */
  reason: string;
}

/**
 * Keep the repair only if the app still renders, something broken now works, and nothing that worked
 * is now broken. PURE — the three facts are handed in; nothing is re-measured here.
 */
export function judgeExplorerRepair(
  targets: PressResult[],
  before: ExploreRun,
  after: ExploreRun | null,
  rendersAfter: boolean,
): ExplorerRepairJudgement {
  const names = targets.map(pressName);
  const none = (reason: string): ExplorerRepairJudgement => ({ keep: false, fixed: [], stillBroken: names, regressions: [], remaining: names, reason });
  if (!rendersAfter) return none('the app could not be shown to still render afterwards');
  if (!after || !after.summary || !after.summary.loaded) return none('the app could not be opened again to press its buttons');

  const pressed = new Map<string, PressVerdict>();
  for (const p of after.presses) if (p.verdict !== 'skipped') pressed.set(pressName(p), p.verdict);
  const workedBefore = new Set(before.presses.filter((p) => p.verdict === 'ok').map(pressName));

  const fixed = names.filter((n) => pressed.get(n) === 'ok');
  const stillBroken = names.filter((n) => pressed.get(n) !== 'ok');
  const regressions = [...pressed.entries()]
    .filter(([n, v]) => FAILING.has(v) && workedBefore.has(n))
    .map(([n]) => n);

  const remaining = [...pressed.entries()].filter(([, v]) => FAILING.has(v)).map(([n]) => n);

  if (regressions.length > 0) return { keep: false, fixed, stillBroken, regressions, remaining, reason: `it broke ${regressions.length} control(s) that worked before` };
  if (fixed.length === 0) return { keep: false, fixed, stillBroken, regressions, remaining, reason: 'pressing them again showed none of the broken controls working' };
  return { keep: true, fixed, stillBroken, regressions, remaining, reason: '' };
}

// ── The orchestration ───────────────────────────────────────────────────────────────────────────────

export interface ExplorerRepairDeps {
  /** The repair's own time limit (from `explorerRepairPlan`). */
  repairMs: number;
  /** The working app, captured by the caller BEFORE the repair — never taken inside the net. */
  snapshot: Record<string, string>;
  /** Run ONE repair pass with these findings; resolves to whether it completed. Must honour `signal`. */
  repair: (findings: string[], signal: AbortSignal) => Promise<boolean>;
  /** How many files differ from the snapshot now; undefined when that could not be counted. */
  changedSince: (snapshot: Record<string, string>) => Promise<number | undefined>;
  /** Does the app render in a real browser now? */
  renders: () => Promise<boolean>;
  /** Press every safe control again; null when the run produced nothing usable. */
  explore: () => Promise<ExploreRun | null>;
  /** Put the snapshot back exactly (sandbox, durable store, captured writes). */
  revert: (snapshot: Record<string, string>) => Promise<void>;
  /** The build's own abort — stopping the build stops the repair. */
  buildSignal?: AbortSignal;
  /** How long to let a timed-out repair settle before anything is reverted. */
  settleMs?: number;
  /** Test seam for timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ExplorerRepairOutcome {
  kept: boolean;
  reverted: boolean;
  timedOut: boolean;
  finished: boolean;
  /** Files the pass changed, measured against the snapshot. */
  changed?: number;
  judgement: ExplorerRepairJudgement | null;
  targets: number;
  budgetMs: number;
}

/**
 * Repair, re-verify, keep or undo. A repair that runs out of time is aborted and given a moment to
 * settle before the snapshot goes back — a runner still writing while files are restored would leave
 * a hybrid. A repair that changed nothing is not "kept": there is nothing to keep and nothing fixed.
 */
export async function runExplorerRepair(targets: PressResult[], before: ExploreRun, deps: ExplorerRepairDeps): Promise<ExplorerRepairOutcome> {
  const findings = explorerRepairFindings(targets);
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const abort = new AbortController();
  const stopWithBuild = () => abort.abort();
  deps.buildSignal?.addEventListener('abort', stopWithBuild);

  let finished = false;
  let timedOut = false;
  let changed: number | undefined;
  let judgement: ExplorerRepairJudgement | null = null;
  try {
    if (deps.buildSignal?.aborted) abort.abort();
    const vr = await verifyAfterFix<Record<string, string>>({
      snapshot: async () => deps.snapshot,
      apply: async () => {
        const run = deps.repair(findings, abort.signal);
        let handle: unknown;
        const outcome = await Promise.race([
          run.then((ok) => ({ ok: !!ok }), () => ({ ok: false })),
          new Promise<'timeout'>((res) => { handle = setTimer(() => res('timeout'), deps.repairMs); }),
        ]);
        if (handle !== undefined) clearTimer(handle);
        if (outcome === 'timeout') {
          timedOut = true;
          abort.abort();
          await Promise.race([run.catch(() => undefined), new Promise((res) => setTimer(() => res(undefined), deps.settleMs ?? 15_000))]);
          return;
        }
        finished = outcome.ok;
        if (finished) {
          try { changed = await deps.changedSince(deps.snapshot); } catch { changed = undefined; }
        }
      },
      reverify: strictReverify(async () => {
        if (!finished || abort.signal.aborted) return false;
        if (changed === 0) return true; // nothing changed ⇒ it IS the version that rendered
        const renders = await deps.renders();
        const after = renders ? await deps.explore() : null;
        judgement = judgeExplorerRepair(targets, before, after, renders);
        return judgement.keep;
      }),
      revert: deps.revert,
    });
    return { kept: vr.kept && finished && changed !== 0, reverted: vr.reverted, timedOut, finished, changed, judgement, targets: targets.length, budgetMs: deps.repairMs };
  } finally {
    deps.buildSignal?.removeEventListener('abort', stopWithBuild);
    abort.abort();
  }
}

// ── What the admin and the user are told ───────────────────────────────────────────────────────────

/** The admin report line. Codes: EXPLORE_REPAIRED / EXPLORE_REPAIR_NO_CHANGE / EXPLORE_REPAIR_UNDONE. PURE. */
export function explorerRepairOutcomeRecord(o: ExplorerRepairOutcome): { severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean; detail?: string } {
  const j = o.judgement;
  const detail = j ? [
    j.fixed.length ? `Fixed: ${j.fixed.join(', ')}` : '',
    j.stillBroken.length ? `Still broken: ${j.stillBroken.join(', ')}` : '',
    j.regressions.length ? `Newly broken (undone): ${j.regressions.join(', ')}` : '',
  ].filter(Boolean).join('\n') || undefined : undefined;
  if (o.finished && o.changed === 0) {
    return { severity: 'info', code: 'EXPLORE_REPAIR_NO_CHANGE', autoResolved: true, detail,
      message: `A repair of ${o.targets} broken control(s) ran and changed no file — nothing is claimed as fixed.` };
  }
  if (o.kept && j) {
    return { severity: 'info', code: 'EXPLORE_REPAIRED', autoResolved: j.stillBroken.length === 0, detail,
      message: `${j.fixed.length} of ${o.targets} broken control(s) were repaired and pressed again in a real browser; nothing that worked before broke.` };
  }
  const why = o.timedOut
    ? `the repair did not finish inside its ${Math.round(o.budgetMs / 1000)} s budget`
    : !o.finished ? 'the repair pass did not complete'
      : j?.reason || 'it could not be proven';
  if (o.reverted) {
    return { severity: 'info', code: 'EXPLORE_REPAIR_UNDONE', autoResolved: true, detail,
      message: `A repair of ${o.targets} broken control(s) was undone because ${why} — the working version was restored and its cost was not billed.` };
  }
  return { severity: 'warning', code: 'EXPLORE_REPAIR_UNDONE', autoResolved: false, detail,
    message: `A repair of ${o.targets} broken control(s) was not kept, and restoring the working version did not complete — check that the app still renders.` };
}

/**
 * The build card after a repair was attempted. Branded, no codes or vendors. A kept repair says what
 * was fixed and that EVERY button was pressed again; an undone one keeps the original failures in
 * front of the user and says, in one line, that a fix was tried and not kept. PURE.
 */
export function explorerRepairProof(original: UserProof, o: ExplorerRepairOutcome): UserProof {
  const j = o.judgement;
  if (o.kept && j && j.fixed.length > 0) {
    const fixedLines = j.fixed.slice(0, 3).map((n) => `Fixed: ${n} works now.`);
    const rest = j.stillBroken.length ? [`Still broken: ${j.stillBroken.slice(0, 3).join(', ')}.`] : [];
    return {
      ok: j.stillBroken.length === 0,
      headline: j.stillBroken.length === 0 ? 'NavBharatAI found broken buttons and fixed them' : 'NavBharatAI fixed some broken buttons',
      steps: [...fixedLines, ...rest, 'Every button was pressed again in a real browser to check — nothing that worked before broke.'],
    };
  }
  if (!original.headline) return original;
  return { ...original, steps: [...original.steps, 'A fix was tried and undone because it could not be proven — your app is the version that worked, and you were not charged for the attempt.'] };
}

/** The line appended to the user's summary when a repair was kept. '' otherwise. PURE. */
export function explorerRepairUserLine(o: ExplorerRepairOutcome): string {
  const j = o.judgement;
  if (!o.kept || !j || j.fixed.length === 0) return '';
  const n = j.fixed.length;
  const found = o.targets === 1 ? '1 that did not work' : `${o.targets} that did not work`;
  const done = n === o.targets ? (n === 1 ? 'It was fixed' : 'All of them were fixed') : `${n} ${n === 1 ? 'was' : 'were'} fixed`;
  return `\n\n🔧 NavBharatAI pressed every button in your app and found ${found}. ${done}, and every button was pressed again to check.`;
}
