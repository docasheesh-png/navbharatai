// AgentV3 — sandbox PostgreSQL provisioning, verified with a REAL connection (admin task 1, 2026-08-05).
//
// THE FALSE SUCCESS THIS KILLS (Mitrify build d5f0a2bc). The provisioning script polled `pg_isready`
// and, when the poll never succeeded, quietly FELL BACK to the canonical URL — so `provisionBackend`
// returned a DATABASE_URL either way, and every caller printed success off the URL's mere existence:
// "PostgreSQL provisioned + DATABASE_URL written to .env", "Sandbox database provisioned in 21s",
// "✅ Local database ready". The app then connected to that URL and got ECONNREFUSED, its boot died
// half-way, and every page answered "Cannot GET /…" — while our own report swore the database was up.
// We claimed a success we never checked; the admin's instruction is exact: a real `SELECT 1` decides,
// nothing else.
//
// Two layers of truth here:
//   1. The in-sandbox script's FINAL gate is `psql "<the exact URL the app gets>" -Atc 'SELECT 1'` —
//      the same TCP path, the same auth, the same database the app will use. `pg_isready` stays as the
//      WAIT (it is the right tool for "is the server accepting yet"), but it no longer gets to declare
//      victory: it cannot see a missing database or a broken auth setup, and it is not what the app
//      experiences.
//   2. `parseDbProvision` hands callers `verified` (and the failure kind) as data, so "provisioned"
//      can only be SAID where it was PROVEN. The fallback URL is still returned — deliberately — so
//      .env points at the local server and a late-starting Postgres heals without a rewrite; what
//      changed is that the fallback can no longer masquerade as success.

/** The one URL the sandbox database lives at — the same string the app is handed. */
export const CANONICAL_DB_URL = 'postgresql://postgres@localhost:5432/myapp';

/**
 * The in-sandbox provisioning script.
 *
 * Emits exactly one of three markers, parsed by `parseDbProvision`:
 *   DB_URL:<url>       — the URL answered a real SELECT 1. The only success.
 *   DB_SELECT1_FAILED  — the server accepts connections, but the app's URL cannot run a query
 *                        (missing database / auth failure). pg_isready alone would have called
 *                        this "ready"; the app would have called it broken.
 *   DB_NOT_READY       — the server never accepted connections at all.
 */
export function dbProvisionScript(dbUrl: string = CANONICAL_DB_URL): string {
  return `if ! which psql > /dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>&1 | tail -2
  apt-get install -y -qq postgresql 2>&1 | tail -5
fi
PG_VER=$(ls /etc/postgresql/ 2>/dev/null | sort -V | tail -1)
pg_ctlcluster "$PG_VER" main start 2>&1 | tail -3 || true
for i in $(seq 1 20); do
  if pg_isready -h localhost -p 5432 -q 2>/dev/null; then break; fi
  pg_ctlcluster "$PG_VER" main start 2>/dev/null || true
  sleep 1
done
if pg_isready -h localhost -p 5432 -q 2>/dev/null; then
  su postgres -c "createdb myapp 2>/dev/null || true"
  if [ "$(psql "${dbUrl}" -Atc 'SELECT 1' 2>/dev/null)" = "1" ]; then
    echo "DB_URL:${dbUrl}"
  else
    echo "DB_SELECT1_FAILED"
  fi
else
  echo "DB_NOT_READY"
fi`;
}

export type DbProvisionFailure = 'not-ready' | 'select1-failed' | 'no-output';

export interface DbProvisionOutcome {
  /** The URL that PASSED SELECT 1, or null. Never a guess. */
  url: string | null;
  /** True only when a real query succeeded over the exact URL the app gets. */
  verified: boolean;
  failure: DbProvisionFailure | null;
}

/** Read the script's outcome. Anything unrecognisable (timeout, empty) is a failure, never a maybe. */
export function parseDbProvision(stdout: string | null | undefined): DbProvisionOutcome {
  const text = String(stdout ?? '');
  const match = text.match(/DB_URL:(postgresql:\/\/\S+)/);
  if (match) return { url: match[1], verified: true, failure: null };
  if (/DB_SELECT1_FAILED/.test(text)) return { url: null, verified: false, failure: 'select1-failed' };
  if (/DB_NOT_READY/.test(text)) return { url: null, verified: false, failure: 'not-ready' };
  return { url: null, verified: false, failure: 'no-output' };
}

/**
 * The honest one-line outcome, shared by every surface that used to hard-code the success string.
 *
 * One helper on purpose: the Mitrify report's lie was not one message but three call sites each
 * composing their own "provisioned" — a single source is what stops the next drift.
 */
export function provisionOutcomeNote(outcome: Pick<DbProvisionOutcome, 'verified' | 'failure'>): string {
  if (outcome.verified) {
    return '(PostgreSQL provisioned — connection verified with a real SELECT 1; DATABASE_URL written to .env).';
  }
  switch (outcome.failure) {
    case 'select1-failed':
      return '(PostgreSQL started but the real connection test FAILED — pg_isready passed yet SELECT 1 over the app\'s URL did not. DATABASE_URL written anyway for a late heal; the app will likely fail to connect).';
    case 'not-ready':
      return '(PostgreSQL did NOT come up — the server never accepted connections. DATABASE_URL written pointing at the local server for when it does; the app will fail to connect until then).';
    default:
      return '(PostgreSQL provisioning returned no result — DATABASE_URL written as a fallback; the app may fail to connect).';
  }
}
