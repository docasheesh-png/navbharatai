// AgentV3 — DOES THE MODEL'S OWN SUMMARY SURVIVE CONTACT WITH WHAT WE MEASURED?
//
// TWO REAL CONTRADICTIONS, from ONE build (admin transcript + report, 2026-08-12):
//
//   1. The model wrote "I verified this with a real browser screenshot and confirmed there are no
//      console errors." The platform, in the same report, recorded RUNTIME_UNCHECKED: "its console
//      could not be captured on this run." One report, two opposite claims, both shown to the admin.
//
//   2. The model described the screenshot as showing "Health 100/100, Level 1, XP 0/100 · Location:
//      Forest Path · Actions: Continue and Rest · Inventory · Game Log". The app was a home page with
//      four corner buttons. None of those words exist anywhere in its source. Earlier in the SAME build
//      the model had described the same screen correctly. It described an image it did not look at.
//
// The second one is the more dangerous. A wrong verdict is a bug; a fabricated observation is the
// platform telling the user something that never happened, in the confident voice of a verification.
//
// WHAT CAN HONESTLY BE CHECKED HERE, AND WHAT CANNOT. We cannot compare prose to a screenshot without
// a vision call, and inventing one would cost money on every build to catch a rare lie. But we do not
// need to: both classes are checkable against facts we ALREADY hold.
//   • A claim of verification is checked against whether that verification ran.
//   • A described UI is checked against the app's own source. A label the app does not contain cannot
//     have been on the screen.
//
// PRECISION FIRST, because a false accusation of lying is worse than a missed one: a fabrication is
// only reported when the summary lists SEVERAL specific UI labels and NOT ONE of them appears in the
// project. A summary that names three real things and one loose paraphrase is left alone.
//
// PURE. No I/O, no clock, no model call. Never throws.

export interface MeasuredFacts {
  /** Did the console capture actually run and return? */
  consoleCaptured: boolean;
  /** Did a screenshot tool call complete during this build? */
  screenshotTaken: boolean;
  /** Did a real browser open the preview and see it render? */
  previewVerified: boolean;
  /** The app's own source, for checking a described UI against what exists. */
  sourceText?: string;
  /**
   * Is `sourceText` actually THE APP — or only the handful of files this turn happened to write?
   *
   * ROOT CAUSE (admin report 2026-08-16, build 4b744bef). The user asked to IMPORT a repo and survey
   * it, explicitly saying "do not change any files yet". The engine obeyed, read the project, and wrote
   * a correct survey naming `src/main.tsx`, `AuthContext`, `ProductList`, `server/db.ts` — all real
   * files in the imported repo. But `sourceText` is built from the files this turn WROTE, and an
   * import/survey turn writes almost nothing (here: `.env` and `.gitignore`). So the fabrication check
   * compared a TRUE description of the app against two config files, found 17 of 19 labels "absent", and
   * told the user the platform had caught its own AI inventing things — which became the build's
   * headline rootCause.
   *
   * This module's own header says it: "a false accusation of lying is worse than a missed one." The
   * check needs the app; when what we hold is not the app, the honest verdict is that we cannot judge.
   * Defaults to true, so a normal build — where the written files ARE the app — is unchanged.
   */
  sourceIsWholeApp?: boolean;
  /**
   * How many files this turn actually created or changed.
   *
   * ROOT CAUSE (admin report 2026-08-16, build 5b4f9b63 — "ab to choti moti apps bhi nahi ban rahi").
   * The user asked for a to-do app. The engine globbed the workspace, saw a page whose NAME matched,
   * read three files, wrote NOTHING, and replied "Your to-do list app is **complete and ready**!" with
   * a table of ticks. Thirty minutes, thirty-one model calls, `ok: true`, zero files. The dev server
   * never came up either, so every runtime check skipped and nothing else was left to contradict it.
   *
   * A claim of delivery is checkable without a preview, without a browser and without a model call:
   * count what was written. This is the cheapest honest check in the engine and it is the one that
   * was missing.
   */
  filesWritten?: number;
  /** Did the USER ask for an app to be built or changed on this turn? (Not: "explain this code".) */
  buildWasRequested?: boolean;
}

export type ClaimKind = 'console-clean' | 'screenshot-seen' | 'preview-renders' | 'ui-described' | 'app-delivered';

export interface ClaimContradiction {
  kind: ClaimKind;
  /** What the summary asserted, in its own words where possible. */
  claimed: string;
  /** What we actually measured. */
  measured: string;
}

/** Phrases that assert a clean console. Deliberately narrow — a mention of errors is not a claim. */
const CONSOLE_CLEAN = /\b(no|zero|without any|free of)\s+(browser\s+)?console\s+errors?\b|\bconsole\s+is\s+clean\b|\bno errors? in the (browser )?console\b/i;
/** Phrases that assert we looked at a screenshot. */
const SCREENSHOT_SEEN = /\b(screenshot|screen shot)\b[^.]{0,40}\b(shows?|confirms?|verif|proves?)\b|\bverified[^.]{0,30}\bscreenshot\b|\bस्क्रीनशॉट\b/i;
/** Phrases that assert the live preview renders. */
const PREVIEW_RENDERS = /\b(preview|app)\s+(is\s+)?(now\s+)?(live|working|renders?|rendering)\b|\blive preview (is )?(working|up)\b/i;

/**
 * Phrases that assert the REQUESTED APP HAS BEEN DELIVERED.
 *
 * Two shapes, both taken from the real summary. "Your to-do list app is **complete and ready**" is the
 * confident delivery claim; "The app is already built with all the requested features" is the more
 * dangerous one, because it also explains away the absence of work. Hindi/Hinglish is included because
 * the engine mirrors the user's language, so the same lie arrives in whichever one they typed.
 *
 * Deliberately NOT matched: "I'll build", "let me build", "building" — an intention is not a claim.
 * Nor is a plan, a next-step list, or a question. The zero-file condition does most of the work here;
 * these patterns only decide whether the reply CLAIMED anything at all.
 */
const APP_DELIVERED = new RegExp([
  // "your … app is complete and ready" / "the app is done" / "the app is fully built"
  /\b(?:app|application|website|site|dashboard|game)\b[^.!\n]{0,60}?\b(?:is|are)\b[^.!\n]{0,30}?\b(?:complete|completed|ready|done|finished|fully built|built and ready)\b/,
  // "already built" / "already implemented" / "already has all the features"
  /\balready\b[^.!\n]{0,30}?\b(?:built|implemented|complete|created|in place|has all)\b/,
  // "all the requested features are implemented" / "everything you asked for is working"
  /\b(?:all (?:the )?(?:requested )?features?|everything (?:you )?(?:asked|requested)[^.!\n]{0,20})\b[^.!\n]{0,40}?\b(?:implemented|delivered|built|working|present|done)\b/,
  /\bfeatures?\s+delivered\b/,
  // Hindi/Hinglish: "app ban gaya", "taiyar hai", "पूरा हो गया"
  /\b(?:app|ऐप)\b[^.!\n]{0,30}?\b(?:ban gaya|ban gayi|taiyar|तैयार|बन गया|पूरा हो गया)\b/,
].map((r) => r.source).join('|'), 'i');

/**
 * UI labels the summary presents as things on the screen.
 *
 * Taken from markdown BOLD and from `- **Label**: value` bullets, because that is the shape a model
 * uses when it walks through a screenshot. Free prose is deliberately not mined: an ordinary sentence
 * mentioning a word is not a claim that the word was on screen.
 */
export function describedUiLabels(summary: string): string[] {
  const out: string[] = [];
  const re = /\*\*([^*\n]{2,40})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(summary ?? '')))) {
    const label = m[1].replace(/[:：]\s*$/, '').trim();
    // Skip headings the model uses about ITSELF rather than about the screen.
    if (/^(what|kya|completed|fixed|done|root cause|live preview|next|verification|targeted edits)/i.test(label)) continue;
    if (!label || out.includes(label)) continue;
    out.push(label);
  }
  return out;
}

/**
 * Is this label present in the app's own source?
 *
 * THREE answers, not two. A label like "XP" is two characters — it would match half the codebase by
 * accident, so it cannot be judged either way, and counting it as PRESENT is what let the real
 * fabrication through: the un-judgeable labels padded the denominator until the invented ones looked
 * like a minority. Unjudgeable labels are excluded from both sides of the count, the same rule this
 * codebase already applies to an ungraded page and an unrun check.
 */
function labelInSource(label: string, source: string): 'present' | 'absent' | 'unknown' {
  const cleaned = label.replace(/[^A-Za-z0-9ऀ-ॿ ]+/g, ' ').trim();
  if (!cleaned) return 'unknown'; // pure punctuation/emoji — nothing to check, never accuse
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return 'unknown'; // too short to mean anything either way
  const lower = source.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase())) ? 'present' : 'absent';
}

/**
 * How many labels must be listed before "none of them exist" is evidence rather than noise.
 *
 * Two could be a paraphrase. Four cannot: a model walking through a screen it did not look at produces
 * a whole coherent list, which is exactly the transcript's "Health / Level / XP / Location / Inventory
 * / Game Log".
 *
 * Paired with a SHARE threshold, because "not one of them exists" turned out to be unreachable: in the
 * real case the model got the app's title right and invented every line under it, so a rule demanding
 * a clean sweep would have let the actual fabrication through.
 */
export const MIN_LABELS_FOR_FABRICATION = 4;

/** Check the model's summary against what the platform actually measured. Pure. */
export function auditSummaryClaims(summary: string, facts: MeasuredFacts): ClaimContradiction[] {
  const text = String(summary ?? '');
  if (!text.trim()) return [];
  const out: ClaimContradiction[] = [];

  if (!facts.consoleCaptured && CONSOLE_CLEAN.test(text)) {
    out.push({
      kind: 'console-clean',
      claimed: 'that there are no console errors',
      measured: 'the browser console could not be captured on this run, so it was never checked',
    });
  }
  if (!facts.screenshotTaken && SCREENSHOT_SEEN.test(text)) {
    out.push({
      kind: 'screenshot-seen',
      claimed: 'that a screenshot was looked at',
      measured: 'no screenshot was captured during this build',
    });
  }
  if (!facts.previewVerified && PREVIEW_RENDERS.test(text)) {
    out.push({
      kind: 'preview-renders',
      claimed: 'that the live preview is working',
      measured: 'no browser check confirmed the preview rendering',
    });
  }

  // THE APP THAT WAS NEVER BUILT (build 5b4f9b63). Requires all three, so it cannot fire on an honest
  // turn: the user asked for a build, the summary claims one was delivered, and NOTHING was written.
  // `filesWritten === undefined` means the caller could not tell us — silence is never an accusation.
  if (facts.buildWasRequested === true && facts.filesWritten === 0 && APP_DELIVERED.test(text)) {
    out.push({
      kind: 'app-delivered',
      claimed: 'that the app you asked for is built and ready',
      measured: 'not one file was created or changed on this turn, so nothing was actually built',
    });
  }

  // A described UI that exists nowhere in the app — judged ONLY against the app itself. When what we
  // hold is not the project (an import/survey turn writes nothing, so `sourceText` is a couple of
  // config files), every label reads as "absent" and the check becomes an accusation generator (build
  // 4b744bef). Defaults to judging: an omitted flag must not silently disable a real check.
  const source = facts.sourceIsWholeApp === false ? undefined : facts.sourceText;
  if (source && source.trim()) {
    const labels = describedUiLabels(text);
    if (labels.length >= MIN_LABELS_FOR_FABRICATION) {
      const judgeable = labels.filter((l) => labelInSource(l, source) !== 'unknown');
      const missing = judgeable.filter((l) => labelInSource(l, source) === 'absent');
      // NOT "none of them exist" — that bar is unreachable in practice and would have missed the real
      // case, where the model got the app's TITLE right and invented every other line under it. A
      // fabricated walk-through is a dominant majority of invented labels, so require both a real count
      // of them and a clear share, which no honest summary with one loose paraphrase can reach.
      const fabricated = missing.length >= MIN_LABELS_FOR_FABRICATION
        && judgeable.length > 0 && missing.length / judgeable.length >= 0.8;
      if (fabricated) {
        out.push({
          kind: 'ui-described',
          claimed: `the screen shows ${missing.slice(0, 6).join(', ')}`,
          measured: `${missing.length} of the ${judgeable.length} things it described appear nowhere in this app's source, so they were not on the screen`,
        });
      }
    }
  }

  return out;
}

/**
 * The correction appended to the user-facing summary.
 *
 * It corrects rather than deletes, and it never calls the model a liar: the user needs to know which
 * sentence not to trust, not a lecture about how it got there.
 */
export function claimCorrection(contradictions: readonly ClaimContradiction[]): string {
  if (!contradictions || contradictions.length === 0) return '';
  const lines = contradictions.map((c) => `- The line above claiming ${c.claimed} is not supported — ${c.measured}.`);
  return ['', '⚠️ Correction from NavBharatAI itself:', ...lines].join('\n');
}

/** The admin-facing one-liner. Pure. */
export function claimAuditSummary(contradictions: readonly ClaimContradiction[]): string {
  return `The build summary made ${contradictions.length} claim(s) the platform's own measurements contradict: `
    + contradictions.map((c) => `${c.kind} (${c.measured})`).join('; ');
}
