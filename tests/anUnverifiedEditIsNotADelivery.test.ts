/**
 * 🔴 AUTOPSY 95598899 — a user was charged ₹23.81 for a turn that broke their working app.
 *
 * They had a 35-file marketplace in the workspace. The turn overwrote four of its entry files, left
 * the release gate RED and the app throwing `Cannot read properties of null (reading 'useState')` on
 * load. They typed *"No parrot or no app, don't work on any project"* to make it stop, and the bill
 * came at the `files-saved` rate — **half of the work done, for damage.**
 *
 * `files-saved` reads "files were written" as "value was delivered". On a FRESH build that is fair:
 * the user now holds something they did not have before and can resume from it. On an EDIT it can be
 * exactly backwards — they may hold LESS than they started with, and with no verified render nobody,
 * including us, can say which. **The party that cannot show it should not be the one paid.**
 *
 * ⚠️ The ordering is the whole design and these cases pin it: a VERIFIED edit is still charged in
 * FULL (admin 2026-09-15, *"app bani = preview chala"*). Only the unverified case is free.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideCancelledBuildBill, type CancelledBuildFacts } from '../src/server/AgentV3/cancelledBuildBilling';

/** The real shape of build 95598899: an edit, files overwritten, nothing ever seen rendering. */
const theRealBuild: CancelledBuildFacts = {
  abortCause: 'user-stop',
  filesWritten: 4,
  preseededUnchanged: 0,
  appRendered: false,
  editingExistingApp: true,
  decidedBilledUsd: 0.248124,   // the exact billedUsd from that report
};

describe('🔴 the build that charged ₹23.81 for damage', () => {
  it('is not charged at all any more', () => {
    const bill = decideCancelledBuildBill(theRealBuild);
    expect(bill.billedUsd).toBe(0);
    expect(bill.discountPct).toBe(100);
    expect(bill.delivery).toBe('unverified-edit');
  });

  it('REVERSION GUARD: without the edit fact it is still the old half charge', () => {
    // The same build, described as a fresh one — which is what the module used to see.
    const asFresh = decideCancelledBuildBill({ ...theRealBuild, editingExistingApp: false });
    expect(asFresh.delivery).toBe('files-saved');
    expect(asFresh.billedUsd).toBeCloseTo(0.124062, 6);
  });

  it('the admin reason says what happened, without blaming the user', () => {
    const r = decideCancelledBuildBill(theRealBuild).reason;
    expect(r).toContain('may be in a worse state than it started');
    expect(r).toContain('not charged');
  });

  it('🔒 and no user-facing message is emitted — there is nothing to explain about ₹0', () => {
    expect(decideCancelledBuildBill(theRealBuild).userMessage).toBeNull();
  });
});

describe('🔒 the ordering, which is the whole design', () => {
  it('⚠️ a VERIFIED edit is still charged IN FULL — "app bani = preview chala"', () => {
    const bill = decideCancelledBuildBill({ ...theRealBuild, appRendered: true });
    expect(bill.billedUsd).toBeCloseTo(0.248124, 6);
    expect(bill.discountPct).toBe(0);
    expect(bill.delivery).toBe('working-app');
  });

  it('a FRESH build with real files is untouched — it still pays half', () => {
    const fresh = decideCancelledBuildBill({ ...theRealBuild, editingExistingApp: false });
    expect(fresh.discountPct).toBe(50);
  });

  it('a fresh build holding only our template keeps its OWN, more specific reason', () => {
    const templateOnly = decideCancelledBuildBill({
      ...theRealBuild, editingExistingApp: false, filesWritten: 12, preseededUnchanged: 12,
    });
    expect(templateOnly.billedUsd).toBe(0);
    expect(templateOnly.reason).toContain('only the platform template existed');
  });

  it('zero files is free whether it was an edit or not', () => {
    for (const editing of [true, false]) {
      const b = decideCancelledBuildBill({ ...theRealBuild, filesWritten: 0, editingExistingApp: editing });
      expect(b.billedUsd).toBe(0);
      expect(b.delivery).toBe('nothing');
    }
  });

  it('🔒 it only applies to a USER STOP — every other ending is the unchanged free rule', () => {
    for (const cause of ['budget', 'timeout', 'error'] as const) {
      const b = decideCancelledBuildBill({ ...theRealBuild, abortCause: cause as never });
      expect(b.applies).toBe(false);
    }
  });

  it('an omitted edit fact means fresh — today\'s behaviour exactly, for every existing caller', () => {
    const { editingExistingApp, ...withoutIt } = theRealBuild;
    expect(editingExistingApp).toBe(true);           // the fixture really carried it
    expect(decideCancelledBuildBill(withoutIt).delivery).toBe('files-saved');
  });

  it('🔒 the charge can still only ever go DOWN — rule 3 is unbroken', () => {
    for (const editing of [true, false]) {
      for (const rendered of [true, false]) {
        const b = decideCancelledBuildBill({ ...theRealBuild, editingExistingApp: editing, appRendered: rendered });
        expect(b.billedUsd).toBeLessThanOrEqual(theRealBuild.decidedBilledUsd);
        expect(b.billedUsd).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('🔒 the wiring — a rule the route never feeds is not a fix', () => {
  it('the BILLING call — not some other one — passes its own edit-mode signal', () => {
    // ⚠️ Scoped to the `decideCancelledBuildBill` argument object on purpose, and the reversion proof
    // is why: a bare `toContain('editingExistingApp: isEditMode,')` PASSED with the billing call site
    // deleted, because `AgentRunner`'s options carry a field of the same name three thousand lines
    // away. A wiring test that any call site can satisfy tests nothing.
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const at = route.indexOf('decideCancelledBuildBill({');
    expect(at, 'the billing call is gone entirely').toBeGreaterThan(-1);
    const call = route.slice(at, route.indexOf('})', at));
    expect(call).toContain('editingExistingApp: isEditMode,');
    expect(call).toContain('appRendered:');
  });

  it('⚠️ the new branch sits BELOW appRendered in the source, not above it', () => {
    // Behaviour is pinned above; this pins the ORDER, because swapping the two would silently make
    // every verified edit free and no behavioural case above would notice on its own.
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/cancelledBuildBilling.ts'), 'utf8');
    expect(src.indexOf('f.appRendered === true')).toBeLessThan(src.indexOf('f.editingExistingApp === true'));
  });
});
