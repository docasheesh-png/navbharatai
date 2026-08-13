// PHASE 2 slice 3 — a REAL Postgres for the preview, not a fake one.
//
// The dukaan stock app is the case this exists for: Express + Postgres for a login, a product list, a
// search box, a photo and a daily total. Slice 2 let its Express routes run in the browser; every one of
// them still died at the first query, so the whole app still needed a VM.
//
// WHAT THIS IS: `pg` (node-postgres) re-implemented over **PGlite** — Postgres itself, compiled to
// WebAssembly by ElectricSQL, Apache-2.0 licensed and therefore usable in a commercial product (unlike
// WebContainer, which this project deliberately does not license). It is not an emulation of SQL and
// not an in-memory imitation: joins, transactions, constraints, sequences, indexes and window functions
// all work because it IS Postgres. A query that would fail on a real server fails here too, with the
// same error — which is the point.
//
// ⚠️ VERIFIED, NOT ASSUMED. PGlite's response shape was read off a real run before this was written:
//     query(sql, params) → { rows, fields, affectedRows }
// and the tests execute the REAL PGlite rather than a stub, so the translation below is proved against
// the database it claims to speak to.
//
// PERSISTENCE. The preview iframe carries `allow-same-origin`, so IndexedDB is genuinely available and
// a table survives a reload — which is the difference between an app that looks like it saves data and
// one that does. The store is namespaced per workspace: two apps in one browser must never see each
// other's rows, and an app reopened weeks later must find its own.
//
// WHAT IS DELIBERATELY NOT SUPPORTED: Prisma, Drizzle, TypeORM, Sequelize and Knex. They generate SQL
// through their own engines and run migrations through their own CLIs, and half-supporting a migration
// tool produces a schema that is subtly not the user's. `proveBackendRunnable` refuses them, so those
// apps keep the sandbox where the real toolchain is.

/** The virtual module path the `pg` shim is mounted at inside the preview's file map. */
export const PG_SHIM_PATH = '__nbai/pg.js';

/** The PGlite version the preview loads. Pinned: an unpinned database is an unrepeatable preview. */
export const PGLITE_VERSION = '0.2.17';

/**
 * A stable, per-workspace IndexedDB name.
 *
 * Namespaced because the preview iframe shares NavBharatAI's origin: without it, two of the user's own
 * apps would open the SAME database and see each other's rows. Falls back to a memory-only database
 * when no key is available, which loses data on reload — worse, but honest, and it is stated in the
 * console rather than left for the user to discover.
 */
export function pgliteDataDir(workspaceId: string | null | undefined): string | null {
  const id = String(workspaceId ?? '').trim();
  if (!id) return null;
  return `idb://nbai-pg-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/**
 * The `pg`-compatible module, as JS source.
 *
 * Implements the surface generated servers actually use: `Pool`, `Client`, parameterised `query`,
 * `connect()` → a client with `release()`, `end()`, and the `on('error')` registration that pool code
 * routinely adds. Everything returns pg's own result shape (`rows` / `rowCount` / `fields`), because
 * handler code reads `result.rows` and `result.rowCount` directly.
 */
export function pgShimSource(pgliteUrl: string, dataDir: string | null): string {
  return String.raw`
'use strict';

var PGLITE_URL = ` + JSON.stringify(pgliteUrl) + String.raw`;
var DATA_DIR = ` + JSON.stringify(dataDir) + String.raw`;

var dbPromise = null;

/**
 * Open the database once, lazily.
 *
 * Lazy because PGlite is a multi-megabyte WebAssembly download: an app that never queries must never
 * pay for it. Once, because two PGlite instances over one IndexedDB store would be two writers on one
 * database.
 */
function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = import(PGLITE_URL).then(function (mod) {
    var PGlite = mod.PGlite || (mod.default && mod.default.PGlite) || mod.default;
    if (typeof PGlite !== 'function') throw new Error('the database engine could not be loaded');
    if (!DATA_DIR) {
      console.warn('[preview] this database is memory-only — data will not survive a reload');
      return new PGlite();
    }
    return new PGlite(DATA_DIR);
  });
  return dbPromise;
}

/**
 * Translate one PGlite result into the shape node-postgres returns.
 *
 * rowCount follows pg's own rule: the number of rows RETURNED for a select or a RETURNING clause, and
 * the number AFFECTED for a write that returns nothing. Getting this wrong is silent — a DELETE would
 * report 0 and the handler would tell the user nothing was deleted.
 */
function toPgResult(r, command) {
  var rows = (r && r.rows) || [];
  return {
    rows: rows,
    rowCount: rows.length > 0 ? rows.length : ((r && r.affectedRows) || 0),
    fields: ((r && r.fields) || []).map(function (f) { return { name: f.name, dataTypeID: f.dataTypeID }; }),
    command: command,
    oid: null,
  };
}

/** The leading SQL verb, which pg reports as result.command. */
function commandOf(sql) {
  var m = /^\s*(\w+)/.exec(String(sql || ''));
  return m ? m[1].toUpperCase() : '';
}

/**
 * Run one query. Accepts both call styles generated code uses:
 *   query('SELECT …', [a, b])          → promise
 *   query({ text: '…', values: [ ] })  → promise
 *   query('…', [ ], function (err, res) { }) → callback, the older pg style
 */
function runQuery(textOrConfig, valuesOrCb, maybeCb) {
  var text = textOrConfig, values = valuesOrCb, cb = maybeCb;
  if (textOrConfig && typeof textOrConfig === 'object') { text = textOrConfig.text; values = textOrConfig.values; cb = valuesOrCb; }
  if (typeof values === 'function') { cb = values; values = undefined; }
  var promise = getDb()
    .then(function (db) { return db.query(String(text), values || []); })
    .then(function (r) { return toPgResult(r, commandOf(text)); });
  if (typeof cb === 'function') {
    promise.then(function (res) { cb(null, res); }, function (err) { cb(err); });
    return undefined;
  }
  return promise;
}

function makeClient() {
  var client = {
    query: runQuery,
    // A pooled client is released, not closed — the underlying database stays open for the next one.
    release: function () {},
    end: function () { return Promise.resolve(); },
    connect: function (cb) {
      var p = getDb().then(function () { return client; });
      if (typeof cb === 'function') { p.then(function () { cb(null, client); }, function (e) { cb(e); }); return undefined; }
      return p;
    },
    on: function () { return client; },
    release_: undefined,
  };
  return client;
}

function Pool() {
  if (!(this instanceof Pool)) return new Pool();
  var self = this;
  self.query = runQuery;
  self.connect = function (cb) {
    var p = getDb().then(function () { return makeClient(); });
    if (typeof cb === 'function') { p.then(function (c) { cb(null, c, function () {}); }, function (e) { cb(e); }); return undefined; }
    return p;
  };
  // Pool code routinely does pool.on('error', …). Registering a listener that never fires is honest —
  // there is no socket to drop — while an undefined .on would crash the server on its first line.
  self.on = function () { return self; };
  self.end = function (cb) { if (typeof cb === 'function') { cb(); return undefined; } return Promise.resolve(); };
  self.totalCount = 0; self.idleCount = 0; self.waitingCount = 0;
}

function Client() {
  if (!(this instanceof Client)) return new Client();
  var c = makeClient();
  this.query = c.query; this.connect = c.connect; this.end = c.end; this.on = c.on;
  this.release = c.release;
}

var api = { Pool: Pool, Client: Client, types: { setTypeParser: function () {} }, escapeLiteral: function (s) { return "'" + String(s).replace(/'/g, "''") + "'"; } };
module.exports = api;
module.exports.default = api;
module.exports.__esModule = true;
`;
}
