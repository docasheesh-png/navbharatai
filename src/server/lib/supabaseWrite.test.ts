import { describe, it, expect } from 'vitest';
import {
  sqlLiteral, primaryKeySql, whereFromKey, buildInsertSql, buildUpdateSql, buildDeleteSql,
  verifySingleRow,
} from './supabaseWrite';

describe('sqlLiteral — the only place a value becomes SQL text', () => {
  it('writes the ordinary types the way Postgres reads them', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(true)).toBe('true');
    expect(sqlLiteral(false)).toBe('false');
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(-1.5)).toBe('-1.5');
    expect(sqlLiteral(0)).toBe('0');
    expect(sqlLiteral(10n)).toBe('10');
    expect(sqlLiteral('hello')).toBe("'hello'");
    expect(sqlLiteral('')).toBe("''");
  });

  it('closes the quote-escape hole, including the doubled-up attempt', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral("'; drop table users; --")).toBe("'''; drop table users; --'");
    // A value that already contains doubled quotes must not come back out un-doubled.
    expect(sqlLiteral("a''b")).toBe("'a''''b'");
  });

  it('leaves a backslash alone — standard_conforming_strings means it is not an escape', () => {
    expect(sqlLiteral('C:\\temp')).toBe("'C:\\temp'");
    expect(sqlLiteral("\\'")).toBe("'\\'''");
  });

  it('writes objects and arrays as jsonb, not as [object Object]', () => {
    expect(sqlLiteral({ a: 1 })).toBe(`'{"a":1}'::jsonb`);
    expect(sqlLiteral([1, 2])).toBe(`'[1,2]'::jsonb`);
    // Quotes inside the JSON are escaped by the same rule as any other string.
    expect(sqlLiteral({ name: "O'Brien" })).toBe(`'{"name":"O''Brien"}'::jsonb`);
  });

  it('writes a Date as an ISO timestamp', () => {
    expect(sqlLiteral(new Date('2026-08-04T10:00:00.000Z'))).toBe("'2026-08-04T10:00:00.000Z'");
  });

  it('THROWS on anything it does not understand instead of guessing', () => {
    // Falling back to String(value) is exactly how a value stops being a value and becomes syntax;
    // and inventing NULL for undefined would silently write something the user did not ask for.
    expect(() => sqlLiteral(undefined)).toThrow();
    expect(() => sqlLiteral(NaN)).toThrow(/non-finite/);
    expect(() => sqlLiteral(Infinity)).toThrow(/non-finite/);
    expect(() => sqlLiteral(new Date('nonsense'))).toThrow(/invalid date/);
    expect(() => sqlLiteral(() => 1)).toThrow(/type function/);
    expect(() => sqlLiteral(Symbol('x'))).toThrow(/type symbol/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => sqlLiteral(cyclic)).toThrow();
  });
});

describe('whereFromKey — no WHERE, no write', () => {
  it('builds equality over every key column', () => {
    expect(whereFromKey({ id: 7 }, ['id'])).toBe('"id" = 7');
    expect(whereFromKey({ a: 1, b: 'x' }, ['a', 'b'])).toBe(`"a" = 1 and "b" = 'x'`);
  });

  it('REFUSES a table with no primary key', () => {
    // Not "handled carefully" — refused. Without a key there is no expression that provably
    // identifies one row, and an UPDATE matching four looks like one matching one until it is too late.
    expect(() => whereFromKey({ id: 1 }, [])).toThrow(/no primary key/);
    expect(() => whereFromKey({ id: 1 }, null as never)).toThrow(/no primary key/);
  });

  it('refuses a NULL key value — the write that succeeds and changes nothing', () => {
    // `col = NULL` is never true, so this would report success having touched zero rows.
    expect(() => whereFromKey({ id: null }, ['id'])).toThrow(/cannot be empty/);
    expect(() => whereFromKey({ id: undefined }, ['id'])).toThrow(/cannot be empty/);
  });

  it('refuses a key that is missing a column the table declares', () => {
    expect(() => whereFromKey({ a: 1 }, ['a', 'b'])).toThrow(/missing key column: b/);
  });

  it('refuses an injected key column outright', () => {
    expect(() => whereFromKey({ 'id"; drop table users; --': 1 }, ['id"; drop table users; --'])).toThrow();
  });
});

describe('buildInsertSql', () => {
  it('quotes every column and literalises every value', () => {
    expect(buildInsertSql({ table: 'users', values: { name: "O'Brien", age: 30 } }))
      .toBe(`insert into public."users" ("name", "age") values ('O''Brien', 30) returning *`);
  });

  it('always returns the row, so the caller can verify rather than assume', () => {
    expect(buildInsertSql({ table: 'users', values: { a: 1 } })).toContain('returning *');
  });

  it('refuses an unknown column instead of quietly dropping it', () => {
    // Dropping it would save "successfully" while leaving out the field the user actually typed.
    expect(() => buildInsertSql({ table: 'users', values: { nope: 1 }, columns: ['id', 'name'] }))
      .toThrow(/no such column: nope/);
  });

  it('refuses an empty payload and an injected column name', () => {
    expect(() => buildInsertSql({ table: 'users', values: {} })).toThrow(/nothing to save/);
    expect(() => buildInsertSql({ table: 'users', values: { 'a"; drop table x; --': 1 } })).toThrow();
    expect(() => buildInsertSql({ table: 'users; drop table users', values: { a: 1 } })).toThrow();
  });
});

describe('buildUpdateSql', () => {
  it('sets the values and scopes the change to one row', () => {
    expect(buildUpdateSql({ table: 'users', values: { name: 'A' }, key: { id: 3 }, pkColumns: ['id'] }))
      .toBe(`update public."users" set "name" = 'A' where "id" = 3 returning *`);
  });

  it('can never emit an unscoped UPDATE — the key is checked before any SET is built', () => {
    expect(() => buildUpdateSql({ table: 'users', values: { name: 'A' }, key: {}, pkColumns: [] }))
      .toThrow(/no primary key/);
    expect(() => buildUpdateSql({ table: 'users', values: { name: 'A' }, key: { id: null }, pkColumns: ['id'] }))
      .toThrow(/cannot be empty/);
  });

  it('setting a column to null is a real edit, not a refusal', () => {
    // Clearing a field is legitimate; only a null KEY is forbidden.
    expect(buildUpdateSql({ table: 'users', values: { note: null }, key: { id: 1 }, pkColumns: ['id'] }))
      .toContain('set "note" = NULL');
  });
});

describe('buildDeleteSql', () => {
  it('deletes exactly the keyed row', () => {
    expect(buildDeleteSql({ table: 'users', key: { id: 9 }, pkColumns: ['id'] }))
      .toBe(`delete from public."users" where "id" = 9 returning *`);
  });

  it('can never emit "delete from table" with no where clause', () => {
    expect(() => buildDeleteSql({ table: 'users', key: {}, pkColumns: [] })).toThrow(/no primary key/);
  });
});

describe('primaryKeySql', () => {
  it('asks the database which columns the key is, in key order', () => {
    const sql = primaryKeySql('users');
    expect(sql).toContain('i.indisprimary');
    expect(sql).toContain('array_position(i.indkey, a.attnum)');
    expect(sql).toContain(`'public."users"'::regclass`);
  });

  it('refuses an injected table name', () => {
    expect(() => primaryKeySql("users'; drop table users; --")).toThrow();
  });
});

describe('verifySingleRow — the write is checked, never assumed', () => {
  it('one row is the success case and hands the real row back', () => {
    expect(verifySingleRow([{ id: 1, name: 'A' }])).toEqual({ ok: true, row: { id: 1, name: 'A' } });
  });

  it('zero rows is told to the user, not reported as saved', () => {
    const r = verifySingleRow([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('no longer exists');
  });

  it('more than one row is a stop, not a success', () => {
    // It means our key resolution was wrong; saying "saved" would cover up a write that touched
    // rows nobody asked about.
    const r = verifySingleRow([{ id: 1 }, { id: 2 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('2 rows');
  });

  it('a non-array response is a failure, not an empty success', () => {
    expect(verifySingleRow(null as never).ok).toBe(false);
  });
});
