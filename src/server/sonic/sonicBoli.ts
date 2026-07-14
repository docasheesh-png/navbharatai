// Regional "boli" (dialect / speaking-style) catalog for NavBharatAI Voice (admin 2026-07-14).
//
// IMPORTANT — boli is NOT language. The admin's rule: the boli only shifts TONE, rhythm, warmth and
// the characteristic expressions of a region; it must NEVER change the language the user is speaking.
// If the user speaks plain Hindi, a "Punjabi boli" reply is still Hindi — just with a Punjabi warmth
// and flavour. Nova Sonic's base voice TIMBRE is fixed per voice (male/female); the boli is delivered
// purely through the system prompt (word choice, intonation, affectionate style), so this is an honest
// tone-flavour layer, not a fake "new voice". `neutral` = no regional flavour (today's behaviour).
//
// Pure + dependency-free so BOTH the browser picker (BOLI_OPTIONS labels) and the server
// (boliClause) share ONE catalog — no drift between what the user picks and what the model is told.

export type SonicBoli =
  | 'neutral'
  | 'bhojpuri'
  | 'haryanvi'
  | 'punjabi'
  | 'rajasthani'
  | 'marathi'
  | 'bengali'
  | 'hyderabadi'
  | 'south';

export interface BoliOption {
  id: SonicBoli;
  /** Short label for the picker chip. */
  label: string;
}

/** The picker list, in display order. `neutral` leads as the plain default. */
export const BOLI_OPTIONS: readonly BoliOption[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'bhojpuri', label: 'Bhojpuri / UP-Bihar' },
  { id: 'haryanvi', label: 'Haryanvi' },
  { id: 'punjabi', label: 'Punjabi' },
  { id: 'rajasthani', label: 'Rajasthani' },
  { id: 'marathi', label: 'Marathi' },
  { id: 'bengali', label: 'Bengali' },
  { id: 'hyderabadi', label: 'Hyderabadi' },
  { id: 'south', label: 'South Indian' },
] as const;

// The per-region flavour note. Each describes the WARMTH / RHYTHM / characteristic expressions of that
// region's way of speaking — never a language switch. Kept short so it colours tone without overriding
// the persona or the voice-mode clauses it is appended after.
const BOLI_FLAVOUR: Record<Exclude<SonicBoli, 'neutral'>, string> = {
  bhojpuri:
    'the warm, earthy, affectionate flavour of the Bhojpuri / Awadhi (UP-Bihar) way of speaking — hearty, familiar and friendly, the way people talk in that region',
  haryanvi:
    'the hearty, blunt, good-humoured warmth of the Haryanvi way of speaking — direct, rustic and affectionate',
  punjabi:
    'the lively, energetic, big-hearted warmth of the Punjabi way of speaking — cheerful, expressive and full of josh',
  rajasthani:
    'the courteous, melodious, respectful warmth of the Rajasthani / Marwari way of speaking — gracious and softly musical',
  marathi:
    'the crisp, respectful, friendly warmth of the Marathi way of speaking — polite, clear and homely',
  bengali:
    'the soft, expressive, melodious warmth of the Bengali way of speaking — gentle, emotive and affectionate',
  hyderabadi:
    'the laid-back, charming, good-humoured warmth of the Hyderabadi (Dakhni) way of speaking — relaxed and endearing',
  south:
    'the polite, measured, warm-hearted flavour of a South-Indian way of speaking — courteous and gently expressive',
};

/**
 * The system-prompt clause for a chosen boli. Empty for `neutral`. Always ends by RE-ASSERTING the
 * hard rule: colour the tone with the region, but keep the user's own language — never switch it.
 */
export function boliClause(boli: SonicBoli): string {
  if (boli === 'neutral') return '';
  const flavour = BOLI_FLAVOUR[boli];
  if (!flavour) return '';
  return (
    `Speak with ${flavour}. Bring in that region's characteristic friendly expressions, rhythm and ` +
    'intonation so you sound like a warm local from there. BUT this is only a TONE and STYLE flavour — ' +
    'ALWAYS reply in the SAME language the user is actually speaking (Hindi stays Hindi, English stays ' +
    'English, Hinglish stays Hinglish). NEVER switch the user into a different language just to match ' +
    'the region, and never become hard to understand.'
  );
}

/** Validate an untrusted boli value (WS query param). Unknown/absent → `neutral` (safe default). */
export function parseBoli(value: string | null | undefined): SonicBoli {
  const v = (value || '').trim() as SonicBoli;
  return BOLI_OPTIONS.some((o) => o.id === v) ? v : 'neutral';
}
