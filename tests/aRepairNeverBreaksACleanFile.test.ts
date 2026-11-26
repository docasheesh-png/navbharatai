/**
 * 🩹 A REPAIR NEVER BREAKS A FILE THAT WAS CLEAN (BR2532, admin 2026-11-26: "isme game ban gaya par enemy aa hi nahi rahe").
 *
 * The builder's monsters.ts compiled cleanly. The typecheck-gate repair pass, asked to fix 3 errors in OLD kit files, was
 * shown every file the build wrote and rewrote monsters.ts with APIs that do not exist (`world.scene`,
 * `controller.position`). The re-check failed and its writes were KEPT, so no monster reached the scene. The agentic
 * endgame reverted a repair only when the TOTAL error count rose. Locked here, with the real code paths:
 *   1. the pure rule (repairBreakage.ts);
 *   2. the typecheck-gate repair (buildPhases/typecheckGateRepair.ts) puts back the file it broke, keeps its real fix;
 *   3. the endgame batch repair does the same when the count does not rise;
 *   4. an edit turn with no game contract still has its asked-for enemies looked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesTheRepairBroke } from '../src/server/AgentV3/repairBreakage';
import { writeRepairKeepingOnlyWhatHelps, type RepairCheck } from '../src/server/AgentV3/buildPhases/typecheckGateRepair';
import { runEndgameRepair } from '../src/server/AgentV3/EndgameRepair';
import { asksForEnemies } from '../src/server/AgentV3/gameIntent';

const err = (file: string, n = 1) => Array.from({ length: n }, (_, i) => `${file}(${i + 1},5): error TS2339: Property 'scene' does not exist on type 'OpenWorld'.`).join('\n');

/** A workspace whose compiler reports an error for every line marked BROKEN — so the check reads the files themselves. */
function workspace(files: Record<string, string>) {
  const ws = { ...files };
  const tsc = () => Object.entries(ws).flatMap(([p, c]) => c.split('\n').filter((l) => l.includes('BROKEN')).map(() => err(p))).join('\n');
  return { ws, tsc };
}

describe('the rule', () => {
  const e = (file: string) => ({ file });
  it('a touched file that gained its first error goes back; the file it fixed stays', () => {
    expect(filesTheRepairBroke([e('src/kit/a.ts'), e('src/kit/a.ts')], [e('src/game/features/monsters.ts')], ['src/kit/a.ts', './src/game/features/monsters.ts']))
      .toEqual({ revert: ['src/game/features/monsters.ts'], why: 'newly-broken' });
  });
  it('a raised total puts back every touched file; nothing broken puts back nothing', () => {
    expect(filesTheRepairBroke([e('a.ts')], [e('a.ts'), e('a.ts')], ['a.ts', 'b.ts'])).toEqual({ revert: ['a.ts', 'b.ts'], why: 'more-errors' });
    expect(filesTheRepairBroke([e('a.ts'), e('a.ts')], [e('a.ts')], ['a.ts'])).toEqual({ revert: [], why: null });
    // A file that already had errors and still has some was not broken BY the repair.
    expect(filesTheRepairBroke([e('a.ts'), e('b.ts')], [e('b.ts')], ['b.ts'])).toEqual({ revert: [], why: null });
  });
});

describe('the typecheck-gate repair — BR2532 replayed', () => {
  const MONSTERS = 'export function spawnMonsters(ctx) { return ctx.npcs.spawnAround(5, { kind: "enemy" }); }';
  async function replay(fixes: Array<{ path: string; content: string }>) {
    const { ws, tsc } = workspace({ 'src/kit/old.ts': 'BROKEN\nBROKEN\nBROKEN', 'src/game/features/monsters.ts': MONSTERS });
    const check = async (): Promise<RepairCheck> => { const errors = tsc(); return { ok: errors === '', verified: true, errors }; };
    const records: string[] = [];
    const final = await writeRepairKeepingOnlyWhatHelps(fixes, await check(), {
      read: async (p) => ws[p] ?? '',
      write: async (files) => { for (const f of files) ws[f.path] = f.content; return files.map((f) => f.path); },
      check, record: (d) => records.push(`${d.code}: ${d.message}`),
    }, 'tscgate-w');
    return { ws, final, records };
  }

  it('the clean monsters.ts it broke is put back; the old kit file it fixed keeps the fix', async () => {
    const { ws, final, records } = await replay([
      { path: 'src/kit/old.ts', content: 'fixed' },
      { path: 'src/game/features/monsters.ts', content: 'world.scene.add(m) // BROKEN\ncontroller.position // BROKEN\nBROKEN' },
    ]);
    expect(ws['src/game/features/monsters.ts']).toBe(MONSTERS);
    expect(ws['src/kit/old.ts']).toBe('fixed');
    expect(final.ok).toBe(true);
    expect(records.join('\n')).toMatch(/REPAIR_REVERTED: The repair pass broke 1 file\(s\) that had compiled cleanly before it[\s\S]*monsters\.ts/);
  });

  it('a repair that raised the total is put back whole', async () => {
    const { ws, records } = await replay([
      { path: 'src/kit/old.ts', content: 'BROKEN\nBROKEN\nBROKEN\nBROKEN' },
    ]);
    expect(ws['src/kit/old.ts']).toBe('BROKEN\nBROKEN\nBROKEN');
    expect(records.join('\n')).toMatch(/raised the number of type errors/);
  });

  it('a repair that only helps is kept, and nothing is recorded', async () => {
    const { ws, records } = await replay([{ path: 'src/kit/old.ts', content: 'fixed' }]);
    expect(ws['src/kit/old.ts']).toBe('fixed');
    expect(records).toEqual([]);
  });

  it('the build route uses it for the typecheck-gate repair', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/check = await writeRepairKeepingOnlyWhatHelps\(fixes, check, \{/);
  });
});

describe('the endgame batch repair — a clean file it breaks goes back even when the count does not rise', () => {
  it('puts back monsters.ts, keeps the kit fix, and says so', async () => {
    const MONSTERS = 'export const spawn = () => 1;';
    const { ws, tsc } = workspace({ 'src/kit/old.ts': 'BROKEN\nBROKEN', 'src/game/features/monsters.ts': MONSTERS, 'src/main.ts': "import './kit/old';\nimport './game/features/monsters';" });
    const logs: string[] = [];
    const v = await runEndgameRepair({
      runTsc: async () => tsc(),
      readFiles: async () => ({ ...ws }),
      writeFile: async (p, c) => { ws[p] = c; },
      llmRepair: async () => [
        { path: 'src/kit/old.ts', content: 'fixed' },
        { path: 'src/game/features/monsters.ts', content: 'BROKEN\nBROKEN' }, // 2 errors → 2 errors: the count rule never fired
      ],
      log: (m) => logs.push(m),
    });
    expect(ws['src/game/features/monsters.ts']).toBe(MONSTERS);
    expect(ws['src/kit/old.ts']).toBe('fixed');
    expect(v.errorsAfter).toBe(0);
    expect(logs.join('\n')).toMatch(/broke 1 file\(s\) that compiled before it \(src\/game\/features\/monsters\.ts\)/);
  });
});

describe('an edit turn with no game contract still has its enemies looked for', () => {
  it('English, Hinglish and Hindi requests for enemies are read; a declined one and a chatbot are not', () => {
    for (const t of ['add enemies that attack the hero', 'enemy bana, hero par attack kare', 'dushman aur gunde daalo', 'दुश्मन जोड़ो', 'add zombies']) expect(asksForEnemies(t), t).toBe(true);
    for (const t of ['make the car faster', 'add a chatbot', 'no enemies please, just exploring', '']) expect(asksForEnemies(t), t).toBe(false);
  });
  it('the playtest is handed the turn\'s request', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/contract: gameContract \?\? null, request: gameTurnRequest\(prompt, milestoneRequest\)/);
  });
});
