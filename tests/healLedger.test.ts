import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  noteHeal, healRepeats, healRepeatMessage, resetHealLedger, _clearHealLedgerForTests,
} from '../src/server/AgentV3/HealLedger';

/**
 * THE OPEN ROOT CAUSE FROM BUILD 02be22e3, turned from a suspicion into a measurement.
 *
 * Three deterministic self-heals ran — "added 2 missing imports", "removed a duplicate import in
 * src/App.tsx", "removed a duplicate import in src/main.tsx" — and the IDENTICAL three ran again
 * twenty seconds later. Each repair pass re-reads every file FRESH from the sandbox and only acts
 * when the defect is genuinely still present, so the second run proves the first heal's write was NOT
 * there on the next read.
 *
 * I refused to guess the mechanism (rule 4), and a suspicion in PROGRESS.md cannot be acted on later.
 * This records the FACT — with file names and counts — in the one place both passes can reach.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

beforeEach(() => _clearHealLedgerForTests());

describe('the evidence: healing the same file twice in one build', () => {
  it('a single heal is normal and is NOT reported', () => {
    noteHeal('ws1', 'src/App.tsx', 'fixed');
    expect(healRepeats('ws1')).toEqual([]);
  });

  it('THE REPORTED CASE: the same file healed twice is captured with its count', () => {
    noteHeal('ws1', 'src/App.tsx', 'fixed');
    noteHeal('ws1', 'src/App.tsx', 'fixed again');   // the second pass found it broken AGAIN
    noteHeal('ws1', 'src/main.tsx', 'fixed');
    noteHeal('ws1', 'src/main.tsx', 'fixed again');
    expect(healRepeats('ws1')).toEqual([
      { path: 'src/App.tsx', times: 2 },
      { path: 'src/main.tsx', times: 2 },
    ]);
  });

  it('the message states what a repeat PROVES, not what it suspects', () => {
    const msg = healRepeatMessage([{ path: 'src/App.tsx', times: 2 }, { path: 'src/main.tsx', times: 3 }]);
    expect(msg).toMatch(/2 file\(s\) had to be healed MORE THAN ONCE/);
    expect(msg).toMatch(/src\/App\.tsx ×2/);
    expect(msg).toMatch(/5 heal passes in total/);
    expect(msg).toMatch(/proves the earlier heal's write was NOT present/);
    // Honest about what still worked — the repair itself was fine; its durability was not.
    expect(msg).toMatch(/what failed is that it did not last/);
  });

  it('workspaces never bleed into each other', () => {
    noteHeal('ws1', 'a.tsx', 'x');
    noteHeal('ws1', 'a.tsx', 'y');
    noteHeal('ws2', 'a.tsx', 'x');
    expect(healRepeats('ws1')).toHaveLength(1);
    expect(healRepeats('ws2')).toEqual([]);
  });

  it('a build starts with a clean sheet, so "twice" means twice in THIS build', () => {
    noteHeal('ws1', 'a.tsx', 'x');
    resetHealLedger('ws1');
    noteHeal('ws1', 'a.tsx', 'y');
    expect(healRepeats('ws1')).toEqual([]);
  });

  it('never throws on junk, and an unknown workspace is simply empty', () => {
    expect(() => noteHeal('', '', '')).not.toThrow();
    expect(() => noteHeal('ws', 'a', undefined as any)).not.toThrow();
    expect(healRepeats('never-seen')).toEqual([]);
    expect(() => resetHealLedger('never-seen')).not.toThrow();
  });

  it('memory is bounded — a pathological build cannot grow it without limit', () => {
    for (let i = 0; i < 1200; i++) noteHeal('ws1', `f${i}.tsx`, 'x');
    // Well under the number of paths offered, and repeats of a KNOWN path still count.
    noteHeal('ws1', 'f0.tsx', 'y');
    expect(healRepeats('ws1')).toEqual([{ path: 'f0.tsx', times: 2 }]);
  });
});

describe('wiring — every deterministic heal reports, and the route turns it into evidence', () => {
  const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
  const route = read('src/server/routes/agentv3.ts');

  it('all three file-writing self-heals record into the ledger', () => {
    // import/export reconcile, wrong-source repoint, duplicate-import dedupe.
    expect((dispatcher.match(/noteHeal\(this\.workspaceId,/g) || []).length).toBe(3);
  });

  it('it needed NO new dispatcher parameter — the reviewer runs on a CHILD dispatcher', () => {
    // A per-instance field would have been blind to exactly the case worth catching, and threading a
    // callback through the sub-agent spawn would have been plumbing for nothing.
    expect(dispatcher).toContain("import { noteHeal } from './HealLedger';");
    const sub = read('src/server/AgentV3/SubAgent.ts');
    expect(sub).toContain('new ToolDispatcher(');
  });

  it('the build starts clean and the finding is recorded at settle', () => {
    expect(route).toContain('resetHealLedger(workspaceId);');
    expect(route).toContain('HEAL_NOT_DURABLE');
    expect(route).toContain('healRepeatMessage(repeats)');
  });

  it('the finding is UNRESOLVED — it is a real defect, not a note', () => {
    const at = route.indexOf('HEAL_NOT_DURABLE');
    expect(route.slice(at - 200, at + 200)).toContain('autoResolved: false');
  });
});
