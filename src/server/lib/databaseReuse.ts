/**
 * WHOSE DATABASE IS THIS? — keeping one user's app out of another of their apps' data.
 *
 * ═══ THE LEAK THIS CLOSES ═══
 *
 * The zero-setup database wrote its keys into the vault as SHARED, which means every app that user
 * ever builds afterwards receives them in its `.env`: `VITE_SUPABASE_URL`, the anon key, and
 * `DATABASE_URL` — a full Postgres connection string with the password in it. So a landing page built
 * on Tuesday silently carried the credentials of the shop database built on Monday. Nothing errored,
 * nothing appeared on screen, and if either app was published or exported the credentials went with it.
 *
 * That is exactly the class `secretScope.ts` was written to close for hand-saved keys, still open on
 * the one path that writes keys on the user's behalf — which is the path where they never get to
 * notice, because they never typed anything.
 *
 * ═══ WHY "JUST SCOPE IT" IS HALF AN ANSWER ═══
 *
 * Scoping the keys to the app they were made for closes the leak in one line and breaks something
 * real: Supabase's free plan allows TWO projects per organisation. A user whose second app can no
 * longer see the first app's database is offered "create one", spends their second slot, and their
 * third app hits a wall — where today it silently worked.
 *
 * So the fix is not narrower access, it is ASKED-FOR access. A database now reaches an app only when
 * the user presses the button on THAT app, and pressing it hands them the database they already have
 * rather than burning another project slot. Same convenience, minus the silence — and an app nobody
 * pressed the button on gets nothing at all, which is the leak gone.
 *
 * 🔒 The distinction this file exists to preserve: **having a database and being given one are
 * different events.** The old code merged them, and the merge was invisible.
 *
 * PURE — no I/O. The decisions are what must be right, so they are what is tested.
 */
import type { VaultSecretRow } from './secretScope';

/** The names a provisioned database writes. Anything outside this list is somebody else's key. */
export const DATABASE_ENV_KEYS = [
  'ENGINEER_DB_PROVIDER',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'DATABASE_URL',
  'DIRECT_URL',
] as const;

/**
 * The two values without which there is no usable database to reuse.
 *
 * Deliberately the BROWSER pair rather than `DATABASE_URL`: a frontend-only app is wired entirely
 * through those two, and treating a database as absent because it has no connection string would
 * offer a second project to somebody whose first one works perfectly.
 */
const ESSENTIAL_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

/** One candidate database, as it sits in the vault. */
export interface VaultDatabase {
  /** The app it belongs to. `null` means shared — every database written before scoping existed. */
  workspaceId: string | null;
  env: Record<string, string>;
  /** When its newest row was written, for picking between two. `null` when nothing recorded it. */
  createdAt: number | null;
}

const scopeOf = (row: VaultSecretRow): string | null => {
  const s = String(row?.workspaceId ?? '').trim();
  return s || null;
};

/**
 * Group the vault's rows into the databases they describe, one per scope.
 *
 * Only `DATABASE_ENV_KEYS` are read, so a user's Stripe key can never travel through a path called
 * "reuse your database". Within one scope the newest row of a name wins, the same rule the rest of the
 * vault follows.
 */
export function databasesInVault(rows: readonly VaultSecretRow[] | null | undefined): VaultDatabase[] {
  const wanted = new Set<string>(DATABASE_ENV_KEYS);
  const byScope = new Map<string, { env: Record<string, string>; dates: Record<string, number | null>; createdAt: number | null }>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.name || !wanted.has(r.name)) continue;
    if (typeof r.value !== 'string' || !r.value.trim()) continue;
    const key = scopeOf(r) ?? '';
    const held = byScope.get(key) ?? { env: {}, dates: {}, createdAt: null };
    const at = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : null;
    const prev = held.dates[r.name];
    // Newest of that name within this scope — `undefined` means we have not seen the name yet, which
    // is different from having seen an undated one, so `in` rather than a truthiness test.
    if (!(r.name in held.dates) || (at !== null && (prev === null || prev === undefined || at > prev))) {
      held.env[r.name] = r.value;
      held.dates[r.name] = at;
    }
    if (at !== null && (held.createdAt === null || at > held.createdAt)) held.createdAt = at;
    byScope.set(key, held);
  }
  const out: VaultDatabase[] = [];
  for (const [scope, held] of byScope) {
    if (!ESSENTIAL_KEYS.every((k) => held.env[k])) continue;
    out.push({ workspaceId: scope || null, env: held.env, createdAt: held.createdAt });
  }
  return out;
}

/** Does THIS app already have a database of its own? Then "create" means create, not reuse. */
export function appHasOwnDatabase(rows: readonly VaultSecretRow[] | null | undefined, workspaceId: string): boolean {
  const wanted = String(workspaceId ?? '').trim();
  if (!wanted) return false;
  return databasesInVault(rows).some((d) => d.workspaceId === wanted);
}

/**
 * The database this app should be OFFERED, when it has none of its own.
 *
 * Picks the newest, because a user with two is almost always reaching for the one they just made. A
 * SHARED database — one written before scoping existed — counts and is preferred over nothing: those
 * users already see it everywhere today, so offering it here changes nothing for them while giving
 * them a path onto the scoped model the first time they press the button.
 *
 * `null` when there is nothing to reuse, which is the honest cue to create a real project.
 */
export function reusableDatabase(
  rows: readonly VaultSecretRow[] | null | undefined,
  workspaceId: string,
): VaultDatabase | null {
  const wanted = String(workspaceId ?? '').trim();
  if (!wanted) return null;
  const candidates = databasesInVault(rows).filter((d) => d.workspaceId !== wanted);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    // A dated candidate beats an undated one; between two dated ones the later wins. Same rule as
    // isNewerRow, and for the same reason: an undated record predates the date being recorded.
    if (c.createdAt !== null && (best.createdAt === null || c.createdAt > best.createdAt)) best = c;
  }
  return best;
}

/**
 * What to tell the user when their app was given a database they already had.
 *
 * Names the source app when we know it. "another app you built" when we do not — vague, but true,
 * and far better than inventing a name or silently saying "created", which is the fake-success this
 * whole change exists to remove.
 */
export function reusedDatabaseNote(fromApp: string | null | undefined): string {
  const name = String(fromApp ?? '').trim();
  return name
    ? `This app now uses the database you already made for "${name}" — no new project was created, so your Supabase plan is untouched.`
    : 'This app now uses a database you already made — no new project was created, so your Supabase plan is untouched.';
}
