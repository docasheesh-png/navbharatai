/**
 * The stylesheet was written beside its screens — autopsy 2720e553, 2026-09-27.
 *
 * A free user asked for a secret calculator. The fast lane planned four files: `index.html`,
 * `src/main.tsx`, `src/index.css` and `src/App.tsx`. Three separate defects then compounded:
 *
 *  1. The stylesheet was in the SHELL's tier, so it was generated at the same moment as `App.tsx`, the
 *     only file whose class names it had to style. It invented its own. The class check failed, and
 *     three repair rounds spent 494 s (61% of the lane) rewriting the stylesheet three different ways.
 *  2. The last repair hit the output ceiling. Its continuation answered `{ }`, and because a
 *     stylesheet's first line (`:root {`) is seven characters, the join judged the 4,669-character
 *     partial as "nothing to preserve" and let `{ }` replace the whole file.
 *  3. The class check treated a stylesheet that defines no class as "nothing to check against", so the
 *     emptied file PASSED it, and the build said "Build verified — the app compiles ✓".
 */
import { describe, it, expect } from 'vitest';
import {
  generationTier, requiredStageCount, stylesheetClassContext, runSimpleBuild, STYLESHEET_TIER,
} from '../src/server/AgentV3/SimpleBuilder';
import { joinContinuation, continuationRestartsFile } from '../src/server/AgentV3/FastLaneContinuation';
import { parseFileBlocks } from '../src/server/AgentV3/OneShotBuilder';
import { cssConsistencyError, findUndefinedClasses, classNamesUsedBy } from '../src/server/AgentV3/CssConsistency';

/** The manifest the reported build planned, verbatim. */
const REPORTED_MANIFEST = ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css'];

/** The shape of the screens App.tsx really rendered: literals, a ternary and a template literal. */
const APP_TSX = `
export default function App() {
  const [op, setOp] = useState(false);
  return (
    <div className="calculator">
      <div className="calc-display">0</div>
      <button className={op ? 'key key-operator' : 'key'}>+</button>
      <button className={\`key \${op ? 'key-active' : ''} key-equals\`}>=</button>
      <section className="vault-panel"><ul className="vault-list" /></section>
    </div>
  );
}`;

describe('1 — the stylesheet is generated after the screens it styles', () => {
  it('🔴 the reported manifest: index.css now runs AFTER App.tsx, not beside it', () => {
    expect(generationTier('src/index.css')).toBe(STYLESHEET_TIER);
    expect(generationTier('src/index.css')).toBeGreaterThan(generationTier('src/App.tsx'));
    expect(generationTier('src/index.css')).toBeGreaterThan(generationTier('src/main.tsx'));
  });

  it('the extra stage is deferrable: the budget projection counts the same stages as without the stylesheet', () => {
    const withoutCss = REPORTED_MANIFEST.filter((p) => !p.endsWith('.css'));
    expect(requiredStageCount(REPORTED_MANIFEST)).toBe(requiredStageCount(withoutCss));
    expect(requiredStageCount(['src/index.css'])).toBe(1);
  });

  it('the stylesheet call is handed every class the screens use — including the ones an expression picks', () => {
    const block = stylesheetClassContext([{ path: 'src/App.tsx', content: APP_TSX }]);
    for (const c of ['calculator', 'calc-display', 'key', 'key-operator', 'key-active', 'key-equals', 'vault-panel', 'vault-list']) {
      expect(block).toContain(`.${c}`);
    }
    expect(block).not.toMatch(/\.op\b|\$\{/);
    expect(stylesheetClassContext([{ path: 'src/types.ts', content: 'export type A = 1;' }])).toBe('');
  });

  it('classNamesUsedBy reads double, single and template literals and ignores non-source files', () => {
    expect(classNamesUsedBy({ 'a.tsx': '<p className="x y-z" />', 'b.css': '.q{}' })).toEqual(['x', 'y-z']);
    expect(classNamesUsedBy({ 'a.jsx': "<p className={cond ? 'on' : \"off\"} />" })).toEqual(['off', 'on']);
  });

  it('in a real lane run, the stylesheet is written last and its prompt carries App.tsx\'s classes', async () => {
    const order: string[] = [];
    let cssPrompt = '';
    const sb = await runSimpleBuild({
      prompt: 'secret calculator', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'],
      shareContract: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return REPORTED_MANIFEST.map((p) => `${p} :: file`).join('\n');
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || '';
        order.push(path);
        if (path === 'src/index.css') { cssPrompt = user; return `<<<FILE ${path}>>>\n.calculator { color: red; }\n<<<ENDFILE>>>`; }
        if (path === 'src/App.tsx') return `<<<FILE ${path}>>>\n${APP_TSX}\n<<<ENDFILE>>>`;
        if (path === 'src/main.tsx') return `<<<FILE ${path}>>>\nimport App from './App';\nimport './index.css';\n<<<ENDFILE>>>`;
        return `<<<FILE ${path}>>>\n<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
    });
    expect(sb.filesWritten).toBeGreaterThan(0);
    expect(order[order.length - 1]).toBe('src/index.css');
    expect(order.indexOf('src/index.css')).toBeGreaterThan(order.indexOf('src/App.tsx'));
    expect(cssPrompt).toContain('CLASS NAMES THE SCREENS ALREADY USE');
    expect(cssPrompt).toContain('.key-operator');
  });
});

describe('2 — a continuation never replaces a partial file with less', () => {
  /** The partial stylesheet the last repair produced before the ceiling (shape, not every byte). */
  const PARTIAL = `<<<FILE src/index.css>>>\n:root {\n  --space-xs: 0.5rem;\n  --space-sm: 1rem;\n  --radius: 0.5rem;\n  --background: #1f2937;\n}\n\n.calculator {\n  background: var(--background);\n  border-radius: var(--radius`;
  const CONTINUATION = `<<<FILE src/index.css>>>\n{\n}\n<<<ENDFILE>>>`;

  it('🔴 the reported join: `{ }` is appended to the partial, never substituted for it', () => {
    const joined = joinContinuation(PARTIAL, CONTINUATION);
    const css = parseFileBlocks(joined).find((b) => b.path === 'src/index.css')?.content ?? '';
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain('.calculator');
    expect(css.trim()).not.toBe('{\n}');
  });

  it('a short first line no longer counts as "nothing to preserve"', () => {
    const body = ':root {\n  --space-xs: 0.5rem;\n  --space-sm: 1rem;\n';
    expect(continuationRestartsFile(body, '{\n}')).toBe(false);
  });

  it('a genuine restart of the same file is still recognised, across line breaks', () => {
    const body = ':root {\n  --space-xs: 0.5rem;\n  --space-sm: 1rem;\n  --radius: 0.5rem;\n}\n.calculator {';
    const restart = ':root {\n  --space-xs: 0.5rem;\n  --space-sm: 1rem;\n  --radius: 0.5rem;\n}\n.calculator { color: red; }\n';
    expect(continuationRestartsFile(body, restart)).toBe(true);
  });

  it('an empty partial is still "nothing to preserve"', () => {
    expect(continuationRestartsFile('', ':root { --a: 1; }')).toBe(true);
    expect(continuationRestartsFile('  \n ', ':root { --a: 1; }')).toBe(true);
  });
});

describe('3 — an emptied stylesheet does not pass the class check', () => {
  it('🔴 the reported end state: `{ }` beside a screen with styled classes is a mismatch, not silence', () => {
    const files = { 'src/App.tsx': APP_TSX, 'src/index.css': '{\n}' };
    expect(findUndefinedClasses(files).length).toBeGreaterThanOrEqual(3);
    const err = cssConsistencyError(files);
    expect(err).toMatch(/calc-display/);
    expect(err).toMatch(/Removing style rules never fixes this/);
  });

  it('a stylesheet of element rules only is judged the same way', () => {
    expect(cssConsistencyError({ 'src/App.tsx': APP_TSX, 'src/index.css': 'body { margin: 0 }\nbutton { color: red }' })).not.toBeNull();
  });

  it('an app with NO stylesheet at all is still left alone (nothing to check against)', () => {
    expect(cssConsistencyError({ 'src/App.tsx': APP_TSX })).toBeNull();
  });

  it('a stylesheet that defines the classes still passes', () => {
    const css = '.calculator{}.calc-display{}.key-operator{}.key-active{}.key-equals{}.vault-panel{}.vault-list{}';
    expect(cssConsistencyError({ 'src/App.tsx': APP_TSX, 'src/index.css': css })).toBeNull();
  });
});
