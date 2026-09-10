/**
 * History opens instantly, and honestly (admin 2026-08-31: "history load hone me bahut time lagta
 * hai … agar user ke app me bhi store ho jaye to chalega").
 *
 * THE MEASURED CAUSE, so nobody re-guesses it: HistoryView subscribed with
 * `where('userId','==',uid)` and NO limit, then waited for that first snapshot before rendering. And
 * a `chat_sessions` document is not small — App.tsx writes the full `messages` transcript, a SECOND
 * copy in `restoredMessages`, and the built app's entire `files` contents into every one. Listing
 * TITLES therefore downloaded every message and every source file the account had.
 *
 * The local index holds only what the list renders. These tests pin the two properties that make
 * that safe: it carries no user CONTENT, and it can never crash the first frame.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  toIndexRow, buildHistoryIndex, readHistoryIndex, writeHistoryIndex,
  HISTORY_INDEX_KEY, HISTORY_INDEX_MAX, type HistoryIndexRow,
} from '../src/lib/historyIndex';
import { readFileSync } from 'fs';
import { join } from 'path';

const VIEW = readFileSync(join(__dirname, '..', 'src/components/HistoryView.tsx'), 'utf8');

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
});

const session = (over: Record<string, any> = {}) => ({
  id: 's1', title: 'My app', lastUpdated: '2026-08-30T10:00:00.000Z',
  messages: [{ text: 'hello' }, { text: 'world' }],
  restoredMessages: [{ text: 'hello' }],
  files: { 'src/App.tsx': 'const x = 1;', 'index.html': '<html/>' },
  ...over,
});

describe('the index carries no user CONTENT — that is what makes it small', () => {
  it('keeps counts, never the transcript or the files', () => {
    const row = toIndexRow(session())!;
    expect(row.messageCount).toBe(2);
    expect(row.fileCount).toBe(2);
    // The whole point: none of the heavy fields survive.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('hello');
    expect(serialized).not.toContain('const x = 1');
    expect(serialized).not.toContain('<html/>');
    expect(row).not.toHaveProperty('messages');
    expect(row).not.toHaveProperty('restoredMessages');
    expect(row).not.toHaveProperty('files');
  });

  it('a row stays small even for a huge session', () => {
    const huge = session({
      messages: Array.from({ length: 500 }, (_, i) => ({ text: 'x'.repeat(400) + i })),
      files: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}.ts`, 'y'.repeat(5000)])),
    });
    expect(JSON.stringify(toIndexRow(huge)!).length).toBeLessThan(400);
  });

  it('keeps every field the list actually filters on', () => {
    const row = toIndexRow(session({
      uci: 'u-1', agent: 'agentv3', current_agent: 'pro', original_agent: 'free',
      tab: 'engine_builder', mode: 'build', isPinned: true,
    }))!;
    for (const k of ['uci', 'agent', 'current_agent', 'original_agent', 'tab', 'mode'] as const) {
      expect(row[k], `${k} is read by a filter and must survive`).toBeTruthy();
    }
    expect(row.isPinned).toBe(true);
  });

  it('accepts the camelCase spellings the app also writes', () => {
    const row = toIndexRow({ id: 'x', currentAgent: 'pro', originalAgent: 'free' })!;
    expect(row.current_agent).toBe('pro');
    expect(row.original_agent).toBe('free');
  });
});

describe('building the index', () => {
  it('sorts newest first and caps the length', () => {
    const rows = buildHistoryIndex([
      session({ id: 'old', lastUpdated: '2020-01-01T00:00:00.000Z' }),
      session({ id: 'new', lastUpdated: '2026-08-30T10:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
    expect(buildHistoryIndex(Array.from({ length: 500 }, (_, i) => session({ id: `s${i}` }))))
      .toHaveLength(HISTORY_INDEX_MAX);
  });

  it('keeps a session with no timestamp rather than dropping it, and sorts it last', () => {
    // Dropping it would make a real session vanish from history, which is far worse than a bad sort.
    const rows = buildHistoryIndex([session({ id: 'undated', lastUpdated: '' }), session({ id: 'dated' })]);
    expect(rows.map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('drops only a row that could not be opened anyway', () => {
    expect(toIndexRow({ title: 'no id' })).toBeNull();
    expect(buildHistoryIndex([session(), { title: 'no id' }])).toHaveLength(1);
  });

  it('survives junk instead of an array', () => {
    for (const junk of [null, undefined, 'nope', 42, {}]) {
      expect(buildHistoryIndex(junk as unknown)).toEqual([]);
    }
  });
});

describe('reading and writing can never break the first frame', () => {
  it('round-trips', () => {
    writeHistoryIndex(buildHistoryIndex([session()]));
    expect(readHistoryIndex()[0].id).toBe('s1');
  });

  it('returns [] for corrupt, absent or non-array data instead of throwing', () => {
    expect(readHistoryIndex()).toEqual([]);
    for (const bad of ['{not json', 'null', '{"a":1}', '"a string"']) {
      store[HISTORY_INDEX_KEY] = bad;
      expect(readHistoryIndex()).toEqual([]);
    }
  });

  it('filters out rows with no id even from a valid array', () => {
    store[HISTORY_INDEX_KEY] = JSON.stringify([{ id: 'ok' }, { title: 'broken' }, null]);
    expect(readHistoryIndex().map((r) => r.id)).toEqual(['ok']);
  });

  it('a storage failure is swallowed — this is a head start, not the source of truth', () => {
    (globalThis as any).localStorage = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => writeHistoryIndex([{ id: 'a', title: 't', lastUpdated: '' } as HistoryIndexRow])).not.toThrow();
    expect(readHistoryIndex()).toEqual([]);
  });
});

describe('HistoryView paints from disk on the FIRST frame', () => {
  it('seeds state from the cache in a lazy initialiser, not an effect', () => {
    // An effect would still render one frame of skeleton — the exact flash this removes.
    expect(VIEW).toMatch(/useState<any\[\]>\(\(\) => cachedRowsOnce\(\)\)/);
    expect(VIEW).toMatch(/useState\(\(\) => cachedRowsOnce\(\)\.length === 0\)/);
  });

  it('reads the cache once per mount, not once per initialiser', () => {
    expect(VIEW).toMatch(/function cachedRowsOnce/);
    expect(VIEW).toMatch(/if \(cachedRowsMemo === null\) cachedRowsMemo = readHistoryIndex\(\);/);
  });

  it('refreshes the cache from the live snapshot, so other devices appear next time', () => {
    expect(VIEW).toMatch(/writeHistoryIndex\(buildHistoryIndex\(data\)\)/);
    // …and never serves this mount's snapshot to the next one.
    expect(VIEW).toMatch(/cachedRowsMemo = null;/);
  });

  it('the offline path no longer replaces a cached list with an empty one', () => {
    expect(VIEW).toMatch(/if \(local\.length > 0\)/);
  });
});

describe('a fast answer is not allowed to be a wrong one', () => {
  it('says so while a search can only match titles', () => {
    // Index rows carry no message text, so before the real list lands a search would silently report
    // fewer results than exist. The notice appears ONLY while searching, and only until hydration.
    expect(VIEW).toMatch(/!hydrated && searchQuery\.trim\(\) !== ''/);
    expect(VIEW).toMatch(/Searching titles only/);
  });

  it('hydration flips on BOTH the live and the offline path', () => {
    // The offline path loads the full local sessions, so message search works there too — leaving the
    // caveat up would then be its own small lie.
    const flips = VIEW.match(/setHydrated\(true\)/g) ?? [];
    expect(flips.length).toBe(2);
  });
});
