import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALWAYS_WRITE_SECRETS,
  ToolDispatcher,
  applyEdit,
  boundedWholeFileDiff,
  globToRegExp,
  miniDiff,
  type ActuatorPort,
} from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { clearGreenLatch, latchGreen } from '../src/server/AgentV3/greenFreeze';
import { parseIgnoreFile } from '../src/server/AgentV3/ignoreRules';
import { shellWriteTargets } from '../src/server/AgentV3/shellWriteTargets';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  /** When true, `rm -f 'path'` actually drops the file (shadow-twin removal). */
  honorRm = false;

  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand(_ws: string, command: string) {
    this.commands.push(command);
    if (this.honorRm && command.startsWith('rm -f ')) {
      for (const m of command.matchAll(/'([^']+)'/g)) this.files.delete(m[1]);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

function dispatcher(act: FakeActuator, ws: string, onFileWrite?: (path: string, content: string) => void): ToolDispatcher {
  return new ToolDispatcher(act, ws, new WorkspaceState(), new AgentEventStream(),
    undefined, undefined, undefined, undefined, undefined, undefined, onFileWrite);
}

function call(name: string, input: Record<string, unknown>): ToolUse {
  return { id: 't1', name, input };
}

const noBareLf = (s: string) => s.replace(/\r\n/g, '');

describe('TD-22 dispatcher correctness', () => {
  afterEach(() => {
    clearGreenLatch('td22-green');
    clearGreenLatch('td22-green-off');
  });

  it('(a) write_file reports UTF-8 bytes, not UTF-16 code units', async () => {
    const content = 'नमस्ते';
    expect(content.length).toBe(6);
    expect(Buffer.byteLength(content, 'utf8')).toBe(18);
    const act = new FakeActuator();
    const d = dispatcher(act, 'td22-bytes');
    const res = await d.dispatch(call('write_file', { path: 'notes/greeting.txt', content }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(String(res.content)).toContain('(18 bytes)');
    expect(String(res.content)).not.toContain('(6 bytes)');
    expect(act.files.get('notes/greeting.txt')).toBe(content);
  });

  it('(b) glob **/ does not match a suffix inside a filename, and braces still expand', () => {
    const re = globToRegExp('**/test.ts');
    expect(re.test('src/latest.ts')).toBe(false);
    expect(re.test('test.ts')).toBe(true);
    expect(re.test('src/test.ts')).toBe(true);
    expect(re.test('src/app/test.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/app/test.ts')).toBe(false);
    expect(globToRegExp('src/*.ts').test('src/test.ts')).toBe(true);
    expect(globToRegExp('src/**/*.{ts,tsx}').test('src/app/Button.tsx')).toBe(true);
    expect(globToRegExp('**/*.{ts,tsx}').test('src/a.css')).toBe(false);
  });

  it('(c) miniDiff is the bounded whole-file diff, not an unbounded line dump', () => {
    const oldStr = Array.from({ length: 200 }, (_, i) => `old ${i}`).join('\n');
    const newStr = Array.from({ length: 200 }, (_, i) => `new ${i}`).join('\n');
    const patch = miniDiff(oldStr, newStr);
    expect(patch).toBe(boundedWholeFileDiff(oldStr, newStr));
    expect(patch.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(160);
    expect(patch).toContain('… (40 more lines)');
  });

  it('(d) a read whose first 8 KB contains NUL returns a stub and not the bytes', async () => {
    const act = new FakeActuator();
    const bin = 'PNG\0rest-of-bytes';
    act.files.set('assets/icon.bin', bin);
    act.files.set('notes/plain.txt', 'hello\nworld');
    const late = `${'a'.repeat(8 * 1024)}\0tail`;
    act.files.set('assets/late.bin', late);
    const d = dispatcher(act, 'td22-binary');

    const binary = await d.dispatch(call('read_file', { path: 'assets/icon.bin' }), 'architect');
    expect(binary.is_error).toBe(false);
    expect(binary.content).toBe(`[binary file, ${Buffer.byteLength(bin, 'utf8')} bytes — not shown]`);
    expect(binary.content).not.toContain('PNG');
    expect(binary.content).not.toContain('rest-of-bytes');

    const text = await d.dispatch(call('read_file', { path: 'notes/plain.txt' }), 'architect');
    expect(text.is_error).toBe(false);
    expect(text.content).toBe('hello\nworld');

    const after = await d.dispatch(call('read_file', { path: 'assets/late.bin' }), 'architect');
    expect(after.is_error).toBe(false);
    expect(String(after.content)).not.toMatch(/^\[binary file,/);
    expect(String(after.content)).toContain('\0tail');
  });

  it('(e) a first .env write that fails is retried on the next call', async () => {
    const act = new FakeActuator();
    const d = dispatcher(act, 'td22-env');
    const write = act.writeFile.bind(act);
    let envWrites = 0;
    vi.spyOn(act, 'writeFile').mockImplementation(async (ws, path, content) => {
      if (path === '.env') {
        envWrites += 1;
        if (envWrites === 1) throw new Error('sandbox gone');
      }
      return write(ws, path, content);
    });
    d.setUserSecrets({ API_KEY: 'v' });
    await expect(d.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS)).resolves.toBeUndefined();
    expect(act.files.has('.env')).toBe(false);
    await d.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    expect(envWrites).toBe(2);
    expect(act.files.get('.env') ?? '').toContain('API_KEY=v');
  });

  it('(f) a user-authored twin and a protected twin are not deleted; a stale one is', async () => {
    const act = new FakeActuator();
    act.honorRm = true;
    act.files.set('src/mine.js', 'export const OLD = true;\n');
    act.files.set('src/legacy.js', 'export const OLD = true;\n');
    act.files.set('src/stale.js', 'export const OLD = true;\n');
    const authored = new Set<string>(['src/mine.js']);
    const d = dispatcher(act, 'td22-twins', (p) => { authored.add(p); });
    d.armShadowTwins(() => authored);
    d.setIgnoreRules(parseIgnoreFile('src/legacy.js'));
    const body = 'export const x = 1;\n';
    for (const path of ['src/mine.tsx', 'src/legacy.tsx', 'src/stale.tsx']) {
      const res = await d.dispatch(call('write_file', { path, content: body }), 'architect');
      expect(res.is_error, String(res.content)).toBe(false);
    }
    expect(act.files.has('src/mine.js')).toBe(true);
    expect(act.files.has('src/legacy.js')).toBe(true);
    expect(act.files.has('src/stale.js')).toBe(false);
    expect(act.files.get('src/mine.tsx')).toBe(body);
    expect(act.files.get('src/legacy.tsx')).toBe(body);
    const removed = act.commands.filter((c) => c.startsWith('rm -f ')).join('\n');
    expect(removed).not.toContain('src/mine.js');
    expect(removed).not.toContain('src/legacy.js');
    expect(removed).toContain('src/stale.js');
  });

  it('(g) editing a CRLF-only file stays CRLF-only, and an LF file stays LF', async () => {
    const flexible = applyEdit('alpha\r\nbeta\r\n', 'alpha\nbeta', 'alpha\ngamma');
    expect(flexible.note).toMatch(/whitespace/);
    expect(flexible.updated).toBe('alpha\r\ngamma\r\n');
    expect(noBareLf(flexible.updated)).not.toContain('\n');

    const exact = applyEdit('alpha\r\nbeta\r\n', 'alpha', 'ALPHA\nX');
    expect(exact.note).toBe('');
    expect(exact.updated).toBe('ALPHA\r\nX\r\nbeta\r\n');
    expect(noBareLf(exact.updated)).not.toContain('\n');

    const lf = applyEdit('alpha\nbeta\n', 'alpha', 'ALPHA\nX');
    expect(lf.updated).toBe('ALPHA\nX\nbeta\n');
    expect(lf.updated).not.toContain('\r');

    const act = new FakeActuator();
    act.files.set('notes/crlf.txt', 'alpha\r\nbeta\r\n');
    const d = dispatcher(act, 'td22-crlf');
    const res = await d.dispatch(call('edit_file', {
      path: 'notes/crlf.txt',
      old_string: 'alpha\nbeta',
      new_string: 'alpha\ngamma',
    }), 'architect');
    expect(res.is_error, String(res.content)).toBe(false);
    const saved = act.files.get('notes/crlf.txt') ?? '';
    expect(saved).toBe('alpha\r\ngamma\r\n');
    expect(noBareLf(saved)).not.toContain('\n');
  });

  it('(h) green freeze blocks a node -e write, and does not block a read or an unlatched write', async () => {
    const writeCmd = `node -e "require('fs').writeFileSync('src/App.tsx','x')"`;
    const readCmd = `node -e "require('fs').readFileSync('src/App.tsx','utf8')"`;
    const py = `python3 -c "open('src/App.tsx','w').write('x')"`;
    expect(shellWriteTargets(writeCmd)).toEqual(['src/App.tsx']);
    expect(shellWriteTargets(py)).toEqual(['src/App.tsx']);
    expect(shellWriteTargets(readCmd)).toEqual([]);
    expect(shellWriteTargets(`python -c "open('src/a.py','a').write('x')"`)).toEqual(['src/a.py']);

    const off = new FakeActuator();
    const unlatched = dispatcher(off, 'td22-green-off');
    const allowed = await unlatched.dispatch(call('bash', { command: writeCmd }), 'architect');
    expect(allowed.is_error, String(allowed.content)).toBe(false);
    expect(off.commands.some((c) => c.includes('writeFileSync'))).toBe(true);

    const ws = 'td22-green';
    latchGreen(ws, ['src/App.tsx']);
    try {
      const act = new FakeActuator();
      act.files.set('src/App.tsx', 'export default function App(){return null}\n');
      const d = dispatcher(act, ws);
      const blocked = await d.dispatch(call('bash', { command: writeCmd }), 'architect');
      expect(blocked.is_error).toBe(true);
      expect(String(blocked.content)).toMatch(/Green freeze/i);
      expect(act.commands.some((c) => c.includes('writeFileSync'))).toBe(false);
      expect(act.files.get('src/App.tsx')).not.toBe('x');

      const reading = await d.dispatch(call('bash', { command: readCmd }), 'architect');
      expect(reading.is_error, String(reading.content)).toBe(false);
      expect(act.commands.some((c) => c.includes('readFileSync'))).toBe(true);
    } finally {
      clearGreenLatch(ws);
    }
  });
});
