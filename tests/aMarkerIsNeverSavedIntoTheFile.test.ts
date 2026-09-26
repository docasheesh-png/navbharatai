/**
 * A FORMAT MARKER IS NEVER SAVED INTO THE FILE — autopsy "4D Future City Drive" (2026-09-26).
 *
 * The build found `src/index.css` carrying "stray markers like `<<<ENDFILE>>`" and spent steps deleting
 * them. #3331 widened the parser to accept that spelling; the truncation check in FastLaneContinuation
 * kept the exact `<<<ENDFILE>>>`, so it still read a block the parser had closed as a file cut off
 * mid-write. Both now read one END_FILE_MARKER.
 */
import { describe, it, expect } from 'vitest';
import { parseFileBlocks, hasEndFileMarker } from '../src/server/AgentV3/OneShotBuilder';
import { unterminatedTailPath } from '../src/server/AgentV3/FastLaneContinuation';

describe('🔒 the end marker as models actually write it', () => {
  it('THE REPORT: a block closed `<<<ENDFILE>>` does not carry the marker into the file', () => {
    const text = '<<<FILE src/index.css>>>\nbody { margin: 0; }\n<<<ENDFILE>>\n<<<FILE src/app.css>>>\n.a { color: red; }\n<<<ENDFILE>>>';
    const files = parseFileBlocks(text);
    expect(files.map((f) => f.path)).toEqual(['src/index.css', 'src/app.css']);
    expect(files[0].content).toBe('body { margin: 0; }');
    expect(files.every((f) => !/ENDFILE/i.test(f.content))).toBe(true);
  });

  it('every spelling the parser accepts closes a block, and the canonical one is unchanged', () => {
    for (const end of ['<<<ENDFILE>>>', '<<<ENDFILE>>', '<<<ENDFILE>']) {
      const [f] = parseFileBlocks(`<<<FILE a.ts>>>\nexport const x = 1;\n${end}\nprose after`);
      expect(f.content, end).toBe('export const x = 1;');
    }
  });

  it('a real source line with angle brackets is never mistaken for the marker', () => {
    const css = 'ul > li { color: red; }\nconst x = a << 2 >> 1;';
    const [f] = parseFileBlocks(`<<<FILE a.ts>>>\n${css}\n<<<ENDFILE>>>`);
    expect(f.content).toBe(css);
    expect(hasEndFileMarker(css)).toBe(false);
  });

  it('a block closed one bracket short is CLOSED for the truncation check, not a file cut off', () => {
    expect(unterminatedTailPath('<<<FILE src/index.css>>>\nbody{}\n<<<ENDFILE>>')).toBeNull();
    expect(unterminatedTailPath('<<<FILE src/index.css>>>\nbody{')).toBe('src/index.css');
  });
});
