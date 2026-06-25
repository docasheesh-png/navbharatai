import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { makeChannelId } from './Deployment';
import { CATALOG_TOOL_NAMES, defaultToolCatalog } from './ToolCatalog';
import { roleConfig } from './AgentRegistry';
import type { ToolUse } from './ClaudeClient';
import type { DeployFn } from './Deployment';

const call = (input: Record<string, unknown> = {}): ToolUse => ({ id: 't1', name: 'deploy', input });

class BareActuator implements ActuatorPort {
  async readFile() { return ''; }
  async writeFile() {}
  async listFiles() { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
class DistActuator extends BareActuator {
  constructor(private readonly files: Map<string, Buffer>) { super(); }
  async downloadDistFiles() { return this.files; }
}

const okDeploy: DeployFn = async (ws) => `https://gen-lang-client-0866594388--v3-${ws}.web.app`;
const dispatcher = (act: ActuatorPort, deploy?: DeployFn) =>
  new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, deploy);

describe('deploy tool', () => {
  it('is registered in the catalog and the architect tool-set', () => {
    expect((CATALOG_TOOL_NAMES as readonly string[]).includes('deploy')).toBe(true);
    expect(defaultToolCatalog().some((t) => t.name === 'deploy')).toBe(true);
    expect(roleConfig('architect').tools).toContain('deploy');
  });

  it('makeChannelId produces a valid, bounded firebase channel id', () => {
    expect(makeChannelId('agentv3-user_1-sessABC')).toMatch(/^v3-[a-z0-9-]{1,33}$/);
    expect(makeChannelId('x'.repeat(80)).length).toBeLessThanOrEqual(33);
  });

  it('deploys the built dist files and returns the public URL', async () => {
    const files = new Map([['index.html', Buffer.from('<h1>hi</h1>')]]);
    const r = await dispatcher(new DistActuator(files), okDeploy).dispatch(call());
    expect(r.is_error).toBe(false);
    expect(r.content).toContain('https://gen-lang-client-0866594388--v3-ws-1.web.app');
  });

  it('refuses honestly when there is no built dist', async () => {
    const r = await dispatcher(new DistActuator(new Map()), okDeploy).dispatch(call());
    expect(r.content).toMatch(/npm run build/i);
  });

  it('degrades honestly without a sandbox (no downloadDistFiles)', async () => {
    const r = await dispatcher(new BareActuator(), okDeploy).dispatch(call());
    expect(r.content).toMatch(/require[s]? a real cloud sandbox/i);
  });

  it('reports when deploy is not configured', async () => {
    const files = new Map([['index.html', Buffer.from('x')]]);
    const r = await dispatcher(new DistActuator(files), undefined).dispatch(call());
    expect(r.content).toMatch(/not configured/i);
  });
});
