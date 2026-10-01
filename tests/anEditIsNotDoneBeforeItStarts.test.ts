// AUTOPSY 1389f0d5 (2026-09-30): "✅ The app looks complete — wrapping up." at step 10 — before one line of
// the requested feature existed.
//
// The turn was an EDIT: add a Genesis-4 PDF page to the user's calculator. Ten steps of reads and web
// searches later, the done signal ran the readiness scan over the project — the calculator, untouched and
// healthy, 100/100 — told the user the app was complete, and told the model to stop. The model knew better
// and carried on; READY_BEFORE_END then recorded a "finished at step 10" that never happened. The scan
// measures the project, and before this run writes anything the project is somebody else's finished work.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldCheckDone, doneSignalConfig } from '../src/server/AgentV3/doneSignal';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';

const cfg = doneSignalConfig({});

class MemActuator implements ActuatorPort {
  files = new Map<string, string>([['src/App.tsx', 'export default function App() {\n  return null;\n}\n']]);
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('the done check waits for this run to change something', () => {
  it('🔴 the report: step 10, eight tool uses, nothing written — no check', () => {
    expect(shouldCheckDone({ cfg, step: 10, toolUses: 8, alreadySignalled: false, wroteThisRun: false })).toBe(false);
    expect(shouldCheckDone({ cfg, step: 10, toolUses: 8, alreadySignalled: false, wroteThisRun: true })).toBe(true);
  });
  it('🔒 unknown keeps the old rule', () => {
    expect(shouldCheckDone({ cfg, step: 10, toolUses: 8, alreadySignalled: false })).toBe(true);
  });
  it('the dispatcher says whether this agent — or a sub-agent it ran — wrote anything', async () => {
    const d = new ToolDispatcher(new MemActuator(), 'ws-1');
    await d.dispatch({ id: 'r', name: 'read_file', input: { path: 'src/App.tsx' } });
    expect(d.wroteAnything()).toBe(false);
    await d.dispatch({ id: 's', name: 'replace_symbol', input: { path: 'src/App.tsx', symbol: 'App', code: 'export default function App() {\n  return <p>hi</p>;\n}' } });
    expect(d.wroteAnything()).toBe(true);

    const spawned = new ToolDispatcher(new MemActuator(), 'ws-1', undefined, undefined,
      async () => ({ ok: true, summary: 'done', written: ['src/Pdf.tsx'] }));
    expect(spawned.wroteAnything()).toBe(false);
    await spawned.dispatch({ id: 't', name: 'task', input: { role: 'frontend', instruction: 'build the page' } });
    expect(spawned.wroteAnything()).toBe(true);
  });
  it('🔒 the runner asks it', () => {
    const runner = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toContain('wroteThisRun: dispatcher.wroteAnything()');
  });
});
