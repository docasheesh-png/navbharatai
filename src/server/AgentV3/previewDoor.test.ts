// Tests for the preview door (admin 2026-08-22: "kya yeh problem kabhi fix nahi ho sakti?").
//
// The door exists to end a CLASS: a stored preview address naming a machine that has since died,
// with a vendor's error page then framed as the user's app. Every rule here is one of the ways that
// class could sneak back in.

import { describe, it, expect } from 'vitest';
import {
  previewDoorEnabled, doorSecret, signDoorToken, verifyDoorToken, makeDoorPath, doorPage,
  DOOR_TOKEN_TTL_MS, DOOR_RETRY_CAP,
} from './previewDoor';

const NOW = 1_700_000_000_000;
const SECRET = 'test-secret';

describe('the door token', () => {
  it('round-trips: what health mints, the door accepts', () => {
    const path = makeDoorPath('ws1', NOW, SECRET);
    const url = new URL(`https://x${path}`);
    expect(url.pathname).toBe('/api/agentv3/preview-door');
    expect(verifyDoorToken(url.searchParams.get('ws'), url.searchParams.get('exp'), url.searchParams.get('sig'), SECRET, NOW + 1000)).toBe(true);
  });

  it('expires — an idle tab from last week does not stay a working credential forever', () => {
    const exp = NOW + DOOR_TOKEN_TTL_MS;
    const sig = signDoorToken('ws1', exp, SECRET);
    expect(verifyDoorToken('ws1', exp, sig, SECRET, exp + 1)).toBe(false);
    expect(verifyDoorToken('ws1', exp, sig, SECRET, exp - 1)).toBe(true);
  });

  it('binds the WORKSPACE — a token for one app cannot open another', () => {
    const exp = NOW + 1000;
    const sig = signDoorToken('ws1', exp, SECRET);
    expect(verifyDoorToken('ws2', exp, sig, SECRET, NOW)).toBe(false);
  });

  it('binds the EXPIRY — extending it invalidates the signature', () => {
    const exp = NOW + 1000;
    const sig = signDoorToken('ws1', exp, SECRET);
    expect(verifyDoorToken('ws1', exp + 999_999, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects tampered, truncated, and malformed input without throwing', () => {
    const exp = NOW + 1000;
    const sig = signDoorToken('ws1', exp, SECRET);
    expect(verifyDoorToken('ws1', exp, sig.slice(0, -1), SECRET, NOW)).toBe(false);
    expect(verifyDoorToken('ws1', exp, `${sig.slice(0, -1)}0`, SECRET, NOW)).toBe(false);
    expect(verifyDoorToken('ws1', 'NaN', sig, SECRET, NOW)).toBe(false);
    expect(verifyDoorToken('', exp, sig, SECRET, NOW)).toBe(false);
    expect(verifyDoorToken('ws1', exp, '', SECRET, NOW)).toBe(false);
    expect(verifyDoorToken(null, null, null, SECRET, NOW)).toBe(false);
  });

  it('a different secret verifies nothing — instances must share SECRET_ENCRYPTION_KEY', () => {
    const exp = NOW + 1000;
    expect(verifyDoorToken('ws1', exp, signDoorToken('ws1', exp, 'other'), SECRET, NOW)).toBe(false);
  });

  it('the dev fallback secret is per-process random, never a guessable constant', () => {
    expect(doorSecret({} as never)).toMatch(/^[0-9a-f]{64}$/);
    expect(doorSecret({ SECRET_ENCRYPTION_KEY: ' k ' } as never)).toBe('k');
  });
});

describe('the kill switch', () => {
  it('is on by default and off only on the explicit word', () => {
    expect(previewDoorEnabled({} as never)).toBe(true);
    expect(previewDoorEnabled({ AGENTV3_PREVIEW_DOOR: 'off' } as never)).toBe(false);
    expect(previewDoorEnabled({ AGENTV3_PREVIEW_DOOR: 'on' } as never)).toBe(true);
  });
});

describe('🔒 the pages the user sees instead of a vendor error', () => {
  it('name no vendor and no machine jargon — this was the reported harm', () => {
    for (const kind of ['asleep', 'starting', 'refused'] as const) {
      const html = doorPage(kind).toLowerCase();
      for (const forbidden of ['e2b', 'sandbox', 'firebase', 'vercel', 'cloudflare', 'closed port', 'not found', 'container', 'vm ']) {
        expect(html, `${kind} page must not say "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('never blames the user, and asleep/starting say what happens NEXT', () => {
    for (const kind of ['asleep', 'starting'] as const) {
      const html = doorPage(kind);
      expect(html).toMatch(/retries by itself/i);
      expect(html).not.toMatch(/error|failed|broken/i);
    }
    expect(doorPage('asleep')).toMatch(/files are safe/i);
  });

  it('asleep and starting retry themselves; an expired link does NOT', () => {
    expect(doorPage('asleep')).toContain('location.reload()');
    expect(doorPage('starting')).toContain('location.reload()');
    expect(doorPage('refused')).not.toContain('location.reload()');
  });

  it('💰 THE RETRY IS CAPPED — an abandoned open tab must not resurrect a paused machine forever', () => {
    // A door hit RESUMES a paused machine (that is the wake working), and resumed compute is billed.
    // Uncapped, a forgotten tab would fight the idle reaper every few seconds indefinitely, at
    // NavBharatAI's expense, for a viewer who is not there.
    for (const kind of ['asleep', 'starting'] as const) {
      const html = doorPage(kind);
      expect(html).toContain(`n<=${DOOR_RETRY_CAP}`);
      expect(html).toContain('sessionStorage');
      // After the cap: an honest stop that points at Wake up, plus a human-driven Try again.
      expect(html).toContain('press Wake up');
      expect(html).toContain('Try again');
    }
  });

  it('a browser that blocks storage degrades to retrying once per load — the SAFE direction', () => {
    // If the counter cannot be kept, the catch swallows the whole retry arm: no timer is armed, so a
    // storage-blocked tab retries only when something reloads it, never on its own forever.
    expect(doorPage('starting')).toMatch(/catch\(e\)\{ \/\* blocked storage/);
  });

  it('is a complete standalone document — it renders inside a bare iframe with no app around it', () => {
    const html = doorPage('starting');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>NavBharatAI Preview</title>');
    expect(html).toContain('viewport');
  });
});
