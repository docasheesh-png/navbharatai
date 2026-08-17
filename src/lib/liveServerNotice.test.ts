import { describe, it, expect } from 'vitest';
import {
  LIVE_SERVER_PAID_NOTE,
  LIVE_SERVER_PAID_TAG,
  isLiveServerNoticeDismissed,
  dismissLiveServerNotice,
} from './liveServerNotice';

// A tiny in-memory Storage stand-in so the dismiss logic is tested without a real localStorage.
function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

describe('the note tells the truth, and names no vendor (White-Label §2)', () => {
  it('says it is PAID and that in-browser is free', () => {
    expect(LIVE_SERVER_PAID_NOTE).toMatch(/paid service/i);
    expect(LIVE_SERVER_PAID_NOTE).toMatch(/in-browser preview is free/i);
    expect(LIVE_SERVER_PAID_NOTE).toMatch(/credits/i);
    expect(LIVE_SERVER_PAID_TAG.toLowerCase()).toBe('paid');
  });

  it('never leaks the cloud provider — no vendor name reaches the user', () => {
    for (const token of ['E2B', 'e2b', 'sandbox', 'AWS', 'GCP', 'Firebase', 'Anthropic']) {
      expect(LIVE_SERVER_PAID_NOTE.includes(token)).toBe(false);
    }
  });
});

describe('dismiss is remembered, so it informs without nagging', () => {
  it('is not dismissed until the user acknowledges it', () => {
    const s = memStore();
    expect(isLiveServerNoticeDismissed(s)).toBe(false);
    dismissLiveServerNotice(s);
    expect(isLiveServerNoticeDismissed(s)).toBe(true);
  });

  it('never throws when storage is unavailable (private mode)', () => {
    expect(() => dismissLiveServerNotice(null)).not.toThrow();
    expect(isLiveServerNoticeDismissed(null)).toBe(false);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(() => dismissLiveServerNotice(throwing)).not.toThrow();
    expect(isLiveServerNoticeDismissed(throwing)).toBe(false);
  });
});

describe('it is wired into the Live-server preview', () => {
  const read = () => require('fs').readFileSync(
    require('path').join(__dirname, '../components/agentv3/PreviewSurface.tsx'), 'utf8',
  ) as string;

  it('renders the paid note only while the Live server is in use', () => {
    const src = read();
    expect(src).toContain('LIVE_SERVER_PAID_NOTE');
    expect(src).toContain("mode === 'live' && !paidNoteDismissed");
    // The note is shown in the live view, dismissible.
    expect(src).toContain('dismissLiveServerNotice()');
  });

  it('marks the Live-server toggle as Paid, so the cost is clear even after the note is dismissed', () => {
    expect(read()).toContain('LIVE_SERVER_PAID_TAG');
  });

  it('does not leak the cloud vendor in the live-preview prose (White-Label)', () => {
    const src = read();
    // The old copy said "a cloud sandbox (E2B)" to the user — that vendor name must be gone.
    expect(src).not.toContain('sandbox (E2B)');
  });
});
