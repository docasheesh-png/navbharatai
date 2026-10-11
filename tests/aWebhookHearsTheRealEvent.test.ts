// A WEBHOOK HEARS THE REAL EVENT (2026-10-11, found by the Q-600 sweep).
//
// Settings → "Insights & Webhooks" promised a POST on BUILD_COMPLETE / BUILD_FAILED / DEPLOY_COMPLETE /
// DEPLOY_FAILED, and the knowledge base told every AI the same. Nothing ever sent one: `fireWebhooks` had a
// single caller, the "Send test" button. And the URLs were never checked for reachability, so "Send test"
// made OUR server POST to whatever address a signed-in user typed — the cloud metadata server included.
// These tests pin the wiring (the build-end and deploy choke points fire it), the payload (small, nothing
// private), and the guard (refused when added, refused again when sent).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  announceBuildFinished, announceDeploy, buildEventPayload, deployEventPayload, serverPublishOutcome,
} from '../src/server/lib/userWebhookEvents';
import { addWebhook, fireWebhooks, sendUserWebhook, WEBHOOK_EVENTS, type Webhook } from '../src/server/WebhookManager';

afterEach(() => vi.restoreAllMocks());
const AT = new Date('2026-10-11T10:00:00Z');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the events are really fired', () => {
  it('a finished build → the push AND the BUILD_* webhook, from one call', async () => {
    const fired: unknown[][] = []; const pushed: unknown[][] = [];
    announceBuildFinished('u1', true, { fire: async (...a) => { fired.push(a); }, push: async (...a) => { pushed.push(a); }, now: () => AT });
    announceBuildFinished('u1', false, { fire: async (...a) => { fired.push(a); }, push: async (...a) => { pushed.push(a); }, now: () => AT });
    await flush();
    expect(pushed).toEqual([['u1', true], ['u1', false]]);
    expect(fired).toEqual([
      ['u1', 'BUILD_COMPLETE', { ok: true, finishedAt: AT.toISOString() }],
      ['u1', 'BUILD_FAILED', { ok: false, finishedAt: AT.toISOString() }],
    ]);
  });

  it('a deploy → DEPLOY_COMPLETE with the live link, DEPLOY_FAILED without one; no uid, no event', async () => {
    const fired: unknown[][] = [];
    const deps = { fire: async (...a: unknown[]) => { fired.push(a); }, now: () => AT };
    announceDeploy('u1', true, 'https://my-app.navbharatai.com', deps);
    announceDeploy('u1', false, 'https://ignored.example', deps);
    announceDeploy(null, true, 'https://x.example', deps);
    await flush();
    expect(fired).toEqual([
      ['u1', 'DEPLOY_COMPLETE', { ok: true, finishedAt: AT.toISOString(), url: 'https://my-app.navbharatai.com' }],
      ['u1', 'DEPLOY_FAILED', { ok: false, finishedAt: AT.toISOString() }],
    ]);
  });

  it('a webhook can never break the caller — a throwing sender and a throwing push are swallowed', async () => {
    expect(() => announceBuildFinished('u1', true, { fire: () => { throw new Error('boom'); }, push: async () => { throw new Error('boom'); } })).not.toThrow();
    expect(() => announceDeploy('u1', true, 'https://a.example', { fire: async () => { throw new Error('boom'); } })).not.toThrow();
    await flush();
  });

  it('the payload carries nothing private: only event, ok, time and (for a live deploy) an http(s) link', () => {
    expect(Object.keys(buildEventPayload(true, AT)).sort()).toEqual(['finishedAt', 'ok']);
    expect(deployEventPayload(true, AT, 'javascript:alert(1)')).toEqual({ ok: true, finishedAt: AT.toISOString() });
  });

  it('a server-app publish: live → complete, a started deploy that failed → failed, a refusal → nothing', () => {
    expect(serverPublishOutcome({ live: true, body: {} })).toBe('complete');
    expect(serverPublishOutcome({ live: false, body: { code: 'needs-server-hosting', deploymentId: 'd1' } })).toBe('failed');
    expect(serverPublishOutcome({ live: false, body: { code: 'deploy-in-progress', deploymentId: 'd0' } })).toBeNull();
    expect(serverPublishOutcome({ live: false, body: { code: 'server_app_limit' } })).toBeNull();
  });

  it('fireWebhooks posts only to the hooks subscribed to the event, with the event in the body', async () => {
    const hooks: Webhook[] = [
      { id: 'a', url: 'https://a.example/h', events: ['BUILD_COMPLETE'], createdAt: '' },
      { id: 'b', url: 'https://b.example/h', events: ['DEPLOY_COMPLETE'], createdAt: '' },
    ];
    const sent: unknown[][] = [];
    const r = await fireWebhooks('u1', 'BUILD_COMPLETE', { ok: true }, { list: async () => hooks, send: async (...a) => { sent.push(a); return true; } });
    expect(r).toEqual({ attempted: 1, succeeded: 1 });
    expect(sent).toEqual([['https://a.example/h', { event: 'BUILD_COMPLETE', ok: true }]]);
  });
});

describe('🔒 our server never POSTs to a private address', () => {
  it('adding a metadata, loopback or private address is refused before anything is stored', async () => {
    for (const url of ['http://169.254.169.254/computeMetadata/v1/', 'http://127.0.0.1:8080/hook', 'http://10.0.0.5/hook', 'http://[::1]/hook']) {
      const r = await addWebhook('u1', url, [], AT.toISOString());
      expect(r.ok, url).toBe(false);
      expect(r.error, url).toMatch(/cannot receive webhooks/);
    }
  });

  it('a public address passes the check (and only then meets the database)', async () => {
    const r = await addWebhook('u1', 'https://93.184.215.14/hook', [], AT.toISOString());
    expect(r.error).toMatch(/database/i);
  });

  it('sending re-checks the address — a private one is never fetched', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await sendUserWebhook('http://169.254.169.254/latest/meta-data', { event: 'BUILD_COMPLETE' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CENSUS: the wiring cannot quietly come apart again', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  const serverFiles = (): string[] => {
    const out: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p); } };
    walk('src/server');
    return out;
  };

  it('no build-end site calls the push notifier directly — it goes through announceBuildFinished', () => {
    const direct = serverFiles().filter((f) => !f.endsWith('userWebhookEvents.ts') && !f.endsWith('PushNotificationService.ts'))
      .filter((f) => /\bnotifyBuildComplete\s*\(/.test(read(f)));
    expect(direct).toEqual([]);
    expect((read('src/server/routes/agentv3.ts').match(/announceBuildFinished\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('fireWebhooks has a real caller beyond "Send test"', () => {
    const callers = serverFiles().filter((f) => !f.endsWith('WebhookManager.ts') && /\bfireWebhooks\b/.test(read(f)));
    expect(callers.sort()).toEqual(['src/server/lib/userWebhookEvents.ts', 'src/server/routes/webhooks.ts']);
  });

  it('every publish path announces: the shared deploy function and the server-app branch', () => {
    const route = read('src/server/routes/agentv3.ts');
    const deployFn = route.slice(route.indexOf('const makeDeployFn = ('), route.indexOf('PUBLISH — the direct, deterministic path'));
    expect(deployFn).toMatch(/announceDeploy\(opts\.userId, true, url\)/);
    expect(deployFn).toMatch(/announceDeploy\(opts\.userId, false\)/);
    expect(route).toMatch(/serverPublishOutcome\(published\)/);
  });

  it('the page names the same events the server fires', () => {
    const page = read('src/components/panels/ProjectInsightsPanel.tsx');
    const m = /const WEBHOOK_EVENTS = (\[[^\]]+\])/.exec(page);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1].replace(/'/g, '"'))).toEqual([...WEBHOOK_EVENTS]);
    expect(page).toContain("{WEBHOOK_EVENTS.join(' · ')}");
  });
});
