// Q-396 (autopsy Sur Taal, 2026-10-04; admin accepted the recommendation). Every Project Mode module turn
// before the app shell carried "No tests at all" — true of the unfinished app, and repeated on each of the
// 23 module turns. A module whose shell comes later is judged on its own files (aModuleIsNotTheWholeApp),
// so it is not asked for the app's tests either. The shell turn, and every ordinary build, still are.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class Act implements ActuatorPort {
  files = new Map<string, string>([
    ['package.json', '{"name":"sur-taal","dependencies":{"react":"^18.0.0"}}'],
    ['index.html', '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'],
    ['src/main.tsx', "import App from './App';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App />);\n"],
    ['src/App.tsx', "import { colors } from './theme/colors';\nexport default function App() { return <main style={{ color: colors.text }}>Sur Taal</main>; }\n"],
    ['src/theme/colors.ts', "export const colors = { text: '#111111', bg: '#ffffff' };\n"],
    ['src/theme/typography.ts', "export const fonts = { body: 'Inter' };\n"],
    ['src/theme/spacing.ts', 'export const space = [0, 4, 8, 16];\n'],
  ]);
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
}

const warningsOf = async (starterExpected: boolean) => {
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(new Act(), 'ws-q396', new WorkspaceState(stream), stream);
  if (starterExpected) d.setStarterExpected(true);
  const r = await d.assessBuildReadiness();
  return [...r.warnings, ...r.blockers];
};

describe('a module whose shell comes later is not asked for the app\'s tests', () => {
  it('an ordinary build (and the shell turn) still hears "No tests at all"', async () => {
    expect((await warningsOf(false)).some((w) => /No tests at all/.test(w))).toBe(true);
  });
  it('a module turn before the shell does not', async () => {
    expect((await warningsOf(true)).some((w) => /No tests at all/.test(w))).toBe(false);
  });
  it('the guard reads the same flag as the starter blocker', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toMatch(/if \(!this\._starterExpected && testCoverage\.findings\.some\(\(f\) => f\.level === 'high'\)\) extra\.push\(\{ severity: 'medium', label: 'No tests at all' \}\);/);
  });
});
