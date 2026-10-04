// PUBLISHING IS THE USER'S DECISION, NOT THE MODEL'S (admin 2026-09-01).
//
// WHAT WENT WRONG. A user typed "continue". The build finished, and the agent decided on its own:
// "Build successful! Ab deploy karta hoon." — `TOOL_CALL ▶ deploy` — and their app went live on a
// public URL. Nobody asked for that.
//
// The only thing standing between a private app and the public internet was a SENTENCE in the tool's
// description: "use when the user asks to deploy/publish/go live". A prompt is guidance, not a gate,
// and the model simply did not follow it. A permission enforced by asking the model nicely is not a
// permission at all — which is the same lesson as every other guard in this codebase that had to be
// made structural after a comment failed to hold it.
//
// THE ASYMMETRY THAT DECIDES THE DEFAULT. Getting this wrong in one direction means the model says
// "tell me when you want this live" to someone who wanted it live — mildly annoying, instantly fixed,
// and the Publish button is right there anyway. Getting it wrong in the other direction puts somebody's
// unfinished work on a public URL without them asking. Those are not comparable, so consent DENIED is
// the default and the burden of proof sits on publishing.

/** Words that ask for a publish, across the languages NavBharatAI's users actually type in. */
const ASK = [
  // English
  /\bpublish(?:ed|ing)?\b/i,
  /\bdeploy(?:ed|ing|ment)?\b/i,
  /\bgo\s+live\b/i, /\bmake\s+it\s+live\b/i, /\btake\s+it\s+live\b/i,
  /\bship\s+it\b/i, /\bhost\s+it\b/i, /\bput\s+it\s+online\b/i,
  // Hinglish — how this is actually asked.
  // ⚠️ The verb suffix is OPTIONAL and unanchored on the right. A first version ended these with `\b`
  // after `kar`, which matched "publish kar do" and MISSED "publish karo" — the single most common way
  // an Indian user says this, because "karo" is one word and there is no boundary inside it. Caught by
  // the test; worth keeping in mind for every Hinglish pattern in this codebase.
  /\b(?:live|publish|deploy|host|online|upload)\s+k(?:ar|r)/i,
  /\bkar\s+do\b.{0,12}\b(?:live|publish|deploy)\b/i,
  // Devanagari
  /प्रकाशित/, /लाइव\s*कर/, /डिप्लॉय/, /पब्लिश\s*कर/, /होस्ट\s*कर/,
];

/**
 * Words that TAKE BACK the ask. Checked after, and they win — "abhi publish mat karna" contains
 * "publish" and means the exact opposite. A guard that reads only the keyword would publish on a
 * sentence telling it not to, which is worse than having no guard at all because it looks safe.
 */
const REFUSE = [
  /\b(?:do\s*n[o']?t|don't|dont|never|no\s+need\s+to|not\s+yet|without)\b/i,
  /\bmat\b/i, /\bnahi\b/i, /\bnahin\b/i, /\bmt\b/i,
  // `\b` is an ASCII boundary and cannot see a Devanagari word: `/मत\b/` matched nothing, so
  // "पब्लिश करो, पर अभी मत" published. Bounded on both sides, so मतलब (meaning) and मतदान (voting)
  // are not "मत" (do not). Census-locked in tests/aWordBoundaryCanSeeHindi.test.ts.
  /(?<![\w\u0900-\u097F])मत(?![\w\u0900-\u097F])/, /नहीं/,
  /\blater\b/i, /\bbaad\s+me[in]?\b/i, /\babhi\s+(?:nahi|mat|na)\b/i,
];

/**
 * 🔴 A PUBLISH WORD THAT NAMES A FEATURE OF THE APP IS NOT AN ASK (autopsy 68f0a486, 2026-10-04).
 *
 * "app mein video upload karne ke liye option ho" asked for an upload BUTTON inside a school app; the
 * pattern `upload\s+kar` read it as "upload (publish) it", and the deploy tool was switched on for a
 * user who never asked to go public. The same shape grants on "a blog where users can publish posts",
 * "live karne ka option" (a streaming feature) and "event host karne ke liye". The asymmetry decides
 * the direction: a missed ask costs one press of the Publish button; a false one can put somebody's
 * app on a public URL. So each occurrence is read in its sentence, and one that is a FEATURE is skipped.
 */
const FEATURE_AFTER = [
  // a purpose clause: "upload karne ke liye", "publish karne ka option", "लाइव करने के लिए"
  /^(?:\s*k(?:ar|r))?(?:ne|na|ni)\s+(?:ke\s+liye|ka\b|ki\b|ke\s+(?:option|feature|button)|wal[ae]\b)/i,
  /^(?:\s*कर)?(?:ने|ना|नी)\s*(?:के\s*लिए|का|की|वाला|वाली)/,
  // the thing being published is the users' content, not the app: "publish posts", "upload their videos"
  /^\s+(?:their|his|her|your|own|new|the|any)?\s*(?:posts?|videos?|articles?|blogs?|stories|notes?|pdfs?|files?|photos?|images?|content|events?|results?|notices?|assignments?|courses?|lessons?|recipes?|listings?|products?|reviews?|comments?|documents?)\b/i,
];
const FEATURE_BEFORE = [
  // who does it inside the app: "users can publish", "students ko upload kar"
  /\b(?:users?|students?|teachers?|people|members?|customers?|authors?|writers?|sellers?|admins?|they|anyone|everyone|creators?|parents?)\s+(?:can|could|will|should|may|to|ko|ke\s+liye)\s+(?:[a-z]+\s+){0,2}$/i,
  // the control that does it: "an option to publish", "a button to upload", "allow users to publish"
  /\b(?:option|feature|button|ability|allows?|allowing|let|lets)\s+(?:[a-z]+\s+){0,2}(?:to\s+)?$/i,
  // Hindi word order puts the object first: "video upload kar", "posts publish karne"
  /\b(?:posts?|videos?|pdfs?|files?|photos?|notes?|content|articles?|blogs?|notices?|assignments?|results?|courses?|lectures?|images?|documents?)\s+$/i,
  /(?:वीडियो|पोस्ट|फोटो|फ़ोटो|फाइल|फ़ाइल|नोट्स|पीडीएफ)\s*$/,
];
/** "deployment tracker" is a product, not an order to deploy. */
const COMPOUND_AFTER = /^\s+(?:tracker|dashboard|pipeline|manager|logs?|history|status|tool|system|platform|monitor)\b/i;

/** Is THIS occurrence of a publish word an order about the app, rather than a feature inside it? */
function isAnOrder(text: string, index: number, word: string): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  const after = text.slice(index + word.length, index + word.length + 48);
  if (FEATURE_AFTER.some((re) => re.test(after))) return false;
  if (FEATURE_BEFORE.some((re) => re.test(before))) return false;
  if (/ment$/i.test(word) && COMPOUND_AFTER.test(after)) return false;
  return true;
}

/** Does any occurrence of any ask pattern read as an order? PURE. */
function askedAsAnOrder(text: string): boolean {
  return ASK.some((re) => {
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(all)) {
      if (isAnOrder(text, m.index ?? 0, m[0])) return true;
    }
    return false;
  });
}

export type PublishConsent = 'granted' | 'denied';

export interface ConsentDecision {
  consent: PublishConsent;
  /** Why — so a refusal can explain itself to the model instead of just failing. */
  reason: 'explicit-button' | 'asked-in-message' | 'not-asked' | 'withdrawn';
}

/**
 * Did the user ask, in THIS message, for their app to be published?
 *
 * Deliberately scoped to the CURRENT message and not to the conversation. Consent that carries
 * forward is how "publish it" said once, twenty minutes ago, becomes an app that republishes itself
 * on every later "continue" — which is the bug this closes. A user who does want it live says so, or
 * presses the button, and both take one second.
 *
 * PURE.
 */
export function decidePublishConsent(userMessage: string | null | undefined): ConsentDecision {
  const text = String(userMessage ?? '').trim();
  if (!text) return { consent: 'denied', reason: 'not-asked' };

  const asked = askedAsAnOrder(text);
  if (!asked) return { consent: 'denied', reason: 'not-asked' };

  // The ask exists — but a negation anywhere in a short instruction almost always governs it.
  if (REFUSE.some((re) => re.test(text))) return { consent: 'denied', reason: 'withdrawn' };

  return { consent: 'granted', reason: 'asked-in-message' };
}

/**
 * What the model is told when it tries to publish uninvited. Written for it to RELAY, not to hide:
 * the user should learn their app is ready and that publishing is one tap away — the refusal is about
 * who decides, never about the app being unfit.
 */
export const PUBLISH_NOT_REQUESTED = [
  'Publishing was not requested, so nothing was published.',
  'The app is built and the preview is live — publishing puts it on a permanent PUBLIC URL, which is the',
  'user\'s decision to make. Tell them the app is ready and that they can publish it with the Publish',
  'button, or by asking. Do not call deploy again on this turn.',
].join(' ');
