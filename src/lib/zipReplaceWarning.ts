// Code Studio → "Upload ZIP" — the replace warning, in the user's own language (admin 2026-08-05:
// "warning user ki language me aye").
//
// This warning matters more than most copy in the app: saying yes DELETES the project currently in the
// workspace. A user who does not fully understand the sentence cannot give real consent, and an English
// -only warning in front of a Hindi-speaking user is consent theatre. So the words follow the language
// they are already typing in.
//
// It reuses `detectNoticeLang` rather than shipping a second detector. One language decision in the app
// means the update notice and this warning can never disagree about who the user is — and the day a
// fourth language is added, it appears in both. (That detector covers English, Hindi and Hinglish
// confidently and falls back to English for anything else; we do not ship a translation we cannot
// stand behind.)

import { detectNoticeLang, type NoticeLang } from './updateNoticeI18n';

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

const TEXT: Record<NoticeLang, ZipWarningText> = {
  en: {
    title: 'Replace this project?',
    body: 'Uploading a ZIP replaces everything currently in this workspace. The files you have now will be deleted and cannot be brought back. Your uploaded project takes their place.',
    confirm: 'Replace project',
    cancel: 'Cancel',
    working: 'Uploading your project…',
    failed: 'The project could not be uploaded',
    menuLabel: 'Upload ZIP',
  },
  hi: {
    title: 'क्या यह प्रोजेक्ट बदल दें?',
    body: 'ZIP अपलोड करने पर इस वर्कस्पेस की सभी मौजूदा फाइलें हट जाएँगी और वापस नहीं आएँगी। उनकी जगह आपका अपलोड किया हुआ प्रोजेक्ट आ जाएगा।',
    confirm: 'प्रोजेक्ट बदलें',
    cancel: 'रहने दें',
    working: 'आपका प्रोजेक्ट अपलोड हो रहा है…',
    failed: 'प्रोजेक्ट अपलोड नहीं हो सका',
    menuLabel: 'ZIP अपलोड करें',
  },
  hinglish: {
    title: 'Is project ko replace karein?',
    body: 'ZIP upload karne par is workspace ki saari maujuda files hat jaayengi aur wapas nahi aayengi. Unki jagah aapka upload kiya hua project aa jaayega.',
    confirm: 'Project replace karein',
    cancel: 'Rehne dein',
    working: 'Aapka project upload ho raha hai…',
    failed: 'Project upload nahi ho saka',
    menuLabel: 'ZIP upload karein',
  },
};

/** The warning text for an explicit language. */
export function zipReplaceWarning(lang: NoticeLang): ZipWarningText {
  return TEXT[lang] ?? TEXT.en;
}

/**
 * The warning text for whatever language the user is actually writing in.
 *
 * Pass the user's own most recent words (their last message, or what is in the composer). Empty or
 * unrecognised input falls back to English — never to a guess.
 */
export function zipReplaceWarningFor(userText: string | undefined | null): ZipWarningText {
  return zipReplaceWarning(detectNoticeLang(userText));
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
