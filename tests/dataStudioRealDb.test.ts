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

describe('read-only in 2.1 — no half-built write controls', () => {
  it('ships no edit / delete / add-row affordance', () => {
    // A button that looks like it saves and does not is the half-done feature the constitution
    // forbids. Writes arrive in 2.2, with confirmation, or not at all.
    expect(studio).not.toContain('Add Row');
    expect(studio).not.toContain('saveEdit');
    expect(studio).not.toContain('deleteRow');
  });

  it('the server exposes only reads for the data GUI', () => {
    expect(route).toContain("app.get('/api/integrations/supabase/tables'");
    expect(route).toContain("app.get('/api/integrations/supabase/rows'");
    expect(route).toContain("app.get('/api/integrations/supabase/columns'");
    expect(route).not.toMatch(/app\.(post|delete|put|patch)\('\/api\/integrations\/supabase\/rows'/);
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
    expect(route).toContain('async function freshAccessToken');
    expect(route.match(/freshAccessToken\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // Exactly one place still calls the raw refresh.
    expect(route.match(/await refreshAccessToken\(/g)?.length ?? 0).toBe(1);
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
