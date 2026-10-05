/**
 * Q-139: the syntax gate parsed JS/TS only, so a write that stopped in the middle of a stylesheet or a
 * `package.json` — a model cut off at its token limit — went through the write path unreported. The class:
 * a truncation guard blind to every file type but one. JSON is now parsed exactly; CSS is judged only on
 * the parser's cut-off signatures (an unclosed brace, string or comment), never on anything else a valid
 * stylesheet can contain.
 */
import { describe, it, expect } from 'vitest';
import { findSyntaxErrors, firstSyntaxError, parseGuardDecision, isParseableFile } from '../src/server/AgentV3/SyntaxCheck';

const PKG = '{\n  "name": "app",\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18';

describe('a cut-off stylesheet or package.json is broken', () => {
  it('a truncated package.json and a stylesheet that ends mid-rule are reported', async () => {
    const errs = await findSyntaxErrors({
      'package.json': PKG,
      'src/index.css': '.a { color: red; }\n.b { padding: 4px',
      'src/theme.css': '.a{color:red}\n/* hello',
      'src/ok.css': '.a{content:"abc}',
    });
    expect(errs.map((e) => e.path).sort()).toEqual(['package.json', 'src/index.css', 'src/ok.css', 'src/theme.css']);
    expect(errs.find((e) => e.path === 'package.json')!.message).toMatch(/^invalid JSON/);
  });

  it('valid files of every kind pass — Tailwind directives, nesting, a BOM, an empty file', async () => {
    expect(await findSyntaxErrors({
      'package.json': '﻿{"name":"app"}',
      'src/index.css': '@tailwind base;\n@tailwind components;\n.btn { @apply px-4 py-2; }\n.a { .b { color: red } }',
      'src/empty.css': '   ',
      'public/manifest.json': '{"short_name":"App","icons":[]}',
    })).toEqual([]);
  });

  it('JSON-with-comments files are not judged by JSON.parse', async () => {
    const vite = '{\n  "compilerOptions": {\n    /* Bundler mode */\n    "moduleResolution": "bundler",\n  },\n}';
    expect(await findSyntaxErrors({ 'tsconfig.json': vite, 'tsconfig.app.json': vite, '.vscode/settings.json': '{ // x\n}' })).toEqual([]);
    expect(isParseableFile('tsconfig.node.json')).toBe(false);
    expect(isParseableFile('src/data/cities.json')).toBe(true);
  });

  it('the write guard refuses a cut-off write with a hint for that file type — never the JS duplicate-const hint', async () => {
    const errNew = await firstSyntaxError('package.json', PKG);
    const msg = parseGuardDecision('package.json', null, errNew)!;
    expect(msg).toMatch(/WRITE REJECTED/);
    expect(msg).toMatch(/cut off or unbalanced[\s\S]*valid JSON/);
    expect(msg).not.toMatch(/DUPLICATE declaration/);
    // An already-broken file can still be repaired step by step.
    expect(parseGuardDecision('package.json', errNew, errNew)).toBeNull();
  });
});
