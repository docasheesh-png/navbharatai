// ⚡ A REQUEST THE PLATFORM HAS ALREADY COMPLETED DOES NOT RUN THE BUILDER (failedbr #2496).
//
// 🧬 THE CLASS: a turn whose whole request a deterministic platform action fully satisfied at turn start still ran the
// builder loop (16 model calls, ~1 M input tokens, an unasked edit the growth guard put back, every finishing pass) and
// was priced by an ETA taken from the project's complex builds — 6.9 min against "7.5–23.5 min" for a 20-second change.
// Covered for EVERY library action composed into libraryActionsAtTurnStart (character, car, map place), not only the
// character, and a new action added there without a success receipt here fails the census below.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickerOnlyRequest, platformCompletedRequest, libraryActionsForTurn, platformDoneRunResult, capPlatformDoneEstimate,
  platformDoneEtaLine, PLATFORM_ACTION_SUCCESS_CODE, PLATFORM_DONE_TURN_CODE, PLATFORM_DONE_ETA, type PlatformDone,
} from '../src/server/AgentV3/platformDoneTurn';
import { librarySubjectOf, PLAYER_FILE_PATH } from '../src/server/AgentV3/characterSwap';
import { useAsCarPrompt } from '../src/server/AgentV3/carSwap';
import { useAsCharacterPrompt, addToGamePrompt, libraryDisplayName } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { GAME_PLAYER_FILE } from '../src/server/lib/GamePlayerBodyGenerator';
import { createFinishingPassGuard } from '../src/server/AgentV3/finishingPassesAtCap';
import { isTeachableBuild } from '../src/server/AgentV3/etaHistory';
import { playtestSkipReason } from '../src/server/AgentV3/gamePlaytest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The request of failedbr #2496, verbatim. */
const REPORT_PROMPT = 'Make the Q7 Villager Man from the NavBharatAI library my game\'s player character (library id: "q7-villager-man"). Replace only the character I play as; keep the map, the controls and everything else as it is.';

describe('only the library\'s own instruction, word for word, is a request the platform can finish', () => {
  it('the reported request is recognised, and the library screen generates exactly it', () => {
    expect(pickerOnlyRequest(REPORT_PROMPT)).toEqual({ kind: 'character', id: 'q7-villager-man' });
    expect(useAsCharacterPrompt({ id: 'q7-villager-man', name: libraryDisplayName('q7-villager-man') })).toBe(REPORT_PROMPT);
  });
  it('whitespace aside, nothing may be added or changed', () => {
    expect(pickerOnlyRequest(`  ${REPORT_PROMPT.replace(/ /g, '  ')}\n`)).not.toBeNull();
    expect(pickerOnlyRequest(`${REPORT_PROMPT} Also make him run faster.`)).toBeNull();
    expect(pickerOnlyRequest(REPORT_PROMPT.replace('keep the map', 'change the map'))).toBeNull();
    expect(pickerOnlyRequest('mera character badal do')).toBeNull();
    expect(pickerOnlyRequest(null)).toBeNull();
  });
  it('the car and the map place, every action the platform does at turn start', () => {
    const car = useAsCarPrompt({ id: 'q7-villager-man', name: libraryDisplayName('q7-villager-man') })!;
    expect(pickerOnlyRequest(car)).toEqual({ kind: 'car', id: 'q7-villager-man' });
    expect(pickerOnlyRequest(`${car} And add rain.`)).toBeNull();
    const place = addToGamePrompt({ id: 'map-place:desert', name: 'New desert' });
    expect(pickerOnlyRequest(place)).toEqual({ kind: 'map-place', place: 'desert' });
    expect(pickerOnlyRequest(addToGamePrompt({ id: 'q7-villager-man', name: 'Q7 Villager Man' }))).toBeNull(); // "add a model" needs placing: not covered
  });
});

describe('the turn is finished only on the action\'s own success receipt', () => {
  const ok = [{ code: 'PLAYER_CHARACTER_SET' }];
  it('success → done, with what the user is told (the moves the model has and lacks)', () => {
    const done = platformCompletedRequest(REPORT_PROMPT, ok, {})!;
    expect(done.kind).toBe('character');
    expect(done.changed).toBe(PLAYER_FILE_PATH);
    expect(done.message).toMatch(/^Done — your player character is now Q7 Villager Man\./);
    expect(done.message).toMatch(/own animations for: .*walk/);
    expect(done.message).toMatch(/wapas purana character/);
    expect(done.message).not.toMatch(/[ऀ-ॿ]/);
  });
  it('a refusal, a missing receipt, a wrong receipt, an extended request or the kill switch → the builder runs', () => {
    expect(platformCompletedRequest(REPORT_PROMPT, [{ code: 'PLAYER_CHARACTER_NOT_SET' }], {})).toBeNull();
    expect(platformCompletedRequest(REPORT_PROMPT, [], {})).toBeNull();
    expect(platformCompletedRequest(REPORT_PROMPT, [{ code: 'RACE_CAR_SET' }], {})).toBeNull();
    expect(platformCompletedRequest(`${REPORT_PROMPT} And a sword.`, ok, {})).toBeNull();
    expect(platformCompletedRequest(REPORT_PROMPT, ok, { AGENTV3_PLATFORM_DONE_TURN: 'off' })).toBeNull();
    const place = addToGamePrompt({ id: 'map-place:city', name: 'x' });
    expect(platformCompletedRequest(place, [{ code: 'MAP_PLACE_NOT_ADDED' }], {})).toBeNull();
    expect(platformCompletedRequest(place, [{ code: 'MAP_PLACE_ADDED' }], {})?.kind).toBe('map-place');
  });
});

function turnIo(addModel: () => Promise<string>) {
  const disk = new Map<string, string>([[PLAYER_FILE_PATH, GAME_PLAYER_FILE], ['src/App.tsx', 'export default function App() { return <OpenWorldGame />; }']]);
  const issues: Array<{ code: string; message: string }> = [];
  const done: { cur: PlatformDone | null } = { cur: null };
  const narrate = vi.fn();
  const startPreview = vi.fn(async () => undefined);
  const io = {
    prompt: REPORT_PROMPT, filesAtTurnStart: Object.fromEntries(disk) as Record<string, string>,
    read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
    write: vi.fn(async (p: string, c: string) => { disk.set(p, c); }), addModel: vi.fn(addModel),
    record: (i: { code: string; message: string }) => { issues.push(i); }, done, narrate, startPreview, env: {},
  };
  return { io, disk, issues, done, narrate, startPreview };
}

describe('libraryActionsForTurn — the reported turn, end to end through the real action', () => {
  const subject = librarySubjectOf('q7-villager-man')!;
  it('the character is set, the turn is marked done, the user is told and the preview is started', async () => {
    const t = turnIo(async () => `Added to the game from the NavBharatAI library: ${subject}. Use them with: …`);
    const handoff = await libraryActionsForTurn(t.io);
    expect(t.disk.get(PLAYER_FILE_PATH)).toContain(`model: '${subject}'`);
    expect(t.done.cur?.kind).toBe('character');
    expect(t.issues.map((i) => i.code)).toEqual(['PLAYER_CHARACTER_SET', PLATFORM_DONE_TURN_CODE]);
    expect(t.issues[1].message).toMatch(/no model call/);
    expect(t.narrate).toHaveBeenCalledWith(t.done.cur!.message);
    expect(t.startPreview).toHaveBeenCalledTimes(1);
    expect(handoff).toMatch(/DONE BY THE PLATFORM/); // kept for any path that still reaches a builder
  });
  it('an action that failed never finishes the turn and claims nothing', async () => {
    const t = turnIo(async () => 'failed: the library is unreachable');
    const handoff = await libraryActionsForTurn(t.io);
    expect(t.done.cur).toBeNull();
    expect(t.narrate).not.toHaveBeenCalled();
    expect(t.startPreview).not.toHaveBeenCalled();
    expect(t.issues.map((i) => i.code)).toEqual(['PLAYER_CHARACTER_NOT_SET']);
    expect(handoff).toMatch(/NOT DONE/);
  });
  it('a preview that cannot start does not undo the decision (the post-build proof still says what it found)', async () => {
    const t = turnIo(async () => `Added to the game from the NavBharatAI library: ${subject}.`);
    t.io.startPreview = vi.fn(async () => { throw new Error('sandbox down'); });
    await libraryActionsForTurn(t.io);
    expect(t.done.cur).not.toBeNull();
  });
});

describe('what the rest of the turn sees', () => {
  it('the stand-in result: ok, no steps, no tokens, nothing billed; an existing result is never replaced', () => {
    const done = platformCompletedRequest(REPORT_PROMPT, [{ code: 'PLAYER_CHARACTER_SET' }], {});
    const r = platformDoneRunResult<{ ok: boolean; steps: number; usage: { inputTokens: number; outputTokens: number }; billedUsd: number; summary: string }>(undefined, done)!;
    expect(r).toMatchObject({ ok: true, steps: 0, billedUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, summary: done!.message });
    const existing = { ok: false, steps: 3 } as never;
    expect(platformDoneRunResult(existing, done)).toBe(existing);
    expect(platformDoneRunResult(undefined, null)).toBeUndefined();
  });
  it('the ETA is the short band, said for what it is — never "based on your last builds"', () => {
    const complexHistory = { estimateMs: 912_101, lowMs: 448_901, highMs: 1_412_660, etaText: '15 min' };
    const est = capPlatformDoneEstimate(complexHistory, REPORT_PROMPT, {});
    expect(est).toMatchObject(PLATFORM_DONE_ETA);
    expect(est.highMs).toBeLessThanOrEqual(180_000);
    expect(capPlatformDoneEstimate(complexHistory, `${REPORT_PROMPT} And rain.`, {})).toBe(complexHistory);
    expect(capPlatformDoneEstimate(complexHistory, REPORT_PROMPT, { AGENTV3_PLATFORM_DONE_TURN: 'off' })).toBe(complexHistory);
    const line = platformDoneEtaLine(REPORT_PROMPT, {})!;
    expect(line).toMatch(/makes this change itself/);
    expect(line).not.toMatch(/last \d+ build/);
    expect(platformDoneEtaLine('build me a game', {})).toBeNull();
  });
  it('no finishing pass writes into the app, and the report says so once', () => {
    const notes: string[] = [];
    const guard = createFinishingPassGuard({ result: () => ({}), aborted: () => false, remainingMs: () => Infinity, record: (n) => { notes.push(n.code); }, platformDone: () => true });
    expect(guard.allow('starter-tests')).toBe(false);
    expect(guard.allow('e2e-scaffold')).toBe(false);
    expect(notes).toEqual(['FINISHING_PASSES_SKIPPED_PLATFORM_DONE']);
    const normal = createFinishingPassGuard({ result: () => ({}), aborted: () => false, remainingMs: () => Infinity, record: () => undefined, platformDone: () => false });
    expect(normal.allow('starter-tests')).toBe(true);
  });
  it('the playtest that stands down says why, and the turn never teaches the build ETA', () => {
    const why = playtestSkipReason({ enabled: true, buildOk: true, isCanvasGame: true, isImportTurn: false, aborted: false, hasRunCommand: true, hasPreviewUrl: true, awaitsShell: false, platformDone: true, timeLeft: true });
    expect(why).toMatch(/without playing the game/);
    expect(isTeachableBuild({ startedAt: 0, endedAt: 60_000, ok: true, platformDoneTurn: true })).toBe(false);
    expect(isTeachableBuild({ startedAt: 0, endedAt: 60_000, ok: true })).toBe(true);
  });
});

describe('census: every library action the platform runs at turn start can finish its turn', () => {
  it('each *AtTurnStart composed into libraryActionsAtTurnStart has a success receipt here, and that receipt is recorded by it', () => {
    const growth = read('src/server/AgentV3/growthTurn.ts');
    const body = growth.slice(growth.indexOf('export async function libraryActionsAtTurnStart'));
    const actions = [...body.matchAll(/await (\w+AtTurnStart)\(io\)/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(PLATFORM_ACTION_SUCCESS_CODE)).toHaveLength(actions.length);
    const sources = read('src/server/AgentV3/growthTurn.ts') + read('src/server/AgentV3/carSwap.ts');
    for (const code of Object.values(PLATFORM_ACTION_SUCCESS_CODE)) expect(sources).toContain(`code: '${code}'`);
  });
  it('the build route asks platformDoneTurn, and every builder-side step stands down on a completed turn', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).not.toMatch(/await libraryActionsAtTurnStart\(/);
    expect(route).toMatch(/await libraryActionsForTurn\(\{/);
    const standIn = route.indexOf('result = platformDoneRunResult(result, platformDoneRef.cur);');
    expect(standIn).toBeGreaterThan(0);
    expect(standIn).toBeLessThan(route.indexOf('const esc = await runWithEscalation(tierEscalationPath'));
    expect(standIn).toBeLessThan(route.indexOf('result = await runner.run(buildPrompt);'));
    expect(route).toContain('templateDelivered: verbatimTemplate.deliver || platformDoneRef.cur !== null');
    expect(route).toContain('platformDone: () => platformDoneRef.cur !== null');
    expect(route).toMatch(/clickExplorerEnabled\(\) && result\.ok[^\n]*\n[^\n]*!platformDoneRef\.cur/);
    // The playtest's facts carry it; the phase plays only when it is false (S7, buildPhases/gamePlaytestPhase.ts).
    expect(route).toContain('awaitsShell: !!awaitsShellNow(), platformDone: !!platformDoneRef.cur, timeLeft: roomFor(PLAYTEST_BUDGET_MS + 30_000),');
    expect(read('src/server/AgentV3/buildPhases/gamePlaytestPhase.ts')).toContain('&& !f.platformDone && f.isCanvasGame && f.timeLeft');
    expect(route).toContain('platformDone: !!platformDoneRef.cur,');
    expect(route).toContain('Object.assign(est, capPlatformDoneEstimate(est, prompt));');
    expect(route).toContain('const etaShown = platformDoneEtaLine(prompt) ?? (');
  });
  it('the history reader marks a completed turn from its report code', () => {
    expect(read('src/server/AgentV3/DiagnosticsStore.ts')).toMatch(/i\?\.code === PLATFORM_DONE_TURN_CODE\) \? \{ platformDoneTurn: true as const \}/);
  });
});
