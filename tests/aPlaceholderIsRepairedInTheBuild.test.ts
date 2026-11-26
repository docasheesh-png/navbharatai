/**
 * Q-3374 + Q-3365 — ONE bounded in-build repair for a placeholder, and a kept repair re-records the game's proof.
 *
 * 🧬 THE CLASSES.
 *  (1) A finding the platform had measured waited for a turn the user might never take (Q-3374): the placeholder look only
 *      left a note for the NEXT game turn. Now a missing model and/or an empty map — and only those — get one repair in
 *      the same build, with hard caps, platform-paid, kept only if the game played again is strictly better, and every
 *      byte put back otherwise (the backup itself is proven in aGameRepairCanAlwaysGoBack.test.ts).
 *  (2) A replay that changed what ships while the proof still described the first play (Q-3365): the replay lived in the
 *      route and re-recorded neither GAME_PROOF nor the unverified-feature list. It now lives in the playtest phase and
 *      runs the SAME play as the first, so a kept repair re-records both; a discarded one records nothing about a game
 *      that no longer exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GAME_PLACEHOLDER_REPAIR_CODE, PLACEHOLDER_REPAIR_MAX_MS, PLACEHOLDER_REPAIR_RESERVE_MS, PLACEHOLDER_REPAIR_TOKEN_CAP, PLACEHOLDER_REPAIR_TOOLS,
  placeholderRepairEligible, placeholderRepairEnabled, placeholderRepairMs, placeholderRepairPrompt, placeholderRepairRecord, placeholderReplayBetter,
  runPlaceholderRepair, type PlaceholderMeasure, type PlaceholderRepairIO,
} from '../src/server/AgentV3/gamePlaceholderRepair';
import { GAME_PLACEHOLDER_CODE, PLACEHOLDERS_CLEARED_MESSAGE, placeholderFindingsMessage, placeholderRepairNote, type PlaceholderFinding } from '../src/server/AgentV3/gamePlaceholderProbe';
import {
  REPLAY_PREFIX, runGamePlaceholderRepairPhase, runGamePlaytestPhase, type GamePlaceholderRepairPorts, type GamePlaytestPorts, type PlaytestIssue,
} from '../src/server/AgentV3/buildPhases/gamePlaytestPhase';
import { PLAYTEST_RESULT_MARKER } from '../src/server/AgentV3/gamePlaytest';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { isWithheldTool, onlyTheseTools } from '../src/server/AgentV3/repairScope';

const MODEL: PlaceholderFinding = { kind: 'MISSING_MODEL', evidence: 'the model "car" (public/models/car.glb) is not in the project', fix: 'point it at a model the project has', path: 'public/models/car.glb' };
const EMPTY: PlaceholderFinding = { kind: 'EMPTY_MAP', evidence: 'after a round of play the scene drew only 1 mesh', fix: 'put the world on it' };
const FROZEN: PlaceholderFinding = { kind: 'STATIC_CHARACTER', evidence: 'frozen', fix: 'play its clip' };
const m = (placeholders: PlaceholderFinding[], score: number | null = 70, defects: string[] = [], played = true): PlaceholderMeasure => ({ placeholders, defects, score, played });

describe('scope, caps and the judgement (pure)', () => {
  it('only MISSING_MODEL and/or EMPTY_MAP, and nothing else, are repaired in the build', () => {
    expect(placeholderRepairEligible([MODEL])).toBe(true);
    expect(placeholderRepairEligible([EMPTY])).toBe(true);
    expect(placeholderRepairEligible([MODEL, EMPTY])).toBe(true);
    expect(placeholderRepairEligible([MODEL, FROZEN])).toBe(false);
    expect(placeholderRepairEligible([])).toBe(false);
    expect(placeholderRepairEligible(null)).toBe(false);
  });
  it('the repair is time-boxed out of the build\'s headroom, leaving room for the replay and the way back', () => {
    expect(placeholderRepairMs(PLACEHOLDER_REPAIR_RESERVE_MS + 10_000)).toBe(0);
    expect(placeholderRepairMs(PLACEHOLDER_REPAIR_RESERVE_MS + 60_000)).toBe(60_000);
    expect(placeholderRepairMs(10 * 60_000)).toBe(PLACEHOLDER_REPAIR_MAX_MS);
    expect(placeholderRepairMs(Number.NaN)).toBe(0);
  });
  it('kept only when strictly better: fewer stand-ins, no new kind, no new defect, score not lower, actually played', () => {
    expect(placeholderReplayBetter(m([MODEL, EMPTY]), m([EMPTY])).better).toBe(true);
    expect(placeholderReplayBetter(m([EMPTY]), m([])).better).toBe(true);
    expect(placeholderReplayBetter(m([EMPTY]), m([EMPTY])).reason).toMatch(/did not go down/);
    expect(placeholderReplayBetter(m([MODEL]), m([EMPTY])).reason).toMatch(/new stand-in \(EMPTY_MAP\)/);
    expect(placeholderReplayBetter(m([EMPTY]), m([], 70, ['GAME_DEFECT_BLANK'])).reason).toMatch(/new defect/);
    expect(placeholderReplayBetter(m([EMPTY], 70), m([], 69)).reason).toMatch(/score went down/);
    expect(placeholderReplayBetter(m([EMPTY], 70), m([], null)).better).toBe(false);
    expect(placeholderReplayBetter(m([EMPTY], null), m([], null)).better).toBe(true);
    expect(placeholderReplayBetter(m([EMPTY]), m([], 90, [], false)).better).toBe(false);
    expect(placeholderReplayBetter(m([EMPTY]), null).better).toBe(false);
    expect(placeholderReplayBetter({ ...m([EMPTY]), scopeMissing: [] }, { ...m([]), scopeMissing: ['traffic'] }).reason).toMatch(/removed a feature .*traffic/);
    expect(placeholderReplayBetter({ ...m([EMPTY]), scopeMissing: ['traffic'] }, { ...m([]), scopeMissing: ['traffic'] }).better).toBe(true);
  });
  it('the prompt names each stand-in and says the platform plays the game again; the kill switch is `off` only', () => {
    const p = placeholderRepairPrompt('a racing game', [MODEL, EMPTY]);
    expect(p).toMatch(/MISSING_MODEL/);
    expect(p).toMatch(/EMPTY_MAP/);
    expect(p).toMatch(/file tools only/);
    expect(p).toMatch(/checks your fix itself/);
    expect(placeholderRepairEnabled({})).toBe(true);
    expect(placeholderRepairEnabled({ AGENTV3_GAME_PLACEHOLDER_REPAIR: 'OFF' })).toBe(false);
    expect(placeholderRepairEnabled({ AGENTV3_GAME_PLACEHOLDER_REPAIR: 'on' })).toBe(true);
  });
  it('file tools only — every other name is REFUSED by the runner, not merely hidden', () => {
    const withheld = onlyTheseTools(PLACEHOLDER_REPAIR_TOOLS);
    const offered = new Set(['read_file', 'write_file', 'edit_file']);
    for (const t of ['bash', 'run_recipe', 'manage_dependency', 'task', 'browser_action', 'add_library_models', 'made_up_tool']) expect(isWithheldTool(t, withheld, offered)).toBe(true);
    for (const t of ['read_file', 'write_file', 'edit_file', 'grep', 'glob', 'write_files_batch']) expect(isWithheldTool(t, withheld, offered)).toBe(false);
    expect([...PLACEHOLDER_REPAIR_TOOLS].some((t) => /bash|recipe|install|dependency|task|browser/.test(t))).toBe(false);
  });
});

// ── The orchestration over injected I/O ───────────────────────────────────────────────────────────────────────────────
function io(over: Partial<PlaceholderRepairIO<string>> = {}) {
  const calls: string[] = [];
  const base: PlaceholderRepairIO<string> = {
    backup: vi.fn(async () => { calls.push('backup'); return { ok: true as const, digest: 'd'.repeat(64), entries: 9 }; }),
    repair: vi.fn(async () => { calls.push('repair'); return true; }),
    touched: () => ['src/game/World.ts'],
    replay: vi.fn(async () => { calls.push('replay'); return { measure: m([]), result: 'replayed' }; }),
    restore: vi.fn(async () => { calls.push('restore'); return { ok: true as const, digest: 'd'.repeat(64) }; }),
    cleanup: vi.fn(async () => { calls.push('cleanup'); }),
    ...over,
  };
  return { io: base, calls };
}
const input = (over: Record<string, unknown> = {}) => ({ findings: [EMPTY], before: m([EMPTY]), userPrompt: 'a city game', repairMs: 60_000, buildSignal: new AbortController().signal, tokenCapped: () => false, ...over });

describe('one pass, kept or put back', () => {
  it('a strictly better replay is KEPT; the backup is removed; nothing is restored', async () => {
    const { io: i, calls } = io();
    const o = await runPlaceholderRepair(input(), i);
    expect(o).toMatchObject({ attempted: true, kept: true, state: 'kept', after: 0, result: 'replayed' });
    expect(calls).toEqual(['backup', 'repair', 'replay', 'cleanup']);
    expect(placeholderRepairRecord(o).message).toMatch(/KEPT .*absorbed by the platform/);
  });
  it('a replay that is not better is DISCARDED: every file put back and verified, then the backup removed', async () => {
    const { io: i, calls } = io({ replay: vi.fn(async () => ({ measure: m([EMPTY]), result: 'same' })) });
    const o = await runPlaceholderRepair(input(), i);
    expect(o).toMatchObject({ kept: false, state: 'undone' });
    expect(o.result).toBeUndefined();
    expect(calls).toEqual(['backup', 'repair', 'restore', 'cleanup']);
    expect(placeholderRepairRecord(o)).toMatchObject({ severity: 'info', code: GAME_PLACEHOLDER_REPAIR_CODE });
    expect(placeholderRepairRecord(o).message).toMatch(/DISCARDED.*put back exactly and the restore was verified/);
  });
  it('no complete backup ⇒ no repair at all (fail closed)', async () => {
    const { io: i } = io({ backup: vi.fn(async () => ({ ok: false as const, reason: 'backup refused (special-file:./pipe)' })) });
    const o = await runPlaceholderRepair(input(), i);
    expect(o).toMatchObject({ attempted: false, state: 'skipped' });
    expect(i.repair).not.toHaveBeenCalled();
    expect(i.restore).not.toHaveBeenCalled();
    expect(placeholderRepairRecord(o).message).toMatch(/not tried.*special-file.*next game turn/);
  });
  it('a restore that cannot be verified is a WARNING and the backup is kept for recovery', async () => {
    const { io: i } = io({ replay: vi.fn(async () => null), restore: vi.fn(async () => ({ ok: false as const, verified: false as const, reason: 'the restored tree differs' })) });
    const o = await runPlaceholderRepair(input(), i);
    expect(o.state).toBe('restore-unverified');
    expect(i.cleanup).not.toHaveBeenCalled();
    expect(placeholderRepairRecord(o)).toMatchObject({ severity: 'warning', autoResolved: false });
  });
  it('the time cap: a pass still running at its cap is stopped, given time to stand down, then put back', async () => {
    let seen: AbortSignal | null = null;
    const timers: Array<() => void> = [];
    const { io: i, calls } = io({
      repair: vi.fn((_p: string, ctl: { signal: AbortSignal }) => { seen = ctl.signal; return new Promise<boolean>((res) => ctl.signal.addEventListener('abort', () => res(false))); }),
      setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
    });
    const done = runPlaceholderRepair(input(), i);
    await new Promise((r) => setTimeout(r, 0));
    timers[0](); // the repair's cap fires
    const o = await done;
    expect(seen!.aborted).toBe(true);
    expect(o).toMatchObject({ state: 'undone', timedOut: true });
    expect(o.reason).toMatch(/time cap/);
    expect(calls).not.toContain('replay');
  });
  it('the token cap: a pass stopped by its cap is put back, never replayed or kept', async () => {
    let capped = false;
    const { io: i, calls } = io({ repair: vi.fn(async (_p: string, ctl: { stop: () => void }) => { capped = true; ctl.stop(); return true; }) });
    const o = await runPlaceholderRepair(input({ tokenCapped: () => capped }), i);
    expect(o).toMatchObject({ state: 'undone', tokenCapped: true });
    expect(o.reason).toMatch(/token cap/);
    expect(calls).not.toContain('replay');
  });
  it('a pass that changed nothing has nothing to keep and nothing to put back', async () => {
    const { io: i, calls } = io({ touched: () => [] });
    const o = await runPlaceholderRepair(input(), i);
    expect(o.state).toBe('no-change');
    expect(calls).toEqual(['backup', 'repair', 'cleanup']);
  });
  it('a write into a dependency folder (outside the backup) is never kept and is said as not restorable', async () => {
    const { io: i } = io({ touched: () => ['node_modules/three/build/three.module.js', 'src/game/World.ts'] });
    const o = await runPlaceholderRepair(input(), i);
    expect(o.state).toBe('restore-unverified');
    expect(o.reason).toMatch(/outside the backup/);
    expect(i.replay).not.toHaveBeenCalled();
  });
  it('a finding list with another kind is never repaired, even if called directly', async () => {
    const { io: i } = io();
    const o = await runPlaceholderRepair(input({ findings: [EMPTY, FROZEN] }), i);
    expect(o.state).toBe('skipped');
    expect(i.backup).not.toHaveBeenCalled();
  });
});

// ── Wired through the playtest phase: the replay is the SAME play, and a kept one re-records the proof (Q-3365) ────────
describe('the phase: replay, keep, and the report', () => {
  const facts = { enabled: true, buildOk: true, isCanvasGame: true, isImportTurn: false, aborted: false, hasRunCommand: true, hasPreviewUrl: true, awaitsShell: false, platformDone: false, timeLeft: true };
  const files = { 'src/main.ts': "import { startWorld } from './game/World';\nstartWorld();", 'src/game/World.ts': 'export function startWorld() { const traffic = []; return traffic; }' };
  const setup = (opts: { repairedMeshes: number; restoreOk?: boolean; repairWrites?: boolean; dropFeature?: boolean }) => {
    const state = { meshes: 1 };
    const issues: PlaytestIssue[] = [];
    const play: GamePlaytestPorts = {
      facts, files, contract: buildGameContract('a 3D city game with traffic'),
      play: async () => ({ stdout: PLAYTEST_RESULT_MARKER + JSON.stringify({ ok: true, idle: 0.1, moves: [], fps: 30, placeholderEnd: { meshes: state.meshes } }) }),
      readFile: async (p) => (p === 'src/game/World.ts' ? files['src/game/World.ts'] : null),
      record: (i) => issues.push(i), previousIssues: async () => [], versions: async () => [], turnStartedAt: Date.now(),
      fix: { fixTurn: false, record: (i) => issues.push(i as PlaytestIssue), say: () => { throw new Error('a replay must never narrate'); } },
    };
    const captured = new Map<string, string>([['src/game/World.ts', files['src/game/World.ts']]]);
    const commands: string[] = [];
    const persisted: Array<Record<string, string>> = [];
    const forgotten: string[][] = [];
    const ports = (first: GamePlaceholderRepairPorts['first']): GamePlaceholderRepairPorts => ({
      first, canRun: true, headroomMs: 10 * 60_000, userPrompt: 'a 3D city game with traffic', buildSignal: new AbortController().signal,
      filesNow: () => ({ ...files, ...Object.fromEntries(captured) }), captured, allowed: async () => ({ ok: true }),
      runCommand: async (c) => {
        commands.push(c.includes('NBAI_BACKUP_OK') ? 'backup' : c.includes('NBAI_RESTORE_OK') ? 'restore' : c.startsWith('rm -rf') ? 'cleanup' : 'other');
        if (c.includes('NBAI_BACKUP_OK')) return { stdout: `NBAI_BACKUP_OK:${'a'.repeat(64)}:12\n` };
        if (c.includes('NBAI_RESTORE_OK')) { state.meshes = 1; return { stdout: opts.restoreOk === false ? 'NBAI_RESTORE_MISMATCH:f 644 ./src/x.ts' : `NBAI_RESTORE_OK:${'a'.repeat(64)}\n` }; }
        return { stdout: '' };
      },
      repair: async (_prompt, ctl) => {
        ctl.onTokens(1200);
        if (opts.repairWrites !== false) { captured.set('src/game/World.ts', opts.dropFeature ? 'export function startWorld() { /* the kit world */ }' : 'export function startWorld() { const traffic = []; /* the kit world */ return traffic; }'); captured.set('src/game/new.ts', 'x'); }
        state.meshes = opts.repairedMeshes;
        return true;
      },
      persist: async (f) => { persisted.push(f); }, forget: async (p) => { forgotten.push(p); },
      resolveOnRecheck: () => {}, record: (i) => issues.push(i), backupId: 'ws1-123',
    });
    return { state, issues, play, captured, commands, persisted, forgotten, ports };
  };

  it('KEPT: GAME_PROOF and the unverified-feature list are recorded again from the replay, and the stand-in note is cleared', async () => {
    const s = setup({ repairedMeshes: 40 });
    const keep: { ports?: GamePlaytestPorts } = {};
    const first = await runGamePlaytestPhase(s.play, keep);
    expect(keep.ports).toBe(s.play);
    expect(first?.placeholders?.map((f) => f.kind)).toEqual(['EMPTY_MAP']);
    expect(first?.featuresUnverified).toEqual(['traffic']);
    const proofsBefore = s.issues.filter((i) => i.code === 'GAME_PROOF').length;
    const replayed = await runGamePlaceholderRepairPhase(s.ports({ ports: keep.ports!, result: first! }));
    expect(replayed).not.toBeNull();
    expect(replayed!.placeholders).toEqual([]);
    expect(replayed!.featuresUnverified).toEqual(['traffic']); // re-derived from the replay (Q-3365)
    const proofs = s.issues.filter((i) => i.code === 'GAME_PROOF');
    expect(proofs.length).toBe(proofsBefore + 1);
    expect(proofs[proofs.length - 1].message.startsWith(REPLAY_PREFIX)).toBe(true);
    expect(s.issues.find((i) => i.code === GAME_PLACEHOLDER_REPAIR_CODE)?.message).toMatch(/KEPT/);
    // The next turn reads the LAST placeholder line: "none left" hands the builder nothing.
    expect(placeholderRepairNote(s.issues)).toBeNull();
    expect(s.commands).toEqual(['backup', 'cleanup']);
    expect(s.captured.get('src/game/new.ts')).toBe('x');
    expect(s.persisted.at(-1)).toMatchObject({ 'src/game/new.ts': 'x' });
  });

  it('DISCARDED: no replay line reaches the report, the captured writes are exactly as before, the store is put back', async () => {
    const s = setup({ repairedMeshes: 1 });
    const keep: { ports?: GamePlaytestPorts } = {};
    const first = await runGamePlaytestPhase(s.play, keep);
    const before = new Map(s.captured);
    const proofsBefore = s.issues.filter((i) => i.code === 'GAME_PROOF').length;
    expect(await runGamePlaceholderRepairPhase(s.ports({ ports: keep.ports!, result: first! }))).toBeNull();
    expect(s.issues.filter((i) => i.code === 'GAME_PROOF').length).toBe(proofsBefore);
    expect(s.issues.some((i) => i.message.startsWith(REPLAY_PREFIX))).toBe(false);
    expect(s.issues.find((i) => i.code === GAME_PLACEHOLDER_REPAIR_CODE)?.message).toMatch(/DISCARDED/);
    expect([...s.captured]).toEqual([...before]);
    expect(s.commands).toEqual(['backup', 'restore', 'cleanup']);
    expect(s.persisted).toEqual([{ 'src/game/World.ts': files['src/game/World.ts'] }]);
    expect(s.forgotten).toEqual([['src/game/new.ts']]);
    // The stand-in is still there, so the next game turn's builder still gets it.
    expect(placeholderRepairNote(s.issues)).toMatch(/EMPTY_MAP/);
  });

  it('a repair that removes a named feature to clear the stand-in is DISCARDED', async () => {
    const s = setup({ repairedMeshes: 40, dropFeature: true });
    const keep: { ports?: GamePlaytestPorts } = {};
    const first = await runGamePlaytestPhase(s.play, keep);
    expect(await runGamePlaceholderRepairPhase(s.ports({ ports: keep.ports!, result: first! }))).toBeNull();
    expect(s.issues.find((i) => i.code === GAME_PLACEHOLDER_REPAIR_CODE)?.message).toMatch(/DISCARDED .*removed a feature the user asked for \(traffic\)/);
  });

  it('a restore that does not match is a warning; the captured writes are not rewritten on an unverified tree', async () => {
    const s = setup({ repairedMeshes: 1, restoreOk: false });
    const keep: { ports?: GamePlaytestPorts } = {};
    const first = await runGamePlaytestPhase(s.play, keep);
    await runGamePlaceholderRepairPhase(s.ports({ ports: keep.ports!, result: first! }));
    const line = s.issues.find((i) => i.code === GAME_PLACEHOLDER_REPAIR_CODE);
    expect(line).toMatchObject({ severity: 'warning', autoResolved: false });
    expect(line?.message).toMatch(/kept in the sandbox for recovery/);
    expect(s.commands).not.toContain('cleanup');
  });

  it('other kinds, the kill switch and a game that was not played are said as not tried — and never touch the project', async () => {
    const s = setup({ repairedMeshes: 40 });
    const first = { proof: { outcome: 'passed' as const, score: 80 }, gate: 'passed' as const, placeholders: [EMPTY, FROZEN] };
    expect(await runGamePlaceholderRepairPhase(s.ports({ ports: s.play, result: first }))).toBeNull();
    expect(s.issues.at(-1)?.message).toMatch(/not tried .*more than a missing model/);
    const prev = process.env.AGENTV3_GAME_PLACEHOLDER_REPAIR;
    process.env.AGENTV3_GAME_PLACEHOLDER_REPAIR = 'off';
    try {
      await runGamePlaceholderRepairPhase(s.ports({ ports: s.play, result: { ...first, placeholders: [EMPTY] } }));
      expect(s.issues.at(-1)?.message).toMatch(/switched off/);
    } finally { if (prev === undefined) delete process.env.AGENTV3_GAME_PLACEHOLDER_REPAIR; else process.env.AGENTV3_GAME_PLACEHOLDER_REPAIR = prev; }
    await runGamePlaceholderRepairPhase(s.ports({ ports: s.play, result: { proof: { outcome: 'not-run', score: null, unplayed: true }, gate: 'not-run', placeholders: [EMPTY] } }));
    expect(s.issues.at(-1)?.message).toMatch(/could not be played again/);
    expect(await runGamePlaceholderRepairPhase(s.ports(null))).toBeNull();
    expect(s.commands).toEqual([]);
  });

  it('the cleared line is the only one the next turn treats as "nothing to repair"', () => {
    expect(placeholderRepairNote([{ code: GAME_PLACEHOLDER_CODE, message: placeholderFindingsMessage([EMPTY]) }, { code: GAME_PLACEHOLDER_CODE, message: PLACEHOLDERS_CLEARED_MESSAGE }])).toBeNull();
    expect(placeholderRepairNote([{ code: GAME_PLACEHOLDER_CODE, message: PLACEHOLDERS_CLEARED_MESSAGE }, { code: GAME_PLACEHOLDER_CODE, message: placeholderFindingsMessage([EMPTY]) }])).toMatch(/EMPTY_MAP/);
  });
});

describe('route wiring (source guard)', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const at = route.indexOf('const gamePlaceholderRepairPorts = (): GamePlaceholderRepairPorts => ({');
  const block = route.slice(at, at + 4200);
  it('the route builds ports and calls the phase; a kept replay reaches the gate through the SAME apply as the first play', () => {
    expect(at).toBeGreaterThan(0);
    expect(route).toContain('const repairedPlay = await runGamePlaceholderRepairPhase(gamePlaceholderRepairPorts());');
    expect(route).toContain('if (repairedPlay) applyGamePlayed(repairedPlay);');
    expect(route).toContain('if (played) { gamePlayKeep.play = played; applyGamePlayed(played); }');
    expect(route).toContain('else delete gateEvidence.gameFeaturesUnverified;');
    // The old route-side replay is gone (Q-3365): no playtest script is run for a repair from the route.
    expect(route).not.toContain("'game-repair-replay'");
  });
  it('platform-paid before the first call, file tools only and refused otherwise, capped in steps, tokens and output', () => {
    const paid = block.indexOf('barrenPhases.add(PHASE_GAME_REPAIR)');
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(block.indexOf('new AgentRunner('));
    expect(block).toContain('tools: baseRunnerOpts.tools.filter((t) => PLACEHOLDER_REPAIR_TOOLS.has(t.name)), withheldTools: onlyTheseTools(PLACEHOLDER_REPAIR_TOOLS)');
    expect(block).toContain('maxSteps: PLACEHOLDER_REPAIR_MAX_STEPS, maxTokensPerTurn: PLACEHOLDER_REPAIR_MAX_TOKENS_PER_TURN');
    expect(block).toContain('ctl.onTokens(');
    expect(block).toContain('runInBillingPhase(PHASE_GAME_REPAIR, () => runInPass(GAME_REPAIR_PASS');
    expect(PLACEHOLDER_REPAIR_TOKEN_CAP).toBeLessThanOrEqual(200_000);
  });
});
