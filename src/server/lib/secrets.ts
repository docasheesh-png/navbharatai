import crypto from 'crypto';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { query, collection, where, getDocs, doc, updateDoc, getServerDb as getDb } from './serverDb';

/**
 * Encryption & user-secret helpers.
 *
 * P-SEC.5 — Key rotation. Ciphertext is versioned as `v<N>:<iv>:<ct>`. Multiple key
 * versions can coexist in env (`SECRET_KEY_V1`, `SECRET_KEY_V2`, …, falling back to the
 * legacy `SECRET_ENCRYPTION_KEY` for v1), so a key can be rotated WITHOUT losing access
 * to data encrypted under old keys.
 *
 * BACKWARD-COMPATIBLE: legacy two-part ciphertext (`<iv>:<ct>`) still decrypts byte-for-
 * byte under the v1/legacy key — no migration needed. Secrets upgrade to the latest
 * version lazily on the next write, or in bulk via the admin rotate-keys endpoint.
 */
const LEGACY_FALLBACK = 'navBharatAISecurityLedgerFallbackKey';

/**
 * Exact 32-byte key buffer for AES-256. Pads short keys, and slices to 32 bytes
 * (AES-256 requires EXACTLY 32). Backward-compatible: any working prod key was ≤32
 * chars already (a >32 key would have thrown at encrypt time, so no such data exists),
 * so slicing is a no-op for real data — it only fixes the >32-char dev fallback.
 */
function keyBuf(raw: string): Buffer {
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32));
}

/** Resolve all available key versions from env + the latest (highest) version number.
 *  `usingFallback` is true when v1 fell back to the HARDCODED key (no real key configured) — the
 *  encrypt path refuses this in production (Phase 2.2); decrypt keeps it so legacy data still reads. */
function resolveKeys(): { keys: Record<number, Buffer>; latest: number; usingFallback: boolean } {
  const realLegacy = process.env.SECRET_ENCRYPTION_KEY || process.env.SECRET_KEY_V1;
  const usingFallback = !realLegacy;
  if (usingFallback) {
    console.warn('[SECURITY] SECRET_ENCRYPTION_KEY is not set — using insecure fallback (dev/test only; encryption is refused in production). Set this env var in production.');
  }
  const keys: Record<number, Buffer> = { 1: keyBuf(process.env.SECRET_KEY_V1 || process.env.SECRET_ENCRYPTION_KEY || LEGACY_FALLBACK) };
  let latest = 1;
  for (let v = 2; v <= 16; v++) {
    const k = process.env[`SECRET_KEY_V${v}`];
    if (k) { keys[v] = keyBuf(k); latest = v; }
  }
  return { keys, latest, usingFallback: usingFallback && latest === 1 };
}

/** Current (highest) key version that encryption writes with. */
export function getLatestKeyVersion(): number {
  return resolveKeys().latest;
}

export const encrypt = (text: string): string => {
  const { keys, latest, usingFallback } = resolveKeys();
  // SECURITY Phase 2.2 — NEVER write a NEW secret under the hardcoded fallback key in production: it
  // lives in source, so anyone with the repo could decrypt every stored secret. A misconfigured prod
  // (no SECRET_ENCRYPTION_KEY / SECRET_KEY_V1) must FAIL LOUD here rather than silently persist an
  // attacker-decryptable secret. Dev/test keep the fallback so local runs and unit tests work.
  if (usingFallback && process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to encrypt a secret: SECRET_ENCRYPTION_KEY (or SECRET_KEY_V1) is not configured. Set it in the Cloud Run console before storing user secrets.');
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keys[latest], iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return `v${latest}:${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decrypt = (encryptedText: string): string => {
  try {
    const { keys } = resolveKeys();
    const parts = encryptedText.split(':');
    let key: Buffer, ivHex: string, ctHex: string;
    if (parts.length === 3 && /^v\d+$/.test(parts[0])) {
      const version = parseInt(parts[0].slice(1), 10);
      key = keys[version] || keys[1]; // unknown version → best-effort v1
      ivHex = parts[1]; ctHex = parts[2];
    } else if (parts.length === 2) {
      key = keys[1]; // legacy (pre-versioning) ciphertext
      ivHex = parts[0]; ctHex = parts[1];
    } else {
      return '';
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Decryption failed:', err);
    return '';
  }
};

/**
 * P-SEC.5 — Re-encrypt every stored user secret under the LATEST key version.
 * decrypt() auto-detects each secret's current version, so this safely upgrades
 * legacy + older-version ciphertext to the newest key. Admin-only (see route).
 * Best-effort: a single-doc failure never aborts the run. Returns counts.
 */
export async function rotateAllSecrets(): Promise<{ rotated: number; skipped: number; failed: number; toVersion: number }> {
  const db = getDb() as any;
  const toVersion = getLatestKeyVersion();
  let rotated = 0, skipped = 0, failed = 0;
  if (!db) return { rotated, skipped, failed, toVersion };
  const snap = await getDocs(collection(db, 'user_secrets'));
  for (const d of snap.docs) {
    try {
      const data = d.data();
      if (data?.deleted || !data?.encrypted_secret_value) { skipped++; continue; }
      const plain = decrypt(data.encrypted_secret_value);
      if (plain === '') { failed++; continue; } // undecryptable — leave untouched
      await updateDoc(doc(db, 'user_secrets', d.id), {
        encrypted_secret_value: encrypt(plain),
        key_version: toVersion,
        rotated_at: new Date().toISOString(),
      });
      rotated++;
    } catch (err) {
      failed++;
      console.error('[ROTATE] secret re-encrypt failed:', err);
    }
  }
  console.log(`[ROTATE] secrets rotated=${rotated} skipped=${skipped} failed=${failed} → v${toVersion}`);
  return { rotated, skipped, failed, toVersion };
}

/**
 * Load ALL of a user's own stored vault secrets (decrypted) as a { NAME: value } map, for injecting
 * into the environment of the app THEY build (admin 2026-07-17: NavBharatAI Pro v5 guides the user to
 * store an app's required keys here — never in chat — and the build reads them from the vault).
 *
 * SECURITY — CRITICAL: unlike getSecretValue(), this NEVER falls back to process.env. process.env holds
 * NavBharatAI's OWN platform keys (GEMINI_API_KEY, ANTHROPIC_API_KEY, E2B_API_KEY, …); a name collision
 * (a user naming a secret `GEMINI_API_KEY`) must NOT leak the platform's key into the user's app. Only
 * the user's real `user_secrets` documents are returned. Invalid env-var names and undecryptable/empty
 * values are dropped. Best-effort: any failure returns {} (the build just runs without injected secrets).
 */
export async function loadUserVaultSecrets(userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!userId) return out;
  const db = getDb() as any;
  if (!db) return out;
  try {
    const snap = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', userId)));
    for (const d of snap.docs) {
      const data = d.data() as { secret_name?: string; encrypted_secret_value?: string; deleted?: boolean };
      if (data?.deleted || !data?.secret_name || !data?.encrypted_secret_value) continue;
      const name = String(data.secret_name).trim();
      // A valid POSIX env-var name only — never let a stored name inject extra .env lines.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const value = decrypt(data.encrypted_secret_value);
      if (value === '') continue; // undecryptable or empty — skip
      out[name] = value; // last write wins if duplicate names exist
    }
  } catch (err) {
    console.error('[loadUserVaultSecrets] failed:', err);
  }
  return out;
}

export async function getSecretValue(userId: string, secretName: string): Promise<string | null> {
  // First check process.env:
  if (process.env[secretName]) {
    return process.env[secretName] as string;
  }
  const db = getDb() as any;
  if (!db) return null;
  try {
    const q = query(
      collection(db, 'user_secrets'),
      where('user_id', '==', userId),
      where('secret_name', '==', secretName)
    );
    const snap = await getDocs(q);
    const docData = snap.docs.find((d: any) => !d.data()?.deleted);
    if (docData) {
      const encryptedValue = docData.data().encrypted_secret_value;
      return decrypt(encryptedValue);
    }
  } catch (err) {
    console.error(`Error loading secret ${secretName}:`, err);
  }
  return null;
}
