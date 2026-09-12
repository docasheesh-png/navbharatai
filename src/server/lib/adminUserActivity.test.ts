import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAuthUserRecord, fetchAuthMetadata, resolveJoinedAt, resolveLastActiveAt,
  summariseAiActivity, summariseDevices, profileView, AUTH_BATCH_SIZE, AUTH_ENRICH_CAP,
  type AuthMeta,
} from './adminUserActivity';

const authMeta = (over: Partial<AuthMeta> = {}): AuthMeta => ({
  uid: 'u1', joinedAtMs: null, lastSignInAtMs: null, lastRefreshAtMs: null,
  emailVerified: false, disabled: false, providers: [], phone: '', ...over,
});

describe('parseAuthUserRecord', () => {
  it('reads the three timestamps Firebase actually gives us', () => {
    const m = parseAuthUserRecord({
      uid: 'abc',
      metadata: {
        creationTime: 'Tue, 01 Jan 2026 00:00:00 GMT',
        lastSignInTime: 'Wed, 02 Jan 2026 00:00:00 GMT',
        lastRefreshTime: 'Thu, 03 Jan 2026 00:00:00 GMT',
      },
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });
    expect(m?.joinedAtMs).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(m?.lastSignInAtMs).toBe(Date.parse('2026-01-02T00:00:00Z'));
    expect(m?.lastRefreshAtMs).toBe(Date.parse('2026-01-03T00:00:00Z'));
    expect(m?.emailVerified).toBe(true);
    expect(m?.providers).toEqual(['google.com']);
  });

  it('an unparseable date is null, NOT now and NOT zero', () => {
    const m = parseAuthUserRecord({ uid: 'abc', metadata: { creationTime: 'not a date', lastSignInTime: '' } });
    expect(m?.joinedAtMs).toBeNull();
    expect(m?.lastSignInAtMs).toBeNull();
  });

  it('a record with no uid is nothing — never an entry keyed on an empty string', () => {
    expect(parseAuthUserRecord({ metadata: { creationTime: 'Tue, 01 Jan 2026 00:00:00 GMT' } })).toBeNull();
    expect(parseAuthUserRecord(null)).toBeNull();
  });
});

describe('fetchAuthMetadata', () => {
  it('batches at Firebase’s 100-identifier limit rather than one read per user', async () => {
    const seen: number[] = [];
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const map = await fetchAuthMetadata(uids, {
      getUsers: async (ids) => {
        seen.push(ids.length);
        return { users: ids.map((i) => ({ uid: i.uid, metadata: { creationTime: 'Tue, 01 Jan 2026 00:00:00 GMT' } })) };
      },
    });
    expect(seen).toEqual([AUTH_BATCH_SIZE, AUTH_BATCH_SIZE, 50]);
    expect(map.size).toBe(250);
  });

  it('one failing batch loses only that batch — the rest still resolve', async () => {
    const uids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    let call = 0;
    const map = await fetchAuthMetadata(uids, {
      getUsers: async (ids) => {
        if (call++ === 0) throw new Error('auth down');
        return { users: ids.map((i) => ({ uid: i.uid, metadata: { creationTime: 'Tue, 01 Jan 2026 00:00:00 GMT' } })) };
      },
    });
    expect(map.size).toBe(50);
    expect(map.has('u0')).toBe(false);   // the failed batch is absent — rendered "unread", never faked
    expect(map.has('u100')).toBe(true);
  });

  it('never throws, and no auth surface means an empty map rather than a broken list', async () => {
    await expect(fetchAuthMetadata(['a'], null)).resolves.toEqual(new Map());
    await expect(fetchAuthMetadata(['a'], { getUsers: async () => { throw new Error('x'); } })).resolves.toEqual(new Map());
  });

  it('is bounded — an unbounded user base cannot turn one refresh into unbounded auth calls', async () => {
    let asked = 0;
    const uids = Array.from({ length: AUTH_ENRICH_CAP + 200 }, (_, i) => `u${i}`);
    await fetchAuthMetadata(uids, { getUsers: async (ids) => { asked += ids.length; return { users: [] }; } });
    expect(asked).toBe(AUTH_ENRICH_CAP);
  });

  it('drops blanks and duplicates before spending a read on them', async () => {
    let asked = 0;
    await fetchAuthMetadata(['a', 'a', '', '  ', null, undefined, 'b'], {
      getUsers: async (ids) => { asked += ids.length; return { users: [] }; },
    });
    expect(asked).toBe(2);
  });
});

describe('resolveJoinedAt', () => {
  it('prefers Auth, because a wallet can be re-created and would make an old user look new', () => {
    const r = resolveJoinedAt(authMeta({ joinedAtMs: 1000 }), '2026-05-01T00:00:00.000Z');
    expect(r).toEqual({ atMs: 1000, source: 'auth' });
  });

  it('falls back to the wallet, LABELLED — a real approximate date beats an empty cell', () => {
    const r = resolveJoinedAt(null, '2026-05-01T00:00:00.000Z');
    expect(r.atMs).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
    expect(r.source).toBe('wallet');
  });

  it('unread is unread — never zero, never today', () => {
    expect(resolveJoinedAt(null, undefined)).toEqual({ atMs: null, source: 'unread' });
    expect(resolveJoinedAt(null, '')).toEqual({ atMs: null, source: 'unread' });
  });
});

describe('resolveLastActiveAt', () => {
  it('takes the MOST RECENT real moment, not a preferred source', () => {
    // The wallet moved after the last session refresh: the person really was here more recently.
    const r = resolveLastActiveAt(authMeta({ lastRefreshAtMs: 1000 }), { walletUpdatedAt: new Date(5000).toISOString() });
    expect(r).toEqual({ atMs: 5000, source: 'wallet' });
  });

  it('a session refresh beats an older sign-in — that is what "active" means', () => {
    const r = resolveLastActiveAt(authMeta({ lastSignInAtMs: 1000, lastRefreshAtMs: 9000 }));
    expect(r).toEqual({ atMs: 9000, source: 'auth' });
  });

  it('an AI request counts as being here', () => {
    const r = resolveLastActiveAt(null, { activityAtMs: 4242 });
    expect(r).toEqual({ atMs: 4242, source: 'activity' });
  });

  it('nothing readable is unread, NOT "never signed in"', () => {
    expect(resolveLastActiveAt(null, {})).toEqual({ atMs: null, source: 'unread' });
    expect(resolveLastActiveAt(authMeta(), { activityAtMs: 0 })).toEqual({ atMs: null, source: 'unread' });
  });
});

describe('summariseAiActivity', () => {
  const now = Date.parse('2026-09-11T00:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('counts requests, the busiest surface, and when they were last here', () => {
    const s = summariseAiActivity([
      { tier: 'free', createdAt: new Date(now - day).toISOString() },
      { tier: 'free', createdAt: new Date(now - 2 * day).toISOString() },
      { tier: 'pro', createdAt: new Date(now - 3 * day).toISOString() },
    ], now);
    expect(s.requests).toBe(3);
    expect(s.lastAtMs).toBe(now - day);
    expect(s.byTier[0]).toEqual({ tier: 'free', requests: 2 });
  });

  it('separates a currently-active user from a long-dormant one', () => {
    const s = summariseAiActivity([
      { tier: 'free', createdAt: new Date(now - 2 * day).toISOString() },
      { tier: 'free', createdAt: new Date(now - 200 * day).toISOString() },
    ], now);
    expect(s.requests).toBe(2);
    expect(s.last30Days).toBe(1);
  });

  it('a row with an unreadable date still counts as a request — dropping it would understate use', () => {
    const s = summariseAiActivity([{ tier: 'free', createdAt: 'rubbish' }], now);
    expect(s.requests).toBe(1);
    expect(s.lastAtMs).toBeNull();
  });

  it('no rows is an honest zero with no last-seen', () => {
    expect(summariseAiActivity([], now)).toEqual({ requests: 0, lastAtMs: null, last30Days: 0, byTier: [] });
  });
});

describe('summariseDevices', () => {
  it('counts fingerprints and distinct browsers, and the window they were seen in', () => {
    const s = summariseDevices([
      { uaHash: 'A', ipHash: '1', firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-02-01T00:00:00Z' },
      { uaHash: 'A', ipHash: '2', firstSeen: '2026-01-05T00:00:00Z', lastSeen: '2026-03-01T00:00:00Z' },
      { uaHash: 'B', ipHash: '3', firstSeen: '2025-12-01T00:00:00Z', lastSeen: '2026-01-02T00:00:00Z' },
    ]);
    expect(s.devices).toBe(3);
    expect(s.browsers).toBe(2);
    expect(s.firstSeenMs).toBe(Date.parse('2025-12-01T00:00:00Z'));
    expect(s.lastSeenMs).toBe(Date.parse('2026-03-01T00:00:00Z'));
  });

  it('🔒 returns no hash of any kind — a stored hash is a stable tracking key, and re-publishing it buys nothing', () => {
    const s = summariseDevices([{ uaHash: 'SECRET_UA', ipHash: 'SECRET_IP', firstSeen: '2026-01-01T00:00:00Z' }]);
    expect(JSON.stringify(s)).not.toContain('SECRET_UA');
    expect(JSON.stringify(s)).not.toContain('SECRET_IP');
  });
});

describe('profileView', () => {
  it('shows back exactly what the user themselves filled in', () => {
    const v = profileView({ displayName: ' Asha ', bio: 'Doctor', phone: '+91…', budgetLimitInr: 500, updatedAt: 1700 });
    expect(v).toEqual({ displayName: 'Asha', bio: 'Doctor', phone: '+91…', photoUrl: '', budgetLimitInr: 500, updatedAtMs: 1700 });
  });

  it('an empty profile row is NO profile — an empty card reads like a failed query', () => {
    expect(profileView({ displayName: '', bio: '', phone: '', photoUrl: '', budgetLimitInr: 0 })).toBeNull();
    expect(profileView(null)).toBeNull();
  });

  it('a nonsense budget is 0, never NaN on an admin screen', () => {
    expect(profileView({ bio: 'x', budgetLimitInr: 'lots' })?.budgetLimitInr).toBe(0);
    expect(profileView({ bio: 'x', budgetLimitInr: -5 })?.budgetLimitInr).toBe(0);
  });
});

describe('🔒 the content line — this module answers "how much and when", never "what did they say"', () => {
  // The published Privacy Policy (§3 "we do not read your projects out of curiosity"; §5 on the
  // clinical surface) is what makes this a hard line rather than a preference. A future edit that
  // starts carrying message text through here has to delete this test to do it.
  const source = readFileSync(join(__dirname, 'adminUserActivity.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n');

  for (const forbidden of ['message', 'transcript', 'prompt', 'chat_sessions', 'messages']) {
    it(`never reads a \`${forbidden}\` field`, () => {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    });
  }
});
