/**
 * A FORMAT MARKER IS NEVER SAVED INTO THE FILE — autopsy "4D Future City Drive" (2026-09-26).
 *
 * The build found `src/index.css` carrying "stray markers like `<<<ENDFILE>>`" and spent steps deleting
 * them. The parser recognised exactly `<<<ENDFILE>>>`; a block closed one bracket short kept the marker
 * as content. The truncation check read the same block as never closed (a file cut off mid-write).
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

  it('the other spellings close a block too, and the canonical one is unchanged', () => {
    for (const end of ['<<<ENDFILE>>>', '<<<ENDFILE>>', '<<< END FILE >>>', '<<<END_FILE>>>', '<<</FILE>>>', '<<<endfile>>>']) {
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
