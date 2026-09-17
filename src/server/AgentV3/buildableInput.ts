// IS THERE ACTUALLY ANYTHING HERE TO BUILD FROM?
//
// ADMIN BUILD REPORT 2026-09-13, buildId 541979d2. The entire prompt was one line:
//
//     https://drive.google.com/file/d/1Qm_z0FNmJd6HHJAVOQXT2ehmGl3NJgXk/view?pli=1
//
// …a private Google Drive link to a 169 MB video. Nothing else. No app, no feature, not one word.
//
// 🔴 WHAT THE ENGINE DID WITH IT, in order, over 5 minutes 57 seconds:
//   1. planned a COMPLETE FILE LIST for a generic app it had invented   — one model call, 150s
//   2. ran the Simple Builder on it                                     — timed out at 90s
//   3. ran the One-Shot builder on it                                   — abandoned at 150s
//   4. opened the link in a browser                                     — "Access Denied" (9s)
//   5. asked the user what to build
//   6. decided the first attempt was too WEAK and retried on a stronger model
//   7. opened the same dead link again                                  — 169 MB, unreadable (22s)
//   8. asked the user what to build, a second time
//   9. told them their app "needs our strongest engine" and to ADD CREDITS
//
// Three Kimi timeouts (120s each) and eight GLM failures happened inside that. The user got no app,
// and — because they are on the free tier — NavBharatAI paid for every token of it.
//
// 🔒 THE POINT IS NOT THAT IT FAILED. It is that step 5 was always the right answer, and the engine
// reached it at minute FOUR, by exhausting every builder it has. Nothing had asked the one question
// that costs nothing: *does this prompt describe an app at all?* For a bare URL the answer is
// available in under a millisecond, with no model call, before a sandbox is even warm.
//
// ⚠️ WHY THIS IS DELIBERATELY NARROW, and must stay so. Refusing to build a prompt that a user
// genuinely wrote would be far worse than the bug it fixes — an app builder that argues with you is
// not an app builder. So this fires ONLY when, after removing links, there is essentially nothing
// left. "a todo app, design here: <link>" builds, exactly as today. It is not a quality judgement, a
// vagueness score, or a clarifying round trip for an ambiguous prompt: those are somebody else's job
// (see `RequirementGapAnalyzer`, which deliberately does NOT ask questions). This answers one
// question — *is there any instruction here at all?* — and only ever for the case where there is none.

/** Matches http(s) links and bare `www.` / `domain.tld/...` forms a user might paste. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|org|net|io|dev|app|in|co|ai|me|gg|xyz)\b\S*/gi;

/**
 * Words that carry no instruction on their own. A prompt of only these plus a link still says nothing
 * about what to build — "this", "check this out", "yeh dekho" are the shapes people actually send.
 */
const FILLER = new Set([
  'this', 'that', 'it', 'here', 'there', 'please', 'pls', 'plz', 'hi', 'hello', 'hey',
  'check', 'see', 'look', 'open', 'read', 'watch', 'out', 'the', 'a', 'an', 'my', 'me',
  'yeh', 'ye', 'isko', 'iske', 'dekho', 'dekh', 'karo', 'kar', 'do', 'se', 'ka', 'ki', 'ko',
  'link', 'file', 'video', 'doc', 'document', 'drive', 'folder', 'attached', 'below', 'above',
]);

/** The fewest real words a prompt must carry before we will spend a model call on it. */
export const MIN_INSTRUCTION_WORDS = 2;

/**
 * 🔴 AN ORDER WITH NO OBJECT IS NOT A BUILD ORDER (admin build report d6d664e6, 2026-09-17).
 *
 * The entire prompt was one word: **"Bnao"** — Hindi for *"make it"*, naming nothing to make. The
 * engine built for **29 minutes**, hit the wall-clock ceiling, delivered no app, and — because it had
 * no product to name — **took its name from the instruction word**: the plan it wrote reads *"Root
 * HTML template with Bnao metadata"*, *"Main Bnao landing page component"*. A verb became a product.
 *
 * ⚠️ AND THE KEYWORD CLASSIFIER WAS NOT THE CULPRIT — it got this RIGHT. "bnao" is a misspelling of
 * "banao", so it matches none of `IntentClassifier`'s signal arrays; the message fell through to the
 * one-word rule and was classified `{ intent: 'chat', confidence: 'low', signal: 'short' }`. LOW
 * confidence is exactly what sends a message to the LLM intention reader — and the reader, offered
 * only `chat` / `build` / `edit`, answered `build`. It was not wrong: "make it" *is* an order to
 * build. **There was no way for it to say the true answer, which is "they have not told me WHAT."**
 * That missing fourth answer is the defect, and no amount of prompt tuning on three choices fixes it.
 *
 * So the deterministic pass answers it instead, before a model or a sandbox is involved: a prompt
 * whose every remaining word is a bare creation verb names nothing to produce. It is the sibling of
 * `'link-only'` (a link with no instruction) — the same question, asked of a verb instead of a URL.
 *
 * 🔒 WHY THIS CANNOT BECOME "IT REFUSES TO BUILD", which would be far worse than the bug:
 *   • A NOUN is never an action word, so **"calculator"** — one word, names a deliverable — still
 *     builds instantly. This is why the existing `'too-short'` reason is deliberately NOT diverted:
 *     it cannot tell "calculator" from "banao". This one can.
 *   • "app banao", "ek billing app banao", "todo app" all carry a non-action word ⇒ untouched.
 *   • An EDIT verb ("fix karo") classifies as `edit_existing`, which the route's divert excludes, so
 *     a short order inside a live project still means *carry on* — the continuation amnesia this repo
 *     has already fixed once cannot return through here.
 *   • The route additionally requires an EMPTY workspace and NO earlier requests, so "bnao" following
 *     *"ek billing app chahiye"* builds from that context instead of asking again.
 */
const BARE_ACTION_WORDS = new Set([
  // English creation verbs used alone
  'build', 'make', 'create', 'generate', 'develop', 'design', 'code', 'write', 'built', 'begin', 'start',
  // Hinglish — the spellings people actually type, misspellings included (the reported prompt was a
  // misspelling, so a list that only holds correct forms would not have caught the very report it
  // was written for).
  'banao', 'bnao', 'banado', 'bnado', 'banade', 'bnade', 'banaao', 'banana', 'bana', 'banaa',
  'banwao', 'bnwao', 'banadijiye', 'likho', 'likhdo', 'likhdijiye',
]);

/**
 * The `banao` family, for the spellings the list above does not enumerate. Deliberately tight: it
 * requires b·(a)·n·a(a)·<ending>, so "ban", "banner" and "banana" do not match it (the last is in the
 * set above on purpose — as a one-word prompt, a fruit is no more buildable than a verb).
 */
const BANAO_FAMILY = /^b[a]?n[a]{1,2}(?:o|do|de|deo|dena|dijiye|ye)?$/;

/** Is this single word a bare instruction to produce something, carrying no object? PURE. */
export function isBareActionWord(word: string): boolean {
  const w = String(word ?? '').trim().toLowerCase();
  if (!w) return false;
  return BARE_ACTION_WORDS.has(w) || BANAO_FAMILY.test(w);
}

/**
 * Does this prompt order something to be made without ever saying WHAT? PURE — no model, no I/O.
 *
 * True only when, after links and filler are stripped, there is at least one word left and EVERY one
 * of them is a bare action word. One noun anywhere makes it false.
 */
export function namesNoObject(prompt: string): boolean {
  const words = instructionWords(prompt);
  if (words.length === 0) return false; // 'empty' / 'link-only' own that case, with better messages.
  return words.every(isBareActionWord);
}

export type UnbuildableReason =
  /** Nothing at all — empty or whitespace. */
  | 'empty'
  /** Only links (plus filler). We cannot open a private file, and nothing describes an app. */
  | 'link-only'
  /** Words, but far too few to be an instruction (e.g. "app"). */
  | 'too-short'
  /** An order to make something, with no something: "banao", "build", "make it". */
  | 'no-object';

export interface BuildableVerdict {
  /** True when the engine should build exactly as it does today. The overwhelmingly common case. */
  buildable: true;
}

export interface UnbuildableVerdict {
  buildable: false;
  reason: UnbuildableReason;
  /** The links the user pasted, so the reply can name what it could not open. Capped. */
  links: string[];
  /** What to say back — NavBharatAI's own words, one short ask, no vendor names. */
  message: string;
}

export type InputVerdict = BuildableVerdict | UnbuildableVerdict;

/** Strip links and filler, and report what real instruction is left. PURE. */
export function instructionWords(prompt: string): string[] {
  return String(prompt ?? '')
    .replace(URL_PATTERN, ' ')
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));
}

/** Every link in the prompt, de-duplicated and capped so a paste-bomb cannot fill a message. */
export function linksIn(prompt: string): string[] {
  const found = String(prompt ?? '').match(URL_PATTERN) ?? [];
  return [...new Set(found.map((u) => u.trim()))].slice(0, 3);
}

/**
 * A short, plain description of a link we already know we cannot read, or '' when we do not know.
 *
 * 🔒 ONLY claims what is certain from the URL's own shape. Guessing that a link is private, or that a
 * page is unreadable, would put a confident wrong sentence in front of a user whose link was fine —
 * and the whole failure being fixed here is the engine being confidently wrong about somebody's input.
 */
export function knownUnreadableLink(url: string): string {
  const u = String(url ?? '').toLowerCase();
  if (/drive\.google\.com|docs\.google\.com/.test(u)) {
    return 'a Google Drive link — I cannot open files in someone else\'s Drive, even when the link works for you';
  }
  if (/dropbox\.com|onedrive\.live\.com|1drv\.ms/.test(u)) {
    return 'a cloud-storage link I cannot open';
  }
  if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/.test(u)) return 'a video file, which I cannot watch';
  if (/\.(zip|rar|7z)(\?|$)/.test(u)) return 'an archive I cannot open';
  return '';
}

/**
 * Decide whether there is enough here to build from. PURE — no model call, no clock, no I/O.
 *
 * Returns `buildable` for anything with real instruction in it, which is nearly every prompt. The
 * three unbuildable shapes are the ones where building is not a slower answer but a WRONG one: the
 * engine would have to invent an app, and then spend minutes discovering that it had.
 */
export function assessBuildInput(prompt: string): InputVerdict {
  const raw = String(prompt ?? '').trim();
  if (!raw) {
    return {
      buildable: false,
      reason: 'empty',
      links: [],
      message: 'Tell me what you would like me to build and I will start right away — one line is enough, for example "a todo app with due dates".',
    };
  }

  const links = linksIn(raw);
  const words = instructionWords(raw);

  // An ORDER WITH NO OBJECT, checked BEFORE the word-count gate — "banao" is one word and "build it
  // now" is three, and neither says what to make. See the BARE_ACTION_WORDS block above (report
  // d6d664e6). Links are excluded so a pasted link keeps the better 'link-only' message.
  if (links.length === 0 && namesNoObject(raw)) {
    return {
      buildable: false,
      reason: 'no-object',
      links,
      message: 'I did not understand what to make. Tell me in a line or two what the app should do — for example "a shop billing app with GST" — and I will build it right away.',
    };
  }

  if (words.length >= MIN_INSTRUCTION_WORDS) return { buildable: true };

  if (links.length > 0) {
    const known = links.map(knownUnreadableLink).find(Boolean);
    // 🔒 The reason is stated BEFORE the ask. A bare question ("what should I build?") reads as though
    // the link were never seen, which is exactly how a user concludes the product ignored them.
    const cannot = known
      ? `I can see your link, but it is ${known}.`
      : 'I can see your link, but I could not read anything from it that tells me what to build.';
    return {
      buildable: false,
      reason: 'link-only',
      links,
      message: `${cannot} Could you tell me in a line or two what the app should do? For example: what it is for, and the two or three things it must let people do. Pasting the text itself works too — then I will build it straight away.`,
    };
  }

  return {
    buildable: false,
    reason: 'too-short',
    links,
    message: 'I need a little more to go on. Tell me what the app should do — for example "a shop billing app with GST" — and I will build it right away.',
  };
}
