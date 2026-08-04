import { describe, it, expect } from 'vitest';
import { shouldFailoverToLive, liveFailoverNotice, type LiveFailoverSignals } from './previewLiveFailover';

// The exact state of admin report 858f6d7b: the app built and ran on the sandbox, but the in-browser
// preview could not fetch react-dom/client from the CDN and painted a red wall.
const brokenInBrowserWithWorkingLiveServer: LiveFailoverSignals = {
  mode: 'inbrowser',
  hasLiveUrl: true,
  errorSource: 'in-browser',
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
