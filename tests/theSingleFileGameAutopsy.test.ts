// AUTOPSY f496c75b (2026-09-30) — "Single file html code se mobile friendly 3d fight game banao realastic".
//
// A Weak build ran 17.7 minutes and billed ₹448.18. The user asked for one HTML file and got a 25-file
// Vite + TypeScript project. The platform's own tools made most of the struggle:
//  • the 3D recipe (`generate_game_3d`) and `object_spec` were named in the prompt but not reachable;
//  • our import heal added imports for property names (`state`, `load`) and then had to undo them;
//  • a late success un-benched a provider the report had just called benched;
//  • a heavy 3D game was scored as `coding` and opened on the cheapest rung;
//  • an `import type` of an enum blocked the compile;
//  • the unused-import sweep ran after the green latch and was refused;
//  • the user was offered a fix for a file the repair had already deleted.
// Each block below locks one of these, and each was checked by reverting its fix.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectFrameworkFromPrompt as detectFramework, wantsSingleHtmlFile } from '../src/lib/frameworkDetect';
import { SINGLE_HTML_FILE_RULE } from '../src/server/AgentV3/systemPrompt';
import { RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';
import { roleConfig } from '../src/server/AgentV3/AgentRegistry';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { addMissingProjectImports, fixTypeOnlyValueImports } from '../src/server/AgentV3/ImportExportReconcile';
import { makeMultiProviderTurnRunner, createBuildBenchRegistry, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnResult } from '../src/server/AgentV3/types';
import { namesHeavyGame } from '../src/server/lib/appComplexitySignals';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { parseReviewOutput } from '../src/server/AgentV3/ReviewerAgent';
import { contractBlock, ENUM_IMPORT_RULE } from '../src/server/AgentV3/SimpleBuilder';

const REPORT_PROMPT = 'Single file html code se mobile friendly 3d fight game banao realastic';
const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('1 · a single-file HTML ask is built as plain HTML', () => {
  it('the report\'s own prompt selects the static template', () => {
    expect(detectFramework(REPORT_PROMPT)).toBe('static');
    expect(wantsSingleHtmlFile(REPORT_PROMPT)).toBe(true);
  });
  it('the other ways people ask for it', () => {
    for (const p of ['ek hi html file me calculator bana do', 'todo list in html, css and js', 'a single-file html dashboard']) {
      expect(detectFramework(p), p).toBe('static');
    }
  });
  it('precision: an html FILE mentioned in passing, or an explicit React / Vue, is not the static template', () => {
    expect(detectFramework('fix the index.html file so the title shows')).not.toBe('static');
    expect(detectFramework('an html page for my shop')).not.toBe('static');
    expect(detectFramework('build a react app in a single html file')).not.toBe('static');
    expect(detectFramework('Vue app in a single html file')).toBe('vue');
  });
  it('the one-file rule reaches BOTH lanes, only when one file was asked for', () => {
    expect(SINGLE_HTML_FILE_RULE).toMatch(/index\.html/);
    expect(route).toContain("framework === 'static' && wantsSingleHtmlFile(prompt) ? SINGLE_HTML_FILE_RULE : ''");
    expect(route).toContain('buildPrompt = `${singleHtmlFileRule}\\n\\n${buildPrompt}`');
    expect(route).toContain('runSimpleBuild({ prompt: planning.text + singleHtmlFileSuffix,');
    expect(route).toContain("const singleHtmlFileSuffix = singleHtmlFileRule ? `\\n\\n${singleHtmlFileRule}` : '';");
  });
});

describe('2 · the tools the prompt names for a 3D game are reachable', () => {
  it('generate_game_3d is a recipe and object_spec is the architect\'s', () => {
    expect(RECIPE_TOOLS).toContain('generate_game_3d');
    expect(roleConfig('architect').tools as string[]).toContain('object_spec');
  });
});

class RecipeActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['package.json', '{"name":"app","dependencies":{"react":"^18.0.0"}}'],
    ['src/types.ts', 'export enum GameState { MENU = \'MENU\', PLAYING = \'PLAYING\' }\nexport function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }\n'],
  ]);
  async readFile(_ws: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT ' + p); return f; }
  async writeFile(_ws: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number) { return `https://x-${port}.dev`; }
}

describe('3 · the import heal adds no imports for property and method names', () => {
  it('the game recipes\' own output needs no added import', async () => {
    const act = new RecipeActuator();
    const s = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws', new WorkspaceState(s), s);
    for (const n of ['generate_game_runtime', 'generate_game_controller', 'generate_game_systems', 'generate_game_vfx']) {
      await d.dispatch({ id: n, name: n, input: {} }, 'architect');
    }
    const files: Record<string, string> = {};
    for (const [k, v] of act.files) if (/\.tsx?$/.test(k)) files[k] = v;
    expect(Object.keys(files).length).toBeGreaterThan(3);
    const res = await addMissingProjectImports(files);
    expect(res.added).toEqual([]);
  });
  it('a member named like an export is not a use; a shorthand property still is', async () => {
    const base = { 'src/state.ts': 'export const state = { n: 0 };\n' };
    const member = await addMissingProjectImports({ ...base, 'src/a.ts': 'export class A { state = 1; load() { return this.state; } }\nconst o = { state: 2 };\nexport default o;\n' });
    expect(member.added).toEqual([]);
    const shorthand = await addMissingProjectImports({ ...base, 'src/b.ts': 'export const o = { state };\n' });
    expect(shorthand.added.length).toBe(1);
  });
});

describe('4 · an enum imported as a type is healed, and the contract says not to', () => {
  it('value reads are rewritten; pure type uses are left alone', async () => {
    const r = await fixTypeOnlyValueImports({
      'src/types.ts': "export enum InputAction { JUMP = 'JUMP' }\nexport interface PlayerInputState { j: boolean }\nexport type Mode = 'a';\n",
      'src/useInput.ts': "import type { InputAction, PlayerInputState } from './types';\nexport const s: PlayerInputState = { j: false };\nexport const m = { [InputAction.JUMP]: false };\n",
      'src/a.ts': "import { type InputAction, type Mode } from './types';\nexport const x: Mode = 'a'; export const y = InputAction.JUMP;\n",
      'src/c.ts': "import type { InputAction } from './types';\nexport let k: InputAction;\n",
    });
    expect(r.files['src/useInput.ts'].split('\n')[0]).toBe("import { InputAction, type PlayerInputState } from './types';");
    expect(r.files['src/a.ts'].split('\n')[0]).toBe("import { InputAction, type Mode } from './types';");
    expect(r.files['src/c.ts'].split('\n')[0]).toBe("import type { InputAction } from './types';");
    expect(r.fixes.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/useInput.ts']);
  });
  it('every contract the fast lane hands out carries the enum rule', () => {
    expect(contractBlock('export enum A { X }')).toContain(ENUM_IMPORT_RULE);
    expect(contractBlock('export enum A { X }', { path: 'src/types.ts', from: './types' })).toContain(ENUM_IMPORT_RULE);
  });
});

describe('5 · a bench that was announced stays, even after a late success', () => {
  const ok = (name: string): TurnResult => ({ text: `from ${name}`, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, model: name } as unknown as TurnResult);
  const params = { model: 'x', system: '', messages: [], tools: [], maxTokens: 10 } as never;
  it('a benched family with no live streak is still skipped', async () => {
    const bench = createBuildBenchRegistry();
    bench.benchedFamilies.add('GLM'); // the streak was deleted by a late success; the announcement was not
    const calls: string[] = [];
    const runner = makeMultiProviderTurnRunner([
      { name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { calls.push('GLM'); return ok('GLM'); } } },
      { name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => { calls.push('KIMI'); return ok('KIMI'); } } },
    ] as unknown as NamedRunner[], { bench });
    await runner.runTurn(params);
    expect(calls).toEqual(['KIMI']);
  });
});

describe('6 · a heavy game is a complex app', () => {
  it('the report\'s prompt is complex and does not open on the cheapest rung', () => {
    expect(namesHeavyGame(REPORT_PROMPT)).toBe(true);
    expect(analyzeRequest({ prompt: REPORT_PROMPT } as never).taskType).toBe('complex_app');
  });
  it('a simple game keeps the fast path', () => {
    expect(namesHeavyGame('make a snake game in html css js')).toBe(false);
    expect(analyzeRequest({ prompt: 'make a snake game in html css js' } as never).taskType).not.toBe('complex_app');
  });
});

describe('7 · the unused-import sweep runs before the green latch', () => {
  it('it sits among the finishing passes, not after the latch', () => {
    const sweep = route.indexOf('const cleaned = sweepUnusedImports(src);');
    expect(sweep).toBeGreaterThan(0);
    expect(route.indexOf('sweepUnusedImports(', sweep + 40)).toBe(-1);
    expect(sweep).toBeLessThan(route.indexOf('E2E NET, WRITTEN NOT RUN'));
    expect(sweep).toBeLessThan(route.indexOf('latchGreen(workspaceId'));
  });
});

describe('8 · no offer about a file that is gone', () => {
  it('a finding under a file heading carries that file', () => {
    const issues = parseReviewOutput('Review of `src/hooks/useInput.ts`:\n[WARNING] event listeners registered every render\n\n**src/App.tsx**\n[CRITICAL] crashes on load\n[WARNING] no file here');
    expect(issues.find((i) => /listeners/.test(i.message))?.file).toBe('src/hooks/useInput.ts');
    expect(issues.find((i) => /crashes/.test(i.message))?.file).toBe('src/App.tsx');
  });
  it('a finding with no heading has no file', () => {
    expect(parseReviewOutput('[WARNING] something')[0].file).toBeUndefined();
  });
  it('the route drops offers for missing files and says so, admin-only', () => {
    expect(route).toContain("code: 'REVIEW_OFFER_FILE_GONE'");
    expect(route).toContain('offered = offeredBeforeGone.filter((t) => !gone.includes(t));');
    // Both registries are module-private sets; read them where they are declared.
    for (const [file, name] of [['src/server/AgentV3/BuildDiagnostics.ts', 'PROCESS_ONLY_CODES'], ['src/server/AgentV3/buildFindingSuggestions.ts', 'NEVER_SUGGEST']]) {
      const src = readFileSync(file, 'utf8');
      const at = src.indexOf(`const ${name} = new Set([`);
      expect(src.slice(at, src.indexOf(']);', at)), name).toContain("'REVIEW_OFFER_FILE_GONE'");
    }
  });
});
