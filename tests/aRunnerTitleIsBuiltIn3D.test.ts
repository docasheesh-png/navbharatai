// 🏃 A TEMPLE RUN / SUBWAY SURFERS REQUEST IS BUILT IN 3D, WITH THE LANE-RUNNER STARTER (Q-3314, admin decision 2026-11-26:
// option (a) — "runner titles get the 3D kit and lane-runner starter").
//
// 🔑 THE CLASS: two readers of the same request disagreed. The contract (gameIntent NAMED_KINDS) said a runner title is 3D
// third-person, while the kit seed (gameKitSeed.gameKitWants3D) kept its own private list of which titles are 3D (FPS only)
// and laid the 2D kit — so the builder was told "3D" and handed a flat game. The fix makes the kit read the contract's table
// (gameIntent.namesTitleDrawnIn3D), and the census below fails for ANY catalogue title the two ever disagree on again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameKitPlan, gameKitRecipeInput, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';
import { buildGameContract, namedGameReference, namesTitleDrawnIn3D } from '../src/server/AgentV3/gameIntent';
import { findGameTitles } from '../src/server/lib/wellKnownGameTitles';
import { APP_KNOWLEDGE_BASE as APP_FEATURES } from '../src/server/AppContext/AppKnowledgeBase';

const shellFor = (p: string) => (gameKitRecipeInput('generate_game_shell', gameKitPlan(p, 'vite-react'), p) as { include?: string[] } | undefined)?.include ?? [];

// The way users actually type it: Hinglish, misspelled, glued, Devanagari.
const RUNNER_TITLE_PROMPTS = [
  'temple run jaisa game banao',
  'subway surfers jaisa game banao',
  'subway surfar jaisa endless runner game',
  'templerun type game with coins',
  'टेम्पल रन जैसा गेम बनाओ',
  'sabway surfer jaisa game bana do jisme coins ho',
];

describe('🏃 a runner title gets the 3D kit and the lane-runner starter', () => {
  it.each(RUNNER_TITLE_PROMPTS)('"%s": contract 3D third-person, and the kit lays the 3D layer and the lane runner', (p) => {
    const c = buildGameContract(p);
    expect(c.dimension).toBe('3d');
    expect(c.camera).toBe('third-person');
    expect(c.genre).toBe('runner');
    expect(gameKitWants3D(p)).toBe(true);
    const plan = gameKitPlan(p, 'vite-react');
    expect(plan).toEqual(expect.arrayContaining(['generate_game_3d', 'generate_game_shell']));
    expect(plan).not.toContain('generate_game_2d');
    expect(plan).not.toContain('generate_athree_map');               // a runner is a lane, not a big map
    expect(shellFor(p)).toContain('lanerunnergame');
    expect(shellFor(p)).not.toContain('racingroadgame');
  });

  it('a runner title that SAYS 2D keeps the 2D kit (the request\'s own words win over the title)', () => {
    const p = 'temple run jaisa 2D game banao';
    expect(buildGameContract(p).dimension).toBe('2d');
    expect(gameKitWants3D(p)).toBe(false);
    expect(gameKitPlan(p, 'vite-react')).toContain('generate_game_2d');
  });

  it('an endless runner that names no title is unchanged (the decision was about the titles): 2D kit, view unspecified', () => {
    const p = 'endless runner game banao';
    expect(buildGameContract(p).dimension).toBe('unspecified');
    expect(gameKitWants3D(p)).toBe(false);
    expect(gameKitPlan(p, 'vite-react')).toContain('generate_game_2d');
  });

  it('a title that is also an everyday word (halo, doom) is never on its own a 3D request to the kit', () => {
    expect(namesTitleDrawnIn3D('halo jaisa game')).toBe(false);
    expect(gameKitWants3D('doom jaisa game')).toBe(false);
  });
});

describe('🧬 census: the kit and the contract agree on EVERY catalogue title', () => {
  // Every spelling in the one title catalogue, read from its source so a title added tomorrow is checked too.
  const src = readFileSync(join(__dirname, '../src/server/lib/wellKnownGameTitles.ts'), 'utf8');
  const entries = [...src.matchAll(/\{ name: '([^']+)', kind: '(\w+)'([^\n]*?)spellings: \[([^\]]*)\]/g)]
    .map((m) => ({ name: m[1], plainWord: /plainWord: true/.test(m[3]), spellings: [...m[4].matchAll(/'([^']+)'/g)].map((s) => s[1]).filter((s) => !s.startsWith('?')) }));

  it('reads the catalogue (runners included)', () => {
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(['Temple Run', 'Subway Surfers', 'Valorant', 'PUBG']));
  });

  it('a title the contract draws in 3D is laid on the 3D kit, every spelling', () => {
    const disagree: string[] = [];
    for (const e of entries) {
      if (e.plainWord) continue;
      for (const s of e.spellings) {
        const p = `${s} jaisa game banao`;
        if (!findGameTitles(p).some((m) => m.name === e.name)) continue;  // a spelling only valid inside a longer phrase
        if (namedGameReference(p)?.dimension === '3d' && !gameKitWants3D(p)) disagree.push(`${e.name} ("${s}")`);
      }
    }
    expect(disagree, 'the contract says 3D, the kit lays 2D').toEqual([]);
  });
});

describe('📚 the app\'s own knowledge says what is built', () => {
  it('Temple Run / Subway Surfers are advertised on the 3D runner entry, not the 2D kit\'s', () => {
    const runner = APP_FEATURES.find((f) => f.id === 'game_runner_starter')!;
    const flat = APP_FEATURES.find((f) => f.id === 'game_2d_kit')!;
    expect(runner.description).toMatch(/built in 3D/);
    expect(runner.keywords).toEqual(expect.arrayContaining(['temple run jaisa', 'subway surfers jaisa']));
    expect(flat.keywords).not.toEqual(expect.arrayContaining(['temple run jaisa']));
    expect(flat.keywords).not.toEqual(expect.arrayContaining(['subway surfers jaisa']));
  });
});
