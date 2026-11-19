/**
 * BR2001 autopsy: "Create Windows 10 Emulator" (free Weak, Surplus) was stopped by the 25-min cap.
 *
 * The builder imported its icons as `./assets/icons/start.svg?react` (svgr). It wrote every `.svg`, installed
 * `vite-plugin-svgr`, and `npm run build` passed. Our missing-import gate still said
 * "src/assets/icons/start.svg?react … — CREATE this file", every time, because it appended `.tsx` /
 * `/index.ts` to the whole specifier, query included. The builder spent both resumes and its last ~6 minutes
 * arguing with that false finding until the cap stopped it.
 *
 * Class: a resolver that treats the bundler's `?query` / `#hash` as part of the file name. One predicate
 * (`isBinaryAssetSpecifier`) already stripped it; its siblings did not. All now share `importSpecifierPath`.
 * Fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importSpecifierPath, importSpecifierSuffix } from '../src/server/lib/importSpecifier';
import { findUnresolvedLocalImports, fixMispathLocalImports } from '../src/server/AgentV3/ProjectImport';
import { resolveLocalImport as archResolve } from '../src/server/AgentV3/ArchitectureAnalysis';
import { resolveLocalImport as journeyResolve } from '../src/server/AgentV3/journeyDerivation';
import { candidatePaths } from '../src/server/AgentV3/writeTimeImportCheck';
import { resolveExportTarget } from '../src/server/AgentV3/exportCapabilities';
import { resolveRelative, scanAppGraph } from '../src/server/lib/appGraphScan';
import { isBinaryAssetSpecifier } from '../src/server/AgentV3/fileClassification';

const ROOT = join(__dirname, '..');

// The delivered shape: the taskbar and the app list import svgr icons that exist on disk.
const WIN10: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1' }, devDependencies: { vite: '5.4.0', 'vite-plugin-svgr': '4.3.0' } }),
  'src/main.tsx': "import App from './App';\n",
  'src/App.tsx': "import Taskbar from './components/Taskbar';\nexport default function App() { return <Taskbar />; }\n",
  'src/components/Taskbar.tsx': [
    "import { ReactComponent as StartIcon } from '../assets/icons/start.svg?react';",
    "import { ReactComponent as SearchIcon } from '../assets/icons/search.svg?react';",
    "import { ReactComponent as TrayIcon } from '../assets/icons/tray.svg?react';",
    'export default function Taskbar() { return <div><StartIcon /><SearchIcon /><TrayIcon /></div>; }',
  ].join('\n'),
  'src/utils/apps.tsx': "import { ReactComponent as NotepadIcon } from '../assets/icons/notepad.svg?react';\nexport const apps = [{ id: 'notepad', Icon: NotepadIcon }];\n",
  'src/assets/icons/start.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'src/assets/icons/search.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'src/assets/icons/tray.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'src/assets/icons/notepad.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
};

describe('the report shape: svgr icons that exist are not "missing"', () => {
  it('🔴 findUnresolvedLocalImports (the fast-lane and agentic missing-import gate) names nothing', () => {
    expect(findUnresolvedLocalImports(WIN10)).toEqual([]);
  });
  it('🔴 the app graph scan reports no "broken import that will fail the build"', () => {
    expect(scanAppGraph(WIN10, true).filter((f) => f.category === 'imports')).toEqual([]);
  });
  it('every sibling resolver finds the file', () => {
    const set = new Set(Object.keys(WIN10));
    const from = 'src/components/Taskbar.tsx';
    expect(archResolve(from, '../assets/icons/start.svg?react', set)).toBe('src/assets/icons/start.svg');
    expect(journeyResolve(from, '../assets/icons/start.svg?react', WIN10)).toBe('src/assets/icons/start.svg');
    expect(resolveRelative(from, '../assets/icons/start.svg?react', set)).toBe('src/assets/icons/start.svg');
    expect(candidatePaths(from, '../assets/icons/start.svg?react')[0]).toBe('src/assets/icons/start.svg');
  });
  it('the other Vite queries too: ?raw, ?url, ?worker, ?inline, and a #hash', () => {
    const files: Record<string, string> = {
      'src/a.ts': "import raw from './words.txt?raw';\nimport url from './logo.png?url';\nimport W from './w.ts?worker';\nimport css from './a.css?inline';\nimport f from './font.woff2#iefix';\n",
      'src/words.txt': 'x', 'src/logo.png': 'x', 'src/w.ts': 'export {}', 'src/a.css': '', 'src/font.woff2': 'x',
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });
});

describe('neighbours: a real miss is still a miss', () => {
  it('an svgr icon that was NOT written is still reported, by its file name', () => {
    const files = { ...WIN10 };
    delete files['src/assets/icons/tray.svg'];
    expect(findUnresolvedLocalImports(files)).toEqual([{ missing: 'src/assets/icons/tray.svg', importedBy: 'src/components/Taskbar.tsx' }]);
    expect(scanAppGraph(files, true).some((f) => f.category === 'imports' && /tray\.svg\?react/.test(f.problem))).toBe(true);
  });
  it('a mispath to an existing icon is fixed AND keeps its ?react', () => {
    const files: Record<string, string> = {
      // One ../ too many escapes src/ — the over-relative mispath the autofix exists for.
      'src/components/Taskbar.tsx': "import Start from '../../assets/icons/start.svg?react';\nexport default Start;\n",
      'src/assets/icons/start.svg': '<svg/>',
    };
    const { files: fixed, fixes } = fixMispathLocalImports(files);
    expect(fixes).toEqual([{ importedBy: 'src/components/Taskbar.tsx', from: '../../assets/icons/start.svg?react', to: '../assets/icons/start.svg?react' }]);
    expect(fixed['src/components/Taskbar.tsx']).toContain("from '../assets/icons/start.svg?react'");
  });
  it('a query-loaded module is never export-checked against the file (svgr makes its exports)', () => {
    expect(resolveExportTarget('src/a.tsx', './x.svg?react', new Set(['src/x.svg']))).toBeNull();
    expect(resolveExportTarget('src/a.tsx', './b', new Set(['src/b.ts']))).toBe('src/b.ts');
  });
  it('isBinaryAssetSpecifier is unchanged', () => {
    expect(isBinaryAssetSpecifier('./logo.png?url')).toBe(true);
    expect(isBinaryAssetSpecifier('./a.ts?worker')).toBe(false);
  });
});

describe('importSpecifierPath', () => {
  it('strips only the decoration', () => {
    expect(importSpecifierPath('./a.svg?react')).toBe('./a.svg');
    expect(importSpecifierPath('./f.woff2#iefix')).toBe('./f.woff2');
    expect(importSpecifierPath('./plain')).toBe('./plain');
    expect(importSpecifierSuffix('./a.svg?react')).toBe('?react');
    expect(importSpecifierSuffix('./plain')).toBe('');
  });
  it('🔒 census: every resolver that decides whether a local import exists asks it', () => {
    for (const f of [
      'src/server/AgentV3/ProjectImport.ts', 'src/server/AgentV3/ArchitectureAnalysis.ts',
      'src/server/AgentV3/journeyDerivation.ts', 'src/server/AgentV3/writeTimeImportCheck.ts',
      'src/server/lib/appGraphScan.ts', 'src/server/AgentV3/fileClassification.ts',
    ]) expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/importSpecifierPath\(/);
  });
});
