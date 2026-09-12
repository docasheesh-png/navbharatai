import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  lastCompleteDay, hostingBillKey, hostingLedgerRef, HOSTING_LEDGER_LABEL,
  decideHostingDebit, hostingDebitNote,
} from '../src/server/AgentV3/hostingBillingDay';

/**
 * THE DAILY HOSTING BILL (ROADMAP §11 slice 2.1).
 *
 * The only way a billing job goes really wrong is by billing the same thing twice, so most of what
 * follows is about the window and the guard rather than about the arithmetic.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * Source with comment lines removed. An assertion that a file does NOT do something must not be
 * satisfiable — or breakable — by the file EXPLAINING why it does not: the "does not pause" test below
 * failed on its own module's header, which says in words that pausing is the admin's decision.
 */
function codeOf(src: string): string {
  return src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');
}

describe('the billing window', () => {
  it('is the last COMPLETE UTC day, named by its date', () => {
    const w = lastCompleteDay(Date.parse('2026-09-12T04:00:00Z'));
    expect(w.day).toBe('2026-09-11');
    expect(w.startIso).toBe('2026-09-11T00:00:00.000Z');
    expect(w.endIso).toBe('2026-09-12T00:00:00.000Z');
  });

  it('🔒 does NOT move with the moment the job happens to run', () => {
    // "The last 24 hours" overlaps itself whenever a run is late, retried, or fired twice — and
    // under-counts whenever one is early. A closed day asked for twice returns the same number,
    // which is what makes the idempotency key mean anything.
    const early = lastCompleteDay(Date.parse('2026-09-12T04:00:00Z'));
    const late = lastCompleteDay(Date.parse('2026-09-12T23:59:59Z'));
    expect(late).toEqual(early);
  });

  it('🔒 never bills part of today', () => {
    const w = lastCompleteDay(Date.parse('2026-09-12T18:00:00Z'));
    expect(Date.parse(w.endIso)).toBeLessThanOrEqual(Date.parse('2026-09-12T00:00:00Z'));
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(lastCompleteDay(Date.parse('2026-10-01T04:00:00Z')).day).toBe('2026-09-30');
    expect(lastCompleteDay(Date.parse('2027-01-01T04:00:00Z')).day).toBe('2026-12-31');
  });

  it('🔒 the guard key CONTAINS the day — a key without it would let a second run re-bill the hours', () => {
    expect(hostingBillKey('ws1', '2026-09-11')).toBe('ws1_2026-09-11');
    expect(hostingBillKey('ws1', '2026-09-11')).not.toBe(hostingBillKey('ws1', '2026-09-12'));
  });
});

describe('what to debit', () => {
  const base = { billableUsd: 1, usdInr: 87, ownerId: 'u1', billingEnabled: true };

  it('charges the rupee value of what hostingBillableUsd already decided', () => {
    expect(decideHostingDebit(base)).toEqual({ charge: true, reason: 'charge', billedInr: 87 });
  });

  it('🔒 charges NOTHING while the switch is off — measured, recorded, absorbed', () => {
    expect(decideHostingDebit({ ...base, billingEnabled: false }))
      .toEqual({ charge: false, reason: 'billing-off', billedInr: 0 });
  });

  it('🔒 an ORPHANED app is named, never charged to somebody else and never a silent zero', () => {
    const d = decideHostingDebit({ ...base, ownerId: null });
    expect(d).toEqual({ charge: false, reason: 'no-owner', billedInr: 0 });
    expect(hostingDebitNote(d, '2026-09-11')).toContain('no owner');
  });

  it('🔒 a charge that rounds to nothing IS nothing — never rounded up to a paisa', () => {
    // Doing that daily, for every app, would be a real recurring invented bill.
    expect(decideHostingDebit({ ...base, billableUsd: 0.00001 }).charge).toBe(false);
    expect(decideHostingDebit({ ...base, billableUsd: 0 }).charge).toBe(false);
  });

  it('an unusable FX rate charges nothing rather than guessing one', () => {
    expect(decideHostingDebit({ ...base, usdInr: 0 }).charge).toBe(false);
    expect(decideHostingDebit({ ...base, usdInr: Number.NaN }).charge).toBe(false);
  });

  it('the ledger row is one bucket per user per day, in NavBharatAI’s own words', () => {
    expect(hostingLedgerRef('2026-09-11')).toBe('hosting_2026-09-11');
    expect(HOSTING_LEDGER_LABEL).toBe('NavBharatAI hosting');
    for (const vendor of ['Google', 'Cloud Run', 'GCP']) {
      expect(HOSTING_LEDGER_LABEL, vendor).not.toContain(vendor);
    }
  });
});

describe('the guard', () => {
  const store = codeOf(read('src/server/AgentV3/HostingBillingStore.ts'));

  it('🔒 claims with `create`, not `set` — a set would overwrite the proof of an earlier charge', () => {
    expect(store).toMatch(/\.doc\(hostingBillKey\([^)]*\)\)\.create\(/);
    expect(store).not.toMatch(/\.create\([\s\S]{0,200}merge: true/);
  });

  it('🔒 a database error means DO NOT CHARGE — the one fail-closed store on this path', () => {
    // The opposite of jobLease, which runs the job anyway when it cannot read its lease. A purge that
    // runs twice costs reads; a charge that runs twice takes money from a real person twice.
    expect(store).toMatch(/catch \{[\s\S]{0,400}return false;/);
  });
});

describe('the sweep', () => {
  const sweep = codeOf(read('src/server/AgentV3/hostingBillingSweep.ts'));

  it('🔒 reserves BEFORE it debits', () => {
    // If the reservation lands and the debit fails we absorb one day of one app. The reverse order
    // risks charging twice, which is the outcome the billing law never permits.
    const claim = sweep.indexOf('hostingBillingStore.claim(');
    const debit = sweep.indexOf('debitWalletRolledUp(');
    expect(claim).toBeGreaterThan(-1);
    expect(debit).toBeGreaterThan(claim);
  });

  it('🔒 a failed claim charges nothing and says so', () => {
    expect(sweep).toMatch(/if \(!claimed\) \{[\s\S]{0,300}continue;/);
  });

  it('🔒 uses the RECORDED service name, falling back to the derivation only for old records', () => {
    // serviceNameFor folds the app's NAME in, and an app can be renamed — after which a derived name
    // addresses a service that does not exist, and the sweep bills Rs 0 for an app costing us money.
    expect(sweep).toContain("String(app.service ?? '').trim() || serviceNameFor(app.workspaceId, null)");
  });

  it('🔒 an incomplete registry read is REPORTED, never mistaken for "no apps"', () => {
    expect(sweep).toContain('registryComplete');
    expect(sweep).toContain('listWithCompleteness');
  });

  it('one app’s failure never stops the sweep', () => {
    expect(sweep).toMatch(/for \(const app of apps\) \{[\s\S]*?try \{/);
    expect(sweep).toContain('hosting billing failed');
  });

  it('bills only apps that are HOSTED and LIVE', () => {
    expect(sweep).toContain("String(r.providerId ?? '') === NAVBHARAT_CLOUD_PROVIDER");
    expect(sweep).toContain("(r.status ?? 'active') === 'active'");
  });

  it('🔒 does not pause anybody’s app — that decision is the admin’s', () => {
    expect(sweep).not.toContain('plan_paused');
    expect(sweep).not.toContain('setStatus');
  });
});

describe('the job', () => {
  const boot = read('server.ts');

  it('🔒 is exclusive — two instances must not each try to charge the same app-day', () => {
    const at = boot.indexOf("id: 'hosting-daily-bill'");
    expect(at).toBeGreaterThan(-1);
    const decl = boot.slice(at, at + 400);
    expect(decl).toContain('exclusive: true');
    expect(decl).toContain("kind: 'dailyAtUtc'");
  });

  it('never lets a billing failure affect the server', () => {
    const at = boot.indexOf("id: 'hosting-daily-bill'");
    expect(boot.slice(at, at + 2000)).toContain('.catch(()');
  });
});

describe('the takedown’s matching fix', () => {
  const route = codeOf(read('src/server/routes/agentv3.ts'));

  it('🔒 deletes the RECORDED service — a derived one would leak a slot out of a hard cap of 1,000', () => {
    expect(route).toContain("const recordedService = String(rec?.service ?? '').trim();");
    expect(route).toContain('service: recordedService || serviceNameFor(workspaceId,');
  });
});
