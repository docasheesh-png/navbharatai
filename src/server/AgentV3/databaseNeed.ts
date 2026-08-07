// Does this app actually need a database — and does it have one? (admin 2026-08-06)
//
// WHY AT DEPLOY AND NOT AT PREVIEW. A preview database is a throwaway: the sandbox provisions one, the
// data dies with the sandbox, and asking the user to go and set up an account before they have even
// seen their app is friction with nothing behind it. Publishing is the opposite — the sandbox does not
// come with it, so an app that saves data and has no database becomes a live site where every signup,
// order and booking fails. That is the one moment the question is worth interrupting for, and it is
// worth interrupting for exactly ONCE.
//
// PURE and dependency-free: the caller supplies the files, so every branch is unit-tested without a
// workspace, a sandbox or a network.

/** The packages that only exist in an app that talks to a database. */
const DB_PACKAGES: Array<[RegExp, string]> = [
  [/^@prisma\/client$|^prisma$/, 'Prisma'],
  [/^drizzle-orm$/, 'Drizzle'],
  [/^pg$|^postgres$|^@neondatabase\/serverless$/, 'a PostgreSQL client'],
  [/^mysql2?$/, 'a MySQL client'],
  [/^mongodb$|^mongoose$/, 'MongoDB'],
  [/^sequelize$|^typeorm$|^knex$/, 'an SQL ORM'],
  [/^@supabase\/supabase-js$/, 'Supabase'],
  [/^firebase$|^firebase-admin$/, 'Firebase'],
  [/^@libsql\/client$/, 'libSQL/Turso'],
  [/^@upstash\/redis$|^ioredis$|^redis$/, 'Redis'],
  [/^better-sqlite3$|^sqlite3$/, 'SQLite'],
];

/** Files whose mere existence means the app has a schema to store somewhere. */
const DB_FILES: Array<[RegExp, string]> = [
  [/(^|\/)prisma\/schema\.prisma$/i, 'a Prisma schema'],
  [/(^|\/)drizzle\.config\.[cm]?[jt]s$/i, 'a Drizzle config'],
  [/(^|\/)migrations\/.*\.sql$/i, 'SQL migrations'],
  [/(^|\/)knexfile\.[cm]?[jt]s$/i, 'a Knex config'],
];

/** Env names that only a database-backed app reads. */
const DB_ENV_REFERENCES = /\b(DATABASE_URL|MONGODB_URI|TURSO_DATABASE_URL|UPSTASH_REDIS_REST_URL|POSTGRES_URL)\b/;

export interface DatabaseNeed {
  /** True when the app genuinely stores data somewhere. */
  needed: boolean;
  /**
   * What made us say so, in the user's terms.
   *
   * Carried rather than computed twice because the user is about to be interrupted: "your app needs a
   * database" is an assertion about THEIR app, and being able to say *why* is the difference between a
   * warning they trust and one they click past.
   */
  signals: string[];
}

/**
 * Decide whether an app needs a database, from its own files.
 *
 * Deliberately conservative in ONE direction: we would rather miss an exotic setup than interrupt a
 * static site with a question about a database it does not have. Every signal here is something an app
 * only has when it really does persist data.
 */
export function appNeedsDatabase(files: Record<string, string> | null | undefined): DatabaseNeed {
  const map = files && typeof files === 'object' ? files : {};
  const signals: string[] = [];

  for (const path of Object.keys(map)) {
    for (const [re, label] of DB_FILES) {
      if (re.test(path) && !signals.includes(label)) signals.push(label);
    }
  }

  // package.json is the strongest evidence: a driver is not installed by accident.
  const pkgPath = Object.keys(map).find((p) => /(^|\/)package\.json$/.test(p) && !/node_modules/.test(p));
  if (pkgPath) {
    try {
      const pkg = JSON.parse(map[pkgPath] || '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      for (const dep of deps) {
        for (const [re, label] of DB_PACKAGES) {
          if (re.test(dep) && !signals.includes(label)) signals.push(label);
        }
      }
    } catch {
      // A malformed package.json tells us nothing; the other signals still stand.
    }
  }

  if (signals.length === 0) {
    // Last resort: the app reads a database env var somewhere in its own source.
    const reads = Object.entries(map).some(([path, content]) =>
      !/node_modules|\.lock$|package-lock\.json$/.test(path)
      && /\.(t|j)sx?$|\.env(\.|$)|\.py$/.test(path)
      && DB_ENV_REFERENCES.test(String(content ?? '')));
    if (reads) signals.push('code that reads a database connection');
  }

  return { needed: signals.length > 0, signals };
}

export interface DatabaseReadiness {
  needsDatabase: boolean;
  /** Why we say it needs one — shown to the user, so never empty when needsDatabase is true. */
  signals: string[];
  /** True when the user has a database connected (marker or any real credential). */
  connected: boolean;
  /** The provider label, when one is known. */
  provider: string | null;
  /**
   * True when we could create one right now without leaving the screen — i.e. their Supabase account is
   * already connected. False means the honest action is "connect your own in Settings", NOT an offer we
   * cannot fulfil.
   */
  canProvision: boolean;
}

/**
 * Is this app ready to be published, as far as data is concerned?
 *
 * `connected` accepts EITHER the explicit provider marker or any real credential, because a user who
 * pasted a `DATABASE_URL` into Secrets & API Keys by hand never touched the Database screen and must not be
 * told they have no database.
 */
export function databaseReadiness(input: {
  files: Record<string, string> | null | undefined;
  vaultSecrets: Record<string, string> | null | undefined;
  dbEnvNames: string[];
  providerLabel?: (id: string) => string | null;
  supabaseConnected: boolean;
}): DatabaseReadiness {
  const need = appNeedsDatabase(input.files);
  const secrets = input.vaultSecrets && typeof input.vaultSecrets === 'object' ? input.vaultSecrets : {};
  const marker = String(secrets.ENGINEER_DB_PROVIDER ?? '').trim();
  const hasCredential = input.dbEnvNames.some((n) => String(secrets[n] ?? '').trim() !== '');
  return {
    needsDatabase: need.needed,
    signals: need.signals,
    connected: !!marker || hasCredential,
    provider: marker ? (input.providerLabel?.(marker) ?? marker) : null,
    canProvision: !!input.supabaseConnected,
  };
}
