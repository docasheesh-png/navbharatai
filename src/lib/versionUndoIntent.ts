// PRO CHAT → VERSION UNDO PICKER (admin 2026-10-26).
//
// When a user in NavBharatAI Pro says undo / reverse / pehle wala / wapas, Pro must open an in-chat
// version picker (the same restore points as Time Machine / History) — never auto-restore, and never
// send them to Other → Versioning.
//
// PURE. Client and tests share one detector. Phrases cover English + Hindi/Hinglish (Latin and
// Devanagari) because that is what Pro users type; a message that is clearly "go back" in those
// forms returns true even when wording varies.

/**
 * Signals that the user wants to go BACK to an earlier saved version of the app.
 * Broad on purpose (intent, not one phrase). Kept as shapes + stems so "undo kar do", "undo please",
 * "pehle wale pe le jao" still match.
 */
const UNDO_SIGNAL_RE =
  /\b(?:undo|revert|rollback|roll[\s-]?back|restore)\b/i;

const UNDO_HINGLISH_RE =
  /\b(?:undo|revert|restore|rollback)\s*(?:kar(?:o|na|do|dena|dijiye|dijie)?|kr(?:o|do)?)\b|\b(?:wapas|wapis|waapas)\s*(?:la(?:o|do|dena|ao)|kar(?:o|do)|le\s*ja(?:o|ao)|ja(?:o|ao)|kar\s*do)\b|\b(?:pehle|pehli|pichh?e|pichhla|purana|purani|puraana)\s+(?:wala|wali|wale|version|build|jaisa|jaise|wapas|wapis)\b|\b(?:pehle|purana)\s+jaisa\b|\b(?:ulti|ultee)\s*(?:ho\s*)?gayi\b|\b(?:galat|galti|kharab|bigad)\s*(?:ho\s*)?gay(?:a|i|e)?\b|\bapp\s+(?:kharab|bigad)/i;

/** Devanagari: वापस / पहले जैसा / पुराना / पूर्ववत / उल्टा / गलती */
const UNDO_DEVANAGARI_RE =
  /वापस|पहले\s*जैसा|पुरान[ाीे]|पूर्ववत|पूर्व\s*अवस्था|उल[्ट]+[ााे]|गलती\s*हो\s*गई|खराब\s*हो\s*गया|बिगड़/;

const GO_BACK_RE =
  /\b(?:go\s*back|went\s*wrong|broke\s+my\s+app|broke\s+the\s+app|this\s+is\s+worse|get\s+it\s+back|bring\s+it\s+back|change\s+it\s+back|take\s+it\s+back|previous\s+version|earlier\s+version|old\s+version|last\s+version|last\s+build)\b/i;

/**
 * NOT a version-undo request — building an undo feature, asking where the Versioning tool is,
 * GreenGuard's "keep my changes", or a surgical "put this colour back" that Diff handles.
 */
const NOT_VERSION_UNDO_RE =
  /\b(?:build|create|make|add|banao|bana\s*do)\b.{0,40}\bundo\b|\bundo\b.{0,40}\b(?:button|feature|function|control|history\s*api)\b|\b(?:how\s+do\s+i|kaise|where\s+is|kahaan|kahan)\b.{0,60}\b(?:versioning|time\s*machine)\b|\bheader\b.{0,40}\b(?:color|colour|rang)\b|\b(?:color|colour|rang)\b.{0,40}\bwapas\b/i;

/** GreenGuard escape hatch — restore the rolled-back attempt, not a Time Machine version. */
const KEEP_ATTEMPT_RE =
  /\bkeep\s+my\s+changes?\b|\brestore\s+my\s+changes\b|\bmere\s+changes\s+(?:rakho|wapas)\b/i;

/**
 * Did the user ask Pro to undo / go back / restore an earlier app version?
 *
 * Returns true → Pro shows the in-chat version picker (selection required; nothing restores yet).
 * Returns false → normal Pro chat / build path.
 *
 * PURE.
 */
export function wantsVersionUndo(prompt: string | null | undefined): boolean {
  const raw = String(prompt ?? '').trim();
  if (!raw) return false;
  if (KEEP_ATTEMPT_RE.test(raw)) return false;
  const p = raw.replace(/\s+/g, ' ');
  if (NOT_VERSION_UNDO_RE.test(p)) return false;
  if (UNDO_SIGNAL_RE.test(p)) return true;
  if (UNDO_HINGLISH_RE.test(p)) return true;
  if (UNDO_DEVANAGARI_RE.test(p)) return true;
  if (GO_BACK_RE.test(p)) return true;
  return false;
}

/** What Pro says above the picker — Hindi-friendly, no Versioning-menu directions. */
export const VERSION_UNDO_PICKER_INTRO =
  'Kaunsa pehle wala version chahiye? Niche list se Restore dabao — ek tap, turant wapas (dusra confirm nahi). Abhi kuch change nahi hua.';

export const VERSION_UNDO_PICKER_INTRO_EN =
  'Which earlier version do you want? Tap Restore once — that is the confirmation. Nothing changes until then.';

export const VERSION_UNDO_NO_WORKSPACE =
  'Abhi koi app open nahi hai jisko wapas laaya ja sake. Pehle app banao ya ek existing app kholo — phir undo / pehle wala bolna.';
