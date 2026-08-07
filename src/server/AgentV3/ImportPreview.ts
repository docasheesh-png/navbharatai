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

/** The env-var NAMES the app documents in its committed .env template (never the values). PURE. */
export function envVarNames(files: Record<string, string>): string[] {
  const raw = files['.env.example'] ?? files['.env.sample'] ?? files['.env.template'] ?? '';
  if (typeof raw !== 'string') return [];
  const names: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !names.includes(m[1])) names.push(m[1]);
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
export function buildDevEnvContent(varNames: string[], provided: Record<string, string>): string {
  const env: Record<string, string> = { NODE_ENV: 'development' };
  for (const n of varNames) if (!(n in env)) env[n] = '';
  Object.assign(env, provided); // provisioned/real values always override the placeholder
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
  if (cause === 'missing_credential') {
    const key = missingCredentialFromLog(log);
    return `Your app started but stopped booting half-way because a required key${key ? ` (\`${key}\`)` : ''} is missing — its pages were never mounted. Add it in Settings → App Settings → Secrets & API Keys`;
  }
  return null;
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
  const why = opts.problems[0] || 'the server started but is not serving its pages yet';
  // A full-stack app that serves its API but 404s its client routes is the classic Express-serves-SPA
  // gap — name it honestly and point at the fix, instead of the old fake "✅ up".
  const cannotGet = opts.problems.some((p) => /cannot get|404|not serving/i.test(p));
  const tail = cannotGet && opts.needsDb
    ? ' Your server started, but it isn\'t serving the app\'s pages (only its API). Tap reload (↻) — a dev server can take a moment — or press Diagnose for the full boot log.'
    : ' Tap reload (↻) in the Preview tab, or press Diagnose to see the exact boot log.';
  return { ok: false, text: `⚠️ ${why}.${tail}${opts.fixOffer ? ` ${opts.fixOffer}` : ''}` };
}
