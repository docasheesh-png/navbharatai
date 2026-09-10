import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyHostedServices, hostingCapacity } from '../src/server/AgentV3/hostedServiceInventory';
import {
  SERVICES_PER_PROJECT_CAP, buildDeleteServiceRequest, buildListServicesRequest, parseServiceList,
  deleteHostedService, servicePath, serviceNameFor, serviceBelongsTo,
} from '../src/server/AgentV3/cloudRunHosting';

/**
 * THE HOSTING CEILING (ROADMAP §11), after the admin asked "aisa to nahi kuch user ke bad hosting band
 * ho jaye" — exactly the right question, because it is the Firebase channel ceiling (§10) again.
 *
 * The cap is 1,000 Cloud Run services per project per region and Google does not raise it. §10's
 * lesson: a cap like this is not reached by working apps, it is reached by DEAD ones nobody deleted.
 */
const okRes = (status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '' });

describe('classifyHostedServices', () => {
  // Real service names, so the hash-suffix matching is exercised rather than assumed.
  const LIVE_SVC = serviceNameFor('ws-live', 'shop');
  const GONE_SVC = serviceNameFor('ws-gone', 'blog');
  const records = [
    { workspaceId: 'ws-live', live: true },
    { workspaceId: 'ws-gone', live: false },
  ];

  it('a known, live app is live and never reclaimable', () => {
    const c = classifyHostedServices([LIVE_SVC], records, true)[0];
    expect(c.state).toBe('live');
    expect(c.reclaimable).toBe(false);
    expect(c.workspaceId).toBe('ws-live');
  });

  it('🔒 a record that is NOT live while its service survives is stale — waste AND a bug signal', () => {
    // Unpublish deletes the service before touching the registry, so this combination means one of
    // those deletes failed and reported success somewhere.
    const c = classifyHostedServices([GONE_SVC], records, true)[0];
    expect(c.state).toBe('stale');
    expect(c.reclaimable).toBe(true);
  });

  it('🔒 A RENAMED APP IS STILL ITS OWN SERVICE — matching on the full name would delete it', () => {
    // The service name carries the app's name, which the user can change. Matched by full name, a
    // renamed app's LIVE service matches no record, is called an orphan, and an orphan is offered for
    // reclaim — so a rename would take the app off the internet. The workspace hash never changes.
    const beforeRename = serviceNameFor('ws-live', 'shop');
    const afterRename = serviceNameFor('ws-live', 'my-brand-new-name');
    expect(afterRename).not.toBe(beforeRename);
    const c = classifyHostedServices([beforeRename], records, true)[0];
    expect(c.state).toBe('live');
    expect(c.reclaimable).toBe(false);
    expect(serviceBelongsTo(afterRename, 'ws-live')).toBe(true);
    expect(serviceBelongsTo(afterRename, 'ws-gone')).toBe(false);
  });

  it('a service nothing knows about, with a COMPLETE registry, is a genuine orphan', () => {
    const c = classifyHostedServices([serviceNameFor('ws-nobody', 'mystery')], records, true)[0];
    expect(c.state).toBe('orphan');
    expect(c.reclaimable).toBe(true);
  });

  it('🔒 THE BUG channelInventory ALREADY PAID FOR: an incomplete registry makes it indeterminate, never reclaimable', () => {
    // A missing record is evidence of orphanhood ONLY if the registry was read in full. When it was
    // not, treating it as an orphan made one Firestore hiccup list every live app as reclaimable
    // waste — one click from deleting working sites.
    const MYSTERY = serviceNameFor('ws-nobody', 'mystery');
    const all = classifyHostedServices([LIVE_SVC, GONE_SVC, MYSTERY], records, false);
    const mystery = all.find((c) => c.service === MYSTERY)!;
    expect(mystery.state).toBe('indeterminate');
    expect(mystery.reclaimable).toBe(false);
    // 🔒 And NOTHING unknown is reclaimable in that state.
    expect(all.filter((c) => c.reclaimable).map((c) => c.service)).toEqual([GONE_SVC]);
  });

  it('known records still classify correctly even when the registry is incomplete', () => {
    const all = classifyHostedServices([LIVE_SVC], records, false);
    expect(all[0].state).toBe('live');
  });

  it('empty and junk inputs never throw', () => {
    expect(classifyHostedServices([], [], true)).toEqual([]);
    expect(classifyHostedServices(null, null, true)).toEqual([]);
    expect(classifyHostedServices(['', 'a'], null, true).map((c) => c.service)).toEqual(['a']);
  });
});

describe('hostingCapacity — the ceiling, visible long before it arrives', () => {
  const services = (n: number, reclaimable = 0) => Array.from({ length: n }, (_, i) => ({
    service: `s${i}`,
    state: (i < reclaimable ? 'stale' : 'live') as const,
    workspaceId: `w${i}`,
    reclaimable: i < reclaimable,
  }));

  it('the cap is Google\'s hard 1,000 — not a number we chose', () => {
    expect(SERVICES_PER_PROJECT_CAP).toBe(1000);
  });

  it('a quiet project is ok and says so plainly', () => {
    const c = hostingCapacity(services(10));
    expect(c.level).toBe('ok');
    expect(c.used).toBe(10);
    expect(c.headroom).toBe(990);
  });

  it('🔒 warns at 80% — early enough that a second project can actually be set up', () => {
    // The fix is a config change a person has to make. Discovering the need at 999 is too late.
    expect(hostingCapacity(services(800)).level).toBe('warn');
    expect(hostingCapacity(services(900)).level).toBe('critical');
    expect(hostingCapacity(services(1000)).level).toBe('full');
  });

  it('🔒 a warning names the real fix — Google does not raise this cap', () => {
    const c = hostingCapacity(services(850));
    expect(c.message).toMatch(/does NOT raise this cap/);
    expect(c.message).toMatch(/second apps project/);
  });

  it('reclaimable slots count toward headroom, and are named', () => {
    const c = hostingCapacity(services(1000, 40));
    expect(c.level).toBe('full');
    expect(c.reclaimable).toBe(40);
    expect(c.headroom).toBe(40);
    expect(c.message).toMatch(/40 slot\(s\) can be reclaimed/);
  });

  it('a full project with nothing reclaimable says the only remaining fix', () => {
    expect(hostingCapacity(services(1000)).message).toMatch(/Add a second apps project/);
  });
});

describe('delete + list — giving the slot back', () => {
  it('delete addresses the one service', () => {
    const r = buildDeleteServiceRequest('tok', 'p', 'asia-south1', 'svc');
    expect(r.method).toBe('DELETE');
    expect(r.url).toContain(servicePath('p', 'asia-south1', 'svc'));
  });

  it('the list pages, and parses leaf service names', () => {
    expect(buildListServicesRequest('t', 'p', 'r', 100, 'next').url).toContain('pageToken=next');
    const parsed = parseServiceList({
      services: [{ name: 'projects/p/locations/r/services/shop-aaa' }, { name: 'projects/p/locations/r/services/blog-bbb' }],
      nextPageToken: 'tok2',
    });
    expect(parsed.names).toEqual(['shop-aaa', 'blog-bbb']);
    expect(parsed.nextPageToken).toBe('tok2');
    expect(parseServiceList(null)).toEqual({ names: [], nextPageToken: '' });
  });

  it('🔒 a 404 is SUCCESS — the caller\'s goal is "not hosted any more", and it is already true', async () => {
    const res = await deleteHostedService({ token: 't', projectId: 'p', region: 'r', service: 's' }, (async () => okRes(404)) as any);
    expect(res.ok).toBe(true);
    expect(res.alreadyGone).toBe(true);
  });

  it('a real refusal is reported, and a network failure never throws', async () => {
    expect((await deleteHostedService({ token: 't', projectId: 'p', region: 'r', service: 's' }, (async () => okRes(403)) as any)).ok).toBe(false);
    const thrown = await deleteHostedService({ token: 't', projectId: 'p', region: 'r', service: 's' }, (async () => { throw new Error('x'); }) as any);
    expect(thrown.ok).toBe(false);
    expect(thrown.message).toMatch(/Could not reach Google Cloud/);
  });
});

describe('🔒 the wiring — unpublish gives the hosting slot back', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/unpublish'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('the unpublish route deletes the Cloud Run service too', () => {
    expect(handler).toContain('deleteHostedService({');
    expect(handler).toContain('serviceNameFor(workspaceId');
  });

  it('🔒 it runs AFTER the channel delete that gates the response, and cannot fail the takedown', () => {
    // The site is already down by then, which is what the user asked for. Failing their takedown
    // because a Cloud Run delete did not answer would refuse the thing that already succeeded — and a
    // surviving service is classified as reclaimable waste, so it is visible rather than lost.
    const channelAt = handler.indexOf('deleteChannel(workspaceId)');
    const hostAt = handler.indexOf('deleteHostedService({');
    expect(channelAt).toBeGreaterThan(-1);
    expect(hostAt).toBeGreaterThan(channelAt);
    const block = handler.slice(hostAt - 400, hostAt + 800);
    expect(block).toContain('catch');
  });

  it('the outcome is recorded in the audit, so a slot that did NOT come back is traceable', () => {
    expect(handler).toContain('hostedSlotFreed');
  });
});

describe('🔒 the capacity endpoint — the ceiling is visible before it arrives', () => {
  const admin = readFileSync(join(__dirname, '..', 'src/server/routes/admin.ts'), 'utf8');
  const handler = (() => {
    const at = admin.indexOf("app.get('/api/admin/hosting/services'");
    return at === -1 ? '' : admin.slice(at, admin.indexOf("app.get('/api/admin/hosting/channels'", at));
  })();

  it('exists, admin-token gated, and reports capacity', () => {
    expect(handler).not.toBe('');
    expect(handler).toContain('verifyAdminToken');
    expect(handler).toContain('hostingCapacity(classified)');
  });

  it('🔒 completeness from BOTH sides gates reclaim — the channel-inventory rule, applied again', () => {
    expect(handler).toContain('classifyHostedServices(names, records, reg.complete && servicesComplete)');
    expect(handler).toContain('warning:');
  });

  it('🔒 an unreadable list is NOT reported as "zero services used"', () => {
    // A made-up all-clear on the one number this endpoint exists for is worse than reporting nothing.
    expect(handler).toContain('res.status(502)');
    expect(handler).not.toMatch(/catch[\s\S]{0,200}used: 0/);
  });

  it('hosting being switched off is reported as unavailable, not as empty', () => {
    expect(handler).toContain('available: false');
  });
});
