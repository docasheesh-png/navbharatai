import { describe, it, expect } from 'vitest';
import { requiresTypedConfirm, isTypedConfirmValid, canProceedWithDelete, DELETE_CONFIRM_WORD } from './deleteConfirm';

describe('deleteConfirm — type-"delete"-to-confirm guard for destructive deletes', () => {
  it('the confirm word is exactly "delete"', () => {
    expect(DELETE_CONFIRM_WORD).toBe('delete');
  });

  describe('requiresTypedConfirm — only a BULK delete (2+) needs typing', () => {
    it('a single file is one-click (no typing required)', () => {
      expect(requiresTypedConfirm(1)).toBe(false);
    });
    it('two or more files require the typed guard', () => {
      expect(requiresTypedConfirm(2)).toBe(true);
      expect(requiresTypedConfirm(26)).toBe(true);
    });
    it('non-positive / invalid counts never open the typed guard', () => {
      expect(requiresTypedConfirm(0)).toBe(false);
      expect(requiresTypedConfirm(-3)).toBe(false);
      expect(requiresTypedConfirm(NaN)).toBe(false);
    });
  });

  describe('isTypedConfirmValid — must equal "delete" (case-insensitive, trimmed)', () => {
    it('accepts "delete" with surrounding whitespace / any case', () => {
      expect(isTypedConfirmValid('delete')).toBe(true);
      expect(isTypedConfirmValid('  DELETE  ')).toBe(true);
      expect(isTypedConfirmValid('Delete')).toBe(true);
    });
    it('rejects anything that is not the word', () => {
      for (const bad of ['', 'del', 'delet', 'delete ok', 'yes', 'remove', 'd', 'deletee']) {
        expect(isTypedConfirmValid(bad), bad).toBe(false);
      }
      expect(isTypedConfirmValid(undefined as unknown as string)).toBe(false); // defensive at runtime
    });
  });

  describe('canProceedWithDelete — the single gate the UI checks', () => {
    it('a single-file delete may always proceed (its own buttons are the guard)', () => {
      expect(canProceedWithDelete(1, '')).toBe(true);
      expect(canProceedWithDelete(1, 'anything')).toBe(true);
    });
    it('a bulk delete is BLOCKED until the user typed "delete" exactly', () => {
      expect(canProceedWithDelete(5, '')).toBe(false);       // nothing typed → data is safe
      expect(canProceedWithDelete(5, 'del')).toBe(false);    // partial → still safe
      expect(canProceedWithDelete(5, 'delete')).toBe(true);  // armed → may proceed
      expect(canProceedWithDelete(26, '  Delete ')).toBe(true);
    });
  });
});
