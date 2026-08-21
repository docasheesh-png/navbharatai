import { describe, it, expect } from 'vitest';
import { checkDomainServing, isEmptySitePage, canClaimLive } from './domainServingCheck';

/**
 * ADMIN, 2026-08-21, mitrify.com. The connect screen said, in green:
 *
 *     ✅ Live! Your domain is connected, with HTTPS.
 *        ownership: active · host: active · SSL: active
 *
 * …and opening mitrify.com gave Firebase's "Site Not Found". BOTH were true: those three states
 * describe DNS and a certificate, NOT whether anything was ever published to the site the domain
 * points at. A domain connected AFTER the last publish points at an empty site.
 *
 * 🔒 "Live!" over a domain that answers with an error page is a fake success (rule 2), and it cost a
 * real round trip: read "Live!", open the domain, see an error, conclude the connection failed.
 */
const FIREBASE_EMPTY = `<h1>Site Not Found</h1><p>Why am I seeing this?</p>
  <ol><li>You haven't deployed an app yet.</li><li>You may have deployed an empty directory.</li></ol>`;

const fetcherReturning = (status: number, body = '') =>
  async () => ({ status, text: async () => body });

describe('isEmptySitePage — recognising the hosting service\'s empty-site page', () => {
  it('matches the real page', () => {
    expect(isEmptySitePage(404, FIREBASE_EMPTY)).toBe(true);
  });

  it('needs BOTH markers — "site not found" alone is too common to trust', () => {
    // A user's own 404 page could easily say "site not found"; mislabelling their working app as
    // unpublished would send them to press Publish over and over for no reason.
    expect(isEmptySitePage(404, '<h1>Site not found</h1>')).toBe(false);
    expect(isEmptySitePage(404, "You haven't deployed anything")).toBe(false);
  });

  it('only a 404 can be the empty-site page', () => {
    expect(isEmptySitePage(200, FIREBASE_EMPTY)).toBe(false);
    expect(isEmptySitePage(500, FIREBASE_EMPTY)).toBe(false);
  });
});

describe('checkDomainServing', () => {
  it('THE CASE THAT STARTED THIS: connected, but nothing published to it', async () => {
    const r = await checkDomainServing('mitrify.com', fetcherReturning(404, FIREBASE_EMPTY));
    expect(r.state).toBe('nothing_published');
    expect(r.note).toContain('no app has been published');
    expect(r.note).toContain('Press Publish once');
  });

  it('a real page means the app is genuinely being served', async () => {
    const r = await checkDomainServing('mitrify.com', fetcherReturning(200, '<html>app</html>'));
    expect(r.state).toBe('serving');
    expect(r.note).toBe('');   // nothing worth saying when it works
  });

  it("the app's OWN 404 is an error, not an empty site — they are different problems", async () => {
    const r = await checkDomainServing('mitrify.com', fetcherReturning(404, '<h1>Page not found</h1>'));
    expect(r.state).toBe('error');
    expect(r.note).toContain('not found');
  });

  it('a 5xx is reported honestly with its status', async () => {
    const r = await checkDomainServing('mitrify.com', fetcherReturning(503));
    expect(r.state).toBe('error');
    expect(r.note).toContain('503');
  });

  it('UNREACHABLE is "unknown", never "broken" — the failure may be entirely ours', async () => {
    const r = await checkDomainServing('mitrify.com', async () => { throw new Error('network'); });
    expect(r.state).toBe('unknown');
    expect(r.note).toBe('');
  });

  it('an empty domain asks nothing and claims nothing', async () => {
    expect((await checkDomainServing('')).state).toBe('unknown');
  });

  it('🔒 SSRF: a domain pointing at a private address is never fetched', async () => {
    // The domain is user-supplied. Without the guard, connecting a domain whose A record points at
    // 127.0.0.1 or the cloud metadata address would make our server fetch it. Ownership verification
    // proves the domain is theirs — not that the target is safe.
    let called = false;
    const r = await checkDomainServing('localhost', async () => { called = true; return { status: 200, text: async () => '' }; });
    expect(called).toBe(false);
    expect(r.state).toBe('unknown');
  });
});

describe('canClaimLive — when the word "Live" is earned', () => {
  it('never before the hosting service reports it fully active', () => {
    expect(canClaimLive(false, 'serving')).toBe(false);
  });

  it('NOT when the domain demonstrably serves nothing — the whole point', () => {
    expect(canClaimLive(true, 'nothing_published')).toBe(false);
    expect(canClaimLive(true, 'error')).toBe(false);
  });

  it('yes when it is active and genuinely serving', () => {
    expect(canClaimLive(true, 'serving')).toBe(true);
  });

  it('UNKNOWN still claims Live, deliberately', () => {
    // If we could not reach the domain from our server, the three active states remain the best
    // evidence we have. Downgrading a genuinely working domain because OUR egress failed would trade
    // one wrong answer for another.
    expect(canClaimLive(true, 'unknown')).toBe(true);
  });
});
