// realismIntent — did the user ask for something REAL, or just for 3D? (admin 2026-08-27.)
//
// Admin, verbatim: "agar user bole real/realistic/asli/100% aisa kuch bhi bole (wording par nahi jana,
// intension samjhna hai) to ek dam hu-ba-hu real object banane hai. agar user sirf 3d bol raha hai, to
// hubahu asli real object na bana kar lite se kam chal jayega."
//
// 🔒 WHY THIS IS A SEPARATE, TESTED DECISION AND NOT A REGEX AT A CALL SITE. It is spending real money
// and real device budget: the REAL tier builds far more geometry, larger textures and more expensive
// materials. Get it wrong in one direction and a phone user's simple 3D game stutters for detail they
// never asked for; wrong in the other and someone who typed "bilkul asli" gets exactly the flat scene
// they were complaining about. So it is one function, with the false positives pinned as hard as the
// true ones.
//
// 🔒 THE FALSE POSITIVE THAT MATTERS MOST: "real-time". "Real-time multiplayer" is about latency, not
// about looks, and a naive /real/ match turns every multiplayer game into a heavyweight render. Same
// for "real money", "real user", "real data". These are excluded by construction, not by luck.
//
// PURE: prompt in, tier out.

export type RealismTier = 'real' | 'lite';

/**
 * Phrases that mean "looks like the actual thing". English, Hindi and Hinglish, because the admin's
 * users type all three — often in one sentence.
 */
const REAL_INTENT: RegExp[] = [
  // English
  /\b(?:photo\s*-?\s*realistic|photorealism|hyper\s*-?\s*realistic|ultra\s*-?\s*realistic|life\s*-?\s*like|lifelike|true\s*to\s*life)\b/i,
  /\b(?:realistic|realism)\b/i,
  /\bhigh\s*(?:end|quality|fidelity|detail)\b/i,
  /\b(?:aaa|triple\s*a)\s*(?:quality|game|graphics|grade)?\b/i,
  /\b(?:cinematic|movie\s*quality|next\s*gen|next\s*-\s*gen)\b/i,
  // "real car", "real trees", "real looking" — but NOT "real-time"/"real money"/"real user".
  /\breal\s*(?:-|\s)?looking\b/i,
  /\breal\b(?!\s*(?:-|\s)?(?:time|money|world\s+data|user|users|data|estate|name|email|life\s+problem))/i,
  // Hinglish / romanised Hindi
  /\b(?:asli|assli|aslee)\b/i,
  /\b(?:hu\s*-?\s*ba\s*-?\s*hu|hubahu|hoobahoo|bilkul\s+(?:asli|sacchi|sachi|real))\b/i,
  /\b(?:yatharth|vaastavik|vastavik)\b/i,
  /\b(?:sach\s*much|sachmuch|sach\s*me\s*(?:jaisa|asli))\b/i,
  /\b100\s*%\s*(?:real|asli|realistic|sahi)?\b/i,
  // "GTA jaisa", "PUBG jaisa" — naming a photoreal AAA title IS the realism ask.
  /\b(?:gta|pubg|bgmi|forza|need\s*for\s*speed|nfs|far\s*cry|witcher|cyberpunk|red\s*dead|assassin'?s?\s*creed)\b/i,
  // Devanagari
  /(?:असली|यथार्थ|वास्तविक|हूबहू|हुबहु|सजीव|फोटो\s*रियल)/,
  /(?:रियलिस्टिक|रीयलिस्टिक)/,
];

/**
 * Phrases that mean "deliberately NOT real". These WIN over a realism word, because "realistic
 * low-poly" and "cartoon but realistic lighting" are asking for a style, not for a scanned world —
 * and building the heavy tier for them wastes the device budget on the wrong look entirely.
 */
const STYLISED_INTENT: RegExp[] = [
  /\b(?:low\s*-?\s*poly|lowpoly|voxel|minecraft|roblox|blocky|pixel\s*art|pixelated|8\s*-?\s*bit|16\s*-?\s*bit|retro)\b/i,
  /\b(?:cartoon|cartoony|toon|cel\s*-?\s*shade[d]?|anime|comic|doodle|sketch[y]?|hand\s*-?\s*drawn)\b/i,
  /\b(?:stylised|stylized|abstract|minimal(?:ist)?|flat\s*shad(?:ed|ing)|simple\s*(?:3d|graphics|look))\b/i,
  /\b(?:cute|chibi|kawaii|clay|papercraft|origami)\b/i,
  /\b(?:cartoon\s*jaisa|simple\s+rakho|halka\s+(?:sa|rakho)|basic\s+rakho)\b/i,
  /(?:कार्टून|सरल|साधारण)/,
];

/** Did the user ask for 3D at all? Used only to explain the decision, never to force the tier. */
const THREE_D = /\b(?:3\s*-?\s*d|three\s*-?\s*dimensional|3d\s*game)\b|(?:थ्री\s*डी|3डी)/i;

export interface RealismDecision {
  tier: RealismTier;
  /** Why — for the build report and the model's own summary. Never empty. */
  reason: string;
  /** The stylised words that forced 'lite' despite a realism word, if any. */
  stylisedOverride: boolean;
}

/**
 * Decide the tier for a prompt. PURE.
 *
 * DEFAULT IS 'lite', deliberately. A plain "make a 3D game" gets the fast, phone-friendly build — the
 * admin's own instruction — and the expensive tier is opt-in by saying so. Defaulting the other way
 * would tax every casual 3D request for detail nobody asked for.
 */
export function realismIntent(prompt: string | null | undefined): RealismDecision {
  const text = String(prompt ?? '');
  if (!text.trim()) return { tier: 'lite', reason: 'No prompt text — building the light 3D tier.', stylisedOverride: false };

  const stylised = STYLISED_INTENT.some((re) => re.test(text));
  const real = REAL_INTENT.some((re) => re.test(text));

  if (stylised && real) {
    // "realistic low-poly" is a style request. Honour the style; the realism word is describing the
    // lighting or the feel, not asking for a scanned world.
    return {
      tier: 'lite',
      reason: 'The request names a deliberate art style (low-poly/cartoon/stylised), so the light tier is correct even though it also says "realistic".',
      stylisedOverride: true,
    };
  }
  if (stylised) {
    return { tier: 'lite', reason: 'The request asks for a stylised look, so objects stay light and fast.', stylisedOverride: false };
  }
  if (real) {
    return {
      tier: 'real',
      reason: 'The request asks for real/realistic objects, so every object is built at full detail (real proportions, PBR surfaces, reflections).',
      stylisedOverride: false,
    };
  }
  return {
    tier: 'lite',
    reason: THREE_D.test(text)
      ? 'The request asks for 3D but not for realism, so objects are built light and fast — which is what runs well on a mid-range phone.'
      : 'No realism signal in the request — building the light 3D tier.',
    stylisedOverride: false,
  };
}

/** True when the heavy tier applies. Convenience for call sites that only need the boolean. PURE. */
export function wantsRealObjects(prompt: string | null | undefined): boolean {
  return realismIntent(prompt).tier === 'real';
}
