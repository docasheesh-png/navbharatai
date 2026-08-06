// ONE definition of "is Postgres up" and "start Postgres", shared by every place that asks.
//
// THE CLASS BUG THIS CLOSES (admin 2026-08-06, "pura rocksolid banao"). Three separate pieces of the
// engine each had their OWN idea of how to answer those two questions, all of them written when the
// only possible Postgres was the Debian cluster:
//   • the provisioning script          — pg_isready / pg_ctlcluster
//   • the keepalive watchdog           — pg_isready / pg_ctlcluster
//   • the pre-flight liveness probe    — pg_isready
// The moment the sandbox could get its Postgres from somewhere ELSE (a fetched, relocatable build that
// ships NO client tools — see dbProvisionVerify), all three broke in the same silent way and in
// opposite directions:
//   • the PROBE says PG_DOWN forever, because `pg_isready` does not exist. A perfectly healthy database
//     is declared dead, the bounded revivals are burned, and the provider lock releases into a SQLite
//     downgrade — the exact failure the lock was built to prevent.
//   • the WATCHDOG becomes a busy loop that can never help: it reads "down" every 20s and then runs
//     `pg_ctlcluster`, which is absent (and root-only anyway). So a reaped Postgres NEVER comes back
//     and the app dies half way through a build that started fine.
// Both would have made the new path work exactly once and then fail — which is not rock-solid, it is a
// delayed failure. Fixing the three copies separately would leave the same drift for the fourth caller,
// so there is now ONE implementation and every caller is derived from it.
//
// PURE string builders, deliberately free of single quotes: the watchdog embeds them inside
// `sh -c '…'`, where a single quote would terminate the script.

/** The data directory our own (non-root) instance lives in. Shell-expanded, not resolved here. */
export const PGDATA_EXPR = '${HOME:-/tmp}/.nbai-pgdata';

/** Where a fetched, relocatable Postgres is unpacked. */
export const PGHOME_EXPR = '${HOME:-/tmp}/.nbai-pg';

/**
 * A shell expression resolving the Postgres `bin` directory to use.
 *
 * OURS WINS WHEN IT EXISTS, and that is a correctness rule rather than a preference: a fetched build is
 * the one that ran `initdb` on our data directory, and `pg_ctl` REFUSES a data directory written by a
 * different major version. An image shipping PostgreSQL 14 next to a fetched 16 would therefore fail
 * every start and every status check if the image's binary were picked.
 *
 * (The first version of this listed both and took `tail -1`, on the assumption that argument order
 * survives — it does not: `ls` re-sorts its arguments, so `/home/...` sorted BEFORE `/usr/...` and the
 * image's binary won every time. Caught by running it, not by reading it.)
 */
export const PGBIN_EXPR = `$( [ -x ${PGHOME_EXPR}/bin/pg_ctl ] && echo ${PGHOME_EXPR}/bin || ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 )`;

/**
 * A command that exits 0 when Postgres is accepting connections on `port`.
 *
 * Three rungs, because no single tool is guaranteed:
 *   1. `pg_isready` — the right tool, when the image has client tools at all.
 *   2. `pg_ctl status` against OUR data directory — ships with every Postgres build, client tools or not.
 *   3. `nc` — proves something is listening even when neither of the above can run.
 * Rung 2 can only be reached when `pg_isready` is missing, which means there is no system cluster to be
 * confused with; and rung 3 can only ever turn a false "down" into a true "up", never the reverse.
 */
export function pgUpCommand(port = 5432): string {
  return [
    `( command -v pg_isready >/dev/null 2>&1 && ( pg_isready -h 127.0.0.1 -p ${port} -q 2>/dev/null || pg_isready -h localhost -p ${port} -q 2>/dev/null ) )`,
    `( PGB=${PGBIN_EXPR}; [ -n "$PGB" ] && [ -x "$PGB/pg_ctl" ] && "$PGB/pg_ctl" -D "${PGDATA_EXPR}" status >/dev/null 2>&1 )`,
    `( command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 ${port} >/dev/null 2>&1 )`,
  ].join(' || ');
}

/**
 * A best-effort command that starts Postgres by whichever route this sandbox actually has.
 *
 * The privileged cluster is tried first (instant where it works), then our own instance. Always exits 0
 * — a start attempt that fails must never kill the watchdog loop or the caller's command; the caller
 * decides what to do by ASKING (pgUpCommand), never by trusting this return value.
 */
export function pgStartCommand(port = 5432): string {
  return [
    `( command -v pg_ctlcluster >/dev/null 2>&1 && pg_ctlcluster "$(ls /etc/postgresql/ 2>/dev/null | sort -V | tail -1)" main start >/dev/null 2>&1 )`,
    `( PGB=${PGBIN_EXPR}; [ -n "$PGB" ] && [ -x "$PGB/pg_ctl" ] && [ -f "${PGDATA_EXPR}/PG_VERSION" ]`
      + ` && "$PGB/pg_ctl" -D "${PGDATA_EXPR}" -o "-p ${port} -h 127.0.0.1 -k /tmp" -l "${PGDATA_EXPR}/server.log" -w -t 20 start >/dev/null 2>&1 )`,
    `true`,
  ].join(' || ');
}
