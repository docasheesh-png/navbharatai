// "MADE WITH NAVBHARATAI DOUBLE AA RAHA HAI … CLOSE (X) KARNE KA BUTTON BHI NAHI" (admin 2026-11-26, a screenshot of a
// published app).
//
// Root cause: two modules each put a badge in the same bottom-right corner of a published app, at the same z-index —
// the build's own "made by NavBharatAI" signature inside the app's index.html (AgentV3/appSignature.ts), and the
// publish-time "Made with NavBharatAI" stamp (lib/madeWithBadge.ts) on top of it. The stamp had no ×, and it covered the
// signature's ×. Locked here: a published page carries ONE badge, it can be closed until the next refresh (no script
// needed), the guard respects a close, and the paid plan removes both.
import { afterEach, describe, expect, it } from 'vitest';
import { BADGE_CLOSE_LABEL, BADGE_HTML, BADGE_MARKER, injectBadge, injectBadgeIntoFiles } from '../src/server/lib/madeWithBadge';
import { APP_SIGNATURE_MARKER, appSignatureHtml, injectAppSignature } from '../src/server/AgentV3/appSignature';

const DOC = '<!doctype html><html><head><title>Neighborhood Veggies</title></head><body><div id="root"></div></body></html>';
const V1 = '<a href="https://navbharatai.com" target="_blank" rel="noopener noreferrer" data-nbai-signature="1" style="position:fixed;right:12px;bottom:12px"><span></span>made by NavBharatAI</a>';
const count = (s: string, needle: string) => s.split(needle).length - 1;

afterEach(() => { delete process.env.AGENTV3_MADE_WITH_BADGE; });

describe('a published page carries exactly one badge', () => {
  it('🔴 the app built with its own signature, then published: one badge, not two', () => {
    const built = injectAppSignature(DOC);
    expect(built).toContain(APP_SIGNATURE_MARKER);
    const published = injectBadge(built);
    expect(published).not.toContain(APP_SIGNATURE_MARKER);
    expect(count(published, 'id="nbai-badge"')).toBe(1);
    expect(published).not.toContain('made by NavBharatAI');
  });

  it('an older app carrying the version-1 signature is cleaned up the same way', () => {
    const published = injectBadge(DOC.replace('</body>', `${V1}</body>`));
    expect(published).not.toContain(APP_SIGNATURE_MARKER);
    expect(count(published, 'id="nbai-badge"')).toBe(1);
  });

  it('re-publishing an already stamped page that still carries a signature stays at one', () => {
    const once = injectBadge(DOC);
    const again = injectBadge(once.replace('<div id="root"></div>', `<div id="root"></div>${appSignatureHtml()}`));
    expect(again).not.toContain(APP_SIGNATURE_MARKER);
    expect(count(again, 'id="nbai-badge"')).toBe(1);
  });

  it('the paid plan removes BOTH — the stamp is not added and the signature is taken off the page', () => {
    const out = injectBadge(injectAppSignature(DOC), { paidRemoval: true });
    expect(out).not.toContain(APP_SIGNATURE_MARKER);
    expect(out).not.toContain(BADGE_MARKER);
    const files = new Map([['index.html', Buffer.from(injectAppSignature(DOC))], ['app.js', Buffer.from('x')]]);
    expect(injectBadgeIntoFiles(files, { paidRemoval: true })).toBe(1);
    expect(files.get('index.html')!.toString()).not.toContain(APP_SIGNATURE_MARKER);
    expect(files.get('app.js')!.toString()).toBe('x');
  });

  it('with the stamp switched off by the admin, the page is left exactly as built', () => {
    process.env.AGENTV3_MADE_WITH_BADGE = 'off';
    const built = injectAppSignature(DOC);
    expect(injectBadge(built)).toBe(built);
  });
});

describe('the badge can be closed — until the next refresh', () => {
  it('🔴 has a × that works with no script: a checkbox that hides itself and the pill', () => {
    expect(BADGE_HTML).toContain(`<input type="checkbox" autocomplete="off" aria-label="${BADGE_CLOSE_LABEL}"`);
    expect(BADGE_HTML).toContain('#nbai-badge > input:checked, #nbai-badge > input:checked ~ a { display: none !important; }');
    expect(BADGE_HTML).toContain('content: "\\00d7"');
    // The checkbox comes first (CSS hides only what follows it); `order` draws it to the right of the pill.
    expect(BADGE_HTML.indexOf('<input type="checkbox"')).toBeLessThan(BADGE_HTML.indexOf('<a href="https://navbharatai.com'));
  });

  it('nothing is stored, and the browser is told not to restore the ticked state — a refresh brings it back', () => {
    expect(BADGE_HTML).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(BADGE_HTML).toContain('autocomplete="off"');
  });

  it('🔒 the guard respects a close, and still shows a pill hidden any other way', () => {
    expect(BADGE_HTML).toContain("if (link && !(box && box.checked) && !shown(link))");
  });

  it('the pill can shrink on a narrow phone instead of running off the screen', () => {
    expect(BADGE_HTML).toContain('max-width: calc(100vw - 28px)');
    expect(BADGE_HTML).toContain('text-overflow: ellipsis');
  });
});
