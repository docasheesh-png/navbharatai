// Tests for the stale-preview-url verdict (admin screenshot 2026-08-22: a vendor "Sandbox Not Found"
// page framed as the user's app, under a banner insisting the dev server was up).

import { describe, it, expect } from 'vitest';
import {
  previewHost, comparePreviewUrl, measurementDescribesUserView, stalePreviewMessage,
} from './previewUrlFreshness';

const OLD = 'https://3000-ibhrxjtsadziapd5rjdpq.e2b.app';
const NEW = 'https://3000-abcdefghijklmnopqrst.e2b.app';

describe('comparePreviewUrl', () => {
  it('THE REPORTED CASE: the frame is on the old machine, the probe measured a new one', () => {
    expect(comparePreviewUrl(OLD, NEW)).toBe('stale');
  });

  it('the same machine is the same machine, whatever the path, query or trailing slash', () => {
    expect(comparePreviewUrl(OLD, `${OLD}/`)).toBe('same');
    expect(comparePreviewUrl(`${OLD}/customer/home?x=1`, OLD)).toBe('same');
    expect(comparePreviewUrl(OLD.toUpperCase(), OLD)).toBe('same');
  });

  it('says UNKNOWN rather than guessing when either side is missing or unparseable', () => {
    for (const [a, b] of [[OLD, ''], ['', NEW], [null, NEW], [OLD, undefined], ['not a url', NEW]] as const) {
      expect(comparePreviewUrl(a, b), `${a} vs ${b}`).toBe('unknown');
    }
  });
});

describe('measurementDescribesUserView — the honesty rule', () => {
  it('a reading from a DIFFERENT machine is never a verdict about what the user sees', () => {
    // This is the whole bug: "Dev server is up on port 3000" was TRUE — about a machine the user was
    // not looking at — while their frame showed a dead host.
    expect(measurementDescribesUserView('stale')).toBe(false);
  });

  it('same or unknown may still be reported — silence is not the goal, only accuracy', () => {
    expect(measurementDescribesUserView('same')).toBe(true);
    expect(measurementDescribesUserView('unknown')).toBe(true);
  });
});

describe('previewHost', () => {
  it('extracts the host and never throws on rubbish', () => {
    expect(previewHost(OLD)).toBe('3000-ibhrxjtsadziapd5rjdpq.e2b.app');
    for (const junk of ['', '   ', 'nope', '//x', null, undefined]) {
      expect(previewHost(junk as never)).toBe('');
    }
  });
});

describe('🔒 what the user is told', () => {
  it('names no vendor and no sandbox — the white-label law is not optional here', () => {
    const m = stalePreviewMessage();
    expect(m).not.toMatch(/sandbox|e2b|vercel|firebase|container|vm\b/i);
  });

  it('does not blame the user for a machine expiring', () => {
    expect(stalePreviewMessage()).not.toMatch(/you (did|should|need to)|your fault|try again yourself/i);
  });

  it('says what is happening next, not just what went wrong', () => {
    expect(stalePreviewMessage()).toMatch(/reconnect/i);
  });
});
