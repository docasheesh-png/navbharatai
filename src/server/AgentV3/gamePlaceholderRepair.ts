/**
 * 🧸🔧 ONE BOUNDED IN-BUILD REPAIR FOR A PLACEHOLDER (Q-3374, admin-approved 2026-11-26: "baaki sab build karo").
 *
 * THE GAP. The placeholder look (gamePlaceholderProbe.ts) sees a game that PLAYS while showing a stand-in. Until now its
 * findings only became a builder-only note for the NEXT game turn: the user got the stand-in, and the fix waited for a
 * turn they might never take. Automatic game repair stays suspended for everything else (gameRepair.ts) because its way
 * back was a text map; this repair has a real way back (gameWorkspaceBackup.ts) and a narrow, admin-approved scope.
 *
 * THE SCOPE — exactly two kinds, and only when they are ALL the look found:
 *   • MISSING_MODEL — a model the code names whose file is not there (the loader draws the code-built stand-in);
 *   • EMPTY_MAP — after a round of play the scene drew a bare plane.
 * Both are fixed by changing the game's own source (point the loader at a model the project has, put the kit's world on
 * the map). The other kinds (a frozen character, a player under water, hidden controls, a failed texture) stay next-turn.
 *
 * THE RULE, every step decided here, every side effect injected:
 *   1. a complete byte-preserving backup, or no repair (the backup refuses ⇒ the finding stays next-turn, said so);
 *   2. ONE repair pass with FILE tools only, inside a hard time cap and a hard token cap, paid by the platform;
 *   3. the game is played again by the same playtest;
 *   4. KEPT only when the replay is strictly better: fewer placeholder findings, no placeholder kind it did not have,
 *      no measured defect it did not have, and a playtest score not lower — otherwise every byte is put back and the
 *      restore is verified against the backup's manifest. A restore that cannot be verified is said loudly, never hidden.
 * Kill switch: AGENTV3_GAME_PLACEHOLDER_REPAIR=off (back to next-turn only). PURE except the env read.
 */
import type { PlaceholderFinding, PlaceholderKind } from './gamePlaceholderProbe';
import { isOutsideBackup, type BackupResult, type RestoreResult } from './gameWorkspaceBackup';
import { PLATFORM_CHECKS_THE_FIX } from './repairScope';
import { passAbort } from './buildAbortCause';

export const GAME_PLACEHOLDER_REPAIR_CODE = 'GAME_PLACEHOLDER_REPAIR';

/** The only kinds this repair takes on. */
export const REPAIRABLE_PLACEHOLDERS: ReadonlySet<PlaceholderKind> = new Set<PlaceholderKind>(['MISSING_MODEL', 'EMPTY_MAP']);

/** The hard caps of the one pass (the platform pays it, so it is small on purpose). */
export const PLACEHOLDER_REPAIR_MAX_MS = 120_000;
export const PLACEHOLDER_REPAIR_MIN_MS = 45_000;
/** Input + output tokens of the whole pass, every turn summed. Reaching it stops the pass, which is then undone. */
export const PLACEHOLDER_REPAIR_TOKEN_CAP = 160_000;
export const PLACEHOLDER_REPAIR_MAX_STEPS = 8;
export const PLACEHOLDER_REPAIR_MAX_TOKENS_PER_TURN = 12_000;
/** What the rest of the pass needs besides the repair: backup + replay (90 s round + its margin) + restore + slack. */
export const PLACEHOLDER_REPAIR_RESERVE_MS = 30_000 + 110_000 + 30_000 + 15_000;
/** How long a pass that hit a cap gets to stand down before the way back starts. */
export const PLACEHOLDER_REPAIR_SETTLE_MS = 15_000;

/**
 * The repair's tools: read and write project files, nothing else — no shell, no installer, no recipe, no browser, no
 * helper. So it cannot install, move or delete anything by command, and every file it can write is inside the project. A
 * write into a dependency folder (the one place the backup does not cover) is never kept and is reported as not restorable.
 * Every other name is REFUSED, not merely hidden (`onlyTheseTools`, repairScope.ts).
 */
export const PLACEHOLDER_REPAIR_TOOLS: ReadonlySet<string> = new Set(['read_file', 'write_file', 'edit_file', 'write_files_batch', 'grep', 'glob']);

export function placeholderRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_PLACEHOLDER_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

/** Only MISSING_MODEL and/or EMPTY_MAP, and nothing else, may be repaired in the build. PURE. */
export function placeholderRepairEligible(findings: readonly PlaceholderFinding[] | null | undefined): boolean {
  const list = Array.isArray(findings) ? findings : [];
  return list.length > 0 && list.every((f) => REPAIRABLE_PLACEHOLDERS.has(f.kind));
}

/** The repair's time, from the build time left; 0 = not enough for a repair AND its replay AND a way back. PURE. */
export function placeholderRepairMs(headroomMs: number): number {
  const usable = Number(headroomMs) - PLACEHOLDER_REPAIR_RESERVE_MS;
  if (!Number.isFinite(usable) || usable < PLACEHOLDER_REPAIR_MIN_MS) return 0;
  return Math.min(usable, PLACEHOLDER_REPAIR_MAX_MS);
}

/** The one prompt: the measured stand-ins, the file-only toolset, and that the platform plays the game again. PURE. */
export function placeholderRepairPrompt(userPrompt: string, findings: readonly PlaceholderFinding[]): string {
  return [
    'NavBharatAI PLAYED this game in a real browser and saw a stand-in where the real thing should be. Fix ONLY these, at their root,',
    'by changing the game\'s own source files. You have file tools only (read, write, edit, search) — no shell, no installer.',
    'Never delete a feature to hide a finding, and keep everything that already works.',
    PLATFORM_CHECKS_THE_FIX,
    '',
    `The user's request: ${String(userPrompt ?? '').slice(0, 1200)}`,
    '',
    ...findings.slice(0, 6).map((f, i) => `${i + 1}. ${f.kind}: ${f.evidence}. Fix: ${f.fix}.`),
  ].join('\n');
}

/** What a play measured, for the keep-or-undo judgement. */
export interface PlaceholderMeasure {
  placeholders: readonly PlaceholderFinding[];
  defects: readonly string[];
  score: number | null;
  /** Named features the game's code no longer has (scopeMatch) — a repair may never remove one. */
  scopeMissing?: readonly string[];
  /** The playtest's own answer: was the game played (not "could not look")? */
  played: boolean;
}

/** Strictly better: fewer stand-ins, none new, no new defect, no named feature lost, a score not lower, and played. PURE. */
export function placeholderReplayBetter(before: PlaceholderMeasure, after: PlaceholderMeasure | null): { better: boolean; reason: string } {
  if (!after || !after.played) return { better: false, reason: 'the game could not be played again after the repair' };
  const hadKinds = new Set(before.placeholders.map((f) => f.kind));
  const newKind = after.placeholders.find((f) => !hadKinds.has(f.kind));
  if (newKind) return { better: false, reason: `the repair brought a new stand-in (${newKind.kind})` };
  const hadDefects = new Set(before.defects);
  const newDefect = after.defects.find((d) => !hadDefects.has(d));
  if (newDefect) return { better: false, reason: `the repair brought a new defect (${newDefect})` };
  const hadScope = new Set(before.scopeMissing ?? []);
  const lostFeature = (after.scopeMissing ?? []).find((f) => !hadScope.has(f));
  if (lostFeature) return { better: false, reason: `the repair removed a feature the user asked for (${lostFeature})` };
  if (before.score !== null && (after.score === null || after.score < before.score)) {
    return { better: false, reason: `the playtest score went down (${before.score} → ${after.score ?? 'none'})` };
  }
  if (after.placeholders.length >= before.placeholders.length) {
    return { better: false, reason: `the stand-ins did not go down (${before.placeholders.length} → ${after.placeholders.length})` };
  }
  return { better: true, reason: `stand-ins ${before.placeholders.length} → ${after.placeholders.length}, score ${before.score ?? 'none'} → ${after.score ?? 'none'}` };
}

export interface PlaceholderRepairIO<R> {
  backup: () => Promise<BackupResult>;
  /** Run the one pass. `stop` ends it early (the token cap). Resolves true when the runner finished. */
  repair: (prompt: string, ctl: { signal: AbortSignal; stop: () => void }) => Promise<boolean>;
  /** Paths the pass wrote (from the build's captured writes). */
  touched: () => string[];
  /** Play the game again; null when it could not be played. `R` is the phase's own result, handed back when kept. */
  replay: () => Promise<{ measure: PlaceholderMeasure; result: R } | null>;
  restore: () => Promise<RestoreResult>;
  cleanup: () => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface PlaceholderRepairOutcome<R> {
  attempted: boolean;
  kept: boolean;
  /** 'kept' | 'undone' | 'no-change' | 'skipped' | 'restore-unverified' */
  state: 'kept' | 'undone' | 'no-change' | 'skipped' | 'restore-unverified';
  reason: string;
  kinds: PlaceholderKind[];
  before: number;
  after: number | null;
  touched: string[];
  timedOut: boolean;
  tokenCapped: boolean;
  repairMs: number;
  result?: R;
}

export async function runPlaceholderRepair<R>(
  input: { findings: readonly PlaceholderFinding[]; before: PlaceholderMeasure; userPrompt: string; repairMs: number; buildSignal: AbortSignal; tokenCapped: () => boolean },
  io: PlaceholderRepairIO<R>,
): Promise<PlaceholderRepairOutcome<R>> {
  const kinds = [...new Set(input.findings.map((f) => f.kind))];
  const base = { kinds, before: input.findings.length, after: null as number | null, touched: [] as string[], timedOut: false, tokenCapped: false, repairMs: input.repairMs };
  const skipped = (reason: string): PlaceholderRepairOutcome<R> => ({ ...base, attempted: false, kept: false, state: 'skipped', reason });
  if (!placeholderRepairEligible(input.findings)) return skipped('the findings are not only a missing model and/or an empty map');
  if (input.repairMs <= 0) return skipped('not enough build time left for a repair, its replay and a way back');
  if (input.buildSignal.aborted) return skipped('the build was stopped');
  let backup: BackupResult;
  try { backup = await io.backup(); } catch (e) { backup = { ok: false, reason: `the backup threw (${String((e as Error)?.message ?? e).slice(0, 120)})` }; }
  if (!backup.ok) return skipped(`no complete backup of the project could be taken: ${backup.reason}`);

  const setTimer = io.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = io.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const abort = passAbort(input.buildSignal);
  let finished = false;
  let timedOut = false;
  try {
    const run = io.repair(placeholderRepairPrompt(input.userPrompt, input.findings), { signal: abort.signal, stop: () => abort.abort('repair-budget') });
    let handle: unknown;
    const outcome = await Promise.race([
      run.then((ok) => (ok ? 'ok' : 'not-finished'), () => 'not-finished' as const),
      new Promise<'timeout'>((res) => { handle = setTimer(() => res('timeout'), input.repairMs); }),
    ]);
    if (handle !== undefined) clearTimer(handle);
    if (outcome === 'timeout') {
      timedOut = true;
      abort.abort('repair-budget');
      await Promise.race([run.catch(() => undefined), new Promise((res) => setTimer(() => res(undefined), PLACEHOLDER_REPAIR_SETTLE_MS))]);
    } else {
      finished = outcome === 'ok' && !abort.signal.aborted;
    }
  } finally {
    abort.dispose();
    abort.abort('repair-budget'); // nothing of the pass may start after this point
  }
  const tokenCapped = input.tokenCapped();
  const touched = [...new Set(io.touched())];
  const done = { ...base, touched, timedOut, tokenCapped };

  const undo = async (reason: string, after: number | null, outside: string[] = []): Promise<PlaceholderRepairOutcome<R>> => {
    let restored: RestoreResult;
    try { restored = await io.restore(); } catch (e) { restored = { ok: false, verified: false, reason: `the restore threw (${String((e as Error)?.message ?? e).slice(0, 120)})` }; }
    if (!restored.ok) {
      // The backup is KEPT for recovery: it is the only exact copy of the game from before the repair.
      return { ...done, after, attempted: true, kept: false, state: 'restore-unverified', reason: `${reason}; putting the files back could not be verified: ${restored.reason}` };
    }
    if (outside.length) {
      return { ...done, after, attempted: true, kept: false, state: 'restore-unverified', reason: `${reason}; the rest was put back and verified, but those paths are outside the backup and could not be` };
    }
    await io.cleanup().catch(() => undefined);
    return { ...done, after, attempted: true, kept: false, state: 'undone', reason };
  };

  // A write the backup does not cover (a dependency folder) cannot be put back exactly — never kept, never hidden.
  const outside = touched.filter(isOutsideBackup);
  if (outside.length) {
    return undo(`the repair wrote where the backup does not reach (${outside.slice(0, 3).join(', ')})`, null, outside);
  }
  if (!finished) {
    return undo(timedOut ? 'the repair did not finish within its time cap' : tokenCapped ? 'the repair reached its token cap' : input.buildSignal.aborted ? 'the build was stopped during the repair' : 'the repair did not finish', null);
  }
  if (touched.length === 0) {
    await io.cleanup().catch(() => undefined);
    return { ...done, attempted: true, kept: false, state: 'no-change', reason: 'the repair finished without changing a file' };
  }
  let replay: Awaited<ReturnType<typeof io.replay>> = null;
  try { replay = input.buildSignal.aborted ? null : await io.replay(); } catch { replay = null; }
  const verdict = placeholderReplayBetter(input.before, replay?.measure ?? null);
  const after = replay ? replay.measure.placeholders.length : null;
  if (!verdict.better || !replay) return undo(verdict.reason, after);
  await io.cleanup().catch(() => undefined);
  return { ...done, after, attempted: true, kept: true, state: 'kept', reason: verdict.reason, result: replay.result };
}

/** The build report line (admin). Never a gate, never a charge. PURE. */
export function placeholderRepairRecord(o: PlaceholderRepairOutcome<unknown>): { code: string; severity: 'info' | 'warning'; autoResolved: boolean; message: string } {
  const what = `${o.kinds.join(' + ') || 'placeholders'}`;
  const caps = `${Math.round(o.repairMs / 1000)} s and ${PLACEHOLDER_REPAIR_TOKEN_CAP.toLocaleString('en-US')} tokens cap`;
  const files = o.touched.length ? ` Files the repair wrote: ${o.touched.slice(0, 8).join(', ')}${o.touched.length > 8 ? ', …' : ''}.` : '';
  const paid = ' Repair cost absorbed by the platform.';
  switch (o.state) {
    case 'skipped':
      return { code: GAME_PLACEHOLDER_REPAIR_CODE, severity: 'info', autoResolved: true, message: `In-build placeholder repair not tried (${what}): ${o.reason}. The next game turn's builder gets the finding instead.` };
    case 'kept':
      return { code: GAME_PLACEHOLDER_REPAIR_CODE, severity: 'info', autoResolved: true, message: `In-build placeholder repair tried and KEPT (${what}, ${caps}): the replay (a second full play of the game) is strictly better — ${o.reason}.${files}${paid}` };
    case 'no-change':
      return { code: GAME_PLACEHOLDER_REPAIR_CODE, severity: 'info', autoResolved: true, message: `In-build placeholder repair tried (${what}, ${caps}) and changed nothing, so there was nothing to keep; the next game turn's builder gets the finding.${paid}` };
    case 'undone':
      return { code: GAME_PLACEHOLDER_REPAIR_CODE, severity: 'info', autoResolved: true, message: `In-build placeholder repair tried and DISCARDED (${what}, ${caps}): ${o.reason}. Every file was put back exactly and the restore was verified against the backup.${files}${paid}` };
    default:
      return { code: GAME_PLACEHOLDER_REPAIR_CODE, severity: 'warning', autoResolved: false, message: `In-build placeholder repair tried and DISCARDED (${what}): ${o.reason}. The backup of the game from before the repair is kept in the sandbox for recovery.${files}${paid}` };
  }
}
