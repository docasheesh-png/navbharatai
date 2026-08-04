// Google Play compliance gating (admin decision 2026-08-04).
//
// WHY THIS EXISTS: Google Play rejected the app update ("Violation of Play Console Requirements —
// Developer Account"): since Aug 2024, an app that DECLARES medical features (clinical decision
// support, medication management, first aid, …) may only be published by an ORGANIZATION account.
// The admin's account is personal. The admin chose the honest fast path: the Play-distributed app
// hides every medical-class feature, so the Play Console health declarations can truthfully say the
// app offers none. The WEB app is untouched — this gate is native-shell only.
//
// THE HONESTY RULE THIS ENCODES (do not weaken): the declarations and the shipped app must MATCH.
// Hiding the features while declaring "no medical features" is honest. Re-enabling any medical
// feature in the native app WITHOUT first moving to an organization account (and re-declaring) would
// be a deceptive-behaviour violation — the kind that can ban the whole developer account, not just
// reject one update. If Doctor AI is ever to return on mobile: organization account FIRST (D-U-N-S),
// declarations updated, THEN remove ids from this list.
//
// PURE module: no Capacitor imports here. Callers pass the native flag (from mobileNative's
// isNativeApp()), so every rule is unit-testable without a native runtime.

/** Professional AIs that fall in Google's MEDICAL declaration buckets. */
export const MEDICAL_PROFESSIONAL_IDS: ReadonlySet<string> = new Set([
  'sda_chat',       // Doctor AI — "clinical decision support" by its own description
  'pharmacist_ai',  // medicine information — "medication and treatment management" bucket
  'firstaid_ai',    // "emergency and first aid" bucket
  'maternity_ai',   // pregnancy/antenatal guidance — medical reference bucket
]);

/** True when this view/professional id is a medical-class feature. */
export function isMedicalProfessionalId(id: string): boolean {
  return MEDICAL_PROFESSIONAL_IDS.has(id);
}

/** Should medical features be hidden? Exactly when running inside the Play-distributed native shell. */
export function medicalFeaturesHidden(isNative: boolean): boolean {
  return isNative === true;
}

/** Filter a card/tile list for display — removes medical entries only when hiding is active. */
export function visibleProfessionals<T extends { id: string }>(cards: readonly T[], hideMedical: boolean): T[] {
  if (!hideMedical) return [...cards];
  return cards.filter((c) => !MEDICAL_PROFESSIONAL_IDS.has(c.id));
}

/** Should opening/rendering this view be blocked right now? (Defense in depth behind the tile filter.) */
export function medicalViewBlocked(view: string, hideMedical: boolean): boolean {
  return hideMedical && MEDICAL_PROFESSIONAL_IDS.has(view);
}

/**
 * Home-screen copy for the Professionals card. The default copy advertises "Doctor AI" by name —
 * inside the Play app that would advertise a medical feature the declarations say does not exist,
 * so the native shell gets equivalent copy with no medical mention.
 */
export const PROFESSIONALS_CARD_COPY = {
  web: {
    description: 'Dedicated AI experts for every life domain — Doctor, Lawyer, Teacher, Financial Advisor, Kisan Advisor, and 45+ more.',
    features: ['Doctor AI, Lawyer AI, Teacher AI', 'Kisan, Finance, Career & Wellness', 'Answers in Hindi + regional languages'],
  },
  native: {
    description: 'Dedicated AI experts for every life domain — Lawyer, Teacher, Financial Advisor, Kisan Advisor, and 40+ more.',
    features: ['Lawyer AI, Teacher AI, Career AI', 'Kisan, Finance, Travel & Wellness', 'Answers in Hindi + regional languages'],
  },
} as const;

/** Pick the Professionals card copy for the current surface. */
export function professionalsCardCopy(hideMedical: boolean): { description: string; features: readonly string[] } {
  return hideMedical ? PROFESSIONALS_CARD_COPY.native : PROFESSIONALS_CARD_COPY.web;
}
