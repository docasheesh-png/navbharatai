// BR1990 autopsy (owner t311u sequential audit). Synthetic fixtures only — independently written, not the
// report's request or files.
//  D1. The budget fold told one planned file to "ALSO INCLUDE" a folded component. That file's per-file call
//      answered with ONLY the folded component's own `<<<FILE …>>>` block, and the per-file lane's
//      first-block fallback saved the component's source under the host's path. (In the report the host was
//      a binary asset, so the write was refused; with a JS host the slip compiles and the host's importers
//      silently render the folded component.) A reply whose first block names a FOLDED path, and that has
//      no block for the asked-for path, is now refused like an empty reply. Every other reply is main's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pickGeneratedFile, runSimpleBuild, type SimpleFileSpec } from '../src/server/AgentV3/SimpleBuilder';
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

describe('D1 — through the real per-file lane', () => {
  const request = 'a small notes app for my class';
  const paths = ['src/main.tsx', 'src/App.tsx', ...Array.from({ length: 14 }, (_, i) => `src/components/Part${i}.tsx`)];
  const manifestText = paths.map((p) => `${p} :: ${p.includes('Part') ? 'a section of the page' : 'entry'}`).join('\n');
  const specs: SimpleFileSpec[] = paths.map((p) => ({ path: p, purpose: 'x' }));
  const fold = foldPlanToBudget(specs, fileBudgetForPrompt(request));
  const hostPath = paths.find((p) => !fold.folded.includes(p) && fold.files.find((f) => f.path === p)?.purpose.includes('ALSO INCLUDE'));

  const run = (hostAnswersWithFoldedOnly: boolean) => {
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
          return block(fold.folded[0], `export default function Folded() { return null; }`);
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
    expect(written.get(hostPath!) ?? '').not.toContain('function Folded()');
  });

  it('neighbour: a host that answers with its own block is written exactly as before', async () => {
    const { written } = await run(false);
    expect(written.get(hostPath!)).toContain('export default function');
    expect(written.get(hostPath!)).not.toContain('function Folded()');
  });

  it('wiring: genOne passes only the folded paths, and only when a fold happened', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(src).toContain('const foldedPathSet = new Set<string>(foldedPaths);');
    expect(src).toContain('pickGeneratedFile(text, spec.path, foldedPathSet.size ? foldedPathSet : undefined)');
    expect(src).toContain('const foldedPaths: readonly string[] = foldedPlan.folded;');
  });
});
