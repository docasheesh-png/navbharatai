/**
 * THE CARD SAID FIVE AND THE SERVER REFUSED THE FOURTH (admin capture, 2026-09-18).
 *
 * One screenshot of the "Publish your app" sheet carried both of these at once:
 *
 *     Error: You already have 3 apps published on NavBharatAI, which is the free limit of 3.
 *     • 5 apps free · updating one you published is always free
 *
 * The error came from `publishedAppCap()` on the server; the bullet was a LITERAL typed into
 * `HostingChooser.tsx`. Nothing type-checks a number written in prose, so the card drifted away from
 * the constant the whole rest of the product quotes and nobody found out until a user was refused a
 * publish the card had just promised them.
 *
 * The class is the one this repo has paid for repeatedly — a value duplicated as text instead of read
 * from its single source (four copies of `safeRelPath`, the E2B rate, the idle-minutes default). The
 * fix is not "write 3": it is that the card can no longer state a number of its own at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FREE_PUBLISHED_APPS } from '../src/lib/hostingTiers';

const chooserRaw = readFileSync(resolve(__dirname, '../src/components/agentv3/HostingChooser.tsx'), 'utf8');
// Comments stripped for the absence check: the fix's OWN comment quotes the bad string it replaced, and
// a needle that matches the explanation instead of the code is a test that cannot fail for the right
// reason. (Caught on this file's first run — the same trap as the `.catch(() => null)` sweep.)
const chooser = chooserRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

describe('the free-publish limit is quoted, never typed', () => {
  it('the hosting card reads the enforced constant', () => {
    expect(chooserRaw).toContain("import { FREE_PUBLISHED_APPS } from '../../lib/hostingTiers'");
    expect(chooser).toContain('<li>• {FREE_PUBLISHED_APPS} apps free');
  });

  it('REVERSION: no digit is written in front of "apps free" anywhere in that sheet', () => {
    // The exact shape of the bug. A literal here passes every type check and every existing test —
    // this is the only thing that can catch it, so it asserts the ABSENCE rather than the presence.
    const lines = chooser.split('\n').filter((l) => /\d+\s+apps free/.test(l));
    expect(lines).toEqual([]);
  });

  it('the server cap and the quoted constant are the same number', () => {
    // `publishedAppCap()` is env-tunable and authoritative; this constant mirrors its DEFAULT, and
    // HostingQuota.ts names that pairing explicitly. Pinned here too, because the card now shows it.
    const quota = readFileSync(resolve(__dirname, '../src/server/lib/HostingQuota.ts'), 'utf8');
    expect(quota).toContain('FREE_PUBLISHED_APPS');
    expect(FREE_PUBLISHED_APPS).toBe(3);
  });
});
