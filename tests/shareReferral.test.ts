import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shareReferral, canOpenShareSheet, isUserDismissal } from '../src/lib/shareReferral';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/**
 * Source with comments stripped. A negative assertion ("this amount is not hardcoded") is otherwise
 * defeated by the comment that EXPLAINS why it is not hardcoded — which quotes the admin's own
 * "₹1,500". Deleting the explanation to satisfy a matcher would be the wrong repair.
 */
const readCode = (p: string) => read(p)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*(\/\/|\s\*).*$/gm, '');
const MSG = 'Build your own app with NavBharatAI. Use my code NB4K7P … https://navbharatai.com';

/**
 * ADMIN 2026-09-17: *"aur niche ek button ho, share — jis par click karte hi navbharatai ka link aur
 * code use jahan share karna chahe kar de, fb/whatsapp/insta chahe jahan!"*
 *
 * Almost the whole referral system already existed — the code minting, the copy button, the ₹1,500
 * cap, the apply-a-friend's-code flow. What did NOT exist was a share ACTION: the panel had a
 * `Share2` icon next to a paragraph, and `navigator.share` appeared exactly once in the entire repo,
 * in the image generator. The code could be copied and never shared.
 */
describe('canOpenShareSheet — never offer a button that cannot work', () => {
  it('yes when the device has a usable share sheet', () => {
    expect(canOpenShareSheet({ share: async () => {} }, { text: MSG })).toBe(true);
  });

  it('no when there is no share at all — most desktop browsers', () => {
    expect(canOpenShareSheet({}, { text: MSG })).toBe(false);
    expect(canOpenShareSheet(null, { text: MSG })).toBe(false);
  });

  it('honours canShare — "share exists" is not "share works for THIS payload"', () => {
    // A browser can expose `share` and still refuse a given payload. Treating the first as the
    // second is how a button becomes a silent no-op.
    expect(canOpenShareSheet({ share: async () => {}, canShare: () => false }, { text: MSG })).toBe(false);
    expect(canOpenShareSheet({ share: async () => {}, canShare: () => true }, { text: MSG })).toBe(true);
  });

  it('a canShare that THROWS is treated as "cannot", not as a crash', () => {
    expect(canOpenShareSheet({ share: async () => {}, canShare: () => { throw new Error('x'); } }, { text: MSG })).toBe(false);
  });
});

describe('isUserDismissal — closing the sheet is a decision, not an error', () => {
  it('AbortError and NotAllowedError are dismissals', () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const notAllowed = Object.assign(new Error('gesture'), { name: 'NotAllowedError' });
    expect(isUserDismissal(abort)).toBe(true);
    expect(isUserDismissal(notAllowed)).toBe(true);
  });

  it('a real failure is NOT a dismissal', () => {
    expect(isUserDismissal(new Error('network'))).toBe(false);
    expect(isUserDismissal(null)).toBe(false);
  });
});

describe('shareReferral — what actually happened, so the caller can say something true', () => {
  it('opens the share sheet with the message', async () => {
    const share = vi.fn(async () => {});
    expect(await shareReferral(MSG, undefined, { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: MSG });
  });

  it('🔴 a user who backs out sees NO error — the easiest thing to get wrong here', async () => {
    // navigator.share REJECTS when the user cancels. A naive catch reports "sharing failed" to
    // somebody who simply changed their mind.
    const share = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    const writeText = vi.fn(async () => {});
    expect(await shareReferral(MSG, undefined, { share, clipboard: { writeText } })).toBe('dismissed');
    // …and it must NOT quietly copy instead, which would claim an action the user declined.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('no share sheet ⇒ copies, so the button is never dead', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareReferral(MSG, undefined, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(MSG);
  });

  it('a GENUINE share failure still leaves the user something usable', async () => {
    const share = vi.fn(async () => { throw new Error('transport died'); });
    const writeText = vi.fn(async () => {});
    expect(await shareReferral(MSG, undefined, { share, clipboard: { writeText } })).toBe('copied');
  });

  it('nothing works ⇒ says so honestly rather than pretending', async () => {
    expect(await shareReferral(MSG, undefined, {})).toBe('failed');
    expect(await shareReferral('', undefined, { share: async () => {} })).toBe('failed');
  });

  it('a url is passed only when given — the message already ends with the link', async () => {
    const share = vi.fn(async () => {});
    await shareReferral(MSG, 'https://navbharatai.com', { share });
    expect(share).toHaveBeenCalledWith({ text: MSG, url: 'https://navbharatai.com' });
  });
});

describe('the wiring — a share button the user can actually reach', () => {
  const profile = read('src/components/profile/ProfilePage.tsx');
  const panel = read('src/components/panels/ReferralPanel.tsx');

  it('the PROFILE card has a real Share button, which is where the admin asked for it', () => {
    expect(profile).toContain('shareReferral(');
    expect(profile).toMatch(/<Share2[^>]*\/>\s*Share/);
  });

  it('the profile headline leads with what the user EARNS, and never hardcodes the amount', () => {
    // Read from the server's own cap, so retuning REFERRER_LIFETIME_CAP_TOKENS cannot leave a stale
    // number promising money on this screen.
    const code = readCode('src/components/profile/ProfilePage.tsx');
    expect(code).toContain('Refer &amp; earn tokens worth ₹{referral.capRupees}');
    expect(code).not.toContain('worth ₹1500');
    expect(code).not.toContain('worth ₹1,500');
  });

  it('BOTH surfaces use the SAME helper, so they can never behave differently', () => {
    for (const src of [profile, panel]) expect(src).toContain("from '../../lib/shareReferral'");
  });

  it('the old decorative icon-on-a-paragraph is gone from the panel', () => {
    expect(panel).not.toContain('<Share2 className="mr-1 inline h-3.5 w-3.5" />');
  });
});
