// P-SEC.6 — SBOM generation (CycloneDX-style JSON) from package-lock.json.
//
// Produces a Software Bill of Materials listing every resolved dependency (name, version,
// purl, license when known). Written to `sbom.cdx.json` and uploaded as a CI build
// artifact. Dependency-free (no syft binary needed); `buildSbom()` is pure + unit-tested.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Pure: build a minimal CycloneDX 1.5 SBOM from a parsed package-lock.json object. */
export function buildSbom(lock, generatedAt = '1970-01-01T00:00:00.000Z') {
  const components = [];
  const seen = new Set();
  const packages = (lock && lock.packages) || {};
  for (const [path, info] of Object.entries(packages)) {
    if (!path || path === '') continue; // '' is the root project itself
    const name = info.name || path.split('node_modules/').pop();
    const version = info.version || '0.0.0';
    if (!name) continue;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const comp = {
      type: 'library',
      name,
      version,
      purl: `pkg:npm/${name.replace('@', '%40')}@${version}`,
    };
    if (info.license) comp.licenses = [{ license: { id: String(info.license) } }];
    components.push(comp);
  }
  components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: generatedAt,
      component: { type: 'application', name: (lock && lock.name) || 'navbharatai', version: (lock && lock.version) || '0.0.0' },
    },
    components,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    if (!existsSync('package-lock.json')) throw new Error('package-lock.json not found');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf-8'));
    // Stamp time at runtime (kept out of buildSbom so it stays pure/testable).
    const sbom = buildSbom(lock, new Date().toISOString());
    writeFileSync('sbom.cdx.json', JSON.stringify(sbom, null, 2));
    console.log(`✅ SBOM written to sbom.cdx.json — ${sbom.components.length} components.`);
  } catch (err) {
    console.error('SBOM generation failed:', err?.message || err);
    process.exit(1);
  }
}
