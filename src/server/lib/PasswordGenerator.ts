// U-4 (verified recipe modules) — secure password hashing (bcryptjs).
//
// Any app with its own email+password login MUST hash passwords with a slow, salted algorithm before
// storing them — never plaintext, never a fast hash like MD5/SHA-256 (those are brute-forced in seconds).
// This is the single most common catastrophic auth mistake. This recipe ships the real thing: hashPassword()
// (bcrypt, cost 12, per-password random salt built in) and verifyPassword() (constant-time compare), plus
// needsRehash() so you can transparently upgrade the cost later. Built on `bcryptjs` — PURE JavaScript, so it
// installs and runs anywhere (no native build step to fail in a sandbox), unlike native bcrypt/argon2. It
// complements generate_auth (which issues the JWT/session AFTER you verify the password here). PURE builder;
// correct and complete — no TODO stubs (the real-features rule). Introduces no env keys. Unit-tested.

export interface PasswordConfig {
  files: Record<string, string>;
  /** bcryptjs is the one dependency (pure-JS bcrypt — no native build to fail in a sandbox). */
  dependency: { name: string; version: string };
  instructions: string;
}

const PASSWORD_SERVER = `import bcrypt from 'bcryptjs';

// The bcrypt work factor. 12 is a good 2020s default (raise it as hardware improves — see needsRehash).
const COST = 12;

// Hash a plaintext password before storing it. bcrypt generates a random per-password salt and embeds it in
// the returned string, so you store ONLY this one value (never the plaintext, never a separate salt column).
// Enforce a max length: bcrypt silently truncates at 72 bytes, and an unbounded input is a DoS vector.
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) throw new Error('Password must be a non-empty string.');
  if (plain.length > 200) throw new Error('Password too long.');
  return bcrypt.hash(plain, COST);
}

// Verify a login attempt against the stored hash. Uses bcrypt's constant-time compare, so it does not leak
// timing information. Returns false (never throws) on a malformed/empty hash, so a corrupt row can't 500 login.
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof hash !== 'string' || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// True if a stored hash was made with a weaker cost than COST — call it on successful login and, if true,
// re-hash the (just-verified) plaintext and save it, transparently upgrading users to stronger hashing.
export function needsRehash(hash: string): boolean {
  const rounds = bcrypt.getRounds(hash);
  return rounds < COST;
}
`;

const INSTRUCTIONS =
  'Password hashing wired at server/lib/password.ts (add the dependency bcryptjs). On signup, store ' +
  'await hashPassword(plain) — NEVER the plaintext. On login, gate access with await verifyPassword(plain, ' +
  'user.passwordHash) and only then issue a session/JWT (pair with generate_auth). bcrypt salts each ' +
  'password and compares in constant time. Call needsRehash(hash) after a successful login to transparently ' +
  'upgrade older hashes. bcryptjs is pure JavaScript, so it installs with no native build step. No API key needed.';

export function generatePasswordIntegration(): PasswordConfig {
  return {
    files: { 'server/lib/password.ts': PASSWORD_SERVER },
    dependency: { name: 'bcryptjs', version: '^2.4.3' },
    instructions: INSTRUCTIONS,
  };
}
