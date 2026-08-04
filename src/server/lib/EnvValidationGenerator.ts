// U-4 (verified recipe modules) — fail-fast environment-variable validator generator.
//
// A classic production failure: an app boots fine, then crashes deep inside a request with a cryptic
// `undefined` because a required secret (DATABASE_URL, STRIPE_SECRET_KEY, a provider API key) was never set.
// This generator adds a real startup guard — validateEnv(required) checks every required env var is present
// and non-empty BEFORE the server starts listening, and throws ONE clear error naming exactly which vars are
// missing (and to add them to .env). So a misconfigured deploy fails immediately with an actionable message
// instead of a random 500 later. Unlike `generate_env_example` (which only DOCUMENTS the keys), this ENFORCES
// them at boot. It introduces no new env keys and writes no .env.example, so it never overwrites one.
//
// PURE builder; the generated code is correct and complete — no TODO stubs (the real-features rule). The
// required-key list is baked in from what the app actually needs. Unit-tested.

export interface EnvValidationConfig {
  files: Record<string, string>;
  /** The required keys baked into the generated guard (for reporting; it does not ADD these keys). */
  validatedKeys: string[];
  /** No provider/dependency — plain process.env, framework-agnostic Node. */
  dependency?: { name: string; version: string };
  instructions: string;
}

// A valid POSIX-style env var name (so a bad key can't produce broken generated code).
function isValidEnvName(k: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
}

function envModule(keys: string[]): string {
  const list = keys.map((k) => `  '${k}',`).join('\n');
  return `// Fail-fast environment validation. Call requireEnv() ONCE at startup — before the server starts
// listening — so a missing secret crashes the app immediately with a clear message, instead of a cryptic
// undefined error deep inside a request later.

// Throws a single clear error naming every required var that is unset or empty.
export function validateEnv(required: string[]): void {
  const missing = required.filter((k) => {
    const v = process.env[k];
    return v === undefined || v === '';
  });
  if (missing.length > 0) {
    const plural = missing.length > 1;
    throw new Error(
      'Missing required environment variable' + (plural ? 's' : '') + ': ' + missing.join(', ') +
        '. Add ' + (plural ? 'them' : 'it') + ' to your .env (see .env.example) and restart.',
    );
  }
}

// The environment variables THIS app needs to run. Keep this list in sync with .env.example.
const REQUIRED_ENV = [
${list}
];

// Call once at startup (e.g. the first line of your server entry, before app.listen).
export function requireEnv(): void {
  validateEnv(REQUIRED_ENV);
}
`;
}

const EMPTY_MODULE = `// Fail-fast environment validation. Call requireEnv() ONCE at startup — before the server starts listening
// — so a missing secret crashes the app immediately with a clear message, instead of a cryptic undefined
// error deep inside a request later.

export function validateEnv(required: string[]): void {
  const missing = required.filter((k) => {
    const v = process.env[k];
    return v === undefined || v === '';
  });
  if (missing.length > 0) {
    const plural = missing.length > 1;
    throw new Error(
      'Missing required environment variable' + (plural ? 's' : '') + ': ' + missing.join(', ') +
        '. Add ' + (plural ? 'them' : 'it') + ' to your .env (see .env.example) and restart.',
    );
  }
}

// Add the env vars THIS app needs to run (e.g. 'DATABASE_URL', 'STRIPE_SECRET_KEY'), then call requireEnv()
// once at startup. Keep this list in sync with .env.example.
const REQUIRED_ENV: string[] = [];

export function requireEnv(): void {
  validateEnv(REQUIRED_ENV);
}
`;

export function generateEnvValidation(keys: string[]): EnvValidationConfig {
  // Only accept well-formed, de-duplicated env names — a malformed key never reaches the generated code.
  const clean = Array.from(new Set(keys.filter((k) => typeof k === 'string' && isValidEnvName(k))));
  const module = clean.length > 0 ? envModule(clean) : EMPTY_MODULE;
  const instructions =
    clean.length > 0
      ? 'Fail-fast env validation wired for: ' + clean.join(', ') + '. Import requireEnv from ' +
        "server/lib/env.ts and call it ONCE at startup (before app.listen) — a missing var then crashes the " +
        'app at boot with a clear message instead of a random 500 mid-request. Keep REQUIRED_ENV in sync with ' +
        '.env.example.'
      : 'Fail-fast env validation helper created at server/lib/env.ts. Add your required var names to the ' +
        'REQUIRED_ENV list and call requireEnv() once at startup (before app.listen) so a missing var crashes ' +
        'the app at boot with a clear message instead of a random 500 mid-request.';
  return { files: { 'server/lib/env.ts': module }, validatedKeys: clean, instructions };
}
