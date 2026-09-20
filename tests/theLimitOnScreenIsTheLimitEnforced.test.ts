// THE LIMIT ON SCREEN IS THE LIMIT THE STORE ENFORCES.
//
// WHY (admin 2026-09-20: "agar 4 din baad restore nahi ho sakta to wahan likh kar aana chahiye ki
// --din tak reverse kar sakte hai"). The instruction is right; the premise was mine and wrong. The
// Time Machine has NO time limit — `BuildHistoryStore` keeps the newest N per app and drops the oldest,
// and `DataRetentionManager` says this data is "removed with their account, not with age".
//
// 🔒 So the screen states a COUNT, and it states it from the SAME constant the store enforces. A label
// that restates another module's number is this repo's most expensive recurring bug: it goes stale and
// nothing fails. These tests are what hold the two together.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_SAVED_VERSIONS, retentionNote } from '../src/lib/versionRetention';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('one number, two readers', () => {
  it('the store enforces the shared constant rather than its own copy', () => {
    const store = read('src/server/project/BuildHistoryStore.ts');
    expect(store).toMatch(/import \{ MAX_SAVED_VERSIONS \} from '\.\.\/\.\.\/lib\/versionRetention'/);
    expect(store).toMatch(/const MAX_VERSIONS_PER_WORKSPACE = MAX_SAVED_VERSIONS;/);
    // A re-declared literal is exactly the drift this file exists to prevent.
    expect(store).not.toMatch(/MAX_VERSIONS_PER_WORKSPACE\s*=\s*\d+/);
  });

  it('the panel prints the sentence rather than hardcoding a number', () => {
    const panel = read('src/components/ide/CodeVersioning.tsx');
    expect(panel).toMatch(/import \{ retentionNote \} from '\.\.\/\.\.\/lib\/versionRetention'/);
    expect(panel).toMatch(/retentionNote\(points\.length\)/);
  });
});

describe('what the sentence actually says', () => {
  it('names the real cap', () => {
    expect(retentionNote(0)).toContain(String(MAX_SAVED_VERSIONS));
  });

  it('says there is NO time limit — because there is not one', () => {
    for (const n of [0, 1, 25, MAX_SAVED_VERSIONS, MAX_SAVED_VERSIONS + 10]) {
      expect(retentionNote(n).toLowerCase()).toContain('no time limit');
    }
  });

  it('never invents a number of days, in any wording', () => {
    for (const n of [0, 7, 49, 50, 999]) {
      const note = retentionNote(n).toLowerCase();
      expect(note).not.toMatch(/\d+\s*(day|days|week|weeks|month|months)/);
      expect(note).not.toMatch(/expires?|deleted after|only for/);
    }
  });

  it('tells a user with room how much room, and a full one what happens next', () => {
    expect(retentionNote(10)).toContain(`room for ${MAX_SAVED_VERSIONS - 10} more`);
    expect(retentionNote(MAX_SAVED_VERSIONS)).toContain('removes the oldest one');
    expect(retentionNote(MAX_SAVED_VERSIONS + 5)).toContain('removes the oldest one');
  });

  it('survives junk instead of a count', () => {
    for (const junk of [NaN, -3, undefined as unknown as number, 'x' as unknown as number]) {
      expect(() => retentionNote(junk)).not.toThrow();
      expect(retentionNote(junk)).toContain(String(MAX_SAVED_VERSIONS));
    }
  });
});
