/**
 * MISSING IMPORTED ASSETS — catch "your app imports a picture we do not have" BEFORE GitHub.
 *
 * THE REPORT THIS EXISTS FOR (admin, 2026-08-25). A user's APK build failed on the runner with:
 *
 *   [vite:asset] Could not load …/attached_assets/772B17C5-….png
 *     (imported by client/src/pages/login.tsx): ENOENT: no such file or directory
 *
 * The app previewed perfectly in the sandbox, where the image really exists. It failed in CI because
 * the image never reached the pushed repository — `WorkspaceAssetStore.saveWorkspaceAssets` silently
 * DROPS any asset over its Firestore size cap (~900KB, which a phone screenshot passes easily), and
 * nothing recorded that it had. So the ship pushed a repo whose source imports a file that is not in
 * it, and the user paid for a red CI run and an error log they cannot act on to find that out.
 *
 * WHY THE CHECK BELONGS HERE. `mobileSetup` already runs a compile pre-flight for exactly this
 * reason: "A compile error found on the runner costs five minutes, an unreadable remote log, and a
 * repair that can only edit files by committing them. Found HERE it costs seconds." A missing
 * imported asset is the same class of certain-to-fail, and deserves the same treatment.
 *
 * PRECISION OVER RECALL, deliberately. A false positive here BLOCKS a ship that would have worked,
 * which is worse than the failure it prevents. So an import is only reported missing when NO file of
 * that name exists anywhere in the project — not merely when a path does not resolve. That is enough
 * to catch the real case (the file is genuinely absent) while an alias, a odd bundler root or a path
 * this module resolves imperfectly all stay silent.
 *
 * Pure — no I/O, no clock.
 */
import { isBinaryAsset } from './fileClassification';

export interface MissingAsset {
  /** The import specifier as written in the source. */
  specifier: string;
  /** The file that imports it — the user needs to know WHERE to look. */
  importedBy: string;
}

/** Source files worth scanning for asset imports. */
const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/i;

/**
 * Import/require specifiers in one source file. Covers the three forms a bundler resolves:
 * `import x from '…'`, `from '…'` and `require('…')`. Pure.
 */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const text = String(source || '');
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1]);
  }
  return out;
}

/** The last path segment, with any bundler query/hash suffix removed. Pure. */
export function assetBasename(specifier: string): string {
  const clean = String(specifier || '').split('?')[0].split('#')[0];
  return clean.split('/').pop() || '';
}

/**
 * Which assets does this project IMPORT but not contain?
 *
 * `files` is the text-file map (source), `assetPaths` the binary assets we actually hold. An import
 * is reported only when its filename matches nothing in either — see the precision note above.
 */
export function findMissingImportedAssets(
  files: Record<string, string>,
  assetPaths: readonly string[],
): MissingAsset[] {
  const haveNames = new Set<string>();
  for (const p of Object.keys(files || {})) haveNames.add(assetBasename(p).toLowerCase());
  for (const p of assetPaths || []) haveNames.add(assetBasename(p).toLowerCase());

  const missing: MissingAsset[] = [];
  const seen = new Set<string>();

  for (const [path, content] of Object.entries(files || {})) {
    if (!SOURCE_RE.test(path)) continue;
    if (typeof content !== 'string') continue;
    for (const spec of importSpecifiers(content)) {
      // Only binary assets: a missing .ts module is the compile pre-flight's job, not this one.
      if (!isBinaryAsset(spec.split('?')[0].split('#')[0])) continue;
      const name = assetBasename(spec).toLowerCase();
      if (!name || haveNames.has(name)) continue;
      const key = `${path}::${spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push({ specifier: spec, importedBy: path });
    }
  }
  return missing;
}

/**
 * What the user reads. Names the file AND where it is used, because "an asset is missing" sends
 * somebody hunting through their own project — and says plainly that the fix is one message to the
 * builder, not a manual GitHub upload.
 */
export function missingAssetUserMessage(missing: readonly MissingAsset[]): string {
  if (missing.length === 0) return '';
  const shown = missing.slice(0, 5);
  const lines = shown.map((m) => `• ${assetBasename(m.specifier)} — used in ${m.importedBy}`);
  const more = missing.length > shown.length ? `\n…and ${missing.length - shown.length} more.` : '';
  const one = missing.length === 1;
  return (
    `Your app uses ${one ? 'a picture' : 'pictures'} that ${one ? 'is' : 'are'} not saved with the project, so the app store build would fail:\n\n` +
    `${lines.join('\n')}${more}\n\n` +
    `This happens with very large images. Open your app in NavBharatAI and ask it to add ${one ? 'the picture' : 'the pictures'} again ` +
    `(a smaller version works best), then press the app-store button again.`
  );
}
