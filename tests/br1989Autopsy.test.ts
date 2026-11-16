// BR1989 autopsy (owner t311u sequential audit). Synthetic fixtures only — independently written,
// not the report's request or files.
//  D1. A per-file fast-lane call answered with a header one bracket short (`<<<FILE path>>`). The parser
//      only knew `>>>`, returned no block, and the planned component was silently dropped; the app failed
//      to compile until a repair round wrote it. The header now accepts `>{1,3}` — and every truncation
//      reader in FastLaneContinuation uses the SAME definition, so a cut-off file behind such a header is
//      still treated as cut off, never as finished (the eed79815 lesson for the end marker).
//  D2. No planned file owned the contract's helper and the plan had a `src/utils/` folder, so the lane
//      added `src/utils.ts` beside it. A module inside the folder imported `./utils`, the compile failed,
//      and the repair wrote an identical `src/utils/utils.ts`. An ADDED helper home now goes inside a
//      same-named planned folder; plans without such a folder, and the shared-constants home, keep main's path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFileBlocks, fileHeaderPath, FILE_HEADER_CLOSE, END_FILE_MARKER } from '../src/server/AgentV3/OneShotBuilder';
import { unterminatedTailPath, resumedFilePath, joinContinuation } from '../src/server/AgentV3/FastLaneContinuation';
import { textMarkerFilePaths } from '../src/server/AgentV3/TruncationRecovery';
import { utilOwnerFor, valueOwnerFor, helperOwners, newSharedHome, generationTier } from '../src/server/AgentV3/SimpleBuilder';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const NOTE_CARD = 'export default function NoteCard() {\n  return <div className="note">A note</div>;\n}';

describe('D1 — a file header one or two brackets short is still a header', () => {
  it('the exact old header parses byte-for-byte as before', () => {
    const text = `<<<FILE src/components/NoteCard.tsx>>>\n${NOTE_CARD}\n<<<ENDFILE>>>`;
    expect(parseFileBlocks(text)).toEqual([{ path: 'src/components/NoteCard.tsx', content: NOTE_CARD }]);
  });

  it.each(['>>', '>'])('a header closed with %s yields the file (the dropped-component case)', (close) => {
    const text = `<<<FILE src/components/NoteCard.tsx${close}\n${NOTE_CARD}\n<<<ENDFILE>>>`;
    expect(parseFileBlocks(text)).toEqual([{ path: 'src/components/NoteCard.tsx', content: NOTE_CARD }]);
  });

  it('a header with an extra bracket keeps a clean path, not a path ending in ">"', () => {
    const text = `<<<FILE src/components/NoteCard.tsx>>>>\n${NOTE_CARD}\n<<<ENDFILE>>>`;
    expect(parseFileBlocks(text).map((f) => f.path)).toEqual(['src/components/NoteCard.tsx']);
  });

  it('a short header between two normal blocks keeps all three files apart', () => {
    const text = [
      '<<<FILE src/a.ts>>>', 'export const a = 1;', '<<<ENDFILE>>>',
      '<<<FILE src/b.ts>>', 'export const b = 2;', '<<<ENDFILE>>>',
      '<<<FILE src/c.ts>>>', 'export const c = 3;', '<<<ENDFILE>>>',
    ].join('\n');
    expect(parseFileBlocks(text)).toEqual([
      { path: 'src/a.ts', content: 'export const a = 1;' },
      { path: 'src/b.ts', content: 'export const b = 2;' },
      { path: 'src/c.ts', content: 'export const c = 3;' },
    ]);
  });

  it('neighbours: quoted paths unquote, unsafe paths stay rejected, a mid-sentence mention is not a header', () => {
    expect(parseFileBlocks('<<<FILE "src/q.ts">>\nexport {};\n<<<ENDFILE>>>').map((f) => f.path)).toEqual(['src/q.ts']);
    expect(parseFileBlocks('<<<FILE ../escape.ts>>\nx\n<<<ENDFILE>>>')).toEqual([]);
    expect(parseFileBlocks('<<<FILE /etc/abs.ts>\nx\n<<<ENDFILE>>>')).toEqual([]);
    expect(parseFileBlocks('Wrap each file as <<<FILE path>> and so on, then stop.\nNo files here.')).toEqual([]);
    expect(parseFileBlocks('')).toEqual([]);
  });

  it('fileHeaderPath only trims, unquotes and drops stray closing brackets', () => {
    expect(fileHeaderPath(' src/x.ts ')).toBe('src/x.ts');
    expect(fileHeaderPath('src/x.ts>')).toBe('src/x.ts');
    expect(fileHeaderPath('`src/x.ts`')).toBe('src/x.ts');
    expect(FILE_HEADER_CLOSE).toBe('>{1,3}');
    expect(END_FILE_MARKER).toBe('<<<ENDFILE>{1,3}');
  });

  it('a TRUNCATED file behind a short header is still cut off — never passed off as finished', () => {
    const cut = `<<<FILE src/a.ts>>>\nexport const a = 1;\n<<<ENDFILE>>>\n<<<FILE src/components/NoteCard.tsx>>\nexport default function NoteCard() {\n  return <div`;
    expect(unterminatedTailPath(cut)).toBe('src/components/NoteCard.tsx');
    expect(unterminatedTailPath(`${cut}>x</div>;\n}\n<<<ENDFILE>>>`)).toBeNull();
    // the exact old spelling is unchanged
    expect(unterminatedTailPath('<<<FILE src/z.ts>>>\nexport const z')).toBe('src/z.ts');
    expect(unterminatedTailPath('plain text, no blocks')).toBeNull();
  });

  it('a continuation that re-opens a short-header file is welded, not allowed to replace the head', () => {
    const prev = '<<<FILE src/styles.css>>\n:root {\n  --gap: 8px;\n}\n.note {\n  padding: var(--gap);\n  font-';
    const cont = '<<<FILE src/styles.css>>\nsize: 14px;\n}\n<<<ENDFILE>>>';
    expect(resumedFilePath(prev, cont)).toBe('src/styles.css');
    const files = parseFileBlocks(joinContinuation(prev, cont));
    expect(files).toHaveLength(1);
    expect(files[0].content.startsWith(':root {')).toBe(true);
    expect(files[0].content).toContain('font-size: 14px;');
  });

  it('a cut-off turn\'s text marker behind a short header is listed for rewrite', () => {
    expect(textMarkerFilePaths('<<<FILE src/index.css>>\nbody { margin: 0; }')).toEqual(['src/index.css']);
  });

  it('every header reader in FastLaneContinuation uses the shared definition (no stray ">>>" literal)', () => {
    const src = read('src/server/AgentV3/FastLaneContinuation.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/<<<FILE\\s\+\(\.\+\?\)>>>/);
    expect((src.match(/FILE_HEADER_CLOSE/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('the per-file fast lane still reads its answer through parseFileBlocks', () => {
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toMatch(/const blocks = parseFileBlocks\(text\);/);
  });
});

const spec = (path: string, purpose = 'part of the app') => ({ path, purpose });

describe('D2 — an added helper home never sits beside a same-named planned folder', () => {
  it('a plan with a src/utils/ folder gets src/utils/helpers.ts, not src/utils.ts', () => {
    const plan = [spec('src/App.tsx'), spec('src/types.ts'), spec('src/utils/colorTools.ts', 'colour palette helpers')];
    expect(utilOwnerFor(plan, ['shortDate'], 'src/types.ts')).toEqual({ path: 'src/utils/helpers.ts', added: true });
  });

  it('a planned src/utils/index.ts barrel is not shadowed by an added src/utils.ts', () => {
    const plan = [spec('src/App.tsx'), spec('src/types.ts'), spec('src/utils/index.ts', 're-exports')];
    expect(utilOwnerFor(plan, ['shortDate'], 'src/types.ts').path).toBe('src/utils/helpers.ts');
  });

  it('a planned src/utils/helpers.ts becomes the owner instead of a second file', () => {
    const plan = [spec('src/App.tsx'), spec('src/types.ts'), spec('src/utils/helpers.ts', 'misc')];
    expect(utilOwnerFor(plan, ['shortDate'], 'src/types.ts')).toEqual({ path: 'src/utils/helpers.ts', added: false });
  });

  it('neighbours keep the old path: no folder, a look-alike name, a root contract, a .js contract', () => {
    const base = [spec('src/App.tsx'), spec('src/types.ts')];
    expect(utilOwnerFor(base, ['shortDate'], 'src/types.ts')).toEqual({ path: 'src/utils.ts', added: true });
    expect(utilOwnerFor([...base, spec('src/utilsPanel.tsx')], ['shortDate'], 'src/types.ts').path).toBe('src/utils.ts');
    expect(utilOwnerFor([...base, spec('src/lib/utils/x.ts')], ['shortDate'], 'src/types.ts').path).toBe('src/utils.ts');
    expect(utilOwnerFor([spec('types.ts'), spec('App.tsx')], ['shortDate'], 'types.ts').path).toBe('utils.ts');
    expect(utilOwnerFor([spec('types.ts'), spec('utils/a.ts')], ['shortDate'], 'types.ts').path).toBe('utils/helpers.ts');
    expect(utilOwnerFor([spec('src/types.js'), spec('src/utils/a.js')], ['shortDate'], 'src/types.js').path).toBe('src/utils/helpers.js');
  });

  it('owners the plan already provides are untouched by the folder rule', () => {
    const named = [spec('src/types.ts'), spec('src/utils/colorTools.ts'), spec('src/format.ts', 'exports shortDate for every screen')];
    expect(utilOwnerFor(named, ['shortDate'], 'src/types.ts')).toEqual({ path: 'src/format.ts', added: false });
    const beside = [spec('src/types.ts'), spec('src/utils/colorTools.ts'), spec('src/helpers.ts')];
    expect(utilOwnerFor(beside, ['shortDate'], 'src/types.ts')).toEqual({ path: 'src/helpers.ts', added: false });
    const byName = [spec('src/types.ts'), spec('src/utils/shortDate.ts')];
    expect(helperOwners(byName, ['shortDate'], 'src/types.ts')).toEqual([{ path: 'src/utils/shortDate.ts', added: false, names: ['shortDate'] }]);
    expect(utilOwnerFor(byName, [], 'src/types.ts')).toBeNull();
  });

  it('the shared-constants home is unchanged: src/data.ts, even beside a data folder', () => {
    const base = [spec('src/App.tsx'), spec('src/types.ts')];
    expect(valueOwnerFor(base, ['RECIPES'], 'src/types.ts')).toEqual({ path: 'src/data.ts', added: true });
    const tie = [...base, spec('src/data/alpha.ts', 'one'), spec('src/data/beta.ts', 'two')];
    expect(valueOwnerFor(tie, ['RECIPES'], 'src/types.ts')).toEqual({ path: 'src/data.ts', added: true });
  });

  it('the moved home is generated in the same stage the old one was', () => {
    expect(generationTier('src/utils/helpers.ts')).toBe(generationTier('src/utils.ts'));
    expect(generationTier('utils/helpers.ts')).toBe(generationTier('utils.ts'));
  });

  it('newSharedHome is the only place the folder rule lives', () => {
    expect(newSharedHome([], 'src', 'utils', 'helpers', 'ts')).toEqual({ path: 'src/utils.ts', added: true });
    expect(newSharedHome([spec('src/utils/a.ts')], 'src', 'utils', 'helpers', 'ts')).toEqual({ path: 'src/utils/helpers.ts', added: true });
  });
});
