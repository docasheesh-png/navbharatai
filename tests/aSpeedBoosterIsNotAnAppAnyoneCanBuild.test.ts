// 🔴 NO APP CAN MAKE THE INTERNET FASTER — A "BOOSTER" CAN ONLY FAKE ITS NUMBERS (failedbr #2255, 2026-11-20).
//
// "Aisa koi app banakar do jo internet speed ko 5 guna tej kar de" — the builder planned a 1×–5× "boost" selector
// with a "real-time speed display" (its README: "Ye ek demo app hai"). The impossible-powers registry knew four things
// no app can do and not this one, so nothing told the builder, and nothing would have told the user.
// Reversion: drop the 'boost-device-limits' patterns from devicePowers.ts and the first test fails.

import { describe, it, expect } from 'vitest';
import { requestedImpossiblePowers, DEVICE_POWERS_RULE } from '../src/server/AgentV3/devicePowers';

const REPORT = 'Aisa Koi app Mujhe Banakar dudh Jo internet speed ko 5 Guna Tej karke dekh Jaise Mera internet Sath KVS chal raha hai to vah mujhe';
const ids = (p: string) => requestedImpossiblePowers(p).map((x) => x.id);

describe('a request to multiply or boost the connection, memory or battery is named impossible', () => {
  it("#2255's own words", () => {
    expect(ids(REPORT)).toContain('boost-device-limits');
  });
  it.each([
    'make an app that boosts my internet speed',
    'internet speed badhane wala app banao',
    'Build a 10x faster internet app for my wifi',
    'RAM booster app banao',
    'battery booster for my phone',
  ])('%s', (p) => {
    expect(ids(p)).toContain('boost-device-limits');
  });
  it('the builder is told, in the rule every build reads', () => {
    expect(DEVICE_POWERS_RULE).toMatch(/Five things/);
    expect(DEVICE_POWERS_RULE).toMatch(/internet faster/);
    expect(DEVICE_POWERS_RULE).toMatch(/real speed test/);
  });
});

describe('the boundaries: a real, measurable app is never refused', () => {
  it.each([
    'Build an internet speed test app',
    'make a fast app for my shop',
    'internet speed check karne wala app',
    'show my wifi network speed and ping history',
    'battery level monitor app',
    'a data usage tracker',
  ])('%s', (p) => {
    expect(ids(p)).not.toContain('boost-device-limits');
  });
});
