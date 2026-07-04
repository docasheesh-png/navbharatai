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

/** The dev infra we auto-provide for a preview boot — everything else the app documents is
 *  something the USER must supply for full functionality. */
const AUTO_PROVIDED_ENV = /^(DATABASE_URL|NODE_ENV|PORT|JWT_SECRET|SESSION_SECRET)$/i;

/** Documented env vars we can NOT provision (external services / user config) — the honest
 *  "still needs a real value" set, i.e. everything except the infra we auto-provide. PURE. */
export function externalSecretVars(varNames: string[]): string[] {
  return varNames.filter((n) => !AUTO_PROVIDED_ENV.test(n));
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
