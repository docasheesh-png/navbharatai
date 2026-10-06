// A CLOSED QUEUE ROW STAYS CLOSED (2026-10-06).
//
// #3543 rebuilt BUILD_REPORT_QUEUE.md from a stale copy and silently reopened rows another session had closed
// (Q-129 and Q-151, both fixed and merged) and erased the BLOCKED records of Q-111, Q-114 and Q-126. Under the
// sixth absolute rule the queue IS the contract; a queue that quietly un-resolves items reports false work.
// The register of closed IDs lives in its own append-only file, so a stale rewrite of the queue cannot
// revert it too; this test fails the moment a closed ID is back in the open table.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const queue = readFileSync(join(root, 'BUILD_REPORT_QUEUE.md'), 'utf8');
const register = readFileSync(join(root, 'docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt'), 'utf8');

const openIds = [...queue.matchAll(/^\| *(Q-\d+) *\|/gm)].map((m) => m[1]);
const closedIds = register.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('the build-report queue never un-resolves an item', () => {
  it('no closed ID is back in the open table', () => {
    const reopened = openIds.filter((id) => closedIds.includes(id));
    expect(reopened, 'closed rows reappeared — a queue edit was probably made from a stale copy').toEqual([]);
  });

  it('every line of the register is one well-formed ID, listed once', () => {
    for (const id of closedIds) expect(id).toMatch(/^Q-\d+$/);
    expect(new Set(closedIds).size).toBe(closedIds.length);
  });

  it('every open row has a unique ID', () => {
    expect(new Set(openIds).size).toBe(openIds.length);
    expect(openIds.length).toBeGreaterThan(0);
  });

  it('THE INCIDENT: the rows #3543 reopened are closed, and the BLOCKED records it erased are back', () => {
    for (const id of ['Q-129', 'Q-151']) {
      expect(closedIds).toContain(id);
      expect(openIds).not.toContain(id);
    }
    for (const id of ['Q-111', 'Q-114', 'Q-126']) {
      const row = queue.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
      expect(row, id).toContain('BLOCKED');
      expect(row, id).toContain('**What:**');
    }
  });
});
