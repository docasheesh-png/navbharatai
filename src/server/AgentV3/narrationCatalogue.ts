/**
 * THE PLATFORM'S OWN WORDS — one place, in professional English.
 *
 * Every status line the SERVER emits during a build ("🗄️ Provisioning a local PostgreSQL…", "🔧 Added
 * 2 missing import(s)…") is an ID here, with typed parameters, instead of a sentence typed at the call
 * site. That keeps the platform's voice consistent, makes every line greppable and testable, and is
 * what lets the white-label guard prove no vendor name can reach a user.
 *
 * 🔒 ENGLISH ONLY, DELIBERATELY (CLAUDE.md's Language standard; admin re-stated 2026-08-11).
 * NavBharatAI's own text — buttons, labels, errors, and these status lines — is professional English.
 * The SINGLE exception is an AI RESPONSE, which follows the user's language via `LANGUAGE_RULE`.
 *
 * ⚠️ An earlier version of this file carried a Hindi table and a per-build language. That was wrong:
 * a status line is the PLATFORM speaking, not the AI, so translating it made the app speak a language
 * the rule reserves for the model. It was also unmaintainable — being fair to every Indian user would
 * have meant 22 hand-written translations per line. Do not re-introduce it.
 *
 * WHAT STAYS ENGLISH INSIDE THE SENTENCE TOO: code identifiers, file paths, package names, command
 * output and error text are interpolated verbatim. Translating `package.json` or a Prisma relation
 * name would make the message wrong, not friendlier.
 */

/**
 * Every server-emitted narration line, with the exact data it needs. The key is the contract: adding
 * one here forces every language below to answer for it.
 */
export interface NarrationParams {
  /** Vault keys copied into the app's env before the build runs. */
  'secrets.loaded': { count: number };
  /** The user connected their OWN database in Settings, so no sandbox database is created. */
  'db.usingConnected': Record<string, never>;
  /** A throwaway PostgreSQL is being installed inside the build sandbox. */
  'db.provisioning': Record<string, never>;
  /** The sandbox database was created but did not answer a connection test. */
  'db.connectionTestFailed': Record<string, never>;
  /** The sandbox database is live and migrations are about to run. */
  'db.ready': Record<string, never>;
  /** A schema downgrade to SQLite was reverted — PostgreSQL is provisioned and stays. */
  'db.postgresLocked': Record<string, never>;
  /** PostgreSQL had idled out and is being restarted before a database step. */
  'db.asleepRestarting': Record<string, never>;
  /** PostgreSQL disappeared mid-step and is being restarted. */
  'db.wentAwayRestarting': Record<string, never>;
  /** PostgreSQL came back and the failed step was re-run against it. */
  'db.backOnline': Record<string, never>;
  /** PostgreSQL could not be kept alive; the PREVIEW falls back to SQLite (deploy is unaffected). */
  'db.fellBackToSqlite': Record<string, never>;
  /** An incomplete Prisma relation was completed with `prisma format`. */
  'fix.prismaRelation': Record<string, never>;
  /** The database toolkit was missing and was installed. */
  'fix.toolkitInstalled': Record<string, never>;
  /** The database client had not been generated and was generated. */
  'fix.clientGenerated': Record<string, never>;
  /** SQLite has no enums, so the code using them was rewired to plain strings. */
  'fix.enumOnSqlite': { enums: string };
  /** named↔default import mismatches repaired. */
  'fix.importKind': { count: number };
  /** Symbols used but never imported. */
  'fix.missingImports': { count: number };
  /** Imports that pointed at the wrong module. */
  'fix.repointedImports': { count: number };
  /** A duplicate import that would have broken the preview, in one file. */
  'fix.duplicateImport': { file: string };
  /** Duplicate imports removed while a file was being written. */
  'fix.duplicateImports': { count: number; file: string };
  /** Dependencies the app imports but package.json never declared. */
  'fix.missingDeps': { count: number; packages: string };
  /** Known-breaking dependency versions pinned to a stable one. */
  'fix.pinnedDeps': { changed: string };
  /** Framework runtime deps re-added after a written package.json dropped them. */
  'fix.coreDeps': { added: string };
  /** Next.js middleware written somewhere it would never run, moved to the project root. */
  'fix.nextMiddlewareMoved': { from: string; to: string };
}

export type NarrationId = keyof NarrationParams;

/** A complete set of words for one language. Mapped type ⇒ the compiler demands every id. */
type Catalogue = { [K in NarrationId]: (p: NarrationParams[K]) => string };

/** English plural helper — kept local so a language that pluralises differently is free to ignore it. */
const s = (n: number) => (n === 1 ? '' : 's');

/** The SOURCE language. Every string here is the exact sentence the build used to emit. */
const EN: Catalogue = {
  'secrets.loaded': ({ count }) =>
    `🔐 Loaded ${count} of your saved key${s(count)} (Settings → Secrets & API Keys) into the app — no keys ever pasted in chat.`,
  'db.usingConnected': () =>
    '🗄️ Using the database you connected in Settings — your app will read and write your own data, so no temporary sandbox database is needed.',
  'db.provisioning': () =>
    '🗄️ Provisioning a local PostgreSQL in the sandbox so your database can be created and migrated…',
  'db.connectionTestFailed': () =>
    '⚠️ The sandbox database did not pass its connection test — I wrote DATABASE_URL and will keep going; the next database step will retry it.',
  'db.ready': () => '✅ Local database ready — running your migrations against it now.',
  'db.postgresLocked': () =>
    "🔒 Kept your database on PostgreSQL — it's provisioned and ready. A failing migration means the schema needs fixing (a relation or field), not a switch to SQLite. Fixing the schema instead.",
  'db.asleepRestarting': () => '🗄️ The database had gone to sleep — restarting PostgreSQL before your database step…',
  'db.wentAwayRestarting': () => '🗄️ The database went away — restarting PostgreSQL in the sandbox…',
  'db.backOnline': () => '✅ Database is back — re-ran the step against PostgreSQL.',
  'db.fellBackToSqlite': () =>
    "⚠️ NavBharatAI couldn't keep PostgreSQL running in the preview sandbox, so the live preview will use SQLite. Your PostgreSQL setup still applies when you deploy to your own database.",
  'fix.prismaRelation': () =>
    '🔧 The Prisma schema had an incomplete relation — completed it with `prisma format` and re-ran the command successfully.',
  'fix.toolkitInstalled': () => "🔧 The database toolkit wasn't installed yet — installed it and re-ran the step successfully.",
  'fix.clientGenerated': () => '🔧 The database client had not been generated yet — generated it and re-ran the step successfully.',
  'fix.enumOnSqlite': ({ enums }) =>
    `🔧 A database enum wasn't available on SQLite — rewired the code that used it (${enums}) to plain string values and re-ran the step successfully.`,
  'fix.importKind': ({ count }) =>
    `🔧 Auto-fixed ${count} import(s) (named↔default mismatch) so the build isn't blocked by a wrong import kind.`,
  'fix.missingImports': ({ count }) =>
    `🔧 Added ${count} missing import(s) (a shared symbol was used but not imported) so the app doesn't crash at runtime.`,
  'fix.repointedImports': ({ count }) =>
    `🔧 Re-pointed ${count} import(s) at the correct module (the symbol lived in a sibling file) so the build isn't blocked.`,
  'fix.duplicateImport': ({ file }) =>
    `🔧 Removed a duplicate import in \`${file}\` that would have broken the preview ("Duplicate declaration").`,
  'fix.duplicateImports': ({ count, file }) =>
    `🔧 Removed ${count} duplicate import(s) in \`${file}\` that would have broken the preview ("Duplicate declaration").`,
  'fix.missingDeps': ({ count, packages }) =>
    `🔧 Added ${count} missing dependency(ies) to package.json (${packages}) so the app installs and runs.`,
  'fix.pinnedDeps': ({ changed }) =>
    `🔧 Pinned known-breaking dependencies in package.json to their stable version (${changed}) so the install can't pull a version that bricks the build.`,
  'fix.coreDeps': ({ added }) =>
    `🔧 Kept the framework's core dependencies in package.json (${added}) so the dev server can't lose its own runtime.`,
  'fix.nextMiddlewareMoved': ({ from, to }) =>
    `🔧 Moved \`${from}\` to \`${to}\` — Next.js only runs middleware from the project root, so the route guards were silently disabled where it was written.`,
};

/**
 * THE ONE CHOKE POINT. Every server-emitted narration line goes through here, so a language is applied
 * by construction rather than remembered at 157 call sites (the same discipline as `enforceNoClaude`
 * and the provider anonymiser). An unknown language degrades to English rather than throwing — a
 * missing translation must never be able to fail a build.
 */
export function narrationText<K extends NarrationId>(id: K, params: NarrationParams[K]): string {
  return EN[id](params);
}

/** Exposed for the tests that prove every id has a line. */
export const _catalogue = EN;
