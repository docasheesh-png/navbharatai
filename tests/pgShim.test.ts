import { describe, it, expect } from 'vitest';
import { pgShimSource, pgliteDataDir, PG_SHIM_PATH, PGLITE_VERSION } from '../src/server/runtime/browserBackend/pgShim';

/**
 * PHASE 2 slice 3 — a REAL Postgres for the preview.
 *
 * ⚠️ THESE TESTS RUN THE REAL DATABASE. `@electric-sql/pglite` is Postgres compiled to WebAssembly, and
 * it runs in Node as well as in a browser — so the shim is proved against the engine it claims to speak
 * to, not against a stub that agrees with whatever I wrote.
 *
 * That distinction earns its keep: PGlite's result shape (`{ rows, fields, affectedRows }`) is NOT
 * node-postgres's (`{ rows, rowCount, fields }`), and `rowCount` in particular is silent when wrong — a
 * DELETE would report 0 and the handler would tell the user nothing was deleted. A stub written from
 * the same misunderstanding as the code would have agreed with it.
 */

/** Load the shipped shim source, with the real PGlite standing in for the browser's dynamic import. */
async function loadPg(dataDir: string | null = null): Promise<{
  Pool: new () => { query: (t: unknown, v?: unknown) => Promise<PgResult>; connect: () => Promise<PgClient>; end: () => Promise<void>; on: (e: string, f: unknown) => unknown };
  Client: new () => { query: (t: unknown, v?: unknown) => Promise<PgResult>; connect: () => Promise<unknown>; end: () => Promise<void> };
}> {
  const source = pgShimSource('@electric-sql/pglite', dataDir);
  const module = { exports: {} as Record<string, unknown> };
  // The shim reaches for the browser's dynamic import(). In Node the same specifier resolves to the
  // installed package, so the code under test is unmodified.
  const importer = (spec: string) => import(/* @vite-ignore */ spec);
  new Function('module', 'exports', 'console', '__nbaiImport', source.replace(/\bimport\(PGLITE_URL\)/, '__nbaiImport(PGLITE_URL)'))(
    module, module.exports, console, importer,
  );
  return module.exports as never;
}

interface PgResult { rows: Array<Record<string, unknown>>; rowCount: number; fields: Array<{ name: string }>; command: string }
interface PgClient { query: (t: unknown, v?: unknown) => Promise<PgResult>; release: () => void }

describe('it really is Postgres', () => {
  it('creates a table, inserts and reads back', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE items (id serial primary key, name text NOT NULL)');
    await pool.query('INSERT INTO items (name) VALUES ($1)', ['Doodh']);
    const r = await pool.query('SELECT * FROM items');
    expect(r.rows).toEqual([{ id: 1, name: 'Doodh' }]);
  });

  it('enforces a real constraint — a query that would fail on a server fails here too', async () => {
    /**
     * The single most valuable property. An imitation would happily accept this and the user would find
     * out in production; a real Postgres refuses it now, with the real error.
     */
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE users (id serial primary key, email text UNIQUE NOT NULL)');
    await pool.query('INSERT INTO users (email) VALUES ($1)', ['a@b.com']);
    await expect(pool.query('INSERT INTO users (email) VALUES ($1)', ['a@b.com'])).rejects.toThrow(/duplicate key/i);
    await expect(pool.query('INSERT INTO users (email) VALUES (NULL)')).rejects.toThrow(/null value/i);
  });

  it('does joins, aggregates and transactions — the things an imitation quietly gets wrong', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE p (id serial primary key, name text)');
    await pool.query('CREATE TABLE s (id serial primary key, p_id int REFERENCES p(id), qty int)');
    await pool.query("INSERT INTO p (name) VALUES ('Doodh'), ('Chawal')");
    await pool.query('INSERT INTO s (p_id, qty) VALUES (1, 5), (1, 3), (2, 7)');
    const r = await pool.query('SELECT p.name, SUM(s.qty)::int AS total FROM p JOIN s ON s.p_id = p.id GROUP BY p.name ORDER BY total DESC');
    expect(r.rows).toEqual([{ name: 'Chawal', total: 7 }, { name: 'Doodh', total: 8 }].sort((a, b) => b.total - a.total));
  });

  it('a ROLLBACK really rolls back', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO t VALUES (1)');
    await client.query('ROLLBACK');
    client.release();
    expect((await pool.query('SELECT * FROM t')).rows).toEqual([]);
  });
});

describe('the translation into node-postgres\'s shape', () => {
  it('rowCount counts RETURNED rows for a select', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    await pool.query('INSERT INTO t VALUES (1), (2), (3)');
    expect((await pool.query('SELECT * FROM t')).rowCount).toBe(3);
  });

  it('rowCount counts AFFECTED rows for a write that returns nothing', async () => {
    /**
     * The silent one. PGlite reports `affectedRows`; pg reports `rowCount`. Map it wrong and a DELETE
     * says 0, the handler says "nothing was deleted", and the row is gone anyway.
     */
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    await pool.query('INSERT INTO t VALUES (1), (2), (3)');
    expect((await pool.query('DELETE FROM t WHERE id > 1')).rowCount).toBe(2);
    expect((await pool.query('UPDATE t SET id = 9 WHERE id = 1')).rowCount).toBe(1);
  });

  it('an empty select is 0 rows, not a missing count', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    const r = await pool.query('SELECT * FROM t');
    expect(r.rows).toEqual([]);
    expect(r.rowCount).toBe(0);
  });

  it('exposes fields and the command verb, which handler code reads', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int, label text)');
    const r = await pool.query('SELECT id, label FROM t');
    expect(r.fields.map((f) => f.name)).toEqual(['id', 'label']);
    expect(r.command).toBe('SELECT');
  });

  it('parameters are BOUND, never interpolated — a quote in the data is just data', async () => {
    // The security property. If $1 were string-substituted, this input would end the statement.
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (name text)');
    await pool.query('INSERT INTO t (name) VALUES ($1)', ["'); DROP TABLE t; --"]);
    expect((await pool.query('SELECT * FROM t')).rows).toEqual([{ name: "'); DROP TABLE t; --" }]);
  });
});

describe('the call styles generated servers actually use', () => {
  it('accepts a config object', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    await pool.query({ text: 'INSERT INTO t VALUES ($1)', values: [7] });
    expect((await pool.query({ text: 'SELECT * FROM t' })).rows).toEqual([{ id: 7 }]);
  });

  it('accepts the older callback style', async () => {
    const { Pool } = await loadPg();
    const pool = new Pool() as unknown as { query: (t: string, v: unknown[], cb: (e: unknown, r: PgResult) => void) => void };
    await new Promise<void>((resolve, reject) => {
      (pool as unknown as { query: (t: string, cb: (e: unknown) => void) => void }).query('CREATE TABLE t (id int)', (err) => (err ? reject(err) : resolve()));
    });
    const rows = await new Promise<PgResult>((resolve, reject) => {
      pool.query('SELECT 1 AS one', [], (err, res) => (err ? reject(err) : resolve(res)));
    });
    expect(rows.rows).toEqual([{ one: 1 }]);
  });

  it('pool.on(\'error\') does not crash the server on its first line', async () => {
    // Pool code routinely registers this. An undefined `.on` would kill the module before any route
    // was defined — the app would look completely broken for a reason nobody could see.
    const { Pool } = await loadPg();
    const pool = new Pool();
    expect(() => pool.on('error', () => {})).not.toThrow();
    await expect(pool.end()).resolves.toBeUndefined();
  });

  it('new Client() works as well as new Pool()', async () => {
    const { Client } = await loadPg();
    const client = new Client();
    await client.connect();
    await client.query('CREATE TABLE t (id int)');
    expect((await client.query('SELECT 1 AS n')).rows).toEqual([{ n: 1 }]);
    await client.end();
  });

  it('a released pooled client keeps the database open for the next one', async () => {
    // A pooled client is RELEASED, not closed. Closing the database on release would break the very
    // next request — and the bug would look intermittent.
    const { Pool } = await loadPg();
    const pool = new Pool();
    await pool.query('CREATE TABLE t (id int)');
    const a = await pool.connect();
    await a.query('INSERT INTO t VALUES (1)');
    a.release();
    const b = await pool.connect();
    expect((await b.query('SELECT * FROM t')).rows).toEqual([{ id: 1 }]);
    b.release();
  });
});

describe('the persistence namespace', () => {
  it('two workspaces get different databases', () => {
    // The preview iframe shares NavBharatAI's origin, so without this two of the user's own apps would
    // open the SAME IndexedDB store and see each other's rows.
    expect(pgliteDataDir('agentv3-alice-s1')).not.toBe(pgliteDataDir('agentv3-alice-s2'));
    expect(pgliteDataDir('agentv3-alice-s1')).toMatch(/^idb:\/\/nbai-pg-/);
  });

  it('the same workspace gets the same database every time', () => {
    // Otherwise an app reopened tomorrow would find an empty database and look like it lost the data.
    expect(pgliteDataDir('agentv3-alice-s1')).toBe(pgliteDataDir('agentv3-alice-s1'));
  });

  it('no workspace id means memory-only — stated, not silently assumed', () => {
    for (const id of ['', null, undefined, '   ']) expect(pgliteDataDir(id as never)).toBeNull();
    expect(pgShimSource('x', null)).toContain('memory-only');
  });

  it('the version is pinned — an unpinned database is an unrepeatable preview', () => {
    expect(PGLITE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PG_SHIM_PATH).toBe('__nbai/pg.js');
  });
});
