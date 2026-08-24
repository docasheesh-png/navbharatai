import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';

/**
 * 🔒 EVERY RUNTIME DEPENDENCY MUST ACTUALLY BE IMPORTED.
 *
 * #2633 removed `lighthouse` and `cheerio` from `dependencies`: neither was imported anywhere, and
 * together they were **114 MB** of the production install — the image Cloud Run pulls on every cold
 * start, and the surface Trivy scans for CVEs we then have to answer for.
 *
 * `lighthouse` is the instructive one. The word appears in the repo twice — a comment, and
 * `data.lighthouseResult` in routes/telemetry.ts, which is the JSON shape Google's PageSpeed Insights
 * REST API returns from an https fetch. A grep for the NAME says "used". Only a check for a real
 * IMPORT says the truth, which is what this does.
 */

const ROOT = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (CODE.includes(extname(rel))) out.push(rel);
  }
  return out;
}

/** Package names imported anywhere in the repo, scope-aware (`@scope/name`, then bare `name`). */
function importedPackages(): Set<string> {
  const files = ['server.ts', 'vite.config.ts', 'vitest.config.ts', 'capacitor.config.ts']
    .filter((f) => { try { statSync(join(ROOT, f)); return true; } catch { return false; } })
    .concat(...['src', 'scripts', 'tests'].map((d) => walk(d)));
  const found = new Set<string>();
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'".][^'"]*)['"]/g;
  for (const f of files) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(re)) {
      const parts = m[1].split('/');
      found.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  return found;
}

/**
 * Runtime deps with no import, kept on purpose. Anything NOT listed here and not imported is a
 * package we pay to ship and never load.
 */
const ALLOWED_UNIMPORTED = new Set<string>([
  // Loaded by the framework/toolchain rather than by our source. Keep this list short and reasoned.
]);

describe('dependencies — nothing in the production install that never loads', () => {
  const imported = importedPackages();

  it('finds imports at all (a broken scan would pass this suite vacuously)', () => {
    for (const known of ['react', 'express', 'firebase']) {
      expect(imported.has(known), `${known} must be detected as imported`).toBe(true);
    }
  });

  it('every runtime dependency is imported somewhere', () => {
    const unused = Object.keys(pkg.dependencies ?? {})
      .filter((d) => !imported.has(d))
      .filter((d) => !ALLOWED_UNIMPORTED.has(d));
    expect(
      unused,
      `Declared in "dependencies" but imported nowhere:\n${unused.join('\n')}\n\n` +
      `These ship in the Cloud Run image and are scanned for CVEs. Remove them, move them to ` +
      `devDependencies if only the build needs them, or add them to ALLOWED_UNIMPORTED with a reason.`,
    ).toEqual([]);
  });

  it('the two removed in #2633 stay out of "dependencies"', () => {
    // Named so a future `npm install lighthouse` to "check performance" fails here with the story,
    // rather than quietly putting 114 MB back.
    for (const gone of ['lighthouse', 'cheerio']) {
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain(gone);
    }
  });

  it('the mobile platforms stay in devDependencies, where the release workflows still get them', () => {
    // `npx cap sync` reads these from package.json; android-aab.yml and ios-ipa.yml install with a
    // plain `npm ci`, which includes devDependencies. Moving them back to "dependencies" would put
    // them in the server image, which never runs Capacitor.
    for (const p of ['@capacitor/android', '@capacitor/ios']) {
      expect(Object.keys(pkg.devDependencies ?? {}), `${p} belongs in devDependencies`).toContain(p);
    }
  });
});
