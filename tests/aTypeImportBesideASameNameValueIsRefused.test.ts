/**
 * failedbr #1926 (2026-11-08, "health detector"): `import { AuditLog } from '../types'` (an interface, imported without
 * `type`) beside `const AuditLog = () => …`. tsc and esbuild accept it; the in-browser preview's Babel throws "Duplicate
 * declaration", and the build ended RED on PREVIEW_COMPILE_DIVERGENCE after 25 minutes. The write-time guard parsed with
 * esbuild only.
 */
import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>([['src/types.ts', 'export interface AuditLog { id: string }\n']]);
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const REPORT = `import { AuditLog } from '../types';
const AuditLog = () => { const logs: AuditLog[] = []; return <ul>{logs.map((l) => <li key={l.id}>{l.id}</li>)}</ul>; };
export default AuditLog;
`;
const FIXED = REPORT.replace("import { AuditLog } from '../types';", "import type { AuditLog as AuditLogEntry } from '../types';").replace('AuditLog[]', 'AuditLogEntry[]');

const make = (framework?: string) => {
  const actuator = new FakeActuator();
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(actuator, 'ws-1926', new WorkspaceState(stream), stream,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, framework);
  const write = (content: string) => d.dispatch({ id: 'w', name: 'write_file', input: { path: 'src/components/AuditLog.tsx', content } }, 'architect');
  return { actuator, write };
};

describe('a type imported beside a same-name value is refused at write time (the preview cannot compile it)', () => {
  it('the report\'s file is refused and not saved, with the exact fix named', async () => {
    const { actuator, write } = make();
    const r = await write(REPORT);
    expect(r.is_error).toBe(true);
    expect(String(r.content)).toMatch(/would not compile in the live preview/);
    expect(String(r.content)).toMatch(/import type \{ AuditLog \}/);
    expect(actuator.files.has('src/components/AuditLog.tsx')).toBe(false);
  });
  it('the fixed file is saved', async () => {
    const { actuator, write } = make();
    const r = await write(FIXED);
    expect(r.is_error).toBeFalsy();
    expect(actuator.files.get('src/components/AuditLog.tsx')).toBe(FIXED);
  });
  it('a server framework the in-browser preview never compiles is not judged by it', async () => {
    const { actuator, write } = make('node-express');
    const r = await write(REPORT);
    expect(r.is_error).toBeFalsy();
    expect(actuator.files.has('src/components/AuditLog.tsx')).toBe(true);
  });
});
