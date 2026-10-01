// AgentV3 — WHAT A PHONE REQUEST GETS: the web app, the phone app, or nothing — and saying which.
//
// 🔴 WHY (autopsy 6bae5835, 2026-09-27). The prompt was "an AI assistant named Jarwis that manages
// everything on my phone, whatever I say, and works well on the lock screen too". The build was clean
// (rendered, typechecked, a real journey passed), and its summary offered a "lock-screen-like welcome
// screen" — and never said what an app built here can and cannot do on a phone. The user was left to
// find that out on their own phone, after paying for the build.
//
// It is the SIBLING of autopsy f15a9bcc (NO_INVENTED_PEOPLE_RULE, "nearby shops over Bluetooth"),
// which fixed ONE instance of the class — a platform power the model cannot deliver, papered over with
// a look-alike. The class has two halves, and the admin asked for both (2026-09-27: "user ko saaf
// bataya jaye ki webapp me kaam nahi karega, github connect kar ke apk banana hoga"):
//   • what the PHONE APP can do and the web preview cannot — `nativeCapabilities.ts`, the one table;
//   • what NO app built here can do — the four powers below, detected from the user's own words.
// The user's summary is built from both (`deviceSummaryNotice`), so the prompt rule, the builder's
// brief and the summary can never disagree about what is possible.
//
// ⚠️ PRECISION-FIRST, the same asymmetry the safety triage uses. A missed request costs one sentence the
// model may well have written itself; a false one tells a shopkeeper that their "mobile shop" app
// cannot be built. So each power needs the request to point at the DEVICE, and an app that merely has
// a screen called "lock screen" (a notes app with a PIN) is not one — that is an ordinary feature.
// Opening an app, calling, SMS and the torch are NOT here: the phone app does them (app-launcher, flash).
//
// PURE — no I/O.

import {
  IMPOSSIBLE_POWERS, capabilitiesInPackageJson, nativeCapabilityNotice, type ImpossiblePower,
} from './nativeCapabilities';

export type DevicePower = ImpossiblePower['id'];

// Words that turn "manage my mobile …" into a BUSINESS or a SCREEN SIZE, not the device.
const NOT_THE_DEVICE = String.raw`(?!\s*(?:shop|store|repair|business|dukaan|dukan|number|recharge|inventory|stock|accessor|showroom|center|centre|service|app|version|view|layout|site|website|friendly|screen|ui|design|contacts|bills?|orders|sales|expenses|game))`;

const PATTERNS: Readonly<Record<DevicePower, readonly RegExp[]>> = {
  'lock-screen': [
    // "on the lock screen", "from my lock screen", "over the lockscreen"
    /\b(?:on|over|from)\s+(?:the\s+|my\s+|phone'?s?\s+|a\s+)?lock[\s-]?screen\b/i,
    // Hinglish: "lock screen par/pe/pr/me bhi"
    /\block[\s-]?screen\s+(?:par|pe|pr|per|me|mein|mai|mei)\b/i,
    // "even when the phone is locked", "phone lock ho tab bhi"
    /\bwhen\s+(?:the\s+|my\s+)?(?:phone|mobile|screen)\s+is\s+locked\b/i,
    /\b(?:phone|mobile|screen)\s+lock\s+(?:ho|hone|rahe|rehne)\b/i,
  ],
  'control-other-apps': [
    // "control my phone", "manage my whole mobile" — never "manage my mobile shop"
    new RegExp(String.raw`\b(?:control|manage|operate)\s+(?:my\s+|the\s+|whole\s+|entire\s+|all\s+of\s+my\s+)*(?:phone|mobile|smartphone)\b${NOT_THE_DEVICE}`, 'i'),
    // "phone me har chij ko manage", "mobile ki sabhi cheezein" — the whole device, in Hinglish
    /\b(?:phone|mobile)\s+(?:me|mein|mai|mei|ki|ke|ka)\s+(?:har|hr|sab|sabhi|saari|sari|saare|sare)\s+(?:chij|chiz|cheez|chijo|chizo|cheezon|cheeze|cheezein|chije|apps?)\b/i,
    // "phone ko control karo" — the `ko` is what makes the phone the object
    /\b(?:phone|mobile)\s+ko\s+(?:control|manage|operate)\b/i,
    // Controlling INSIDE other apps — opening one is possible and is deliberately not matched here.
    /\b(?:control|operate)\s+(?:my\s+|the\s+)?other\s+apps\b/i,
    /\b(?:turn|switch)\s+(?:on|off)\s+(?:my\s+|the\s+)?(?:phone'?s?\s+)?(?:wi-?fi|bluetooth|mobile\s+data|hotspot)\b/i,
  ],
  'read-private-phone-data': [
    /\bread\s+(?:my\s+|all\s+(?:my\s+)?|the\s+|incoming\s+)?(?:sms|call\s+logs?|call\s+history)\b/i,
    /\b(?:sms|call\s+log|call\s+history)\s+(?:padh|padhe|padhna|padho)\b/i,
    /\b(?:other\s+apps'?|phone'?s)\s+notifications\b/i,
  ],
  'listen-while-closed': [
    /\b(?:listen|hear|wake|voice|sun)\w*\b[^.]{0,60}\b(?:app\s+is\s+closed|app\s+band|in\s+the\s+background|background\s+(?:me|mein)|screen\s+(?:is\s+)?off)\b/i,
    /\b(?:app\s+is\s+closed|app\s+band\s+\w+|in\s+the\s+background|background\s+(?:me|mein))\b[^.]{0,60}\b(?:listen|hear|wake\s+word|sun(?:e|na|ta|ti))\w*\b/i,
  ],
};

/**
 * The impossible powers the prompt asks for, in the registry's order. [] for every ordinary app.
 *
 * Only the user's own words are read, never the model's; a plan that mentions a lock screen is the
 * model's idea, not the user's request.
 */
export function requestedImpossiblePowers(prompt: string | null | undefined): ImpossiblePower[] {
  const text = typeof prompt === 'string' ? prompt : '';
  if (!text.trim()) return [];
  return IMPOSSIBLE_POWERS.filter((p) => PATTERNS[p.id].some((re) => re.test(text)));
}

// The summary already told the user the limit, in its own words — do not say that half twice.
const ALREADY_SAID = /\b(?:native|system\s+permission|browser\s+(?:can(?:no|')t|does\s+not|doesn't)|web\s+app\s+(?:can(?:no|')t|does\s+not|doesn't)|not\s+possible|possible\s+nahi|nahi\s+ho\s+sakta|nahi\s+kar\s+sakta)\b/i;
// …and the phone-app half: it already told them how to get the phone app.
const ALREADY_SAID_HOW = /download\s+apk/i;

/**
 * The lines appended to a successful build's summary: what needs the phone app (read from what the
 * build ACTUALLY installed, never guessed) and how to get it, then what no app can do. '' for an
 * ordinary build, so it reads exactly as it does today. Each half stands down when the model's own
 * summary already said it.
 */
export function deviceSummaryNotice(i: {
  prompt: string | null | undefined;
  summary: string | null | undefined;
  packageJson: string | null | undefined;
}): string {
  const summary = typeof i.summary === 'string' ? i.summary : '';
  const used = ALREADY_SAID_HOW.test(summary) ? [] : capabilitiesInPackageJson(i.packageJson);
  const impossible = ALREADY_SAID.test(summary) ? [] : requestedImpossiblePowers(i.prompt);
  const notice = nativeCapabilityNotice(used, impossible);
  // 🔴 AUTOPSY dfd24058 (2026-10-01): the request ended "… mobile-first and a single page. apk". The app
  // used no phone plugin, so the line above was empty — and the summary never mentioned the APK at all,
  // while it told the user to "open dist/index.html in any browser". An APK the user ASKED for gets its
  // one sentence, unless something already said how to get it.
  if (!ALREADY_SAID_HOW.test(summary) && !/download\s+apk/i.test(notice) && phoneBuildAsked(i.prompt)) {
    return `${notice}\n\n📱 **Your Android app (APK):** open **More → Download APK**, connect your GitHub, and NavBharatAI builds the installable APK of this app for you — no Android Studio needed.`;
  }
  return notice;
}

/**
 * Does the user's own message ask for the installable phone app? Precision-first: a bare `apk`/`aab`, or a
 * phone-app noun with a get/make verb — never "a mobile-friendly site" or "mobile-first". PURE.
 */
export function phoneBuildAsked(prompt: string | null | undefined): boolean {
  const t = typeof prompt === 'string' ? prompt : '';
  if (/\b(?:apk|aab)\b|\.apk\b|\bplay\s*store\b/i.test(t)) return true;
  return /\b(?:android|phone|mobile)\s+(?:app|application)\b[^.\n]{0,40}\b(?:install|download|banao|bana\s+do|chahiye)\b|\b(?:install|download)\b[^.\n]{0,30}\bon\s+(?:my\s+|a\s+)?(?:android|phone|mobile)\b/i.test(t);
}

/** The admin-report line, or null when the build touched neither half. Names ids only; no user text. */
export function deviceSummaryRecord(i: { prompt: string | null | undefined; packageJson: string | null | undefined; noticeAdded: boolean }):
  { code: 'DEVICE_CAPABILITIES_TOLD'; message: string } | null {
  const phone = capabilitiesInPackageJson(i.packageJson).filter((c) => c.web !== 'works').map((c) => c.id);
  const impossible = requestedImpossiblePowers(i.prompt).map((p) => p.id);
  if (!phone.length && !impossible.length) return null;
  return {
    code: 'DEVICE_CAPABILITIES_TOLD',
    message: `Phone-app features used: ${phone.join(', ') || 'none'}; impossible powers asked for: ${impossible.join(', ') || 'none'} — `
      + (i.noticeAdded ? 'the user was told in the summary.' : 'the model’s own summary already said it.'),
  };
}

/**
 * THE PROMPT RULE (upstream half). Always on, in the stable system prompt, beside
 * NO_INVENTED_PEOPLE_RULE — the instance it generalises. Kept short: the per-build brief
 * (`nativeCapabilityBrief`) carries the exact plugins, and only when the request asks for them.
 */
export const DEVICE_POWERS_RULE =
  'PHONE FEATURES — REAL, NEVER IMITATED: an app built here is a web app that NavBharatAI can also ' +
  'turn into a real phone app (More → Download APK). When a request needs a phone feature, build it ' +
  'with the exact plugin you are given for it, make the web preview show a clear "works in the phone ' +
  'app" note instead of a dead button, and say plainly in your summary, in the user\'s language, which ' +
  'features need the phone app and that they get it from More → Download APK after connecting GitHub. ' +
  'Four things NO app built here can do, in the web app or the phone app: work on the lock screen; ' +
  'read SMS, call history or other apps\' notifications; control other apps or change the phone\'s ' +
  'settings (Wi-Fi, Bluetooth, mobile data); listen for the user\'s voice while the app is closed. ' +
  'Never imitate one with a look-alike screen, never promise it, and say so plainly.';
