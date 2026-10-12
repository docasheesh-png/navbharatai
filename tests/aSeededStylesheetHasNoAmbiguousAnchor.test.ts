/**
 * A STYLESHEET WE SEED NEVER REPEATS A BLOCK HEADER (autopsy 15e69839, 2026-10-12 — the second time).
 *
 * The builder wanted to add rules after the reduced-motion block in the starter `src/index.css`, anchored its edit
 * on `@media (prefers-reduced-motion: reduce) {` — and our starter had that line twice. "old_string is not
 * unique (2 matches)", a read, a retry. Autopsy 981ce4cc hit the same two lines and fixed only the ERROR MESSAGE
 * (it now says how to append), so the struggle was smaller and still there. The class is the duplicate anchor in
 * what WE write, and it is fixed there: one reduced-motion block per file, and this census for every `@media`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

const MEDIA_LINE = /^\s*(@media [^{\n]+\{)/gm;

function repeatedMediaLines(src: string): string[] {
  const seen = new Map<string, number>();
  for (const m of src.matchAll(MEDIA_LINE)) seen.set(m[1].trim(), (seen.get(m[1].trim()) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([line, n]) => `${line} ×${n}`);
}

describe('census: no server file seeds the same @media block twice', () => {
  it('🔒 every @media header appears at most once per file', () => {
    const offenders = globSync('src/server/**/*.ts', { ignore: ['**/*.test.ts'] })
      .flatMap((f) => repeatedMediaLines(readFileSync(f, 'utf8')).map((r) => `${f}: ${r}`));
    expect(offenders, 'merge the blocks — an edit anchored on a repeated line is ambiguous').toEqual([]);
  });

  it('the starter design kit keeps the skeleton quiet for a reader who asked for less motion', () => {
    const kit = readFileSync('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit.ts', 'utf8');
    const block = kit.slice(kit.indexOf('@media (prefers-reduced-motion: reduce) {'));
    expect(block.slice(0, 900)).toContain('.nb-skeleton { animation: none; }');
  });

  it('the census sees the shape it forbids', () => {
    expect(repeatedMediaLines('@media (x) { a {} }\n.b {}\n@media (x) {\n c {} }')).toEqual(['@media (x) { ×2']);
  });
});
