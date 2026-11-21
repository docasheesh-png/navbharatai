/**
 * Firestore bill audit, 2026-11-21 — the polled reads and the admin analytics page.
 *
 *   • provider_cooldowns: ~1,29,000 runs in 30 days (every 20 s, every instance, 24/7, every document).
 *   • admin_notifications: ~27,000 runs (every signed-in tab every 90 s, the same newest 50 each time).
 *   • /api/admin/analytics: every wallet, every chat usage log ever written and every payment, per load.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cooldownSyncTick, isRecentlyActive, COOLDOWN_SYNC_INTERVAL_MS, COOLDOWN_SYNC_ACTIVE_WINDOW_MS } from '../src/server/lib/ProviderCooldownStore';
import { createTtlCache, NOTIFICATIONS_CACHE_TTL_MS } from '../src/server/lib/AdminNotificationStore';
import { walletsCreatedOn } from '../src/server/lib/adminUserActivity';
import { analyticsWindowNote } from '../src/lib/adminAnalyticsWindow';

describe('provider cooldown sync', () => {
  it('reads nothing while this instance routes no AI calls', async () => {
    const read = vi.fn(async () => ({ GROK: Date.now() + 60_000 }));
    const merge = vi.fn();
    expect(await cooldownSyncTick(read, merge, () => false)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  });
  it('reads and merges while active, and never throws', async () => {
    const merge = vi.fn();
    expect(await cooldownSyncTick(async () => ({ GROK: 5 }), merge, () => true)).toBe(true);
    expect(merge).toHaveBeenCalledWith({ GROK: 5 });
    expect(await cooldownSyncTick(async () => { throw new Error('x'); }, merge, () => true)).toBe(false);
  });
  it('an instance idle past the window counts as inactive; one that just routed is active', () => {
    expect(isRecentlyActive(0, COOLDOWN_SYNC_ACTIVE_WINDOW_MS)).toBe(false);
    expect(isRecentlyActive(1_000, 1_000 + COOLDOWN_SYNC_ACTIVE_WINDOW_MS - 1)).toBe(true);
  });
  it('reads only live cooldowns, at most once a minute, gated on router activity', () => {
    const store = readFileSync('src/server/lib/ProviderCooldownStore.ts', 'utf8');
    expect(store).toMatch(/collection\('provider_cooldowns'\)\.where\('until', '>', Date\.now\(\)\)\.get\(\)/);
    expect(store).not.toMatch(/collection\('provider_cooldowns'\)\.get\(\)/);
    expect(COOLDOWN_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
    const router = readFileSync('src/server/AI/Router/AIRouter.ts', 'utf8');
    expect(router).toMatch(/startSync\(mergeRemoteCooldowns, \{ lastActivityMs: \(\) => lastProviderCallMs \}\)/);
    // The router imports nothing else from the store: tests that mock it supply only the store object.
    expect(router).toMatch(/import \{ providerCooldownStore \} from '\.\.\/\.\.\/lib\/ProviderCooldownStore';/);
    // Activity is marked on the path every routed call takes.
    expect(router).toMatch(/function isOnCooldown\(name: string\): boolean \{\s*lastProviderCallMs = Date\.now\(\);/);
  });
});

describe('the notification inbox list is cached, the per-user state is not', () => {
  it('one load per TTL, shared by concurrent callers, cleared on save', async () => {
    let t = 0;
    const cache = createTtlCache<number>(NOTIFICATIONS_CACHE_TTL_MS, () => t);
    const load = vi.fn(async () => 7);
    await Promise.all([cache.get(load), cache.get(load), cache.get(load)]);
    expect(load).toHaveBeenCalledTimes(1);
    t += NOTIFICATIONS_CACHE_TTL_MS - 1; await cache.get(load);
    expect(load).toHaveBeenCalledTimes(1);
    t += 1; await cache.get(load);
    expect(load).toHaveBeenCalledTimes(2);
    cache.clear(); await cache.get(load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('a failed load is not cached', async () => {
    const cache = createTtlCache<number>(60_000, () => 0);
    await expect(cache.get(async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await cache.get(async () => 3)).toBe(3);
  });
  it('the store caches the shared list and clears it on save; the bell skips hidden tabs', () => {
    const store = readFileSync('src/server/lib/AdminNotificationStore.ts', 'utf8');
    expect(store).toMatch(/await latestCache\.get\(read\)/);
    expect(store).toMatch(/latestCache\.clear\(\);\s*return note;/);
    // The per-user read/dismissed state is read fresh on every request.
    expect(store).toMatch(/const state = uid \? await getUserState\(uid\)/);
    const bell = readFileSync('src/components/NotificationBell.tsx', 'utf8');
    expect(bell).toMatch(/setInterval\(\(\) => \{ if \(visible\(\)\) void load\(\); \}, NOTIFICATION_POLL_MS\)/);
  });
});

describe('/api/admin/analytics reads no whole collection', () => {
  const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
  const start = admin.indexOf("app.get('/api/admin/analytics'");
  const route = admin.slice(start, admin.indexOf('app.get(', start + 10));

  it('wallets: a count, a ranged count and a top-10 — never every wallet', () => {
    expect(route).toMatch(/wallets\.count\(\)\.get\(\)/);
    expect(route).toMatch(/wallets\.orderBy\('totalTokensUsed', 'desc'\)\.limit\(10\)/);
    expect(route).not.toMatch(/collection\('user_token_wallets'\)\.select\([^)]*\)\.get\(\)/);
  });
  it('chat usage: a bounded, capped window — never every log ever written', () => {
    expect(route).toMatch(/collection\('ai_usage_logs'\)\.where\('createdAt', '>=', windowStartIso\)\s*\.orderBy\('createdAt', 'desc'\)\.limit\(ANALYTICS_USAGE_ROW_CAP\)/);
    expect(route).not.toMatch(/collection\('ai_usage_logs'\)\.select\(\.\.\.USAGE_LOG_FIELDS\)\.get\(\)/);
  });
  it('payments: an all-time SUM plus the window — never every payment', () => {
    expect(route).toMatch(/aggregate\(\{ total: AggregateField\.sum\('amountPaid'\) \}\)/);
    expect(route).not.toMatch(/getDocs\(/);
    expect(route).toMatch(/window: \{ days: ANALYTICS_WINDOW_DAYS/);
  });

  it('the new-users-today range counts exactly what walletsCreatedOn counts', () => {
    const day = '2026-11-21';
    const wallets = [
      { createdAt: '2026-11-21T00:00:00.000Z' }, { createdAt: '2026-11-21T23:59:59.999Z' }, { createdAt: '2026-11-21' },
      { createdAt: '2026-11-20T23:59:59.999Z' }, { createdAt: '2026-11-22T00:00:00.000Z' }, { createdAt: 1_763_683_200_000 },
      { createdAt: undefined }, {},
    ];
    const inRange = wallets.filter((w) => typeof w.createdAt === 'string' && w.createdAt >= day && w.createdAt < `${day}￿`).length;
    expect(inRange).toBe(walletsCreatedOn(wallets, day));
    expect(inRange).toBe(3);
    expect(route).toMatch(/where\('createdAt', '>=', today2\)\.where\('createdAt', '<', `\$\{today2\}\\uffff`\)\.count\(\)\.get\(\)/);
  });

  it('every windowed tile says so; an old server gets no note', () => {
    expect(analyticsWindowNote({ days: 30 })).toBe(' · last 30 days');
    expect(analyticsWindowNote({ days: 30, usageCapped: true, usageRowCap: 20_000 })).toContain('newest 20,000 chat turns only');
    expect(analyticsWindowNote(undefined)).toBe('');
    expect(analyticsWindowNote({ days: 0 })).toBe('');
    const page = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(page.match(/analyticsWindowNote\(analytics\?\.window\)/g)?.length).toBe(4);
  });
});
