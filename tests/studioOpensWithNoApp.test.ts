/**
 * CODE STUDIO OPENS WITH NO APP — AND SHOWS NO FILES, BECAUSE THERE ARE NONE (admin 2026-09-23).
 *
 * The admin, correcting an earlier instruction of their own: *"agar koi open app nahi hai, to bhi agar
 * studio (ide) open kiya jaye, to open ho jaye, bas andar koi file na dikhe (kyu ki file hai hi nahi)"*.
 *
 * Two defects stood in the way, and the second one is the reason this is more than a one-line change:
 *
 *   1. The mobile footer's Studio button was DISABLED on `!hasGeneratedCode`, while the desktop sidebar
 *      opened the same screen with no gate at all — one screen, two doors, two rules.
 *   2. With no app, `files` was never empty: App.tsx seeded three placeholder files ("Welcome to Navbharat
 *      AI Sandbox"), and startNewChat seeded three more ("New Sandbox"). So opening Studio would have shown
 *      files that do not exist. Worse, the workspace-hydration effect only runs while `files` is EMPTY, so
 *      the placeholders silently kept an earlier session's app from ever loading into Code Studio; and a
 *      restored blank chat found the placeholder index.html and set `hasGeneratedCode(true)`.
 *
 * All of these are SOURCE facts about wiring that no behavioural test in this repo renders, so they are
 * asserted against the source, with comments stripped so a note QUOTING the old code cannot satisfy them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const app = stripComments(read('src/App.tsx'));
const sessions = stripComments(read('src/hooks/useSessionManager.ts'));
const studio = read('src/components/ide/CodeStudio.tsx');

describe('the footer never disables Studio', () => {
  it('the gate on hasGeneratedCode is gone', () => {
    expect(app).not.toMatch(/id === 'studio' && !hasGeneratedCode/);
  });

  // SUPERSEDED 2026-09-24: Preview used to keep its gate here ("with no app there is nothing to
  // render"). The admin asked for the opposite — the empty preview opens — and
  // tests/emptyPreviewOpens.test.ts now owns that rule.

  it('the stripper does not simply blank the file (a guard against a vacuous pass)', () => {
    expect(app).toContain("{ id: 'studio' as ViewType,");
  });
});

describe('with no app there are no files — not placeholder ones', () => {
  it('the app starts with an EMPTY file set', () => {
    expect(app).toContain('const [files, setFiles] = useState<FileSystem>({});');
  });

  it('a new chat resets to an empty file set, and saves the session with none', () => {
    const start = sessions.indexOf('const startNewChat');
    expect(start).toBeGreaterThan(-1);
    const body = sessions.slice(start, sessions.indexOf('toggleTab(', start));
    expect(body).toContain('setFiles({});');
    expect(body).toContain('files: {},');
  });

  it('neither placeholder page comes back, in either place', () => {
    for (const src of [app, sessions]) {
      expect(src).not.toMatch(/Welcome to Navbharat AI Sandbox/);
      expect(src).not.toMatch(/New Sandbox/);
      expect(src).not.toMatch(/Welcome to your AI workspace/);
    }
  });

  it('the hydration that loads an earlier app still waits for an EMPTY set — the reason the seed mattered', () => {
    expect(app).toContain('if (Object.keys(files).length > 0) return;');
  });
});

describe('Code Studio already has an honest screen for an empty workspace', () => {
  it('it renders "Empty workspace" with a New File button when there are no files', () => {
    expect(studio).toContain('Object.keys(files).length === 0 ? (');
    expect(studio).toContain('Empty workspace');
    expect(studio).toContain('New File');
  });

  it('when files arrive later, it opens a real one instead of pointing at a file that does not exist', () => {
    expect(studio).toContain('if (keys.length > 0 && (!activeFile || !(activeFile in files))) {');
  });
});
