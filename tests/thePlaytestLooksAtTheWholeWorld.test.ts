// THE PLAYTEST LOOKS AT THE WHOLE WORLD (map expansion plan, item 12 — server side). The read-only geometry look (#4461) named a
// flat plane off the land, road faces pointing down and a player off the ground. A world made of many joined places, venues
// and late ground edits can go wrong in more ways the owner would see: a STEP where two joined places meet, a sports ground
// floating over (or sunk into) its land, ground changed after it was drawn and never redrawn, and memory that keeps growing
// while the game is played (on a phone: a crash). The playtest now reads the page's memory at the start and the end of its
// round, and the findings read what a kit reports about seams, venues and pending redraws. Builder-only and advisory, as before:
// never scored, never a gate, never shown to the user. A kit that does not report the new fields gets exactly the old findings.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geometryFindings, geometryFindingsMessage, HEAP_GROWTH_BYTES, SEAM_STEP_M } from '../src/server/AgentV3/gameGeometryProbe';
import { gamePlaytestConfig, gamePlaytestModule, PLAYTEST_RESULT_MARKER, parsePlaytest } from '../src/server/AgentV3/gamePlaytest';

const MB = 1024 * 1024;
const base = { terrain: { samples: 9, off: 0, worst: 0 }, slabs: [], roads: [], player: 0.1 };

describe('🔎 seams, venues, pending redraws', () => {
  it('a step where two joined places meet is named, with the fix', () => {
    const f = geometryFindings({ ...base, seams: { samples: 40, worst: 2.4 } });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/2\.4 m step/);
    expect(f[0]).toMatch(/joinTo/);
    expect(geometryFindings({ ...base, seams: { samples: 40, worst: SEAM_STEP_M } })).toEqual([]);
    expect(geometryFindings({ ...base, seams: { samples: 0, worst: 9 } })).toEqual([]);           // nothing measured
  });
  it('a sports ground off its land is named; one on its land is not', () => {
    const f = geometryFindings({ ...base, venues: [{ name: 'Eden <script>', off: 3.2 }, { name: 'Wankhede', off: 0.1 }] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/"Eden script" stands 3\.2 m off/);
    expect(f[0]).toMatch(/kind: 'venue'/);
  });
  it('ground changed after it was drawn and not redrawn is named', () => {
    expect(geometryFindings({ ...base, pending: { dirty: 3, rebuilt: 0 } })[0]).toMatch(/^3 pieces of ground changed after they were drawn/);
    expect(geometryFindings({ ...base, pending: { dirty: 0, rebuilt: 5 } })).toEqual([]);
  });
  it('a kit that reports none of the new fields gets exactly the old findings', () => {
    const old = { terrain: { samples: 9, off: 4, worst: 2 }, slabs: [{ name: 'grass', size: 900, above: 3, below: 5 }], roads: [{ name: 'road', down: 5, faces: 9 }], player: 6 };
    const f = geometryFindings(old, { pending: 0, stuck: 1 });
    expect(f).toHaveLength(5);
    expect(f.join(' ')).not.toMatch(/step|stands .* off the land|not redrawn|memory/);
    expect(geometryFindings(old, { pending: 0, stuck: 1 }, null)).toEqual(f);
  });
});

describe('🧠 memory over a round of play', () => {
  it('memory that grows a lot in one short round is named, with what usually causes it', () => {
    const f = geometryFindings(base, null, { start: 120 * MB, end: 420 * MB });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/grew by 300 MB in one short round of play \(120 → 420 MB\)/);
    expect(f[0]).toMatch(/dispose/);
  });
  it('ordinary growth, a big page that grew a little, or nothing measured: nothing said', () => {
    expect(geometryFindings(base, null, { start: 100 * MB, end: 100 * MB + HEAP_GROWTH_BYTES - 1 })).toEqual([]);  // under the bar
    expect(geometryFindings(base, null, { start: 400 * MB, end: 560 * MB })).toEqual([]);                          // not half again
    expect(geometryFindings(base, null, { start: 120 * MB })).toEqual([]);
    expect(geometryFindings(base, null, { start: null, end: 900 * MB })).toEqual([]);
    expect(geometryFindings(base, null, { start: 0, end: 900 * MB })).toEqual([]);
    expect(geometryFindings(base, null, { start: 'x' as unknown as number, end: Number.NaN })).toEqual([]);
  });
  it('at most six lines, and the admin line stays bounded', () => {
    const all = geometryFindings({
      terrain: { samples: 9, off: 4, worst: 2 }, slabs: [{ size: 900, above: 3, below: 5 }, { size: 800, above: 3, below: 5 }], roads: [{ down: 5, faces: 9 }], player: 9,
      seams: { samples: 4, worst: 3 }, venues: [{ off: 4 }], pending: { dirty: 2 },
    }, { stuck: 2 }, { start: 100 * MB, end: 900 * MB });
    expect(all).toHaveLength(6);
    expect(geometryFindingsMessage(all).length).toBeLessThanOrEqual(2000);
  });
});

describe('🧪 the playtest script reads the memory, only when the look is on', () => {
  it('reads performance.memory after the geometry look and at the end of the round; the result keeps it', () => {
    const on = gamePlaytestModule(gamePlaytestConfig('http://x', null, [], {}), "import { chromium } from 'playwright';");
    expect(on).toMatch(/if \(typeof heap0 === 'number'\) out\.heap = \{ start: heap0 \};/);
    expect(on).toMatch(/if \(cfg\.geometry && out\.heap\) \{/);
    expect(on.indexOf('const heap0')).toBeGreaterThan(on.indexOf('out.geometry = await Promise.race'));
    expect(on.indexOf('out.heap.end = heap1')).toBeGreaterThan(on.indexOf('out.models = await page.evaluate'));
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    try { writeFileSync(join(dir, 'm.mjs'), on); execFileSync(process.execPath, ['--check', join(dir, 'm.mjs')]); } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(parsePlaytest(PLAYTEST_RESULT_MARKER + JSON.stringify({ ok: true, heap: { start: 1, end: 2 } })).heap).toEqual({ start: 1, end: 2 });
  });
  it('the route hands the memory read to the findings', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('geometryFindings(playRun.geometry, playRun.models, playRun.heap)');
  });
});
