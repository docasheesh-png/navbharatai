// AgentV3 — single source of truth for "is this file editable source, or a binary asset?".
//
// This predicate was duplicated (the edit-mode manifest's BINARY_ASSET_RE in systemPrompt.ts) and the
// file COUNTS drifted from it: the import banner reported the durably-saved TEXT files (~165 for the
// Mitrify import — images/lockfiles excluded), while the edit banner reported `listFiles().length`
// (~317 — the same source files PLUS ~150 `attached_assets/*.png|jpeg` the agent can never edit). Two
// numbers for the "same" project read as a bug (autopsy follow-up #2). Centralising the binary check
// here lets every surface count the SAME thing — editable source files — so the numbers agree.
//
// Pure + dependency-free + unit-tested.

/**
 * Binary / non-text-editable asset extensions (images, fonts, media, archives, design binaries,
 * compiled artefacts, local DB files). `.svg` is deliberately NOT here — it is editable text the
 * agent legitimately modifies. Kept in ONE place so the manifest filter and the file counts can
 * never drift apart again.
 */
const BINARY_ASSET_RE =
  /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|icns|woff2?|ttf|otf|eot|mp3|mp4|wav|ogg|webm|mov|avi|mkv|flac|aac|zip|tar|gz|tgz|rar|7z|pdf|psd|ai|sketch|fig|exe|dll|so|dylib|wasm|bin|jar|class|pyc|db|sqlite)$/i;

/** True for a binary / non-text-editable asset (image, font, media, archive, compiled artefact). Pure. */
export function isBinaryAsset(path: string): boolean {
  return typeof path === 'string' && BINARY_ASSET_RE.test(path);
}

/** True for a file the agent can actually read + edit as text (everything that is NOT a binary asset). Pure. */
export function isEditableSourceFile(path: string): boolean {
  return typeof path === 'string' && path.trim().length > 0 && !isBinaryAsset(path);
}

/**
 * Count the EDITABLE SOURCE files in a path list — the honest "how big is this project to work on"
 * number, consistent across the import banner, the edit banner, and any future surface. Binary assets
 * are excluded (the agent never edits them). Pure.
 */
export function countEditableSourceFiles(paths: readonly string[]): number {
  if (!Array.isArray(paths)) return 0;
  let n = 0;
  for (const p of paths) if (isEditableSourceFile(p)) n++;
  return n;
}

/**
 * True when an IMPORT SPECIFIER names a binary asset — `./logo.png`, `@/assets/hero.jpg`,
 * `@assets/IMG_1.png`, `../fonts/Inter.woff2?url`.
 *
 * 🔒 WHY THIS EXISTS, AND WHY IT MUST STAY THE ONLY ANSWER TO THE QUESTION (2026-08-15):
 *
 * The durable workspace store is TEXT ONLY — `saveWorkspaceFiles` keeps `typeof content === 'string'`,
 * so a `.png` is never in the file map that later checks run against. Any check that reads "not in the
 * map" as "does not exist in the app" therefore reports EVERY image as missing, whether it is there or
 * not — a verdict that is wrong 100% of the time and carries no information at all.
 *
 * That is not theoretical. It BLOCKED APK builds: `import logo from './logo.png'` — the most ordinary
 * line in any app with a logo — was reported as "imports './logo.png', but no such file exists in the
 * app" and the ship was refused. A check we cannot perform must say NOTHING, not "missing".
 *
 * `.svg` and `.css` are deliberately NOT covered: they are text, they ARE persisted, so they can be
 * checked honestly and still are. The distinction is exactly `isBinaryAsset`, which is why this reuses
 * it rather than growing a second extension list to drift against.
 */
export function isBinaryAssetSpecifier(spec: string): boolean {
  if (typeof spec !== 'string') return false;
  // Bundlers routinely decorate an asset import: `./logo.png?url`, `./f.woff2#iefix`, `./a.png?w=800`.
  const bare = spec.trim().split(/[?#]/)[0];
  return bare.length > 0 && isBinaryAsset(bare);
}
