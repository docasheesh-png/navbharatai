// AgentV3 — POWERS A WEB APP DOES NOT HAVE, and saying so instead of imitating them.
//
// 🔴 WHY (autopsy 6bae5835, 2026-09-27). The prompt was "an AI assistant named Jarwis that manages
// everything on my phone, whatever I say, and works well on the lock screen too". The build was clean
// (rendered, typechecked, a real journey passed), and its summary offered a "lock-screen-like welcome
// screen" — and never said that an app built here runs inside a browser tab, so it cannot sit on the
// lock screen, cannot open or control other apps, and cannot change the phone's settings. The user
// was left to find that out on their own phone, after paying for the build.
//
// It is the SIBLING of autopsy f15a9bcc (NO_INVENTED_PEOPLE_RULE, "nearby shops over Bluetooth"),
// which fixed ONE instance of the class — a platform power the model cannot deliver, papered over with
// a look-alike — and left the rest of the class open. This module is the class: the device and OS
// powers a web app does not have, named once, read by the prompt rule AND by the summary check, so the
// two can never disagree about what is and is not possible.
//
// ⚠️ PRECISION-FIRST, the same asymmetry the safety triage uses. A missed request costs one sentence the
// model may well have written itself; a false one tells a shopkeeper that their "mobile shop" app
// cannot be built. So each power needs the request to point at the DEVICE, and an app that merely has
// a screen called "lock screen" (a notes app with a PIN) is not one — that is an ordinary feature.
//
// PURE — no I/O.

export type DevicePower = 'lock-screen' | 'control-phone' | 'read-private-phone-data' | 'listen-while-closed';

interface PowerRule {
  id: DevicePower;
  /** How the user-facing sentence names it. */
  label: string;
  patterns: RegExp[];
}

// Words that turn "manage my mobile …" into a BUSINESS or a SCREEN SIZE, not the device.
const NOT_THE_DEVICE = String.raw`(?!\s*(?:shop|store|repair|business|dukaan|dukan|number|recharge|inventory|stock|accessor|showroom|center|centre|service|app|version|view|layout|site|website|friendly|screen|ui|design|contacts|bills?|orders|sales|expenses|game))`;

const RULES: readonly PowerRule[] = [
  {
    id: 'lock-screen',
    label: 'working on the phone’s lock screen',
    patterns: [
      // "on the lock screen", "from my lock screen", "over the lockscreen"
      /\b(?:on|over|from)\s+(?:the\s+|my\s+|phone'?s?\s+|a\s+)?lock[\s-]?screen\b/i,
      // Hinglish: "lock screen par/pe/pr/me bhi"
      /\block[\s-]?screen\s+(?:par|pe|pr|per|me|mein|mai|mei)\b/i,
      // "even when the phone is locked", "phone lock ho tab bhi"
      /\bwhen\s+(?:the\s+|my\s+)?(?:phone|mobile|screen)\s+is\s+locked\b/i,
      /\b(?:phone|mobile|screen)\s+lock\s+(?:ho|hone|rahe|rehne)\b/i,
    ],
  },
  {
    id: 'control-phone',
    label: 'controlling the phone itself (other apps, calls, settings)',
    patterns: [
      // "control my phone", "manage my whole mobile" — never "manage my mobile shop"
      new RegExp(String.raw`\b(?:control|manage|operate)\s+(?:my\s+|the\s+|whole\s+|entire\s+|all\s+of\s+my\s+)*(?:phone|mobile|smartphone)\b${NOT_THE_DEVICE}`, 'i'),
      // "phone me har chij ko manage", "mobile ki sabhi cheezein" — the whole device, in Hinglish
      /\b(?:phone|mobile)\s+(?:me|mein|mai|mei|ki|ke|ka)\s+(?:har|hr|sab|sabhi|saari|sari|saare|sare)\s+(?:chij|chiz|cheez|chijo|chizo|cheezon|cheeze|cheezein|chije|apps?)\b/i,
      // "phone ko control karo" — the `ko` is what makes the phone the object
      /\b(?:phone|mobile)\s+ko\s+(?:control|manage|operate)\b/i,
      /\b(?:control|open|close|operate)\s+(?:my\s+|the\s+)?other\s+apps\b/i,
      /\b(?:turn|switch)\s+(?:on|off)\s+(?:my\s+|the\s+)?(?:phone'?s?\s+)?(?:wi-?fi|bluetooth|flashlight|torch|mobile\s+data|hotspot)\b/i,
    ],
  },
  {
    id: 'read-private-phone-data',
    label: 'reading the phone’s SMS, call history or other apps’ notifications',
    patterns: [
      /\bread\s+(?:my\s+|all\s+(?:my\s+)?|the\s+|incoming\s+)?(?:sms|call\s+logs?|call\s+history)\b/i,
      /\b(?:sms|call\s+log|call\s+history)\s+(?:padh|padhe|padhna|padho)\b/i,
      /\b(?:other\s+apps'?|phone'?s)\s+notifications\b/i,
    ],
  },
  {
    id: 'listen-while-closed',
    label: 'listening for your voice while the app is closed',
    patterns: [
      /\b(?:listen|hear|wake|voice|sun)\w*\b[^.]{0,60}\b(?:app\s+is\s+closed|app\s+band|in\s+the\s+background|background\s+(?:me|mein)|screen\s+(?:is\s+)?off)\b/i,
      /\b(?:app\s+is\s+closed|app\s+band\s+\w+|in\s+the\s+background|background\s+(?:me|mein))\b[^.]{0,60}\b(?:listen|hear|wake\s+word|sun(?:e|na|ta|ti))\w*\b/i,
    ],
  },
];

/**
 * The device powers the prompt asks for, in a stable order. [] when none — which is every ordinary app.
 *
 * Only the user's own words are read, never the model's; a plan that mentions a lock screen is the
 * model's idea, not the user's request.
 */
export function requestedDevicePowers(prompt: string | null | undefined): DevicePower[] {
  const text = typeof prompt === 'string' ? prompt : '';
  if (!text.trim()) return [];
  return RULES.filter((r) => r.patterns.some((p) => p.test(text))).map((r) => r.id);
}

// The summary already told the user, in its own words — do not say it twice.
const ALREADY_SAID = /\b(?:native|android\s+app|system\s+permission|browser\s+(?:can(?:no|')t|does\s+not|doesn't)|web\s+app\s+(?:can(?:no|')t|does\s+not|doesn't)|not\s+possible|possible\s+nahi|nahi\s+ho\s+sakta|nahi\s+kar\s+sakta)\b/i;

/**
 * The line appended to a successful build's summary. '' when nothing was asked for, or when the model
 * already said it — so an ordinary build reads exactly as it does today.
 *
 * Written the way `missingFeatureNotice` is: it names what, says what works, and never promises a
 * path the platform does not have. ⚠️ It must NOT offer the phone-app build as the answer: packaging
 * the same app for Android does not give it lock-screen or system-control powers, and saying it would
 * is the fake promise the second absolute rule forbids.
 */
export function devicePowerNotice(prompt: string | null | undefined, summary: string | null | undefined): string {
  const asked = requestedDevicePowers(prompt);
  if (!asked.length) return '';
  if (ALREADY_SAID.test(typeof summary === 'string' ? summary : '')) return '';
  const labels = RULES.filter((r) => asked.includes(r.id)).map((r) => r.label);
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return (
    `\n\nℹ️ One honest note: this app runs in the browser, so it works while it is open. `
    + `**${list[0].toUpperCase()}${list.slice(1)}** needs a native phone app with special system permissions, `
    + `which an app built here does not get — installing it on your phone does not change that. `
    + `Everything else you asked for is built and works inside the app.`
  );
}

/** The admin-report line. Names the powers by id; no user text. */
export function devicePowerRecord(prompt: string | null | undefined): { code: 'DEVICE_POWER_NOT_POSSIBLE'; message: string } | null {
  const asked = requestedDevicePowers(prompt);
  if (!asked.length) return null;
  return {
    code: 'DEVICE_POWER_NOT_POSSIBLE',
    message: `The request asks for device power(s) a web app does not have (${asked.join(', ')}) — the user was told so in the summary unless the model already said it.`,
  };
}

/**
 * THE PROMPT RULE (upstream half). Always on, in the stable system prompt, beside
 * NO_INVENTED_PEOPLE_RULE — the instance it generalises.
 */
export const DEVICE_POWERS_RULE =
  'DEVICE POWERS A WEB APP DOES NOT HAVE: the app you build runs in a browser tab. It cannot appear on ' +
  'the phone\'s lock screen, open or control other apps, make calls or send SMS by itself, change ' +
  'phone settings (Wi-Fi, Bluetooth, torch), read the phone\'s SMS, call history or other apps\' ' +
  'notifications, or listen for the user\'s voice while it is closed. When the user asks for one of ' +
  'these, build everything that DOES work inside the app, never imitate the missing power with a ' +
  'look-alike screen presented as the real thing, and say plainly in your summary, in the user\'s ' +
  'language, which part needs a native phone app with special system permissions. Do not claim that ' +
  'installing or packaging the app for a phone adds those powers — it does not.';
