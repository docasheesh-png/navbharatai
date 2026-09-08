// AgentV3 — the rules that keep a preview REVIVABLE for as long as its files exist.
//
// THE REPORT THIS ANSWERS (admin, 2026-09-08, verbatim): "v5 dwara app bana, e2b live preview chalana.
// aur 2-3 din bad preview band ho jana. kitna bhi wake up karo, wapas preview nahi chalna. … user chahe
// 1 sal baad preview chalaye, preview chalna hi chalna chahiye."
//
// The investigation found ONE chain, not one bug. Every link is decided here, PURE, so each is tested
// on its own and the call sites cannot re-derive a different answer:
//
//  1. E2B's timeout action defaults to KILL. A sandbox both sweeps missed (a deploy-orphan whose pause
//     was refused three times) was DELETED at the hour mark, so the durable id pointed at nothing and
//     every later wake started from an empty machine. `sandboxLifecycle()` is the policy that makes
//     the missed case end in a PAUSE instead — recoverable by id, at no compute cost.
//  2. The wake route gave the whole revive 90 seconds. A fresh machine needs the install (60-180 s
//     cold, its own 5-minute bound), a 25 s port wait and up to two recovery rounds (a Postgres
//     re-provision is 120 s on its own). The cap could not be met, and worse, on timeout the route
//     released its sandbox hold while the install kept running — so the 5-minute idle sweep paused
//     the machine MID-INSTALL and left a torn node_modules that no later wake could boot. That is the
//     "kitna bhi wake karo" shape exactly. `previewWakeBudgetMs()` is a budget derived from the work.
//  3. A wake that re-provisions the database gets an EMPTY database: the app's own migrations ran only
//     on the import path. `shouldMigrateOnWake` decides when the wake may run them — and it refuses
//     unless the database is the SANDBOX'S OWN local Postgres, so a user's real Supabase is never
//     touched by a schema push on a wake.
//
// Nothing here talks to E2B, Firestore or a sandbox. Pure decisions only.

/**
 * What E2B must do when a sandbox's own lifetime timer expires.
 *
 * `pause`, never the default `kill`: a paused machine costs nothing and resumes by id with its files
 * and node_modules intact; a killed one is gone, and the durable record that names it becomes a lie
 * that every later wake trips over. `autoResume` is deliberately NOT enabled — resuming is OUR
 * decision, made by the door and the wake route, which are capped and build-aware. An E2B-side
 * auto-resume would let any stale direct sandbox URL in a forgotten tab wake a paid machine with
 * nothing of ours in the loop to stop it.
 */
export function sandboxLifecycle(): { onTimeout: 'pause' } {
  return { onTimeout: 'pause' };
}

/** The floor below which a cold revive cannot succeed — the old cap, kept as the minimum. */
export const PREVIEW_WAKE_MIN_MS = 90_000;
/** Above this the wait stops being a revive and becomes a hung request; the components never add up to it. */
export const PREVIEW_WAKE_MAX_MS = 30 * 60_000;
/**
 * The default: the sum of what a cold wake can legitimately take.
 *   install (5-minute command bound) + first port wait (25 s) + two recovery rounds, the worst of which
 *   is a Postgres re-provision (120 s) plus its 20 s wait — ≈ 8.5 min. Ten minutes leaves the margin.
 * Cloud Run's request timeout on this service is 3600 s, so the request itself can carry it, and the
 * route streams a heartbeat every 5 s so the client sees a live stage rather than a stalled spinner.
 */
export const PREVIEW_WAKE_DEFAULT_MS = 10 * 60_000;

/**
 * How long a wake may spend bringing the dev server back. Env-tunable via
 * `AGENTV3_PREVIEW_WAKE_SECONDS`; junk, zero or a negative value fall back to the default, and any
 * value is clamped into [min, max] so a typo cannot reinstate the 90-second wall or hang a request.
 */
export function previewWakeBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const secs = Number(env.AGENTV3_PREVIEW_WAKE_SECONDS);
  if (!Number.isFinite(secs) || secs <= 0) return PREVIEW_WAKE_DEFAULT_MS;
  return Math.min(PREVIEW_WAKE_MAX_MS, Math.max(PREVIEW_WAKE_MIN_MS, Math.floor(secs * 1000)));
}

/**
 * Is this connection string the sandbox's OWN Postgres (the one provisionBackend starts inside the
 * VM) rather than somebody's real database?
 *
 * Only a loopback host qualifies. A wake may run the app's migrations against a database it created
 * itself and can re-create at will; it must never push a schema at a user's Supabase, Neon or RDS,
 * whose tables hold real data. Malformed input is "no" — the safe side.
 */
export function isSandboxLocalDatabaseUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  let host = '';
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** The value of `NAME=value` in a .env text, unquoted and trimmed, or null when absent. PURE. */
export function envFileValue(envText: string | null | undefined, name: string): string | null {
  if (typeof envText !== 'string' || !envText) return null;
  const re = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`, 'm');
  const m = envText.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.length > 0 ? v : null;
}

export interface WakeMigrationInput {
  /** The app declares a database (ImportPreview.detectNeedsDatabase over the durable files). */
  needsDb: boolean;
  /** The app's own migration mechanism, if it has one (detectMigrationCommand). */
  hasMigration: boolean;
  /** DATABASE_URL as the booted app sees it — read from the sandbox's .env after the boot. */
  databaseUrl: string | null | undefined;
}

/**
 * May this wake run the app's migrations? All three must hold: the app needs a database, it ships a
 * way to create its tables, and the database is the sandbox's own local Postgres. Any "no" means the
 * boot proceeds exactly as before and the honest DB_SCHEMA_MISSING evidence, if any, stands.
 */
export function shouldMigrateOnWake(i: WakeMigrationInput): boolean {
  return i.needsDb === true && i.hasMigration === true && isSandboxLocalDatabaseUrl(i.databaseUrl);
}
