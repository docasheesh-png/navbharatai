// Merge a user's vault secrets into an app's .env file (admin 2026-07-17).
//
// NavBharatAI Pro v5 guides a user to store an app's required keys in Settings → Secrets & API Keys (never
// in chat). At build time the engine writes those keys into the app's `.env` so the app actually runs
// with real credentials. This module is the PURE, dependency-free merge/serialize logic (the actuator
// file I/O lives in ToolDispatcher).
//
// Rules:
//  - The app's own .env lines are KEPT (comments, blank lines, unrelated vars) — we only add/override
//    the vault keys, so we never clobber config the generator wrote.
//  - The VAULT WINS for any key it defines: a generated placeholder (`API_KEY=your_key_here`) is
//    replaced by the user's real value.
//  - Values are single-line only; a newline/return in a value is stripped so it can never break the
//    file or inject a second variable. Values are written verbatim otherwise (dotenv reads them as-is).

/** True for a valid POSIX env-var name (so a bad key can never inject extra lines). Pure. */
export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** One line's worth of value: collapse CR/LF so a value can never span lines or add a var. Pure. */
function sanitizeValue(v: string): string {
  return String(v ?? '').replace(/[\r\n]+/g, ' ');
}

/** Parse the KEY of an existing `.env` line (KEY=VALUE, optional `export `), else null. Pure. */
function parseEnvKey(line: string): string | null {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return m ? m[1] : null;
}

/**
 * Merge `vault` into `existingEnv`: override any line whose key the vault defines (in place, preserving
 * order + surrounding lines), then append the vault keys that weren't present. Skips invalid names.
 * Idempotent — running it again with the same vault yields the same file. Pure.
 */
export function mergeDotEnv(existingEnv: string, vault: Record<string, string>): string {
  const keys = Object.keys(vault || {}).filter(isValidEnvName);
  if (keys.length === 0) return existingEnv ?? '';
  const remaining = new Set(keys);
  const srcLines = (existingEnv ?? '').split('\n');

  const outLines = srcLines.map((line) => {
    const key = parseEnvKey(line);
    if (key && remaining.has(key)) {
      remaining.delete(key);
      return `${key}=${sanitizeValue(vault[key])}`;
    }
    return line;
  });

  const additions = keys.filter((k) => remaining.has(k)).map((k) => `${k}=${sanitizeValue(vault[k])}`);
  if (additions.length === 0) return outLines.join('\n');

  // Ensure exactly one separating newline before appended vars (no leading blank line on an empty file).
  let base = outLines.join('\n');
  if (base.trim() === '') return additions.join('\n') + '\n';
  if (!base.endsWith('\n')) base += '\n';
  return base + additions.join('\n') + '\n';
}

/** Ensure `.gitignore` covers `.env` so a user's real keys never reach their git repo. Pure. */
export function gitignoreWithEnv(existing: string | null | undefined): string {
  const content = existing ?? '';
  const covered = content.split('\n').some((l) => {
    const t = l.trim();
    return t === '.env' || t === '.env*' || t === '*.env' || t === '.env.*';
  });
  if (covered) return content;
  const prefix = content && !content.endsWith('\n') ? content + '\n' : content;
  return `${prefix}${prefix ? '' : ''}.env\n`;
}

/**
 * Read one variable's value out of a `.env` file's text, or null when it is absent/empty.
 *
 * Needed because the engine must sometimes ASK what the app is currently configured with before
 * changing it — specifically, whether `DATABASE_URL` already points at a database the user owns (see
 * isUserOwnedDatabaseUrl). Reading the file is the right source of truth rather than any one code
 * path's in-memory copy: every dispatcher and sub-agent in a build shares the same `.env`.
 *
 * The LAST definition wins, matching dotenv's own parse (it assigns key by key as it walks the file).
 * Surrounding quotes are stripped, as dotenv does. PURE.
 */
export function dotEnvValue(envContent: string | null | undefined, key: string): string | null {
  if (!isValidEnvName(key)) return null;
  let found: string | null = null;
  for (const line of String(envContent ?? '').split('\n')) {
    if (parseEnvKey(line) !== key) continue;
    const raw = line.slice(line.indexOf('=') + 1).trim();
    const unquoted = /^(["'])(.*)\1$/.exec(raw);
    const value = (unquoted ? unquoted[2] : raw).trim();
    if (value) found = value;
  }
  return found;
}
