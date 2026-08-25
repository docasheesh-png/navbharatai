import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { channelSubdomain, publishedAppUrl, makeChannelId } from '../src/server/AgentV3/Deployment';

/**
 * ⚠️ THE BUCKET WOULD HAVE BEEN FULL AND NEVER READ (found 2026-08-25, on the first live publish after
 * the mirror shipped — before the Cloudflare Worker was pointed at it).
 *
 * The mirror keyed its objects by the CHANNEL ID. The Worker asks for the SUBDOMAIN, because that is
 * the only name it can know: it is reading the hostname. Firebase derives one from the other by
 * appending a random hash and TRUNCATING past the 63-character DNS limit, so for one real publish:
 *
 *     channel id : v3-agentv3-ryn1xjbfr-c8f1cc9220dd
 *     <sub>      : v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl
 *
 * Every lookup would have missed — and missed SILENTLY, because the Worker falls back to Firebase.
 * Bucket full, Worker never using it, apps still loading fine, storage bill growing, nothing to see.
 * The ninth instance of the pattern this repo has been mining all week: a name that RESEMBLES the
 * thing standing in for the thing.
 */
const SITE = 'gen-lang-client-0866594388';
const REAL_HOST = `https://${SITE}--v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl.web.app`;

describe('the mirror key is the name the Worker will actually ask for', () => {
  it('takes the subdomain from Firebase\'s own host, hash and truncation included', () => {
    expect(channelSubdomain(REAL_HOST, SITE)).toBe('v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl');
  });

  it('and that is NOT the channel id — the whole reason this exists', () => {
    // The real workspace from the report. If these two ever became equal the bug would be invisible
    // again, so the inequality is asserted rather than assumed.
    const id = makeChannelId('agentv3-ryn1xjbfr');
    expect(id).not.toBe(channelSubdomain(REAL_HOST, SITE));
  });

  it('returns empty — never a guess — for anything it cannot parse', () => {
    // A wrong key is worse than no key: it writes objects nobody will ever read and bills for them.
    for (const bad of ['', 'not a url', 'https://example.com/', `https://${SITE}--UPPER.web.app`, `https://other--x.web.app`]) {
      expect(channelSubdomain(bad, SITE)).toBe('');
    }
  });

  it('publishedAppUrl still brands the same host through the same function', () => {
    // One derivation, two callers. Two copies of this parsing is how the mirror and the URL would
    // drift apart again.
    expect(publishedAppUrl(REAL_HOST, SITE, 'mitrify.in')).toBe('https://v3-agentv3-ryn1xjbfr-c8f1c-ic0rtytl.mitrify.in');
    expect(publishedAppUrl(REAL_HOST, SITE, '')).toBe(REAL_HOST);
    expect(publishedAppUrl('https://weird.example/', SITE, 'mitrify.in')).toBe('https://weird.example/');
  });
});

describe('both call sites use it — the half that silently rots', () => {
  const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/Deployment.ts'), 'utf8');

  it('the publish mirrors under the subdomain, not the channel id', () => {
    expect(src).toContain('const key = channelSubdomain(channelUrl, site);');
    expect(src).toContain('await mirrorPublishToBucket(key, files)');
    expect(src).not.toContain('mirrorPublishToBucket(channelId, files)');
  });

  it('a publish it cannot key is SKIPPED, not mirrored under a wrong name', () => {
    expect(src).toContain('could not derive the public subdomain');
  });

  it('the takedown resolves the same key BEFORE deleting the channel', () => {
    // After the channel is gone there is nothing left to ask, so the order is load-bearing: read the
    // host first, delete second. Reversed, every takedown would orphan its bucket copy.
    const at = src.indexOf('async deleteChannelById(');
    const body = src.slice(at, src.indexOf('\n  }', at));
    const read = body.indexOf('subForBucket');
    const del = body.indexOf('axios.delete(');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(del);
    expect(body).toContain('await removePublishFromBucket(subForBucket)');
  });

  it('and says so when it cannot — the one case where a copy can survive a takedown', () => {
    expect(src).toContain('any mirrored copy is untouched');
  });
});

describe('the Worker really does key by the hostname — the premise', () => {
  it('builds its path from the subdomain it parsed out of the host', () => {
    // If this changed, the fix above would be aiming at the wrong name. Asserted so the two files are
    // read together.
    const w = readFileSync(join(__dirname, '..', 'infra/cloudflare/mitrify-apps-worker.js'), 'utf8');
    expect(w).toContain('${APPS_BUCKET}/${APP_PREFIX}/${sub}');
    expect(w).toContain("const sub = host.slice(0, -suffix.length)");
  });
});
