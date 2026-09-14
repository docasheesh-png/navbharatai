/**
 * The counting is WIRED — because dropping any of it fails nothing.
 *
 * Every piece here is a call whose absence produces no error, no failing build and no red CI: the
 * server would simply stop counting and the admin panel would show a confident, permanent zero. That
 * is the same shape as the bug fixed the same day in the secrets vault, where a silent read failure
 * printed "No credentials saved yet" over eleven real keys — so the wiring is pinned, not assumed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
// Comments NAME these calls to explain them, so a prose mention must not satisfy a code assertion.
//
// LINE comments ONLY, and that is not laziness. A block-comment stripper ate half of `server.ts` when
// this was first written: the file contains an Express content-type wildcard whose slash-star opens a
// comment the regex then closed at the next star-slash, silently deleting real code and failing an
// assertion about a call that was present all along. The assertions below are therefore written as
// CODE shapes — a call with its opening brace, a ternary — which prose does not produce.
//
// (This very comment was first written as a block comment quoting that wildcard literally, which
// closed ITSELF early and broke the file. The same character sequence, twice, in ten minutes.)
const strip = (t: string) => t.replace(/(^|[^:])\/\/.*$/gm, '$1');

const server = strip(read('server.ts'));
const health = strip(read('src/server/routes/health.ts'));
const banner = strip(read('src/components/UpdateBanner.tsx'));
const admin = strip(read('src/server/routes/admin.ts'));
const dash = strip(read('src/components/AdminDashboard.tsx'));
const card = strip(read('src/components/admin/AudienceCard.tsx'));
const policy = read('src/content/legal/privacyPolicy.ts');

describe('website visits are counted where every page view passes', () => {
  it('the SPA catch-all counts the visit', () => {
    expect(server).toMatch(/import \{ noteWebsiteVisit \} from '\.\/src\/server\/lib\/ownAudience'/);
    expect(server).toContain('noteWebsiteVisit({');
  });

  it('counts AFTER the deferral check, so an API route is never counted as a page', () => {
    const defer = server.indexOf('spaFallbackShouldDefer');
    const count = server.indexOf('noteWebsiteVisit({');
    expect(defer).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(defer);
  });
});

describe('app opens are counted on the one call a launch makes', () => {
  it('the app-version route counts the open', () => {
    expect(health).toMatch(/import \{ noteAppOpen \} from '\.\.\/lib\/ownAudience'/);
    expect(health).toContain('noteAppOpen({');
    expect(health).toMatch(/x-nbai-platform/);
  });

  it('🔴 a counted open is NOT cached, or the next launch inside five minutes is invisible', () => {
    expect(health).toMatch(/open\.counted \? 'no-store' : 'public, max-age=300'/);
  });

  it('the native shell declares its platform — the server infers nothing', () => {
    expect(banner).toMatch(/'X-NBAI-Platform'/);
  });

  it('and it still only runs on native, so a browser is never counted as a phone', () => {
    expect(banner).toMatch(/if \(!me\.isNative \|\| cancelled\) return;/);
  });
});

describe('the admin can actually see it', () => {
  it('the route exists and is admin-gated', () => {
    expect(admin).toMatch(/app\.get\('\/api\/admin\/audience', verifyAdminToken/);
  });

  it('the route carries its own limits, so the screen cannot drift from them', () => {
    const route = admin.slice(admin.indexOf("'/api/admin/audience'"));
    expect(route).toContain('appOpensAreNotInstalls');
    expect(route).toContain('allTimePeopleUnavailable');
    expect(route).toContain('crawlersExcluded');
  });

  it('the panel fetches it and renders the card', () => {
    expect(dash).toContain("fetch('/api/admin/audience'");
    expect(dash).toMatch(/<AudienceCard data=\{audience\}/);
  });
});

describe('🔒 the policy discloses what we now count about our OWN visitors', () => {
  it('has its own section, separate from the one about users’ published apps', () => {
    expect(policy).toMatch(/Counting visits to NavBharatAI itself/);
  });

  it('states the three promises the code actually keeps', () => {
    expect(policy).toMatch(/no cookie/i);
    expect(policy).toMatch(/rotates every day/i);
    expect(policy).toMatch(/Do Not Track/);
  });

  it('says plainly that an all-time list of people cannot be produced', () => {
    expect(policy).toMatch(/never produce an all-time list of people/i);
  });
});

describe('🔘 everything lives inside ONE button, and the screen stays quiet', () => {
  it('the card is collapsed until it is pressed', () => {
    // Admin 2026-09-14: "sab kuch button ke andar ho, screen par bheed na dikhe".
    expect(card).toMatch(/useState\(false\)/);
    expect(card).toMatch(/aria-expanded=\{open\}/);
    expect(card).toMatch(/\{open && \(/);
  });

  it('🔒 the data is asked for on OPEN, not on a tab switch', () => {
    // The "who came" half scans the wallets and asks Firebase Auth about every account. Loading that
    // when somebody merely opened Monitor is real work nobody asked for — so the button is not only
    // tidiness, it is what makes the cost opt-in.
    expect(card).toMatch(/if \(next && !data\) onOpen\?\.\(\);/);
    expect(dash).toMatch(/onOpen=\{\(\) => void fetchAudience\(\)\}/);
  });

  it('and the Monitor tab no longer loads it eagerly', () => {
    const eff = dash.slice(dash.indexOf("if (activeTab === 'monitor')"), dash.indexOf("if (activeTab === 'monitor')") + 260);
    expect(eff).not.toContain('fetchAudience');
  });

  it('a failed read inside the card says so instead of showing nothing', () => {
    expect(card).toMatch(/does not mean nobody came/i);
  });
});

describe('WHO came is reported honestly', () => {
  it('the route returns the people section', () => {
    const route = admin.slice(admin.indexOf("'/api/admin/audience'"));
    expect(route).toContain('peopleAudience(');
    expect(route).toMatch(/people,/);
  });

  it('an unreadable people read is null, never an invented zero', () => {
    const route = admin.slice(admin.indexOf("'/api/admin/audience'"));
    expect(route).toMatch(/return null;/);
  });

  it('the card surfaces the accounts it could not check', () => {
    expect(card).toContain('lastActiveUnknown');
    expect(card).toMatch(/at least/);
  });

  it('the route states that only signed-in people can be named', () => {
    const route = admin.slice(admin.indexOf("'/api/admin/audience'"));
    expect(route).toContain('onlySignedInCanBeNamed');
    expect(route).toContain('dayIsUtc');
  });
});
