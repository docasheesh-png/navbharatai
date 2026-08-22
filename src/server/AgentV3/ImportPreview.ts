// AgentV3 — heavy-app preview enablement (capability ② of "handle Mitrify x50").
//
// An imported FULL-STACK app (Express + Postgres + env-driven config, like Mitrify) crashes on a
// bare `npm run dev`: the server dies immediately without a DATABASE_URL, or on a missing required
// env var. So the live preview never boots and the user just sees "did not come up".
//
// This PURE module decides what dev infrastructure the imported app needs so it has a REAL chance
// to boot in the sandbox:
//   • detectNeedsDatabase — does the app use a SQL/ORM driver or reference DATABASE_URL?
//   • envVarNames         — the env vars the app documents in its .env template
//   • buildDevEnvContent  — a dev .env that satisfies "the var must exist" (provisioned DB URL +
//                            NODE_ENV + placeholders for the rest) so the app boots instead of
//                            crashing on `process.env.X is undefined`.
//   • externalServiceNote — the honest "these need REAL keys" message, because external PAID
//                            services (payments, Google APIs, third-party auth) can NOT be faked —
//                            the preview is PARTIAL by nature and we say so plainly.
//
// The side effects (provision Postgres, write the .env, boot the dev server) live in the route; this
// module is pure so the classification + env generation are fully unit-testable.

import { randomBytes } from 'node:crypto';
import { classifyDevServerFailure, missingCredentialFromLog, unavailableDbEngine } from './sandbox/EngineerAI/actuators/DevServerRecovery';
import { mergeDotEnv } from '../secrets/appSecretsEnv';

/** SQL/ORM drivers whose presence means the app needs a database to boot. */
const DB_DEPS = [
  'pg', 'postgres', 'drizzle-orm', '@prisma/client', 'prisma', 'mongoose', 'mysql', 'mysql2',
  'sequelize', 'typeorm', 'knex', '@neondatabase/serverless', 'pg-promise', 'slonik', 'kysely',
];

/**
 * Does the imported app need a database to boot? True when its package.json pulls in a SQL/ORM
 * driver, OR its source references DATABASE_URL (a strong signal even without a recognised driver).
 * PURE.
 */
export function detectNeedsDatabase(files: Record<string, string>): boolean {
  const pkgRaw = files['package.json'];
  if (typeof pkgRaw === 'string') {
    try {
      const p = JSON.parse(pkgRaw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
      if (DB_DEPS.some((d) => Object.prototype.hasOwnProperty.call(deps, d))) return true;
    } catch { /* not valid JSON — fall through to the code scan */ }
  }
  return Object.values(files).some((c) => typeof c === 'string' && c.includes('DATABASE_URL'));
}

/** Friendly DB-provider label → package/env signals. Ordered most-specific first; the FIRST match wins.
 *  Broader than detectNeedsDatabase (which only knows SQL/ORM drivers): this also recognises the BaaS
 *  providers (Supabase / Firebase) an imported app commonly uses. These are the USER'S OWN database
 *  vendors — naming them is correct and helpful (the white-label rule covers NavBharatAI's AI vendors,
 *  not the user's chosen database). */
const DB_PROVIDER_SIGNALS: Array<{ label: string; deps: string[]; envRe?: RegExp }> = [
  { label: 'Supabase', deps: ['@supabase/supabase-js', '@supabase/ssr'], envRe: /\bSUPABASE_URL\b|\bSUPABASE_ANON_KEY\b|\bVITE_SUPABASE_/ },
  { label: 'Firebase', deps: ['firebase', 'firebase-admin'], envRe: /\bFIREBASE_|\bVITE_FIREBASE_/ },
  { label: 'Neon', deps: ['@neondatabase/serverless'] },
  { label: 'PlanetScale', deps: ['@planetscale/database'] },
  { label: 'MongoDB', deps: ['mongoose', 'mongodb'], envRe: /\bMONGO(DB)?_URI\b|\bMONGODB_URL\b/ },
  { label: 'Prisma', deps: ['@prisma/client', 'prisma'] },
  { label: 'Drizzle', deps: ['drizzle-orm'] },
  { label: 'PostgreSQL', deps: ['pg', 'postgres', 'pg-promise', 'slonik'] },
  { label: 'MySQL', deps: ['mysql', 'mysql2'] },
  { label: 'a SQL database', deps: ['sequelize', 'typeorm', 'knex', 'kysely'] },
];

/**
 * The DATABASE provider an imported app uses (for a specific, honest advisory), or null if none is
 * detected. Reads package.json deps first (most reliable), then falls back to env/source signals
 * (SUPABASE_URL, MONGODB_URI, DATABASE_URL). PURE.
 */
export function detectDatabaseProvider(files: Record<string, string>): string | null {
  let deps: Record<string, unknown> = {};
  const pkgRaw = files['package.json'];
  if (typeof pkgRaw === 'string') {
    try {
      const p = JSON.parse(pkgRaw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
    } catch { /* not valid JSON — fall through to the source/env scan */ }
  }
  const has = (d: string) => Object.prototype.hasOwnProperty.call(deps, d);
  for (const sig of DB_PROVIDER_SIGNALS) {
    if (sig.deps.some(has)) return sig.label;
  }
  // No recognised driver dep — fall back to env/source signals.
  const allText = Object.values(files).filter((c): c is string => typeof c === 'string').join('\n');
  for (const sig of DB_PROVIDER_SIGNALS) {
    if (sig.envRe && sig.envRe.test(allText)) return sig.label;
  }
  if (/\bDATABASE_URL\b/.test(allText)) return 'a database';
  return null;
}

/**
 * The deterministic, USER-FACING "problem → solution" advisory for a freshly-imported app that uses a
 * database (admin 2026-07-23 — big imported apps must be told clearly what's wrong and how to fix it,
 * instead of DB guidance living only in the model's hidden system prompt). When the user has NOT
 * connected their own persistent database, it names the provider and points them at the real fix
 * (Settings → App Settings → Database — the existing bring-your-own flow the engine auto-wires). Returns
 * '' when a database is already connected (no problem) or none is used. PURE.
 */
export function persistentDatabaseAdvisory(opts: { provider: string | null; connected: boolean }): string {
  if (opts.connected || !opts.provider) return '';
  const uses = opts.provider === 'a database' || opts.provider === 'a SQL database' ? opts.provider : `**${opts.provider}**`;
  return (
    `🗄️ Heads up: this app uses ${uses}, but you haven't connected a database yet — so its data won't ` +
    `persist. To run your app for real, connect your own database in **Settings → App Settings → Database** ` +
    `(Supabase, Neon, Firebase, MongoDB, or a connection string) and I'll wire it in on the next build. ` +
    `Any preview until then runs on temporary data only.`
  );
}

/**
 * The HONEST advisory shown when a DB-backed imported app's live preview FAILED to boot (admin 2026-07-24:
 * "honest DB state"). The old failure line was generic ("did not boot automatically — use In-browser /
 * Diagnose"), so a user whose Express+Postgres app crashed on a missing `DATABASE_URL` had no idea WHY.
 * This names the real, likely cause and the exact fix. Returns '' for an app that needs no database and
 * has no external secrets (then the generic line is fine). PURE.
 */
export function previewBootFailureAdvisory(opts: {
  needsDb: boolean;
  provider: string | null;
  externalVars: string[];
  dbProvisioned: boolean;
}): string {
  const parts: string[] = [];
  if (opts.needsDb) {
    const prov = opts.provider && opts.provider !== 'a database' && opts.provider !== 'a SQL database'
      ? `**${opts.provider}**` : 'a database';
    parts.push(
      opts.dbProvisioned
        ? `This app uses ${prov}. I provisioned a temporary local one so it could boot — if it still didn't start, it likely needs your REAL database (its own tables/data) to run. Connect it in **Settings → App Settings → Database**, then press **Diagnose** to boot it.`
        : `This app needs ${prov} to start its server, and I couldn't provision one automatically. Connect your own in **Settings → App Settings → Database**, then press **Diagnose** to boot it.`,
    );
  }
  if (opts.externalVars.length > 0) {
    const shown = opts.externalVars.slice(0, 8);
    const more = opts.externalVars.length - shown.length;
    parts.push(
      `It also expects real values for ${opts.externalVars.length} external service${opts.externalVars.length === 1 ? '' : 's'} ` +
      `(${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}) — a server that hard-requires one of these on startup won't boot until you add them in **Settings → Secrets & API Keys**.`,
    );
  }
  if (parts.length === 0) return '';
  return `⚠️ The live preview didn't boot. ${parts.join(' ')} Meanwhile the **In-browser preview** renders your frontend from the imported files.`;
}

/** Source files worth scanning for env reads — code, not assets. */
const ENV_SCAN_SOURCE = /\.(?:m?[jt]sx?|cjs|cts|mts)$/i;
/** Bound the scan so a huge import cannot turn env discovery into a long CPU stall. */
const ENV_SCAN_MAX_BYTES = 4_000_000;
/** `process.env.NAME`, `process.env['NAME']`, `import.meta.env.NAME` — how code actually reads env. */
const ENV_READ_PATTERN = /(?:process|import\s*\.\s*meta)\s*\.\s*env\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\])/g;

/**
 * The env-var NAMES this app needs — from its committed .env template AND from the code itself. PURE.
 *
 * ROOT CAUSE THIS CLOSES (build report d6deaaf0, Mitrify, 2026-08-09). Discovery used to read ONLY
 * `.env.example` / `.env.sample` / `.env.template`. Mitrify commits none of those, so the list came
 * back EMPTY — and that one gap produced three separate symptoms in a single build:
 *   • no `SESSION_SECRET` was conjured, so express-session had no secret and EVERY request returned
 *     `{"message":"secret option required for sessions"}` — the whole app was dead in preview;
 *   • the honest "these external services still need real values" note never appeared, because the
 *     external list is derived from the same discovery;
 *   • nothing in the run explained any of it, so the build looked clean.
 * A `.env.example` is a courtesy some projects keep; `process.env.X` in the source is the truth every
 * project has. Reading the code is what makes this work for an app we have never seen before.
 */
export function envVarNames(files: Record<string, string>): string[] {
  const names: string[] = [];
  const add = (n: string) => { if (n && !names.includes(n)) names.push(n); };

  // The declared template still goes FIRST — it is the app author's own documented order.
  const raw = files['.env.example'] ?? files['.env.sample'] ?? files['.env.template'] ?? '';
  if (typeof raw === 'string') {
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) add(m[1]);
    }
  }

  // Then whatever the code genuinely reads, whether or not anyone documented it.
  let scanned = 0;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !ENV_SCAN_SOURCE.test(path)) continue;
    if (scanned >= ENV_SCAN_MAX_BYTES) break;
    scanned += content.length;
    ENV_READ_PATTERN.lastIndex = 0; // a /g regex carries state between calls
    let m: RegExpExecArray | null;
    while ((m = ENV_READ_PATTERN.exec(content)) !== null) add(m[1] ?? m[2]);
  }
  return names;
}

/**
 * A dev `.env` that gives the app a chance to BOOT: every documented var is present (so
 * `process.env.X` is defined, not undefined — the common startup-crash cause), NODE_ENV=development,
 * and any provisioned/real values (e.g. the local DATABASE_URL) win. Placeholders are empty strings
 * — enough for the app to start; the features that need REAL keys just won't work (honest partial).
 * PURE.
 */
/**
 * The dev `.env` MERGED over whatever the app already has — never a wholesale overwrite.
 *
 * THE BUG THIS FIXES (found 2026-08-09 while verifying the mid-build secrets popup). The caller wrote
 * `buildDevEnvContent(...)` straight over `.env`, and that content lists every declared variable with
 * an EMPTY placeholder. Any real value already in the file was replaced by `KEY=`. On the same chat
 * route where a build runs, that meant:
 *
 *   1. the build asks for STRIPE_SECRET_KEY, the user types their real key
 *   2. it is saved to the vault and merged into `.env` — correct so far
 *   3. the preview boot in the same turn rewrites `.env` from scratch
 *   4. the user's key is now `STRIPE_SECRET_KEY=`
 *
 * The user supplied the key, it saved, and the app still does not work — the worst shape of bug,
 * because every visible signal says it succeeded. The same overwrite could erase keys the vault
 * injected at build start, or the DATABASE_URL that `rescueDatabase` had just written.
 *
 * THE RULE: an EMPTY placeholder never overwrites a value that already exists. Real `provided` values
 * still win (they are provisioned on purpose — a freshly created database URL should replace a stale
 * one), and placeholders are only added for variables the file does not mention yet. PURE.
 */
export function mergeDevEnvContent(
  existingEnv: string,
  varNames: string[],
  provided: Record<string, string>,
): string {
  const generated = buildDevEnvContent(varNames, provided);
  const existing = String(existingEnv ?? '');
  if (!existing.trim()) return generated;

  // Which keys the file already carries a NON-EMPTY value for — those are the ones to protect.
  const held = new Set<string>();
  for (const line of existing.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m && m[2].trim() !== '') held.add(m[1]);
  }

  // Everything the generated content wants to set, minus the blanks that would clobber a real value.
  const wanted: Record<string, string> = {};
  for (const line of generated.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (value.trim() === '' && held.has(key)) continue; // the placeholder loses to a real value
    wanted[key] = value;
  }
  return mergeDotEnv(existing, wanted);
}

export function buildDevEnvContent(varNames: string[], provided: Record<string, string>): string {
  const env: Record<string, string> = { NODE_ENV: 'development' };
  for (const n of varNames) if (!(n in env)) env[n] = '';
  Object.assign(env, provided); // provisioned/real values always override the placeholder
  // AN EMPTY PORT IS WORSE THAN NO PORT (2026-08-09). Every other var is safe as '' because apps
  // test it for truthiness, but a port is PARSED: `process.env.PORT || 5000` falls back correctly,
  // while `Number(process.env.PORT ?? 5000)` turns '' into 0 and the server binds a RANDOM port —
  // which no preview could then find. Left absent, every idiom falls back to the app's own default,
  // which is exactly what we want now that we no longer assign the port at all.
  if (env.PORT === '') delete env.PORT;
  return Object.entries(env).map(([k, v]) => `${k}=${String(v)}`).join('\n') + '\n';
}

/**
 * LOCAL secret-shaped env vars we can legitimately CONJURE (P3, admin 2026-07-05 "koi aur rasta"):
 * these are secrets the app mints for ITSELF (session signing, JWT signing, cookie/CSRF secrets) —
 * not credentials issued by a third party to the user. An EMPTY placeholder here is exactly what
 * killed the Mitrify boot: express-session THROWS "secret option required" on '' — so the dev server
 * died before it could listen, and the live preview "did not come up". A generated random value is
 * fully valid for a sandbox dev boot.
 *
 * Deliberately narrow: names must be EXACT matches of self-issued secret conventions. Anything
 * third-party-shaped (API keys, client ids, DSNs, tokens for external services) is NEVER conjured —
 * a fake external key would make the app fire real requests with garbage credentials and fail in
 * confusing ways; an empty value keeps those features cleanly inactive (honest partial preview).
 */
const LOCAL_SECRET_VAR = /^(SESSION_SECRET|JWT_SECRET|JWT_REFRESH_SECRET|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET|COOKIE_SECRET|AUTH_SECRET|NEXTAUTH_SECRET|CSRF_SECRET|TOKEN_SECRET|ENCRYPTION_KEY|SECRET_KEY|SECRET_KEY_BASE|APP_SECRET|SIGNING_KEY)$/i;

/**
 * Generate REAL random values for every conjurable local secret the app documents. `rand` is
 * injectable for deterministic tests; the default is crypto-strong 48-hex-char values. PURE given rand.
 */
export function conjurableSecrets(
  varNames: string[],
  rand: () => string = () => randomBytes(24).toString('hex'),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of varNames) if (LOCAL_SECRET_VAR.test(n)) out[n] = rand();
  return out;
}

/**
 * Env var names out of a `grep -rhoE "process.env.NAME"` sweep of the sandbox. PURE.
 *
 * WHY A GREP AND NOT THE FILE MAP (2026-08-21): this runs on the hot path right before a dev server
 * starts, where reading every file out of the durable store to scan it would cost more than the boot
 * it is protecting. One deterministic sandbox command, no model call, and it sees the app as it
 * ACTUALLY is on disk — including files written this turn that the durable store has not caught up
 * with yet.
 */
export function envNamesFromGrep(stdout: string): string[] {
  const names: string[] = [];
  const re = /(?:process|import\s*\.\s*meta)\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(stdout ?? ''))) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Which env keys an existing `.env` already gives a NON-EMPTY value. PURE. */
export function envKeysWithValues(envContent: string): Set<string> {
  const out = new Set<string>();
  for (const line of String(envContent ?? '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (m[2].trim().replace(/^['"]|['"]$/g, '') !== '') out.add(m[1]);
  }
  return out;
}

/**
 * Fill in the app's OWN self-issued secrets so it can boot — and nothing else. PURE given `rand`.
 *
 * 🔒 ROOT CAUSE THIS CLOSES (admin, 2026-08-21, "preview mar gaya" — Mitrify, the SECOND time).
 * `conjurableSecrets` existed and worked, but ran ONLY on the import turn. Every later turn went
 * through `ToolDispatcher.ensureUserSecretsEnvFile`, which opens with `if (names.length === 0)
 * return` — so a user with NO saved vault secrets got **no `.env` written at all**. Since a live
 * `.env` is deliberately never imported and never persisted durably (the user's secrets stay
 * theirs), any sandbox that was recycled or rebuilt came back without one, express-session threw
 * "secret option required", and EVERY page request returned 500. The app was fine; it simply had no
 * key to sign a cookie with.
 *
 * A session secret is not a credential anyone issued the user — it is a random string the app mints
 * for itself, and one generated per sandbox is completely valid for a dev preview. So this is
 * prevention, not a workaround: the class of failure stops being possible instead of being detected.
 *
 * 🔒 NEVER OVERWRITES. A value already present — the user's real key from the vault, or one their
 * own `.env` carries — always wins. We only ever fill a hole.
 */
export function conjureMissingLocalSecrets(
  existingEnv: string,
  varNames: string[],
  rand: () => string = () => randomBytes(24).toString('hex'),
): { content: string; added: string[] } {
  const have = envKeysWithValues(existingEnv);
  const missing: Record<string, string> = {};
  for (const n of varNames ?? []) {
    if (!LOCAL_SECRET_VAR.test(n) || have.has(n)) continue;
    if (missing[n] === undefined) missing[n] = rand();
  }
  const added = Object.keys(missing);
  if (added.length === 0) return { content: existingEnv, added: [] };
  const base = String(existingEnv ?? '');
  const sep = base === '' || base.endsWith('\n') ? '' : '\n';
  const block = added.map((n) => `${n}=${missing[n]}`).join('\n');
  return { content: `${base}${sep}${block}\n`, added };
}

/** The dev infra we auto-provide for a preview boot — everything else the app documents is
 *  something the USER must supply for full functionality. */
const AUTO_PROVIDED_ENV = /^(DATABASE_URL|NODE_ENV|PORT)$/i;

/** Documented env vars we can NOT provision (external services / user config) — the honest
 *  "still needs a real value" set, i.e. everything except the infra + local secrets we auto-provide. PURE. */
export function externalSecretVars(varNames: string[]): string[] {
  return varNames.filter((n) => !AUTO_PROVIDED_ENV.test(n) && !LOCAL_SECRET_VAR.test(n));
}

/**
 * The honest one-line note about what the imported app still needs to be FULLY functional in
 * preview — external paid services / third-party keys can't be faked in the sandbox. '' when there
 * are none. PURE.
 */
export function externalServiceNote(varNames: string[]): string {
  const ext = externalSecretVars(varNames);
  if (ext.length === 0) return '';
  const shown = ext.slice(0, 10);
  const more = ext.length - shown.length;
  return `🔌 The app boots with a local database + dev config, but ${ext.length} value${ext.length === 1 ? '' : 's'} it expects can't be provisioned in the sandbox (${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}) — set to empty placeholders for now, so features that use them (payments, third-party APIs, external auth) stay inactive until you add real values in Settings → Secrets.`;
}

/**
 * The HALF-BOOT verdict (admin task 2, 2026-08-05 — Mitrify build d5f0a2bc).
 *
 * The zombie-server shape: the port is open (the process logged "serving on port X" and an
 * unhandledRejection handler kept it alive), but the async boot died BEFORE the client-serving
 * middleware mounted — so every page answers "Cannot GET /…" while the server looks up. On that
 * build we HELD the boot log naming the exact cause (`ECONNREFUSED …:5432` at ensureSchema) and the
 * verdict still guessed "it isn't serving the app's pages (only its API)" — which was wrong even
 * about the API. We made the user debug something we had already computed.
 *
 * `classifyDevServerFailure` (already ANSI-stripped, already tested) does the recognising; this maps
 * ONLY the two causes with both high classifier confidence AND a clear user story into a verdict
 * sentence. Everything else returns null and the generic line stands — a wrong specific cause is
 * worse than an honest generic one, and false alarms are what teach people to ignore the verdict.
 * PURE.
 */
export function halfBootCause(bootLog: string | null | undefined): string | null {
  const log = String(bootLog ?? '');
  if (!log.trim()) return null;
  const cause = classifyDevServerFailure(log).cause;
  if (cause === 'db_unreachable') {
    return 'Your app started but could not reach its database (connection refused), so it stopped booting half-way — its pages were never mounted. That is why pages answer "Cannot GET"';
  }
  // The SAME half-boot shape, a different cause and a different action: the sandbox can start
  // PostgreSQL and nothing else, so a Mongo/MySQL/Redis app stops half-way for a reason no retry
  // touches. Naming the engine is what makes the message actionable.
  if (cause === 'db_engine_unavailable') {
    const engine = unavailableDbEngine(log)?.label ?? 'its database';
    return `Your app started but could not reach ${engine}, so it stopped booting half-way — its pages were never mounted. That is why pages answer "Cannot GET". This preview can only start PostgreSQL, so connect your own ${engine} in Settings → App Settings → Database`;
  }
  // The Replit/Heroku export shape (admin 2026-08-13): the port is up and the server 500s every page
  // because its session secret lived in a .env we deliberately never import. Named here so the verdict
  // stops guessing "your client routes aren't served" over a log that says exactly what is wrong.
  if (cause === 'missing_session_secret') {
    return 'Your app started, but its login sessions have no secret key, so every page request fails. That key normally comes from an environment file, and NavBharatAI never imports those — your secrets stay yours. Add SESSION_SECRET in Settings → App Settings → Secrets & API Keys, or ask me to give it a development fallback so it runs here';
  }
  if (cause === 'missing_credential') {
    const key = missingCredentialFromLog(log);
    return `Your app started but stopped booting half-way because a required key${key ? ` (\`${key}\`)` : ''} is missing — its pages were never mounted. Add it in Settings → App Settings → Secrets & API Keys`;
  }
  return null;
}

/**
 * THE MISSING SUBSYSTEM: a DB-migration runner (build report 32d4f48e, 2026-08-07 — Mitrify import).
 *
 * That build provisioned PostgreSQL, verified it with a real SELECT 1, declared the preview "✅ up" —
 * and its own boot log said `relation "profiles" does not exist` twice (the app's schema-repair and
 * its provider backfill both failed). The database EXISTED but was EMPTY: nothing ever ran the app's
 * own migrations, so every page that reads data was broken behind a healthy-looking preview, and the
 * report counted 0 warnings. "DB provisioned" is not "DB usable" — the same earn-the-verdict rule as
 * everything else.
 *
 * This detects the imported app's OWN migration mechanism so the boot can run it right after the
 * database is provisioned: the project's script wins (it encodes the author's intent — Mitrify has
 * `db:push`), falling back to Prisma's committed-migrations deploy (non-interactive, non-destructive).
 * Returns null when the project has no mechanism we can run — then the schema scan below is the
 * honest last line. PURE.
 */
export interface MigrationPlan {
  command: string;
  /** For honest narration — the project's own name for the step, never our invention. */
  label: string;
}

const MIGRATION_SCRIPT_NAMES = ['db:push', 'db:migrate', 'migrate:deploy', 'migrate', 'db:setup'];

export function detectMigrationCommand(files: Record<string, string>): MigrationPlan | null {
  const pkgRaw = files['package.json'];
  let pkg: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } = {};
  if (typeof pkgRaw === 'string') {
    try { pkg = JSON.parse(pkgRaw); } catch { /* not valid JSON — fall through to file signals */ }
  }
  const scripts = pkg.scripts ?? {};
  for (const name of MIGRATION_SCRIPT_NAMES) {
    if (typeof scripts[name] === 'string' && (scripts[name] as string).trim()) {
      return { command: `npm run ${name}`, label: `npm run ${name}` };
    }
  }
  // Prisma without a script: `migrate deploy` applies the app's own committed migrations — it never
  // prompts and never drops data, so it is safe to run unattended on the fresh sandbox database.
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasPrismaMigrations = Object.keys(files).some((p) => /^prisma\/migrations\//.test(p));
  if (Object.prototype.hasOwnProperty.call(deps, 'prisma') && (hasPrismaMigrations || 'prisma/schema.prisma' in files)) {
    return { command: hasPrismaMigrations ? 'npx prisma migrate deploy' : 'npx prisma db push --skip-generate', label: 'Prisma migrations' };
  }
  return null;
}

/** A safe `NAME='value'` shell prefix so the migration tool sees the provisioned DATABASE_URL even
 *  when the project's config does not load `.env` itself (drizzle-kit famously does not). PURE. */
export function shellEnvAssignment(name: string, value: string): string {
  return `${name}='${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * The honest last line: did the boot log prove the database is missing its tables? Matches the
 * Postgres / SQLite / MySQL "table missing" shapes and returns the FIRST missing table's name — the
 * exact evidence (`relation "profiles" does not exist`) that sat unread in report 32d4f48e's command
 * log while the tally said zero problems. PURE.
 */
export function schemaMissingFromLog(log: string | null | undefined): string | null {
  const s = String(log ?? '');
  if (!s) return null;
  const m =
    s.match(/relation "([^"]+)" does not exist/i) ??
    s.match(/no such table:?\s+"?([A-Za-z0-9_.]+)"?/i) ??
    s.match(/Table '([^']+)' doesn't exist/i);
  if (!m) return null;
  // Strip a schema/db qualifier ("public.profiles" → "profiles") for a readable name.
  return m[1].includes('.') ? m[1].slice(m[1].lastIndexOf('.') + 1) : m[1];
}

/**
 * THE ONE PROBLEM STRING THAT IS NOT A STATEMENT ABOUT THE APP.
 *
 * Every other entry in `problems` comes from `analyzePreviewHtml` reading a page we actually
 * fetched — real evidence about the user's app. This one is produced by the `catch` around the fetch
 * itself: the capture timed out or errored, so we hold NOTHING. Exported so both verdict builders and
 * both `catch` sites use the identical string and the distinction cannot drift into a typo.
 */
export const PREVIEW_UNVERIFIED_PROBLEM = 'the preview could not be reached to verify it';

/**
 * Did we actually SEE the app? False when the only thing we know is that the check itself failed.
 *
 * ROOT CAUSE THIS EXISTS FOR (admin screenshot 2026-08-22, an Express build). The diagnose banner read:
 *
 *   "Dev server is up on port 3000, but it isn't serving the app's pages yet: the preview could not be
 *    reached to verify it. This is common for a full-stack app whose client routes aren't served (only
 *    its API) — the boot log below shows the cause."
 *
 * Three sentences, and the last two were untrue. We had verified nothing, so "isn't serving the app's
 * pages" was not something we knew; the full-stack API-only line is a real cause of a REAL 404, not of
 * a capture timeout; and the boot log did NOT show the cause, because the app's failure
 * (`express-session` throwing "secret option required for sessions") happens per REQUEST, so the boot
 * log is silent by construction. Worse, the true cause was already on the same screen, three messages
 * up, where the build path had correctly reported "the server returned an error instead of the app:
 * secret option required for sessions". Two surfaces disagreeing, and the confident one was wrong.
 *
 * A failed measurement must never be dressed up as a finding. PURE.
 */
export function previewWasVerified(problems: ReadonlyArray<string>): boolean {
  const list = (problems || []).filter((p) => typeof p === 'string' && p.trim());
  if (list.length === 0) return true; // nothing to explain — the caller decides on `rendered`
  return !list.every((p) => p.trim() === PREVIEW_UNVERIFIED_PROBLEM);
}

/**
 * The Diagnose panel's headline, with one rule: NEVER name a cause we did not measure.
 *
 * Order of authority — evidence first, guess last, and no guess at all when there is no evidence:
 *  1. the page rendered                → success.
 *  2. the boot log NAMED a cause       → say that (it is proof).
 *  3. the check itself failed          → say only that, and point at the one place the answer really
 *                                        is (the preview tab the user is already looking at).
 *  4. we saw the page and it failed    → the problem we actually observed, plus the full-stack hint
 *                                        ONLY when the problem is genuinely a 404 / "Cannot GET",
 *                                        which is the single failure that hint explains.
 * PURE.
 */
export function previewDiagnoseReason(opts: {
  port: number;
  hasUrl: boolean;
  rendered: boolean;
  problems: ReadonlyArray<string>;
  bootCause?: string | null;
}): string {
  if (!opts.hasUrl) {
    return `Dev server is up on port ${opts.port}, but the public URL could not be resolved yet. Try again in a few seconds.`;
  }
  if (opts.rendered) return `Dev server is up on port ${opts.port} — preview restored.`;
  if (opts.bootCause) return opts.bootCause;

  if (!previewWasVerified(opts.problems)) {
    // No verdict about the app — because we do not have one.
    return `Dev server is up on port ${opts.port}, but NavBharatAI could not open the preview to check it, so this is not a verdict about your app. `
      + 'Open the Preview tab and reload (↻): whatever that page shows — your app, or an error from it — is the real answer.';
  }

  const why = opts.problems.find((p) => typeof p === 'string' && p.trim()) || 'no page rendered';
  const routing = /cannot get|\b404\b|not serving/i.test(why);
  const hint = routing
    ? ' This is common for a full-stack app whose client routes aren\'t served (only its API) — the boot log below shows the cause.'
    : ' The boot log below has the full output.';
  return `Dev server is up on port ${opts.port}, but it isn't serving the app's pages yet: ${why}.${hint}`;
}

/**
 * EARN the "live preview is up" verdict (admin 2026-08-03, "Cannot GET /customer/home"): a port being
 * up is NOT the app serving. The boot must actually VISIT the home route and read the rendered HTML;
 * this turns that (already-classified) result into the honest user-facing narration.
 *
 * @param rendered  from analyzePreviewHtml — did the home route serve a real app page?
 * @param problems  the specific problems it found (e.g. "Cannot GET", build-error overlay) — the WHY.
 * @param port      the bound port, for the success line.
 * @param needsDb   full-stack apps: point at the most common real cause + the honest partial state.
 * @param bootCause from `halfBootCause` over the boot log — the NAMED cause, when one is known. It
 *                  replaces the guess, never merely decorates it (task 2: the verdict must say what
 *                  the log proves, and only fall back to the guess when the log proves nothing).
 * @param fixOffer  an optional one-line permission ask ("say 'fix the boot' …") appended when the
 *                  engine knows how to repair the named cause — the user's reply IS the permission.
 * PURE.
 */
export function previewServeNarration(opts: { rendered: boolean; problems: string[]; port: number; needsDb: boolean; bootCause?: string | null; fixOffer?: string | null }): { ok: boolean; text: string } {
  if (opts.rendered) {
    return { ok: true, text: `✅ Live preview is up on port ${opts.port} — open the Preview tab (Live server).` };
  }
  if (opts.bootCause) {
    return { ok: false, text: `⚠️ ${opts.bootCause}. Tap reload (↻) once the cause is fixed, or press Diagnose for the full boot log.${opts.fixOffer ? ` ${opts.fixOffer}` : ''}` };
  }
  // The same rule the Diagnose panel now follows (2026-08-22): a capture that never happened is not
  // a finding about the app, so it gets no cause and no diagnosis — only what we actually know.
  if (!previewWasVerified(opts.problems)) {
    return {
      ok: false,
      text: `⚠️ The app is running on port ${opts.port}, but NavBharatAI could not open the preview to check it — so this is not a verdict about your app. `
        + 'Open the Preview tab and reload (↻): whatever that page shows is the real answer.',
    };
  }
  const why = opts.problems[0] || 'the server started but is not serving its pages yet';
  // A full-stack app that serves its API but 404s its client routes is the classic Express-serves-SPA
  // gap — name it honestly and point at the fix, instead of the old fake "✅ up".
  const cannotGet = opts.problems.some((p) => /cannot get|404|not serving/i.test(p));
  const tail = cannotGet && opts.needsDb
    ? ' Your server started, but it isn\'t serving the app\'s pages (only its API). Tap reload (↻) — a dev server can take a moment — or press Diagnose for the full boot log.'
    : ' Tap reload (↻) in the Preview tab, or press Diagnose to see the exact boot log.';
  return { ok: false, text: `⚠️ ${why}.${tail}${opts.fixOffer ? ` ${opts.fixOffer}` : ''}` };
}
