// deployGuard — the ONE honest answer to "can this app be published right now, and if not, why?"
//
// ROOT CAUSE this kills (admin 2026-08-02, Publish modal): every button on the Publish surface called
// `deployLive(id)`, whose first line was `if (running || !state.workspaceId) return;` — a SILENT return.
// The modal closed itself first, so a user whose preconditions weren't met saw the sheet vanish and
// absolutely nothing happen: "iske sabhi button farzi hai, koi bhi kaam nahi kar raha hai." The action
// was real, but the failure was invisible — which is exactly the "dead button" the second absolute rule
// forbids (a button MUST do what it says, or honestly say why it can't).
//
// So the precondition check becomes a VALUE, not a silent branch: pure, testable, and shown to the user
// verbatim. Callers must never close the Publish surface until this returns null.

export interface DeployPreconditions {
  /** A build/deploy stream is already running for this panel. */
  running: boolean;
  /** The live workspace this app lives in — absent before the first build (or on a cold reload). */
  workspaceId?: string | null;
  /** True when the target provider is actually configured on the server. */
  providerConfigured?: boolean;
  /** The provider's display name, for a specific message ("NavBharatAI hosting", "Vercel", …). */
  providerName?: string;
}

/**
 * The honest, user-facing reason a publish cannot start — or null when it genuinely can.
 * Plain language, no vendor/internal names (white-label law), and every branch is actionable.
 */
export function deployBlockedReason(p: DeployPreconditions): string | null {
  if (!p.workspaceId) {
    return 'Build an app first — there is nothing to publish yet.';
  }
  if (p.running) {
    return 'A build is already running. Wait for it to finish, then publish.';
  }
  if (p.providerConfigured === false) {
    const who = p.providerName ? `${p.providerName} is` : 'This host is';
    return `${who} not connected yet — add its access token in Settings → Secrets & Keys, then publish.`;
  }
  return null;
}

/** Convenience: true when a publish can actually start. */
export function canDeploy(p: DeployPreconditions): boolean {
  return deployBlockedReason(p) === null;
}
