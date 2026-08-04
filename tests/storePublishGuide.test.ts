import { describe, it, expect } from 'vitest';
import { getPublishGuide, getAllPublishGuides, renderPublishGuideText } from '../src/server/lib/storePublishGuide';
import { pickBinaryName, isValidArtifactId, registerMobileShipRoutes } from '../src/server/routes/mobileShip';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// Admin 2026-07-26: "user ko guide bhi kare ki kaise app ko app store ya play store me publish karni
// hai … ek ek step bata bata kar … user non technical honge mere jaise". These tests lock the qualities
// that actually make a walkthrough usable by someone who has never opened Play Console: money and time
// stated up front, every step self-verifiable, and total honesty about what only the user can do.

describe('publish guide — covers both stores end to end', () => {
  it('has a guide for each store, ending at "you are live"', () => {
    for (const g of getAllPublishGuides()) {
      expect(g.steps.length).toBeGreaterThanOrEqual(8);
      expect(g.steps[g.steps.length - 1].id).toMatch(/-live$/);
    }
  });

  it('every step has a stable id, a title and real instructions', () => {
    for (const g of getAllPublishGuides()) {
      const ids = g.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length); // ids drive saved progress — they must be unique
      for (const s of g.steps) {
        expect(s.id).toMatch(/^(android|ios)-[a-z-]+$/);
        expect(s.title.length).toBeGreaterThan(5);
        expect(s.detail.length).toBeGreaterThan(40); // a one-liner is not a walkthrough
      }
    }
  });

  it('states the real, recurring cost up front — Play is one-time, Apple is yearly', () => {
    const android = getPublishGuide('android');
    const ios = getPublishGuide('ios');
    expect(android.upfront).toMatch(/once|one[- ]time/i);
    expect(ios.upfront).toMatch(/every\s+year/i);
    // The yearly trap (app removed if you stop paying) must be said, not buried.
    expect(ios.steps.find((s) => s.id === 'ios-account')?.detail).toMatch(/removed/i);
  });

  it('promises the user does NOT need a Mac — the whole point of building on GitHub', () => {
    const ios = getPublishGuide('ios');
    expect(ios.upfront).toMatch(/do NOT need a Mac/i);
    expect(ios.steps.some((s) => s.id === 'ios-no-mac' && s.navbharatDoesThis)).toBe(true);
  });

  it('marks honestly which steps only the user can do, and which NavBharatAI does', () => {
    for (const g of getAllPublishGuides()) {
      expect(g.steps.some((s) => s.youMustDoThis)).toBe(true);
      expect(g.steps.some((s) => s.navbharatDoesThis)).toBe(true);
      // Never both — that would be an ambiguous promise.
      for (const s of g.steps) expect(s.youMustDoThis && s.navbharatDoesThis).toBeFalsy();
    }
  });

  it('paying and account creation are always the USER’s step, never claimed by us', () => {
    for (const g of getAllPublishGuides()) {
      const account = g.steps.find((s) => s.id.endsWith('-account'))!;
      expect(account.youMustDoThis).toBe(true);
      expect(account.navbharatDoesThis).toBeFalsy();
      expect(account.cost).toBeTruthy();
    }
  });

  it('the build and download steps ARE done for the user', () => {
    const a = getPublishGuide('android');
    expect(a.steps.find((s) => s.id === 'android-build')?.navbharatDoesThis).toBe(true);
    expect(a.steps.find((s) => s.id === 'android-download')?.navbharatDoesThis).toBe(true);
  });

  it('explains both Android outputs — .aab for Play, .apk to install on a phone', () => {
    const d = getPublishGuide('android').steps.find((s) => s.id === 'android-download')!.detail;
    expect(d).toContain('.aab');
    expect(d).toContain('.apk');
  });

  it('gives a self-check for the steps a beginner could otherwise get stuck on', () => {
    for (const g of getAllPublishGuides()) {
      const actionable = g.steps.filter((s) => s.youMustDoThis);
      for (const s of actionable) expect(s.youShouldSee, `${s.id} needs a "you should see"`).toBeTruthy();
    }
  });

  it('links straight to the real signup/console pages', () => {
    expect(getPublishGuide('android').steps.find((s) => s.id === 'android-account')?.link).toContain('play.google.com');
    expect(getPublishGuide('ios').steps.find((s) => s.id === 'ios-account')?.link).toContain('developer.apple.com');
  });

  it('reassures that an Apple rejection is normal — the most common first-timer panic', () => {
    expect(getPublishGuide('ios').steps.find((s) => s.id === 'ios-submit')?.detail).toMatch(/not a failure/i);
  });
});

describe('renderPublishGuideText — the AI / SHIPPING.md rendering', () => {
  it('numbers the steps and carries cost, timing and the honest ownership labels', () => {
    const t = renderPublishGuideText('android');
    expect(t).toContain('1. Create a Google Play developer account');
    expect(t).toMatch(/Cost:/);
    expect(t).toMatch(/Takes:/);
    expect(t).toContain('Only you can do this');
    expect(t).toContain('NavBharatAI does this for you');
  });

  it('renders every step of both guides — nothing silently dropped', () => {
    for (const g of getAllPublishGuides()) {
      const t = renderPublishGuideText(g.platform);
      for (const s of g.steps) expect(t).toContain(s.title);
    }
  });
});

describe('artifact download helpers', () => {
  it('picks the Play bundle first, then the installable apk, then the iOS build', () => {
    expect(pickBinaryName(['app-release.aab'])).toBe('app-release.aab');
    expect(pickBinaryName(['app-release.apk'])).toBe('app-release.apk');
    expect(pickBinaryName(['App.ipa'])).toBe('App.ipa');
    // .aab wins when a build produced both, because that is what Play requires.
    expect(pickBinaryName(['app-release.apk', 'app-release.aab'])).toBe('app-release.aab');
  });

  it('ignores macOS zip cruft and reports nothing when there is no app file', () => {
    expect(pickBinaryName(['__MACOSX/app-release.aab', 'readme.txt'])).toBeNull();
    expect(pickBinaryName([])).toBeNull();
  });

  it('artifact ids must be numeric — no path smuggling into the GitHub URL', () => {
    expect(isValidArtifactId('12345')).toBe(true);
    expect(isValidArtifactId(12345)).toBe(true);
    expect(isValidArtifactId('12/../x')).toBe(false);
    expect(isValidArtifactId('abc')).toBe(false);
    expect(isValidArtifactId('')).toBe(false);
  });
});

describe('mobile-ship guide + download routes', () => {
  const routes = captureRoutes(registerMobileShipRoutes);

  it('registers the guide, runs, artifacts and download endpoints', () => {
    for (const r of ['GET /api/mobile-ship/guide', 'GET /api/mobile-ship/runs', 'GET /api/mobile-ship/artifacts', 'GET /api/mobile-ship/download']) {
      expect(typeof routes.get(r), r).toBe('function');
    }
  });

  it('the guide needs no login and returns both walkthroughs', async () => {
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/guide')!(mockReq({ query: {} }), res);
    expect(res.body.guides).toHaveLength(2);
  });

  it('a single platform returns its steps plus the rendered text', async () => {
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/guide')!(mockReq({ query: { platform: 'ios' } }), res);
    expect(res.body.guide.platform).toBe('ios');
    expect(res.body.text).toContain('Apple Developer Program');
  });

  it('downloading without a GitHub token is refused honestly', async () => {
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/download')!(mockReq({ query: { owner: 'me', repo: 'app', artifactId: '1' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('a non-numeric artifact id is rejected before any GitHub call', async () => {
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/download')!(
      mockReq({ headers: { authorization: 'token gh_x' }, query: { owner: 'me', repo: 'app', artifactId: '../secret' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('build status rejects an unknown workflow name', async () => {
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/runs')!(
      mockReq({ headers: { authorization: 'token gh_x' }, query: { owner: 'me', repo: 'app', workflow: 'evil.yml' } }), res);
    expect(res.statusCode).toBe(400);
  });
});
