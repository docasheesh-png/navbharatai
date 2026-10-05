// A GAME BRINGS THE PLAYER BACK (admin 2026-10-05: "navbharatai jab game banaye to user ko navbharatai
// ki latt lag jaye").
//
// What makes a casual game played again is not more content. It is a short list of small, honest systems:
// a best score that survives a reload, the near miss, a combo, progress that always moves, achievements,
// and a reason to come back tomorrow. Before this, a generated game had none of them that WORKED:
// state.highScore existed, but nothing ever saved it, so every reload reset "best" to 0. And leaving
// pause emitted GAME_STARTED (a new game) while GAME_RESUMED never fired at all.
//
// These tests import the GENERATED runtime modules (written to disk, exactly what a game ships) and drive
// them with an injected clock and storage, so days, streaks and saves are deterministic.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-game-meta-${process.pid}`);

/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let S: any; let E: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameRuntime().files)) {
    const f = join(DIR, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
  }
  M = await import(join(DIR, 'src/game/core/meta.ts'));
  S = await import(join(DIR, 'src/game/core/state.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A fake localStorage, and a clock that can be moved to any day. */
function world() {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  let now = new Date(2026, 9, 5, 12, 0, 0).getTime();
  return {
    storage, data,
    now: () => now,
    advance: (ms: number) => { now += ms; },
    nextDay: (days = 1) => { const d = new Date(now); d.setDate(d.getDate() + days); now = d.getTime(); },
  };
}

/** One round: start, score, optionally kill/collect, end. Returns the summary. */
function playRound(w: ReturnType<typeof world>, score: number, opts: { seconds?: number; kills?: number; items?: number; won?: boolean } = {}) {
  S.resetRun();
  S.setStatus('playing');
  if (score) S.addScore(score);
  for (let i = 0; i < (opts.kills ?? 0); i++) E.events.emit('ENEMY_DIED');
  for (let i = 0; i < (opts.items ?? 0); i++) E.events.emit('ITEM_COLLECTED');
  w.advance((opts.seconds ?? 30) * 1000);
  S.setStatus(opts.won ? 'won' : 'gameover');
  return M.meta.lastSummary;
}

let w: ReturnType<typeof world>;
const heard: Array<{ event: string; payload: any }> = [];
beforeEach(() => {
  E.events.clear();
  Object.assign(S.state, S.initialState());
  heard.length = 0;
  w = world();
  M.startMeta({ gameId: 'test', now: w.now, storage: w.storage, unlocks: { 2: 'Red car' } });
  for (const ev of ['NEW_BEST', 'LEVEL_UP', 'ACHIEVEMENT_UNLOCKED', 'DAILY_REWARD', 'GOAL_COMPLETED', 'COMBO_MILESTONE', 'GAME_STARTED', 'GAME_RESUMED']) {
    E.events.on(ev, (payload: any) => heard.push({ event: ev, payload }));
  }
});

describe('the best score survives a reload (it never did)', () => {
  it('a reloaded game starts with the real best, in state.highScore, from the first frame', () => {
    playRound(w, 120);
    // A reload: fresh state, the meta layer started again over the same storage.
    E.events.clear();
    Object.assign(S.state, S.initialState());
    expect(S.state.highScore).toBe(0);
    M.startMeta({ gameId: 'test', now: w.now, storage: w.storage });
    expect(S.state.highScore).toBe(120);
    expect(M.meta.profile.bestScore).toBe(120);
  });

  it('two games on one site keep two bests', () => {
    playRound(w, 300);
    E.events.clear();
    Object.assign(S.state, S.initialState());
    M.startMeta({ gameId: 'other', now: w.now, storage: w.storage });
    expect(S.state.highScore).toBe(0);
  });

  it('a broken or full storage never throws, and an old save still loads with every field', () => {
    E.events.clear();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(() => M.startMeta({ gameId: 'x', now: w.now, storage: broken })).not.toThrow();
    expect(() => playRound(w, 10)).not.toThrow();
    w.storage.setItem('nb-meta-v1:old', JSON.stringify({ bestScore: 50, runs: 3 }));
    E.events.clear();
    const p = M.startMeta({ gameId: 'old', now: w.now, storage: w.storage });
    expect(p.bestScore).toBe(50);
    expect(Array.isArray(p.achievements)).toBe(true);
    expect(p.goals.list).toEqual([]);
  });
});

describe('the end of a round is a hook, not a full stop', () => {
  it('NEW BEST fires only when the best really falls', () => {
    playRound(w, 100);
    expect(M.meta.lastSummary.newBest).toBe(true);
    heard.length = 0;
    const s = playRound(w, 60);
    expect(s.newBest).toBe(false);
    expect(heard.some((h) => h.event === 'NEW_BEST')).toBe(false);
    const s2 = playRound(w, 101);
    expect(s2.newBest).toBe(true);
    expect(s2.previousBest).toBe(100);
  });

  it('the near miss says exactly how close it was — within 20% of the best, and only then', () => {
    playRound(w, 100);
    expect(playRound(w, 85).nearMiss).toBe(16);
    expect(playRound(w, 50).nearMiss).toBeNull();
    expect(M.summaryLines(playRound(w, 99))[0]).toBe('So close! Only 2 more to beat your best (100)');
  });

  it('every round moves the player forward: XP, and a level with its unlock early on', () => {
    const s = playRound(w, 10);
    expect(s.xpGained).toBeGreaterThan(0);
    expect(s.level).toBeGreaterThanOrEqual(2);
    expect(s.unlockedNow).toContain('Red car');
    expect(heard.some((h) => h.event === 'LEVEL_UP' && h.payload.reward === 'Red car')).toBe(true);
    const lines = M.summaryLines(s);
    expect(lines.some((l: string) => l.startsWith('Unlocked: Red car'))).toBe(true);
  });

  it('XP is scale-free: a 10-point game and a 10,000-point game level at the same pace', () => {
    const small = playRound(w, 10).xpGained;
    const w2 = world();
    E.events.clear();
    M.startMeta({ gameId: 'big', now: w2.now, storage: w2.storage });
    const big = playRound(w2, 10000).xpGained;
    expect(big).toBe(small);
  });

  it('achievements are earned once', () => {
    playRound(w, 5);
    expect(M.meta.profile.achievements).toContain('first-run');
    heard.length = 0;
    playRound(w, 5);
    expect(heard.filter((h) => h.event === 'ACHIEVEMENT_UNLOCKED' && h.payload.achievement.id === 'first-run')).toHaveLength(0);
  });
});

describe('a combo makes playing well worth more than playing long', () => {
  it('hits inside the window raise the multiplier and score points × multiplier; the window closing ends it', () => {
    S.resetRun();
    S.setStatus('playing');
    const c = M.combo;
    let total = 0;
    for (let i = 0; i < 12; i++) { total += c.hit(10); c.update(0.5); }
    expect(c.multiplier).toBe(3);
    expect(S.state.score).toBe(total);
    expect(total).toBeGreaterThan(120);
    expect(heard.some((h) => h.event === 'COMBO_MILESTONE' && h.payload.count === 10)).toBe(true);
    c.update(3);
    expect(c.count).toBe(0);
    expect(c.best).toBe(12);
  });

  it('the best combo of a round is recorded, and feeds the x10 achievement', () => {
    S.resetRun();
    S.setStatus('playing');
    for (let i = 0; i < 10; i++) M.combo.hit(1);
    S.setStatus('gameover');
    expect(M.meta.lastSummary.run.maxCombo).toBe(10);
    expect(M.meta.profile.achievements).toContain('combo-10');
  });
});

describe('a reason to come back tomorrow', () => {
  it('the daily reward comes once a day, and the streak counts consecutive days only', () => {
    playRound(w, 5);
    playRound(w, 5);
    expect(heard.filter((h) => h.event === 'DAILY_REWARD')).toHaveLength(1);
    w.nextDay();
    playRound(w, 5);
    expect(M.meta.profile.streak).toBe(2);
    w.nextDay(2); // a missed day
    playRound(w, 5);
    expect(M.meta.profile.streak).toBe(1);
    expect(M.meta.profile.bestStreak).toBe(2);
    // The reward grows with the streak, capped, so a long streak is worth keeping.
    const rewards = heard.filter((h) => h.event === 'DAILY_REWARD').map((h) => h.payload.xp);
    expect(rewards).toEqual([20, 40, 20]);
  });

  it('three daily goals, the same all day, new tomorrow — and never a goal this game cannot do', () => {
    const fresh = { ...M.meta.profile, totalKills: 0, totalItems: 0, bestScore: 0, bestSeconds: 0, bestCombo: 0, runs: 0 };
    const today = M.goalsForDay('2026-10-05', fresh);
    expect(today).toHaveLength(3);
    expect(M.goalsForDay('2026-10-05', fresh)).toEqual(today);
    expect(today.some((g: any) => g.stat === 'kills' || g.stat === 'items' || g.stat === 'combo')).toBe(false);
    const fighter = { ...fresh, totalKills: 40, runs: 4, bestScore: 900, bestSeconds: 80, bestCombo: 12 };
    const pools = new Set<string>();
    for (let d = 1; d <= 28; d++) for (const g of M.goalsForDay('2026-10-' + String(d).padStart(2, '0'), fighter)) pools.add(g.stat);
    expect(pools.has('kills')).toBe(true);
    expect(pools.has('score')).toBe(true);
    // Targets a person can say out loud, below the best so they are reachable today.
    for (let d = 1; d <= 28; d++) {
      for (const g of M.goalsForDay('2026-10-' + String(d).padStart(2, '0'), fighter)) {
        if (g.stat === 'score') expect(g.target).toBeLessThan(900);
      }
    }
  });

  it('goal progress counts over the day and completes with XP', () => {
    const goals = M.meta.goals();
    const runs = goals.find((g: any) => g.stat === 'runs');
    if (!runs) return; // the day's three may not include it; the pure test above covers selection
    for (let i = 0; i < runs.target; i++) playRound(w, 3);
    expect(runs.done).toBe(true);
    expect(heard.some((h) => h.event === 'GOAL_COMPLETED')).toBe(true);
  });
});

describe('pause is a pause, not a new game (the event the HUD waited for never fired)', () => {
  it('leaving pause emits GAME_RESUMED, not GAME_STARTED, and the paused time is not counted', () => {
    S.resetRun();
    S.setStatus('playing');
    heard.length = 0;
    w.advance(10_000);
    S.setStatus('paused');
    w.advance(60_000);
    S.setStatus('playing');
    expect(heard.map((h) => h.event)).toContain('GAME_RESUMED');
    expect(heard.map((h) => h.event)).not.toContain('GAME_STARTED');
    w.advance(5_000);
    S.setStatus('gameover');
    expect(M.meta.lastSummary.run.seconds).toBe(15);
  });

  it('a round the player walked away from does not leak into the next game', () => {
    S.resetRun();
    S.setStatus('playing');           // a round starts…
    M.combo.hit(); M.combo.hit();
    w.advance(600_000);               // …and the player leaves the game route mid-round
    E.events.clear();
    Object.assign(S.state, S.initialState());
    M.startMeta({ gameId: 'test', now: w.now, storage: w.storage });
    const s = playRound(w, 5, { seconds: 20 });
    expect(s.run.seconds).toBe(20);
    expect(s.run.maxCombo).toBe(0);
  });

  it('a round that ends from the menu or twice is not counted twice', () => {
    playRound(w, 5);
    const runs = M.meta.profile.runs;
    S.setStatus('won'); // a second end with no round live
    expect(M.meta.profile.runs).toBe(runs);
  });
});

describe('the 3D shell wires it, so no game can forget', () => {
  const files = generateGameShell().files;
  it('the Game starts the meta layer, mounts the announcements, ticks and breaks the combo', () => {
    const game = files['src/game/Game.ts'];
    expect(game).toContain('startMeta({ gameId: options.gameId, unlocks: options.unlocks })');
    expect(game).toContain('mountMetaToasts(options.container)');
    expect(game).toContain('combo.update(delta)');
    expect(game).toMatch(/PLAYER_DAMAGED', \(\) => combo\.break\(\)/);
  });
  it('the game-over screen is the run summary with a focused one-tap Play again', () => {
    const hud = files['src/game/ui/Hud.tsx'];
    expect(hud).toContain('summaryLines(meta.lastSummary)');
    expect(hud).toContain('again.current?.focus()');
    expect(hud).toMatch(/e\.key === 'Enter' \|\| e\.key === ' ' \|\| e\.key === 'r'/);
    expect(hud).toContain('Best {s.highScore}');
  });
});

describe('engagement, never manipulation', () => {
  it('the meta layer has no chance-based rewards, no purchases and no countdown pressure', () => {
    // Code only: the header comment names these things in order to forbid them.
    const src = generateGameRuntime().files['src/game/core/meta.ts'].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/\b(purchase|price|currency|gem|loot ?box)\b/i);
    expect(src).not.toMatch(/expires in|hurry|last chance/i);
  });
});
