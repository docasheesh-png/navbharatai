/**
 * Autopsy c70bcbb4 (2026-10-04) — "Mujhe esa hi music player bnakar do" ("make me a music player just like
 * this one"), Weak tier, 9.2 min, YELLOW. Every fix, with the report's own input where one exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { refersToConversation } from '../src/server/AgentV3/conversationReference';
import { PER_FILE_VIOLATIONS, WHOLE_APP_VIOLATIONS, qualityNote } from '../src/server/AgentV3/writeTimeQualityCheck';
import { lintBuiltApp, a11yHandBack } from '../src/server/AgentV3/buildQualityLint';
import { dataEntryEvidence } from '../src/server/AgentV3/journeyDerivation';
import { ourCommandLabel, OUR_TSBUILDINFO } from '../src/server/AgentV3/commandTiming';
import { WRITE_TYPECHECK_TSBUILDINFO, writeTypecheckCommand } from '../src/server/AgentV3/writeTimeTypecheck';
import { ToolDispatcher, SMALL_FILE_WHOLE_LINES, SMALL_FILE_WHOLE_BYTES, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const readTool = (d: ToolDispatcher, input: Record<string, unknown>) =>
  d.dispatch({ id: 'r', name: 'read_file', input }, 'architect').then((r) => String(r.content));

const PROMPT = 'Mujhe esa hi music player bnakar do';
const read = (p: string) => readFileSync(p, 'utf8');

describe('1 · Hindi "hi" mid-sentence is not a greeting', () => {
  it('the report\'s prompt is an app order, not chat', () => {
    const a = analyzeRequest({ prompt: PROMPT } as never) as { taskType: string; complexityScore: number };
    expect(a.taskType).not.toBe('chat');
    expect(a.complexityScore).toBeGreaterThan(5);
  });

  it('a real greeting is still chat', () => {
    for (const g of ['hi', 'hii', 'hey there', 'hi there, how are you', 'thanks!', 'namaste']) {
      expect((analyzeRequest({ prompt: g } as never) as { taskType: string }).taskType, g).toBe('chat');
    }
  });

  it('Hinglish build verbs read as an order', () => {
    expect((analyzeRequest({ prompt: 'mujhe ek app bnakar do' } as never) as { taskType: string }).taskType).not.toBe('chat');
  });
});

describe('2 · "like this one" points at the conversation', () => {
  it('the report\'s prompt and its siblings, in Roman Hindi, English and Devanagari', () => {
    for (const m of [PROMPT, 'aisa hi app banao', 'isi tarah ka game bana do', 'make an app like this', 'same as this please', 'ऐसा ही ऐप बना दो', 'is jaisa website chahiye']) {
      expect(refersToConversation(m), m).toBe(true);
    }
  });

  it('a message with no pointer is sized from its own words', () => {
    for (const m of ['Mujhe music player bnakar do', 'abhi hi bana do todo app', 'make a todo app', 'esa kuch nahi']) {
      expect(refersToConversation(m), m).toBe(false);
    }
  });
});

describe('3 · a clickable div is named while the file is open, and handed back at the end', () => {
  const PLAYER_BAR = 'export default function PlayerBar(){ return (<div className="bar"><div className="art" onClick={() => open()}>x</div><button aria-label="Play">▶</button></div>); }';

  it('the write-time note names it', () => {
    expect(qualityNote('src/components/PlayerBar.tsx', PLAYER_BAR)).toMatch(/clickable div\/span/);
  });

  it('the end-of-turn hand-back carries it', () => {
    const back = a11yHandBack(lintBuiltApp({ 'src/components/PlayerBar.tsx': PLAYER_BAR }));
    expect(back[0]?.issues.join(' ')).toMatch(/clickable div\/span a keyboard cannot press/);
  });

  it('census: every violation type a linter emits is per-file or whole-app — never neither', () => {
    const src = read('src/server/AppMakerLab/intelligence/A11yLinter.ts') + read('src/server/AppMakerLab/intelligence/DesignLinter.ts');
    const types = [...new Set([...src.matchAll(/type: '([a-z-]+)'/g)].map((m) => m[1]))];
    expect(types.length).toBeGreaterThan(5);
    for (const t of types) {
      expect(PER_FILE_VIOLATIONS.has(t) !== WHOLE_APP_VIOLATIONS.has(t), `${t} must be in exactly one set`).toBe(true);
    }
  });
});

describe('4 · a search box is not data the user wants saved', () => {
  const app = (body: string) => ({ 'src/App.tsx': `export default function App(){ return (<main>${body}</main>); }` });

  it('a search input alone is not data entry', () => {
    expect(dataEntryEvidence(app('<input type="text" placeholder="Search songs, artists…" value={q} onChange={(e) => setQ(e.target.value)} />'))).toBeNull();
    expect(dataEntryEvidence(app('<input type="search" value={q} onChange={(e) => setQ(e.target.value)} />'))).toBeNull();
    expect(dataEntryEvidence(app('<input placeholder="गाना खोजें" onChange={f} />'))).toBeNull();
  });

  it('any other field beside it still counts', () => {
    expect(dataEntryEvidence(app('<input placeholder="Search" onChange={x} /><input placeholder="Contact name" onChange={y} />'))).not.toBeNull();
    expect(dataEntryEvidence(app('<input type="text" placeholder="Your name" onChange={y} />'))).not.toBeNull();
  });
});

describe('5 · our own typecheck is named in the report, not printed as its preamble', () => {
  it('the label reads the marker every platform typecheck carries', () => {
    expect(OUR_TSBUILDINFO).toBe(WRITE_TYPECHECK_TSBUILDINFO);
    expect(ourCommandLabel(writeTypecheckCommand())).toBe('typecheck (tsc --noEmit, run by NavBharatAI)');
    expect(ourCommandLabel('npx tsc --noEmit')).toBeNull();
    expect(ourCommandLabel('npm run dev')).toBeNull();
  });

  it('the report line uses it', () => {
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toContain("const cmdHead = ourCommandLabel(rec.command) ?? rec.command.split('\\n')[0].slice(0, 120);");
  });
});

describe('6 · a small file is never sliced', () => {
  it('the report\'s sliced files were all under the bound', () => {
    // usePlayer.ts 247 lines, types.ts 229, utils.ts 104, useAudio.ts 86 — each read in 2–6 slices.
    for (const n of [247, 229, 104, 86]) expect(n).toBeLessThanOrEqual(SMALL_FILE_WHOLE_LINES);
    expect(SMALL_FILE_WHOLE_BYTES).toBeGreaterThanOrEqual(16_000);
  });

  it('a range on the report\'s 247-line usePlayer.ts returns the whole file; a big file still slices', async () => {
    const act = new FakeActuator();
    act.files.set('src/usePlayer.ts', Array.from({ length: 247 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
    act.files.set('src/big.css', Array.from({ length: 528 }, (_, i) => `.r${i} { color: red; }`).join('\n'));
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-1', new WorkspaceState(stream), stream);
    const small = await readTool(d, { path: 'src/usePlayer.ts', start_line: 1, end_line: 120 });
    expect(small).toContain('the whole file — 247 lines');
    expect(small).toContain('export const v246 = 246;');
    const big = await readTool(d, { path: 'src/big.css', start_line: 1, end_line: 120 });
    expect(big).toContain('[lines 1-120 of 528');
    expect(big).not.toContain('.r400 ');
  });

  it('read_file returns a small file whole even when a range is asked', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('const smallWhole = askedRange && lines.length <= SMALL_FILE_WHOLE_LINES && full.length <= SMALL_FILE_WHOLE_BYTES;');
    expect(d).toContain('const ranged = askedRange && !smallWhole;');
  });
});

describe('7 · salvaged files that were never compiled are compiled once before the hand-off', () => {
  it('a timed-out or handed-off lane gets the typecheck the failed-verify lane already had', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/if \(sb\.reason !== 'verify_failed' && writeTypecheckEnabled\(\) && sb\.salvagedPaths\.some/);
    expect(route).toContain("withTimeout(actuator.runCommand(workspaceId, writeTypecheckCommand()), 20_000, 'salvage-typecheck')");
    expect(route).toMatch(/: unverifiedErrors;/);
  });
});
