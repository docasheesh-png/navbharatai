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
/**
 * A dispatcher that MAY publish — the same grant the real Publish button makes (admin 2026-09-01).
 *
 * `deploy` now denies by default, because the agent used to publish a user's app on its own after a
 * bare "continue". These tests exercise what deploy DOES once it is allowed to run, so they grant
 * consent exactly as `routes/agentv3.ts` does at the Publish route. The gate's own behaviour — that an
 * UNGRANTED dispatcher publishes nothing — is asserted separately below, so widening the harness here
 * cannot hide it.
 */
const dispatcher = (act: ActuatorPort, deploy?: DeployFn) => {
  const d = new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, deploy);
  d.setPublishConsent(true);
  return d;
};

/** Deliberately NOT granted — for the gate's own tests. */
const ungrantedDispatcher = (act: ActuatorPort, deploy?: DeployFn) =>
  new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, deploy);

describe('deploy is gated on the USER asking — the agent cannot publish by itself', () => {
  it('publishes NOTHING without consent, and never calls the deploy function', async () => {
    // The real failure: a user typed "continue", the build finished, and the agent decided on its own
    // to put their app on a public URL. A working deploy path plus a willing model was all it took.
    const deployFn = vi.fn(okDeploy);
    const files = new Map([['index.html', Buffer.from('<html>real app</html>')]]);
    const r = await ungrantedDispatcher(new DistActuator(files), deployFn).dispatch(call());
    expect(deployFn).not.toHaveBeenCalled();
    expect(r.content).toMatch(/not requested/i);
    expect(r.content).not.toMatch(/https?:\/\//); // no URL can leak out of a refusal
  });

  it('refuses as a normal result the model can relay, NOT an error', async () => {
    // An error would read to the model as "this app cannot be published", which is false and would be
    // relayed to the user as a failure. The truth is simply that nobody asked yet.
    const r = await ungrantedDispatcher(new DistActuator(new Map([['index.html', Buffer.from('x')]])), okDeploy).dispatch(call());
    expect(r.is_error).toBeFalsy();
    expect(r.content).toMatch(/Publish button/);
  });

  it('the same dispatcher publishes once consent is granted', async () => {
    // Proves the refusal is the GATE and not some unrelated failure in the harness.
    const act = new DistActuator(new Map([['index.html', Buffer.from('<html>real app</html>')]]));
    const d = ungrantedDispatcher(act, okDeploy);
    expect((await d.dispatch(call())).content).toMatch(/not requested/i);
    d.setPublishConsent(true);
    expect((await d.dispatch(call())).content).toContain('https://');
  });
});

describe('publishedAppUrl — brand Firebase\'s OWN host, never a rebuilt one', () => {
  const SITE = 'gen-lang-client-0866594388';
  // What Firebase actually serves a preview channel at: SITE--CHANNEL-RANDOMHASH.web.app
  const REAL = `https://${SITE}--v3-abc-123-8e33e1d.web.app`;

  it('defaults to the REAL Firebase channel URL, unchanged', () => {
    expect(publishedAppUrl(REAL, SITE, undefined)).toBe(REAL);
    expect(publishedAppUrl(REAL, SITE, '')).toBe(REAL);
  });

  it('THE BUG: the branded host keeps the RANDOM HASH — dropping it was the "Site Not Found"', () => {
    // A publish succeeded and the app was still Site Not Found, because the URL was built as
    // `<site>--<channelId>.web.app` — a host Firebase never created (no hash, no truncation).
    expect(publishedAppUrl(REAL, SITE, 'mitrify.in')).toBe('https://v3-abc-123-8e33e1d.mitrify.in');
  });

  it('the branded subdomain is exactly what the Cloudflare Worker maps back to the origin', () => {
    const branded = publishedAppUrl(REAL, SITE, 'mitrify.in');
    const sub = branded.replace('https://', '').replace('.mitrify.in', '');
    expect(`https://${SITE}--${sub}.web.app`).toBe(REAL); // the Worker's mapping, reversed
  });

  it('tolerates a domain given with stray leading/trailing dots', () => {
    expect(publishedAppUrl(REAL, SITE, '.mitrify.in.')).toBe('https://v3-abc-123-8e33e1d.mitrify.in');
  });

  it('anything it cannot parse stays on the WORKING Firebase URL, never a guessed brand', () => {
    expect(publishedAppUrl('https://example.com/app', SITE, 'mitrify.in')).toBe('https://example.com/app');
    expect(publishedAppUrl('https://other-project--v3-x.web.app', SITE, 'mitrify.in'))
      .toBe('https://other-project--v3-x.web.app');
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
