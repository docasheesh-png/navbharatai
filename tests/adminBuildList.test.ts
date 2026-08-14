/**
 * An admin looking at 76 build reports must be able to see WHO, and narrow to the one that matters.
 *
 * ADMIN REPORT 2026-08-13: the list showed `user RyN1xjbfr6gmySF5E28apuC9ZJR2` — "kuch encrypted sa".
 * It is not encrypted; it is the Firebase UID. But that distinction helps nobody trying to work out
 * which user keeps hitting a failure, so an id that cannot be acted on is the same as no information.
 *
 * The two halves tested here pull against each other on purpose: names must be SHOWN wherever they
 * exist, and never INVENTED where they do not. A guessed name in an admin panel is worse than a raw
 * id, because the admin believes it.
 */

import { describe, it, expect } from 'vitest';
import {
  isAnonUid,
  shortUid,
  identityFrom,
  identityLabel,
  identityMatches,
  resolveUserIdentities,
  type UserIdentity,
} from '../src/server/lib/adminUserLookup';
import {
  parseStatusFilter,
  parseDateFilter,
  sinceMsFor,
  buildMatchesFilters,
  statusCounts,
  usersInBuilds,
  type FilterableBuild,
} from '../src/server/lib/buildListFilter';

const UID = 'RyN1xjbfr6gmySF5E28apuC9ZJR2';

describe('who is this user', () => {
  it('shows the name AND email when both are known — what an admin can act on', () => {
    const id = identityFrom(UID, { userName: 'Asheesh', userEmail: 'a@example.com' });
    expect(identityLabel(id)).toBe('Asheesh · a@example.com');
  });

  it('🔒 prefers the EMAIL when there is no name — it is the searchable, mailable thing', () => {
    expect(identityLabel(identityFrom(UID, { userEmail: 'a@example.com' }))).toBe('a@example.com');
  });

  it('🔒 NEVER invents a name — an unknown user falls back to a labelled id', () => {
    // "NavBharat User" here would make the admin believe they knew who it was.
    const label = identityLabel(identityFrom(UID, null));
    expect(label).toBe('id RyN1xjbf…');
    expect(label).not.toMatch(/navbharat user/i);
  });

  it('🔒 a signed-out build says so, rather than showing an id that belongs to nobody', () => {
    for (const anon of ['anon', 'anonymous', '', '   ', null, undefined]) {
      expect(isAnonUid(anon), String(anon)).toBe(true);
      expect(identityLabel(identityFrom(anon, null))).toBe('Signed-out user');
    }
    expect(isAnonUid(UID)).toBe(false);
  });

  it('the short id is a PREFIX, so it can be matched by eye against a full id elsewhere', () => {
    expect(shortUid(UID)).toBe('RyN1xjbf…');
    expect(UID.startsWith(shortUid(UID).replace('…', ''))).toBe(true);
    expect(shortUid('short')).toBe('short');
  });

  it('ignores blank name/email fields instead of printing empty separators', () => {
    expect(identityLabel(identityFrom(UID, { userName: '  ', userEmail: '  ' }))).toBe('id RyN1xjbf…');
  });
});

describe('🔒 searching by a person, not by a uid', () => {
  const id = identityFrom(UID, { userName: 'Asheesh Kumar', userEmail: 'doc@example.com' });

  it('matches on email, name and uid', () => {
    expect(identityMatches(id, 'doc@')).toBe(true);
    expect(identityMatches(id, 'asheesh')).toBe(true);
    expect(identityMatches(id, 'RyN1')).toBe(true);
    expect(identityMatches(id, 'nobody')).toBe(false);
  });

  it('an empty query matches everyone', () => {
    expect(identityMatches(id, '')).toBe(true);
    expect(identityMatches(id, '   ')).toBe(true);
  });

  it('signed-out builds are findable by the words an admin would type', () => {
    expect(identityMatches(identityFrom('anon', null), 'signed-out')).toBe(true);
  });
});

describe('resolveUserIdentities', () => {
  const fakeDb = (records: Record<string, { userName?: string; userEmail?: string }>) => ({
    collection: () => ({ doc: (id: string) => ({ id }) }),
    getAll: async (...refs: any[]) => refs.map((r) => ({
      id: r.id,
      exists: records[r.id] !== undefined,
      data: () => records[r.id],
    })),
  });

  it('resolves everyone in ONE round trip', async () => {
    let calls = 0;
    const db = fakeDb({ a: { userEmail: 'a@x.com' }, b: { userName: 'Bee' } });
    const counting = { ...db, getAll: async (...r: any[]) => { calls += 1; return db.getAll(...r); } };
    const out = await resolveUserIdentities(['a', 'b', 'a'], counting as never);
    expect(calls).toBe(1);            // not one read per row
    expect(out.get('a')!.email).toBe('a@x.com');
    expect(out.get('b')!.name).toBe('Bee');
  });

  it('🔒 never asks the database about signed-out builds', async () => {
    let asked: any[] = [];
    const db = fakeDb({});
    const spy = { ...db, getAll: async (...r: any[]) => { asked = r; return db.getAll(...r); } };
    await resolveUserIdentities(['anon', '', null, 'real'], spy as never);
    expect(asked.map((r) => r.id)).toEqual(['real']);
  });

  it('🔒 a lookup failure degrades to ids — it must never empty the build list', async () => {
    const broken = { collection: () => ({ doc: (id: string) => ({ id }) }), getAll: async () => { throw new Error('down'); } };
    const out = await resolveUserIdentities([UID], broken as never);
    expect(out.get(UID)!.email).toBe('');
    expect(identityLabel(out.get(UID)!)).toContain('id ');
  });

  it('no database at all is survivable', async () => {
    const out = await resolveUserIdentities([UID], null);
    expect(out.size).toBe(1);
  });
});

describe('filters', () => {
  const build = (over: Partial<FilterableBuild> = {}): FilterableBuild =>
    ({ workspaceId: 'w1', savedAt: 1_000_000, ownerUid: UID, ok: true, prompt: 'make a todo app', ...over });

  it('parses only the values it knows, defaulting to "all"', () => {
    expect(parseStatusFilter('failed')).toBe('failed');
    expect(parseStatusFilter('nonsense')).toBe('all');
    expect(parseDateFilter('7d')).toBe('7d');
    expect(parseDateFilter(42)).toBe('all');
  });

  it('🔒 "today" means the last 24 HOURS, not since midnight', () => {
    // An admin looking at 1 a.m. means "what just happened"; a midnight boundary would hide the
    // evening's failures at exactly the hour they are being investigated.
    const now = 1_000_000_000;
    expect(sinceMsFor('today', now)).toBe(now - 86_400_000);
    expect(sinceMsFor('7d', now)).toBe(now - 7 * 86_400_000);
    expect(sinceMsFor('all', now)).toBeNull();
  });

  it('status narrows to real failures and real successes', () => {
    expect(buildMatchesFilters(build({ ok: false }), { status: 'failed' })).toBe(true);
    expect(buildMatchesFilters(build({ ok: true }), { status: 'failed' })).toBe(false);
    expect(buildMatchesFilters(build({ ok: true }), { status: 'succeeded' })).toBe(true);
  });

  it('🔒 an UNKNOWN outcome is neither failed nor succeeded', () => {
    // A build cut off before it recorded an outcome is not a failure. Counting it as one would
    // inflate the failure list with rows nobody can act on.
    const unknown = build({ ok: undefined });
    expect(buildMatchesFilters(unknown, { status: 'failed' })).toBe(false);
    expect(buildMatchesFilters(unknown, { status: 'succeeded' })).toBe(false);
    expect(buildMatchesFilters(unknown, { status: 'all' })).toBe(true);
  });

  it('date drops anything older than the bound', () => {
    expect(buildMatchesFilters(build({ savedAt: 500 }), { sinceMs: 1000 })).toBe(false);
    expect(buildMatchesFilters(build({ savedAt: 5000 }), { sinceMs: 1000 })).toBe(true);
    expect(buildMatchesFilters(build({ savedAt: undefined }), { sinceMs: 1000 })).toBe(false);
  });

  it('user narrows to one account, case-insensitively', () => {
    expect(buildMatchesFilters(build(), { uid: UID })).toBe(true);
    expect(buildMatchesFilters(build(), { uid: UID.toLowerCase() })).toBe(true);
    expect(buildMatchesFilters(build(), { uid: 'someone-else' })).toBe(false);
  });

  it('🔒 search finds a build by its user’s NAME or EMAIL — the point of the whole change', () => {
    const identity: UserIdentity = identityFrom(UID, { userName: 'Asheesh', userEmail: 'doc@example.com' });
    expect(buildMatchesFilters(build(), { query: 'doc@example', identity })).toBe(true);
    expect(buildMatchesFilters(build(), { query: 'asheesh', identity })).toBe(true);
    // …and still finds it by the things it always could.
    expect(buildMatchesFilters(build(), { query: 'todo', identity })).toBe(true);
    expect(buildMatchesFilters(build(), { query: 'unrelated', identity })).toBe(false);
  });

  it('search works with no identity resolved', () => {
    expect(buildMatchesFilters(build(), { query: 'todo', identity: null })).toBe(true);
  });

  it('filters combine — every one must pass', () => {
    const b = build({ ok: false, savedAt: 5000 });
    expect(buildMatchesFilters(b, { status: 'failed', sinceMs: 1000, uid: UID, query: 'todo' })).toBe(true);
    expect(buildMatchesFilters(b, { status: 'failed', sinceMs: 9000 })).toBe(false);
  });
});

describe('the chips and the user picker', () => {
  const rows: FilterableBuild[] = [
    { workspaceId: 'a', ok: false, ownerUid: 'u1' },
    { workspaceId: 'b', ok: true, ownerUid: 'u1' },
    { workspaceId: 'c', ok: undefined, ownerUid: 'u2' },
  ];

  it('counts each outcome separately, unknowns included', () => {
    expect(statusCounts(rows)).toEqual({ all: 3, failed: 1, succeeded: 1, unknown: 1 });
  });

  it('🔒 lists users from the LOADED builds, busiest first — not the whole account table', () => {
    // A dropdown of every account that ever existed is unusable; the choice being made is among the
    // people who built recently.
    const ids = new Map([['u1', identityFrom('u1', { userEmail: 'one@x.com' })]]);
    const users = usersInBuilds(rows, ids);
    expect(users.map((u) => u.uid)).toEqual(['u1', 'u2']);
    expect(users[0].count).toBe(2);
    expect(users[0].identity!.email).toBe('one@x.com');
    expect(users[1].identity).toBeNull();   // unresolved, and honestly so
  });

  it('skips builds with no owner rather than inventing an empty entry', () => {
    expect(usersInBuilds([{ workspaceId: 'x', ownerUid: null }], new Map())).toEqual([]);
  });
});
