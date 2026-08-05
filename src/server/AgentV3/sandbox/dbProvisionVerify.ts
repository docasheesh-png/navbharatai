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
  return `# ROOT IS NOT AVAILABLE HERE — and every command this script used to rely on needs it.
#
# The sandbox runs as \`user\` (the build's own \`ls -la\` shows /home/user/workspace owned by
# "user user"), while \`apt-get install\`, \`pg_ctlcluster … start\` and \`su postgres -c …\` are all
# root-only. That explains the reported failure exactly: psql IS present in the template, so no
# install was attempted; pg_ctlcluster then failed INSTANTLY with a privileges error that the old
# script discarded; the 20×1s retry repeated the same failure; total ≈21s, reported as "the server
# never accepted connections". The database was never going to start, on any build, ever.
#
# So Postgres now runs AS US: initdb into a directory we own, started with pg_ctl. No root, no
# Debian cluster wrapper, no /etc/postgresql, no su. The privileged path is still tried FIRST — it is
# faster when it works (a template that pre-creates the cluster) — and this is the fallback that
# makes the difference between a preview that works and one that cannot.
if ! which psql > /dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>&1 | tail -2
  apt-get install -y -qq postgresql 2>&1 | tail -5
fi
PG_VER=$(ls /etc/postgresql/ 2>/dev/null | sort -V | tail -1)
# WHY IT FAILED, not just THAT it failed (report 15985d3b, 2026-08-05). That build said "the server
# never accepted connections" after 21s and stopped there — every reason was thrown away:
# pg_ctlcluster's error went to \`| tail -3 || true\`, the retry loop sent its own to /dev/null, and
# nobody recorded whether psql was even installed or whether PG_VER resolved at all. So we could tell
# the user the truth and still not know what to fix. These markers cost nothing and turn the next
# report into evidence — the same measure-first move that already exonerated the integrity pass.
echo "DB_DIAG_PSQL:$(which psql 2>/dev/null || echo none)"
echo "DB_DIAG_PGVER:\${PG_VER:-none}"
echo "DB_DIAG_WHOAMI:$(id -un 2>/dev/null || echo unknown)"
# PATH 1 — the privileged cluster, tried first because it is instant when the template allows it.
START_ERR=$(pg_ctlcluster "$PG_VER" main start 2>&1 | tail -3)
echo "DB_DIAG_START:\${START_ERR:-ok}"
for i in $(seq 1 8); do
  if pg_isready -h localhost -p 5432 -q 2>/dev/null; then break; fi
  sleep 1
done

# PATH 2 — OUR OWN INSTANCE, as the current user. This is the one that actually works here.
# initdb creates a data directory we own; pg_ctl starts a server with no root, no cluster wrapper and
# no /etc/postgresql. \`--auth=trust\` is correct for a throwaway preview database that only listens on
# loopback inside a single-tenant sandbox, and it is what lets the app's own URL connect with no
# password. Idempotent: an already-initialised directory is reused, and an already-running server
# makes pg_ctl a no-op, so a re-provision (the keepalive path) costs nothing.
if ! pg_isready -h localhost -p 5432 -q 2>/dev/null; then
  PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  echo "DB_DIAG_PGBIN:\${PGBIN:-none}"
  if [ -n "$PGBIN" ]; then
    export PGDATA="\${HOME:-/tmp}/.nbai-pgdata"
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      INITDB_ERR=$("$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 2>&1 | tail -3)
      echo "DB_DIAG_INITDB:\${INITDB_ERR:-ok}"
    fi
    # -k /tmp puts the unix socket somewhere writable; -h 127.0.0.1 keeps it on loopback only.
    PGCTL_ERR=$("$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5432 -h 127.0.0.1 -k /tmp" -l "$PGDATA/server.log" -w -t 25 start 2>&1 | tail -3)
    echo "DB_DIAG_PGCTL:\${PGCTL_ERR:-ok}"
    for i in $(seq 1 15); do
      if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then break; fi
      sleep 1
    done
    # The server's own log is the only place a refused start explains itself.
    if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
      echo "DB_DIAG_PGLOG:$(tail -3 "$PGDATA/server.log" 2>/dev/null | tr '\\n' ' ')"
    fi
  fi
fi

if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null || pg_isready -h localhost -p 5432 -q 2>/dev/null; then
  # Over TCP as postgres — no \`su\`, which was itself a root-only command.
  createdb -h 127.0.0.1 -p 5432 -U postgres myapp 2>/dev/null || true
  SELECT1=$(psql "${dbUrl}" -Atc 'SELECT 1' 2>&1)
  if [ "$SELECT1" = "1" ]; then
    echo "DB_URL:${dbUrl}"
  else
    # The psql error itself — a missing database and a refused password need different fixes, and
    # "SELECT 1 failed" alone cannot tell them apart.
    echo "DB_DIAG_SELECT1:$SELECT1"
    echo "DB_SELECT1_FAILED"
  fi
else
  echo "DB_DIAG_ISREADY:$(pg_isready -h 127.0.0.1 -p 5432 2>&1 | tail -1)"
  echo "DB_NOT_READY"
fi`;
}

/**
 * The diagnostic lines the script emitted, as a single readable string.
 *
 * Kept OUT of the user-facing message and put in the report's `detail`: "postgres would not start"
 * is what a person needs; `pg_ctlcluster: Insufficient privileges` is what WE need. Returns '' when
 * the script emitted none, so a caller can decide not to add an empty detail.
 */
export function provisionDiagnostics(stdout: string | null | undefined): string {
  const lines = String(stdout ?? '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('DB_DIAG_'))
    .map((l) => l.replace(/^DB_DIAG_/, ''));
  return lines.join('\n');
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
