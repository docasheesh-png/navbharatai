// DOES THIS REQUEST NEED DATA THAT OUTLIVES ONE BROWSER? — read from the REQUEST, before a file exists
// (admin 2026-09-29: "database aur payment verification wala kaam shuru karo", choosing the user's own
// Supabase).
//
// 🔴 WHY THE REQUEST AND NOT THE FILES. `appNeedsDatabase` (databaseNeed.ts) reads the app's own files,
// which is right at publish time — and blind at the moment that matters. Autopsy a7aa447c: an event-
// booking app was built with the bookings saved in the CUSTOMER'S OWN BROWSER. No database package, no
// schema, so every file-based check said "no database needed", and the owner could never see a single
// booking. The decision of WHERE data lives is made in the builder's first minutes, so the offer has to
// come before that, from what the person asked for.
//
// 🔒 PRECISION-FIRST, on purpose. A false "yes" interrupts a calculator with a question about a database
// it will never use; a false "no" leaves today's behaviour exactly as it is (the builder still tells the
// user honestly that data is temporary). So only nouns that name data somebody OTHER than the person
// typing it must later see — a booking, an order, an admission, a patient record — or accounts count.
// PURE.

export interface SharedDataNeed {
  needed: boolean;
  /** Plain words for WHY — shown to the user, so never empty when `needed`. */
  reasons: string[];
}

const SIGNALS: Array<[RegExp, string]> = [
  [/\b(bookings?|appointments?|reservations?|slot booking)\b/i, 'bookings'],
  // "orders", or a clear order flow — never the phrase "in order to".
  [/\b(orders|order (management|tracking|history|form|list|status)|place (an )?order|online order(ing)?|take orders)\b/i, 'orders'],
  [/\b(registrations?|admissions?|enquir(y|ies)|inquir(y|ies)|leads)\b/i, 'form submissions'],
  [/\b(attendance|inventory|stock (management|register|entry)|patients?|(student|customer|employee|member)s?\s+(records?|data|list|database|details))\b/i, 'records'],
  [/\b(admin|owner|staff|seller|vendor)\s+(panel|dashboard|portal)\b/i, 'an admin dashboard'],
  [/\b(sign ?up|log ?in|login|user accounts?|register users?)\b/i, 'user accounts'],
  [/\b(marketplace|multi[- ]?user|chat app|group chat|social (?:media|network(?:ing)?) (?:app|site|website|platform)|a social network)\b/i, 'data shared between users'],
];

/** The person said, in words, that the app must NOT have a backend. */
const EXPLICITLY_LOCAL = /\b(no (backend|database|server|login)|without (a |any )?(backend|database|server|login)|offline[- ]only|local ?storage only|static (site|page|website))\b/i;

export function sharedDataNeed(prompt: unknown): SharedDataNeed {
  const text = String(prompt ?? '');
  if (!text.trim() || EXPLICITLY_LOCAL.test(text)) return { needed: false, reasons: [] };
  const reasons: string[] = [];
  for (const [re, label] of SIGNALS) if (re.test(text) && !reasons.includes(label)) reasons.push(label);
  return { needed: reasons.length > 0, reasons };
}

export type StartOfferDecision =
  | { offer: true }
  | { offer: false; why: 'edit' | 'already-connected' | 'not-needed' | 'no-supabase-grant' | 'no-user' };

/**
 * Whether to ask, at build start, "create a free database in your own Supabase?". Only a FRESH build (an
 * existing app already made its data decision), only with nothing connected, only when the request needs
 * it, and only when the user already connected their Supabase account — anyone else gets the honest
 * guidance and the post-build "Connect a database" row, never a question we cannot fulfil. PURE.
 */
export function startOfferDecision(input: {
  hasUser: boolean;
  isEditMode: boolean;
  databaseConnected: boolean;
  need: SharedDataNeed;
  supabaseGranted: boolean;
}): StartOfferDecision {
  if (!input.hasUser) return { offer: false, why: 'no-user' };
  if (input.isEditMode) return { offer: false, why: 'edit' };
  if (input.databaseConnected) return { offer: false, why: 'already-connected' };
  if (!input.need.needed) return { offer: false, why: 'not-needed' };
  if (!input.supabaseGranted) return { offer: false, why: 'no-supabase-grant' };
  return { offer: true };
}

/** The question itself, naming what the app will save. */
export function startOfferText(need: SharedDataNeed): string {
  const what = need.reasons.length > 0 ? need.reasons.join(', ') : 'data';
  return `This app saves ${what} that you will need to see from any device. `
    + 'Create a free database in YOUR OWN Supabase account now, so it is built in from the start? '
    + 'Approve = I create it and wire it in before writing the app (your data and its billing stay yours; it uses one of the 2 projects a free Supabase plan allows). '
    + 'Deny = I build it now with data kept on this device, and you can connect a database any time in Settings → App Settings → Database.';
}

/** How long the build waits for an answer before carrying on without a database. */
export const START_OFFER_WAIT_MS = 120_000;
