// WHO MAY CONNECT THEIR OWN TOOLS? — the paid-plan gate on MCP (admin-mandated 2026-09-12).
//
// Admin, verbatim: *"only for 149₹ subscription wale ke liye rakho, baaki ke liye disable kar do"*.
//
// TWO REASONS, and the second is the better one. The cost reason is real: a connected service's tool
// names and descriptions are sent to the model on EVERY call of that app's build, so a full five
// servers can add ~30,000 tokens per call — which a paid build bills to the user and a FREE build
// bills to NavBharatAI. But the product reason is stronger: somebody wiring their office Notion or
// their company's internal API into a builder is, by definition, not a casual free user. This is a
// business feature, and gating it is what it was always for.
//
// 🔒 THE THREE-STATE PROBE IS THE WHOLE DESIGN, exactly as `probeHostingPlan` returns it. "Paid",
// "not paid" and "we could not find out" are three different answers, and collapsing the third into
// either of the others is how this goes wrong:
//   • collapse unknown → PAID and a Firestore hiccup hands the feature to everyone, billed to us;
//   • collapse unknown → FREE and the same hiccup silently switches OFF a paying customer's already
//     working integration, mid-build, with nothing to explain it.
// So `unknown` does neither: it refuses a NEW connection (no new spend can start on a guess) while
// letting connections that ALREADY exist keep working (nothing a paying user built stops on a blip).
// That split is the admin's own call, and it is the only one that protects both sides.
//
// PURE — facts in, decision out. The route does the probe; this decides.

/** What the gate needs to know. Every field is a fact the caller already has. */
export interface McpPlanFacts {
  /** Signed in at all? An anonymous caller has no plan to read. */
  signedIn: boolean;
  /** `probeHostingPlan().active` — true only when a plan is genuinely current. */
  hasActivePlan: boolean;
  /**
   * `probeHostingPlan().known` — FALSE means the lookup failed or timed out.
   *
   * 🔒 This is NOT "no plan". A plan we could not read is a plan we know nothing about, and the two
   * must never be the same value (see the header).
   */
  planKnown: boolean;
  /** The admin free-list — always allowed, so the feature can be tested without buying a plan. */
  isFreeListed: boolean;
}

export type McpDenyReason = 'signed-out' | 'requires-plan' | 'plan-unreadable';

export type McpGateDecision =
  | { allowed: true; reason: 'free-listed' | 'active-plan' }
  | { allowed: false; reason: McpDenyReason; message: string };

/**
 * May this user CONNECT a new service?
 *
 * The strict direction: a new connection is new spend, and new spend never starts on a guess.
 */
export function canUseConnectedServices(facts: McpPlanFacts): McpGateDecision {
  // The free list first, so admin testing never depends on a billing record existing.
  if (facts.isFreeListed) return { allowed: true, reason: 'free-listed' };
  if (!facts.signedIn) {
    return { allowed: false, reason: 'signed-out', message: 'Sign in to connect your own tools.' };
  }
  if (!facts.planKnown) {
    // Honest about WHY, and it names a retry rather than an upsell — because we do not actually know
    // that this user needs to buy anything.
    return {
      allowed: false,
      reason: 'plan-unreadable',
      message: 'We could not check your plan just now. Please try again in a moment.',
    };
  }
  if (!facts.hasActivePlan) {
    return {
      allowed: false,
      reason: 'requires-plan',
      message: 'Connecting your own tools is part of the paid plan. Upgrade to connect Notion, Linear or your own service.',
    };
  }
  return { allowed: true, reason: 'active-plan' };
}

/**
 * May this build USE the services already connected to this app?
 *
 * 🔒 DELIBERATELY MORE FORGIVING THAN THE CONNECT GATE, and only on the unreadable case. A user who
 * connected a service while paying has a working app; a plan lookup that fails one afternoon must not
 * quietly change what that app can do. A plan that is genuinely READ as inactive does stop the tools
 * — that is the gate doing its job, not a blip.
 */
export function canRunConnectedServices(facts: McpPlanFacts): boolean {
  if (facts.isFreeListed) return true;
  if (!facts.signedIn) return false;
  // Unknown ⇒ let an existing integration keep working. The connect gate already stopped new ones.
  if (!facts.planKnown) return true;
  return facts.hasActivePlan;
}

/**
 * What the BUILD tells the user when their connected services were skipped.
 *
 * Never silent: a build that quietly stopped using a tool the user set up would look like the AI
 * forgetting, which is worse than a plain sentence. Empty string when nothing was skipped.
 */
export function skippedServicesNotice(serverCount: number, facts: McpPlanFacts): string {
  if (serverCount <= 0 || canRunConnectedServices(facts)) return '';
  if (!facts.signedIn) return 'Your connected services were not used — sign in to use them.';
  return `Your ${serverCount} connected service(s) were not used: connecting your own tools is part of the paid plan.`;
}
