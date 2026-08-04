import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateReactionsIntegration, REACTIONS_SERVICE_SOURCE } from './ReactionsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateReactionsIntegration (wiring)', () => {
  it('emits the reaction service, routes and README', () => {
    const out = generateReactionsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/reactions/reactionService.ts');
    expect(paths).toContain('server/reactions/routes.ts');
    expect(paths).toContain('server/reactions/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/reactions/routes.ts']).toContain('export const reactionRouter');
  });
});

// Materialize + execute the emitted domain logic — the toggle + exact-count + one-emoji-per-user rules are real
// business rules, verified against the actual emitted code.
describe('emitted ReactionService — idempotent toggle + exact counts + one emoji per user (real logic)', () => {
  const artifact = join(here, `._reactions_emitted_${process.pid}.ts`);
  writeFileSync(artifact, REACTIONS_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface ReactionCount { emoji: string; count: number; reactedByViewer: boolean }
  interface ReactionSummary { targetId: string; total: number; reactions: ReactionCount[]; viewerEmoji: string | null }
  interface Service {
    react(targetId: string, userId: string, emoji: string): string | null;
    unreact(targetId: string, userId: string): boolean;
    hasReacted(targetId: string, userId: string, emoji: string): boolean;
    countFor(targetId: string, emoji: string): number;
    summary(targetId: string, viewerId?: string): ReactionSummary;
  }
  interface Emitted { ReactionService: new (allowed?: string[]) => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('reacting twice with the SAME emoji toggles off (idempotent — no double count)', async () => {
    const { ReactionService } = await load();
    const svc = new ReactionService();
    expect(svc.react('post:1', 'alice', '👍')).toBe('👍');
    expect(svc.countFor('post:1', '👍')).toBe(1);
    // same emoji again -> toggle OFF
    expect(svc.react('post:1', 'alice', '👍')).toBeNull();
    expect(svc.countFor('post:1', '👍')).toBe(0);
    // and again -> back ON (exactly one, never two)
    expect(svc.react('post:1', 'alice', '👍')).toBe('👍');
    expect(svc.countFor('post:1', '👍')).toBe(1);
  });

  it('THE INVARIANT: a user holds AT MOST ONE emoji per target (switching never inflates totals)', async () => {
    const { ReactionService } = await load();
    const svc = new ReactionService();
    svc.react('post:2', 'bob', '👍');
    svc.react('post:2', 'bob', '❤️'); // switch — replaces 👍
    expect(svc.countFor('post:2', '👍')).toBe(0);
    expect(svc.countFor('post:2', '❤️')).toBe(1);
    const s = svc.summary('post:2', 'bob');
    expect(s.total).toBe(1);             // one user, one reaction — never two
    expect(s.viewerEmoji).toBe('❤️');
  });

  it('summary gives exact per-emoji counts (desc) with the grand total and viewer flag', async () => {
    const { ReactionService } = await load();
    const svc = new ReactionService();
    svc.react('post:3', 'a', '👍');
    svc.react('post:3', 'b', '👍');
    svc.react('post:3', 'c', '❤️');
    svc.react('post:3', 'me', '❤️');
    svc.react('post:3', 'd', '👍'); // 👍=3, ❤️=2
    const s = svc.summary('post:3', 'me');
    expect(s.total).toBe(5);
    expect(s.reactions[0]).toMatchObject({ emoji: '👍', count: 3 });
    expect(s.reactions[1]).toMatchObject({ emoji: '❤️', count: 2, reactedByViewer: true });
    expect(s.viewerEmoji).toBe('❤️');
    // the counts sum to the total — the exactness invariant
    expect(s.reactions.reduce((n, r) => n + r.count, 0)).toBe(s.total);
  });

  it('unreact removes a reaction (idempotent) and rejects a disallowed emoji', async () => {
    const { ReactionService } = await load();
    const svc = new ReactionService();
    svc.react('post:4', 'x', '🔥');
    expect(svc.hasReacted('post:4', 'x', '🔥')).toBe(true);
    expect(svc.unreact('post:4', 'x')).toBe(true);
    expect(svc.unreact('post:4', 'x')).toBe(false); // already gone
    expect(svc.countFor('post:4', '🔥')).toBe(0);
    expect(() => svc.react('post:4', 'x', '💩')).toThrow(/emoji not allowed/);
    expect(() => svc.react('post:4', '', '👍')).toThrow(/userId is required/);
  });

  it('a custom allow-list is honoured; targets are isolated', async () => {
    const { ReactionService } = await load();
    const svc = new ReactionService(['⭐', '👎']);
    expect(() => svc.react('t', 'u', '👍')).toThrow(/emoji not allowed/); // not in custom list
    svc.react('t1', 'u', '⭐');
    svc.react('t2', 'u', '⭐');
    expect(svc.countFor('t1', '⭐')).toBe(1);
    expect(svc.countFor('t2', '⭐')).toBe(1); // isolated per target
  });
});
