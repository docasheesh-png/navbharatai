/**
 * failedbr #728 / #731 / #734 / #735 (queue Q-3201): an imported repo carried ~480 reference files under
 * `Anthropic/claude-code/skills/…`. The readiness snapshot reads at most 300 source files, so they crowded the
 * real app out: "unsafe-html-sink @ …/artifact.d.ts", design/accessibility "partially scanned", and packages the
 * app really uses called unused. The project's own tsconfig already says what it builds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldersOutsideTheApp, inFolderOutsideTheApp } from '../src/server/AgentV3/outsideTheApp';

const pkg = JSON.stringify({ scripts: { dev: 'vite', build: 'tsc -b && vite build' }, devDependencies: { vite: '^5.4.0' } });
const tsconfigs = [
  { path: 'tsconfig.json', content: '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }' },
  { path: 'tsconfig.app.json', content: '{\n  // the app\n  "compilerOptions": { "strict": true },\n  "include": ["src"],\n}' },
  { path: 'tsconfig.node.json', content: '{ "include": ["vite.config.ts"] }' },
];
const files = [
  'index.html', 'vite.config.ts', 'package.json', 'src/main.tsx', 'src/App.tsx',
  'Anthropic/claude-code/skills/plugin-authoring/reference/claude-code.d.ts',
  'Anthropic/claude-code/skills/artifacts/artifact.d.ts', 'OpenAI/notes.ts', 'Cursor/rules.js',
  'scripts/seed.ts', 'public/sw.js',
];

describe('a folder no tsconfig includes and nothing names is not the app', () => {
  it('the #728 reference folders are set aside; the app, root files, scripts and public are not', () => {
    const out = foldersOutsideTheApp(files, pkg, tsconfigs);
    expect([...out].sort()).toEqual(['Anthropic', 'Cursor', 'OpenAI']);
    const inside = inFolderOutsideTheApp(out);
    expect(inside('Anthropic/claude-code/skills/artifacts/artifact.d.ts')).toBe(true);
    expect(inside('src/App.tsx')).toBe(false);
    expect(inside('vite.config.ts')).toBe(false);
  });

  it('🔒 unknown means inside: no bundler, no include, a glob include, or a folder a script or config names', () => {
    expect(foldersOutsideTheApp(files, JSON.stringify({ dependencies: { react: '18' } }), tsconfigs).size).toBe(0);
    expect(foldersOutsideTheApp(files, pkg, [{ path: 'tsconfig.json', content: '{ "compilerOptions": {} }' }]).size).toBe(0);
    expect(foldersOutsideTheApp(files, pkg, [{ path: 'tsconfig.json', content: '{ "include": ["**/*.ts"] }' }]).size).toBe(0);
    const named = foldersOutsideTheApp(files, JSON.stringify({ scripts: { lint: 'eslint Cursor/' }, devDependencies: { vite: '5' } }), [
      ...tsconfigs, { path: 'vite.config.ts', content: "export default { resolve: { alias: { '@ai': './OpenAI' } } }" },
    ]);
    expect([...named]).toEqual(['Anthropic']);
  });

  it('wired: evaluate decides the folders before the snapshot cap and sets their files aside', () => {
    const disp = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(disp).toContain('const candidates = files.filter((p) => SOURCE.test(p) && !SKIP_DIR.test(p) && !skip(p)).slice(0, 300);');
    expect(disp).toContain('outsideFolders = foldersOutsideTheApp(files, pkgForRun, projectSources);');
    expect(disp).toContain('...fullSnap.files.filter(inOutsideFolder)]);');
  });
});
