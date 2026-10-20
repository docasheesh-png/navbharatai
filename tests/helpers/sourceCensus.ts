import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Parallel generated-code fixtures are not shipped source and may disappear at any instant. */
export function isCensusFixture(name: string): boolean { return name.startsWith('.tmp-'); }

/** Keep real source I/O errors visible; never stat or descend into a transient fixture. */
export function sourceCensusFiles(dir: string, include: (path: string) => boolean, ignored: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (isCensusFixture(name) || ignored.includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceCensusFiles(path, include, ignored));
    else if (include(path)) out.push(path);
  }
  return out;
}
