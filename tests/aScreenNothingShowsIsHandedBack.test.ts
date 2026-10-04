// Q-202 (autopsy 3f959fde): the build changed course and left `DataPreview.tsx` and `AlgorithmSuggestions.tsx`
// behind, imported by nothing. A component THIS build wrote that nothing imports is now handed back once, in
// the end-of-turn message, so the model wires it in or deletes it.
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { orphansToHandBack, orphanInstruction, orphanHandBackEnabled, MAX_ORPHANS_LISTED } from '../src/server/AgentV3/orphanHandBack';
import { decideStyleResume, styleResumeNote } from '../src/server/AgentV3/stylePolishResume';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const read = (p: string) => readFileSync(p, 'utf8');

// The report's shape: the app shows the lottery analyser; two screens of the abandoned approach remain.
const PROJECT: Record<string, string> = {
  'src/main.tsx': "import App from './App';\nimport './index.css';\n",
  'src/index.css': '.card { padding: 8px; }',
  'src/App.tsx': "import LotteryAnalyzer from './components/LotteryAnalyzer';\nexport default function App() { return <LotteryAnalyzer />; }\n",
  'src/components/LotteryAnalyzer.tsx': 'export default function LotteryAnalyzer() { return <div className="card">Draws</div>; }\n',
  'src/components/DataPreview.tsx': 'export default function DataPreview() { return <select><option>a</option></select>; }\n',
  'src/components/AlgorithmSuggestions.tsx': 'export default function AlgorithmSuggestions() { return <ul />; }\n',
};
const WRITTEN = ['src/App.tsx', 'src/components/LotteryAnalyzer.tsx', 'src/components/DataPreview.tsx', 'src/components/AlgorithmSuggestions.tsx'];

describe('which files are handed back', () => {
  it('the report\'s two left-behind screens, and nothing the app shows', () => {
    expect(orphansToHandBack({ project: PROJECT, written: WRITTEN })).toEqual([
      'src/components/AlgorithmSuggestions.tsx',
      'src/components/DataPreview.tsx',
    ]);
  });

  it('a file the build did not write is never named, even when nothing imports it', () => {
    expect(orphansToHandBack({ project: PROJECT, written: ['src/App.tsx', 'src/components/LotteryAnalyzer.tsx'] })).toEqual([]);
  });

  it('nothing is named when the graph cannot prove it (an import to a file that was not read)', () => {
    const holed = { ...PROJECT, 'src/App.tsx': "import logo from './assets/logo.svg';\n" + PROJECT['src/App.tsx'] };
    expect(orphansToHandBack({ project: holed, written: WRITTEN })).toEqual([]);
  });

  it('a project-mode module waiting for its shell is left alone (a later module wires it in)', () => {
    expect(orphansToHandBack({ project: PROJECT, written: WRITTEN, starterExpected: true })).toEqual([]);
  });

  it('tests, stories and UI-kit parts are not screens the app must show', () => {
    const project = {
      ...PROJECT,
      'src/components/ui/button.tsx': 'export const Button = () => <button />;',
      'src/components/Card.stories.tsx': 'export default {};',
      'src/components/Card.test.tsx': 'it("x", () => {});',
    };
    const written = [...WRITTEN, 'src/components/ui/button.tsx', 'src/components/Card.stories.tsx', 'src/components/Card.test.tsx'];
    expect(orphansToHandBack({ project, written })).toEqual(['src/components/AlgorithmSuggestions.tsx', 'src/components/DataPreview.tsx']);
  });

  it('the switch defaults on and turns off only on "off"', () => {
    expect(orphanHandBackEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(orphanHandBackEnabled({ AGENTV3_ORPHAN_HANDBACK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(orphansToHandBack({ project: PROJECT, written: WRITTEN, env: { AGENTV3_ORPHAN_HANDBACK: 'off' } as NodeJS.ProcessEnv })).toEqual([]);
  });
});

describe('what the model is told', () => {
  it('names each file and says wire it in or delete it — never something the user asked for', () => {
    const text = orphanInstruction(['src/components/DataPreview.tsx']);
    expect(text).toContain('- src/components/DataPreview.tsx');
    expect(text).toContain('import it and show it');
    expect(text).toContain('delete it');
    expect(text).toContain('Never delete something the user asked for.');
    expect(orphanInstruction([])).toBe('');
    const many = Array.from({ length: MAX_ORPHANS_LISTED + 3 }, (_, i) => `src/components/C${i}.tsx`);
    expect(orphanInstruction(many)).toContain('…and 3 more');
  });

  it('orphans alone are enough to hand the turn back, once', () => {
    const d = decideStyleResume({ text: 'Done.', missing: [], orphans: ['src/components/DataPreview.tsx'], resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('src/components/DataPreview.tsx');
    expect(decideStyleResume({ text: 'Done.', missing: [], orphans: ['x.tsx'], resumesUsed: 1, producedFiles: true }).resume).toBe(false);
    expect(decideStyleResume({ text: 'Done.', missing: [], orphans: [], resumesUsed: 0 }).standDown).toBe('nothing-missing');
  });

  it('the admin note counts them, and is unchanged when there are none', () => {
    expect(styleResumeNote(0, 0, 2)).toContain('2 component file(s) this build wrote and nothing imports');
    expect(styleResumeNote(3, 1)).toBe(styleResumeNote(3, 1, 0));
    expect(styleResumeNote(3, 1)).not.toContain('nothing imports');
  });
});

describe('the end-of-turn read', () => {
  class Fake implements ActuatorPort {
    files = new Map<string, string>(Object.entries(PROJECT));
    async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT'); return f; }
    async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number): Promise<string> { return `https://x-${port}`; }
  }
  const make = () => { const s = new AgentEventStream(); return new ToolDispatcher(new Fake(), 'ws', new WorkspaceState(s), s); };

  it('the architect is handed the build\'s orphans, including a specialist\'s (via the build\'s write set)', async () => {
    const d = make();
    d.setBuildWrites(() => WRITTEN);
    expect((await d.undefinedClassesNow()).orphans).toEqual(['src/components/AlgorithmSuggestions.tsx', 'src/components/DataPreview.tsx']);
  });

  it('a specialist is not (the architect wires its screens in after it returns)', async () => {
    const d = make();
    d.setBuildWrites(() => WRITTEN);
    expect((await d.undefinedClassesNow({ onlyWritten: true })).orphans ?? []).toEqual([]);
  });

  it('a module turn that awaits its shell is not', async () => {
    const d = make();
    d.setBuildWrites(() => WRITTEN);
    d.setStarterExpected(true);
    expect((await d.undefinedClassesNow()).orphans).toEqual([]);
  });
});

describe('wiring', () => {
  it('the route hands the dispatcher the build\'s write set, our pre-seed left out', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('dispatcher.setBuildWrites(() => modelAuthoredPaths(writtenFiles));');
  });

  it('the architect\'s end-of-turn hand-back carries them; the specialist\'s does not', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('a11y: style.a11y, orphans: style.orphans, resumesUsed: styleResumes');
    const specialist = runner.slice(runner.indexOf("undefinedClassesNow({ onlyWritten: true })"));
    expect(specialist.slice(0, 400)).not.toContain('orphans');
  });
});
