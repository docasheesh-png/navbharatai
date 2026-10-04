/**
 * 🔴 A REQUEST ABOUT AN APP THAT IS NOT HERE GETS AN ANSWER, NOT A BUILD (autopsy 0d297b25, 2026-09-23).
 *
 * The WORKNEX prompt opened: *"The WORKNEX app is already developed in this Replit project. DO NOT
 * rebuild it from scratch …"* and asked for a signed Android APK of it. The project was on Replit; the
 * NavBharatAI workspace held only our seeded starter. The engine nevertheless started a build: a 90 s
 * fast-lane plan for a "WhatsApp clone", a full builder that could only write an inspection report
 * saying the app was not there, and a bill — four minutes of a free user's time for a finding that
 * was knowable before the first token: **the thing they asked us to change does not exist here.**
 *
 * The admin's standing rule (READ THE MOOD FIRST, 2026-09-13) already says a message that does not ask
 * for something to be made gets an answer. This is the other shape of the same mistake: the message
 * DOES ask for work, but on an app the workspace provably does not hold. The honest reply is one
 * message: your project is not here yet — here is how to bring it in (GitHub import or a .zip), and
 * here is where the APK is made once it is here.
 *
 * WHEN IT FIRES — all three, and each is a separate fact:
 *   1. the message CLAIMS an app that already exists ("already developed", "my existing app", "pehle
 *      se bani hui");
 *   2. it places that app ELSEWHERE (a named tool or host: Replit, Lovable, GitHub …) OR forbids
 *      rebuilding it ("do not rebuild it from scratch") — without one of these, "I already built the
 *      backend" is a sentence about context, not a claim that the work target is missing;
 *   3. the workspace holds NO user code (the caller's `userAppExists`, which already treats our own
 *      seeded scaffold as not the user's, and treats an unreadable listing as "yes" — fail-safe).
 *   And nothing is being imported on this turn (a zip, an import URL, or any attachment).
 *
 * ⚠️ PRECISION-FIRST, and the asymmetry is the justification — the same one the mood rule states.
 * Wrong toward the answer costs one message, and the reply itself offers to build something new here.
 * Wrong toward the build cost this user four minutes, a bill, and a false "your app is built".
 *
 * PURE — string tests only. No I/O, no clock, no model.
 */

/** A claim that the app already exists somewhere. */
const CLAIMS_EXISTING: readonly RegExp[] = [
  /\balready\s+(?:been\s+)?(?:fully\s+)?(?:developed|built|created|made|coded|written|live|deployed)\b/i,
  /\b(?:is|was|has\s+been)\s+(?:already\s+)?(?:fully\s+)?(?:developed|built|coded)\s+(?:in|on|with|using)\b/i,
  // "one existing website" / "an existing app" / "meri existing site" are the same claim as "my existing
  // app" (autopsy dcce5d26: "convert one existing website into an online APK" slipped past `my|our|the|this`).
  /\b(?:my|our|the|this|one|an?|mera|meri|mere|apni|apna|apne|hamari|hamara|hamare)\s+existing\s+(?:[a-z-]+\s+){0,2}(?:app|application|project|codebase|code|website|site|repo|repository)\b/i,
  /\b(?:pehle|pahle)\s*se\s+(?:hi\s+)?(?:ban[aie]|bani|bana|develop)/i,
  /\b(?:bani|bana|banayi|banaya)\s+hu[ia]\b/i,
];

/**
 * Where an app is built or kept that is NOT this workspace. The name is surfaced in the reply so the
 * user is answered about THEIR tool, never a generic "somewhere else". These are the user's own tools,
 * not the AI vendors the White-Label Law hides.
 */
const ELSEWHERE_HOSTS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Replit', re: /\breplit\b/i },
  { name: 'Lovable', re: /\blovable\b/i },
  { name: 'Bolt', re: /\bbolt(?:\.new)?\b/i },
  { name: 'v0', re: /\bv0(?![.\d])\b/i },
  { name: 'Cursor', re: /\bcursor\s+(?:project|app|ide|editor)\b/i },
  { name: 'GitHub', re: /\bgithub\b/i },
  { name: 'GitLab', re: /\bgitlab\b/i },
  { name: 'Bitbucket', re: /\bbitbucket\b/i },
  { name: 'CodeSandbox', re: /\bcodesandbox\b/i },
  { name: 'StackBlitz', re: /\bstackblitz\b/i },
  { name: 'Glitch', re: /\bglitch\b/i },
  { name: 'FlutterFlow', re: /\bflutterflow\b/i },
  { name: 'Firebase Studio', re: /\bfirebase\s+studio\b/i },
  { name: 'Android Studio', re: /\bandroid\s+studio\b/i },
  { name: 'Expo Snack', re: /\bexpo\s+snack\b/i },
];

/** An explicit instruction not to rebuild — only meaningful about an app that already exists. */
const FORBIDS_REBUILD: readonly RegExp[] = [
  /\b(?:do\s+not|don'?t|dont|never|must\s+not|should\s+not)\s+(?:re-?build|re-?create|re-?write|re-?make|start\s+(?:over|again|from\s+scratch)|build\s+(?:it\s+|the\s+app\s+)?(?:again|from\s+scratch))/i,
  /\b(?:dobara|dubara|phir\s+se|fir\s+se|scratch\s+se)\s+(?:\w+\s+){0,2}(?:mat|na|nahi)\b/i,
];

/**
 * App stacks NavBharatAI does not build. Named in the reply so the user is told the truth about the
 * phone build rather than discovering it after an import: it packages WEB apps.
 */
const NATIVE_STACKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Expo / React Native', re: /\bexpo\b|\breact[\s-]?native\b/i },
  { name: 'Flutter', re: /\bflutter(?:flow)?\b/i },
  { name: 'native Android (Kotlin/Java)', re: /\bkotlin\b|\bandroid\s+studio\b|\bjetpack\s+compose\b/i },
  { name: 'native iOS (Swift)', re: /\bswift(?:ui)?\b|\bxcode\b/i },
];

/**
 * 🔴 TURNING SOMETHING THE USER ALREADY HAS INTO A PHONE APP (autopsy dcce5d26, 2026-10-04).
 *
 * *"I want to convert one existing website into an online APK but not publically."* names no host and
 * forbids no rebuild, so the two qualifiers above did not fire, and the turn became a build: the fast
 * lane planned a generic wrapper for a website nobody had named, and the user stopped it at 20 s.
 * A CONVERSION is the third way of saying "the thing to work on is elsewhere": nothing is to be made,
 * the user's own site is to be packaged. It counts only when the thing converted is THEIRS (existing,
 * possessive, "this", or a link/domain), and never when the message asks for a converter to be built.
 */
const PHONE_TARGET = '(?:apk|aab|ipa|android\\s+app|mobile\\s+app|phone\\s+app|app)';
const WEB_OBJECT = '(?:website|web\\s?site|site|web\\s?app|webapp|web\\s?page|url|link|portal|blog|app|application|[a-z0-9-]+\\.(?:com|in|org|net|io|app|co|dev|site|xyz|online|store|shop|info|biz))';
const CONVERTS_TO_PHONE_APP: readonly RegExp[] = [
  // convert / turn / wrap / package … website … into (an online) APK
  new RegExp(`\\b(?:convert|turn|wrap|package|transform|change)\\w*\\b[^.?!\\n]{0,60}?\\b${WEB_OBJECT}\\b[^.?!\\n]{0,40}?\\b(?:into|to|in|as)\\s+(?:an?\\s+|the\\s+)?(?:[a-z-]+\\s+){0,2}${PHONE_TARGET}\\b(?!\\s*store)`, 'i'),
  // (make) an APK of / from my website
  /\b(?:apk|aab|ipa)\s+(?:of|from|for)\s+(?:[a-z-]+\s+){0,3}(?:website|web\s?site|site|web\s?app|webapp|url|link|portal|blog)\b/i,
  /\b(?:android|mobile|phone)\s+app\s+(?:of|from)\s+(?:[a-z-]+\s+){0,3}(?:website|web\s?site|site|web\s?app|webapp|url|link|portal|blog)\b/i,
  // Hinglish: website ka APK / site ko app me (convert)
  new RegExp(`\\b(?:website|web\\s?site|site|web\\s?app|webapp|url|link)\\s+(?:ka|ki|ke|ko)\\s+(?:[a-z]+\\s+){0,2}${PHONE_TARGET}\\b(?!\\s*store)(?!\\s+(?:jaisa|jaisi|jaise|like|style|wala|wali))`, 'i'),
];
/** The thing being converted is the user's own: theirs, existing, "this", or a link to it. */
const OWNED_OBJECT = /\b(?:my|our|mera|meri|mere|apni|apna|apne|hamari|hamara|hamare|this|yeh|ye|existing|own)\b|\bis\s+(?:website|site|app|link)\b|\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:com|in|org|net|io|app|co|dev|site|xyz|online|store|shop|info|biz)\b/i;
/** A request to BUILD a converter is software to make, not a site to package. */
const BUILDS_A_CONVERTER = /\b(?:converter|convertor|generator|maker|builder|tool|platform|service|software|saas)\b|\b(?:that|which|jo)\s+(?:converts?|turns?|wraps?)\b/i;
/** The thing being converted is a WEBSITE (a live link), not an app project. */
const WEBSITE_OBJECT = /\b(?:website|web\s?site|site|web\s?page|url|link|portal|blog)\b|\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:com|in|org|net|io|co|dev|site|xyz|online|store|shop|info|biz)\b/i;
/** "not publicly" / private / without the Play Store — the user wants an installable file, not a listing. */
const WANTS_PRIVATE = /\bnot\s+public(?:al)?ly\b|\bnon[-\s]?public\b|\bprivate(?:ly)?\b|\bwithout\s+(?:the\s+)?play\s*store\b|\bnot\s+on\s+(?:the\s+)?play\s*store\b|\bpersonal\s+use\b|\bsirf\s+(?:mere|apne)\s+liye\b/i;

/** Did the message ask for an app file (APK/AAB/IPA) — so the reply should point at the phone build? */
const WANTS_PHONE_BUILD = /\b(?:apk|aab|ipa|play\s*store|app\s*store|testflight|android\s+app|phone\s+app|mobile\s+app|install(?:able)?\s+on\s+(?:a\s+)?(?:physical\s+)?(?:android\s+)?phone)\b/i;

export interface ProjectElsewhere {
  /** The message claims an app that already exists. */
  claimsExisting: boolean;
  /** The named tool/host it lives in, or null when none is named. */
  host: string | null;
  /** The message forbids rebuilding it. */
  forbidsRebuild: boolean;
  /** A stack NavBharatAI does not build (named for honesty), or null. */
  nativeStack: string | null;
  /** The message asks for an APK/AAB/IPA or a phone app. */
  wantsPhoneBuild: boolean;
  /** The message asks to turn the user's OWN site or app into a phone app (APK / AAB / IPA). */
  convertsToPhoneApp: boolean;
  /** The thing named is a website or a link, not an app project — its code may not be in hand. */
  website: boolean;
  /** "not publicly" / private / without the Play Store. */
  wantsPrivate: boolean;
  /**
   * Claims + (elsewhere or forbids rebuild), OR a conversion of the user's own site into a phone app —
   * the message is about something that lives somewhere else.
   */
  refersToAppElsewhere: boolean;
}

/** Read what the message says about an existing app. PURE. */
export function readProjectElsewhere(prompt: string): ProjectElsewhere {
  const text = String(prompt ?? '').replace(/[‘’ʼ´`]/g, "'");
  const claimsExisting = CLAIMS_EXISTING.some((re) => re.test(text));
  const host = ELSEWHERE_HOSTS.find((h) => h.re.test(text))?.name ?? null;
  const forbidsRebuild = FORBIDS_REBUILD.some((re) => re.test(text));
  const nativeStack = NATIVE_STACKS.find((s) => s.re.test(text))?.name ?? null;
  const wantsPhoneBuild = WANTS_PHONE_BUILD.test(text);
  const convertsToPhoneApp = CONVERTS_TO_PHONE_APP.some((re) => re.test(text))
    && (claimsExisting || OWNED_OBJECT.test(text))
    && !BUILDS_A_CONVERTER.test(text);
  return {
    claimsExisting,
    host,
    forbidsRebuild,
    nativeStack,
    wantsPhoneBuild,
    convertsToPhoneApp,
    website: WEBSITE_OBJECT.test(text),
    wantsPrivate: WANTS_PRIVATE.test(text),
    refersToAppElsewhere: (claimsExisting && (host !== null || forbidsRebuild)) || convertsToPhoneApp,
  };
}

/**
 * Should this turn be ANSWERED rather than built? PURE.
 *
 * `userAppExists` is the route's existing, fail-safe signal (seeded scaffold ⇒ false, unreadable
 * listing ⇒ true). `importing` covers every way a project can arrive on this turn — a zip, an import
 * URL, or any other attachment — so an import is never intercepted.
 */
export function shouldAnswerProjectElsewhere(input: {
  prompt: string;
  userAppExists: boolean;
  importing: boolean;
}): boolean {
  if (input.userAppExists || input.importing) return false;
  return readProjectElsewhere(input.prompt).refersToAppElsewhere;
}

/** The two ways a project enters NavBharatAI Pro, named exactly as the screens name them. */
const IMPORT_PATHS =
  'GitHub: tap the gear "Build options" (⚙) button next to the chat box → "Import Repo" → pick the repository. '
  + '.zip: tap the 📎 attach button in the chat box → "Import project (.zip)" → pick the file.';

const PHONE_BUILD_PATH = 'More (bottom bar) → Profile Settings → "Download APK" (the APK Builder)';

/**
 * The steer handed to the chat reply. It carries the facts; the reply's LANGUAGE follows the user
 * (LANGUAGE_RULE), which is why this is a steer and not a canned message.
 */
export function projectElsewhereSteer(v: ProjectElsewhere): string {
  const where = v.host ? `in ${v.host}` : 'somewhere outside NavBharatAI';
  const lines = [
    '',
    '',
    `IMPORTANT — the user is asking you to work on an app that already exists ${where}. This NavBharatAI `
      + 'project does NOT contain that app: it holds no code of theirs, only an empty starter page. Do NOT '
      + 'pretend to inspect, configure, test or build their app, do NOT invent file names, versions, '
      + 'settings or results, and do NOT start building a new app. Reply briefly and warmly:',
    `1. Say plainly that their app is not in this NavBharatAI project yet, so there is nothing here to ${v.wantsPhoneBuild ? 'package' : 'work on'} until it is brought in.`,
    `2. Tell them how to bring it in — exactly these two ways: ${IMPORT_PATHS} `
      + (v.host && v.host !== 'GitHub'
        ? `If it lives in ${v.host}, the usual route is to push it from ${v.host} to a GitHub repository (or download it as a .zip) and import that.`
        : ''),
  ];
  if (v.wantsPhoneBuild) {
    lines.push(`3. Once it is here, the installable Android app is made from ${PHONE_BUILD_PATH}; it builds the APK for them — no Android Studio needed.`);
  }
  if (v.convertsToPhoneApp && v.website) {
    lines.push(
      '- Be honest about one limit: NavBharatAI cannot turn a live website LINK into an app by itself today. '
        + 'It packages a web app whose CODE is in this project. If they have the website\'s code, bring it in as '
        + 'above. If they only have the link, offer to build the same website here (they can describe it, or '
        + 'send screenshots), which the APK Builder can then package. Do not ask for the link as if pasting it '
        + 'would be enough.',
    );
  }
  if (v.wantsPrivate) {
    lines.push('- They want it private: the APK Builder gives them an .apk file to install directly on a phone. It is not published on the Play Store or anywhere else unless they upload it themselves.');
  }
  if (v.nativeStack) {
    lines.push(
      `${v.wantsPhoneBuild ? '4' : '3'}. Be honest about one limit: their app is ${v.nativeStack}. NavBharatAI builds WEB apps and turns `
        + 'them into phone apps; it cannot package a ' + v.nativeStack + ' project as it is. They can build '
        + 'that project\'s APK with the tool it was made with, or ask NavBharatAI to build a web version of the '
        + 'same app here, which the APK Builder can then package.',
    );
  }
  lines.push('End by offering, in one short line, to build something new here instead if that is what they want.');
  return lines.join('\n');
}

/**
 * The reply when the chat engine cannot be reached. A build is exactly the wrong fallback for this
 * turn — it is the outcome this module exists to prevent — so a failed reply falls back to these
 * words, never to the build path.
 */
export function projectElsewhereFallback(v: ProjectElsewhere): string {
  const where = v.host ? ` in ${v.host}` : '';
  const parts = [
    `Your app${where} is not in this NavBharatAI project yet, so there is nothing here to ${v.wantsPhoneBuild ? 'package' : 'work on'}.`,
    `To bring it in: ${IMPORT_PATHS}`,
  ];
  if (v.wantsPhoneBuild) parts.push(`Once it is here, the installable app is made from ${PHONE_BUILD_PATH}.`);
  if (v.convertsToPhoneApp && v.website) {
    parts.push('NavBharatAI cannot turn a live website link into an app by itself yet — it packages a web app whose code is in this project. If you only have the link, I can build the same website here for you, and then make the APK from it.');
  }
  if (v.wantsPrivate) parts.push('The APK is a file you install directly on a phone. It is not published on the Play Store or anywhere else unless you upload it yourself.');
  if (v.nativeStack) {
    parts.push(`One honest limit: NavBharatAI builds web apps and turns them into phone apps, so a ${v.nativeStack} project cannot be packaged here as it is — I can build a web version of it for you instead.`);
  }
  parts.push('Or, if you would like me to build something new here, just tell me what.');
  return parts.join('\n\n');
}
