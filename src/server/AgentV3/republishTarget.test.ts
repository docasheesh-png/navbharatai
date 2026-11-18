import { describe, expect, it } from 'vitest';
import { bucketOnlySubdomain } from './bucketOnlyPublish';
import { planRepublish } from './republishTarget';

const SITE = 'gen-lang-client-0866594388';
const DOMAIN = 'mitrify.in';
const WS = 'agentv3-user-sessionA';

describe('planRepublish — a second publish stays on the first URL', () => {
  it('has nothing to pin when this workspace has never gone live', () => {
    expect(planRepublish({ workspaceId: WS, priorUrl: '', domain: DOMAIN, site: SITE })).toEqual({ kind: 'none' });
    expect(planRepublish({ workspaceId: WS, priorUrl: null, domain: DOMAIN, site: SITE })).toEqual({ kind: 'none' });
  });

  it('keeps the bucket-only address, which is the one a republish used to abandon', () => {
    const sub = bucketOnlySubdomain(WS);
    const url = `https://${sub}.${DOMAIN}`;
    expect(planRepublish({ workspaceId: WS, priorUrl: url, domain: DOMAIN, site: SITE })).toEqual({
      kind: 'bucket', url, sub,
    });
  });

  it('keeps a branded Firebase channel and names it as edge-served, so the old page is what gets the bytes', () => {
    const url = 'https://v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl.mitrify.in/play';
    expect(planRepublish({ workspaceId: WS, priorUrl: url, domain: DOMAIN, site: SITE })).toEqual({
      kind: 'channel',
      url: url.trim(),
      sub: 'v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl',
      viaEdge: true,
    });
  });

  it('keeps a raw web.app channel and does NOT pretend the edge worker is in front of it', () => {
    const url = `https://${SITE}--v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl.web.app`;
    const plan = planRepublish({ workspaceId: WS, priorUrl: url, domain: DOMAIN, site: SITE });
    expect(plan).toMatchObject({ kind: 'channel', url, viaEdge: false, sub: 'v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl' });
  });

  it('refuses to pin a snapshot host or another app\'s bucket name', () => {
    const snap = `https://s-${'a'.repeat(24)}.${DOMAIN}`;
    expect(planRepublish({ workspaceId: WS, priorUrl: snap, domain: DOMAIN, site: SITE }).kind).toBe('none');
    const other = `https://${bucketOnlySubdomain('someone-else')}.${DOMAIN}`;
    expect(planRepublish({ workspaceId: WS, priorUrl: other, domain: DOMAIN, site: SITE }).kind).toBe('none');
  });
});
