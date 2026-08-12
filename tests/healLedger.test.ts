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

  // CHANGED 2026-08-10, and the change is the point. This test used to require the message to say a
  // repeat "proves the earlier heal's write was NOT present" — but that was never proved, it was
  // ASSUMED. The ledger stored a hash of what each heal left behind and nothing ever read it, so the
  // one piece of evidence that could settle the question went unused while the message asserted one
  // of the two possible answers as fact. That is the worst kind of wrong: it reads as a conclusion and
  // it sends whoever acts on it straight into the sandbox write path, which may be the wrong file
  // entirely. The message now states ONLY what the hash comparison supports.
  it('the message names the cause it can prove, and admits the one it cannot', () => {
    const msg = healRepeatMessage([
      { path: 'src/App.tsx', times: 2, cause: 'changed' },
      { path: 'src/main.tsx', times: 3, cause: 'unchanged' },
      { path: 'src/theme.tsx', times: 2 },
    ]);
    expect(msg).toMatch(/3 file\(s\) had to be healed MORE THAN ONCE/);
    expect(msg).toMatch(/src\/App\.tsx ×2 \(file changed under us\)/);
    expect(msg).toMatch(/src\/main\.tsx ×3 \(our write held\)/);
    expect(msg).toMatch(/7 heal passes in total/);
    // 'changed' → the file moved underneath us: go and look at the write/restore path.
    expect(msg).toMatch(/lost write or something later overwriting it/);
    // 'unchanged' → nothing was lost; the detector re-fired on content it had already fixed. This is
    // the branch nobody had considered, and it points at a completely different file to investigate.
    expect(msg).toMatch(/Look at the detector, not at the sandbox/);
    // And where we genuinely do not know, it says so rather than picking the likelier story.
    expect(msg).toMatch(/genuinely \s*unknown — not assumed/);
  });

  it('splits the two causes from the hash of what the previous heal left behind', () => {
    noteHeal('wsA', 'a.tsx', 'HEALED', 'broken');            // first pass: nothing to compare with yet
    noteHeal('wsA', 'a.tsx', 'HEALED', 'HEALED');            // found exactly what we left → write held
    expect(healRepeats('wsA')).toEqual([{ path: 'a.tsx', times: 2, cause: 'unchanged' }]);

    noteHeal('wsB', 'b.tsx', 'HEALED', 'broken');
    noteHeal('wsB', 'b.tsx', 'HEALED', 'something else');    // file moved underneath us
    expect(healRepeats('wsB')).toEqual([{ path: 'b.tsx', times: 2, cause: 'changed' }]);
  });

  it('claims no cause when the caller did not supply what it read', () => {
    // Silence is the honest answer here. A default of either value would invent evidence.
    noteHeal('wsC', 'c.tsx', 'HEALED');
    noteHeal('wsC', 'c.tsx', 'HEALED');
    expect(healRepeats('wsC')).toEqual([{ path: 'c.tsx', times: 2 }]);
  });

  it('keeps the first verdict — a later pass must not erase the evidence', () => {
    // The second pass is the one that caught the file mid-flight. If a third happens to read something
    // that matches, overwriting the verdict would quietly turn a real finding into a benign one.
    noteHeal('wsD', 'd.tsx', 'HEALED', 'broken');
    noteHeal('wsD', 'd.tsx', 'HEALED', 'stale copy');        // 'changed'
    noteHeal('wsD', 'd.tsx', 'HEALED', 'HEALED');            // would say 'unchanged' — must not win
    expect(healRepeats('wsD')).toEqual([{ path: 'd.tsx', times: 3, cause: 'changed' }]);
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

  it('all FOUR file-writing self-heals record into the ledger', () => {
    // import/export reconcile, MISSING-IMPORT add, wrong-source repoint, duplicate-import dedupe.
    //
    // Was 3 until 2026-08-10. The missing-import heal wrote files and never reported, and it is the
    // one the 2026-08-09 report showed repeating FIRST ("Added 2 missing import(s)" at t=126s, 216s
    // and 313s) — so the ledger was blind to the very case it was built to capture.
    expect((dispatcher.match(/noteHeal\(this\.workspaceId,/g) || []).length).toBe(4);
  });

  it('every heal hands over the content it READ, not just what it wrote', () => {
    // Without the before-content there is nothing to compare against and the cause is always unknown,
    // which is the state this whole change exists to leave behind.
    const calls = dispatcher.match(/noteHeal\(this\.workspaceId,[^;]*\)/g) || [];
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.split(',').length).toBeGreaterThanOrEqual(4);
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
