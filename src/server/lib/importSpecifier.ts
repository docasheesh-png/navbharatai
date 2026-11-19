/**
 * THE FILE AN IMPORT SPECIFIER NAMES, without the bundler's query or hash (BR2001, 2026-11-19).
 *
 * Vite (and webpack) let an import carry a query that changes how the file is loaded:
 * `./start.svg?react` (svgr), `./words.txt?raw`, `./logo.png?url`, `./worker.ts?worker`, `./a.css?inline`.
 * The file on disk is `./start.svg`. Our own resolvers appended `.tsx` / `/index.ts` to the WHOLE specifier,
 * so `start.svg?react` never matched `start.svg`, and the build was told, again and again, to "CREATE"
 * a file that already existed. On BR2001 the builder had written every icon, installed the plugin and run
 * `npm run build` clean, and it still spent its last six minutes and both resumes arguing with that false
 * finding until the 25-minute cap stopped the build.
 *
 * `isBinaryAssetSpecifier` already stripped `?` and `#` for exactly this reason. The other resolvers did
 * not. Every resolver now asks this one function. PURE.
 */
export function importSpecifierPath(spec: string): string {
  if (typeof spec !== 'string') return '';
  return spec.trim().split(/[?#]/)[0];
}

/** The `?…` / `#…` decoration of a specifier ('' when it has none), kept so a rewritten path keeps it. PURE. */
export function importSpecifierSuffix(spec: string): string {
  if (typeof spec !== 'string') return '';
  const s = spec.trim();
  const at = s.search(/[?#]/);
  return at < 0 ? '' : s.slice(at);
}
