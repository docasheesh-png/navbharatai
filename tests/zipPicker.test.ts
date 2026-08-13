/**
 * A user with an existing project must be able to get in — from a phone.
 *
 * ADMIN REPORT 2026-08-13: on Android, "Import project (.zip)" opened the picker and the user's own
 * archives were not listed. The cause was the accept filter, not the platform — proven by the one
 * entry point that worked, which is the one with no filter at all.
 *
 * So these tests hold two opposite things true at once: the picker must ask BROADLY enough that
 * Android still shows the file, and the code must verify STRICTLY enough that a photo picked by
 * mistake never reaches the importer.
 */

import { describe, it, expect } from 'vitest';
import {
  zipAccept,
  pickerIgnoresExtensions,
  hasZipMagic,
  looksLikeZipPick,
  verifyZipPick,
  acceptZipPick,
  notZipMessage,
} from '../src/lib/zipPicker';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

/** A Blob that reports a name, like a real File. `type` comes from the constructor — it is a
 *  getter-only property on Blob, so it cannot be assigned afterwards. */
const fileOf = (bytes: number[], name = 'project.zip', type = '') =>
  Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name }) as Blob & { name: string; type: string };

const ZIP_BYTES = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];

describe('🔒 the accept filter — the actual reported bug', () => {
  it('asks for EVERYTHING on Android, where any filter hides the user’s archives', () => {
    expect(zipAccept(ANDROID)).toBe('*/*');
  });

  it('🔒 never emits the filter that caused the report', () => {
    // `.zip,application/zip,application/x-zip-compressed` is correct on desktop and hides every
    // archive on Android, because Android filters by MIME and reports .zip as octet-stream.
    expect(zipAccept(ANDROID)).not.toContain('application/x-zip-compressed');
    expect(zipAccept(ANDROID)).not.toContain('.zip');
  });

  it('keeps the dialog tidy where extensions ARE honoured', () => {
    const desktop = zipAccept(DESKTOP);
    expect(desktop).toContain('.zip');
    expect(desktop).toContain('application/zip');
    expect(desktop).not.toBe('*/*');
  });

  it('treats iPhone as a normal picker — iOS honours extensions', () => {
    expect(zipAccept(IPHONE)).not.toBe('*/*');
  });

  it('detects Android case-insensitively, and is safe with no user agent', () => {
    expect(pickerIgnoresExtensions('... ANDROID ...')).toBe(true);
    expect(pickerIgnoresExtensions(DESKTOP)).toBe(false);
    expect(pickerIgnoresExtensions('')).toBe(false);
    expect(pickerIgnoresExtensions(undefined)).toBe(false);
  });
});

describe('magic bytes — the strict half', () => {
  it('recognises a normal archive', () => {
    expect(hasZipMagic(new Uint8Array(ZIP_BYTES))).toBe(true);
  });

  it('recognises an EMPTY and a spanned archive too', () => {
    // A zip with no entries starts PK\x05\x06; rejecting it would refuse a legitimate (if useless) file
    // with a confusing "not a zip" message.
    expect(hasZipMagic(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(hasZipMagic(new Uint8Array([0x50, 0x4b, 0x07, 0x08]))).toBe(true);
  });

  it('rejects other formats and junk', () => {
    expect(hasZipMagic(new Uint8Array(PNG_BYTES))).toBe(false);
    expect(hasZipMagic(new Uint8Array([0x50, 0x4b]))).toBe(false);   // too short
    expect(hasZipMagic(new Uint8Array([]))).toBe(false);
    expect(hasZipMagic(null)).toBe(false);
    expect(hasZipMagic(undefined)).toBe(false);
  });
});

describe('looksLikeZipPick — the cheap name/type check', () => {
  it('accepts by extension or by reported type', () => {
    expect(looksLikeZipPick({ name: 'app.zip' })).toBe(true);
    expect(looksLikeZipPick({ name: 'APP.ZIP' })).toBe(true);
    expect(looksLikeZipPick({ name: 'blob', type: 'application/zip' })).toBe(true);
  });

  it('rejects everything else, and survives junk', () => {
    expect(looksLikeZipPick({ name: 'photo.png' })).toBe(false);
    expect(looksLikeZipPick(null)).toBe(false);
    expect(looksLikeZipPick(undefined)).toBe(false);
    expect(looksLikeZipPick({})).toBe(false);
  });
});

describe('verifyZipPick', () => {
  it('says zip for real archive bytes, whatever the name', async () => {
    // The Android fix means the picker now offers everything, so the BYTES have to carry the decision.
    expect(await verifyZipPick(fileOf(ZIP_BYTES, 'noextension'))).toBe('zip');
  });

  it('says not-zip for a photo even when it is NAMED .zip', async () => {
    expect(await verifyZipPick(fileOf(PNG_BYTES, 'sneaky.zip'))).toBe('not-zip');
  });

  it('🔒 an unreadable file is its own answer, never "not-zip"', async () => {
    const broken = { slice: () => ({ arrayBuffer: async () => { throw new Error('gone'); } }) } as never;
    expect(await verifyZipPick(broken)).toBe('unreadable');
    expect(await verifyZipPick(null)).toBe('unreadable');
  });
});

describe('🔒 acceptZipPick — what actually gates the import', () => {
  it('accepts a real archive', async () => {
    expect(await acceptZipPick(fileOf(ZIP_BYTES))).toEqual({ ok: true, reason: 'zip' });
  });

  it('🔒 refuses a photo the user picked by mistake — the cost of opening the filter', async () => {
    const res = await acceptZipPick(fileOf(PNG_BYTES, 'holiday.png'));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-zip');
  });

  it('🔒 falls back to the NAME when the bytes cannot be read', async () => {
    // Refusing a user's genuine archive because four bytes would not read is worse than the bug this
    // module exists to fix.
    const unreadable = Object.assign(
      { slice: () => ({ arrayBuffer: async () => { throw new Error('nope'); } }) },
      { name: 'project.zip', type: '' },
    ) as never;
    expect(await acceptZipPick(unreadable)).toEqual({ ok: true, reason: 'unreadable' });
  });

  it('an unreadable file with a non-zip name is refused', async () => {
    const unreadable = Object.assign(
      { slice: () => ({ arrayBuffer: async () => { throw new Error('nope'); } }) },
      { name: 'photo.png', type: '' },
    ) as never;
    expect(await acceptZipPick(unreadable)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('nothing picked is refused, not crashed', async () => {
    expect((await acceptZipPick(null)).ok).toBe(false);
    expect((await acceptZipPick(undefined)).ok).toBe(false);
  });
});

describe('the message a rejected user reads', () => {
  it('names the file and says where archives live on a phone', () => {
    const m = notZipMessage('holiday.png');
    expect(m).toContain('holiday.png');
    expect(m).toContain('Downloads');
  });

  it('works without a filename', () => {
    expect(notZipMessage()).toContain('not a .zip');
  });
});
