// Which asset imports will NOT resolve in a set of files we are about to ship.
//
// ONE definition, because there are now TWO surfaces that ship a snapshot of a user's app to somewhere
// it has to run on its own — the mobile store repo and the Nav App Store — and a second copy of this
// rule would drift the moment either grew a new extension or a new specifier form. Extracted from
// `mobileProjectAssembler.ts` (#2400) the moment the second caller appeared, rather than copied.
//
// 🔒 WHY THIS CAN ANSWER A QUESTION THE PREFLIGHT DELIBERATELY REFUSES TO.
// `mobileShipPreflight` says NOTHING about a missing image, and that is correct: it sees a text-only
// file map (the durable store holds binaries separately), so it would report EVERY image as absent — a
// verdict wrong 100% of the time, which is what once blocked APK builds over `import logo from
// './logo.png'`. Here the complete shipped set is in hand, so "will this import resolve?" is a FACT.
//
// The difference between the two callers is what they DO with the fact, and that difference is
// deliberate: the mobile path NOTES it (the user is shipping their own app to their own repo, and the
// decision is theirs), while the App Store REFUSES (the app is about to run in a stranger's browser,
// where an unresolvable module import means a blank page, not a broken image).
//
// PURE + dependency-free.

/** Import/export specifiers as written in source, including dynamic and side-effect forms. */
const ASSET_IMPORT_RE =
  /(?:from\s*['"]([^'"\n]+)['"]|import\s*\(\s*['"]([^'"\n]+)['"]\s*\)|import\s+['"]([^'"\n]+)['"])/g;

/**
 * Extensions worth reporting. Only files a bundler treats as ASSETS — a missing `./Button` is a code
 * problem other checks already own, and reporting it here would double-report it in different words.
 */
const SHIPPABLE_ASSET_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf|eot)(\?.*)?$/i;

/**
 * Asset imports in `files` that no path in `files` or `extraPaths` can satisfy, sorted.
 *
 * Matching is by BASENAME as well as full path, because a ship may re-root the app (a static app is
 * moved under the web dir). That makes the check deliberately conservative: it would rather stay quiet
 * about a real miss than accuse a file that is present under a different prefix.
 *
 * `http(s):`, `data:` and `blob:` sources need nothing from the shipped set and are ignored.
 */
export function unshippableAssetImports(
  files: Record<string, string> | null | undefined,
  extraPaths: Record<string, unknown> | null | undefined = {},
): string[] {
  const have = new Set<string>();
  for (const p of [...Object.keys(files || {}), ...Object.keys(extraPaths || {})]) {
    have.add(p);
    have.add(p.split('/').pop() || p);
  }
  const missing = new Set<string>();
  for (const content of Object.values(files || {})) {
    if (typeof content !== 'string') continue;
    ASSET_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ASSET_IMPORT_RE.exec(content))) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || /^(https?:|data:|blob:)/i.test(spec)) continue;
      if (!SHIPPABLE_ASSET_EXT.test(spec)) continue;
      const base = spec.split(/[?#]/)[0].split('/').pop() || '';
      if (base && !have.has(base)) missing.add(spec);
    }
  }
  return [...missing].sort();
}
