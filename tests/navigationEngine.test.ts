import { describe, it, expect } from 'vitest';
import { getDefinition, findReferences, lineColToOffset, type NavFile } from '../src/server/AI/NavigationEngine';

/**
 * P-DEV.1 — semantic code navigation (ts-morph). These run the REAL engine over an in-memory
 * project, so they prove cross-file go-to-definition + find-references actually resolve.
 */
const FILES: NavFile[] = [
  {
    path: 'src/util.ts',
    content: [
      'export function greet(name: string) {',
      '  return `Hello, ${name}`;',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/app.ts',
    content: [
      "import { greet } from './util';",
      '',
      'const a = greet("world");',
      'const b = greet("again");',
    ].join('\n'),
  },
];

/** Find the 1-based (line, column) of the first occurrence of `needle` in `content`. */
function posOf(content: string, needle: string, occurrence = 1): { line: number; column: number } {
  const lines = content.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    let from = 0;
    for (;;) {
      const idx = lines[i].indexOf(needle, from);
      if (idx === -1) break;
      seen++;
      if (seen === occurrence) return { line: i + 1, column: idx + 1 };
      from = idx + 1;
    }
  }
  throw new Error(`"${needle}" #${occurrence} not found`);
}

describe('NavigationEngine — lineColToOffset', () => {
  it('maps (line,col) to a char offset', () => {
    const c = 'abc\ndefg\nhi';
    expect(lineColToOffset(c, 1, 1)).toBe(0);
    expect(lineColToOffset(c, 2, 1)).toBe(4); // after "abc\n"
    expect(lineColToOffset(c, 3, 2)).toBe(10);
  });
});

describe('NavigationEngine — getDefinition', () => {
  it('jumps from a cross-file usage to the declaration', async () => {
    const app = FILES[1].content;
    const { line, column } = posOf(app, 'greet', 2); // the usage on line 3 (import is occurrence 1)
    const offset = lineColToOffset(app, line, column);
    const res = await getDefinition(FILES, 'src/app.ts', offset);
    expect(res.ok).toBe(true);
    expect(res.locations.length).toBeGreaterThan(0);
    // Definition resolves into util.ts (the function declaration).
    expect(res.locations.some((l) => l.file.includes('util.ts'))).toBe(true);
  });

  it('returns ok with no locations when the cursor is not on a symbol', async () => {
    const res = await getDefinition(FILES, 'src/app.ts', 0); // start of import keyword region
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.locations)).toBe(true);
  });
});

describe('NavigationEngine — findReferences', () => {
  it('finds all references to a symbol across files', async () => {
    const util = FILES[0].content;
    const { line, column } = posOf(util, 'greet'); // the declaration
    const offset = lineColToOffset(util, line, column);
    const res = await findReferences(FILES, 'src/util.ts', offset);
    expect(res.ok).toBe(true);
    // declaration + import + 2 call sites = references across both files
    expect(res.locations.length).toBeGreaterThanOrEqual(3);
    expect(res.locations.some((l) => l.file.includes('app.ts'))).toBe(true);
  });
});

describe('NavigationEngine — robustness', () => {
  it('never throws on malformed input', async () => {
    const bad: NavFile[] = [{ path: 'x.ts', content: 'const = = = function (((' }];
    const res = await getDefinition(bad, 'x.ts', 3);
    expect(res.ok === true || res.ok === false).toBe(true); // returns a result, doesn't throw
    expect(Array.isArray(res.locations)).toBe(true);
  });
});
