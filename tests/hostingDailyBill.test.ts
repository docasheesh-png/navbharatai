import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  lastCompleteDay, hostingBillKey, hostingLedgerRef, HOSTING_LEDGER_LABEL,
} from '../src/server/AgentV3/hostingBillingDay';
import {
  decideOverage, decideDebtAction, periodStartFrom, daysBetween, HOSTING_DEBT_GRACE_DAYS,
} from '../src/server/lib/hostingOverage';

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

describe('what a plan holder is charged', () => {
  const base = {
    gbToday: 1 as number | null,
    usage: { gbBefore: 0, gbBilled: 0 },
    includedGb: 5,
    ratePerGb: 20,
    hasPlan: true,
    agreed: true,
  };

  it('🔒 charges NOTHING inside the allowance the plan already sold them', () => {
    // This is the double charge the admin caught: a ₹149 holder has BOUGHT 5 GB in the terms they
    // ticked. Billing them from the first byte takes money for something already paid for.
    const d = decideOverage({ ...base, gbToday: 4.9 });
    expect(d.charge).toBe(false);
    expect(d.reason).toBe('within-allowance');
    expect(d.periodGb).toBeCloseTo(4.9, 6);
  });

  it('charges ₹20 per GB, but only for the GB above the allowance', () => {
    const d = decideOverage({ ...base, gbToday: 7 });
    expect(d.charge).toBe(true);
    expect(d.billableGb).toBeCloseTo(2, 6);
    expect(d.inr).toBeCloseTo(40, 2);
  });

  it('🔒 bills the DIFFERENCE, so the allowance is not handed back every day', () => {
    // The allowance is monthly and the job is daily. "Today minus 5 GB" would charge nothing until a
    // single day passed 5 GB, then grant the whole allowance again tomorrow.
    const day1 = decideOverage({ ...base, gbToday: 7 });                       // 7 total, 2 billable
    const day2 = decideOverage({
      ...base, gbToday: 1, usage: { gbBefore: day1.periodGb, gbBilled: day1.billableGb },
    });
    expect(day2.charge).toBe(true);
    expect(day2.billableGb).toBeCloseTo(1, 6);   // the new GB only — not 3
    expect(day2.periodGb).toBeCloseTo(8, 6);
  });

  it('🔒 a LEGACY ₹99 plan is never charged overage — its holder never saw the terms', () => {
    const d = decideOverage({ ...base, gbToday: 50, agreed: false });
    expect(d.charge).toBe(false);
    expect(d.reason).toBe('not-agreed');
  });

  it('🔒 NO PLAN means nothing is billed here — an app running without one is a leaked gate', () => {
    const d = decideOverage({ ...base, gbToday: 50, hasPlan: false });
    expect(d.charge).toBe(false);
    expect(d.reason).toBe('no-plan');
  });

  it('🔒 an UNMEASURED day charges nothing AND adds nothing to the total', () => {
    // A gap treated as zero would shrink the total the user is eventually billed on. Carried
    // honestly instead — under-charging, which is the only safe direction.
    const d = decideOverage({ ...base, gbToday: null, usage: { gbBefore: 6, gbBilled: 1 } });
    expect(d.charge).toBe(false);
    expect(d.reason).toBe('nothing-measured');
    expect(d.periodGb).toBe(6);
  });

  it('🔒 a part-GB that rounds to nothing IS nothing — never a daily invented paisa', () => {
    const d = decideOverage({ ...base, gbToday: 5.0000001 });
    expect(d.charge).toBe(false);
  });

  it('the ledger row is one bucket per user per day, in NavBharatAI’s own words', () => {
    expect(hostingLedgerRef('2026-09-11')).toBe('hosting_2026-09-11');
    expect(HOSTING_LEDGER_LABEL).toBe('NavBharatAI hosting');
    for (const vendor of ['Google', 'Cloud Run', 'GCP']) {
      expect(HOSTING_LEDGER_LABEL, vendor).not.toContain(vendor);
    }
  });
});

describe('when the money does not arrive', () => {
  const base = { owedInr: 50, balanceInr: 0, owedForDays: 0, graceDays: HOSTING_DEBT_GRACE_DAYS };

  it('🔒 a user who owes NOTHING is never touched, whatever their balance is', () => {
    // An empty wallet is not a debt. A site inside its included GB costs its owner nothing, so ₹0
    // changes nothing for them — this is the line between fair and catastrophic.
    expect(decideDebtAction({ ...base, owedInr: 0 })).toBe('none');
    expect(decideDebtAction({ ...base, owedInr: 0, owedForDays: 99 })).toBe('none');
  });

  it('with balance left, nothing happens — the charge simply goes through next time', () => {
    expect(decideDebtAction({ ...base, balanceInr: 10 })).toBe('none');
  });

  it('🔒 an UNREADABLE balance never takes a site offline', () => {
    // A Firestore hiccup must not put somebody's site off the internet.
    expect(decideDebtAction({ ...base, balanceInr: null })).toBe('none');
    expect(decideDebtAction({ ...base, balanceInr: Number.NaN })).toBe('none');
  });

  it('🔒 a reminder ALWAYS comes first, and the grace clock starts at the reminder', () => {
    expect(decideDebtAction({ ...base, owedForDays: 0 })).toBe('warn');
    expect(decideDebtAction({ ...base, owedForDays: HOSTING_DEBT_GRACE_DAYS - 1 })).toBe('warn');
    expect(decideDebtAction({ ...base, owedForDays: HOSTING_DEBT_GRACE_DAYS })).toBe('take-offline');
  });
});

describe('the plan period', () => {
  it('resets with the PLAN, not with the calendar month', () => {
    // A plan bought on the 19th renews on the 19th. An allowance that reset on the 1st would give
    // that user a second free 5 GB in the middle of every period they paid for.
    expect(periodStartFrom('2026-10-19T00:00:00.000Z', 30)).toBe('2026-09-19');
  });

  it('an unreadable expiry yields no period rather than a wrong one', () => {
    expect(periodStartFrom('', 30)).toBe('');
    expect(periodStartFrom('2026-10-19T00:00:00.000Z', 0)).toBe('');
  });

  it('counts whole days from when the debt was first recorded', () => {
    const now = Date.parse('2026-09-13T06:00:00Z');
    expect(daysBetween('2026-09-10T00:00:00Z', now)).toBe(3);
    expect(daysBetween(null, now)).toBe(0);
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

  it('🔒 claims the day BEFORE it measures anything', () => {
    // The allowance is billed against a RUNNING TOTAL, so a job that ran twice would add the same
    // day's GB twice and charge for traffic that never happened.
    const claim = sweep.indexOf('hostingBillingStore.claim(');
    const measure = sweep.indexOf('readHostingUsage(');
    const debit = sweep.indexOf('debitWalletRolledUp(');
    expect(claim).toBeGreaterThan(-1);
    expect(measure).toBeGreaterThan(claim);
    expect(debit).toBeGreaterThan(claim);
  });

  it('🔒 the allowance is the OWNER’S, across all their sites — not one per app', () => {
    // Billing each app against its own 5 GB would hand somebody with three sites fifteen free GB,
    // while the terms they ticked promise five.
    expect(sweep).toContain('const byOwner = new Map<string, DeploymentRecord[]>()');
    expect(sweep).toContain('for (const [ownerId, owned] of byOwner)');
  });

  it('🔒 an app with NO plan is reported, never charged', () => {
    expect(sweep).toContain('NO active plan');
    expect(sweep).toMatch(/if \(!tier\) \{[\s\S]{0,400}continue;/);
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

  it('🔒 takes a site offline ONLY through the decision that requires a reminder first', () => {
    // CHANGED 2026-09-13 on the admin's instruction, and only together with the agreement wording
    // that now states it. The test is not relaxed: it pins that the status change is reachable
    // solely from `decideDebtAction` returning 'take-offline', never from an ad-hoc condition.
    expect(sweep).toContain("decideDebtAction({");
    expect(sweep).toContain("if (action === 'none') return;");
    expect(sweep).toContain("if (action === 'warn')");
    expect(sweep).toMatch(/action === 'warn'[\s\S]*?setStatus\(app\.workspaceId, 'plan_paused'\)/);
    // Marked, never deleted — the files stay and the app returns on publish.
    expect(sweep).not.toContain('deleteHostedService');
  });

  it('🔒 the user is TOLD, both times, in NavBharatAI’s own words', () => {
    expect(sweep).toContain('please top up within');
    expect(sweep).toContain('Nothing has been deleted');
    // Only the MESSAGES the user reads are checked for vendor names — the file itself legitimately
    // imports GoogleAuth to read the meter, and asserting over the whole source would be asserting
    // that admin-side code cannot name the cloud it talks to.
    const messages = [...sweep.matchAll(/message: `([^`]*)`/g)].map((m) => m[1]).join(' ');
    expect(messages.length).toBeGreaterThan(50);
    for (const vendor of ['Google', 'Cloud Run', 'GCP', 'Firebase']) {
      expect(messages, vendor).not.toContain(vendor);
    }
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
