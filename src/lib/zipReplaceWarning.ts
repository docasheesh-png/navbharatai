// Code Studio -> "Upload ZIP" — the replace warning.
//
// This warning matters more than most copy in the app: saying yes DELETES the project currently in
// the workspace, and it cannot be undone. So the sentence must be plain and it must be readable by
// every user.
//
// 🔴 ENGLISH ONLY (admin 2026-09-14): "ui me professional language (english only) honi chahiye …
// south india wale kaise padhenge isko??" A Tamil, Telugu, Kannada or Malayalam speaker cannot read
// Devanagari, so a Hindi-only string is not "the user's language" — it is one region's language shown
// to a national audience. English is the script every user of this app shares. See CLAUDE.md's
// language standard, and tests/uiLanguageEnglishOnly.test.ts, which now fails CI on any new one.
//
// It SUPERSEDES the 2026-08-05 instruction "warning user ki language me aye", which had this module
// pick between English, Hindi and Hinglish from the words the user was typing.

export interface ZipWarningText {
  /** Dialog heading. */
  title: string;
  /** The consequence, stated plainly — this is the sentence consent rests on. */
  body: string;
  /** Confirm button. Deliberately names the ACTION, never a bare "OK". */
  confirm: string;
  /** Cancel button. */
  cancel: string;
  /** Shown while the archive is transferring. */
  working: string;
  /** Prefix for a failure message. */
  failed: string;
  /** The menu entry itself. */
  menuLabel: string;
}

const TEXT: ZipWarningText = {
  title: 'Replace this project?',
  body: 'Uploading a ZIP replaces everything currently in this workspace. The files you have now will be deleted and cannot be brought back. Your uploaded project takes their place.',
  confirm: 'Replace project',
  cancel: 'Cancel',
  working: 'Uploading your project…',
  failed: 'The project could not be uploaded',
  menuLabel: 'Upload ZIP',
};

/** The warning text. Pure. */
export function zipReplaceWarning(): ZipWarningText {
  return TEXT;
}

/**
 * Is this file plausibly a ZIP archive, judged before a single byte is uploaded?
 *
 * Checked by EXTENSION and not by MIME type: browsers disagree wildly about zip MIME
 * (`application/zip`, `application/x-zip-compressed`, `multipart/x-zip`, and on some Android pickers
 * an empty string), so trusting `file.type` rejects genuine archives on real devices. The server
 * validates the actual archive structure on commit — this check exists purely to fail fast and
 * politely, before someone spends minutes uploading a file that was never going to work.
 */
export function looksLikeZip(file: { name?: string } | null | undefined): boolean {
  return /\.zip$/i.test(file?.name ?? '');
}
