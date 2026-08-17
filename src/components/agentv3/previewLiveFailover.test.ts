import { describe, it, expect } from 'vitest';
import { shouldFailoverToLive, liveFailoverNotice, noLiveRescueNotice, type LiveFailoverSignals, rescueActionForPreviewError } from './previewLiveFailover';

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
    // The INVARIANT is that it names the live server as unavailable — re-pinned 2026-08-17 from the
    // exact phrase "not serving" to the fact itself, when the wording became "is not running". The
    // old regex pinned prose, so a clearer sentence failed a test whose guarantee it still kept.
    expect(n).toMatch(/live server is not (running|serving)/i);
    // Strengthened while here: it must never claim the live server IS running, which would send the
    // user hunting for a working preview that does not exist.
    expect(n).not.toMatch(/live server is (running|serving)\b/i);
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

describe('rescueActionForPreviewError — the preview that "stopped working after 3 days"', () => {
  const base = {
    mode: 'inbrowser',
    errorSource: 'in-browser' as const,
    hasLiveUrl: true,
    alreadyFailedOver: false,
    userPickedInBrowser: false,
  };

  it('DAY 0 — sandbox warm, live URL present: probe it and consider failing over', () => {
    // Right after a build this is the state, which is exactly why the bug stayed invisible: the
    // rescue worked, the user saw their app, and nobody suspected the guard.
    expect(rescueActionForPreviewError(base)).toBe('check-live');
  });

  it('THE REPORTED BUG — DAY 3: no live URL must still TELL the user, never stay silent', () => {
    // Admin 2026-08-17: "3 din baad preview chalta hi nahi hai, e2b me chalta hai." Days later the
    // sandbox is paused, so there is no live URL. The old guard required one, so the whole rescue
    // block was skipped — no failover AND no message. The user got a broken preview and no hint that
    // Diagnose would start a live server and fix it in one tap.
    expect(rescueActionForPreviewError({ ...base, hasLiveUrl: false })).toBe('tell-user');
  });

  it('the notice was ALREADY written for this case — proof the guard was an oversight', () => {
    // It names the live server as not running and points at Diagnose. It could only ever be reached
    // when a live URL existed but was unhealthy — never in the situation it describes.
    const notice = noLiveRescueNotice();
    expect(notice).toContain('live server is not running');
    expect(notice).toContain('Diagnose');
  });

  it('reassures rather than alarms — the old wording said the opposite of what it meant', () => {
    // "nothing here means your files are lost" reads as "there is nothing here, so your files are
    // lost". Harmless while unreachable; not once this path actually shows it to people.
    expect(noLiveRescueNotice()).toContain('none of this means your files are lost');
    expect(noLiveRescueNotice()).not.toContain('nothing here means your files are lost');
  });

  it('a user who chose In-browser is not yanked away — but is still told why it broke', () => {
    // Their choice wins over ours. Silence does not.
    expect(rescueActionForPreviewError({ ...base, userPickedInBrowser: true })).toBe('tell-user');
  });

  it('a second error after one failover explains itself instead of looping', () => {
    expect(rescueActionForPreviewError({ ...base, alreadyFailedOver: true })).toBe('tell-user');
  });

  it('a LIVE-server error never bounces back to live, and never nags the in-browser user', () => {
    expect(rescueActionForPreviewError({ ...base, errorSource: 'live' })).toBe('none');
  });

  it('says nothing about a surface the user is not looking at', () => {
    expect(rescueActionForPreviewError({ ...base, mode: 'live' })).toBe('none');
  });

  it('the only silent outcomes are the two that are not the user\'s problem', () => {
    // Pins the core of the fix: "no live URL" must NEVER be a silent outcome again.
    const silent = [
      { ...base, errorSource: 'live' as const },
      { ...base, mode: 'live' },
    ];
    for (const s of silent) expect(rescueActionForPreviewError(s)).toBe('none');
    expect(rescueActionForPreviewError({ ...base, hasLiveUrl: false })).not.toBe('none');
  });
});
