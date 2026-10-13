// A KEYPAD PHONE THE USER NAMED — READ AS THE ADMIN READS IT (Q-846 → Q-868, build 46e2d74b).
//
// 🔴 The request was "Create an racing game for Nokia c 2-01" and it got a 3D touch racer. Q-846 (#3678) read the
// phone as the TARGET and told the user "no web app can run on it". The admin corrected that on 2026-10-12, verbatim:
// *"user ne kaha tha, nokia ke phone me jo game tha, woh game banana hai! na ki nokia phone ke liye game banana
// hai"* — the user wanted THE CLASSIC GAME THAT CAME ON THAT PHONE. And the Q-846 regex never matched the real
// prompt anyway: "c 2-01" has a space after the c.
//
// ⚖️ WHO DECIDES WHAT THE USER MEANT. Nine review rounds (Q-868, 2026-10-12) tried to read origin vs target, refusal,
// owner and topic with regexes, and every round found new English/Hinglish phrasings it got wrong. So this module
// decides only what a regex can decide safely, and hands the meaning to the builder, which reads language:
//   • DETECT the phone — precision-first: Q-846's vocabulary plus the X series of the same era (X2-01), tolerant of
//     spaces and dashes;
//   • STEER a light 2D build (the game kit lays down no three.js — gameKitSeed.ts) with touch AND keys, and tell the
//     builder the LIKELY meaning (the classic game from that phone, in that era's retro look) with "unless the request
//     asks otherwise" — so a refusal, a modern/3D wish or a non-game app is the builder's to honour;
//   • TELL the user only what is true under EVERY reading: what was built and where it plays. No claim about what the
//     user meant, and no "cannot run" (JioPhone / KaiOS phones DO run web apps — the old line was false for them).
// PURE — no I/O.

/** Named Nokia keypad models: the hyphenated C/X series of that era (C2-01, X2-01 — written "c 2-01", "C2 – 01" or with any
 *  dash), Asha, and the classic numbers. The dash is REQUIRED: without it "C200" / "C20" are today's Android phones. */
const NOKIA_KEYPAD = /\bnokia\s*(?:[cx]\s?\d\s?[-\u2010-\u2015\u2212]\s?\d{2}\b|asha\b|(?:105|106|110|130|150|215|220|225|2660|2720|3310|5310|6300|8000|8110)\b)/i;
/** The phrases that name the KIND of phone, in English and Hinglish. Only the two that cannot mean an ordinary app:
 *  \"basic phone\" and \"button phone\" were here and matched \"basic phone book app\", \"basic phone directory\" and \"big
 *  button phone dialer\" (found reviewing #3678, 2026-10-12) — each would have told a smartphone user their app cannot run.
 *  THE CLASS: a device word that is also an app word. A phrase joins this list only when it names a device and nothing else. */
const KEYPAD_PHRASE = /\b(?:feature|keypad)\s*-?\s*phones?\b|\bkai\s*-?\s*os\b|\bjio\s*-?\s*phone\b/i;

/** What the user named: a classic Nokia MODEL (whose own games people remember — "the game on the C2-01"), or a KIND of
 *  phone (JioPhone, KaiOS, a feature / keypad phone — still sold, so a game "for" one may well be meant to play on it). */
export type NamedPhoneKind = 'classic-model' | 'phone-kind';

/** The keypad phone the user named (precision-first), or null. PURE. */
export function namedNonSmartphone(prompt: string | null | undefined): { device: string; kind: NamedPhoneKind } | null {
  const text = String(prompt ?? '');
  if (!text.trim()) return null;
  const model = NOKIA_KEYPAD.exec(text);
  if (model) return { device: model[0].replace(/\s+/g, ' ').trim(), kind: 'classic-model' };
  const phrase = KEYPAD_PHRASE.exec(text);
  return phrase ? { device: phrase[0].replace(/\s+/g, ' ').trim(), kind: 'phone-kind' } : null;
}

/** What the builder is told before it writes a line (prepended to the build prompt, and handed to every lane that writes:
 *  the fast lane, the writing sub-agents and both planners). It states the LIKELY meaning and leaves the builder free to
 *  follow what the request actually says — a regex cannot read a refusal, an owner or a non-game app; the builder can.
 *  Whatever it builds stays LIGHT and 2D: the game kit for a named keypad phone lays down no three.js (gameKitSeed.ts),
 *  so a rule that let the builder go 3D would contradict the kit and the user line. PURE. */
export function nonSmartphoneBuildRule(device: string, kind: NamedPhoneKind = 'classic-model'): string {
  const meaning = kind === 'classic-model'
    ? `the request names "${device}", a classic keypad phone. When the request is a GAME, the user most likely wants THE `
      + 'CLASSIC GAME THAT CAME ON THAT PHONE, rebuilt for the browser'
    : `the request names "${device}", a keypad / feature phone. When the request is a GAME, the user may want a light game `
      + 'that phones like it can play, or the classic game of that era — read the request; for the classic reading, rebuild '
      + 'it for the browser';
  return `CLASSIC PHONE NAMED — ${meaning}: give it that era's retro look (pixel art, a small palette, chunky sprites, a `
    + 'simple score) and that era\'s simple mechanic — for a racing game, a top-down lane racer: the player\'s car near the '
    + 'bottom, traffic coming down, LEFT/RIGHT change lane, speed and score rise, a crash ends the run, one tap or key '
    + 'restarts. Give it an original title and no phone maker\'s logo or trademarked game name. If the request asks for '
    + 'something else — a different game, a modern look, "not like the old phone", or an app that is not a game — build '
    + 'what it asks instead. Either way keep it LIGHT and 2D (canvas 2D or plain HTML — never three.js or WebGL), playable '
    + 'with on-screen TOUCH buttons AND the keyboard (arrow keys and the number keys 2 up, 4 left, 6 right, 8 down, 5 or '
    + 'Enter to act), with large readable text.';
}

/** The one sentence the user gets in their summary — true whatever they meant (the classic game from that phone, or a
 *  game to play on it): it says what WAS built and where it plays, never what the user "really" wanted. A modern
 *  browser is named because the build targets one; an old keypad phone's own browser may not open it, and the line
 *  says so rather than promising "any phone". PURE. */
export function nonSmartphoneUserLine(device: string): string {
  return `\n\n📱 **About ${device}:** I kept this light and 2D. It works in any modern phone or computer browser, with `
    + 'touch or the arrow / number keys — an old keypad phone\'s own browser may not open it.';
}
