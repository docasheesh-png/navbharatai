import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLD_START_EVENT,
  MAX_PLAUSIBLE_COLD_START_MS,
  coldStartPayload,
  coldStartVerdict,
  type ColdStartInput,
} from '../src/lib/coldStart';

/**
 * ⏱️ MEASURE THE COLD START BEFORE OPTIMISING IT (admin 2026-09-19, item E of five).
 *
 * The audit that produced items A–E found `dist/assets` at 5.9 MB and the splash released at 1 s, and
 * could say NOTHING about what that costs a real user — because nobody had measured it. This repo
 * learned the price of skipping that step on E2B spend, where a derivation that "could not fail" put a
 * number half the real one into a doc for a month.
 *
 * Two things are locked here, and the second is the one that makes the first trustworthy:
 *   1. the number is HONEST about what it excludes — the native prelude is invisible to JavaScript and
 *      the payload says so, so a dashboard cannot present the web half as the whole launch;
 *   2. a load that no human experienced is REJECTED BY NAME, not averaged away — a reload, a
 *      background pre-warm and a partial timing each poison an average in a different direction.
 */

const base: ColdStartInput = {
  navigationType: 'navigate',
  responseStart: 12,
  domContentLoaded: 380,
  firstContentfulPaint: 520,
  appReady: 910,
  wasHiddenDuringLaunch: false,
  nativeShell: true,
};

describe('a launch a human actually watched', () => {
  it('produces a phase breakdown', () => {
    const v = coldStartVerdict(base);
    expect(v.usable).toBe(true);
    if (!v.usable) return;
    expect(v.phases.toFirstByte).toBe(12);
    expect(v.phases.toDomReady).toBe(380);
    expect(v.phases.toFirstPaint).toBe(520);
    expect(v.phases.toAppReady).toBe(910);
    // The half that is ours to fix: how long our own JavaScript took after the DOM was ready.
    expect(v.phases.scriptBoot).toBe(530);
  });

  it('labels the surface, because the app and the website are different launches', () => {
    expect((coldStartVerdict(base) as { surface: string }).surface).toBe('app');
    expect((coldStartVerdict({ ...base, nativeShell: false }) as { surface: string }).surface).toBe('web');
  });

  it('never reports a negative duration', () => {
    // Two clocks from two entries; a sub-millisecond ordering quirk must not surface as -1ms.
    const v = coldStartVerdict({ ...base, domContentLoaded: 400, appReady: 399.6 });
    expect(v.usable).toBe(true);
    if (!v.usable) return;
    expect(v.phases.scriptBoot).toBe(0);
  });

  it('survives a missing paint entry rather than throwing the sample away', () => {
    const v = coldStartVerdict({ ...base, firstContentfulPaint: undefined });
    expect(v.usable).toBe(true);
    if (!v.usable) return;
    expect(v.phases.toFirstPaint).toBeNull();
    expect(v.phases.toAppReady).toBe(910); // the number that matters is still there
  });
});

describe('🔒 loads that no human experienced are rejected BY NAME', () => {
  it('a reload is not a cold start', () => {
    expect(coldStartVerdict({ ...base, navigationType: 'reload' })).toEqual({
      usable: false, reason: 'not-a-launch',
    });
  });

  it('a back/forward restore is not a cold start', () => {
    expect(coldStartVerdict({ ...base, navigationType: 'back_forward' })).toEqual({
      usable: false, reason: 'not-a-launch',
    });
  });

  it('a launch nobody watched is rejected', () => {
    // A background pre-warm, or the user switching away mid-launch. Browsers also throttle timers in a
    // hidden document, so the numbers would be long AND meaningless.
    expect(coldStartVerdict({ ...base, wasHiddenDuringLaunch: true })).toEqual({
      usable: false, reason: 'backgrounded',
    });
  });

  it('a partial timing is rejected, not filled in with a guess', () => {
    expect(coldStartVerdict({ ...base, appReady: undefined }).usable).toBe(false);
    expect(coldStartVerdict({ ...base, responseStart: undefined }).usable).toBe(false);
    expect(coldStartVerdict({ ...base, domContentLoaded: undefined }).usable).toBe(false);
    expect(coldStartVerdict({ ...base, appReady: 0 }).usable).toBe(false);
  });

  it('an implausible figure is a stalled tab or a moved clock, not a slow launch', () => {
    expect(coldStartVerdict({ ...base, appReady: MAX_PLAUSIBLE_COLD_START_MS + 1 }).usable).toBe(false);
    expect(coldStartVerdict({ ...base, appReady: MAX_PLAUSIBLE_COLD_START_MS - 1 }).usable).toBe(true);
  });

  it('an unknown navigation type is allowed through — an absent API is not a bad sample', () => {
    expect(coldStartVerdict({ ...base, navigationType: undefined }).usable).toBe(true);
  });
});

describe('🔴 the payload admits what it cannot see', () => {
  it('says the native prelude is excluded, in the row itself', () => {
    const v = coldStartVerdict(base);
    expect(v.usable).toBe(true);
    if (!v.usable) return;
    const payload = coldStartPayload(v);
    // Whoever builds a dashboard from these rows must not be able to read the web half as the whole
    // launch. The process start, the Activity and the WebView's creation are invisible to JavaScript.
    expect(payload.excludesNativeLaunch).toBe(true);
    expect(payload.surface).toBe('app');
    expect(payload.toAppReady).toBe(910);
  });

  it('does not claim to exclude a native prelude on the website, where there is none', () => {
    const v = coldStartVerdict({ ...base, nativeShell: false });
    expect(v.usable).toBe(true);
    if (!v.usable) return;
    expect(coldStartPayload(v).excludesNativeLaunch).toBe(false);
  });
});

describe('the wiring reuses the existing pipeline', () => {
  const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');

  /**
   * The sender's body, sliced by ANCHOR rather than by a character count.
   *
   * ⚠️ The first draft used `at + 2200` and the assertion fell off the end — the same brittleness this
   * session had just fixed in `githubNativeReturnWiring.test.ts`, reproduced two hours later. A fixed
   * length makes an assertion depend on how much prose sits above it inside the function.
   */
  const sender = (() => {
    const at = main.indexOf('function measureColdStart');
    expect(at, 'the sender must exist').toBeGreaterThan(-1);
    const end = main.indexOf('\n}\n', at);
    expect(end, 'the sender no longer ends where this test expects').toBeGreaterThan(at);
    return main.slice(at, end);
  })();

  it('rides the SAME consent gate as web-vitals — not a second decision', () => {
    expect(sender).toContain('hasAnalyticsConsent()');
    expect(sender).toContain("'/api/analytics/event'");
    // The SHARED CONSTANT, not a hand-typed string: the sender and any later reader of these rows
    // must name the event from one place. (My first draft asserted the VALUE and failed — main.tsx
    // correctly uses the identifier, which is the stronger thing to require.)
    expect(sender).toContain('COLD_START_EVENT');
    expect(COLD_START_EVENT).toBe('cold_start');
  });

  it('is stamped in the frame that already proves the shell painted', () => {
    // Reusing that frame rather than inventing a second "ready" signal that could drift from it.
    const raf = main.indexOf('requestAnimationFrame(() => {');
    const call = main.indexOf('measureColdStart(performance.now())');
    expect(raf).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(raf);
  });

  it('can never break a launch', () => {
    expect(sender).toContain('try {');
    expect(sender).toContain('catch');
    expect(sender).toContain('.catch(() => {})'); // a failed post is not a failed launch
  });
});
