/**
 * THE PLATFORM'S OWN WORDS, IN THE USER'S LANGUAGE (ROADMAP item 6, half 1).
 *
 * ROOT CAUSE THIS CLOSES: `LANGUAGE_RULE` makes the MODEL mirror the user's language, but the build
 * feed also carries lines OUR SERVER writes — "🗄️ Provisioning a local PostgreSQL…", "🔧 Added 2
 * missing import(s)…". Those never pass through a model, so no prompt rule can translate them, and a
 * Hindi user reads Hindi from the AI and English from the platform in one scrolling feed.
 *
 * THE FIX IS A CLASS FIX, NOT A STRING FIX (fourth absolute rule, step 2): every such line becomes an
 * ID with typed parameters, and each language supplies the whole set. Call sites stop holding English
 * sentences at all — they hold an id — so a NEW narration line cannot be born untranslatable.
 *
 * 🔒 COMPLETENESS IS ENFORCED BY THE COMPILER, NOT BY DISCIPLINE. `Catalogue` is a mapped type over
 * every `NarrationId`, so a language table missing one line fails `tsc` — it is impossible to ship a
 * half-translated language, and impossible to add an id without translating it everywhere. This is
 * what keeps the two honest states ("fully working" / "not built yet") true per-language: a language
 * either speaks every line or it is not in the list at all.
 *
 * WHAT STAYS IN ENGLISH ON PURPOSE: code identifiers, file paths, package names, command output and
 * error text are interpolated verbatim in every language. Translating `package.json` or a Prisma
 * relation name would make the message wrong, not friendlier.
 */

import type { NarrationLanguage } from '../lib/narrationLanguage';

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
 * Hindi. Written to be read by a NON-TECHNICAL user, which is who this is for — the sentence explains
 * what happened and why it is fine, in the same tone the English line uses. Technical nouns that name
 * a real thing on screen or on disk (PostgreSQL, SQLite, package.json, DATABASE_URL, Settings paths)
 * stay in English: translating them would break the user's ability to find or search for them.
 */
const HI: Catalogue = {
  'secrets.loaded': ({ count }) =>
    `🔐 आपकी सेव की हुई ${count} key (Settings → Secrets & API Keys) ऐप में लगा दी गई हैं — कोई भी key कभी चैट में नहीं डाली जाती।`,
  'db.usingConnected': () =>
    '🗄️ जो database आपने Settings में जोड़ा है वही इस्तेमाल हो रहा है — आपका ऐप आपका अपना डेटा पढ़ेगा और लिखेगा, इसलिए कोई अस्थायी sandbox database बनाने की ज़रूरत नहीं है।',
  'db.provisioning': () =>
    '🗄️ sandbox में एक local PostgreSQL तैयार किया जा रहा है ताकि आपका database बन सके और migration चल सके…',
  'db.connectionTestFailed': () =>
    '⚠️ sandbox का database अपना connection test पास नहीं कर पाया — DATABASE_URL लिख दिया गया है और काम आगे बढ़ रहा है; अगला database स्टेप इसे दोबारा आज़माएगा।',
  'db.ready': () => '✅ Local database तैयार है — अब आपके migration इसी पर चलाए जा रहे हैं।',
  'db.postgresLocked': () =>
    '🔒 आपका database PostgreSQL पर ही रखा गया है — वह तैयार है। Migration फेल होने का मतलब schema ठीक करना है (कोई relation या field), SQLite पर जाना नहीं। इसलिए schema ही ठीक किया जा रहा है।',
  'db.asleepRestarting': () => '🗄️ database सो गया था — आपके database स्टेप से पहले PostgreSQL दोबारा चालू किया जा रहा है…',
  'db.wentAwayRestarting': () => '🗄️ database बंद हो गया था — sandbox में PostgreSQL दोबारा चालू किया जा रहा है…',
  'db.backOnline': () => '✅ database वापस आ गया — वह स्टेप PostgreSQL पर दोबारा चला दिया गया।',
  'db.fellBackToSqlite': () =>
    '⚠️ NavBharatAI preview sandbox में PostgreSQL को चालू नहीं रख पाया, इसलिए live preview SQLite पर चलेगा। जब आप अपने खुद के database पर deploy करेंगे, तब आपकी PostgreSQL सेटिंग ही लागू होगी।',
  'fix.prismaRelation': () =>
    '🔧 Prisma schema में एक relation अधूरा था — उसे `prisma format` से पूरा करके command दोबारा सफलतापूर्वक चला दी गई।',
  'fix.toolkitInstalled': () => '🔧 database toolkit अभी install नहीं था — उसे install करके स्टेप दोबारा सफलतापूर्वक चला दिया गया।',
  'fix.clientGenerated': () => '🔧 database client अभी generate नहीं हुआ था — उसे generate करके स्टेप दोबारा सफलतापूर्वक चला दिया गया।',
  'fix.enumOnSqlite': ({ enums }) =>
    `🔧 एक database enum SQLite पर उपलब्ध नहीं था — उसे इस्तेमाल करने वाले कोड (${enums}) को सीधे string values पर बदलकर स्टेप दोबारा सफलतापूर्वक चला दिया गया।`,
  'fix.importKind': ({ count }) =>
    `🔧 ${count} import अपने आप ठीक किए गए (named↔default का मेल नहीं बैठ रहा था) ताकि गलत import की वजह से build न रुके।`,
  'fix.missingImports': ({ count }) =>
    `🔧 ${count} छूटे हुए import जोड़े गए (एक साझा symbol इस्तेमाल हो रहा था पर import नहीं था) ताकि ऐप चलते-चलते क्रैश न हो।`,
  'fix.repointedImports': ({ count }) =>
    `🔧 ${count} import सही module पर लगा दिए गए (वह symbol बगल की फ़ाइल में था) ताकि build न रुके।`,
  'fix.duplicateImport': ({ file }) =>
    `🔧 \`${file}\` में एक दोहरा import हटा दिया गया, जो preview को तोड़ देता ("Duplicate declaration")।`,
  'fix.duplicateImports': ({ count, file }) =>
    `🔧 \`${file}\` में ${count} दोहरे import हटा दिए गए, जो preview को तोड़ देते ("Duplicate declaration")।`,
  'fix.missingDeps': ({ count, packages }) =>
    `🔧 package.json में ${count} छूटी हुई dependency जोड़ी गईं (${packages}) ताकि ऐप install होकर चल सके।`,
  'fix.pinnedDeps': ({ changed }) =>
    `🔧 package.json में जिन dependencies के नए version build तोड़ने के लिए जाने जाते हैं, उन्हें स्थिर version पर pin कर दिया गया (${changed}) ताकि install कोई ऐसा version न उठा ले।`,
  'fix.coreDeps': ({ added }) =>
    `🔧 package.json में framework की अपनी ज़रूरी dependencies बनी रहीं (${added}) ताकि dev server अपना ही runtime न खो दे।`,
  'fix.nextMiddlewareMoved': ({ from, to }) =>
    `🔧 \`${from}\` को \`${to}\` पर ले जाया गया — Next.js middleware सिर्फ़ project root से चलाता है, इसलिए जहाँ वह लिखा था वहाँ route guards चुपचाप बंद पड़े थे।`,
};

const CATALOGUES: Record<NarrationLanguage, Catalogue> = { en: EN, hi: HI };

/**
 * THE ONE CHOKE POINT. Every server-emitted narration line goes through here, so a language is applied
 * by construction rather than remembered at 157 call sites (the same discipline as `enforceNoClaude`
 * and the provider anonymiser). An unknown language degrades to English rather than throwing — a
 * missing translation must never be able to fail a build.
 */
export function narrationText<K extends NarrationId>(lang: NarrationLanguage, id: K, params: NarrationParams[K]): string {
  const catalogue = CATALOGUES[lang] ?? EN;
  const render = (catalogue[id] ?? EN[id]) as (p: NarrationParams[K]) => string;
  try {
    return render(params);
  } catch {
    return EN[id](params); // a broken translation falls back to the source, never to nothing
  }
}

/** Exposed for the tests that prove every language answers every id. */
export const _catalogues = CATALOGUES;
