// Tests for when the frame keeps, replaces, or drops its door link (hand-triage findings, 2026-08-22).

import { describe, it, expect } from 'vitest';
import { nextDoorUrl, doorLinkExpiry, DOOR_REFRESH_WINDOW_MS } from './previewDoorClient';

const NOW = 1_700_000_000_000;
const link = (exp: number) => `/api/agentv3/preview-door?ws=w1&exp=${exp}&sig=abc`;

describe('nextDoorUrl', () => {
  it('THE RELOAD BUG: a fresh held link is KEPT, so a re-mint every poll cannot remount the iframe', () => {
    const held = link(NOW + 20 * 60 * 60 * 1000);
    expect(nextDoorUrl(held, link(NOW + 24 * 60 * 60 * 1000), NOW)).toBe(held);
  });

  it('adopts the first link it is ever offered', () => {
    const first = link(NOW + 1000);
    expect(nextDoorUrl('', first, NOW)).toBe(first);
  });

  it('replaces a link that is about to expire — an all-day tab must not decay into a dead frame', () => {
    const dying = link(NOW + DOOR_REFRESH_WINDOW_MS - 1);
    const fresh = link(NOW + 24 * 60 * 60 * 1000);
    expect(nextDoorUrl(dying, fresh, NOW)).toBe(fresh);
  });

  it('THE KILL-SWITCH TRAP: when the server stops offering a link, the held one is DROPPED', () => {
    // A link the server stopped minting is a link it may now refuse; sticking on it strands the frame
    // on a "refused" page while a working stored-address fallback sits unused.
    expect(nextDoorUrl(link(NOW + 9e9), '', NOW)).toBe('');
  });

  it('an unreadable expiry on the held link is not trusted — replaced, never kept on faith', () => {
    expect(nextDoorUrl('/api/agentv3/preview-door?ws=w1&sig=abc', link(NOW + 9e9), NOW)).toBe(link(NOW + 9e9));
    expect(nextDoorUrl('garbage', link(NOW + 9e9), NOW)).toBe(link(NOW + 9e9));
  });
});

describe('doorLinkExpiry', () => {
  it('reads the expiry and refuses rubbish', () => {
    expect(doorLinkExpiry(link(123456))).toBe(123456);
    expect(doorLinkExpiry('/x?exp=NaN')).toBeNull();
    expect(doorLinkExpiry('/x')).toBeNull();
    expect(doorLinkExpiry('')).toBeNull();
    expect(doorLinkExpiry(null)).toBeNull();
  });
});
