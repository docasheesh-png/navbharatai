// AUTOPSY e725e002, the prevention half (2026-09-29, admin: "architect ko index.css replace na karne
// wala fix bhi karo").
//
// The architect rewrote `src/index.css` wholesale with its own styles. The scaffold's copy of that file
// IS the design kit, so every kit class vanished with it — and the design repair, told the kit was
// "already in the project", then gave four pages `.nb-empty` states with no rules behind them.
// `kitRestorePatch` repairs that after the build; this is the half that stops it happening: at the write
// door (write_file, write_files_batch — the fast lane writes through write_file too), a rewrite of a
// stylesheet that carried the kit keeps every kit rule it dropped without restyling, exactly as the old
// file had it.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  keepKitOnRewrite, kitKeepToolNote, KIT_KEEP_MARKER, KIT_SIGNATURE_MIN,
} from '../src/server/AgentV3/kitRestore';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { findUndefinedClasses } from '../src/server/AgentV3/CssConsistency';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const ON = {} as NodeJS.ProcessEnv;

// What the architect wrote over the scaffold's kit in e725e002, in shape: its own palette and layout.
const ARCHITECT_CSS = `:root { --brand: #e11d48; }
body { margin: 0; font-family: sans-serif; }
.shop-header { display: flex; padding: 16px; background: var(--brand); }
.product-grid { display: grid; gap: 16px; }
`;

describe('keepKitOnRewrite — a rewrite of the stylesheet keeps the kit rules it dropped', () => {
  it('the e725e002 case: the kit survives the rewrite, and the screens that use it stay styled', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON);
    expect(keep).not.toBeNull();
    for (const c of ['nb-empty', 'nb-empty-title', 'nb-hero', 'card', 'btn-primary', 'nb-table']) expect(keep!.kept).toContain(c);
    const page = { 'src/pages/Orders.tsx': '<div className="nb-empty"><h2 className="nb-empty-title">No orders</h2><p className="nb-empty-text">x</p></div>' };
    expect(findUndefinedClasses({ ...page, 'src/index.css': keep!.content })).toEqual([]);
  });

  it('the model\'s own content comes first, byte for byte', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)!;
    expect(keep.content.startsWith(ARCHITECT_CSS.trimEnd())).toBe(true);
    expect(keep.content).toContain(KIT_KEEP_MARKER);
  });

  it('a class the rewrite RESTYLES is the model\'s — its kit rule is not put back', () => {
    const restyled = `${ARCHITECT_CSS}.card { border-radius: 0; background: hotpink; }\n`;
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, restyled, ON)!;
    expect(keep.kept).not.toContain('card');
    expect(keep.content.match(/^\.card \{/gm)?.length).toBe(1);
  });

  it('keeps the rules AS THE OLD FILE HAD THEM — a palette the app tuned stays tuned', () => {
    const tuned = DESIGN_KIT_CSS.replace('--muted: #6b7280;', '--muted: #123456;')
      .replace('.nb-empty { display: flex;', '.nb-empty { display: flex; border: 2px dashed red;');
    const keep = keepKitOnRewrite('src/index.css', tuned, ARCHITECT_CSS, ON)!;
    expect(keep.content).toContain('border: 2px dashed red');
    expect(keep.content).toContain('--muted: #123456');
  });

  it('carries the tokens, light and dark, only where the new content does not set them', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)!;
    expect(keep.tokens).toContain('--muted');
    expect(keep.content).toMatch(/prefers-color-scheme: dark[\s\S]*--muted/);
    const ownMuted = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, `${ARCHITECT_CSS}:root { --muted: #999; }\n`, ON)!;
    expect(ownMuted.tokens).not.toContain('--muted');
  });

  it('brings the keyframes the kept rules animate with', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)!;
    expect(keep.content).toMatch(/@keyframes nb-spin/);
    expect(keep.content).toMatch(/@media \(max-width: 820px\) \{\n {2}\.nb-shell/);
  });

  it('says nothing when the old file did not carry the kit — a shared class name is not the kit', () => {
    const handWritten = '.card { padding: 4px; }\n.row { display: flex; }\n';
    expect(KIT_SIGNATURE_MIN).toBeGreaterThan(2);
    expect(keepKitOnRewrite('src/index.css', handWritten, ARCHITECT_CSS, ON)).toBeNull();
  });

  it('says nothing for a rewrite that keeps the kit itself', () => {
    expect(keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, `${DESIGN_KIT_CSS}\n.extra-thing { color: red; }\n`, ON)).toBeNull();
  });

  it('is idempotent — rewriting the kept file with itself keeps nothing more', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)!;
    expect(keepKitOnRewrite('src/index.css', keep.content, keep.content, ON)).toBeNull();
  });

  it('only stylesheets, never indented Sass, never an empty write (another guard owns that)', () => {
    expect(keepKitOnRewrite('src/App.tsx', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)).toBeNull();
    expect(keepKitOnRewrite('src/theme.sass', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)).toBeNull();
    expect(keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, '   ', ON)).toBeNull();
    expect(keepKitOnRewrite('node_modules/x/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)).toBeNull();
  });

  it('kill switch AGENTV3_KIT_KEEP=off writes the model\'s content exactly as sent', () => {
    expect(keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, { AGENTV3_KIT_KEEP: 'off' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('the note tells the model what happened and how to do it right next time', () => {
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, ARCHITECT_CSS, ON)!;
    const note = kitKeepToolNote('src/index.css', keep);
    expect(note).toMatch(/DESIGN KIT KEPT/);
    expect(note).toMatch(/edit_file/);
  });
});

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_ws: string, p: string, content: string): Promise<void> { this.files.set(p, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

describe('the write door — every door that can replace a stylesheet keeps the kit', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  beforeEach(() => {
    act = new FakeActuator();
    act.files.set('src/index.css', DESIGN_KIT_CSS);
    const stream = new AgentEventStream();
    d = new ToolDispatcher(act, 'ws-kit-keep', new WorkspaceState(stream), stream);
  });

  it('write_file: the file on disk keeps the kit, and the model is told', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/index.css', content: ARCHITECT_CSS }), 'architect');
    const onDisk = act.files.get('src/index.css')!;
    expect(onDisk.startsWith(ARCHITECT_CSS.trimEnd())).toBe(true);
    expect(onDisk).toMatch(/\.nb-empty \{/);
    expect(res.content).toMatch(/DESIGN KIT KEPT/);
    expect(d.kitKeptTally().writes).toBe(1);
    expect(d.kitKeptTally().classes).toContain('nb-empty');
  });

  it('write_files_batch: same door, same guarantee', async () => {
    const res = await d.dispatch(call('write_files_batch', { files: [
      { path: 'src/index.css', content: ARCHITECT_CSS },
      { path: 'src/App.tsx', content: 'export default function App() { return <div className="nb-empty" />; }\n' },
    ] }), 'frontend');
    expect(act.files.get('src/index.css')!).toMatch(/\.nb-empty \{/);
    expect(res.content).toMatch(/DESIGN KIT KEPT/);
  });

  it('a brand-new stylesheet is written exactly as sent — there was no kit to keep', async () => {
    await d.dispatch(call('write_file', { path: 'src/pages/shop.css', content: ARCHITECT_CSS }), 'architect');
    expect(act.files.get('src/pages/shop.css')).toBe(ARCHITECT_CSS);
    expect(d.kitKeptTally().writes).toBe(0);
  });

  it('a sub-agent counts into the parent\'s tally', () => {
    const child = new ToolDispatcher(act, 'ws-kit-keep', new WorkspaceState(new AgentEventStream()), new AgentEventStream());
    child.shareKitKept(d.sharedKitKept());
    expect(child.kitKeptTally()).toBe(d.kitKeptTally());
  });
});

describe('the wiring — prompt, report, sub-agents', () => {
  const ROUTE = read('src/server/routes/agentv3.ts');
  it('the architect is told never to replace the stylesheet wholesale', () => {
    expect(read('src/server/AgentV3/systemPrompt.ts')).toMatch(/NEVER REPLACE `src\/index\.css` WHOLESALE/);
  });
  it('the report says when the keep fired, and sub-agents count into it', () => {
    expect(ROUTE).toMatch(/code: 'DESIGN_KIT_KEPT'/);
    expect(ROUTE).toMatch(/kitKept: \(\) => dispatcherForSubAgents\?\.sharedKitKept\(\)/);
    expect(read('src/server/AgentV3/SubAgent.ts')).toMatch(/childDispatcher\.shareKitKept\(sharedKit\)/);
  });
  it('the code is engine housekeeping, never a finding against the app', () => {
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toMatch(/'DESIGN_KIT_KEPT'/);
    expect(read('src/server/AgentV3/buildFindingSuggestions.ts')).toMatch(/'DESIGN_KIT_KEPT'/);
  });
});
