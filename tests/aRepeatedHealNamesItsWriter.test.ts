/**
 * failedbr #1922 (App.tsx healed ×6, "our write held") and #2100 (App.tsx reverted to another app's version, Q-3027):
 * HEAL_NOT_DURABLE said a file had been healed more than once but never WHICH heal wrote it, so neither report could be
 * acted on. The ledger now keeps the heal's name, and every heal site passes one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { noteHeal, healRepeats, healRepeatMessage } from '../src/server/AgentV3/HealLedger';

describe('a repeated heal names the heals that wrote the file', () => {
  it('two heals on one file are both named, in first-seen order', () => {
    const ws = `ws-heal-${Date.now()}`;
    noteHeal(ws, 'src/App.tsx', 'v1', 'v0', 'add-missing-import');
    noteHeal(ws, 'src/App.tsx', 'v2', 'v1', 'dedupe-same-module-import');
    const [r] = healRepeats(ws);
    expect(r.by).toEqual(['add-missing-import', 'dedupe-same-module-import']);
    expect(healRepeatMessage([r])).toContain('src/App.tsx ×2 (our write held) by add-missing-import + dedupe-same-module-import');
  });
  it('a caller that passes no name is reported exactly as before', () => {
    const ws = `ws-heal-anon-${Date.now()}`;
    noteHeal(ws, 'src/a.ts', 'x1', 'x0');
    noteHeal(ws, 'src/a.ts', 'x2', 'x1');
    expect(healRepeatMessage(healRepeats(ws))).not.toContain(' by ');
  });
  it('🔒 every heal site in ToolDispatcher names itself', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const calls = [...src.matchAll(/this\.landHealWrite\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const args of calls) expect(args, args).toMatch(/,\s*'[a-z-]+'\s*$/);
  });
});
