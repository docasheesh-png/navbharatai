// Tests for the preview door (admin 2026-08-22: "kya yeh problem kabhi fix nahi ho sakti?").
//
// The door exists to end a CLASS: a stored preview address naming a machine that has since died,
// with a vendor's error page then framed as the user's app. Every rule here is one of the ways that
// class could sneak back in.

import { describe, it, expect } from 'vitest';
import {
  previewDoorEnabled, doorSecret, signDoorToken, verifyDoorToken, makeDoorPath, doorPage,
  DOOR_TOKEN_TTL_MS, DOOR_RETRY_CAP, previewInAppOnly,
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

  it('🔒 a browser that blocks storage shows the escape hatch immediately, never spins forever', () => {
    // THE BUG THIS REPLACES (admin screenshot, 2026-09-08, a Capacitor WebView: "ek ghante se yah
    // ghume ja raha hai" — an hour stuck on this exact page). The old catch body was a COMMENT
    // claiming a blocked sessionStorage read left the page "retrying once per load" — but the read
    // that throws is INSIDE the try, so the throw fires before any timer is armed. No timer, no
    // reload, and the give-up UI lived in the `else` branch the throw had already jumped past. A
    // storage-partitioned context (this exact nested-iframe-in-a-WebView shape, also Safari ITP and
    // private browsing) therefore froze on the spinner with no click that could ever move it — worse
    // than either designed outcome, because rule 5's own 50/50 law says a self-heal that cannot run
    // its normal path must still terminate somewhere a person can act.
    //
    // Both outcomes now go through the SAME giveUp() — the retry cap's function, not a second copy.
    const html = doorPage('starting');
    expect(html).toContain('catch(e){ giveUp(); }');
    expect(html).toContain('function giveUp(){');
    // The one property the old test actually protected — the catch never THROWS, even if
    // sessionStorage.removeItem also fails inside the Try again handler — still holds.
    expect(html).toMatch(/r\.onclick=function\(\)\{try\{sessionStorage\.removeItem/);
  });

  it('the retry cap and the storage-blocked case land on the identical escape hatch', () => {
    // Two triggers, one destination — so a future edit to the Wake-up copy cannot fix one path and
    // silently leave the other on the frozen spinner again.
    const html = doorPage('starting');
    const giveUpBody = html.slice(html.indexOf('function giveUp(){'), html.indexOf('try {'));
    expect(giveUpBody).toContain('Still waiting on your app');
    expect(giveUpBody).toContain('press Wake up');
    // Called from the retry-cap `else` AND from `catch` — not duplicated as two separate DOM patches.
    expect(html.match(/giveUp\(\)/g)?.length).toBe(3); // the definition + else branch + catch branch
  });

  it('is a complete standalone document — it renders inside a bare iframe with no app around it', () => {
    const html = doorPage('starting');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>NavBharatAI Preview</title>');
    expect(html).toContain('viewport');
  });
});

describe('in-app-only — a forwarded preview link (admin 2026-08-25: "share link hi hata do")', () => {
  const html = doorPage('in-app-only');

  it('NEVER retries — a self-refreshing refusal would resume a paid machine forever', () => {
    // The other two pages retry on purpose. This one must not: the whole point is that an outside
    // open costs nothing, and a page that reloads itself every few seconds is the opposite of that.
    expect(html).not.toContain('location.reload()');
    expect(html).not.toContain('setTimeout');
  });

  it('shows no spinner — nothing is being waited for', () => {
    expect(html).not.toContain('class="spin"');
  });

  it('says what to do INSTEAD, in the user’s own terms', () => {
    expect(html).toContain('Previews open inside NavBharatAI');
    expect(html.toLowerCase()).toContain('publish');
  });

  it('names no vendor and no infrastructure (the white-label law)', () => {
    // Asserted against the VISIBLE text, not the raw html: the page's own `<meta name="viewport">`
    // contains the substring "port", so a naive whole-document match fails on our own boilerplate.
    // (It did, on the first run — the test was wrong, not the page.)
    const visible = html.replace(/<[^>]*>/g, ' ').toLowerCase();
    expect(visible).not.toMatch(/\be2b\b|\bsandbox\b|\bvercel\b|\bfirebase\b|\brender\b|\bdocker\b|\bport\b/);
  });

  it('does not blame the person who opened it', () => {
    expect(html.toLowerCase()).not.toMatch(/denied|forbidden|not allowed|unauthorized|error/);
  });

  it('the retrying pages are untouched — this must not have disarmed the wake-up', () => {
    for (const kind of ['asleep', 'starting'] as const) {
      const page = doorPage(kind);
      expect(page).toContain('location.reload()');
      expect(page).toContain('class="spin"');
    }
  });
});

describe('previewInAppOnly — the kill switch', () => {
  it('is ON by default, because this IS the fix', () => {
    expect(previewInAppOnly({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('only the exact word off turns it off, whatever the casing or spacing', () => {
    expect(previewInAppOnly({ AGENTV3_PREVIEW_IN_APP_ONLY: 'off' } as never)).toBe(false);
    expect(previewInAppOnly({ AGENTV3_PREVIEW_IN_APP_ONLY: ' OFF ' } as never)).toBe(false);
    expect(previewInAppOnly({ AGENTV3_PREVIEW_IN_APP_ONLY: 'on' } as never)).toBe(true);
    expect(previewInAppOnly({ AGENTV3_PREVIEW_IN_APP_ONLY: 'false' } as never)).toBe(true); // not "off"
  });
});
