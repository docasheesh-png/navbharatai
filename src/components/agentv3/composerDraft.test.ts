import { describe, it, expect } from 'vitest';
import { saveDraft, loadDraft, COMPOSER_DRAFT_KEY, MAX_DRAFT_CHARS } from './composerDraft';

/** Minimal in-memory Storage-slice for deterministic tests (no jsdom dependency). */
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => { m.set(k, v); },
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    removeItem: (k: string) => { m.delete(k); },
    _map: m,
  };
}

describe('composerDraft — persist the composer draft across reloads (B7)', () => {
  it('saves a non-empty draft and loads it back', () => {
    const s = fakeStorage();
    saveDraft('build me a todo app', s);
    expect(s.getItem(COMPOSER_DRAFT_KEY)).toBe('build me a todo app');
    expect(loadDraft(s)).toBe('build me a todo app');
  });

  it('returns empty string when nothing is stored', () => {
    expect(loadDraft(fakeStorage())).toBe('');
  });

  it('clears the stored draft when the text becomes empty (i.e. after sending)', () => {
    const s = fakeStorage();
    saveDraft('half-typed message', s);
    saveDraft('', s); // send() sets prompt to '' → draft must be removed
    expect(s.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(loadDraft(s)).toBe('');
  });

  it('treats a whitespace-only draft as empty (does not persist blank noise)', () => {
    const s = fakeStorage();
    saveDraft('   \n  ', s);
    expect(s.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it('caps a huge paste at MAX_DRAFT_CHARS so it cannot blow the storage quota', () => {
    const s = fakeStorage();
    saveDraft('x'.repeat(MAX_DRAFT_CHARS + 5000), s);
    expect(s.getItem(COMPOSER_DRAFT_KEY)!.length).toBe(MAX_DRAFT_CHARS);
  });

  it('never throws when storage is unavailable (quota / privacy mode)', () => {
    const throwing = {
      setItem: () => { throw new Error('QuotaExceeded'); },
      getItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(() => saveDraft('anything', throwing)).not.toThrow();
    expect(loadDraft(throwing)).toBe(''); // read error → safe empty
  });
});
