/**
 * Q-1013 — the green freeze was protecting the BREAKAGE.
 *
 * `design-consistency-heal` is allowlisted, so it may write to a green-latched app. Its own undo,
 * `design-heal-revert`, was not — so when the heal broke a page's syntax, the revert was refused and
 * **the break stayed**. A mechanism whose whole purpose is to keep a working app working was keeping a
 * broken one broken.
 *
 * The route's own comment beside the revert had already identified this as a separate call:
 *   "Named for the ledgers only. NOT 'design-consistency-heal' (allowlisted): that would widen what a
 *    latched app lets through, which is a freeze decision, not an attribution one."
 * This is that decision, made.
 *
 * ⚠️ AND IT WAS WORSE THAN "THE REVERT DID NOT RUN". The refusal is swallowed per file
 * (`catch { /* per-file *\/ }`) while the bookkeeping is not: `writtenFiles.set(path, original)` and
 * `mergeWorkspaceFiles` run regardless. So the build record and the durable store said "reverted" while
 * the live sandbox still held the broken file — a state the report described wrongly, which is the fifth
 * rule's own target.
 *
 * 🔒 SAFE BY CONSTRUCTION, NOT BY JUDGEMENT: the revert writes `beforeHeal[path]` — the PRE-heal bytes,
 * the very content the latch exists to protect — and only for the paths `designHealDecision` chose, i.e.
 * files the heal itself had just written. Allowing it is strictly MORE faithful to the freeze's purpose
 * than refusing it, which is the argument the allowlist already makes for `green-guard-restore` and
 * `sandbox-file-restore`: "Refusing it does not protect the app; it strands it."
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALLOWED_PASSES, latchGreen, clearGreenLatch, isGreenLatched, runInPass, writeRefused,
} from '../src/server/AgentV3/greenFreeze';

const WS = 'ws-q1013';
const PAGE = 'src/App.tsx';

beforeEach(() => latchGreen(WS, [PAGE]));
afterEach(() => clearGreenLatch(WS));

describe('🔴 on a latched app, the heal may write — and now so may its undo', () => {
  it('the app really is latched (the premise, measured not assumed)', () => {
    expect(isGreenLatched(WS)).toBe(true);
    // An unnamed pass is still refused — the freeze is intact, not widened in general.
    expect(writeRefused(WS, PAGE)).toBe(true);
  });

  it('the heal was always allowed to write', async () => {
    await runInPass('design-consistency-heal', async () => {
      expect(writeRefused(WS, PAGE)).toBe(false);
    });
  });

  it('🔴 its revert was REFUSED, and now is not — this is the defect', async () => {
    await runInPass('design-heal-revert', async () => {
      expect(writeRefused(WS, PAGE)).toBe(false);
    });
  });

  it('a pass that merely sounds like a revert is still refused', async () => {
    for (const name of ['design-heal-undo', 'heal-revert', 'design-revert', 'revert']) {
      await runInPass(name, async () => {
        expect(writeRefused(WS, PAGE), name).toBe(true);
      });
    }
  });

  it('the engine\'s own opinion is still refused on a working app', async () => {
    // The freeze's actual purpose, unchanged: a pass that ALTERS a green app on our initiative.
    for (const name of ['reviewer-style-polish', 'design-consistency-suggest', 'tidy-up']) {
      await runInPass(name, async () => {
        expect(writeRefused(WS, PAGE), name).toBe(true);
      });
    }
  });
});

describe('🔒 the allowlist stays a deliberate, enumerated list', () => {
  it('both halves of the heal are on it, and nothing else was added', () => {
    expect(ALLOWED_PASSES.has('design-consistency-heal')).toBe(true);
    expect(ALLOWED_PASSES.has('design-heal-revert')).toBe(true);
    expect([...ALLOWED_PASSES].sort()).toEqual([
      'design-consistency-heal', 'design-heal-revert', 'explorer-repair', 'feature-presence-heal',
      'green-guard-restore', 'reviewer-functional-repair', 'runtime-error-autofix', 'sandbox-file-restore',
      'vaccine-repair',
    ]);
  });

  it('🔑 THE CLASS: every allowlisted pass that WRITES to a latched app has its undo allowed too', () => {
    // A pass permitted to alter a working app can break it. If its undo is refused, the freeze protects
    // the breakage — which is exactly Q-1013. These are the write-and-revert pairs that exist today; a
    // new allowlisted writer with a named revert must bring that revert with it.
    const pairs: Array<[string, string]> = [
      ['design-consistency-heal', 'design-heal-revert'],
      ['reviewer-functional-repair', 'green-guard-restore'], // its verifyAfterFix reverts to the snapshot
    ];
    for (const [writer, undo] of pairs) {
      expect(ALLOWED_PASSES.has(writer), writer).toBe(true);
      expect(ALLOWED_PASSES.has(undo), `${writer} may write but ${undo} cannot undo it`).toBe(true);
    }
  });

  it('the route still reverts to the PRE-HEAL bytes, for the heal\'s own files only', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf("applyGreenSnapshotRestore(revertPlan, undefined, undefined, 'design-heal-revert')");
    expect(at).toBeGreaterThan(0);
    const around = route.slice(at - 600, at + 650);
    // The content written back is the pre-heal snapshot, not a regenerated file.
    expect(around).toContain('write: Object.fromEntries(verdict.revert.map((path) => [path, beforeHeal[path]]))');
    expect(around).toContain('snapshotRestoreComplete(revertPlan, outcome)');
    // And only the paths the guard chose — never the whole project.
    expect(around).toContain('if (verdict.revert.length)');
  });
});
