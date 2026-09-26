/**
 * A REPAIR WRITES ONLY WHAT IT WAS ASKED TO REPAIR — autopsy 2026-09-26 ("4D Future City Drive").
 *
 * The post-build typecheck repair on a finished Three.js game answered with a generic web app — a file
 * literally named `relative/path.ext` (the example path from the repair prompt's own output format) and
 * an auth scaffold the game never had — and every block was written. These tests use that exact list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPlaceholderPath,
  newPathIsReferenced,
  scopeRepairFiles,
  repairScopeNote,
} from '../src/server/AgentV3/repairScope';

const GAME: Record<string, string> = {
  'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n",
  'src/App.tsx': "import { Game } from './game/Game';\nimport { useControls } from '@/hooks/useControls';\nexport default function App() { return <Game />; }\n",
  'src/game/Game.tsx': "import { createEngine } from './engine';\nexport function Game() { return null; }\n",
  'src/index.css': 'body { margin: 0; }\n',
};

// What the repair returned in the real report (paths only; content is irrelevant to the decision).
const JUNK = [
  'relative/path.ext', 'src/App.jsx', 'src/components/Navbar.jsx', 'src/components/Sidebar.jsx',
  'src/components/Footer.jsx', 'src/components/Button.jsx', 'src/components/Input.jsx',
  'src/hooks/useAuth.js', 'src/context/AuthContext.jsx', 'src/pages/Login.jsx', 'src/pages/Dashboard.jsx',
  'src/pages/Profile.jsx', 'src/pages/NotFound.jsx', 'src/routes/AppRoutes.jsx', 'src/constants.js',
  'src/styles/globals.css', 'src/styles/theme.css',
].map((path) => ({ path, content: '// x' }));

describe('🔒 template paths are never files', () => {
  it('refuses the literal example from our own prompt and the other placeholder idioms', () => {
    for (const p of ['relative/path.ext', './relative/path.ext', 'src/path/to/file.ts', 'src/<name>.tsx', 'src/{file}.ts', 'src/.../x.ts', 'src/foo.ext']) {
      expect(isPlaceholderPath(p), p).toBe(true);
    }
  });

  it('never refuses a real file that merely looks similar', () => {
    for (const p of ['src/relative.ts', 'src/paths.ts', 'src/utils/pathTo.ts', 'src/extensions.ts', 'src/game/Game.tsx']) {
      expect(isPlaceholderPath(p), p).toBe(false);
    }
  });
});

describe('🔒 THE REPORT: the invented auth app is refused, the named file is applied', () => {
  it('keeps the file the compiler named and refuses every invented one', () => {
    const errors = "src/game/Game.tsx(1,30): error TS2307: Cannot find module './engine' or its corresponding type declarations.";
    const r = scopeRepairFiles(
      [...JUNK, { path: 'src/game/Game.tsx', content: 'fixed' }, { path: 'src/game/engine.ts', content: 'export const createEngine = () => null;' }],
      { allowed: Object.keys(GAME), errors, existing: GAME },
    );
    expect(r.kept.map((f) => f.path).sort()).toEqual(['src/game/Game.tsx', 'src/game/engine.ts']);
    expect(r.refused.find((x) => x.path === 'relative/path.ext')?.reason).toBe('template-path');
    expect(r.refused.filter((x) => x.reason === 'outside-scope')).toHaveLength(JUNK.length - 1);
  });

  it('a missing module an existing file imports may be created — including through the @/ alias', () => {
    expect(newPathIsReferenced('src/hooks/useControls.ts', undefined, GAME)).toBe(true);
    expect(newPathIsReferenced('src/game/engine.ts', undefined, GAME)).toBe(true);
    expect(newPathIsReferenced('src/components/Navbar.jsx', undefined, GAME)).toBe(false);
  });

  it('a pass that may not create files refuses a new file even when something imports it', () => {
    const r = scopeRepairFiles([{ path: 'src/game/engine.ts', content: 'x' }], { allowed: ['src/game/Game.tsx'], existing: GAME, allowCreate: false });
    expect(r.kept).toHaveLength(0);
  });

  it('an EXISTING file the pass was not given is not rewritten', () => {
    const r = scopeRepairFiles([{ path: 'src/index.css', content: 'body{}' }], { allowed: ['src/App.tsx'], existing: GAME });
    expect(r.kept).toHaveLength(0);
    expect(r.refused[0].reason).toBe('outside-scope');
  });

  it('the report line names what was refused and no model or vendor', () => {
    const note = repairScopeNote('typecheck', [{ path: 'relative/path.ext', reason: 'template-path' }, { path: 'src/components/Navbar.jsx', reason: 'outside-scope' }]);
    expect(note).toContain('relative/path.ext');
    expect(note).toContain('Navbar.jsx');
    expect(note).not.toMatch(/glm|kimi|claude|gemini|grok|openai|nemotron/i);
  });
});

describe('🔒 reversion guards — every repair site asks the scope before writing', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const lane = readFileSync(resolve(__dirname, '../src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

  it('each of the four route repair passes writes only scoped files', () => {
    for (const [scoped, writeId] of [
      ['tscScoped', 'tscgate-w'],
      ['createdScoped', 'missfiles-w'],
      ['syntaxScoped', 'syntax-w'],
      ['exportScoped', 'missexport-w'],
    ]) {
      const at = route.indexOf(`const ${scoped} = scopeRepairFiles(`);
      const write = route.indexOf(`id: \`${writeId}`);
      expect(at, scoped).toBeGreaterThan(0);
      expect(write, writeId).toBeGreaterThan(at);
      expect(write - at, `${scoped} → ${writeId}`).toBeLessThan(1600);
    }
  });

  it('the fast lane scopes its repair before the acceptance snapshot', () => {
    const at = lane.indexOf('const scoped = scopeRepairFiles(fixed');
    const write = lane.indexOf('await deps.writeFiles(fixed)');
    expect(at).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(at);
  });
});
