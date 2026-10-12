// A PHONE THE APP CANNOT RUN ON IS SAID SO — AND WHAT IS BUILT FITS THE KEYS (Q-846, build 46e2d74b; admin
// 2026-10-12: option a, "sabhi ke liye han hai").
//
// 🔴 The request was a racing game "for Nokia C2-01": a 2011 keypad phone with no touch screen, no WebGL and
// no modern browser. It got a 3D touch game, and nothing told the user that no web app can run on that phone.
// No device-feasibility handling existed at all (zero hits for nokia / feature phone / kaios).
//
// THE CLASS: a device the user named, silently ignored. Now:
//   • the user is told plainly, in the summary, that a web app cannot run on that phone;
//   • what is built fits the keys: a light 2D build (the game kit lays down its 2D layers, never three.js),
//     every action on the arrow AND number keys, nothing that needs touch, readable on a small screen.
//
// ⚠️ PRECISION-FIRST. A false match tells someone their Android "Nokia G42" cannot run the app, so only named
// keypad models and unmistakable phrases count: the hyphenated S40 C-series (C2-01, C3-00 — the modern Android
// C12/C32 have no hyphen), the classic keypad numbers, Asha, "feature/keypad/button phone", KaiOS, JioPhone.
// PURE — no I/O.

/** Named Nokia keypad models: the hyphenated S40 C-series, Asha, and the classic numbers. */
const NOKIA_KEYPAD = /\bnokia\s*(?:c\d-\d{2}\b|asha\b|(?:105|106|110|130|150|215|220|225|2660|2720|3310|5310|6300|8000|8110)\b)/i;
/** The phrases that name the KIND of phone, in English and Hinglish. Only the two that cannot mean an ordinary app:
 *  \"basic phone\" and \"button phone\" were here and matched \"basic phone book app\", \"basic phone directory\" and \"big
 *  button phone dialer\" (found reviewing #3678, 2026-10-12) — each would have told a smartphone user their app cannot run.
 *  THE CLASS: a device word that is also an app word. A phrase joins this list only when it names a device and nothing else. */
const KEYPAD_PHRASE = /\b(?:feature|keypad)\s*-?\s*phones?\b|\bkai\s*-?\s*os\b|\bjio\s*-?\s*phone\b/i;

/** The phone the user named that a web app cannot run on, or null. PURE. */
export function namedNonSmartphone(prompt: string | null | undefined): { device: string } | null {
  const text = String(prompt ?? '');
  if (!text.trim()) return null;
  const m = NOKIA_KEYPAD.exec(text) ?? KEYPAD_PHRASE.exec(text);
  if (!m) return null;
  return { device: m[0].replace(/\s+/g, ' ').trim() };
}

/** What the builder is told before it writes a line (prepended to the build prompt). PURE. */
export function nonSmartphoneBuildRule(device: string): string {
  return `DEVICE TARGET — "${device}" is a keypad phone: no touch screen, no WebGL, no modern browser. A web app `
    + 'cannot run on it, and the user will be told so. Build what serves them anywhere else instead, shaped for keys: '
    + 'a LIGHT 2D build (canvas 2D or plain HTML — never three.js or WebGL), every action on the arrow keys AND the '
    + 'number keys (2 up, 4 left, 6 right, 8 down, 5 select), no control that only works by touch, large readable '
    + 'text that still fits a 240×320 screen, and as few assets as possible.';
}

/** The one sentence the user gets in their summary. Plain, and names what WAS built. PURE. */
export function nonSmartphoneUserLine(device: string): string {
  return `\n\n📵 **About ${device}:** it is a keypad phone without a modern web browser, so no web app — this one `
    + 'included — can run on it. I built a light version that works with the arrow or number keys and runs in '
    + 'any modern browser: on a computer, or on a phone.';
}
