// PROVE A SAVED CREDENTIAL BEFORE THE APP IS BUILT AROUND IT.
//
// WHY THIS EXISTS (admin finding 3, 2026-08-06: "navbharatai ne credentials user se bina puche ... use
// kiye ... credentials galat to hai hi"). The vault → app pipe injects every key a user saved in
// Settings → Secrets & API Keys into the `.env` of the app being built, and then announces, after the fact:
//
//     🔐 Loaded 3 of your saved keys (Settings → Secrets & API Keys) into the app
//
// That sentence is true about the COPY and silent about the TRUTH. A stale, mistyped or long-dead
// connection string is copied in with exactly the same confident line as a working one, and the app is
// then built, migrated and previewed on top of it. The user finds out minutes later, from an
// ECONNREFUSED inside a preview that will not load, with nothing connecting the failure back to the
// screen where they saved the value.
//
// The root cause is not the copy — the user really did ask for those keys. It is that a credential was
// TRUSTED WITHOUT EVER BEING TESTED, in the one place where testing it is cheap and the consequence of
// not testing it is an entire wasted build. So: before the build leans on it, the one class of secret we
// can genuinely verify — a database connection string — gets a real `SELECT 1`. Everything else is
// reported honestly as unverified rather than implied to be good.
//
// DESIGN RULES THIS FILE KEEPS
//   * It NEVER withholds a key the user saved. They chose it; silently dropping it would be a second,
//     quieter version of the same bug. It injects, then tells the truth about what it found.
//   * It never invents a verdict. A key we cannot check is `unchecked`, not `ok` — those are different
//     facts and the narration keeps them different.
//   * It is bounded. At most MAX_CHECKS connections, run in parallel, under one overall deadline, so a
//     hanging database costs the build seconds rather than minutes.
//   * White-label law: every user-facing string here names NavBharatAI's own screens and the user's own
//     database. No vendor names, no driver text — the driver's own message can carry table names and is
//     kept for the admin report only.

import { isPostgresUrl, runPostgresQuery } from '../lib/postgresQuery';

/** How many connection strings we are willing to open on one build. */
export const MAX_CHECKS = 2;
/** The whole preflight, however many checks it runs, may not cost the build more than this. */
export const PREFLIGHT_BUDGET_MS = 12_000;

export type SecretStatus =
  /** Connected and answered a query — this credential genuinely works right now. */
  | 'ok'
  /** Reached a decision that it does NOT work: refused, unreachable, or no such database. */
  | 'broken'
  /** Shaped like a connection string but is not one — it could never have worked. */
  | 'malformed'
  /** An obvious fill-in-me value that was saved by accident. */
  | 'placeholder'
  /** A real secret we have no honest way to test (an API key — testing it would spend the user's money). */
  | 'unchecked';

export interface SecretVerdict {
  name: string;
  status: SecretStatus;
  /** Written for the USER: names a screen they can act on. Never driver text. */
  message: string;
  /** The real error, for server logs and the admin build report only. */
  detail?: string;
}

/**
 * Values that are plainly not credentials — the ones people leave behind after copying a README.
 *
 * Deliberately narrow. A false positive here would tell someone their WORKING key is a placeholder,
 * which is worse than saying nothing, so this matches only shapes that cannot be a real secret: the
 * angle-bracket form, the word-boundary fill-ins, and runs of a single repeated character. PURE.
 */
export function looksLikePlaceholder(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false; // an empty value is not a placeholder; it is simply absent
  if (/^<.*>$/.test(v)) return true;                                   // <your-key-here>
  // The SEPARATOR is what makes this safe: `your-api-key` is a fill-in, `mysecretpassword` is somebody's
  // actual password and must never be called a placeholder.
  if (/^(?:your|my)[-_ ][a-z0-9_ -]*(?:key|token|secret|password|url|id|here)$/i.test(v)) return true;
  if (/^(?:changeme|change_me|todo|tbd|placeholder|example|dummy|fake|xxx+|yyy+|zzz+|\.\.\.)$/i.test(v)) return true;
  if (/^(.)\1{5,}$/.test(v)) return true;                              // aaaaaaaa
  return false;
}

/** True for a host only the sandbox itself can reach — never this server. PURE. */
export function isLoopbackUrl(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = /@([^/:?#]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
  }
  host = host.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/** True for a name whose value is supposed to be a URL — the only names we can judge structurally. PURE. */
export function isUrlShapedName(name: string): boolean {
  return /(?:_URL|_URI|_ENDPOINT|_DSN)$/i.test(name) || /^DATABASE_URL$/i.test(name);
}

/**
 * What can be said about one secret WITHOUT opening a connection.
 *
 * `checkable` is the only outcome that costs anything later, and it is deliberately the narrowest: a
 * Postgres URL, which is the one transport this codebase can actually open. Everything else that is not
 * demonstrably wrong is `unchecked` — an honest "we did not test this", never an implied pass. PURE.
 */
export function classifySecretShape(name: string, value: string): 'placeholder' | 'malformed' | 'checkable' | 'unchecked' {
  const v = String(value ?? '').trim();
  if (!v) return 'unchecked';                       // absent, not wrong
  if (looksLikePlaceholder(v)) return 'placeholder';
  // A loopback address is reachable only from INSIDE the sandbox that owns it. Probing it from the
  // server would fail for a reason that has nothing to do with the user's credential, and reporting
  // that as "your database is broken" would be a confident lie about our own network topology.
  if (isPostgresUrl(v) && !isLoopbackUrl(v)) return 'checkable';
  if (isPostgresUrl(v)) return 'unchecked';
  if (isUrlShapedName(name)) {
    try {
      const u = new URL(v);
      if (!u.protocol || !u.host) return 'malformed';
    } catch {
      return 'malformed';
    }
  }
  return 'unchecked';
}

/** The connection strings this build is willing to open, in a stable order, bounded by MAX_CHECKS. PURE. */
export function checkableSecrets(secrets: Record<string, string>): string[] {
  const names = Object.keys(secrets || {})
    .filter((n) => classifySecretShape(n, secrets[n]) === 'checkable')
    .sort((a, b) => {
      // DATABASE_URL first: it is the one the app's own code almost certainly reads.
      if (/^DATABASE_URL$/i.test(a) !== /^DATABASE_URL$/i.test(b)) return /^DATABASE_URL$/i.test(a) ? -1 : 1;
      return a.localeCompare(b);
    });
  return names.slice(0, MAX_CHECKS);
}

/** Opens one connection and runs the cheapest possible statement. Injected so tests never need a database. */
export type ConnectionProbe = (url: string) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;

export const realProbe: ConnectionProbe = async (url) => {
  const r = await runPostgresQuery(url, 'SELECT 1');
  if (r.ok) return { ok: true };
  return { ok: false, message: r.message, detail: r.detail };
};

/**
 * Every verdict for this build's injected secrets.
 *
 * Never throws and never rejects: a preflight that fails is a preflight that says `unchecked`, because a
 * bug in our own verification must not be able to stop a build or, worse, condemn a working credential.
 */
export async function verifyInjectedSecrets(
  secrets: Record<string, string>,
  probe: ConnectionProbe = realProbe,
  budgetMs = PREFLIGHT_BUDGET_MS,
): Promise<SecretVerdict[]> {
  const entries = Object.entries(secrets || {});
  if (entries.length === 0) return [];

  const toCheck = new Set(checkableSecrets(secrets));
  const verdicts: SecretVerdict[] = [];

  for (const [name, value] of entries) {
    if (toCheck.has(name)) continue; // decided below, by a real connection
    const shape = classifySecretShape(name, value);
    if (shape === 'placeholder') {
      verdicts.push({ name, status: 'placeholder', message: `${name} looks like an example value rather than a real one. Replace it in Settings → Secrets & API Keys.` });
    } else if (shape === 'malformed') {
      verdicts.push({ name, status: 'malformed', message: `${name} is not a valid address, so nothing can connect with it. Re-copy it in Settings → Secrets & API Keys.` });
    } else {
      verdicts.push({ name, status: 'unchecked', message: `${name} was loaded as you saved it.` });
    }
  }

  if (toCheck.size > 0) {
    // One deadline for the whole preflight. A database that never answers costs the build this much and
    // no more; the keys are already written either way, so a timeout degrades to "we could not tell".
    const deadline = new Promise<'timeout'>((resolve) => {
      const t = setTimeout(() => resolve('timeout'), budgetMs);
      if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
    });
    const checks = Array.from(toCheck).map(async (name): Promise<SecretVerdict> => {
      try {
        const r = await probe(secrets[name]);
        if (r.ok) return { name, status: 'ok', message: `${name} connected successfully.` };
        return { name, status: 'broken', message: r.message, detail: r.detail };
      } catch (e) {
        // Our own failure, not theirs — say so rather than blaming their credential.
        return { name, status: 'unchecked', message: `${name} could not be tested just now.`, detail: String(e).slice(0, 300) };
      }
    });
    const settled = await Promise.race([Promise.all(checks), deadline]);
    if (settled === 'timeout') {
      for (const name of toCheck) {
        verdicts.push({ name, status: 'unchecked', message: `${name} could not be tested in time — the app was built with it as you saved it.` });
      }
    } else {
      verdicts.push(...settled);
    }
  }

  // Stable order so the narration and the report read the same way every run.
  return verdicts.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the user is told, in one or two lines.
 *
 * The old line said only how many keys were copied. This one separates the three facts that were being
 * blurred into one: what was PROVEN to work, what is KNOWN to be broken, and what we simply could not
 * test. A build that is about to fail on a dead database now says so at the start, next to the screen
 * that fixes it, instead of surfacing as an unexplained preview failure ten minutes later. PURE.
 */
export function preflightNarration(verdicts: SecretVerdict[]): { loaded: string; problems: string[] } {
  const total = verdicts.length;
  const ok = verdicts.filter((v) => v.status === 'ok');
  const bad = verdicts.filter((v) => v.status === 'broken' || v.status === 'malformed' || v.status === 'placeholder');

  const proven = ok.length > 0 ? ` — ${ok.length} of them tested and working` : '';
  const loaded = `🔐 Loaded ${total} of your saved key${total === 1 ? '' : 's'} (Settings → Secrets & API Keys) into the app${proven}. No keys were ever pasted in chat.`;

  const problems = bad.map((v) => {
    const consequence = /^DATABASE_URL$/i.test(v.name) || v.status === 'broken'
      ? ' Your app will not be able to save or read data until this is fixed.'
      : '';
    return `⚠️ ${v.message}${consequence}`;
  });
  return { loaded, problems };
}
