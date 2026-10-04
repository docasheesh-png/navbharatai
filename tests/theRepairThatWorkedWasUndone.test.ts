// Autopsy 6cd698cc (2026-10-01): "Build an app best than chatgpt…", Weak, ok, 10.6 min, ₹129.17.
//
// The click explorer found the theme button broken. The repair pass found the cause and fixed it in 61 s,
// then — told by the code reviewer's prompt to "verify the app builds and the feature genuinely works" —
// ran the production build, a dev server, the preview and a browser of its own until its 150 s ran out, and
// the platform undid the working fix. Earlier the stylesheet repair wrote nothing and told the user "The
// stylesheet now defines every one of the 29 previously unmatched classes". Every case below uses the
// report's own text, code or tool output.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claimsAChange, repairClaimWithoutChange, NO_CHANGE_LINE } from '../src/server/AgentV3/repairClaim';
import { PLATFORM_CHECKS_THE_FIX, PLATFORM_CHECK_TOOLS, withoutPlatformCheckTools } from '../src/server/AgentV3/repairScope';
import { explorerRepairPrompt } from '../src/server/AgentV3/explorerRepair';
import { greenRepairPrompt } from '../src/server/AgentV3/greenReviewPolicy';
import {
  typeOnlyHealTargets, healedTypeOnlyNames, withoutHealedTypeOnly, typeOnlyHealNote, typeOnlyErrorName,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { fixTypeOnlyValueImports, parseTscErrors } from '../src/server/AgentV3/EndgameRepair';
import { deterministicImportFixes } from '../src/server/AgentV3/SimpleBuilder';
import { findDetachedMethods, detachedMethodNote } from '../src/server/AgentV3/detachedMethod';
import { submitTargetIn } from '../src/server/AgentV3/journeyDerivation';
import { simulatedResultIssues } from '../src/server/AgentV3/AuthenticityAnalysis';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const read = (p: string) => readFileSync(p, 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ROUTE = strip(read('src/server/routes/agentv3.ts'));
const RUNNER = strip(read('src/server/AgentV3/AgentRunner.ts'));
const DISPATCHER = strip(read('src/server/AgentV3/ToolDispatcher.ts'));
const SIMPLE = strip(read('src/server/AgentV3/SimpleBuilder.ts'));

// The stylesheet repair's closing reply, verbatim from the report.
const CSS_REPAIR_REPLY = 'I added the missing CSS rules so the chat interface styles match the class names used in the components. '
  + 'The stylesheet now defines every one of the 29 previously unmatched classes, including the sidebar header/body/footer, '
  + 'session list and session items, chat layout, composer input and send button.';

describe('1 · a repair pass that changed nothing does not say it changed something', () => {
  it('the report\'s sentence is a claim of a change', () => {
    expect(claimsAChange(CSS_REPAIR_REPLY)).toBe(true);
    expect(claimsAChange('Every screen is now fully styled.')).toBe(false); // says nothing about a change it made
    expect(claimsAChange('NOT A BUG 1: the sort already reads the edited list')).toBe(false);
  });
  it('withheld only for OUR repair, on its closing turn, when the run wrote nothing', () => {
    const base = { platformRequest: true, finalTurn: true, changesThisRun: 0, text: CSS_REPAIR_REPLY };
    expect(repairClaimWithoutChange(base)).toBe(true);
    expect(repairClaimWithoutChange({ ...base, changesThisRun: 1 })).toBe(false); // it did write — the claim may stand
    expect(repairClaimWithoutChange({ ...base, platformRequest: false })).toBe(false); // the user's own build: claim audit's job
    expect(repairClaimWithoutChange({ ...base, finalTurn: false })).toBe(false);
  });

  const runOnce = async (writes: boolean): Promise<string[]> => {
    let changes = 7; // writes the BUILD made before this repair — the run must ask about itself
    let call = 0;
    const client: MessagesCreateClient = {
      messages: {
        create: async () => {
          call += 1;
          if (call === 1 && writes) {
            return { content: [{ type: 'tool_use', id: 'w', name: 'write_file', input: { path: 'src/index.css', content: '.a{}' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } as never;
          }
          return { content: [{ type: 'text', text: CSS_REPAIR_REPLY }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as never;
        },
      },
    };
    const dispatcherStub = {
      dispatch: async (tu: { id: string }) => { changes += 1; return { tool_use_id: tu.id, content: 'ok', is_error: false }; },
      changeCount: () => changes,
    };
    const stream = new AgentEventStream();
    const said: string[] = [];
    stream.subscribe((e) => { if (e.type === 'narration') said.push(e.text); }, false);
    await new AgentRunner({
      client: new ClaudeClient(client), dispatcher: dispatcherStub as never, state: new WorkspaceState(stream), events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), platformRequest: true,
    }).run('The app is built and compiles. CSS class mismatch: 29 class names…');
    return said;
  };
  it('🔴 the stylesheet repair that wrote nothing: the user sees "no change", never the claim', async () => {
    const said = await runOnce(false);
    expect(said.join('\n')).not.toContain('now defines every one');
    expect(said).toContain(NO_CHANGE_LINE);
  });
  it('a repair that DID write keeps its own words', async () => {
    const said = await runOnce(true);
    expect(said.join('\n')).toContain('now defines every one');
  });
  it('SOURCE: the narration asks the run\'s own change count, taken at run start', () => {
    expect(RUNNER).toMatch(/const changesAtRunStart = typeof dispatcher\.changeCount === 'function'/);
    expect(RUNNER).toMatch(/repairClaimWithoutChange\(\{ platformRequest: this\.opts\.platformRequest === true, finalTurn: turn\.toolUses\.length === 0, changesThisRun/);
    expect(DISPATCHER).toMatch(/changeCount\(\): number \{[\s\S]{0,120}return this\._writeSeq \+ this\._delegateWrites;/);
  });
});

describe('2 · a repair the platform checks itself does not check itself', () => {
  const finding = 'In a real browser, pressing "☀️ light" throws an error in the app. The browser reported: "Cannot read properties of undefined (reading \'state\')".';
  it('🔴 the explorer repair is told the platform re-checks, and is never told to verify on its own', () => {
    const p = explorerRepairPrompt('Build an app best than chatgpt', [finding]);
    expect(p).toContain(PLATFORM_CHECKS_THE_FIX);
    expect(p).toContain('A real browser test');
    expect(p).not.toMatch(/strict code review/);
    expect(p).not.toMatch(/verify the app builds/i);
    expect(PLATFORM_CHECKS_THE_FIX).toMatch(/do NOT start the app, a dev server or the preview/);
    expect(PLATFORM_CHECKS_THE_FIX).toMatch(/Change only what the problem\(s\) above need/);
  });
  it('the green functional repair carries the same sentence', () => {
    expect(greenRepairPrompt('x', ['sort ignores edits'])).toContain(PLATFORM_CHECKS_THE_FIX);
  });
  it('no browser of its own: the five platform-check tools are removed, nothing else', () => {
    const tools = defaultToolCatalog();
    const kept = withoutPlatformCheckTools(tools);
    for (const t of kept) expect(PLATFORM_CHECK_TOOLS.has(t.name)).toBe(false);
    expect(kept.some((t) => t.name === 'edit_file')).toBe(true);
    expect(kept.some((t) => t.name === 'bash')).toBe(true);
    expect(tools.length - kept.length).toBe(tools.filter((t) => PLATFORM_CHECK_TOOLS.has(t.name)).length);
    expect(tools.some((t) => t.name === 'browser_action')).toBe(true); // the catalogue really has it to remove
  });
  it('SOURCE: both platform-checked repairs get the prompt, the trimmed tools and focusedRepair', () => {
    const explorer = ROUTE.slice(ROUTE.indexOf('repair: async (findings, signal) =>'), ROUTE.indexOf('changedSince: async (s0)'));
    expect(explorer).toContain('explorerRepairPrompt(prompt, findings)');
    expect(explorer).not.toContain('judgeRepairPrompt');
    expect(explorer).toContain('focusedRepair: true');
    expect(explorer).toContain('tools: withoutPlatformCheckTools(baseRunnerOpts.tools)');
    const green = ROUTE.slice(ROUTE.indexOf('const repairRunner = new AgentRunner({'), ROUTE.indexOf("runInPass('reviewer-functional-repair'"));
    expect(green).toContain('focusedRepair: true');
    expect(green).toContain('tools: withoutPlatformCheckTools(baseRunnerOpts.tools)');
  });
  it('SOURCE: a focused repair gets no end-of-turn style hand-back and no style note in the done steer', () => {
    expect(RUNNER).toMatch(/readiness\.ready && styleResumes === 0 && !this\.opts\.focusedRepair/);
    expect(RUNNER).toMatch(/styleResumeEnabled\(\) && !this\.opts\.focusedRepair/);
  });
});

// The fast lane's useTheme.ts from the report (trimmed), the contract it imported from, and tsc's own line.
const TYPES = 'export enum Theme {\n  Light = "light",\n  Dark = "dark",\n  System = "system"\n}\nexport interface ChatMessage { id: string }\n';
const USE_THEME = [
  'import type { Theme } from "../types";',
  '',
  'const store = {',
  '  listeners: new Set<() => void>(),',
  '  state: { theme: Theme.Light as Theme },',
  '  get() { return this.state.theme; },',
  '  set(newTheme: Theme) { if (this.state.theme !== newTheme) { this.state.theme = newTheme; } },',
  '};',
  '',
  'export function useTheme(): [Theme, (theme: Theme) => void] {',
  '  return [store.get(), store.set];',
  '}',
  '',
].join('\n');
const TSC = "src/hooks/useTheme.ts(5,19): error TS1361: 'Theme' cannot be used as a value because it was imported using 'import type'.";

describe('3 · a type-only import of an enum is fixed where it is written', () => {
  it('🔴 the write door fixes the report\'s TS1361 in a file this build wrote, and says so', () => {
    const errors = parseTscErrors(TSC);
    expect(typeOnlyErrorName(errors[0])).toBe('Theme');
    const targets = typeOnlyHealTargets(errors, new Set(['src/hooks/useTheme.ts']));
    expect(targets).toHaveLength(1);
    const fix = fixTypeOnlyValueImports({ 'src/hooks/useTheme.ts': USE_THEME }, targets);
    expect(fix.files['src/hooks/useTheme.ts']).toMatch(/^import \{ Theme \} from "\.\.\/types";/);
    const healed = healedTypeOnlyNames(fix.fixed);
    expect([...(healed.get('src/hooks/useTheme.ts') ?? [])]).toEqual(['Theme']);
    expect(withoutHealedTypeOnly(errors, healed)).toEqual([]);
    expect(typeOnlyHealNote(healed)).toMatch(/Fixed automatically: src\/hooks\/useTheme\.ts \(Theme\)/);
  });
  it('a file the user wrote and this build never touched is left to the model', () => {
    expect(typeOnlyHealTargets(parseTscErrors(TSC), new Set(['src/App.tsx']))).toEqual([]);
  });
  it('🔴 the files a timed-out fast lane hands over get the lane\'s import fixes too', async () => {
    const out = await deterministicImportFixes([
      { path: 'src/types.ts', content: TYPES },
      { path: 'src/hooks/useTheme.ts', content: USE_THEME },
    ]);
    expect(out.changes).toBeGreaterThan(0);
    expect(out.files['src/hooks/useTheme.ts']).not.toMatch(/import type \{ Theme \}/);
  });
  it('SOURCE: the write-time typecheck heals before it quotes; the salvage runs the shared fixes', () => {
    expect(DISPATCHER).toMatch(/const healedTypeOnly = errors\.length > 0 \? await this\.healTypeOnlyImportsAtWrite\(errors, tsPaths, sources\)/);
    expect(DISPATCHER).toMatch(/return healedNote \+ writeTypecheckNote\(errors, tsPaths, sources\);/);
    const salvage = SIMPLE.slice(SIMPLE.indexOf('const salvage = [...generatedSoFar]'), SIMPLE.indexOf("'simple-build-salvage'"));
    expect(salvage).toContain('await deterministicImportFixes(salvage)');
  });
});

describe('4 · a method that reads `this`, handed out uncalled, is named at write time', () => {
  it('🔴 the report\'s theme hook: `store.set` returned uncalled', () => {
    const found = findDetachedMethods('src/hooks/useTheme.ts', USE_THEME);
    expect(found).toEqual([{ file: 'src/hooks/useTheme.ts', line: 11, object: 'store', method: 'set' }]);
    expect(detachedMethodNote({ 'src/hooks/useTheme.ts': USE_THEME })).toContain('`store.set`');
  });
  it('called, bound, wrapped, tested or assigned is fine; a method with no `this` is fine', () => {
    const ok = USE_THEME.replace('return [store.get(), store.set];', 'return [store.get(), (t: Theme) => store.set(t)];');
    expect(findDetachedMethods('a.ts', ok)).toEqual([]);
    expect(findDetachedMethods('a.ts', USE_THEME.replace('store.set];', 'store.set.bind(store)];'))).toEqual([]);
    expect(findDetachedMethods('a.ts', 'const s = { n: 1, f() { return 2; } };\nexport const g = s.f;\n')).toEqual([]);
    expect(findDetachedMethods('a.ts', 'const s = { n: 1, f() { return this.n; } };\nif (s.f) s.f();\nexport const ok = !!s.f;\n')).toEqual([]);
    // `this` inside a nested ordinary function is that function's, not the method's.
    expect(findDetachedMethods('a.ts', 'const s = { f() { return function () { return this; }; } };\nexport const g = s.f;\n')).toEqual([]);
  });
  it('destructuring the method out counts too', () => {
    expect(findDetachedMethods('a.ts', 'const s = { n: 1, f() { return this.n; } };\nconst { f } = s;\nexport { f };\n'))
      .toEqual([{ file: 'a.ts', line: 2, object: 's', method: 'f' }]);
  });
  it('SOURCE: the note rides the write-time steering notes', () => {
    expect(DISPATCHER).toMatch(/storeLoop \+= detachedMethodNote\(files\);/);
  });
});

describe('5 · the journey finds a send button by the name the browser gives it', () => {
  it('🔴 an icon button named by aria-label is found by that name', () => {
    expect(submitTargetIn('<form onSubmit={send}><textarea /><button type="submit" className="btn-primary nb-composer-send" aria-label="Send message" disabled={!v}>➤</button></form>'))
      .toEqual({ kind: 'text', value: 'Send message' });
  });
  it('a dynamic aria-label or aria-labelledby falls back to the submit role; plain text still works', () => {
    expect(submitTargetIn('<button type="submit" aria-label={label}>➤</button>')).toEqual({ kind: 'role', value: 'submit' });
    expect(submitTargetIn('<button type="submit" aria-labelledby="x">➤</button>')).toEqual({ kind: 'role', value: 'submit' });
    expect(submitTargetIn('<button type="submit">Add task</button>')).toEqual({ kind: 'text', value: 'Add task' });
    expect(submitTargetIn('<button onClick={add} aria-label="Add expense">+</button>')).toEqual({ kind: 'text', value: 'Add expense' });
  });
});

describe('6 · a made-up credential is not a made-up result', () => {
  it('🔴 "Generates a mock API key for the demo user" is not disclosed as demo results', () => {
    const files = { 'src/utils/markdown.ts': '/**\n * Internal Helper: Generates a mock API key for the demo user.\n */\nexport function k() { return 1; }\n' };
    expect(simulatedResultIssues(files)).toEqual([]);
  });
  it('a mock API that returns results is still caught', () => {
    expect(simulatedResultIssues({ 'src/a.ts': '// mock api for the song results\nexport const r = 1;\n' }).length).toBe(1);
  });
});
