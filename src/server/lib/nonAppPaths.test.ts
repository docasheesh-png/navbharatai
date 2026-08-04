import { describe, it, expect } from 'vitest';
import { isNonAppPath } from './nonAppPaths';
import { SKIP_DIR_RE } from '../AgentV3/ProjectImport';
import { findDuplicateEntryPoints, findDuplicateStylesheets, findFocusOwners } from '../AgentV3/ProjectIntegrityChecks';

// MITRIFY AUTOPSY 2026-08-04: the integrity check reported "5 files each mount a React root" and
// "./index.css imported by 5 modules" — four of the five were
// `.local/skills/artifacts/artifacts/*/files/src/main.tsx`, AI-assistant scaffold TEMPLATES that had
// ridden along in the user's project. The engine then "repaired" them: it edited four files that are
// not part of the user's application. Fixed at BOTH ends — never imported, and never analyzed.
const TEMPLATE = '.local/skills/artifacts/artifacts/react-vite/files/src/main.tsx';

describe('isNonAppPath — a tool\'s scratch directory is not the user\'s source', () => {
  it('recognises the exact paths from the reported build', () => {
    expect(isNonAppPath(TEMPLATE)).toBe(true);
    expect(isNonAppPath('.local/skills/artifacts/artifacts/slides/files/src/main.tsx')).toBe(true);
  });

  it('covers the other assistant state directories, at any depth', () => {
    for (const d of ['.local', '.claude', '.cursor', '.windsurf', '.continue', '.codeium', '.aider']) {
      expect(isNonAppPath(`${d}/whatever/file.tsx`)).toBe(true);
      expect(isNonAppPath(`packages/app/${d}/nested/file.tsx`)).toBe(true);
    }
  });

  it('leaves REAL project files alone — including dot-directories the user genuinely maintains', () => {
    expect(isNonAppPath('client/src/main.tsx')).toBe(false);
    expect(isNonAppPath('src/App.tsx')).toBe(false);
    expect(isNonAppPath('.github/workflows/ci.yml')).toBe(false);   // the user's own CI
    expect(isNonAppPath('.vscode/settings.json')).toBe(false);
    expect(isNonAppPath('.husky/pre-commit')).toBe(false);
    expect(isNonAppPath('.devcontainer/devcontainer.json')).toBe(false);
  });

  it('does not match a similarly-named ordinary file or folder', () => {
    expect(isNonAppPath('src/localization/en.ts')).toBe(false);
    expect(isNonAppPath('src/local.ts')).toBe(false);
    expect(isNonAppPath('')).toBe(false);
  });
});

describe('the import boundary drops them, so they never enter a project at all', () => {
  it('SKIP_DIR_RE skips assistant state directories', () => {
    expect(SKIP_DIR_RE.test(TEMPLATE)).toBe(true);
    expect(SKIP_DIR_RE.test('.claude/settings.json')).toBe(true);
  });

  it('still imports the user\'s real source and their own repo config', () => {
    expect(SKIP_DIR_RE.test('client/src/main.tsx')).toBe(false);
    expect(SKIP_DIR_RE.test('.github/workflows/ci.yml')).toBe(false);
  });
});

describe('the integrity analyzers ignore them (defense in depth for projects that already have them)', () => {
  const MAIN = "import './index.css';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(<App />);\n";

  it('four scaffold templates + one real entry = ONE entry point, not five', () => {
    const files: Record<string, string> = { 'client/src/main.tsx': MAIN };
    for (const kind of ['mockup-sandbox', 'react-vite', 'slides', 'video-js']) {
      files[`.local/skills/artifacts/artifacts/${kind}/files/src/main.tsx`] = MAIN;
    }
    expect(findDuplicateEntryPoints(files)).toEqual([]); // was: 5 entries reported as the user's defect
  });

  it('the same templates no longer make index.css look imported by five modules', () => {
    const files: Record<string, string> = { 'client/src/main.tsx': MAIN };
    for (const kind of ['mockup-sandbox', 'react-vite', 'slides', 'video-js']) {
      files[`.local/skills/artifacts/artifacts/${kind}/files/src/main.tsx`] = MAIN;
    }
    expect(findDuplicateStylesheets(files)).toEqual([]);
  });

  it('a focus owner inside a template is not the user\'s focus conflict', () => {
    const files = {
      'src/App.tsx': 'export const App = () => <input autoFocus />;',
      [TEMPLATE]: 'export const T = () => <input autoFocus />;',
    };
    expect(findFocusOwners(files).map((o) => o.file)).toEqual(['src/App.tsx']);
  });

  it('a REAL duplicate entry point is still reported — the guard must not blind the check', () => {
    const files = { 'src/main.tsx': MAIN, 'src/legacy-main.tsx': MAIN };
    expect(findDuplicateEntryPoints(files).length).toBeGreaterThan(0);
  });
});
