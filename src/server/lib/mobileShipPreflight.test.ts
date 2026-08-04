// Tests for the compile pre-flight (admin 2026-08-04: "v5 live banaye, fix kare — GitHub par bas
// download ho").
//
// The invariant being locked: an app that cannot compile NEVER reaches GitHub, and "healed" means
// "preflightVerify says ok after the fix" — never "the model said it fixed it". The loop's success
// condition is re-verification, which is what separates a real heal from a claimed one.

import { describe, it, expect } from 'vitest';
import {
  preflightAiPaths, preflightAndHeal, preflightProblemsText, preflightUserMessage, preflightVerify,
} from './mobileShipPreflight';
import type { AiRepairModel } from './mobileBuildAiRepair';

const CHAIN: AiRepairModel[] = [{ provider: 'GLM', model: 'glm-5.2', baseURL: 'x', apiKey: 'k' }];
const noLlm = async () => { throw new Error('LLM must not be called for this case'); };

/** A minimal app that genuinely compiles: valid syntax, resolvable imports, declared packages. */
const CLEAN_APP: Record<string, string> = {
  'package.json': JSON.stringify({
    scripts: { build: 'vite build' },
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    devDependencies: { vite: '^5.0.0' },
  }),
  'index.html': '<div id="root"></div>',
  'src/main.tsx': "import { App } from './App';\nexport const boot = () => App;",
  'src/App.tsx': "export const App = () => 'hello';",
  'src/styles.css': 'body {}',
};

describe('preflightVerify — the three runner deaths, found in seconds instead of five minutes', () => {
  it('a clean app passes', async () => {
    const r = await preflightVerify(CLEAN_APP);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('finds a syntax error with its file and line', async () => {
    const r = await preflightVerify({ ...CLEAN_APP, 'src/App.tsx': 'export const App = () => { <div>' });
    expect(r.ok).toBe(false);
    expect(r.problems[0].kind).toBe('syntax');
    expect(r.problems[0].path).toBe('src/App.tsx');
  });

  it('finds an import of a file that does not exist — the classic generated-app death', async () => {
    const r = await preflightVerify({
      ...CLEAN_APP,
      'src/App.tsx': "import { useTodos } from './hooks/useTodos';\nexport const App = () => useTodos;",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'unresolved-import' && p.message.includes('./hooks/useTodos'))).toBe(true);
  });

  it('resolves imports the way Vite does: extensions, index files, @/ alias, css by exact path', async () => {
    const r = await preflightVerify({
      ...CLEAN_APP,
      'src/main.tsx': [
        "import { App } from './App';",
        "import { util } from '@/lib/util';",
        "import './styles.css';",
        'export const boot = () => [App, util];',
      ].join('\n'),
      'src/lib/util.ts': 'export const util = 1;',
    });
    expect(r.problems).toEqual([]);
  });

  it('a type-only import of a missing file is NOT a failure — the bundler erases it', async () => {
    const r = await preflightVerify({
      ...CLEAN_APP,
      'src/App.tsx': "import type { Shape } from './types-only';\nexport const App = (s: Shape) => s;",
    });
    expect(r.ok).toBe(true);
  });

  it('finds a package the app imports but never declared', async () => {
    const r = await preflightVerify({
      ...CLEAN_APP,
      'src/App.tsx': "import axios from 'axios';\nexport const App = () => axios;",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.kind === 'missing-package' && p.message.includes('axios'))).toBe(true);
  });

  it('a STATIC app is never failed for bundler-only problems', async () => {
    const r = await preflightVerify({
      'index.html': '<html></html>',
      // No build script → nothing bundles → an undeclared import cannot kill anything.
      'app.js': "import missing from './not-there';\nconsole.log(missing);",
    });
    expect(r.problems.filter((p) => p.kind !== 'syntax')).toEqual([]);
  });
});

describe('preflightAndHeal — heal here, prove it, only then ship', () => {
  it('a clean app heals nothing and calls no model', async () => {
    const r = await preflightAndHeal(CLEAN_APP, noLlm, CHAIN);
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual({});
    expect(r.aiRounds).toBe(0);
  });

  it('a well-known missing package is added deterministically — zero AI cost', async () => {
    const r = await preflightAndHeal({
      ...CLEAN_APP,
      'src/App.tsx': "import axios from 'axios';\nexport const App = () => axios;",
    }, noLlm, CHAIN);
    expect(r.ok).toBe(true);
    expect(r.aiRounds).toBe(0);
    expect(JSON.parse(r.changed['package.json']).dependencies.axios).toBeTruthy();
    expect(r.notes.join(' ')).toContain('axios');
  });

  it('the AI heals a syntax error, and success means RE-VERIFIED, not claimed', async () => {
    const broken = { ...CLEAN_APP, 'src/App.tsx': 'export const App = () => { <div>' };
    const llm = async () => JSON.stringify({
      fixable: true,
      explanation: 'Closed the unfinished component.',
      files: { 'src/App.tsx': "export const App = () => 'fixed';" },
    });
    const r = await preflightAndHeal(broken, llm, CHAIN);
    expect(r.ok).toBe(true);
    expect(r.changed['src/App.tsx']).toContain('fixed');
    expect(r.aiRounds).toBe(1);
  });

  it("an AI 'fix' that still does not compile is NOT a success — bounded rounds, then honest failure", async () => {
    const broken = { ...CLEAN_APP, 'src/App.tsx': 'export const App = () => { <div>' };
    let calls = 0;
    const llm = async () => {
      calls += 1;
      // The model keeps replying with a DIFFERENT but still-broken file.
      return JSON.stringify({ fixable: true, explanation: 'Fixed.', files: { 'src/App.tsx': `export const App = (${calls} => {` } });
    };
    const r = await preflightAndHeal(broken, llm, CHAIN, 2);
    expect(r.ok).toBe(false);
    expect(r.aiRounds).toBe(2);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('with no model chain the failure is honest, never silent', async () => {
    const broken = { ...CLEAN_APP, 'src/App.tsx': 'export const App = () => { <div>' };
    const r = await preflightAndHeal(broken, noLlm, []);
    expect(r.ok).toBe(false);
    expect(r.aiRounds).toBe(0);
  });
});

describe('what the user reads', () => {
  it('the failure message names the file and says what to do next', async () => {
    const { problems } = await preflightVerify({ ...CLEAN_APP, 'src/App.tsx': 'export const App = () => { <div>' });
    const msg = preflightUserMessage(problems);
    expect(msg).toContain('src/App.tsx');
    expect(msg).toMatch(/NavBharatAI Pro chat/);
    expect(msg).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|esbuild|vite/i);
  });

  it('the AI is shown the broken files plus package.json, bounded', async () => {
    const { problems } = await preflightVerify({
      ...CLEAN_APP,
      'src/App.tsx': "import { x } from './gone';\nexport const App = () => x;",
    });
    const paths = preflightAiPaths(problems);
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/App.tsx');
    expect(paths.length).toBeLessThanOrEqual(6);
    expect(preflightProblemsText(problems)).toContain('./gone');
  });
});
