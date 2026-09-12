// WHO MAY TAKE SOMEBODY ELSE'S FINISHED APP AS THEIR OWN STARTING POINT.
//
// ADMIN 2026-09-12: "remix sirf wahi user kar sakta hai, jisme 149₹ ya usse adhik ka plan liya hai,
// har koi nahi."
//
// ── THIS CLOSES A GAP THAT WAS ALREADY ADVERTISED, NOT A NEW CHARGE ──────────────────────────────
// Both hosting tiers list "Remix any app in the gallery" in `hostingTiers.ts` as an included benefit,
// and the plan page has been selling it that way. The Community Gallery's remix enforced it from
// 2026-09-10; App Mart's did not, so the same sentence on the same pricing page was true on one
// screen and false on the other. The gate below is what makes the page honest on both.
//
// ── WHY ONE MODULE AND NOT A SECOND COPY OF THE CHECK ────────────────────────────────────────────
// There are two remix surfaces (the Community Gallery and App Mart's web store) and one entitlement.
// Written twice, they drift — and the drift is invisible, because each one looks correct on its own
// screen. That is exactly how App Mart came to give away for free what the Gallery charged for. The
// DECISION and the WORDS both live here; a route supplies the facts and renders the answer.
//
// ── 🔒 THREE EXEMPTIONS, ALL DELIBERATE ──────────────────────────────────────────────────────────
//   • The admin/tester free-list, like every other gate in this codebase.
//   • YOUR OWN app. Copying your own published app back into a fresh workspace is not taking
//     anyone's work; charging a plan for it would be charging you to read your own code.
//   • AN APP YOU ALREADY BOUGHT. The store promises "buy once, take the code whenever you like"
//     (admin 2026-08-16). A plan gate in front of a paid entitlement would be retroactively taking
//     back something already paid for — the one thing a store may never do.
//
// ── 🔒 AND IT FAILS OPEN ─────────────────────────────────────────────────────────────────────────
// A plan store that cannot answer (`known` false) ALLOWS. Rule #1: an outage must never block a
// legitimate paying user. Only a KNOWN "no active plan" refuses. Same shape as the custom-domain
// gate, on purpose — the two must not drift either.

/** What a route needs to know to decide, gathered by the route and passed in. PURE input. */
export interface RemixGateFacts {
  /** Are hosting plans switched on at all? Off ⇒ nothing to gate. */
  plansEnabled: boolean;
  /** The caller's uid, or null when signed out. */
  uid: string | null;
  /** Admin/tester free-list. */
  freeListed: boolean;
  /** True when the caller published this app themselves. */
  isOwnApp: boolean;
  /** True when the caller has already bought this app's remix. */
  alreadyPurchased: boolean;
  /** Did the plan store answer at all? False ⇒ fail open. */
  planKnown: boolean;
  /** Does the caller hold an active hosting plan right now? */
  planActive: boolean;
}

export type RemixGateOutcome =
  /** Let it through. */
  | { allow: true }
  /** Signed out. They cannot hold a plan without an account, so sign-in comes first. */
  | { allow: false; reason: 'signed-out' }
  /** Signed in, no active plan. */
  | { allow: false; reason: 'no-plan' };

/**
 * The whole decision, in one pure function.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. The exemptions are tested BEFORE sign-in, because an owner or
 * a past buyer is identified by their uid — if they are exempt they are, by definition, signed in,
 * and putting sign-in first would only make the ordering harder to read. The plan check is last
 * because it is the only one that costs a read.
 */
export function remixGate(f: RemixGateFacts): RemixGateOutcome {
  if (!f.plansEnabled) return { allow: true };
  if (f.freeListed) return { allow: true };
  if (f.isOwnApp) return { allow: true };
  if (f.alreadyPurchased) return { allow: true };
  if (!f.uid) return { allow: false, reason: 'signed-out' };
  // FAIL OPEN — see the header. Being unable to read a plan must never cost a paying user a remix.
  if (!f.planKnown) return { allow: true };
  return f.planActive ? { allow: true } : { allow: false, reason: 'no-plan' };
}

/** The HTTP answer for a refusal: a status, a sentence, and what the client needs to offer the plan. */
export interface RemixRefusal {
  status: 401 | 402;
  body: { error: string; needsPlan: true; needsSignIn?: true; priceInr: number };
}

/**
 * The words. Written once so both remix surfaces say the same thing.
 *
 * They name the price and where to buy, because a refusal with no way forward is a dead button —
 * the client opens the plans panel from `needsPlan` + `priceInr` rather than from a number typed
 * into a component, so the pitch can never quote a stale price.
 */
export function remixRefusal(reason: 'signed-out' | 'no-plan', priceInr: number): RemixRefusal {
  if (reason === 'signed-out') {
    return {
      status: 401,
      body: {
        error: `Sign in to remix this app. Taking another creator's app as your starting point is part of a hosting plan (from ₹${priceInr}/month, paid from your wallet) — you can keep using the app free either way.`,
        needsPlan: true,
        needsSignIn: true,
        priceInr,
      },
    };
  }
  return {
    status: 402,
    body: {
      error: `Remixing another creator's app is part of a hosting plan (from ₹${priceInr}/month, paid from your wallet). Open Billing → Plans to start one, then remix. The app stays free to use meanwhile.`,
      needsPlan: true,
      priceInr,
    },
  };
}
