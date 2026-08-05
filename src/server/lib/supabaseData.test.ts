import { describe, it, expect } from 'vitest';
import {
  projectRefFromUrl, isSafeIdentifier, quoteIdent, boundedInt,
  listTablesSql, listColumnsSql, readRowsSql, runQuery, columnsOf,
  MAX_ROWS, DEFAULT_ROWS,
} from './supabaseData';

describe('projectRefFromUrl — the ref is recoverable from what we already stored', () => {
  it('reads the ref out of a Supabase project URL', () => {
    expect(projectRefFromUrl('https://abcdefghijkl.supabase.co')).toBe('abcdefghijkl');
    expect(projectRefFromUrl('https://abcdefghijkl.supabase.co/')).toBe('abcdefghijkl');
  });

  it('refuses anything that is not a Supabase project URL', () => {
    // A custom domain or a look-alike host must NOT become a project ref: that ref goes straight
    // into an API path, and guessing one would point our call at someone else's project.
    expect(projectRefFromUrl('https://db.myapp.com')).toBeNull();
    expect(projectRefFromUrl('https://evil.com/abcdefghijkl.supabase.co')).toBeNull();
    expect(projectRefFromUrl('http://abcdefghijkl.supabase.co')).toBeNull(); // http, not https
    expect(projectRefFromUrl('')).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe('identifier safety — everything that reaches a statement', () => {
  it('accepts the ordinary shape a generated schema produces', () => {
    expect(isSafeIdentifier('users')).toBe(true);
    expect(isSafeIdentifier('order_items')).toBe(true);
    expect(isSafeIdentifier('_private')).toBe(true);
  });

  it('rejects everything an injection needs', () => {
    expect(isSafeIdentifier('users; drop table users')).toBe(false);
    expect(isSafeIdentifier('users"')).toBe(false);
    expect(isSafeIdentifier("users'")).toBe(false);
    expect(isSafeIdentifier('users--')).toBe(false);
    expect(isSafeIdentifier('1users')).toBe(false);   // must not start with a digit
    expect(isSafeIdentifier('')).toBe(false);
    expect(isSafeIdentifier('a'.repeat(64))).toBe(false);
    expect(isSafeIdentifier(null)).toBe(false);
    expect(isSafeIdentifier({ toString: () => 'users' })).toBe(false);
  });

  it('quoteIdent THROWS on an unsafe name instead of emitting a best-effort string', () => {
    // A builder that half-escapes is exactly how injection reaches the wire — refusing is the point.
    expect(quoteIdent('users')).toBe('"users"');
    expect(() => quoteIdent('users"; drop table x; --')).toThrow(/unsafe identifier/);
  });
});

describe('boundedInt — a page size can never be NaN, negative, or unbounded', () => {
  it('clamps into range and falls back on junk', () => {
    expect(boundedInt(10, 50, 1, 200)).toBe(10);
    expect(boundedInt(9999, 50, 1, 200)).toBe(200);
    expect(boundedInt(-5, 50, 1, 200)).toBe(1);
    expect(boundedInt('abc', 50, 1, 200)).toBe(50);
    expect(boundedInt(undefined, 50, 1, 200)).toBe(50);
    // Infinity is nonsense input, not "the biggest page" — it falls back rather than silently
    // becoming the maximum, so a broken caller gets the default instead of the heaviest query.
    expect(boundedInt(Infinity, 50, 1, 200)).toBe(50);
    expect(boundedInt('20', 50, 1, 200)).toBe(20);
  });
});

describe('listTablesSql — the sidebar', () => {
  const sql = listTablesSql();

  it('shows only the user\'s own schema, not Supabase plumbing', () => {
    expect(sql).toContain("n.nspname = 'public'");
    expect(sql).not.toMatch(/nspname = 'auth'|nspname = 'storage'/);
  });

  it('uses the planner ESTIMATE, never count(*)', () => {
    // An exact count scans every table on every page load — a self-inflicted outage on a real DB.
    expect(sql).toContain('reltuples');
    expect(sql.toLowerCase()).not.toContain('count(*)');
  });
});

describe('readRowsSql — one page of a table', () => {
  it('quotes the table and bounds the page', () => {
    expect(readRowsSql({ table: 'users' })).toBe(
      `select * from public."users" limit ${DEFAULT_ROWS} offset 0`,
    );
  });

  it('caps the page size no matter what the caller asks for', () => {
    expect(readRowsSql({ table: 'users', limit: 100000 })).toContain(`limit ${MAX_ROWS}`);
    expect(readRowsSql({ table: 'users', limit: -1 })).toContain('limit 1');
  });

  it('orders by a real, quoted column', () => {
    expect(readRowsSql({ table: 'users', orderBy: 'created_at', desc: true }))
      .toContain('order by "created_at" desc');
  });

  it('refuses an injected table or order column outright', () => {
    expect(() => readRowsSql({ table: 'users; drop table users' })).toThrow();
    expect(() => readRowsSql({ table: 'users', orderBy: 'id; delete from users' })).toThrow();
  });

  it('never interpolates a raw number — an offset cannot smuggle SQL', () => {
    const sql = readRowsSql({ table: 'users', offset: '1; drop table users' as never });
    expect(sql).toContain('offset 0');
    expect(sql).not.toContain('drop');
  });
});

describe('listColumnsSql', () => {
  it('matches the table as a literal and validates it first', () => {
    expect(listColumnsSql('users')).toContain("table_name = 'users'");
    expect(() => listColumnsSql("users' or '1'='1")).toThrow();
  });
});

describe('runQuery — failures are classified, never leaked', () => {
  const ok = (body: unknown) => (async () => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;

  it('returns the rows on success', async () => {
    const r = await runQuery('tok', 'ref', 'select 1', ok([{ id: 1 }]));
    expect(r).toMatchObject({ ok: true, rows: [{ id: 1 }] });
  });

  it('a revoked grant tells the user to reconnect — and nothing else', async () => {
    const f = (async () => ({ ok: false, status: 401, text: async () => 'invalid token abc123' })) as unknown as typeof fetch;
    const r = await runQuery('tok', 'ref', 'select 1', f);
    expect(r).toMatchObject({ ok: false, failure: 'unauthorized' });
    if (!r.ok) {
      expect(r.message).toContain('connect again');
      // The provider's raw text must never reach the user.
      expect(r.message).not.toContain('abc123');
    }
  });

  it('a SQL error keeps the provider\'s text in admin detail, not in the message', async () => {
    const f = (async () => ({ ok: false, status: 400, text: async () => 'relation "typo" does not exist' })) as unknown as typeof fetch;
    const r = await runQuery('tok', 'ref', 'select * from typo', f);
    expect(r).toMatchObject({ ok: false, failure: 'api-error' });
    if (!r.ok) {
      expect(r.detail).toContain('relation "typo"');
      expect(r.message).not.toContain('relation');
    }
  });

  it('a response that is not an array is a failure, not an empty table', async () => {
    // Rendering "0 rows" for a shape we could not read would report a broken call as a working one.
    const r = await runQuery('tok', 'ref', 'select 1', ok({ unexpected: true }));
    expect(r).toMatchObject({ ok: false, failure: 'api-error' });
  });

  it('a network throw is a clean classified failure, never an exception into the route', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await runQuery('tok', 'ref', 'select 1', f)).toMatchObject({ ok: false, failure: 'api-error' });
  });

  it('refuses to call at all without a token or a project', async () => {
    let called = false;
    const spy = (async () => { called = true; return { ok: true, status: 200, json: async () => [] }; }) as unknown as typeof fetch;
    expect(await runQuery('', 'ref', 'select 1', spy)).toMatchObject({ failure: 'bad-request' });
    expect(await runQuery('tok', '', 'select 1', spy)).toMatchObject({ failure: 'bad-request' });
    expect(called).toBe(false);
  });
});

describe('columnsOf — the header must not depend on the first row', () => {
  it('unions the keys across the page', () => {
    // A column that is null in row 1 but present later would otherwise vanish from the table.
    expect(columnsOf([{ id: 1 }, { id: 2, email: 'a@b.c' }])).toEqual(['id', 'email']);
  });

  it('survives an empty page and junk rows', () => {
    expect(columnsOf([])).toEqual([]);
    expect(columnsOf([null as never, 'x' as never])).toEqual([]);
  });
});
