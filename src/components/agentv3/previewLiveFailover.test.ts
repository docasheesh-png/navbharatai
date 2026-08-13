import { describe, it, expect } from 'vitest';
import { shouldFailoverToLive, liveFailoverNotice, noLiveRescueNotice, type LiveFailoverSignals } from './previewLiveFailover';

// The exact state of admin report 858f6d7b: the app built and ran on the sandbox, but the in-browser
// preview could not fetch react-dom/client from the CDN and painted a red wall.
const brokenInBrowserWithWorkingLiveServer: LiveFailoverSignals = {
  mode: 'inbrowser',
  hasLiveUrl: true,
  errorSource: 'in-browser',
  liveHealthy: true,
  alreadyFailedOver: false,
  userPickedInBrowser: false,
};

describe('shouldFailoverToLive', () => {
  it('fails over when the in-browser preview breaks and a live server is running (report 858f6d7b)', () => {
    expect(shouldFailoverToLive(brokenInBrowserWithWorkingLiveServer)).toBe(true);
  });

  it('does NOT fail over when there is no live server to fail over to', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, hasLiveUrl: false })).toBe(false);
  });

  it('does NOT bounce a live-server error back onto the live server', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, mode: 'live', errorSource: 'live' })).toBe(false);
  });

  it('does NOT fail over when the live view is already showing', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, mode: 'live' })).toBe(false);
  });

  it('fires at most once per workspace — a second error can never loop the view', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, alreadyFailedOver: true })).toBe(false);
  });

  it('respects an explicit user choice of In-browser over our own preference', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, userPickedInBrowser: true })).toBe(false);
  });
});

describe('liveFailoverNotice', () => {
  it('explains the switch honestly instead of letting it look like a glitch', () => {
    const notice = liveFailoverNotice();
    expect(notice).toMatch(/in-browser/i);
    expect(notice).toMatch(/live server/i);
  });

  it('names no vendor or CDN (White-Label Law — the user only ever sees NavBharatAI)', () => {
    const notice = liveFailoverNotice().toLowerCase();
    for (const vendor of ['esm.sh', 'esm.run', 'e2b', 'cdn', 'babel', 'vite', 'npm ']) {
      expect(notice).not.toContain(vendor);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// A URL IS NOT A RUNNING SERVICE (admin report 2026-08-13, build 79d0e3a4).
//
// The first version of this module gated the failover on hasLiveUrl alone. A preview URL is PERMANENT
// while the service behind it is EPHEMERAL — so a broken in-browser preview handed the user to a live
// server serving nothing ("Closed Port Error … Connection refused on port 3000") while the notice said
// "that is your app really running". The build's own release gate had already recorded "no live preview
// was ever available": the system knew, and the screen contradicted it.
//
// The same mistake was already written down in previewAutoReboot.ts — "URL presence was being used as
// liveness". These lock the lesson where it belongs.
describe('liveness, not URL presence', () => {
  it('does NOT move the user to a live server that is serving nothing (the reported failure)', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, liveHealthy: false })).toBe(false);
  });

  it('treats an unanswered health probe as "no", never as a yes', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, liveHealthy: null })).toBe(false);
  });

  it('still fails over when the server has CONFIRMED something is serving', () => {
    expect(shouldFailoverToLive({ ...brokenInBrowserWithWorkingLiveServer, liveHealthy: true })).toBe(true);
  });
});

describe('noLiveRescueNotice', () => {
  it('states both facts instead of leaving a red wall unexplained', () => {
    const n = noLiveRescueNotice();
    expect(n).toMatch(/in-browser/i);
    expect(n).toMatch(/not serving/i);
  });

  it('points at the one action that helps, and reassures about the files', () => {
    expect(noLiveRescueNotice()).toMatch(/diagnose/i);
    expect(noLiveRescueNotice()).toMatch(/files are lost/i);
  });

  it('claims nothing that has not been verified', () => {
    // The whole defect was a message asserting the app was running when it was not.
    expect(noLiveRescueNotice().toLowerCase()).not.toContain('really running');
  });
});
