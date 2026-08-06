import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Database Studio shows the USER's database (ROADMAP #1 Phase 2.1).
 *
 * The path this closes was not merely useless, it was wrong: typing a collection name pointed the
 * studio at NavBharatAI's OWN Firestore, via the platform's client SDK, straight from the browser.
 * That store must never back a user's app (standing constraint), and a signed-in user could page
 * through the platform collections Firestore rules leave readable. These assertions exist so the
 * path cannot come back by accident.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const studio = read('src/components/ide/DatabaseStudio.tsx');
const route = read('src/server/routes/supabaseIntegration.ts');
const data = read('src/server/lib/supabaseData.ts');

describe('the studio no longer browses NavBharatAI\'s own database', () => {
  it('does not import the platform Firestore client at all', () => {
    expect(studio).not.toContain("from '../../App'");
    expect(studio).not.toContain("from 'firebase/firestore'");
  });

  it('no Firestore read or write call survives', () => {
    for (const call of ['getDocs(', 'setDoc(', 'deleteDoc(', 'addDoc(', 'collection(db']) {
      expect(studio).not.toContain(call);
    }
  });

  it('reads the user\'s own database through the server, which holds the token', () => {
    expect(studio).toContain('/api/integrations/supabase/tables');
    expect(studio).toContain('/api/integrations/supabase/rows');
  });
});

describe('sample rows are labelled, and never pretend to be live', () => {
  it('uses the tested state helper rather than an ad-hoc flag', () => {
    expect(studio).toContain("from '../../lib/dataStudioSource'");
    expect(studio).toContain('studioState({ connected, hasDatabase })');
  });

  it('connected alone does not count as having a database', () => {
    // A user can link Supabase and never create a project; calling that "your database" would be
    // exactly the nearly-true claim this phase exists to remove.
    expect(studio).toContain('setHasDatabase(true)');
    expect(studio).toContain('setHasDatabase(false)');
  });
});

/**
 * Editing (Phase 2.2). Reading a table wrong shows the wrong screen; writing one wrong destroys data,
 * with no undo. These lock the two structural guarantees rather than trusting a call site.
 */
describe('writes exist, and they are narrow on purpose', () => {
  const write = read('src/server/lib/supabaseWrite.ts');

  it('the three write routes are there', () => {
    expect(route).toContain("app.post('/api/integrations/supabase/row'");
    expect(route).toContain("app.patch('/api/integrations/supabase/row'");
    expect(route).toContain("app.delete('/api/integrations/supabase/row'");
  });

  it('a table with NO primary key is refused, with a reason the user can act on', () => {
    // Not "handled carefully" — refused. Without a key nothing provably identifies a single row.
    expect(route).toContain("failure: 'no-primary-key'");
    expect(route).toContain('has no primary key');
    expect(write).toContain("throw new Error('this table has no primary key')");
  });

  it('the key comes from the DATABASE catalogue, never inferred from a column name', () => {
    expect(route).toContain('async function primaryKeyOf');
    expect(route).toContain('primaryKeySql(table)');
    expect(write).toContain('i.indisprimary');
  });

  it('every UPDATE and DELETE is built through whereFromKey, so neither can be unscoped', () => {
    const upd = write.slice(write.indexOf('export function buildUpdateSql'), write.indexOf('export function buildDeleteSql'));
    expect(upd).toContain('whereFromKey(opts.key, opts.pkColumns)');
    const del = write.slice(write.indexOf('export function buildDeleteSql'));
    expect(del).toContain('whereFromKey(opts.key, opts.pkColumns)');
  });

  it('the value encoder throws rather than falling back to String(value)', () => {
    // A stringified surprise is how a value stops being a value and becomes syntax.
    expect(write).toContain('throw new Error(`cannot store a value of type ${typeof value}`)');
    expect(write).not.toMatch(/return String\(value\);\s*\/\/ fallback/);
  });

  it('every write is VERIFIED to have hit exactly one row before it is called saved', () => {
    expect(route).toContain('verifySingleRow(result.rows)');
    expect(write).toContain('export function verifySingleRow');
  });

  it('the UI only offers editing when a key exists, and says why when it does not', () => {
    expect(studio).toContain('const editable = live && primaryKey.length > 0');
    expect(studio).toContain('has no primary key');
    expect(studio).toContain('/api/integrations/supabase/primary-key');
  });

  it('deleting asks first — it is the one action with no undo', () => {
    expect(studio).toContain('window.confirm');
    expect(studio).toContain('This cannot be undone');
  });

  it('the saved row is re-read from the server, not patched locally', () => {
    // A database applies defaults, triggers and coercion; showing our guess would be a quiet lie.
    expect(studio).toContain('await loadRows(selected, offset)');
  });
});

describe('the data routes cannot be aimed at someone else\'s data', () => {
  it('resolve ownership from the VERIFIED token, never a request field', () => {
    const at = route.indexOf('async function resolveDataAccess');
    expect(at).toBeGreaterThan(-1);
    const fn = route.slice(at, at + 1500);
    expect(fn).toContain('verifyFirebaseToken(req)');
    // The project is derived from the caller's own stored URL — never taken from the query.
    expect(fn).toContain('projectRefFromUrl(secrets.VITE_SUPABASE_URL)');
    expect(fn).not.toMatch(/req\.query\.projectRef|body\.projectRef/);
  });

  it('validate the table name before any query is built', () => {
    expect(route).toContain('isSafeIdentifier(table)');
  });

  it('never hand a provider\'s raw error to the user', () => {
    // The message the user reads is ours; the provider's text goes to the server log only.
    const at = route.indexOf('function sendDataError');
    expect(at).toBeGreaterThan(-1);
    const fn = route.slice(at, at + 500);
    expect(fn).toContain('console.error');
    expect(fn).toContain('err.message');
  });
});

describe('one token-refresh implementation, not two', () => {
  it('provisioning and the data reads share freshAccessToken', () => {
    // The dangerous half is rotation persistence: Supabase may return a NEW refresh token, and a
    // copy that forgets to store it breaks the connection an hour later, somewhere else entirely.
    // The implementation MOVED to supabaseProvisionFlow (2026-08-06) so a running BUILD can create a
    // database too, not just a request handler. The invariant this test exists for is unchanged and is
    // now checked at its new home: one implementation, one caller of the raw refresh.
    const flow = read('src/server/lib/supabaseProvisionFlow.ts');
    expect(flow).toContain('export async function freshAccessToken');
    expect(route).toContain("freshAccessToken } from '../lib/supabaseProvisionFlow'");
    expect(route).not.toContain('async function freshAccessToken(');
    // Exactly one place still calls the raw refresh, and it is that shared implementation.
    expect(flow.match(/await refreshAccessToken\(/g)?.length ?? 0).toBe(1);
    expect(route.match(/await refreshAccessToken\(/g)?.length ?? 0).toBe(0);
  });
});

describe('the SQL builders are the only way a name reaches a statement', () => {
  it('row reads quote the identifier and bound the page', () => {
    expect(data).toContain('const table = quoteIdent(opts.table)');
    expect(data).toContain('boundedInt(opts.limit');
  });

  it('the table listing stays out of Supabase\'s internal schemas', () => {
    expect(data).toContain("n.nspname = 'public'");
  });
});

describe('KB — the studio\'s entry tells the truth about what it shows', () => {
  it('describes the user\'s own database, not demo or platform data', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'database_studio');
    expect(e).toBeTruthy();
    expect(e!.description.toLowerCase()).toContain('your own database');
    expect(e!.keywords).toContain('database studio');
  });
});

/**
 * The query runner (Phase 2.4). A SQL box is the feature most likely to become an accidental
 * "delete everything" button, so read-only is enforced by Postgres, not by reading the text.
 */
describe('running your own SQL — read-only by construction', () => {
  const safety = read('src/server/lib/sqlSafety.ts');

  it('read-only is the DEFAULT: a write needs the caller to say so explicitly', () => {
    expect(route).toContain('const wantsWrite = req.body?.allowWrite === true');
    expect(route).toContain('wantsWrite ? writeQuery(sql) : readOnlyQuery(sql)');
  });

  it('the read path is WRAPPED, so the database refuses a write we never had to recognise', () => {
    // A keyword check waves `WITH gone AS (DELETE ... RETURNING *) SELECT * FROM gone` straight
    // through. Wrapped as a subquery, Postgres rejects it outright.
    expect(safety).toContain('select * from (');
    expect(safety).toContain('as nbai_q limit');
  });

  it('only ever one statement, on both paths', () => {
    expect(safety.match(/statements\.length > 1/g)?.length ?? 0).toBe(2);
  });

  it('the splitter is a tokenizer, not a split on ";"', () => {
    // Every interesting bypass lives exactly where a naive split gets it wrong.
    for (const marker of ["ch === \"'\"", "ch === '\"'", "ch === '$'", "ch === '-' && next === '-'", "ch === '/' && next === '*'"]) {
      expect(safety).toContain(marker);
    }
    expect(safety).not.toMatch(/sql\.split\(';'\)/);
  });

  it('the verb description is presentation, and says so — never a security control', () => {
    expect(safety).toContain('NEVER a security control');
  });

  it('the UI asks before a write and does not keep a sticky toggle', () => {
    // A toggle left on from ten minutes ago is how a read becomes a write nobody meant to run.
    expect(studio).toContain('void runSql(false)');
    expect(studio).toContain('void runSql(true)');
    expect(studio).toContain('cannot be undone. Run it anyway?');
  });

  it('a capped result says there may be more, instead of implying that was everything', () => {
    expect(route).toContain('capped: !wantsWrite && result.rows.length >= QUERY_ROW_CAP');
    expect(studio).toContain('there may be more');
  });
});

describe('the Schema view is complete (Phase 2.3)', () => {
  it('serves relations and indexes', () => {
    expect(route).toContain("app.get('/api/integrations/supabase/relations'");
    expect(route).toContain('listForeignKeysSql(table)');
    expect(route).toContain('listIndexesSql(table)');
  });

  it('indexes are additive — losing them does not cost the user the relations', () => {
    expect(route).toContain('indexes: indexes.ok ?');
  });

  it('a relation is clickable, because "what does this point at" ends in opening that table', () => {
    expect(studio).toContain("setSelected(fk.referencesTable)");
  });
});

/**
 * CSV (Phase 2.5). A data importer that guesses wrong corrupts a database quietly, so the two things
 * locked here are the honest reporting of a partial import and the null/empty-string distinction.
 */
describe('CSV import and export', () => {
  const csv = read('src/lib/csv.ts');

  it('exports through the tested writer, never a hand-rolled join', () => {
    expect(route).toContain("app.get('/api/integrations/supabase/export'");
    expect(route).toContain('toCsv(rows, columns)');
  });

  it('knows there is more by ASKING for one extra row, rather than guessing', () => {
    expect(route).toContain('limit ${limit + 1}');
    expect(route).toContain("X-Nbai-Truncated");
  });

  it('keeps the exported file clean CSV — the warning is a header, not a comment inside it', () => {
    // A warning line inside the file would corrupt the data for every other tool that opens it.
    expect(route).toContain('res.setHeader');
    expect(route).not.toMatch(/# (warning|truncated)/i);
  });

  it('a PARTIAL import is reported with the real number, not called a failure', () => {
    // Rows go in atomic batches, so a failure can leave earlier ones applied. "Import failed" would
    // send the user to re-run the file and duplicate everything that did land.
    expect(route).toContain('imported,');
    expect(route).toContain('total: incoming.length');
    expect(studio).toContain('Imported ${imported} of ${total} rows.');
  });

  it('unknown columns are named back to the user, never silently dropped', () => {
    expect(route).toContain('unknownColumns: unknown');
    expect(route).toContain('matchColumns(headers, tableColumns)');
    expect(studio).toContain('the table does not have');
  });

  it('the file is parsed in the BROWSER first, so nothing reaches the database unseen', () => {
    expect(studio).toContain('parseCsv(text)');
    expect(studio).toContain('setImportPreview');
  });

  it('a missing value and an empty string stay different all the way through', () => {
    // Guessing here is what corrupts data: a,,c is missing; a,"",c is an empty string.
    expect(csv).toContain('An empty cell can honestly mean two different things');
    expect(csv).toContain("if (value === null || value === undefined) return '';");
  });

  it('import is only offered where a write is allowed at all', () => {
    const at = studio.indexOf('Import CSV');
    expect(at).toBeGreaterThan(-1);
    expect(studio.slice(Math.max(0, at - 400), at)).toContain('editable &&');
  });
});