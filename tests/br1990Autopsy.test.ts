// BR1990 autopsy (owner t311u sequential audit). Synthetic fixtures only — independently written, not the
// report's request or files.
//  D1. The budget fold told one planned file to "ALSO INCLUDE" a folded component. That file's per-file call
//      answered with ONLY the folded component's own `<<<FILE …>>>` block, and the per-file lane's
//      first-block fallback saved the component's source under the host's path. (In the report the host was
//      a binary asset, so the write was refused; with a JS host the slip compiles and the host's importers
//      silently render the folded component.) A reply whose first block names a FOLDED path, and that has
//      no block for the asked-for path, is now refused like an empty reply ONLY when its content positively
//      looks like that folded file alone (declares/exports the folded file's own name, no other top-level
//      declaration or export). Two review FAILs: a usable host reply under the folded header must keep main's
//      fallback whatever the host is called (lowercase, kebab, camelCase export, `.ts` utility host,
//      anonymous default), so the check is fail-safe: anything unclear is main's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pickGeneratedFile, runSimpleBuild, looksLikeOnlyFile, type SimpleFileSpec } from '../src/server/AgentV3/SimpleBuilder';
import { parseFileBlocks } from '../src/server/AgentV3/OneShotBuilder';
import { foldPlanToBudget, fileBudgetForPrompt } from '../src/server/AgentV3/fileBudget';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const block = (path: string, body: string) => `<<<FILE ${path}>>>\n${body}\n<<<ENDFILE>>>`;
/** main's selection, verbatim: the exact block, else the first block, else null. */
const mainPick = (text: string, path: string) => {
  const b = parseFileBlocks(text);
  return b.find((x) => x.path === path) ?? b[0] ?? null;
};

describe('D1 — pickGeneratedFile never saves a folded file under its host\'s path', () => {
  const folded = new Set(['src/components/StatusBadge.tsx']);
  const BADGE = 'export default function StatusBadge() { return <span>ok</span>; }';
  const PANEL = 'export default function Panel() { return <div>panel</div>; }';

  it('true positive: the reply holds only the folded file → refused (null), not relabelled', () => {
    const text = block('src/components/StatusBadge.tsx', BADGE);
    expect(mainPick(text, 'src/components/Panel.tsx')?.content).toBe(BADGE); // main's mislabel
    expect(pickGeneratedFile(text, 'src/components/Panel.tsx', folded)).toBeNull();
  });

  it('the host block wins whenever it is present, before or after the folded block', () => {
    const a = `${block('src/components/StatusBadge.tsx', BADGE)}\n${block('src/components/Panel.tsx', PANEL)}`;
    const b = `${block('src/components/Panel.tsx', PANEL)}\n${block('src/components/StatusBadge.tsx', BADGE)}`;
    for (const t of [a, b]) expect(pickGeneratedFile(t, 'src/components/Panel.tsx', folded)).toEqual({ path: 'src/components/Panel.tsx', content: PANEL });
  });

  const NEIGHBOURS: Record<string, string> = {
    'exact block': block('src/components/Panel.tsx', PANEL),
    'a slipped path the plan does not know': block('components/Panel.tsx', PANEL),
    'another PLANNED (not folded) file — main\'s fallback is kept': block('src/App.tsx', PANEL),
    'a folded block that is not first': `${block('src/other.tsx', PANEL)}\n${block('src/components/StatusBadge.tsx', BADGE)}`,
    'no block at all': 'Sorry, here is the code: export default 1',
    'empty': '',
  };
  it.each(Object.entries(NEIGHBOURS))('neighbour (%s): identical to main', (_k, text) => {
    expect(pickGeneratedFile(text, 'src/components/Panel.tsx', folded)).toEqual(mainPick(text, 'src/components/Panel.tsx'));
  });

  it('without a fold (no set, or an empty one) every reply is main\'s, including the folded-looking one', () => {
    const t = block('src/components/StatusBadge.tsx', BADGE);
    expect(pickGeneratedFile(t, 'src/components/Panel.tsx')).toEqual(mainPick(t, 'src/components/Panel.tsx'));
    expect(pickGeneratedFile(t, 'src/components/Panel.tsx', new Set())).toEqual(mainPick(t, 'src/components/Panel.tsx'));
  });

  it('the folded file\'s own call (if one were made) still gets its exact block', () => {
    const t = block('src/components/StatusBadge.tsx', BADGE);
    expect(pickGeneratedFile(t, 'src/components/StatusBadge.tsx', folded)).toEqual({ path: 'src/components/StatusBadge.tsx', content: BADGE });
  });
});

describe('D1 review — refuse only what positively looks like the folded file alone; all else is main', () => {
  const F = 'src/components/StatusBadge.tsx';
  const folded = new Set([F, 'src/utils/format.ts', 'src/hooks/useTick.ts']);
  // [host path, folded header, content] — every one a usable combined host reply; main keeps it.
  const KEPT: Record<string, [string, string, string]> = {
    'combined content (first review probe)': ['src/components/Panel.tsx', F, 'function StatusBadge() { return <span>ok</span>; }\nexport default function Panel() { return <div><StatusBadge /></div>; }'],
    'lowercase header.tsx declaring Header': ['src/components/header.tsx', F, 'function StatusBadge() { return <span/>; }\nexport default function Header() { return <h1><StatusBadge /></h1>; }'],
    '.ts utility host helpers.ts': ['src/utils/helpers.ts', 'src/utils/format.ts', 'export function formatDay(d: Date) { return String(d); }\nexport function clamp(n: number) { return n; }'],
    '.ts utility host storage.ts': ['src/lib/storage.ts', 'src/utils/format.ts', 'export function loadItems() { return []; }\nexport function formatDay() { return ""; }'],
    '.ts types host types.ts': ['src/types.ts', 'src/utils/format.ts', 'export interface Item { id: string }\nexport function formatDay() { return ""; }'],
    'camelCase taskList export from task-list.tsx': ['src/components/task-list.tsx', F, 'function StatusBadge() { return null; }\nexport const taskList = () => null;'],
    'anonymous default export': ['src/components/Panel.tsx', F, 'function StatusBadge() { return null; }\nexport default function () { return null; }'],
    'hook host with the folded hook': ['src/hooks/useItems.ts', 'src/hooks/useTick.ts', 'export function useTick() {}\nexport function useItems() {}'],
    'const arrow + export default identifier': ['src/components/Panel.tsx', F, 'const StatusBadge = () => <span/>;\nconst Panel = () => <div><StatusBadge /></div>;\nexport default Panel;'],
    'export list renaming another component': ['src/components/Panel.tsx', F, 'function StatusBadge() { return null; }\nfunction Inner() { return null; }\nexport { Inner as Panel };'],
    're-export only': ['src/components/Panel.tsx', F, "export { default as Panel } from './PanelImpl';"],
    'an unrelated name only': ['src/components/Panel.tsx', F, 'export function PanelHeader() { return null; }'],
    'folded name plus a helper': ['src/components/Panel.tsx', F, 'const tone = "ok";\nexport default function StatusBadge() { return <span>{tone}</span>; }'],
    'expression default export': ['src/components/Panel.tsx', F, 'function StatusBadge() { return null; }\nexport default memo(StatusBadge);'],
    'everything on one line': ['src/components/Panel.tsx', F, 'function StatusBadge() { return null; }; export default function Panel() { return null; }'],
    'indented (cannot tell top level)': ['src/components/Panel.tsx', F, '  export default function StatusBadge() { return null; }'],
  };
  it.each(Object.entries(KEPT))('%s → kept, identical to main', (_k, [host, hdr, body]) => {
    const t = block(hdr, body);
    expect(pickGeneratedFile(t, host, folded)).toEqual(mainPick(t, host));
    expect(pickGeneratedFile(t, host, folded)).not.toBeNull();
  });

  // [host path, folded header, content] — the folded file alone; main would save it under the host.
  const REFUSED: Record<string, [string, string, string]> = {
    'folded component only (true positive)': ['src/components/Panel.tsx', F, 'export default function StatusBadge() { return <span>ok</span>; }'],
    'folded only, imports and renders the host': ['src/components/Panel.tsx', F, "import Panel from './Panel';\nexport default function StatusBadge() { return <Panel />; }"],
    'folded only, host named in JSX/strings': ['src/components/Panel.tsx', F, 'export default function StatusBadge() { return <div title="Panel">Panel</div>; }'],
    'folded only, declared then exported by name': ['src/components/Panel.tsx', F, 'function StatusBadge() { return null; }\nexport default StatusBadge;'],
    'folded only, export list': ['src/components/Panel.tsx', F, 'const StatusBadge = () => null;\nexport { StatusBadge };'],
    'folded only, host name not an identifier': ['src/components/1st.tsx', F, 'export default function StatusBadge() { return null; }'],
    'folded utility only under a .ts host': ['src/utils/helpers.ts', 'src/utils/format.ts', 'export function format(d: Date) { return String(d); }'],
  };
  it.each(Object.entries(REFUSED))('%s → refused (null); main would mislabel it', (_k, [host, hdr, body]) => {
    const t = block(hdr, body);
    expect(mainPick(t, host)?.content).toBe(body);
    expect(pickGeneratedFile(t, host, folded)).toBeNull();
  });

  it('looksLikeOnlyFile: the folded name matches across kebab/snake/case and index folders; unclear is false', () => {
    expect(looksLikeOnlyFile('export default function StatusBadge() {}', 'src/components/status-badge.tsx')).toBe(true);
    expect(looksLikeOnlyFile('export function statusBadge() {}', 'src/components/status_badge.ts')).toBe(true);
    expect(looksLikeOnlyFile('export default function StatusBadge() {}', 'src/components/StatusBadge/index.tsx')).toBe(true);
    expect(looksLikeOnlyFile('', 'src/components/StatusBadge.tsx')).toBe(false);
    expect(looksLikeOnlyFile("import x from './x';\n// StatusBadge", 'src/components/StatusBadge.tsx')).toBe(false);
    expect(looksLikeOnlyFile("export * from './StatusBadge';", 'src/components/StatusBadge.tsx')).toBe(false);
    expect(looksLikeOnlyFile('module.exports = StatusBadge;', 'src/components/StatusBadge.tsx')).toBe(false);
    expect(looksLikeOnlyFile('export default function StatusBadge() {}', 'src/components/.tsx')).toBe(false);
  });
});

describe('D1 — through the real per-file lane', () => {
  const request = 'a small notes app for my class';
  const paths = ['src/main.tsx', 'src/App.tsx', ...Array.from({ length: 14 }, (_, i) => `src/components/Part${i}.tsx`)];
  const manifestText = paths.map((p) => `${p} :: ${p.includes('Part') ? 'a section of the page' : 'entry'}`).join('\n');
  const specs: SimpleFileSpec[] = paths.map((p) => ({ path: p, purpose: 'x' }));
  const fold = foldPlanToBudget(specs, fileBudgetForPrompt(request));
  const hostPath = paths.find((p) => !fold.folded.includes(p) && fold.files.find((f) => f.path === p)?.purpose.includes('ALSO INCLUDE'));
  const foldedName = String(fold.folded[0] ?? '').replace(/^.*\//, '').replace(/\.tsx?$/, ''); // e.g. Part9

  const run = (hostAnswersWithFoldedOnly: boolean, combined = false) => {
    const written = new Map<string, string>();
    return runSimpleBuild({
      prompt: request,
      framework: 'react',
      scaffoldPaths: [],
      generate: async (sys: string, user?: string) => {
        if (/Plan the COMPLETE file list/i.test(sys)) return manifestText;
        const asked = /Return ONLY the <<<FILE (.+?)>>>/.exec(String(user ?? ''))?.[1];
        if (!asked) return '';
        const name = asked.replace(/^.*\//, '').replace(/\.tsx?$/, '');
        if (asked === hostPath && hostAnswersWithFoldedOnly) {
          const hostName = asked.replace(/^.*\//, '').replace(/\.tsx?$/, '');
          return block(fold.folded[0], combined
            ? `function ${foldedName}() { return null; }\nexport default function ${hostName}() { return null; }`
            : `export default function ${foldedName}() { return null; }`);
        }
        return block(asked, `export default function ${name.replace(/\W/g, '') || 'X'}() { return null; }`);
      },
      writeFiles: async (files) => { for (const f of files) written.set(f.path, f.content); },
      verify: async () => ({ ok: true, errors: '', ran: true }),
      log: () => {},
    } as any).then((sb) => ({ sb, written }));
  };

  it('the fixture really folds, and names a JS host', () => {
    expect(fold.folded.length).toBeGreaterThan(0);
    expect(hostPath).toMatch(/\.tsx$/);
  });

  it('true positive: the host is never written with the folded component\'s source', async () => {
    const { written } = await run(true);
    expect(written.get(hostPath!) ?? '').not.toContain(`function ${foldedName}()`);
  });

  it('review neighbour: a combined host reply under the folded header is written under the host path, as main', async () => {
    const { written } = await run(true, true);
    const hostName = hostPath!.replace(/^.*\//, '').replace(/\.tsx?$/, '');
    expect(written.get(hostPath!)).toContain(`export default function ${hostName}()`);
  });

  it('neighbour: a host that answers with its own block is written exactly as before', async () => {
    const { written } = await run(false);
    expect(written.get(hostPath!)).toContain('export default function');
    expect(written.get(hostPath!)).not.toContain(`function ${foldedName}()`);
  });

  it('wiring: genOne passes only the folded paths, and only when a fold happened', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(src).toContain('const foldedPathSet = new Set<string>(foldedPaths);');
    expect(src).toContain('pickGeneratedFile(text, spec.path, foldedPathSet.size ? foldedPathSet : undefined)');
    expect(src).toContain('const foldedPaths: readonly string[] = foldedPlan.folded;');
  });
});
