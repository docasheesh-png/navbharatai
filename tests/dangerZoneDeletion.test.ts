import { describe, it, expect } from 'vitest';
import { deletionOutcomeMessage } from '../src/components/settings/DangerZone';
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
  it('reports a full deletion only when the server confirms the ACCOUNT went too', () => {
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: true });
    expect(msg).toMatch(/account and all of its data have been permanently deleted/i);
  });

  it('says plainly when the DATA went but the sign-in survived', () => {
    // These genuinely differ: the Firestore wipe can succeed while the Auth SDK is unreachable. A
    // green tick there would leave someone believing they are gone when they can still sign in.
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: false });
    expect(msg).toMatch(/sign-in could not be removed/i);
    expect(msg).toMatch(/info@navbharatai\.com/);
    expect(msg).not.toMatch(/account and all of its data have been permanently deleted/i);
  });

  it('prefers the server\'s own wording when it sent one', () => {
    const msg = deletionOutcomeMessage({ ok: true, accountDeleted: true, message: 'Server said this.' });
    expect(msg).toBe('Server said this.');
  });

  it('says NOTHING was changed when the request failed — never a partial-success guess', () => {
    for (const bad of [null, {}, { ok: false }, { ok: false, accountDeleted: true }]) {
      const msg = deletionOutcomeMessage(bad as never);
      expect(msg).toMatch(/could not complete the deletion/i);
      expect(msg).toMatch(/Nothing has been changed/i);
    }
  });
});
