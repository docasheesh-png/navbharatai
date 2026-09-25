/**
 * AN ERROR IN THIS FILE IS NOT ALWAYS AN ERROR OF THIS FILE (autopsy 2a7fa4b0, 2026-09-25).
 *
 * The full builder wrote `src/components/BottomNav.tsx` importing `Screen` from `../App` before
 * `src/App.tsx` had been rewritten to export it. The compiler, verbatim from the report:
 *
 *     src/components/BottomNav.tsx(1,15): error TS2614: Module '"../App"' has no exported member
 *     'Screen'. Did you mean to use 'import Screen from "../App"' instead?
 *
 * Our write-time note then told the model to *"fix them NOW, in this turn, before writing the next
 * file"* — and the next file was the one that would have fixed it. BottomNav was rewritten three
 * times and the error never moved.
 *
 * Two halves, per the 50/50 law:
 * 1. The note says an error whose remedy lives in another file WAITS on that file, by name, and the
 *    cause analysis says what to change there (`remedyFileFor`, `export-missing`).
 * 2. Upstream, the architect prompt now says shared types live in `src/types.ts`, written first, and
 *    are never imported from the root component.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tscErrorCauses, remedyFileFor, exportsName, declaresName, exportTargetCandidates, MAX_EXPORT_TARGETS,
} from '../src/server/AgentV3/tscErrorCause';
import { writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const REPORT_LINE = `src/components/BottomNav.tsx(1,15): error TS2614: Module '"../App"' has no exported member 'Screen'. Did you mean to use 'import Screen from "../App"' instead?`;
const ERRORS = parseTscErrors(REPORT_LINE);
const BOTTOM_NAV = `import { Screen } from '../App';\nexport default function BottomNav({ active }: { active: Screen }) { return <nav>{active}</nav>; }\n`;
const OLD_APP = `import { useState } from 'react';\nexport default function App() { const [n] = useState(0); return <div>{n}</div>; }\n`;

describe('the cause: the fix is in the IMPORTED file', () => {
  it('parses the report line exactly', () => {
    expect(ERRORS).toHaveLength(1);
    expect(ERRORS[0].file).toBe('src/components/BottomNav.tsx');
  });

  it('names App.tsx, forbids rewriting BottomNav, and points at a shared types file', () => {
    const causes = tscErrorCauses(ERRORS, { 'src/components/BottomNav.tsx': BOTTOM_NAV, 'src/App.tsx': OLD_APP });
    expect(causes.map((c) => c.id)).toEqual(['export-missing:src/App.tsx:Screen']);
    const advice = causes[0].advice;
    expect(advice).toContain('Do NOT rewrite `src/components/BottomNav.tsx`');
    expect(advice).toContain('`src/App.tsx` does not define `Screen` at all');
    expect(advice).toContain('src/types.ts');
    // The compiler's own suggestion would import the App component AS the type.
    expect(advice).toContain('Ignore the compiler\'s "import Screen from …" suggestion');
  });

  it('declared but not exported ⇒ "add export", not "define it"', () => {
    const app = `type Screen = 'home' | 'add';\nexport default function App() { return null; }\n`;
    const [c] = tscErrorCauses(ERRORS, { 'src/App.tsx': app });
    expect(c.advice).toContain('declares `Screen` but does not export it');
  });

  it('🔒 claims nothing it cannot see: target not held, target already exports it, or `export *`', () => {
    expect(tscErrorCauses(ERRORS, { 'src/components/BottomNav.tsx': BOTTOM_NAV })).toHaveLength(0);
    expect(tscErrorCauses(ERRORS, { 'src/App.tsx': `export type Screen = 'a';\nexport default function App() { return null; }` })).toHaveLength(0);
    expect(tscErrorCauses(ERRORS, { 'src/App.tsx': `export * from './types';\nexport default function App() { return null; }` })).toHaveLength(0);
  });

  it('the shadow case keeps its own advice — both files present is not "missing export"', () => {
    const shadowErr = parseTscErrors(`src/hooks/useQ.ts(2,10): error TS2305: Module '"../data"' has no exported member 'seed'.`);
    const ids = tscErrorCauses(shadowErr, {
      'src/data.ts': 'export const other = 1;',
      'src/data/index.ts': 'export const seed = 1;',
    }).map((c) => c.id);
    expect(ids).toEqual(['index-shadowed:src/data']);
  });

  it('exportsName / declaresName read the shapes TypeScript accepts', () => {
    expect(exportsName('export interface Screen {}', 'Screen')).toBe(true);
    expect(exportsName('type S = 1; export { S as Screen };', 'Screen')).toBe(true);
    expect(exportsName('export type { Screen } from "./t";', 'Screen')).toBe(true);
    expect(exportsName('export const ScreenList = [];', 'Screen')).toBe(false);
    expect(exportsName('', 'Screen')).toBeNull();
    expect(declaresName('enum Screen { A }', 'Screen')).toBe(true);
    expect(declaresName('const Screens = 1', 'Screen')).toBe(false);
  });

  it('candidates are relative-only and bounded', () => {
    const many = parseTscErrors([
      `src/a.ts(1,1): error TS2305: Module '"./x"' has no exported member 'A'.`,
      `src/a.ts(2,1): error TS2305: Module '"./y"' has no exported member 'B'.`,
      `src/a.ts(3,1): error TS2305: Module '"./z"' has no exported member 'C'.`,
      `src/a.ts(4,1): error TS2305: Module '"react"' has no exported member 'D'.`,
    ].join('\n'));
    const c = exportTargetCandidates(many);
    expect(new Set(c.map((p) => p.replace(/(\/index)?\.(tsx?|jsx?)$/, ''))).size).toBe(MAX_EXPORT_TARGETS);
    expect(c).toContain('src/x.tsx');
    expect(c).toContain('src/y/index.ts');
    expect(c.some((p) => p.includes('react'))).toBe(false);
  });
});

describe('the note: an error that waits on another file is not "fix it NOW, here"', () => {
  it('🔴 the report case: ⏳ names App.tsx and never says "before writing the next file"', () => {
    const note = writeTypecheckNote(ERRORS, ['src/components/BottomNav.tsx'], {
      'src/components/BottomNav.tsx': BOTTOM_NAV, 'src/App.tsx': OLD_APP,
    });
    expect(note).toContain('fixed in ANOTHER file — src/App.tsx');
    expect(note).toContain('Do NOT rewrite src/components/BottomNav.tsx');
    expect(note).not.toContain('before writing the next file');
    expect(remedyFileFor(ERRORS[0], { 'src/App.tsx': OLD_APP })).toBe('src/App.tsx');
  });

  it('REVERSION: without the target file in hand, the note falls back to the old wording (why the dispatcher reads it)', () => {
    const note = writeTypecheckNote(ERRORS, ['src/components/BottomNav.tsx'], { 'src/components/BottomNav.tsx': BOTTOM_NAV });
    expect(note).toContain('before writing the next file');
  });

  it('mixed: the file\'s own error is still "fix NOW", the waiting one is named separately', () => {
    const errs = parseTscErrors([
      REPORT_LINE,
      `src/components/BottomNav.tsx(2,40): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`,
    ].join('\n'));
    const note = writeTypecheckNote(errs, ['src/components/BottomNav.tsx'], { 'src/App.tsx': OLD_APP });
    expect(note).toContain('⛔ TYPECHECK after this write: 1 error(s)');
    expect(note).toContain('⏳ TYPECHECK after this write: 1 error(s)');
  });

  it('a missing relative FILE waits on that file — and the no-placeholder rule still arrives with it', () => {
    const errs = parseTscErrors(`src/App.tsx(12,44): error TS2307: Cannot find module './pages/Reports' or its corresponding type declarations.`);
    const note = writeTypecheckNote(errs, ['src/App.tsx'], { 'src/App.tsx': 'import Reports from "./pages/Reports";' });
    expect(note).toContain('fixed in ANOTHER file — src/pages/Reports');
    expect(note).toMatch(/NEVER write a placeholder\/stub/);
  });

  it('an ordinary error is untouched: same words as before', () => {
    const errs = parseTscErrors(`src/a.ts(3,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`);
    const note = writeTypecheckNote(errs, ['src/a.ts'], { 'src/a.ts': 'x' });
    expect(note).toContain('fix them NOW, in this turn, before writing the next file');
    expect(note).not.toContain('⏳');
  });
});

describe('WIRING — the dispatcher fetches the imported file so the note can say it', () => {
  class Act implements ActuatorPort {
    files = new Map<string, string>([['tsconfig.json', '{}'], ['src/App.tsx', OLD_APP]]);
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand(_w: string, cmd: string) {
      return /\btsc\b/.test(cmd) ? { exitCode: 2, stdout: REPORT_LINE, stderr: '' } : { exitCode: 0, stdout: '', stderr: '' };
    }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }

  it('writing BottomNav returns the ⏳ note naming App.tsx', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-1', new WorkspaceState(stream), stream);
    const out = await d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/components/BottomNav.tsx', content: BOTTOM_NAV } }, 'architect');
    const text = String(out.content);
    expect(text).toContain('fixed in ANOTHER file — src/App.tsx');
    expect(text).not.toContain('before writing the next file');
  });

  it('UPSTREAM: the architect prompt puts shared types in src/types.ts, written first, never imported from App.tsx', () => {
    const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(prompt).toContain('SHARED TYPES LIVE IN ONE FILE, WRITTEN FIRST');
    expect(prompt).toContain('NEVER import a type from `App.tsx`');
  });
});
