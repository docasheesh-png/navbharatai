// 🔴 ENGLISH ONLY (admin 2026-09-14): "ui me professional language (english only) honi chahiye …
// south india wale kaise padhenge isko??" A Tamil, Telugu, Kannada or Malayalam speaker cannot read
// Devanagari, so a Hindi-only string is not "the user's language" — it is one region's language shown
// to a national audience. English is the script every user of this app shares. See CLAUDE.md's
// language standard, and tests/uiLanguageEnglishOnly.test.ts, which now fails CI on any new one.
//
// This SUPERSEDES the 2026-07-20 instruction "language wahi ho jo user likh raha ho", which produced
// the Hindi and Hinglish variants that used to live here, along with a whole language DETECTOR built
// to choose between them. The detector is gone too, not just its output: a chooser with one choice is
// dead machinery that invites the second choice to be added back.
//
// App-update chat notice. PURE.

export interface NoticeText {
  /** The assistant-bubble body shown to the user. */
  body: string;
  /** The label on the store button. */
  button: string;
}

const NOTICE: NoticeText = {
  body: 'A new version of NavBharatAI is available. Update now for the best experience.',
  button: 'Update',
};

/** The update notice text. Pure. */
export function updateNoticeText(): NoticeText {
  return NOTICE;
}
