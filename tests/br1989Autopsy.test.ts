// BR1989 autopsy (owner t311u sequential audit). Synthetic fixtures only — independently written,
// not the report's request or files.
//  D1. A per-file fast-lane call answered with a header one bracket short (`<<<FILE path>>`). The parser
//      only knew `>>>`, returned no block, and the planned component was silently dropped; the app failed
//      to compile until a repair round wrote it. A header one or two brackets short is now rewritten to
//      `>>>` ONLY when it starts a line, nothing but whitespace follows, and the path looks like a real file
//      path (review FAIL: an unanchored `>{1,3}` turned prose, Markdown and template lines into phantom
//      files). Every truncation reader in FastLaneContinuation applies the same rule, so a cut-off file
//      behind such a header is still treated as cut off. `>>>` input is byte-for-byte main's behaviour.
//  D2. No planned file owned the contract's helper and the plan had a `src/utils/` folder, so the lane
//      added `src/utils.ts` beside it. A module inside the folder imported `./utils`, the compile failed,
//      and the repair wrote an identical `src/utils/utils.ts`. An ADDED helper home now goes inside a
//      same-named planned folder; plans without such a folder, and the shared-constants home, keep main's path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFileBlocks, normalizeShortFileHeaders, isPlausibleHeaderPath, END_FILE_MARKER } from '../src/server/AgentV3/OneShotBuilder';
import { unterminatedTailPath, resumedFilePath, joinContinuation } from '../src/server/AgentV3/FastLaneContinuation';
import { textMarkerFilePaths } from '../src/server/AgentV3/TruncationRecovery';
import { utilOwnerFor, valueOwnerFor, helperOwners, newSharedHome, generationTier, pickGeneratedFile } from '../src/server/AgentV3/SimpleBuilder';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** main's parser, copied verbatim (eef10a4a), to prove `>>>` behaviour and every false positive are unchanged. */
function mainParse(text: string) {
  const out: Array<{ path: string; content: string }> = [];
  if (!text) return out;
  const re = new RegExp(String.raw`<<<FILE\s+(.+?)>>>\r?\n([\s\S]*?)(?:\r?\n?${END_FILE_MARKER}|(?=\r?\n?<<<FILE\s)|$)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim().replace(/^["'`]|["'`]$/g, '');
    if (!p || p.startsWith('/') || p.includes('..') || p.length > 300) continue;
    out.push({ path: p, content: m[2] });
  }
  const by = new Map<string, string>();
  for (const f of out) by.set(f.path, f.content);
  return [...by.entries()].map(([path, content]) => ({ path, content }));
}
/** main's unterminatedTailPath, verbatim. */
function mainTail(text: string): string | null {
  if (!text) return null;
  const lastHeader = text.lastIndexOf('<<<FILE');
  if (lastHeader === -1) return null;
  if (new RegExp(END_FILE_MARKER).test(text.slice(lastHeader))) return null;
  const m = /^<<<FILE\s+(.+?)>>>/.exec(text.slice(lastHeader));
  if (!m) return null;
  return m[1].trim().replace(/^["'`]|["'`]$/g, '') || null;
}

const NOTE_CARD = 'export default function NoteCard() {\n  return <div className="note">A note</div>;\n}';

// The reviewer's four phantom-file inputs, plus the other spellings main already handles.
const FALSE_POSITIVES: Record<string, string> = {
  'one bracket then a trailing comment': '<<<FILE src/a.tsx> // the component <App />\nbody\n<<<ENDFILE>>>',
  'three brackets then trailing prose': '<<<FILE src/a.tsx>>> here is <b>\nbody\n<<<ENDFILE>>>',
  'a Markdown line with a bare word path': '<<<FILE README.md>>>\nUse:\n<<<FILE path>\n<<<ENDFILE>>>',
  'a template literal line': '<<<FILE src/t.ts>>>\nconst s = `\n<<<FILE ${p}>\n`;\n<<<ENDFILE>>>',
};
const MAIN_SPELLINGS: Record<string, string> = {
  normal: '<<<FILE src/a.tsx>>>\nexport const a = 1 >> 2;\nconst x = <div>hi</div>;\n<<<ENDFILE>>>\n<<<FILE src/b.md>>>\n# T\n> quote\n`<<<FILE x>>>`\n<<<ENDFILE>>>',
  quoted: '<<<FILE "src/a.ts">>>\nx\n<<<ENDFILE>>>',
  crlf: '<<<FILE src/a.ts>>>\r\nx\r\n<<<ENDFILE>>>\r\n',
  fourClose: '<<<FILE src/a.ts>>>>\nx\n<<<ENDFILE>>>',
  innerGt: '<<<FILE src/a>b.ts>>>\nx',
  proseMention: 'Write each as <<<FILE path>> then body.\n<<<FILE src/a.ts>>>\nx',
  proseLineEnd: 'I will now write <<<FILE src/App.tsx>\n<<<FILE src/App.tsx>>>\nreal\n<<<ENDFILE>>>',
  midLineShort: 'see <<<FILE src/a.ts>>\nx\n<<<ENDFILE>>>',
  spaceInPath: '<<<FILE src/my file.ts>>\nx\n<<<ENDFILE>>>',
  braces: '<<<FILE src/{a}.ts>>\nx',
  noSlashNoExt: '<<<FILE Makefile>>\nall:\n<<<ENDFILE>>>',
  tripleTrailingSpace: '<<<FILE src/a.ts>>>   \nx\n<<<ENDFILE>>>',
};

describe('D1 — a short file header is accepted only as a real header line', () => {
  it.each(Object.entries({ ...FALSE_POSITIVES, ...MAIN_SPELLINGS }))('%s: the one-shot/repair parser returns exactly what main returns', (_k, text) => {
    expect(parseFileBlocks(text)).toEqual(mainParse(text));
    expect(unterminatedTailPath(text)).toBe(mainTail(text));
  });

  it.each(Object.entries(FALSE_POSITIVES))('%s: no phantom file, and the text is left byte-for-byte', (_k, text) => {
    expect(normalizeShortFileHeaders(text)).toBe(text);
    const paths = parseFileBlocks(text).map((f) => f.path);
    for (const p of paths) expect(/[\s<>${}]/.test(p)).toBe(false);
    expect(paths).not.toContain('path');
  });

  it.each(Object.entries(FALSE_POSITIVES))('%s: the per-file lane reads it exactly as main', (_k, text) => {
    const mainBlocks = mainParse(text);
    const mainPick = mainBlocks.find((b) => b.path === 'src/a.tsx') ?? mainBlocks[0] ?? null;
    expect(pickGeneratedFile(text, 'src/a.tsx')).toEqual(mainPick);
  });

  it('a per-file reply whose only header is a prose line yields nothing (not written under the planned path)', () => {
    expect(pickGeneratedFile('<<<FILE src/a.tsx> // the component <App />\nbody', 'src/a.tsx')).toBeNull();
    expect(pickGeneratedFile('Here: <<<FILE src/a.tsx>>\nbody', 'src/a.tsx')).toBeNull();
  });

  it.each(['>>', '>'])('true positive: a line-start header closed with %s yields the file (the dropped-component case)', (close) => {
    const text = `<<<FILE src/components/NoteCard.tsx${close}\n${NOTE_CARD}\n<<<ENDFILE>>>`;
    expect(parseFileBlocks(text)).toEqual([{ path: 'src/components/NoteCard.tsx', content: NOTE_CARD }]);
    expect(pickGeneratedFile(text, 'src/components/NoteCard.tsx')).toEqual({ path: 'src/components/NoteCard.tsx', content: NOTE_CARD });
    expect(parseFileBlocks(`<<<FILE src/x.ts${close}  \r\nexport {};\r\n<<<ENDFILE>>>`).map((f) => f.path)).toEqual(['src/x.ts']);
    expect(parseFileBlocks(`<<<FILE index.html${close}\n<p></p>\n<<<ENDFILE>>>`).map((f) => f.path)).toEqual(['index.html']);
  });

  it('true positive: a short header between two normal blocks keeps all three files apart', () => {
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

  it('the path rule: no whitespace or < > $ { }, and a slash or an extension', () => {
    for (const ok of ['src/a.ts', 'index.html', 'src/components/NoteCard', '"src/q.ts"']) expect(isPlausibleHeaderPath(ok)).toBe(true);
    for (const bad of ['path', '${p}', 'src/{a}.ts', 'a b.ts', 'src/a>b.ts', 'src/<x>.ts', '', 'Makefile']) expect(isPlausibleHeaderPath(bad)).toBe(false);
    expect(parseFileBlocks('<<<FILE ../escape.ts>>\nx\n<<<ENDFILE>>>')).toEqual([]);
    expect(parseFileBlocks('<<<FILE /etc/abs.ts>\nx\n<<<ENDFILE>>>')).toEqual([]);
  });

  it('a TRUNCATED file behind a line-start short header is still cut off — never passed off as finished', () => {
    const cut = `<<<FILE src/a.ts>>>\nexport const a = 1;\n<<<ENDFILE>>>\n<<<FILE src/components/NoteCard.tsx>>\nexport default function NoteCard() {\n  return <div`;
    expect(unterminatedTailPath(cut)).toBe('src/components/NoteCard.tsx');
    expect(unterminatedTailPath(`${cut}>x</div>;\n}\n<<<ENDFILE>>>`)).toBeNull();
    expect(unterminatedTailPath('<<<FILE src/z.ts>>')).toBe('src/z.ts');
    expect(unterminatedTailPath('<<<FILE src/z.ts>>>\nexport const z')).toBe('src/z.ts');
    // a prose short header at the end is still not a header (main: null)
    expect(unterminatedTailPath('done.\nI will write <<<FILE src/z.ts>>\nnext')).toBeNull();
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

  it('joinContinuation leaves a non-resumed continuation byte-for-byte', () => {
    const prev = '<<<FILE src/a.ts>>>\nexport const a = 1;\n<<<ENDFILE>>>\n';
    const cont = '<<<FILE src/b.ts>>\nexport const b = 2;\n<<<ENDFILE>>>';
    expect(joinContinuation(prev, cont)).toBe(prev + cont);
  });

  it('a cut-off turn\'s text marker behind a line-start short header is listed for rewrite', () => {
    expect(textMarkerFilePaths('<<<FILE src/index.css>>\nbody { margin: 0; }')).toEqual(['src/index.css']);
    expect(textMarkerFilePaths('see <<<FILE src/index.css> // later\nbody')).toEqual([]);
  });

  it('every reader keeps main\'s own >>> pattern and applies the one shared normaliser', () => {
    const cont = read('src/server/AgentV3/FastLaneContinuation.ts');
    expect((cont.match(/normalizeShortFileHeaders\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(cont).not.toMatch(/>\{1,3\}|FILE_HEADER_CLOSE/);
    const one = read('src/server/AgentV3/OneShotBuilder.ts');
    expect(one).toContain('text = normalizeShortFileHeaders(text);');
    expect(one).toContain("String.raw`<<<FILE\\s+(.+?)>>>\\r?\\n");
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toMatch(/const match = pickGeneratedFile\(text, spec\.path\);/);
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
