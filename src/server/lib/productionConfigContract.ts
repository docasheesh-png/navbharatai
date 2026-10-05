// The production configuration contract — checked once, at boot, before any route exists.
//
// 🔴 WHY (forensic audit 2026-10-04). Nothing validated the environment at start, and several settings
// fail OPEN when missing or mistaken:
//   • `VITEST` (any value — even "false") turns off identity checks in 100+ places: `requireUserMatch`
//     waves every request through, body userIds are trusted. One stray variable in Cloud Run would
//     disable authentication across the platform, silently.
//   • `ALLOW_LOCAL_ACTUATOR=true` re-enables running user code inside the server process.
//   • A missing or short `SECRET_ENCRYPTION_KEY`, missing Cashfree credentials or webhook secret, a
//     missing `ADMIN_PASSWORD` — each degrades one feature quietly, discovered only when it fails.
//
// FATAL is reserved for the settings that turn a security control OFF: the process refuses to start, and
// Cloud Run keeps serving the previous revision — a failed deploy, never an outage. Everything else is a
// loud WARNING naming the variable (never its value), because refusing to boot over a payment key would
// turn a configuration gap into an outage of every other feature.

export interface ConfigVerdict {
  fatal: string[];
  warnings: string[];
}

/** PURE — what is wrong with this environment for production? Names only, never values. */
export function checkProductionConfig(env: NodeJS.ProcessEnv): ConfigVerdict {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if ((env.NODE_ENV || '').toLowerCase() !== 'production') return { fatal, warnings };

  if (typeof env.VITEST === 'string' && env.VITEST !== '') {
    fatal.push('VITEST is set in production — it disables identity checks across the server. Remove it.');
  }
  if (env.ALLOW_LOCAL_ACTUATOR === 'true') {
    warnings.push('ALLOW_LOCAL_ACTUATOR=true in production — user code may run inside the server process.');
  }
  const key = env.SECRET_ENCRYPTION_KEY || env.SECRET_KEY_V1 || '';
  if (!key) warnings.push('SECRET_ENCRYPTION_KEY is not set — the secret vault and signed tickets cannot work.');
  else if (key.length < 32) warnings.push('SECRET_ENCRYPTION_KEY is shorter than 32 characters — use a full-strength key.');
  if (!(env.CASHFREE_APP_ID || env.CASHFREE_CLIENT_ID) || !(env.CASHFREE_SECRET_KEY || env.CASHFREE_CLIENT_SECRET)) {
    warnings.push('Cashfree merchant credentials are not set — recharges cannot be created.');
  }
  if (!env.CASHFREE_WEBHOOK_SECRET) warnings.push('CASHFREE_WEBHOOK_SECRET is not set — the webhook delivery path is refused.');
  if (!env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD is not set — the admin panel is unusable (it fails closed).');
  return { fatal, warnings };
}

/** Run the contract: log every warning, refuse to start on any fatal. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const { fatal, warnings } = checkProductionConfig(env);
  for (const w of warnings) console.warn(`[CONFIG] ⚠️ ${w}`);
  if (fatal.length > 0) {
    for (const f of fatal) console.error(`[CONFIG] ❌ ${f}`);
    throw new Error(`Production configuration refused: ${fatal.join(' ')}`);
  }
}
