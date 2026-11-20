// THE IMPORT RULES — one definition, used by every path that turns someone's project into a workspace.
//
// WHY THIS FILE EXISTS (admin-directed "master zip handler", 2026-08-04): the browser is about to
// start reading zips itself, so that it can drop `node_modules`/media/junk BEFORE uploading instead of
// shipping a gigabyte through the server to have it thrown away on arrival. That gives the rules a
// SECOND caller — and a second caller is exactly how this codebase has been bitten before (four drifted
// copies of `safeRelPath`; retired model ids hardcoded in five files). A client-side copy of these
// regexes would drift from the server's within weeks, and the failure mode is silent: the browser keeps
// a file the server would refuse, or drops one the server would keep, and nobody notices until an
// import is mysteriously incomplete.
//
// So the rules MOVE here rather than being duplicated. `ProjectImport.ts` re-exports every name it used
// to own, so its public API is unchanged and no server call site moves. This module is deliberately
// dependency-free and DOM-free so both a Node route and a browser bundle can import it.

/**
 * Dependency/build/tooling folders. Never imported — `npm install` and a build reproduce them.
 *
 * `.local|.claude|.cursor|…` are AI-assistant/tool state directories. They are never part of the
 * running app, and `.local/skills/**` in particular ships COMPLETE app scaffolds — importing them gave
 * one project five React roots and five copies of index.css, which the integrity gate then reported as
 * the user's defects and "repaired" by editing template files the user never wrote (mitrify autopsy
 * 2026-08-04). Dropped at the import boundary so they never enter at all.
 */
export const SKIP_DIR_RE = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|\.cache|\.turbo|\.vercel|\.output|venv|\.venv|__pycache__|\.pytest_cache|\.mypy_cache|target|\.gradle|Pods|DerivedData|\.expo|\.dart_tool|vendor|\.idea|\.local|\.claude|\.cursor|\.windsurf|\.continue|\.codeium|\.aider)(\/|$)/;

/** OS/editor junk files that ride along in almost every user-made zip. */
export const JUNK_FILE_RE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

/** Live secrets are excluded; ".env.example"/".env.sample" templates are safe and useful to keep. */
export const SECRET_FILE_RE = /(^|\/)\.env(\.local|\.production|\.development|\.staging)?$|\.(pem|key|p12|pfx|keystore|jks)$/i;

/** Files with no useful text form. Small images/fonts/3D models are rescued separately via `assetMimeFor`.
 * glb/fbx (2026-11-20): a three.js app's public/models/car.glb used to be read as TEXT and arrive corrupted. */
export const BINARY_EXT_RE = /\.(glb|fbx|png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|mp3|mp4|mov|avi|mkv|webm|wav|ogg|flac|zip|gz|tgz|bz2|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|eot|psd|ai|sketch|db|sqlite3?)$/i;

/**
 * Small binary ASSETS worth keeping (an imported app's logo/favicon/icons/fonts) so the preview isn't
 * full of broken images. Everything ELSE matching BINARY_EXT_RE (video/audio/archives/binaries) stays
 * dropped — too large and never needed to boot a preview. ext → MIME for a data URI.
 */
const ASSET_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  // A 3D app's own models are kept byte-exact like its images (FBX stays dropped: no browser loads it).
  glb: 'model/gltf-binary',
  // A .gltf model's geometry lives in its .bin: dropping it broke every glTF app that was imported.
  bin: 'application/octet-stream',
};

/** The asset MIME for a path, or null when it is not a keepable small-asset type. Pure. */
export function assetMimeFor(path: string): string | null {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ASSET_MIME[ext] ?? null;
}

/** Normalize a zip entry path; null → unsafe (zip-slip / absolute / empty). Pure. */
export function safeImportPath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((seg) => seg === '..' || seg === '')) return null;
  return parts.join('/');
}

/**
 * Why a single entry is not imported, or null to keep it. The ONE decision every import path asks, so
 * the browser's pre-upload filter and the server's extractor can never disagree about a file.
 *
 * Order matters and is deliberate: safety first, then the categories a user should be reassured about
 * (rebuildable folders, junk, secrets), then real content decisions. It matches the order the server's
 * streaming scanner already applies, so the same archive yields the same verdicts either side.
 */
export type ImportDropReason = 'unsafe' | 'dir' | 'junk' | 'secret' | 'binary';

export function importDropReason(rawPath: string): { reason: ImportDropReason; path: string | null } | null {
  const safe = safeImportPath(rawPath);
  if (!safe) return { reason: 'unsafe', path: null };
  if (SKIP_DIR_RE.test(safe)) return { reason: 'dir', path: safe };
  if (JUNK_FILE_RE.test(safe)) return { reason: 'junk', path: safe };
  if (SECRET_FILE_RE.test(safe)) return { reason: 'secret', path: safe };
  // A binary is only a DROP when it is not a small keepable asset — the caller still applies the size
  // budget, because a 40 MB PNG is a keepable TYPE but not a keepable FILE.
  if (BINARY_EXT_RE.test(safe) && !assetMimeFor(safe)) return { reason: 'binary', path: safe };
  return null;
}

/**
 * THE SIZE LIMITS OF AN IMPORT — one definition (single-file game autopsy, 2026-11-14).
 *
 * 🔴 WHAT WAS WRONG. The same idea — "the largest text file we keep" — was written down five times, and the copies
 * disagreed: the browser filter and the server's zip extractor said 900 KB, the `/api/agentv3/import-files` route said
 * 5 MiB, and the durable store silently dropped anything over 900 KB whatever either of them had accepted. A 5.4 MB
 * single-file game was therefore refused by one door, accepted by another, and — had it got through — would have sat in
 * the live sandbox and vanished on the first recycle, with every layer reporting success. A limit that is not one number
 * is not a limit; it is a place where files disappear.
 *
 * Every importer, the write route, the durable stores and the AI edit tool take their numbers from here. The census in
 * `tests/theImportLimitsAreOneNumber.test.ts` fails if a second literal appears.
 */
export const IMPORT_LIMITS = Object.freeze({
  /** The largest TEXT file kept. The durable store holds one file per Firestore document (1 MB), so this is the true ceiling. */
  maxTextFileBytes: 900 * 1024,
  /** Text kept across one import. */
  maxTotalTextBytes: 80 * 1024 * 1024,
  maxFiles: 16_000,
  /** A small asset kept INLINE in a store document (a logo, an icon, a font): 640 KB raw is ~853 KB as base64, under the document cap. */
  maxInlineAssetBytes: 640 * 1024,
  maxInlineAssets: 200,
  maxInlineAssetTotalBytes: 30 * 1024 * 1024,
  /** Larger images that are shown in the LIVE sandbox only (not persisted). */
  maxSandboxAssetBytes: 5 * 1024 * 1024,
  maxSandboxAssetTotalBytes: 50 * 1024 * 1024,
  /** One media file taken out of an HTML page. The workspace asset store keeps files over the document cap in Cloud Storage up to this size. */
  maxEmbeddedMediaBytes: 12 * 1024 * 1024,
  /** All media taken out of one import. */
  maxEmbeddedMediaTotalBytes: 60 * 1024 * 1024,
  /** The largest HTML page we will READ in order to move its embedded media out (the code that remains must still fit maxTextFileBytes). */
  maxHtmlSourceBytes: 24 * 1024 * 1024,
  /** A lockfile is written to the sandbox even when over the durable cap. */
  maxLockfileBytes: 3 * 1024 * 1024,
  /** Zip-bomb guards. */
  maxZipEntries: 60_000,
  maxDecompressedBytes: 300 * 1024 * 1024,
  /** A Firestore document is 1 MB; the store refuses anything near it. */
  maxStoreDocBytes: 900 * 1024,
});
