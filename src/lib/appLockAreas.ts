/**
 * WHICH PARTS OF NAVBHARATAI THE APP LOCK CAN COVER (admin 2026-09-13).
 *
 * Admin, verbatim: *"yeh PIN system sirf 'secret and api key' ke liye nahi, aur bhi options ke liye lagu
 * karna hoga … general pin system banana hai. setting me general settings me, user ko option do kahan
 * kahan pin lagana hai … 1- api keys and secret (non removal ✅) 2- user chahe to (on/off) default off:
 * navbharatai pro, billings, subscription, wallet recharge, code studio, settings"*.
 *
 * 🔒 THIS LIST LIVES IN `src/lib/` ON PURPOSE — it is imported by BOTH the browser and the server.
 *
 * The browser needs the labels to draw the toggles; the server needs the `mandatory` rule to enforce it.
 * Two copies of a security list is how one side comes to believe an area is lockable while the other
 * quietly ignores it — so there is one list, and the server is still the thing that decides. (This repo
 * already does exactly this with `lib/phoneNumber.ts`, the normaliser shared with the server.)
 *
 * ⚠️ `api_keys` CANNOT BE SWITCHED OFF, and that is enforced HERE rather than by a disabled checkbox.
 * A disabled input is a suggestion: anyone can send the request the screen would have sent. So
 * `normaliseLockedAreas` adds it back whatever arrives, which means the only way to remove it is to
 * change this file — i.e. it is not a user-reachable setting at all.
 */

export type AppLockArea =
  | 'api_keys'
  | 'pro_builder'
  | 'billing'
  | 'subscription'
  | 'wallet_recharge'
  | 'code_studio'
  | 'settings';

export interface AppLockAreaSpec {
  id: AppLockArea;
  /** What the toggle says. The user's words, not the code's — "Code Studio", never `code_studio`. */
  label: string;
  /** One line under the label, so a non-technical user knows what they are switching on. */
  hint: string;
  /** True for an area the user is not allowed to unlock-by-default. Exactly one today. */
  mandatory?: true;
}

/**
 * The canonical order — the order the toggles appear in, and the order a stored list is normalised to.
 *
 * Ordered deliberately: the mandatory one first so it reads as the baseline, then the money screens
 * together, then the two working surfaces, then Settings last because locking Settings is the one with a
 * consequence worth meeting last (it puts these very toggles behind the PIN).
 */
export const APP_LOCK_AREAS: readonly AppLockAreaSpec[] = [
  {
    id: 'api_keys',
    label: 'API keys & secrets',
    hint: 'Always locked. Your saved keys stay encrypted until the PIN is accepted on our server.',
    mandatory: true,
  },
  {
    id: 'billing',
    label: 'Wallet & Billing',
    hint: 'The whole Wallet & Billing screen — your balance, your spending history and everything inside it.',
  },
  {
    id: 'subscription',
    label: 'Subscription & plans',
    hint: 'Buying, renewing or changing a hosting plan, and the auto-renew switch.',
  },
  {
    id: 'wallet_recharge',
    label: 'Wallet recharge',
    hint: 'Adding money to your wallet, so nobody can spend from your account without your PIN.',
  },
  {
    id: 'pro_builder',
    label: 'NavBharatAI Pro',
    hint: 'The app builder — your builds, your chat and your files.',
  },
  {
    id: 'code_studio',
    label: 'Code Studio',
    hint: 'The code editor and everything open in it.',
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'The Settings screen itself — including this App Lock list, so the PIN is needed to change it.',
  },
];

export const APP_LOCK_AREA_IDS: readonly AppLockArea[] = APP_LOCK_AREAS.map((a) => a.id);

/** The areas a user cannot switch off. Derived from the list, so the two can never disagree. */
export const MANDATORY_LOCK_AREAS: readonly AppLockArea[] = APP_LOCK_AREAS.filter((a) => a.mandatory).map((a) => a.id);

export function isAppLockArea(value: unknown): value is AppLockArea {
  return typeof value === 'string' && (APP_LOCK_AREA_IDS as readonly string[]).includes(value);
}

export function areaSpec(id: AppLockArea): AppLockAreaSpec | null {
  return APP_LOCK_AREAS.find((a) => a.id === id) ?? null;
}

export function areaLabel(id: AppLockArea): string {
  return areaSpec(id)?.label ?? id;
}

/**
 * Clean up whatever was stored (or posted) into a list we will act on.
 *
 * Three jobs, and each one is a real defect it prevents:
 *  - **the mandatory areas are always present** — so "switch off the lock on my API keys" is not a
 *    request that exists, at any layer;
 *  - **unknown ids are dropped** — a stale id from an older build (or an invented one) must never sit in
 *    the list looking like a lock that is on while nothing checks it;
 *  - **the canonical order, deduplicated** — so the stored value is comparable and a screen never has to
 *    sort it.
 *
 * Anything that is not an array of strings becomes "just the mandatory areas", which is the DEFAULT
 * state: nothing optional locked. That is what a brand-new account has, and what a corrupt record must
 * degrade to — never "everything locked", which would strand somebody outside their own app.
 */
export function normaliseLockedAreas(raw: unknown): AppLockArea[] {
  const asked = new Set<AppLockArea>(MANDATORY_LOCK_AREAS);
  if (Array.isArray(raw)) {
    for (const value of raw) if (isAppLockArea(value)) asked.add(value);
  }
  return APP_LOCK_AREAS.filter((a) => asked.has(a.id)).map((a) => a.id);
}

/** Is this area locked, given a (possibly untrusted) stored list? */
export function isAreaLocked(areas: unknown, id: AppLockArea): boolean {
  return normaliseLockedAreas(areas).includes(id);
}

/**
 * Does locking `billing` already cover `id`?
 *
 * The three money areas are ONE screen in this app: Wallet & Billing contains both the plans card and
 * the recharge tab. So a user who locks the whole screen has already locked what is inside it, and the
 * settings list says so in one line instead of leaving two toggles that appear to do nothing.
 *
 * Kept as a function rather than a hardcoded sentence because the containment is a real fact about the
 * screens — if the recharge tab ever becomes its own view, this is the one place that changes.
 */
export function coveredByBilling(id: AppLockArea): boolean {
  return id === 'subscription' || id === 'wallet_recharge';
}

/** The areas that are genuinely in force, once containment is applied. Pure. */
export function effectiveLockedAreas(areas: unknown): AppLockArea[] {
  const list = normaliseLockedAreas(areas);
  if (!list.includes('billing')) return list;
  const withContained = new Set<AppLockArea>(list);
  for (const a of APP_LOCK_AREA_IDS) if (coveredByBilling(a)) withContained.add(a);
  return APP_LOCK_AREAS.filter((a) => withContained.has(a.id)).map((a) => a.id);
}
