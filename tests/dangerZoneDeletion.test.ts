import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DangerZone, deletionOutcomeMessage } from '../src/components/settings/DangerZone';
import { isTypedConfirmValid, DELETE_CONFIRM_WORD } from '../src/lib/deleteConfirm';

// Google Play requires in-app account deletion for any app that lets people create an account, and
// the public /delete-account page only satisfies the URL half of that rule. These tests hold the two
// things that make the in-app half trustworthy: it cannot fire by accident, and it never reports a
// cleaner outcome than the server actually achieved.

describe('the delete cannot fire by accident', () => {
  it('requires the word to be typed exactly', () => {
    expect(isTypedConfirmValid(DELETE_CONFIRM_WORD)).toBe(true);
    expect(isTypedConfirmValid(' Delete ')).toBe(true); // trimmed + case-insensitive, still deliberate
    expect(isTypedConfirmValid('')).toBe(false);
    expect(isTypedConfirmValid('del')).toBe(false);
    expect(isTypedConfirmValid('delete account')).toBe(false);
    expect(isTypedConfirmValid('yes')).toBe(false);
  });

  it('reuses the shared confirm rule rather than a second copy of it', () => {
    // A duplicated rule is a rule that drifts; bulk file deletes already use this exact gate.
    expect(DELETE_CONFIRM_WORD).toBe('delete');
  });
});

describe('the outcome message never overstates what happened', () => {
  it('an account-removal acknowledgment never becomes proof that all data was erased', () => {
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: true });
    expect(msg).toMatch(/Your account has been deleted/i);
    expect(msg).toMatch(/Data removal is not fully confirmed/i);
    expect(msg).toMatch(/ownership.*review/i);
    expect(msg).not.toMatch(/all.*data.*deleted|data has been erased/i);
  });

  it('does not infer either data erasure or sign-in removal from an incomplete outcome', () => {
    // These genuinely differ: the Firestore wipe can succeed while the Auth SDK is unreachable. A
    // green tick there would leave someone believing they are gone when they can still sign in.
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: false });
    expect(msg).toMatch(/sign-in removal and data erasure are not fully confirmed/i);
    expect(msg).toMatch(/info@navbharatai\.com/);
    expect(msg).not.toMatch(/account and all of its data have been permanently deleted/i);
  });

  it('prefers the server\'s own wording when it sent one', () => {
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: true, message: 'Server said this.' });
    expect(msg).toBe('Server said this.');
  });

  it('a missing acknowledgment never claims that no changes occurred', () => {
    for (const bad of [null, {}, { ok: false }, { ok: false, accountDeleted: true }]) {
      const msg = deletionOutcomeMessage(bad as never);
      expect(msg).toMatch(/could not confirm the deletion outcome/i);
      expect(msg).toMatch(/Some changes may already have completed/i);
      expect(msg).not.toMatch(/nothing.*changed/i);
    }
  });

  it('discloses retained ownership-unverified data before the user can confirm account deletion', () => {
    const html = renderToStaticMarkup(createElement(DangerZone, { signedIn: true }));
    expect(html).toContain('Delete account');
    expect(html).toMatch(/Older records whose ownership cannot be verified are/);
    expect(html).toMatch(/retained for review, including workspaces, chat and voice conversations/);
    expect(html).not.toMatch(/permanently removes your profile, chats, projects/);
  });
});
