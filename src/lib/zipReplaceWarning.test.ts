import { describe, it, expect } from 'vitest';
import { zipReplaceWarning, zipReplaceWarningFor, looksLikeZip } from './zipReplaceWarning';

/**
 * The ZIP-replace warning is the sentence a user's consent rests on: saying yes DELETES the project
 * currently in the workspace. An English-only warning in front of a Hindi-speaking user is consent
 * theatre, so these lock the language behaviour rather than the exact wording.
 */
describe('zipReplaceWarning', () => {
  it('speaks the language the user is writing in', () => {
    expect(zipReplaceWarningFor('zip upload karna hai').title).toBe(zipReplaceWarning('hinglish').title);
    expect(zipReplaceWarningFor('क्या यह हो सकता है').title).toBe(zipReplaceWarning('hi').title);
    expect(zipReplaceWarningFor('can you replace this project').title).toBe(zipReplaceWarning('en').title);
  });

  it('falls back to English rather than guessing', () => {
    // No text, or a script we do not ship a translation for — we never invent one.
    expect(zipReplaceWarningFor('').title).toBe(zipReplaceWarning('en').title);
    expect(zipReplaceWarningFor(null).title).toBe(zipReplaceWarning('en').title);
    expect(zipReplaceWarningFor(undefined).title).toBe(zipReplaceWarning('en').title);
  });

  it('every language states the CONSEQUENCE, not just "are you sure?"', () => {
    // "Are you sure?" is not informed consent. Each body must say the current files go away.
    expect(zipReplaceWarning('en').body).toMatch(/delet|replac/i);
    expect(zipReplaceWarning('hi').body).toMatch(/हट जाएँगी|वापस नहीं/);
    expect(zipReplaceWarning('hinglish').body).toMatch(/hat jaayengi|wapas nahi/i);
  });

  it('the confirm button names the ACTION, never a bare OK', () => {
    // A destructive button labelled "OK" is how people delete things they meant to keep.
    for (const lang of ['en', 'hi', 'hinglish'] as const) {
      const t = zipReplaceWarning(lang);
      expect(t.confirm.toLowerCase()).not.toBe('ok');
      expect(t.confirm.length).toBeGreaterThan(2);
      expect(t.cancel).toBeTruthy();
      expect(t.confirm).not.toBe(t.cancel);
    }
  });

  it('every language ships a complete set — no half-translated dialog', () => {
    for (const lang of ['en', 'hi', 'hinglish'] as const) {
      const t = zipReplaceWarning(lang);
      for (const [k, v] of Object.entries(t)) {
        expect(`${lang}.${k}=${v}`.length).toBeGreaterThan(`${lang}.${k}=`.length);
      }
    }
  });
});

describe('looksLikeZip', () => {
  it('accepts a .zip by EXTENSION, case-insensitively', () => {
    expect(looksLikeZip({ name: 'project.zip' })).toBe(true);
    expect(looksLikeZip({ name: 'My Project.ZIP' })).toBe(true);
    expect(looksLikeZip({ name: 'a.b.c.zip' })).toBe(true);
  });

  it('rejects everything else, and never throws on a missing name', () => {
    expect(looksLikeZip({ name: 'photo.png' })).toBe(false);
    expect(looksLikeZip({ name: 'zipfile' })).toBe(false);
    expect(looksLikeZip({})).toBe(false);
    expect(looksLikeZip(null)).toBe(false);
  });

  // WHY extension and not MIME: browsers disagree wildly about zip MIME types — application/zip,
  // application/x-zip-compressed, and on some Android pickers an empty string. Trusting file.type
  // rejects genuine archives on real phones, which is the opposite of what this guard is for.
  it('does not depend on a MIME type at all', () => {
    expect(looksLikeZip({ name: 'app.zip', type: '' } as { name: string })).toBe(true);
  });
});
