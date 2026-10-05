/**
 * Q-163 (admin chose option b, 2026-10-05): a domain connected AFTER the last publish served "site not found"
 * until the user pressed Publish again. Now, when the uptime sweep sees that domain's site still EMPTY, the
 * already-published app (read back from the publish bucket's copy — nothing rebuilt) is put on it: once, for the
 * owner's active app only, and the owner is told either way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { autoPublishToNewDomain, publishedSubdomain, publishedMessage, failedMessage, type AutoPublishDeps } from '../src/server/lib/domainAutoPublish';
import { runSiteUptimeSweep } from '../src/server/lib/siteUptimeSweep';
import type { DomainLinkRecord } from '../src/server/lib/firebaseDomainLink';

const LINK = { domain: 'mitrify.com', workspaceId: 'ws1', userId: 'u1', provider: 'firebase' } as unknown as DomainLinkRecord;
const FILES = new Map([['index.html', Buffer.from('<p>app</p>')], ['assets/a.js', Buffer.from('1')]]);

function deps(over: Partial<AutoPublishDeps> = {}) {
  const calls = { deployed: [] as Array<[string, number]>, notified: [] as string[], claims: 0 };
  const d: AutoPublishDeps = {
    enabled: () => true,
    deployment: async () => ({ workspaceId: 'ws1', userId: 'u1', url: 'https://tasklite-abc.apps.example.in', status: 'active' }) as never,
    readPublished: async (sub) => (sub === 'tasklite-abc' ? FILES : null),
    claimOnce: async () => { calls.claims += 1; return true; },
    deployToSite: async (ws, files) => { calls.deployed.push([ws, files.size]); },
    notify: async (_u, m) => { calls.notified.push(m); },
    brandedDomain: () => 'apps.example.in',
    ...over,
  };
  return { d, calls };
}

describe('the already-published app goes on the new domain', () => {
  it('publishes the published copy, and says so in plain words', async () => {
    const { d, calls } = deps();
    expect(await autoPublishToNewDomain(LINK, d)).toBe('published');
    expect(calls.deployed).toEqual([['ws1', 2]]);
    expect(calls.notified).toEqual([publishedMessage('mitrify.com')]);
    expect(publishedMessage('x.com') + failedMessage('x.com')).not.toMatch(/firebase|google|hosting site/i);
  });

  it('never for another person\'s app, a held or unpublished app, or with no saved copy', async () => {
    expect(await autoPublishToNewDomain(LINK, deps({ deployment: async () => ({ userId: 'u2', url: 'https://tasklite-abc.apps.example.in', status: 'active' }) as never }).d)).toBe('not-owner');
    expect(await autoPublishToNewDomain(LINK, deps({ deployment: async () => ({ userId: 'u1', url: 'https://tasklite-abc.apps.example.in', status: 'held' }) as never }).d)).toBe('nothing-published');
    expect(await autoPublishToNewDomain(LINK, deps({ deployment: async () => null }).d)).toBe('nothing-published');
    expect(await autoPublishToNewDomain(LINK, deps({ readPublished: async () => new Map([['a.js', Buffer.from('1')]]) }).d)).toBe('no-copy');
    expect(await autoPublishToNewDomain({ ...LINK, suspended: 'plan_lapsed' } as DomainLinkRecord, deps().d)).toBe('disabled');
    expect(await autoPublishToNewDomain(LINK, deps({ enabled: () => false }).d)).toBe('disabled');
  });

  it('once: a lost claim deploys nothing', async () => {
    const { d, calls } = deps({ claimOnce: async () => false });
    expect(await autoPublishToNewDomain(LINK, d)).toBe('already-done');
    expect(calls.deployed).toEqual([]);
  });

  it('a 5xx is retried once; a 4xx is not; a failure tells the owner to press Publish', async () => {
    let n = 0;
    const retried = deps({ deployToSite: async () => { n += 1; if (n === 1) throw new Error('site release failed (HTTP 503): busy'); } });
    expect(await autoPublishToNewDomain(LINK, retried.d)).toBe('published');
    expect(n).toBe(2);
    let m = 0;
    const refused = deps({ deployToSite: async () => { m += 1; throw new Error('site release failed (HTTP 403): no'); } });
    expect(await autoPublishToNewDomain(LINK, refused.d)).toBe('failed');
    expect(m).toBe(1);
    expect(refused.calls.notified).toEqual([failedMessage('mitrify.com')]);
  });

  it('the bucket key comes from the published URL, branded or not', () => {
    expect(publishedSubdomain('https://tasklite-abc.apps.example.in/', 'apps.example.in')).toBe('tasklite-abc');
    expect(publishedSubdomain('https://gen-lang-client-0866594388--v3-x-ab12.web.app', '')).toBe('v3-x-ab12');
    expect(publishedSubdomain('https://evil.com/../x', 'apps.example.in')).toBe('');
  });
});

describe('the uptime sweep is where it happens', () => {
  const base = {
    links: async () => [LINK],
    load: async () => ({ domain: 'mitrify.com', workspaceId: 'ws1', userId: 'u1', state: 'up' }) as never,
    save: async () => {},
    email: async () => false,
    now: () => 1_000_000,
    env: {} as NodeJS.ProcessEnv,
  };

  it('an empty site gets the app, and is not reported "down" on the same sweep', async () => {
    const notes: string[] = [];
    const tried: string[] = [];
    await runSiteUptimeSweep({ ...base, notify: async (_u, m) => { notes.push(m); }, serving: async () => 'nothing_published', autoPublish: async (l) => { tried.push(l.domain); return 'published'; } });
    expect(tried).toEqual(['mitrify.com']);
    expect(notes.join(' ')).not.toMatch(/down|not reachable|is not loading/i);
  });

  it('a site that is serving is never touched', async () => {
    const tried: string[] = [];
    await runSiteUptimeSweep({ ...base, notify: async () => {}, serving: async () => 'serving', autoPublish: async (l) => { tried.push(l.domain); return 'published'; } });
    expect(tried).toEqual([]);
  });

  it('wired for real', () => {
    const src = readFileSync('src/server/lib/siteUptimeSweep.ts', 'utf8');
    expect(src).toContain('autoPublish: (link) => autoPublishToNewDomain(link, realAutoPublishDeps)');
  });
});
