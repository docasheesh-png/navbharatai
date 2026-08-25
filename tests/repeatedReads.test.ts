import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repeatedReadNotice, repeatedReadSummary } from '../src/server/AgentV3/repeatedReads';

/**
 * ⚠️ MEASURED, NOT GUESSED — and this is the point of the whole sequence.
 *
 * The day before, the build report recorded `▶ read_file` with no target, so nobody could ask whether
 * those reads repeated. I said I would not build a cache on a hunch, and shipped the instrumentation
 * instead (#2672). The very next real build answered it:
 *
 *     55 read_file calls · 9 distinct files · 46 wasted re-reads (84%)
 *         12x  server/backupJob.ts
 *         12x  client/src/pages/provider-dashboard.tsx
 *          5x  client/src/pages/provider-edit-profile.tsx   ← five times in fourteen seconds
 *
 * 🔑 AND IT IS STILL NOT A CACHE, which is the design decision worth defending. A content cache saves
 * the sandbox round-trip — about 200ms — and NOTHING that actually costs: the model has already spent
 * the TURN deciding to call the tool, and the body is already on its way into the context either way.
 * On a weak tier the turn and the tokens ARE the budget. So the intervention is aimed at the model's
 * own choice, in the result it is already reading.
 */
describe('a re-read of an unchanged file is named, in the result the model is already reading', () => {
  it('says nothing on the first read', () => {
    expect(repeatedReadNotice('src/App.tsx', 1, false)).toBe('');
    expect(repeatedReadNotice('src/App.tsx', 1, true)).toBe('');
  });

  it('says nothing when the file genuinely CHANGED — that re-read is correct behaviour', () => {
    // The difference between this and a nag. After an edit, reading again is exactly right, and
    // discouraging it would make the builder work from stale content.
    expect(repeatedReadNotice('src/App.tsx', 5, false)).toBe('');
  });

  it('names the file, the count and the fact that nothing moved', () => {
    const n = repeatedReadNotice('server/backupJob.ts', 2, true);
    expect(n).toContain('server/backupJob.ts');
    expect(n).toContain('the second time');
    expect(n).toContain('NOT changed');
    // And what to do instead — a notice with no instruction is just noise.
    expect(n).toContain('work from what you have');
  });

  it('counts in ordinary English, including the awkward ones', () => {
    expect(repeatedReadNotice('a', 3, true)).toContain('the 3rd time');
    expect(repeatedReadNotice('a', 11, true)).toContain('the 11th time');
    expect(repeatedReadNotice('a', 12, true)).toContain('the 12th time');
    expect(repeatedReadNotice('a', 13, true)).toContain('the 13th time');
    expect(repeatedReadNotice('a', 21, true)).toContain('the 21st time');
    expect(repeatedReadNotice('a', 22, true)).toContain('the 22nd time');
  });
});

describe('and the build report names the waste, so the next one can judge the nudge', () => {
  it('reproduces the reported build\'s own arithmetic', () => {
    const reads = new Map([
      ['server/backupJob.ts', 12],
      ['client/src/pages/provider-dashboard.tsx', 12],
      ['server/storage.ts', 9],
      ['client/src/lib/language.tsx', 7],
      ['client/src/pages/provider-edit-profile.tsx', 5],
      ['client/src/lib/firebase.ts', 4],
      ['client/src/pages/about.tsx', 3],
      ['client/src/pages/provider-guided-setup.tsx', 2],
      ['x.ts', 1],
    ]);
    const line = repeatedReadSummary(reads);
    expect(line).toContain('55 file reads');
    expect(line).toContain('9 distinct');
    expect(line).toContain('46 of them (84%)');
    expect(line).toContain('12× server/backupJob.ts');
  });

  it('stays silent on ordinary work — a couple of re-reads is not a finding', () => {
    expect(repeatedReadSummary(new Map([['a.ts', 2], ['b.ts', 1]]))).toBe('');
    expect(repeatedReadSummary(new Map())).toBe('');
    expect(repeatedReadSummary(new Map([['a.ts', 1], ['b.ts', 1], ['c.ts', 1]]))).toBe('');
  });
});

describe('the wiring — the half that rots', () => {
  const disp = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the ledger compares CONTENT, so "unchanged" can never be a false positive', () => {
    // Held rather than hashed: the bodies are already in memory on the way past, and a truncated hash
    // could collide into a wrong "you already have this".
    expect(disp).toContain('private _readLedger = new Map<string, { count: number; content: string }>();');
    expect(disp).toContain('const unchanged = prior !== undefined && prior.content === full;');
  });

  it('the content is ALWAYS returned in full — both on a whole read and a ranged one', () => {
    // The safety property. Suppressing the body would save real tokens and strand a model whose
    // context has been trimmed.
    expect(disp).toContain('return notice ? `${notice}${full}` : full;');
    expect(disp).toContain('return `${notice}[lines ${from + 1}-');
  });

  it('the ledger is per-dispatcher, so it cannot leak between builds or users', () => {
    expect(disp).not.toContain('const _readLedger = new Map'); // never module-level
  });

  it('and the route reports it', () => {
    expect(route).toContain("code: 'REPEATED_READS'");
    expect(route).toContain('repeatedReadSummary(dispatcher.readLedgerCounts())');
  });
});
