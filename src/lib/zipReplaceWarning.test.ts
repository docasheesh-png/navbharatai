import { describe, it, expect } from 'vitest';
import { zipReplaceWarning, looksLikeZip } from './zipReplaceWarning';

/**
 * The ZIP-replace warning is the sentence a user's consent rests on: saying yes DELETES the project
 * currently in the workspace. These lock what makes it real consent — that it states the
 * CONSEQUENCE, that the confirm button names the action, and that it is in English.
 *
 * 🔴 The Hindi and Hinglish variants were REMOVED on 2026-09-14 (admin: "ui me professional language
 * (english only) honi chahiye … south india wale kaise padhenge isko??"). Devanagari is not a
 * national script, so "the user's language" was really one region's language.
 */
describe('zipReplaceWarning', () => {
  it('states the CONSEQUENCE, not just "are you sure?"', () => {
    // "Are you sure?" is not informed consent. The body must say the current files go away.
    expect(zipReplaceWarning().body).toMatch(/delet|replac/i);
  });

  it('the confirm button names the ACTION, never a bare OK', () => {
    // A destructive button labelled "OK" is how people delete things they meant to keep.
    const t = zipReplaceWarning();
    expect(t.confirm.toLowerCase()).not.toBe('ok');
    expect(t.confirm.length).toBeGreaterThan(2);
    expect(t.cancel).toBeTruthy();
    expect(t.confirm).not.toBe(t.cancel);
  });

  it('ships a complete set — no half-filled dialog', () => {
    for (const [k, v] of Object.entries(zipReplaceWarning())) {
      expect(`${k}=${v}`.length, k).toBeGreaterThan(`${k}=`.length);
    }
  });

  it('🔒 carries no Devanagari — the rule this dialog broke', () => {
    expect(JSON.stringify(zipReplaceWarning())).not.toMatch(/[\u0900-\u097F]/);
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
