import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { CATALOG_TOOL_NAMES, defaultToolCatalog, catalogForTools } from './ToolCatalog';
import { roleConfig } from './AgentRegistry';
import type { ToolUse } from './ClaudeClient';

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

/** A bare actuator with no browser capability (Local/Docker-like) — the honest-fallback case. */
class BareActuator implements ActuatorPort {
  async readFile() { return ''; }
  async writeFile() {}
  async listFiles() { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

/** A sandbox-like actuator that supports the browser tools. */
class BrowserActuator extends BareActuator {
  async screenshot(_ws: string, _url: string) {
    return { base64: 'AAAA', mimeType: 'image/png' as const };
  }
  async browserAction(_ws: string, action: string) {
    return { screenshot: 'BBBB', result: `did ${action}`, cursorX: 10, cursorY: 20 };
  }
  async getConsoleErrors() {
    return { errors: [{ t: 1, kind: 'error', text: 'boom' }] };
  }
}

describe('browser tools — registration', () => {
  it('screenshot / browser_action / console_errors are catalog tools + architect tools', () => {
    for (const name of ['screenshot', 'browser_action', 'console_errors']) {
      expect((CATALOG_TOOL_NAMES as readonly string[]).includes(name)).toBe(true);
      expect(defaultToolCatalog().some((t) => t.name === name)).toBe(true);
      expect(roleConfig('architect').tools).toContain(name);
    }
    const defs = catalogForTools(roleConfig('architect').tools).map((t) => t.name);
    expect(defs).toEqual(expect.arrayContaining(['screenshot', 'browser_action', 'console_errors']));
  });
});

describe('browser tools — real sandbox', () => {
  const d = () => new ToolDispatcher(new BrowserActuator(), 'ws-1');

  it('screenshot returns the image as a vision block + an honest summary', async () => {
    const r = await d().dispatch(call('screenshot', { url: 'http://localhost:5173' }));
    expect(r.is_error).toBe(false);
    expect(r.image).toEqual({ base64: 'AAAA', mimeType: 'image/png' });
    expect(r.content).toContain('http://localhost:5173');
  });

  it('browser_action returns the result text + a screenshot image', async () => {
    const r = await d().dispatch(call('browser_action', { action: 'click', selector: '#go' }));
    expect(r.is_error).toBe(false);
    expect(r.content).toContain('did click');
    expect(r.image).toEqual({ base64: 'BBBB', mimeType: 'image/png' });
  });

  it('browser_action rejects an unknown action without throwing', async () => {
    const r = await d().dispatch(call('browser_action', { action: 'teleport' }));
    expect(r.is_error).toBe(false);
    expect(r.content).toMatch(/unknown action/i);
    expect(r.image).toBeUndefined();
  });

  it('console_errors formats captured runtime errors', async () => {
    const r = await d().dispatch(call('console_errors', {}));
    expect(r.content).toContain('Runtime browser errors (1)');
    expect(r.content).toContain('boom');
  });
});

describe('browser tools — honest fallback (no sandbox)', () => {
  const d = () => new ToolDispatcher(new BareActuator(), 'ws-1');

  it('screenshot / browser_action / console_errors degrade honestly (no image, not a fake success)', async () => {
    const s = await d().dispatch(call('screenshot', { url: 'http://localhost:5173' }));
    expect(s.content).toMatch(/require[s]? a real cloud sandbox/i);
    expect(s.image).toBeUndefined();

    const b = await d().dispatch(call('browser_action', { action: 'click' }));
    expect(b.content).toMatch(/require[s]? a real cloud sandbox/i);

    const c = await d().dispatch(call('console_errors', {}));
    expect(c.content).toMatch(/require[s]? a real cloud sandbox/i);
  });
});
