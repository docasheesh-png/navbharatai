/**
 * "ownership: mismatch" must not be answered with "nothing left for you to do" (admin 2026-09-02).
 *
 * The screenshot showed both at once on `mitrify.com`:
 *
 *     ownership: mismatch · host: active · SSL: active
 *     Done — all 1 record are now in place (we added 2). Nothing left for you to do;
 *     your domain connects on its own from here.
 *
 * …while the site itself served Firebase's "Site Not Found". Two separate defects produced that.
 *
 * 1. `autoDnsSummary` claimed completion from `missing.length === 0` alone — which only means "the
 *    records WE manage are present in the zone". It says nothing about whether the hosting service has
 *    ACCEPTED them. This file had already learned that lesson mirrored: the "Verified" badge was once
 *    computed from what the service was ASKING for rather than from evidence a record existed.
 *
 * 2. `OWNERSHIP_MISMATCH` had no branch. `CONFLICT` did — written after the admin lost three days to
 *    "Waiting for your DNS records to spread across the internet" on a state that could never resolve
 *    by waiting. MISMATCH is its sibling (a token that exists but names a different site) and fell
 *    through to the very same message. The fix was made for one word and the other was missed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connectStage, hostingReason } from '../src/components/agentv3/NbaiDomainConnect';

const SRC = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

/** Scan CODE, not comments — the MISMATCH branch's own doc comment quotes the waiting message it
 *  replaced, and an ordering assertion that counts that quote tests the documentation, not the code. */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
  .join('\n');
const CF = readFileSync(join(__dirname, '..', 'src/server/lib/cloudflareManagedDns.ts'), 'utf8');

describe('a wrong ownership value is never answered with "wait"', () => {
  it('MISMATCH has its own branch, like CONFLICT', () => {
    expect(SRC).toMatch(/if \(\/MISMATCH\/i\.test\(s\.ownershipState \|\| ''\)\) \{/);
  });

  it('it says plainly that waiting will not change it', () => {
    const at = SRC.indexOf("if (/MISMATCH/i.test(s.ownershipState");
    const branch = SRC.slice(at, at + 900);
    expect(branch).toMatch(/waiting will not change it/i);
    expect(branch).not.toMatch(/spread across the internet/i);
  });

  it('it points at the button, and the button genuinely fixes it', () => {
    const at = SRC.indexOf("if (/MISMATCH/i.test(s.ownershipState");
    expect(SRC.slice(at, at + 900)).toMatch(/Check & apply records/);
    // Verified in the sweep before the message was written: the wanted token is added and every OTHER
    // `hosting-site=` token is deleted. Pointing someone at a button that would not help is how the
    // three days happened the first time.
    expect(CF).toMatch(/if \(!isSiteToken\(content\) \|\| wantedTokens\.has\(content\)\) continue;/);
    expect(CF).toMatch(/method: 'DELETE'/);
  });

  it('MISMATCH is checked BEFORE the generic waiting message it used to fall through to', () => {
    const mismatch = CODE.indexOf("if (/MISMATCH/i.test(s.ownershipState");
    const waiting = CODE.indexOf('spread across the internet');
    expect(mismatch, 'the MISMATCH branch must exist in code').toBeGreaterThan(-1);
    expect(waiting, 'the generic waiting message must exist in code').toBeGreaterThan(-1);
    expect(waiting).toBeGreaterThan(mismatch);
  });
});

describe('records in the zone is NOT the host accepting them', () => {
  it('autoDnsSummary takes the host\'s own verdict', () => {
    expect(SRC).toMatch(/ownershipState\?: string \| null;/);
    expect(SRC).toMatch(/ownershipState: result\?\.ownershipState/);
  });

  it('it refuses to say "nothing left for you to do" while ownership is unsettled', () => {
    const at = SRC.indexOf('const ownershipSettled');
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at, at + 1200);
    // The unsettled branch answers first, and it is not the green one.
    expect(block).toMatch(/if \(!ownershipSettled\)/);
    expect(block).toMatch(/tone: 'info'/);
    expect(block).toMatch(/Your records are in place\./);
    expect(block.slice(0, block.indexOf('THE CASE THAT USED TO READ AS FAILURE')))
      .not.toMatch(/Nothing left for you to do/);
  });

  it('a mismatch that survives the apply is told what to do next, not to keep waiting', () => {
    const at = SRC.indexOf('const ownershipSettled');
    const block = SRC.slice(at, at + 1200);
    expect(block).toMatch(/tap “Check & apply records” once more/);
  });

  it('an ACTIVE or unknown ownership still gets the original completion message', () => {
    // Absent state must not turn every completed domain into a warning — the field is optional and
    // older callers pass nothing.
    expect(SRC).toMatch(/const ownershipSettled = ownership === '' \|\| \/ACTIVE\/i\.test\(ownership\);/);
    expect(SRC).toMatch(/Nothing left for you to do; your domain connects on its own from here\./);
  });
});

/**
 * ROCK-SOLID PASS (admin: "apne abhi jo update kiya isko bhi rocksolid karo").
 *
 * The MISMATCH branch as first written broke this file's OWN rule — "Never diagnose from a status enum
 * when the API also shipped the reason" (firebaseCustomDomain.ts, written after `ownership: missing`
 * reached the admin as one unexplained word). It read the enum and ASSERTED a cause: "connected from
 * another app before". That is the likeliest cause; it is not evidence. Firebase's `issues[]` outranks
 * anything we infer.
 */
describe('the host\'s own words outrank our guess', () => {
  const base = { active: false, hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE' };

  it('leads with Firebase\'s reason when there is one', () => {
    const r = connectStage({
      ...base,
      ownershipState: 'OWNERSHIP_MISMATCH',
      issues: ['Custom Domain has an ownership record pointing at site nbai-old-1234.'],
    });
    expect(r.note).toMatch(/^Your host says: “Custom Domain has an ownership record/);
    // …and still tells them what to do about it.
    expect(r.note).toMatch(/Check & apply records/);
    expect(r.tone).toBe('warn');
  });

  it('falls back to our explanation when Firebase said nothing', () => {
    for (const issues of [undefined, null, [], ['   '], ['']]) {
      const r = connectStage({ ...base, ownershipState: 'OWNERSHIP_MISMATCH', issues: issues as string[] | null });
      expect(r.note).not.toMatch(/Your host says/);
      expect(r.note).toMatch(/carries the wrong value/);
    }
  });

  it('CONFLICT gets the same treatment — the API explains that one too', () => {
    const r = connectStage({
      ...base,
      ownershipState: 'OWNERSHIP_CONFLICT',
      issues: ['There must be at most one TXT record with the hosting-site= prefix on the domain.'],
    });
    expect(r.note).toMatch(/^Your host says: “There must be at most one TXT record/);
    expect(r.note).toMatch(/Check & apply records/);
  });

  it('neither branch tells the user to wait', () => {
    // The whole reason both branches exist: waiting cannot fix a wrong or duplicated value, and saying
    // otherwise cost three days once already.
    for (const st of ['OWNERSHIP_MISMATCH', 'OWNERSHIP_CONFLICT']) {
      const r = connectStage({ ...base, ownershipState: st, issues: [] });
      expect(r.headline, st).toMatch(/waiting will not/i);
      expect(r.action, st).toBe('check');
    }
  });

  it('an ACTIVE ownership is untouched by any of this', () => {
    // The hardening must not turn a working domain into a warning.
    const r = connectStage({ ...base, ownershipState: 'OWNERSHIP_ACTIVE', issues: ['stale note'] });
    expect(r.headline).not.toMatch(/waiting will not/i);
  });
});

describe('hostingReason cannot turn a provider message into noise', () => {
  it('uses only the FIRST reason, so a stack of them never floods the note', () => {
    expect(hostingReason(['first thing', 'second thing'])).toBe('Your host says: “first thing.” ');
  });

  it('collapses whitespace and newlines — these arrive multi-line', () => {
    expect(hostingReason(['a\n\n   b   \tc'])).toBe('Your host says: “a b c.” ');
  });

  it('caps a very long message instead of pasting a wall of text', () => {
    const out = hostingReason(['x'.repeat(500)]);
    expect(out.length).toBeLessThan(260);
    expect(out).toMatch(/…/);
  });

  it('does not double a punctuation mark it already has', () => {
    expect(hostingReason(['already ends properly.'])).toBe('Your host says: “already ends properly.” ');
    expect(hostingReason(['a question?'])).toBe('Your host says: “a question?” ');
  });

  it('returns nothing for nothing', () => {
    expect(hostingReason(undefined)).toBe('');
    expect(hostingReason(null)).toBe('');
    expect(hostingReason([])).toBe('');
    expect(hostingReason([null as unknown as string])).toBe('');
  });
});
