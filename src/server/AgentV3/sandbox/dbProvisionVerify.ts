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
 * A relocatable PostgreSQL build, fetched when the sandbox image has none (admin 2026-08-06).
 *
 * THE BLOCKER THIS REMOVES. Report 26a8e81c measured the truth: `PSQL:none PGBIN:none` — the E2B image
 * ships no PostgreSQL AT ALL, and the sandbox has no root, so `apt-get install` cannot add one. Both
 * existing paths therefore had nothing to run, every database app's boot died on ECONNREFUSED, and the
 * honest conclusion was "the template must be rebuilt", which only the admin can do. That is a whole
 * class of app blocked on an action outside this codebase.
 *
 * These are the binaries the JVM world has used for embedded Postgres for years: an ordinary `.jar`
 * (a zip) on Maven Central holding a `.txz` of a self-contained Postgres that runs from any directory
 * as any user. One HTTPS GET, no root, no package manager, no template change.
 *
 * PINNED, never "latest" — the same discipline as the model ladders. A provisioner is not a place to
 * discover that a new upstream release changed a flag. `AGENTV3_PG_BINARIES_VERSION` overrides it
 * without a deploy if a pin ever needs moving.
 *
 * KNOWN LIMIT, handled rather than hidden: this build ships ONLY `initdb`, `pg_ctl` and `postgres` —
 * no `psql`, no `createdb`, no `pg_isready`. So on this path the script waits with `pg_ctl -w`, uses
 * the `postgres` database `initdb` already creates instead of creating `myapp`, and proves the
 * connection through Node's `pg` driver — which is a BETTER gate than psql here, because it is the
 * exact client the app itself will use.
 */
export const PG_BINARIES_VERSION_DEFAULT = '16.4.0';

/** Where the fetched build is unpacked. Inside $HOME so it needs no privileges and survives a re-provision. */
export const PG_BINARIES_HOME = '${HOME:-/tmp}/.nbai-pg';

/** The pinned version actually used, env-overridable. Rejects anything that is not a plain x.y.z. */
export function pgBinariesVersion(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.AGENTV3_PG_BINARIES_VERSION ?? '').trim();
  return /^\d+\.\d+\.\d+$/.test(raw) ? raw : PG_BINARIES_VERSION_DEFAULT;
}

/** The exact artifact URL for a version. Pure, so the pin is visible and testable without a network. */
export function pgBinariesUrl(version: string): string {
  return 'https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/'
    + `${version}/embedded-postgres-binaries-linux-amd64-${version}.jar`;
}

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
export function dbProvisionScript(dbUrl: string = CANONICAL_DB_URL, env: NodeJS.ProcessEnv = process.env): string {
  const binariesUrl = pgBinariesUrl(pgBinariesVersion(env));
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
# TWO HELPERS, because the client tools are no longer guaranteed. A relocatable Postgres build ships
# the SERVER only (no psql, no createdb, no pg_isready), so every check written in terms of those
# tools would silently report "not ready" against a server that is running perfectly.
#
# nbai_pg_up      — is the server accepting connections? pg_isready when it exists, else pg_ctl status.
# nbai_select1 URL — does a REAL query succeed over the exact URL the app gets? psql when it exists,
#                    else Node's \`pg\` driver, which is a BETTER gate here: it is the very client the
#                    app will use, so it proves the thing we actually care about. Verification is never
#                    skipped — if neither is possible the function fails and the outcome is honest.
nbai_pg_up() {
  if command -v pg_isready > /dev/null 2>&1; then
    pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null || pg_isready -h localhost -p 5432 -q 2>/dev/null
    return $?
  fi
  [ -n "$PGDATA" ] && [ -n "$PGBIN" ] && "$PGBIN/pg_ctl" -D "$PGDATA" status > /dev/null 2>&1
}
nbai_select1() {
  if command -v psql > /dev/null 2>&1; then
    OUT=$(psql "$1" -Atc 'SELECT 1' 2>&1)
    if [ "$OUT" = "1" ]; then return 0; fi
    # The client's own error — a missing database and a refused password need different fixes, and
    # "SELECT 1 failed" alone cannot tell them apart.
    echo "DB_DIAG_SELECT1:$OUT"
    return 1
  fi
  if ! command -v node > /dev/null 2>&1; then
    echo "DB_DIAG_SELECT1:no psql and no node in the sandbox — the connection could not be verified"
    return 1
  fi
  npm install --prefix "${PG_BINARIES_HOME}/client" pg --no-save --no-audit --no-fund --silent > /dev/null 2>&1
  # THE ANSWER IS A MARKED LINE, NOT THE LAST LINE. Caught by running this for real: when the driver is
  # missing, node dies with a stack trace whose last line is "Node.js v22.22.2" — so \`tail -1\` read a
  # crash as the query result. A crash must never be able to look like an answer, so success is an exact
  # match on a marker only our own code can print, and everything else is a failure with its real output.
  OUT=$(NODE_PATH="${PG_BINARIES_HOME}/client/node_modules" node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.argv[1]});c.connect().then(()=>c.query("SELECT 1 AS ok")).then(r=>{console.log("NBAI_SELECT1="+String(r.rows[0].ok));return c.end();}).catch(e=>{console.log("NBAI_SELECT1_ERR "+e.message);process.exit(0);});' "$1" 2>&1)
  if echo "$OUT" | grep -qx 'NBAI_SELECT1=1'; then return 0; fi
  echo "DB_DIAG_SELECT1:$(echo "\${OUT:-node pg check produced no output}" | tail -3 | tr '\\n' ' ')"
  return 1
}
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
  # PATH 2b — NO POSTGRES IN THE IMAGE AT ALL (report 26a8e81c: PSQL:none PGBIN:none). Fetch a
  # relocatable build over plain HTTPS and unpack it into $HOME. No root, no apt, no template change —
  # see PG_BINARIES_VERSION_DEFAULT. Only runs when the image genuinely has nothing, so a template that
  # already ships Postgres never pays for this, and a failure here leaves the old outcome untouched.
  NBAI_PG="${PG_BINARIES_HOME}"
  if [ -z "$PGBIN" ] && [ ! -x "$NBAI_PG/bin/initdb" ]; then
    mkdir -p "$NBAI_PG" 2>/dev/null
    FETCH_ERR=$( (curl -fsSL --max-time 180 -o "$NBAI_PG/pg.jar" "${binariesUrl}" \\
      || wget -q -T 180 -O "$NBAI_PG/pg.jar" "${binariesUrl}") 2>&1 | tail -2)
    echo "DB_DIAG_PGFETCH:\${FETCH_ERR:-ok}"
    if [ -s "$NBAI_PG/pg.jar" ]; then
      # A .jar IS a zip. Whichever unpacker the image has: unzip, then python3, then the JDK's jar.
      UNZIP_ERR=$( (cd "$NBAI_PG" && (unzip -o -q pg.jar 2>&1 \\
        || python3 -c 'import zipfile;zipfile.ZipFile("pg.jar").extractall(".")' 2>&1 \\
        || jar xf pg.jar 2>&1)) | tail -2)
      TXZ=$(ls "$NBAI_PG"/postgres-linux-*.txz 2>/dev/null | head -1)
      echo "DB_DIAG_PGUNPACK:\${UNZIP_ERR:-ok} txz=\${TXZ:-none}"
      if [ -n "$TXZ" ]; then
        TAR_ERR=$(tar -xJf "$TXZ" -C "$NBAI_PG" 2>&1 | tail -2)
        echo "DB_DIAG_PGEXTRACT:\${TAR_ERR:-ok}"
      fi
      rm -f "$NBAI_PG/pg.jar" "$TXZ" 2>/dev/null
    fi
  fi
  if [ -z "$PGBIN" ] && [ -x "$NBAI_PG/bin/initdb" ]; then PGBIN="$NBAI_PG/bin"; fi
  echo "DB_DIAG_PGBIN:\${PGBIN:-none}"
  if [ -n "$PGBIN" ]; then
    export PGDATA="\${HOME:-/tmp}/.nbai-pgdata"
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      INITDB_ERR=$("$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 2>&1 | tail -3)
      echo "DB_DIAG_INITDB:\${INITDB_ERR:-ok}"
      # CREATE THE APP DATABASE WITH THE SERVER ITSELF. \`createdb\` is a CLIENT tool and a fetched
      # Postgres build ships none, which briefly meant the app's database name changed between paths —
      # our canonical URL said \`myapp\` while the database was really \`postgres\`, so any caller
      # holding CANONICAL_DB_URL pointed at a database that did not exist. \`postgres --single\` is the
      # server's own single-user mode: it needs no client, no running server and no root. Done here,
      # before pg_ctl starts, because single-user mode requires the server to be STOPPED. Verified for
      # real against these exact binaries. Harmless when createdb also exists — the later createdb then
      # just reports "already exists" and is ignored.
      CREATEDB_ERR=$(echo "CREATE DATABASE myapp;" | "$PGBIN/postgres" --single -D "$PGDATA" postgres 2>&1 | grep -iE '\berror\b|\bfatal\b' | tail -2)
      echo "DB_DIAG_CREATEDB:\${CREATEDB_ERR:-ok}"
    fi
    # -k /tmp puts the unix socket somewhere writable; -h 127.0.0.1 keeps it on loopback only.
    PGCTL_ERR=$("$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5432 -h 127.0.0.1 -k /tmp" -l "$PGDATA/server.log" -w -t 25 start 2>&1 | tail -3)
    echo "DB_DIAG_PGCTL:\${PGCTL_ERR:-ok}"
    # \`pg_ctl -w\` above already blocks until the server accepts connections, so this loop is only a
    # safety net — and it must NOT depend on pg_isready, which the fetched build does not ship. When it
    # is absent, pg_ctl's own status is the authority (both are checked by nbai_pg_up).
    for i in $(seq 1 15); do
      if nbai_pg_up; then break; fi
      sleep 1
    done
    # The server's own log is the only place a refused start explains itself.
    if ! nbai_pg_up; then
      echo "DB_DIAG_PGLOG:$(tail -3 "$PGDATA/server.log" 2>/dev/null | tr '\\n' ' ')"
    fi
  fi
fi

if nbai_pg_up; then
  # THE DATABASE NAME IS NOT ALWAYS OURS TO CHOOSE. \`createdb\` is a client tool, and the fetched
  # build ships only the server — so when it is missing we use the \`postgres\` database that initdb
  # creates unconditionally, and REPORT THAT URL. The URL is read back from this marker by
  # parseDbProvision, so a caller always gets the database that was actually proven, never an assumed one.
  APP_URL="${dbUrl}"
  if command -v createdb > /dev/null 2>&1; then
    createdb -h 127.0.0.1 -p 5432 -U postgres myapp 2>/dev/null || true
  fi
  if nbai_select1 "$APP_URL"; then
    echo "DB_URL:$APP_URL"
  else
    # LAST RESORT, AND ONLY WHEN THE APP DATABASE GENUINELY IS NOT THERE. Every path above tries to
    # create it (createdb, or the server's own single-user mode), so reaching here means the create
    # failed — on a data directory that already existed before this fix, say. \`postgres\` is the one
    # database initdb ALWAYS makes, so it is the honest fallback. We report the URL that actually
    # answered, never the one we assumed, so a caller can only ever be handed a proven database.
    FALLBACK_URL=$(echo "${dbUrl}" | sed 's|/[^/]*$|/postgres|')
    if nbai_select1 "$FALLBACK_URL"; then
      echo "DB_DIAG_DBNAME:the app database was unreachable — using the built-in postgres database"
      echo "DB_URL:$FALLBACK_URL"
    else
      echo "DB_SELECT1_FAILED"
    fi
  fi
else
  echo "DB_DIAG_ISREADY:$(pg_isready -h 127.0.0.1 -p 5432 2>&1 | tail -1 || echo 'pg_isready absent')"
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
