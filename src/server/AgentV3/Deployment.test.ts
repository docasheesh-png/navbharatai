import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { makeChannelId, publishedAppUrl } from './Deployment';
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

describe('publishedAppUrl — branded published-app host (Step 3, env-flagged)', () => {
  it('defaults to the SAFE raw Firebase channel host when no branded domain is set', () => {
    expect(publishedAppUrl('v3-abc-123', 'gen-lang-client-0866594388', undefined))
      .toBe('https://gen-lang-client-0866594388--v3-abc-123.web.app');
    expect(publishedAppUrl('v3-abc-123', 'gen-lang-client-0866594388', ''))
      .toBe('https://gen-lang-client-0866594388--v3-abc-123.web.app');
  });

  it('uses the branded subdomain when a domain is set — the channelId IS the subdomain', () => {
    // The Cloudflare Worker maps <sub>.mitrify.in -> <site>--<sub>.web.app, so the channelId alone
    // is the branded subdomain and the site prefix lives only in the Worker.
    expect(publishedAppUrl('v3-abc-123', 'gen-lang-client-0866594388', 'mitrify.in'))
      .toBe('https://v3-abc-123.mitrify.in');
  });

  it('tolerates a domain given with stray leading/trailing dots', () => {
    expect(publishedAppUrl('v3-x', 'site', '.mitrify.in.')).toBe('https://v3-x.mitrify.in');
  });
});

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

  it('REGRESSION: two workspaces sharing a long prefix (differ only in sessionId) get DIFFERENT channels', () => {
    // A 28-char Firebase uid + "agentv3-" already fills the old 30-char prefix slice, so the sessionId
    // was dropped and every project a user deployed overwrote the previous one at one shared channel.
    const uid = 'a'.repeat(28);
    const a = makeChannelId(`agentv3-${uid}-sessionAAAAAAAA`);
    const b = makeChannelId(`agentv3-${uid}-sessionBBBBBBBB`);
    expect(a).not.toBe(b);
  });

  it('makeChannelId is STABLE — the same workspace always maps to the same channel (redeploy in place)', () => {
    expect(makeChannelId('agentv3-uid-sess1')).toBe(makeChannelId('agentv3-uid-sess1'));
  });

  // The deploy case does a post-deploy liveness GET (P-PIPE.116). Stub fetch so tests are deterministic
  // and never touch the network; unstubbed after each case.
  afterEach(() => vi.unstubAllGlobals());

  it('deploys the built dist files and returns the public URL, plus a live liveness line (HTTP 200)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    const files = new Map([['index.html', Buffer.from('<h1>hi</h1>')]]);
    const r = await dispatcher(new DistActuator(files), okDeploy).dispatch(call());
    expect(r.is_error).toBe(false);
    expect(r.content).toContain('https://gen-lang-client-0866594388--v3-ws-1.web.app');
    expect(r.content).toContain('HTTP 200');
    expect(r.content).toContain('your site is live');
  });

  it('a still-propagating URL adds a soft "not reachable yet" note — never a deploy failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const files = new Map([['index.html', Buffer.from('<h1>hi</h1>')]]);
    const r = await dispatcher(new DistActuator(files), okDeploy).dispatch(call());
    expect(r.is_error).toBe(false); // deploy still succeeded
    expect(r.content).toContain('https://gen-lang-client-0866594388--v3-ws-1.web.app');
    expect(r.content).toContain("isn't reachable yet");
    expect(r.content).toContain('not a deploy failure');
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
