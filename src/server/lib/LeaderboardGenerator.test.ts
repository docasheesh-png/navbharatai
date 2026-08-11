import { describe, it, expect, afterAll } from 'vitest';

import { generateLeaderboardIntegration, LEADERBOARD_SERVICE_SOURCE } from './LeaderboardGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateLeaderboardIntegration (wiring)', () => {
  it('emits the leaderboard service, routes and README', () => {
    const out = generateLeaderboardIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/leaderboard/leaderboardService.ts');
    expect(paths).toContain('server/leaderboard/routes.ts');
    expect(paths).toContain('server/leaderboard/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/leaderboard/routes.ts']).toContain('export const leaderboardRouter');
  });
});

// Materialize + execute the emitted domain logic — the best-kept + deterministic-rank rules are real business
// rules, verified against the actual emitted code.
describe('emitted LeaderboardService — best-kept + deterministic rank (real logic)', () => {
  const emitted = emitModule('leaderboard', LEADERBOARD_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Entry { board: string; player: string; score: number }
  interface RankedEntry extends Entry { rank: number }
  interface Service {
    submit(player: string, score: number, board?: string, now?: Date): Entry;
    top(n?: number, board?: string): RankedEntry[];
    rankOf(player: string, board?: string): number;
    entryOf(player: string, board?: string): RankedEntry | undefined;
    around(player: string, k?: number, board?: string): RankedEntry[];
    size(board?: string): number;
    remove(player: string, board?: string): boolean;
  }
  interface Emitted { LeaderboardService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  const T = (n: number) => new Date(2_000_000_000_000 + n); // deterministic increasing clock

  it('keeps a player BEST score — a lower resubmit does not downgrade', async () => {
    const { LeaderboardService } = await load();
    const svc = new LeaderboardService();
    svc.submit('alice', 100, 'g', T(1));
    svc.submit('alice', 40, 'g', T(2)); // lower → ignored
    expect(svc.entryOf('alice', 'g')?.score).toBe(100);
    svc.submit('alice', 150, 'g', T(3)); // higher → replaces
    expect(svc.entryOf('alice', 'g')?.score).toBe(150);
  });

  it('ranks by score DESC with an earlier-achiever tie-break; ranks are 1-based and exact', async () => {
    const { LeaderboardService } = await load();
    const svc = new LeaderboardService();
    svc.submit('alice', 100, 'g', T(10));
    svc.submit('bob', 100, 'g', T(5));   // same score, but achieved EARLIER → ranks above alice
    svc.submit('carol', 200, 'g', T(20));
    const top = svc.top(10, 'g');
    expect(top.map((e) => e.player)).toEqual(['carol', 'bob', 'alice']);
    expect(top.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(svc.rankOf('bob', 'g')).toBe(2);
    expect(svc.rankOf('alice', 'g')).toBe(3);
    expect(svc.rankOf('nobody', 'g')).toBe(0);
  });

  it('a best-kept resubmit does NOT reset the tie-break time (stable ranking)', async () => {
    const { LeaderboardService } = await load();
    const svc = new LeaderboardService();
    svc.submit('bob', 100, 'g', T(5));    // bob reaches 100 first
    svc.submit('alice', 100, 'g', T(10)); // alice reaches 100 later
    svc.submit('bob', 50, 'g', T(50));    // lower resubmit → ignored, tie-break time stays T(5)
    // bob still ranks above alice (his 100 was achieved earlier and was NOT reset)
    expect(svc.top(10, 'g').map((e) => e.player)).toEqual(['bob', 'alice']);
  });

  it('top(n) limits, around() returns the neighbour slice with correct ranks', async () => {
    const { LeaderboardService } = await load();
    const svc = new LeaderboardService();
    ['p1', 'p2', 'p3', 'p4', 'p5'].forEach((p, i) => svc.submit(p, (5 - i) * 100, 'g', T(i)));
    // scores: p1=500,p2=400,p3=300,p4=200,p5=100
    expect(svc.top(2, 'g').map((e) => e.player)).toEqual(['p1', 'p2']);
    expect(svc.size('g')).toBe(5);
    const around = svc.around('p3', 1, 'g'); // p3 is rank 3; neighbours p2(2),p3(3),p4(4)
    expect(around.map((e) => e.player)).toEqual(['p2', 'p3', 'p4']);
    expect(around.map((e) => e.rank)).toEqual([2, 3, 4]);
  });

  it('boards are isolated; validation + remove', async () => {
    const { LeaderboardService } = await load();
    const svc = new LeaderboardService();
    svc.submit('alice', 100, 'weekly', T(1));
    svc.submit('alice', 999, 'all-time', T(1));
    expect(svc.entryOf('alice', 'weekly')?.score).toBe(100);
    expect(svc.entryOf('alice', 'all-time')?.score).toBe(999);
    expect(svc.rankOf('alice', 'weekly')).toBe(1);
    expect(() => svc.submit('', 10, 'g')).toThrow(/player is required/);
    expect(() => svc.submit('x', Number.NaN, 'g')).toThrow(/score must be a number/);
    expect(svc.remove('alice', 'weekly')).toBe(true);
    expect(svc.rankOf('alice', 'weekly')).toBe(0);
    expect(svc.rankOf('alice', 'all-time')).toBe(1); // other board untouched
  });
});
