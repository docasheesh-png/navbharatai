/**
 * OPENING A .ZIP ON A PHONE — one accept string, one check, everywhere.
 *
 * ADMIN REPORT 2026-08-13: "Import project (.zip) me button to hai, par click karte hai to device ki
 * zip show hi nahi karti." On Android the file picker opened and the user's archives were simply not
 * there — so a user arriving with an existing project could not get in at all.
 *
 * THE ROOT CAUSE. Two of the three entry points declared:
 *
 *   accept=".zip,application/zip,application/x-zip-compressed"
 *
 * On desktop that is correct. **Android's picker largely ignores the file EXTENSION and filters by
 * MIME type**, and most Android file providers report a .zip as `application/octet-stream` — not
 * `application/zip`. The archives are therefore greyed out or hidden entirely. It is worse in the
 * Capacitor app, where every file choice goes through that same Android picker.
 *
 * 🔑 THE TELL THAT PROVES IT: the ONE entry point that works on Android — the Files panel — is the one
 * with **no `accept` at all**. The filter is the bug, not the platform.
 *
 * THE RULE THIS ENCODES: **ask broadly, verify strictly.** A picker filter is a convenience that some
 * platforms honour and some ignore, so it can never be the thing that decides what is a valid file.
 * The real check happens after the pick — and it reads the file's MAGIC BYTES, not its name, so a
 * renamed `.zip` that is really something else is caught rather than fed to the importer.
 */

import { isZipFile } from './uploadClassify';

/** Every zip MIME a browser or OS has been seen to report, including the Android catch-all. */
const ZIP_MIME = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'multipart/x-zip',
];

/**
 * Android-ish platforms, where a MIME filter hides the user's own files.
 *
 * Deliberately a broad, forgiving test: guessing "Android" wrongly on a desktop costs a slightly
 * busier file dialog, while missing a real Android costs the user the entire feature. The asymmetry
 * decides the design.
 */
export function pickerIgnoresExtensions(userAgent: string | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /android/i.test(String(userAgent ?? ''));
}

/**
 * The `accept` to put on a zip file input.
 *
 * On Android: everything, because any filter there hides the archives we are asking for. Elsewhere:
 * the real list, so the dialog stays tidy. Either way the pick is verified afterwards.
 */
export function zipAccept(userAgent?: string): string {
  if (pickerIgnoresExtensions(userAgent)) return '*/*';
  return ['.zip', ...ZIP_MIME].join(',');
}

/** The first four bytes of every zip: "PK\x03\x04". Empty archives use PK\x05\x06, spanned PK\x07\x08. */
const ZIP_MAGIC: number[][] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/** Does this header start with a zip signature? Pure, so it is testable without a File. */
export function hasZipMagic(head: Uint8Array | null | undefined): boolean {
  if (!head || head.length < 4) return false;
  return ZIP_MAGIC.some((sig) => sig.every((b, i) => head[i] === b));
}

/**
 * The cheap check: does this LOOK like a zip by name or reported type?
 *
 * Reuses the canonical `isZipFile` rather than adding another opinion — there were already two
 * detectors in this codebase (`isZipFile` here, `looksLikeZip` in zipReplaceWarning.ts, which only
 * ever checked the name), and a third would be how they drift again.
 */
export function looksLikeZipPick(file: { name?: string; type?: string } | null | undefined): boolean {
  if (!file) return false;
  return isZipFile(String(file.name ?? ''), String(file.type ?? ''));
}

export type ZipPickVerdict = 'zip' | 'not-zip' | 'unreadable';

/**
 * The real check, after the user has chosen: read the first bytes and look for the signature.
 *
 * ⚠️ `unreadable` is a THIRD answer on purpose, and callers must not treat it as `not-zip`. A browser
 * that refuses to read a slice (a permissions quirk, a file on a disconnected provider) tells us
 * nothing about the file — rejecting the user's genuine archive because we could not read four bytes
 * would be a worse failure than the one this module exists to fix. Callers fall back to the name.
 */
export async function verifyZipPick(file: Blob | null | undefined): Promise<ZipPickVerdict> {
  if (!file) return 'unreadable';
  try {
    const slice = file.slice(0, 4);
    const buf = await slice.arrayBuffer();
    return hasZipMagic(new Uint8Array(buf)) ? 'zip' : 'not-zip';
  } catch {
    return 'unreadable';
  }
}

/**
 * The one decision every caller wants: may we import this pick?
 *
 * Accepts when the bytes say zip. Accepts when the bytes could not be read BUT the name says .zip —
 * the honest fallback described above. Refuses only when we genuinely read the file and it was not an
 * archive, which is the case worth stopping (a user who picked a photo by mistake).
 */
export async function acceptZipPick(
  file: (Blob & { name?: string; type?: string }) | null | undefined,
): Promise<{ ok: boolean; reason: ZipPickVerdict }> {
  if (!file) return { ok: false, reason: 'unreadable' };
  const verdict = await verifyZipPick(file);
  if (verdict === 'zip') return { ok: true, reason: verdict };
  if (verdict === 'unreadable') return { ok: looksLikeZipPick(file), reason: verdict };
  return { ok: false, reason: verdict };
}

/** What to tell a user who picked something that is definitely not an archive. */
export function notZipMessage(fileName?: string): string {
  const named = fileName ? `"${fileName}"` : 'That file';
  return `${named} is not a .zip archive. Pick the zipped project folder — on a phone your archives are usually under Downloads or Files.`;
}
