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
  /**
   * How many actionable console errors the capture actually found — the OTHER half of the claim.
   *
   * 🔴 Until 2026-09-21 this auditor could only catch "you said clean and nobody looked". The worse
   * sentence — **we looked, we saw errors, and the summary said clean** — had no rule at all, because
   * it was unreachable: the console listener lived on the agent-driven CDP daemon alone, so an
   * ordinary build never captured anything and `consoleCaptured` was false almost every time. The
   * same-day fix that made `browseUrl` record its console is what opened that door, so the rule that
   * guards it ships with it rather than waiting for a report to prove it.
   *
   * `undefined` means the caller could not tell us, and silence is never an accusation — the same
   * discipline `typecheckRan` already states.
   */
  consoleErrorsFound?: number;
  /**
   * Did a typecheck actually run on this build?
   *
   * Added after build 7bc15e40, where the summary claimed *"TypeScript type-check passes cleanly"*
   * and the release gate recorded, in the same report, *"the typecheck did not run"*. There was no
   * pattern for this claim at all — the auditor could not have caught it however it was worded.
   *
   * `undefined` means the caller could not tell us, and silence is never an accusation.
   */
  typecheckRan?: boolean;
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
  /**
   * The real browser opened the app and it carried no styling — raw HTML (renderStyle.ts, 2026-09-28).
   * `true` only on a measured unstyled verdict; omitted or `false` means nothing is contradicted.
   */
  renderUnstyled?: boolean;
  /**
   * The user's own request, when the caller has it — read only by the `user-attributed` check. Omitted
   * ⇒ that check never runs (silence is never an accusation).
   */
  userRequest?: string;
  /**
   * How many source files (code + stylesheets) the app is made of — for the `one-file` check. Omitted ⇒
   * that check never runs. 🔴 Autopsy dfd24058 (2026-10-01): "Everything lives in one HTML file, no
   * routing" about a sixteen-file React project — and the summary then told the user to open
   * `dist/index.html` directly, which for a Vite build with absolute asset paths shows a blank page.
   */
  appSourceFiles?: number;
  /**
   * Did the user's request ask for LIVE data (`scriptRequest.ts` → `liveDataRequested`)? Read only by the
   * `live-data-claimed` check; omitted ⇒ that check never runs. 🔴 Autopsy 241215d1 (Q-274): a paper-trading
   * app asked for live `yfinance` prices, shipped a simulated feed, and was described as working end to end.
   */
  liveDataRequested?: boolean;
}

/** "Everything lives in one HTML file", "a single HTML file" — never "single-page app", which is true. */
const ONE_FILE_CLAIMED = /\b(?:in|lives\s+in|is|as|inside)\s+(?:just\s+|only\s+)?(?:one|a\s+single|single)\s+(?:html\s+|index\.html\s+)?file\b|\bsingle[\s-](?:html\s+)?file\s+app\b/i;

export type ClaimKind = 'live-data-claimed' | 'one-file' | 'console-clean' | 'console-clean-but-errors' | 'typecheck-clean' | 'screenshot-seen' | 'preview-renders' | 'ui-described' | 'app-delivered' | 'design-claimed' | 'user-attributed';

/**
 * "the exact versions you specified" — a PLATFORM requirement credited to the user (autopsy 33812996).
 * The phone-plugin brief pins versions and already says, in words, *"never tell the user they asked for
 * versions"* (autopsy e7baf61d); the model said it anyway: *"uses the exact Capacitor plugin versions you
 * specified"*. A prompt instruction the model can ignore is not a fix, so the claim is checked.
 */
const VERSIONS_ATTRIBUTED_TO_USER = /\bversions?\s+(?:that\s+)?you\s+(?:specified|asked\s+for|requested|gave|mentioned|wanted|provided)\b|\byour\s+(?:specified|requested)\s+versions?\b/i;
/** A version number the user could have written: 7.6.9, v5, 18.3.1, @7.5.0. */
const A_VERSION_NUMBER = /(?:^|[\s@v^~=])\d+\.\d+(?:\.\d+)?\b|\bv\d+\b/i;

export interface ClaimContradiction {
  kind: ClaimKind;
  /** What the summary asserted, in its own words where possible. */
  claimed: string;
  /** What we actually measured. */
  measured: string;
}

/**
 * Phrases that assert a clean console. Deliberately narrow — a mention of errors is not a claim.
 *
 * Hinglish included for the same reason as APP_DELIVERED and PREVIEW_RENDERS: the engine mirrors the
 * user's language, so a guard that only reads English is off for whoever typed Hindi. Note the shape
 * is INVERTED here — this claim IS a negation ("koi error nahi"), so unlike the preview patterns the
 * "nahi" is the thing being matched rather than the thing being excluded.
 */
/**
 * 🔴 ONE ADJECTIVE DEFEATED THIS ENTIRE CHECK (build 7bc15e40, 2026-09-13, a real user).
 *
 * The summary said **"No runtime errors in the browser console"** while the platform's own record
 * said `RUNTIME_UNCHECKED` — the console was never captured. The claim sailed through, because every
 * pattern below spelled out an exact word sequence: `no errors in the console` matched,
 * `no RUNTIME errors in the console` did not. One inserted word.
 *
 * That is a bug in the CLASS, not in a missing phrase — a model writes naturally, so "no runtime
 * errors", "zero JavaScript errors", "no uncaught errors in the console" are all the same claim. So
 * the negation and the noun are now allowed a short run of filler words between them, in BOTH
 * orders (errors-then-console and console-then-errors), instead of adding one more literal spelling
 * each time a summary phrases it a new way.
 *
 * The filler run is bounded (≤ 3 words, and the two halves must sit in the same sentence) so it
 * cannot reach across into an unrelated clause and invent a claim nobody made.
 */
const CONSOLE_CLEAN = new RegExp([
  // "no console errors", "no browser console errors", "zero remaining console errors"
  /\b(?:no|zero|without any|free of)\s+(?:[\w-]+\s+){0,3}?console\s+errors?\b/,
  // "No runtime errors in the browser console", "zero JavaScript errors in the console"
  /\b(?:no|zero|without any|free of)\s+(?:[\w-]+\s+){0,3}?errors?\b[^.!\n]{0,40}?\bconsole\b/,
  /\bconsole\s+is\s+clean\b/,
  /\bno errors? in the (browser )?console\b/,
  // Hinglish: "console me koi error nahi", "koi console error nahi hai", "console bilkul saaf hai"
  /\b(?:console|कंसोल)\b[^.!\n]{0,30}?\b(?:koi\s+)?(?:error|errors|गलती)\b[^.!\n]{0,15}?\b(?:nahi|nahin|नहीं)\b/,
  /\bkoi\s+(?:console\s+)?error\s+nahi\b/,
  /\b(?:console|कंसोल)\b[^.!\n]{0,20}?\b(?:saaf|साफ)\b/,
].map((r) => r.source).join('|'), 'i');

/**
 * A claim that the project COMPILES — the same shape of promise as a clean console, and just as
 * checkable against whether the check was ever run. Deliberately requires a PASS word beside the
 * typecheck word, so "the typecheck is still failing" and "run a typecheck" are not claims.
 */
const TYPECHECK_CLEAN = new RegExp([
  /\b(?:type[\s-]?check(?:s|ing|ed)?|tsc|typescript)\b[^.!\n]{0,40}?\b(?:passes?|passed|passing|clean|cleanly|succeeds?|succeeded|no errors?)\b/,
  /\b(?:no|zero)\s+(?:[\w-]+\s+){0,3}?type\s+errors?\b/,
  /\b(?:compiles?|compiled)\s+(?:cleanly|successfully|without errors?)\b/,
].map((r) => r.source).join('|'), 'i');

/**
 * Phrases that assert we looked at a screenshot.
 *
 * The Devanagari spelling was already here; the LATIN Hinglish forms were not, which is the way most
 * Hindi-speaking users actually type. "screenshot dekha", "screenshot me dikh raha hai" are the same
 * claim as "the screenshot confirms" and were passing straight through.
 */
const SCREENSHOT_SEEN = new RegExp([
  /\b(screenshot|screen shot)\b[^.]{0,40}\b(shows?|confirms?|verif|proves?)\b/,
  /\bverified[^.]{0,30}\bscreenshot\b/,
  /\bस्क्रीनशॉट\b/,
  // Hinglish: "screenshot dekha", "screenshot me dikh raha hai", "screenshot se confirm hua"
  /\bscreenshot\b[^.!\n]{0,30}?\b(?:dekh[aiy]|dikh\s*rah[aiy]|dikha|confirm)\b/,
].map((r) => r.source).join('|'), 'i');
/**
 * Phrases that assert the live preview renders.
 *
 * ⚠️ THIS GUARD WAS SILENTLY OFF FOR HALF OUR USERS (found 2026-08-24). It was English-only, while
 * APP_DELIVERED two patterns below already carries Hindi/Hinglish with the reason written beside it:
 * "the engine mirrors the user's language, so the same lie arrives in whichever one they typed." The
 * same argument applies here and had simply not been made twice.
 *
 * It matters because of what the admin actually received (transcript 2026-08-12): "App tayyar hai! 🎉
 * App live hai: <link>" — and the link showed a Closed Port Error. That one happened to slip through
 * on `app live`, which the English pattern matches by accident; "app chal rahi hai", "preview chal
 * raha hai" and "sab kaam kar raha hai" did not match at all. An honesty guard that depends on which
 * language the user happened to type in is not a guard.
 *
 * Still deliberately narrow. It matches an ASSERTION that the thing is up, never a mention of it —
 * "preview khul jayega", "preview dekho", and a next step are all untouched.
 *
 * ONE KNOWN IMPRECISION, stated rather than hidden: the ORIGINAL English alternative still fires on
 * "preview live" inside a Hinglish sentence like "Kya preview live hai?" or "preview live karne ki
 * koshish kar raha hoon". Left alone deliberately — the consequence is benign (the note appended says
 * "no browser check confirmed the preview rendering", which is TRUE on any run that reaches here), and
 * tightening a pattern 33 passing tests depend on would risk a real regression to remove a redundancy.
 * The case that actually mattered — a NEGATION being "corrected" as though it were a boast — is closed.
 */
const PREVIEW_RENDERS = new RegExp([
  /\b(preview|app)\s+(is\s+)?(now\s+)?(live|working|renders?|rendering)\b/,
  /\blive preview (is )?(working|up)\b/,
  // Hinglish: "app chal rahi hai", "preview chal raha hai", "app sahi chal raha hai"
  /\b(?:preview|app|ऐप)\b[^.!\n]{0,30}?\b(?:chal rah[aiy]|chal gay[ai]|chalu ho gay[ai]|चल रह[ाी] है)\b/,
  // Hinglish: "preview kaam kar raha hai", "sab kaam kar raha hai"
  /\b(?:kaam kar rah[aiy]|काम कर रह[ाी] है)\b/,
  // Hinglish: "app live ho gaya", "preview live hai" — the shape the admin's own report carried.
  //
  // ADJACENT ON PURPOSE, not a 20-character window. The loose version matched three sentences that
  // are the OPPOSITE of a claim, and each would have had the platform "correct" an honest summary:
  //   "Preview abhi live NAHI hai"          — a negation, i.e. exactly what honesty sounds like
  //   "Main preview live KARNE ki koshish"  — an intention, not an assertion
  //   "Kya preview live hai?"               — a question
  // Requiring `live` to sit directly on its verb kills the first two (a negation or a verb always
  // comes between), and the lookahead kills the third. Same discipline as APP_DELIVERED's note that
  // an intention is never a claim.
  /\b(?:live|लाइव)\s+(?:ho\s+gay[ai]|hai|है)\b(?!\s*[?？])/,
].map((r) => r.source).join('|'), 'i');

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
  if (words.some((w) => lower.includes(w.toLowerCase()))) return 'present';
  // 🔴 A TRANSLITERATION IS NOT A FABRICATION (autopsy "Lekhan Sahyak", 2026-09-27). The app's screens
  // were written in Hindi script and the summary named them in Latin letters — "Lekhan Shaili",
  // "Kirdaar", "Adhyay" — as Hinglish readers do. A substring test cannot see that "Kirdaar" is
  // किरदार, so the user was told eight real screens "were not on the screen". A Latin label is
  // therefore unjudgeable, never absent, in an app whose source carries an Indic script: the check
  // must be certain before it accuses.
  if (!INDIC_SCRIPT.test(cleaned) && INDIC_SCRIPT.test(source)) return 'unknown';
  return 'absent';
}

/** Any character of the Indic scripts (Devanagari through Malayalam). */
const INDIC_SCRIPT = /[\u0900-\u0DFF]/;

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

/** A sentence claiming live data. "live prices (simulated)" is honest, so a sentence that says so is not a claim. */
const LIVE_DATA_CLAIMED = /\b(?:live|real[\s-]?time)\s+(?:nse\s+|bse\s+|stock\s+|market\s+)*(?:data|prices?|quotes?|feeds?|ticks?|market\s+data|updates?)\b/i;
const SAYS_SIMULATED = /\b(?:simulat\w*|sample|mock\w*|demo|dummy|fake|synthetic|random(?:ly)?)\b/i;
function liveDataClaim(summary: string): string | null {
  for (const sentence of summary.split(/(?<=[.!?])\s+|\n+/)) {
    if (LIVE_DATA_CLAIMED.test(sentence) && !SAYS_SIMULATED.test(sentence)) return sentence.trim();
  }
  return null;
}
/** Code that generates a price/data feed itself. */
const SIMULATED_FEED = /\bsimulat\w*|\bmock_?(?:price|feed|data|tick|quote)\w*|random[_\s-]?walk|random\.gauss\(|np\.random\.normal\(|random\.uniform\(/i;
/** Code that reaches a real market-data source. */
const REAL_FEED = /\byfinance\b|\bjugaad\b|\bnsepy\b|alphavantage|alpha_vantage|finnhub|polygon\.io|twelvedata|query[12]\.finance\.yahoo|nseindia\.com|kiteconnect|upstox/i;

/** Check the model's summary against what the platform actually measured. Pure. */
/**
 * Phrases that assert the app LOOKS designed. Narrow on purpose: "responsive" or "clean code" is not a
 * claim about looks; "beautiful", "polished", "professionally designed", "modern UI", and the Hinglish
 * "sundar"/"khubsurat" are. Checked only when the browser measured the page as unstyled.
 */
const DESIGN_CLAIMED = new RegExp([
  /\b(beautiful(ly)?|polished|sleek|elegant|stunning|gorgeous)\b[^.!\n]{0,40}\b(design|designed|ui|interface|look|looking|styled?|styling|theme|layout)\b/,
  /\b(professional(ly)?|modern|premium)[- ](designed|design|ui|interface|look|styling)\b/,
  /\b(fully|nicely|carefully|well)[- ]styled\b/,
  /\b(sundar|khubsurat|खूबसूरत|सुंदर)\b/,
].map((r) => r.source).join('|'), 'i');

export function auditSummaryClaims(summary: string, facts: MeasuredFacts): ClaimContradiction[] {
  const text = String(summary ?? '');
  if (!text.trim()) return [];
  const out: ClaimContradiction[] = [];

  // "A beautiful, polished UI" about a page the browser painted with the UA stylesheet alone (admin
  // 2026-09-28, the unstyled "secret calculator" that was "verified ✓").
  if (facts.renderUnstyled === true && DESIGN_CLAIMED.test(text)) {
    out.push({
      kind: 'design-claimed',
      claimed: 'that the app is styled and looks designed',
      measured: 'when the app was opened in a real browser, none of its own styling had reached the page — it rendered as plain HTML',
    });
  }

  if (!facts.consoleCaptured && CONSOLE_CLEAN.test(text)) {
    out.push({
      kind: 'console-clean',
      claimed: 'that there are no console errors',
      measured: 'the browser console could not be captured on this run, so it was never checked',
    });
  } else if (facts.consoleCaptured && (facts.consoleErrorsFound ?? 0) > 0 && CONSOLE_CLEAN.test(text)) {
    // ⚠️ `else if`, NOT a second `if`: the two are mutually exclusive by construction (the first needs
    // the console unread, this one needs it read), and chaining them says so rather than relying on a
    // reader to notice. One claim must never produce two contradictions in the user's correction.
    const n = facts.consoleErrorsFound ?? 0;
    out.push({
      kind: 'console-clean-but-errors',
      claimed: 'that there are no console errors',
      measured: `the browser console WAS read on this run and ${n} error${n === 1 ? '' : 's'} remained in it`,
    });
  }
  // Only when the caller actually told us — an omitted fact must never become an accusation.
  if (facts.typecheckRan === false && TYPECHECK_CLEAN.test(text)) {
    out.push({
      kind: 'typecheck-clean',
      claimed: 'that the project type-checks cleanly',
      measured: 'no typecheck ran on this build, so nothing was compiled to find out',
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

  if (typeof facts.appSourceFiles === 'number' && facts.appSourceFiles > 1 && ONE_FILE_CLAIMED.test(text)) {
    out.push({
      kind: 'one-file',
      claimed: 'that the whole app is one HTML file',
      measured: `it is a project of ${facts.appSourceFiles} source files that builds into one page — open it through Preview or publish it, not by opening a file`,
    });
  }

  // "Live NSE prices" from an app whose source only simulates them (Q-274, autopsy 241215d1). Needs all
  // four: live data was asked for, the summary claims live data in a sentence that does not itself say
  // the data is simulated, the app's source simulates a feed, and the source names no real data source.
  if (facts.liveDataRequested === true && facts.sourceIsWholeApp !== false && facts.sourceText) {
    const claim = liveDataClaim(text);
    if (claim && SIMULATED_FEED.test(facts.sourceText) && !REAL_FEED.test(facts.sourceText)) {
      out.push({
        kind: 'live-data-claimed',
        claimed: 'that the app shows live data',
        measured: 'its code generates simulated prices and connects to no live data source, so the numbers on screen are sample data',
      });
    }
  }

  // "the exact versions you specified" when the user wrote no version at all (autopsy 33812996).
  if (typeof facts.userRequest === 'string' && VERSIONS_ATTRIBUTED_TO_USER.test(text) && !A_VERSION_NUMBER.test(facts.userRequest)) {
    out.push({
      kind: 'user-attributed',
      claimed: 'that you specified the package versions it used',
      measured: 'your request named no versions — NavBharatAI pinned them so the phone build matches',
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

/**
 * A CONTROL THE MODEL ITSELF SAYS DOES NOTHING (autopsy `51ef24ad`, 2026-10-04). That build's summary
 * read "Cloud Sync on the Settings page is a UI-only toggle for now" — and shipped a "Sync All Data Now"
 * button beside it. Honest wording, dishonest app: the user taps a button that does nothing. This is not
 * a contradiction (the audit above finds none), it is an ADMISSION, and it is the most precise signal
 * the engine will ever get that a dead control shipped. Narrow on purpose: each phrase states that a
 * control is inert, never that a feature is merely simple. PURE; returns the admitted sentences.
 */
const INERT_CONTROL_ADMISSION = new RegExp([
  /\bui[- ]only\b/,
  /\b(?:visual|cosmetic|display)[- ]only\b[^.!\n]{0,40}\b(?:toggle|button|switch|control|option|setting)s?\b/,
  /\b(?:toggle|button|switch|control)s?\b[^.!\n]{0,60}\b(?:does(?:n't| not) (?:do anything|work yet|actually)|has no effect|is not (?:yet )?wired|isn't (?:yet )?wired|not (?:yet )?connected to (?:a|any) (?:real )?(?:backend|server|api))\b/,
  /\bplaceholder (?:toggle|button|switch|control)s?\b/,
].map((r) => r.source).join('|'), 'i');

export function admittedInertControls(summary: string): string[] {
  const text = String(summary ?? '');
  if (!text.trim()) return [];
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s*•-]+/, '').trim())
    .filter((s) => s && INERT_CONTROL_ADMISSION.test(s))
    .slice(0, 5);
}
