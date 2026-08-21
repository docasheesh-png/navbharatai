import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { summariseBuilds, summarisePayments, accountFlags } from './adminUserAccount';

const build = (over: Partial<Parameters<typeof summariseBuilds>[0][number]> = {}) => ({
  sessionId: 'pro-1', title: 'Chai Counter', costInr: 10, status: 'completed', createdAt: 1000, ...over,
});

describe('summariseBuilds — "kitne apps banaye, per app kitna kharch"', () => {
  it('groups builds into APPS, because one app is many builds', () => {
    const s = summariseBuilds([
      build({ sessionId: 'a', costInr: 10, createdAt: 1 }),
      build({ sessionId: 'a', costInr: 15, createdAt: 5 }),
      build({ sessionId: 'b', costInr: 7, createdAt: 3 }),
    ]);
    expect(s.totalBuilds).toBe(3);
    expect(s.apps).toHaveLength(2);
    expect(s.apps.find((a) => a.sessionId === 'a')?.spentInr).toBe(25);
    expect(s.apps.find((a) => a.sessionId === 'a')?.builds).toBe(2);
  });

  it('the app rows always add up to the total — an unattributable build is kept, not dropped', () => {
    // Dropping it would make the rows disagree with the total, which is worse than an "unknown" row.
    const s = summariseBuilds([build({ sessionId: '', costInr: 12 }), build({ sessionId: 'a', costInr: 8 })]);
    expect(s.spentInr).toBe(20);
    expect(s.apps.reduce((n, a) => n + a.spentInr, 0)).toBe(20);
    expect(s.apps.some((a) => a.sessionId === '(unattributed)')).toBe(true);
  });

  it('counts each outcome separately — a failed build is not a built app', () => {
    const s = summariseBuilds([
      build({ status: 'completed' }), build({ status: 'failed', costInr: 0 }), build({ status: 'cancelled', costInr: 2 }),
    ]);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(1);
  });

  it('shows the most recently touched app first', () => {
    const s = summariseBuilds([build({ sessionId: 'old', createdAt: 10 }), build({ sessionId: 'new', createdAt: 99 })]);
    expect(s.apps[0].sessionId).toBe('new');
  });

  it('survives rows with missing or broken numbers', () => {
    const s = summariseBuilds([{ }, { costInr: Number.NaN }, { costInr: 5 }] as never[]);
    expect(s.spentInr).toBe(5);
    expect(s.totalBuilds).toBe(3);
  });

  it('never invents a title', () => {
    expect(summariseBuilds([build({ title: '' })]).apps[0].title).toBe('Untitled app');
  });
});

describe('summarisePayments — "kitni bar real ₹ recharge kiya"', () => {
  it('counts ONLY money that actually arrived', () => {
    // A created order is not a payment. Counting one would overstate what a user has paid us, on the
    // screen where an admin decides whether to trust them.
    const s = summarisePayments([
      { amountPaid: 100, paymentStatus: 'SUCCESS', createdAt: '2026-08-01T00:00:00Z' },
      { amountPaid: 500, paymentStatus: 'PENDING', createdAt: '2026-08-02T00:00:00Z' },
      { amountPaid: 200, paymentStatus: 'FAILED', createdAt: '2026-08-03T00:00:00Z' },
    ]);
    expect(s.successful).toBe(1);
    expect(s.totalInr).toBe(100);
    expect(s.unfinished).toBe(2);
  });

  it('remembers when they last paid', () => {
    const s = summarisePayments([
      { amountPaid: 1, paymentStatus: 'SUCCESS', createdAt: '2026-01-01T00:00:00Z' },
      { amountPaid: 1, paymentStatus: 'success', createdAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(s.successful).toBe(2);
    expect(new Date(s.lastAt as number).getUTCMonth()).toBe(5);
  });

  it('an unparseable date does not lose the payment', () => {
    const s = summarisePayments([{ amountPaid: 50, paymentStatus: 'SUCCESS', createdAt: 'not a date' }]);
    expect(s.successful).toBe(1);
    expect(s.totalInr).toBe(50);
    expect(s.lastAt).toBeNull();
  });
});

describe('accountFlags — few, and only the ones that change a decision', () => {
  const noBuilds = summariseBuilds([]);
  const noMoney = summarisePayments([]);

  it('says nothing about an ordinary account', () => {
    expect(accountFlags({ builds: noBuilds, payments: noMoney, reportsAgainst: 0 })).toEqual([]);
  });

  it('flags heavy spending with no completed payment ever', () => {
    const builds = summariseBuilds(Array.from({ length: 5 }, () => build({ costInr: 200 })));
    const flags = accountFlags({ builds, payments: noMoney, reportsAgainst: 0 });
    expect(flags.join(' ')).toMatch(/without ever completing a payment/i);
  });

  it('flags an unusual rate of failed builds, not a couple of failures', () => {
    const mostlyFailed = summariseBuilds(Array.from({ length: 10 }, (_, i) => build({ status: i < 7 ? 'failed' : 'completed' })));
    expect(accountFlags({ builds: mostlyFailed, payments: noMoney, reportsAgainst: 0 }).join(' ')).toMatch(/failed/i);

    const someFailed = summariseBuilds(Array.from({ length: 10 }, (_, i) => build({ status: i < 3 ? 'failed' : 'completed' })));
    expect(accountFlags({ builds: someFailed, payments: noMoney, reportsAgainst: 0 })).toEqual([]);
  });

  it('flags an account several different people have reported', () => {
    expect(accountFlags({ builds: noBuilds, payments: noMoney, reportsAgainst: 3 }).join(' ')).toMatch(/3 separate reports/);
    expect(accountFlags({ builds: noBuilds, payments: noMoney, reportsAgainst: 1 })).toEqual([]);
  });
});

// ── The honesty guard ────────────────────────────────────────────────────────
describe('the account route never presents an unread number as zero', () => {
  const routes = readFileSync(join(process.cwd(), 'src/server/routes/reports.ts'), 'utf8');

  it('every section reports whether it was actually read', () => {
    // A failed query showing "0 recharges" would show an admin a person who never paid us — on the
    // screen where they decide whether to suspend the account.
    expect(routes).toContain("'/api/admin/users/:uid/account'");
    for (const section of ['wallet: {\n        ok:', 'builds: { ok:', 'payments: { ok:', 'publishedApps: {\n        ok:']) {
      expect(routes.includes(section), `missing ok flag: ${section}`).toBe(true);
    }
  });

  it('is behind the real admin gate', () => {
    const line = routes.split('\n').find((l) => l.includes("'/api/admin/users/:uid/account'"));
    expect(line).toContain('requireAdmin');
  });
});

describe('the account sheet is reachable from both places a decision starts', () => {
  const panel = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('opens from a report — both the reporter and the reported person', () => {
    // Making an admin leave the complaint and hunt through another tab is how reports stop getting
    // handled at all.
    expect(panel).toContain('openAccount(openReport.report.reporterUid)');
    expect(panel).toContain('openAccount(openReport.report.target.ownerUid)');
  });

  it('opens from the Users tab, and it is the SAME sheet, not a second one', () => {
    expect(panel).toContain('openAccount(u.userId)');
    expect(panel.match(/const openAccount = useCallback/g) || []).toHaveLength(1);
  });

  it('shows "unread" rather than a confident zero', () => {
    expect(panel).toContain("{c.value ?? 'unread'}");
  });

  it('can suspend and un-suspend from there, through the ban path that already exists', () => {
    expect(panel).toContain('handleBan(account.uid, !account.wallet?.banned)');
  });
});
