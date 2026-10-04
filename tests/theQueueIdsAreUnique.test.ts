// BUILD_REPORT_QUEUE (2026-10-04): four concurrent sessions each picked "the next free ID" from the copy of
// the queue they could see, so Q-300..Q-315 were claimed by up to four different open PRs for four different
// problems. A row's ID is how the sixth rule's count is checked and how a PROGRESS.md ledger points back at
// it, so two rows with one ID make both unaddressable. In-flight PRs are invisible to every session, so the
// collision cannot be prevented by reading the file; it is caught where it becomes real: when the second PR
// merges `main` in, both rows sit in one table and this test fails until that session renumbers its own rows.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const QUEUE = join(__dirname, '..', 'BUILD_REPORT_QUEUE.md');

/** The ID column of every row of the open table. */
function queueRowIds(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => /^\|\s*(Q-\d+)\s*\|/.exec(line)?.[1])
    .filter((id): id is string => Boolean(id));
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup].sort();
}

describe('every build-report queue row has its own ID', () => {
  it('reads the ID column of the real queue', () => {
    expect(queueRowIds(readFileSync(QUEUE, 'utf8')).length).toBeGreaterThan(10);
  });

  it('no ID appears on two rows', () => {
    expect(duplicateIds(queueRowIds(readFileSync(QUEUE, 'utf8')))).toEqual([]);
  });

  it('catches the collision that happened (two sessions, one Q-300)', () => {
    const merged = [
      '| ID | Report | Problem | State | Owner | Notes |',
      '|---|---|---|---|---|---|',
      '| Q-300 | dcce5d26 | a website-to-APK request was built | IN PROGRESS | #3490 | |',
      '| Q-300 | d798ddd3 | a review bug written untagged | IN PROGRESS | #3491 | |',
      '| Q-301 | d798ddd3 | something else | OPEN | — | |',
    ].join('\n');
    expect(duplicateIds(queueRowIds(merged))).toEqual(['Q-300']);
  });

  it('does not read an ID mentioned inside a note as a row', () => {
    expect(queueRowIds('| Q-010 | r | p | OPEN | — | same class as Q-010 and Q-017 |')).toEqual(['Q-010']);
  });
});
