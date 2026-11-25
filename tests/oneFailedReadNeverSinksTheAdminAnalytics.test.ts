/**
 * 🔴 ONE FAILED READ NEVER SINKS THE ADMIN ANALYTICS PAGE (admin 2026-11-25: the Home page said "Could not read the platform
 * analytics: Internal server error. The numbers below are not real until a read succeeds." — and every tile showed 0).
 *
 * Root cause, confirmed in code: /api/admin/analytics ran seven INDEPENDENT Firestore reads in one Promise.all; any single
 * failure (a missing index, a permission, a timeout) became one opaque 500, so the admin saw neither which read failed nor
 * any of the numbers that HAD been read. Now each read is settled on its own and named when it fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { settledRead, type UnreadAnalytics } from '../src/server/lib/adminAnalyticsReads';
import { analyticsUnreadOf } from '../src/lib/analyticsUnread';

describe('settledRead: a failure is named, never a silent 0', () => {
  it('a read that works is returned as it is, and nothing is unread', async () => {
    const unread: UnreadAnalytics[] = [];
    expect(await settledRead(unread, 'users', ['totalUsers'], Promise.resolve(42), 0, () => {})).toBe(42);
    expect(unread).toEqual([]);
  });
  it('a missing index (Firestore FAILED_PRECONDITION) is named with its code and fields; the others still read', async () => {
    const unread: UnreadAnalytics[] = [];
    const missingIndex = Object.assign(new Error('The query requires an index. You can create it here: https://console.firebase.google.com/...'), { code: 9 });
    const [users, revenue] = await Promise.all([
      settledRead(unread, 'registered users', ['totalUsers'], Promise.resolve(4791), 0, () => {}),
      settledRead(unread, 'total revenue', ['totalRevenue'], Promise.reject(missingIndex), 0, () => {}),
    ]);
    expect(users).toBe(4791);           // the read that worked is REAL, not lost with the other
    expect(revenue).toBe(0);
    expect(unread).toEqual([{ read: 'total revenue', fields: ['totalRevenue'], code: '9', message: expect.stringContaining('requires an index') }]);
  });
  it('🔁 reversion: the old Promise.all loses every number when one read fails', async () => {
    const bad = Promise.reject(new Error('PERMISSION_DENIED'));
    await expect(Promise.all([Promise.resolve(4791), bad])).rejects.toThrow('PERMISSION_DENIED');
  });
});

describe('the route uses it for EVERY read, and the page says which numbers are not real', () => {
  const route = readFileSync('src/server/routes/admin.ts', 'utf8');
  const start = route.indexOf("app.get('/api/admin/analytics'");
  const body = route.slice(start, route.indexOf('// ── TAB BADGES', start));
  it('every Firestore read and store call of the page is settled (none left in the bare Promise.all)', () => {
    for (const read of ['wallets.count().get()', ".count().get(), ZERO_AGG('count')", 'select(...WALLET_SUMMARY_FIELDS).get(), EMPTY_SNAP', 'select(...USAGE_LOG_FIELDS).get(), EMPTY_SNAP', "AggregateField.sum('amountPaid') }).get(), ZERO_AGG('total')", "agentV3CostTelemetry.list(PLATFORM_MARGIN_DAYS + 1), []", 'assistantSpendStore.summary(PLATFORM_MARGIN_DAYS + 1), { days: [] }']) expect(body).toContain(read);
    expect(body.match(/settle\('/g)?.length).toBe(9);
    expect(body).toContain('unread,');
  });
  it('a failure past the reads says its real code to the admin, not "Internal server error."', () => {
    expect(body).not.toContain("res.status(500).json({ error: 'Internal server error.' })");
    expect(body).toContain('The analytics could not be computed (${code}:');
  });
  it('the page reads `unread` through a shape check and shows its own banner', () => {
    const page = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(page).toContain('setAnalyticsUnread(analyticsUnreadOf(a.value))');
    expect(page).toContain('Some platform numbers could not be read, so these are NOT real:');
    expect(analyticsUnreadOf({ unread: [{ read: 'total revenue', fields: ['totalRevenue'], code: '9', message: 'index' }, { bogus: 1 }, 'x'] }))
      .toEqual([{ read: 'total revenue', fields: ['totalRevenue'], code: '9', message: 'index' }]);
    expect(analyticsUnreadOf({})).toEqual([]);
    expect(analyticsUnreadOf(null)).toEqual([]);
  });
});
