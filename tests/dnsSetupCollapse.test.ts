import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldShowDnsSetup } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * "GALTI SE BAR BAR CONNECT KARTA RAHTA HAI" (admin 2026-09-06, screenshot of an ALREADY-connected
 * domain — "Connected, with HTTPS" in green, ownership/host/SSL all active — still showing the full
 * "Set these two nameservers… Check & apply records… Where did you buy this domain?" block right
 * underneath. Someone reading that sees instructions for a thing that is already done, and (per the
 * admin) repeatedly re-presses "Check & apply" believing something is still pending.
 *
 * Lesson borrowed from Google Workspace's own domain-connect flow (a screenshot in the same
 * conversation): once verified, get the setup noise OFF the screen — but folded behind a real
 * button, never deleted, because the values are still needed occasionally (re-copy a record,
 * re-check a nameserver after a registrar reset).
 */
describe('shouldShowDnsSetup — visible while pending, tucked away once done', () => {
  it('🔒 while still connecting, ALWAYS visible — never gated behind a click', () => {
    // Hiding setup instructions behind a button the user has to discover would make finishing setup
    // HARDER, which is the opposite of the point. `sectionOpen` must not matter here.
    expect(shouldShowDnsSetup(false, false)).toBe(true);
    expect(shouldShowDnsSetup(false, true)).toBe(true);
  });

  it('once active, collapsed by default', () => {
    expect(shouldShowDnsSetup(true, false)).toBe(false);
  });

  it('🔒 a manual re-open always wins, even once active', () => {
    // Someone re-adding a nameserver after a registrar reset, or copying a record value again, must
    // still be able to reach it in one tap.
    expect(shouldShowDnsSetup(true, true)).toBe(true);
  });
});

describe('🔒 the wiring — the toggle exists, defaults collapsed, and a manual open survives', () => {
  const src = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

  it('the button only appears once the domain is genuinely active', () => {
    expect(src).toContain('{result.active && (');
    expect(src).toContain("setDnsSectionOpen((v) => !v)");
    expect(src).toContain('DNS records');
  });

  it('starts collapsed — the exact screenshot state must not repeat on load', () => {
    expect(src).toContain('useState(false);');
    // The declaration comment ties it to shouldShowDnsSetup, so a later edit that detaches the two
    // has to touch this line and think about it.
    expect(src).toContain('dnsSectionOpen');
  });

  it('the setup block itself is gated by the pure rule, not a second ad-hoc condition', () => {
    // ⚠️ RE-ANCHORED 2026-09-07: the gate now ALSO holds shut for a backend-pointed domain, whose
    // "Check & apply records" would hand the domain back to static hosting and take the live site
    // down (see domainPointing.ts). The property here is unchanged — ONE pure rule gates the block,
    // never a second ad-hoc condition — so the anchor moves to the call rather than its arguments.
    expect(src).toContain('shouldShowDnsSetup(');
    expect(src).toContain('dnsSectionOpen)');
    // Exactly one gate: a second call would mean two places deciding the same thing.
    expect(src.split('shouldShowDnsSetup(').length - 1).toBe(2);   // the import/definition + the gate
  });

  it('🔒 the nameserver fields, Check & apply, and registrar picker are all INSIDE the gate', () => {
    // Anchor on the gate open-brace and confirm the setup controls appear after it before the closing
    // fragment — if any of these slipped OUTSIDE the gate they would keep showing exactly as before.
    const gateAt = src.indexOf('{shouldShowDnsSetup(');
    const closeAt = src.indexOf('HTTPS is issued automatically once the records resolve.');
    expect(gateAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(gateAt);
    for (const needle of ['Check & apply records', 'Where did you buy this domain?', "Set these two nameservers"]) {
      const at = src.indexOf(needle, gateAt);   // search FROM the gate — the phrase also appears in an earlier comment
      expect(at, needle).toBeGreaterThan(gateAt);
      expect(at, needle).toBeLessThan(closeAt);
    }
  });
});
