import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';

/**
 * AUTOPSY 2b0a3ed5 — the twelve files the user was billed for and never asked for.
 *
 * A user asked for a calculator. The golden-scaffold pre-seed put our tested template — 12 files — on
 * disk at second 6.7. The one model call returned **27 tokens in 55.7 seconds**. They pressed Stop at
 * 64 s having seen **no preview at all** (`RELEASE_GATE: RED — no live preview was ever available`),
 * and were billed 50%: **₹0.65**.
 *
 * 🔴 THE POLICY WAS NEVER WRONG. Rule 4 already says *"nothing delivered, nothing charged"*. What was
 * wrong was the NUMBER it reads: the pre-seed writes its template into the build's `writtenFiles` map,
 * so `filesWritten` was 12 and the rule could not fire — for any prompt that HAS a template, which is
 * exactly the set of builds where a user can quit before anything of their own exists.
 *
 * So this is a measurement fix, not a change to the admin's 2026-09-14 cancellation rule. A user who
 * stopped at 90% of a real build is charged exactly as before.
 */

const base = { abortCause: 'user-stop' as const, appRendered: false, decidedBilledUsd: 0.006754 };

describe('🔴 the reported case', () => {
  it('12 template files, none touched by the build → FREE', () => {
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 12, preseededUnchanged: 12 });
    expect(bill.billedUsd).toBe(0);
    expect(bill.discountPct).toBe(100);
    expect(bill.delivery).toBe('nothing');
    expect(bill.userMessage).toBeNull();
  });

  it('…and it was billed half before the fix — the same facts without the new count', () => {
    const old = decideCancelledBuildBill({ ...base, filesWritten: 12 });
    expect(old.billedUsd).toBeCloseTo(0.003377, 6);
    expect(old.discountPct).toBe(50);
  });
});

describe('🔒 what must NOT change — the admin’s cancellation rule is untouched', () => {
  it('a real build stopped with real files is still charged half', () => {
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 20, preseededUnchanged: 0 });
    expect(bill.discountPct).toBe(50);
    expect(bill.billedUsd).toBeCloseTo(0.003377, 6);
  });

  it('a build stopped AFTER the app was seen rendering is still charged in full', () => {
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 12, preseededUnchanged: 12, appRendered: true });
    expect(bill.discountPct).toBe(0);
    expect(bill.billedUsd).toBeCloseTo(0.006754, 6);
  });

  it('anything that is not an explicit Stop still falls through to the free rule', () => {
    expect(decideCancelledBuildBill({ ...base, abortCause: 'timeout', filesWritten: 12 }).applies).toBe(false);
  });

  it('a caller that does not know about templates behaves exactly as today', () => {
    const without = decideCancelledBuildBill({ ...base, filesWritten: 20 });
    const explicitZero = decideCancelledBuildBill({ ...base, filesWritten: 20, preseededUnchanged: 0 });
    expect(without).toEqual(explicitZero);
  });
});

describe('🔴 the loophole this nearly created, and the two prior decisions it must not break', () => {
  it('seed a template → let it RENDER → press Stop is NOT free', () => {
    // My first attempt put the nothing-delivered rule ahead of the rendering check, which would have
    // made "template rendered, user stopped" free for ever. CLAUDE.md settles this case in as many
    // words (autopsy 4efab9d7): *"a zero-write turn that renders is billed by it"* — the user is
    // holding a working app, and what produced it is our business, not theirs.
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 12, preseededUnchanged: 12, appRendered: true });
    expect(bill.discountPct).toBe(0);
    expect(bill.delivery).toBe('working-app');
  });

  it('🔒 …but ZERO files written at all is still free even if a render is claimed', () => {
    // Pinned by the existing suite ("zero files is free even when the app somehow rendered"). Nothing
    // written and something rendered is CONTRADICTORY evidence, and a contradiction lands on free.
    expect(decideCancelledBuildBill({ ...base, filesWritten: 0, appRendered: true }).billedUsd).toBe(0);
  });

  it('🔒 …and junk still resolves to the free side, however it is dressed up', () => {
    for (const filesWritten of [Number.NaN, -3, undefined as never, 'many' as never]) {
      expect(decideCancelledBuildBill({ ...base, filesWritten, appRendered: true }).billedUsd, String(filesWritten)).toBe(0);
    }
  });
});

describe('the builder’s OWN work is still paid for', () => {
  it('a template file the builder REWROTE counts as delivered', () => {
    // 12 seeded, 2 rewritten → 2 files of real work → the normal half charge.
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 12, preseededUnchanged: 10 });
    expect(bill.discountPct).toBe(50);
    expect(bill.delivery).toBe('files-saved');
  });

  it('new files written beside the template count too', () => {
    expect(decideCancelledBuildBill({ ...base, filesWritten: 15, preseededUnchanged: 12 }).discountPct).toBe(50);
  });

  it('🔒 a miscounted caller can only ever be generous, never invent work', () => {
    // More "unchanged" than were written is nonsense; it clamps to zero delivered, never negative.
    const bill = decideCancelledBuildBill({ ...base, filesWritten: 3, preseededUnchanged: 99 });
    expect(bill.billedUsd).toBe(0);
    expect(bill.discountPct).toBe(100);
  });

  it('junk in the new field is treated as zero, not as a crash', () => {
    for (const junk of [Number.NaN, -5, 'x' as never, null as never, undefined]) {
      expect(decideCancelledBuildBill({ ...base, filesWritten: 20, preseededUnchanged: junk }).discountPct, String(junk)).toBe(50);
    }
  });
});

describe('🔒 the wiring — the count must reach the rule', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the scaffold records what it seeded, with content', () => {
    expect(route).toContain('preseededGolden.set(gp, gc)');
    expect(route).toContain('const preseededGolden = new Map<string, string>()');
  });

  it('the bill compares CONTENT, so a rewritten template file is still paid for', () => {
    expect(route).toContain('preseededUnchanged: [...preseededGolden].filter(([p, c]) => writtenFiles.get(p) === c).length');
  });

  it('🔒 `writtenFiles` itself is NOT filtered — other readers mean something different by it', () => {
    // `shouldRetryEmptyBuild` and the render rescue both read its size. Narrowing it here would change
    // a retry decision this fix has no business touching.
    expect(route).toContain('filesWritten: writtenFiles.size,');
  });
});
