import { describe, it, expect } from 'vitest';
import {
  splitStatements, isOnlyComments, readOnlyQuery, writeQuery, describeStatement, QUERY_ROW_CAP,
} from './sqlSafety';

describe('splitStatements — every bypass lives where a naive split on ";" gets it wrong', () => {
  it('splits ordinary statements', () => {
    expect(splitStatements('select 1; select 2')).toEqual(['select 1', 'select 2']);
  });

  it('a trailing semicolon is punctuation, not an empty second statement', () => {
    expect(splitStatements('select 1;')).toEqual(['select 1']);
    expect(splitStatements('select 1;  \n  ')).toEqual(['select 1']);
  });

  it('does not split inside a string literal', () => {
    expect(splitStatements(`select 'a;b'`)).toEqual([`select 'a;b'`]);
    // A doubled quote is an escaped quote — the string has not ended.
    expect(splitStatements(`select 'it''s; fine'`)).toEqual([`select 'it''s; fine'`]);
  });

  it('does not split inside a quoted identifier', () => {
    expect(splitStatements('select "od;d"')).toEqual(['select "od;d"']);
    expect(splitStatements('select "a""b;c"')).toEqual(['select "a""b;c"']);
  });

  it('does not split inside either comment form', () => {
    expect(splitStatements('select 1 -- ; not a statement\n')).toHaveLength(1);
    expect(splitStatements('select 1 /* ; still one */')).toHaveLength(1);
  });

  it('handles NESTED block comments, which Postgres allows', () => {
    // A non-nesting scanner would end the comment at the inner close and then see a real `;`.
    expect(splitStatements('select 1 /* a /* b */ ; c */')).toHaveLength(1);
  });

  it('does not split inside a dollar-quoted body', () => {
    expect(splitStatements('select $$ a; b $$')).toHaveLength(1);
    expect(splitStatements('select $tag$ a; b $tag$')).toHaveLength(1);
  });

  it('drops fragments that are only comments', () => {
    expect(splitStatements('select 1; -- trailing note')).toEqual(['select 1']);
    expect(splitStatements('/* nothing */')).toEqual([]);
    expect(splitStatements('')).toEqual([]);
  });

  it('an unterminated string does not run past the end or throw', () => {
    expect(() => splitStatements(`select 'oops`)).not.toThrow();
    expect(splitStatements(`select 'oops; delete from t`)).toHaveLength(1);
  });
});

describe('isOnlyComments', () => {
  it('recognises fragments with nothing to run', () => {
    expect(isOnlyComments('  -- hi ')).toBe(true);
    expect(isOnlyComments('/* x */')).toBe(true);
    expect(isOnlyComments('   ')).toBe(true);
    expect(isOnlyComments('select 1')).toBe(false);
  });
});

describe('readOnlyQuery — Postgres enforces it, not a keyword scanner', () => {
  it('wraps the statement as a subquery with a row cap', () => {
    const r = readOnlyQuery('select * from users');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sql).toContain('select * from (');
      expect(r.sql).toContain('as nbai_q limit');
      expect(r.sql).toContain(String(QUERY_ROW_CAP));
    }
  });

  it('the wrapper is what stops the data-modifying CTE a keyword check waves through', () => {
    // `WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone` begins with WITH and empties
    // a table. Wrapped, Postgres raises "WITH clause containing a data-modifying statement must be at
    // the top level" — so the query is refused by the database, not by us guessing at its meaning.
    const r = readOnlyQuery('WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sql.startsWith('select * from (')).toBe(true);
      expect(r.sql.trimEnd().endsWith(`as nbai_q limit ${QUERY_ROW_CAP}`)).toBe(true);
    }
  });

  it('refuses more than one statement, so nothing rides along behind a SELECT', () => {
    const r = readOnlyQuery('select 1; delete from users');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('one statement at a time');
  });

  it('is not fooled by a separator hidden in a string or a comment', () => {
    expect(readOnlyQuery(`select 'a;b' from t`).ok).toBe(true);
    expect(readOnlyQuery('select 1 -- ; delete from t\n').ok).toBe(true);
  });

  it('refuses an empty query rather than running the wrapper on nothing', () => {
    expect(readOnlyQuery('').ok).toBe(false);
    expect(readOnlyQuery('   -- just a note').ok).toBe(false);
  });

  it('takes a smaller cap when the caller asks, and never a nonsense one', () => {
    const r = readOnlyQuery('select 1', 10);
    if (r.ok) expect(r.sql).toContain('limit 10');
    const z = readOnlyQuery('select 1', 0);
    if (z.ok) expect(z.sql).toContain('limit 1');
  });
});

describe('writeQuery — one statement, exactly the one that was confirmed', () => {
  it('passes a single statement through unwrapped — an UPDATE is not a subquery', () => {
    const r = writeQuery('update users set name = \'A\' where id = 1');
    expect(r).toMatchObject({ ok: true, sql: "update users set name = 'A' where id = 1" });
  });

  it('refuses a second statement the user never saw before confirming', () => {
    const r = writeQuery('update users set a = 1 where id = 2; drop table users');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('never shown to you');
  });

  it('strips a trailing semicolon rather than calling it a second statement', () => {
    expect(writeQuery('delete from t where id = 1;')).toMatchObject({ ok: true, sql: 'delete from t where id = 1' });
  });
});

describe('describeStatement — wording for a prompt, never a security control', () => {
  it('names the common verbs in plain words', () => {
    expect(describeStatement('DELETE FROM users')).toBe('delete rows from');
    expect(describeStatement('insert into t values (1)')).toBe('add rows to');
    expect(describeStatement('  UPDATE t SET a=1')).toBe('change rows in');
    expect(describeStatement('drop table t')).toBe('permanently remove part of');
    expect(describeStatement('truncate t')).toBe('empty a table in');
    expect(describeStatement('alter table t add column c int')).toBe('change the structure of');
  });

  it('sees past a leading comment', () => {
    expect(describeStatement('-- clean up\ndelete from t')).toBe('delete rows from');
  });

  it('falls back to a neutral word rather than claiming to know', () => {
    expect(describeStatement('grant select on t to r')).toBe('change');
    expect(describeStatement('')).toBe('change');
  });
});
