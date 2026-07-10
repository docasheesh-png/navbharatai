// T1-backstop-honesty (roadmap Tier 1B) — never let the escalation BACKSTOP ship a silent fake pass.
//
// When cost-ladder escalation exhausts every tier and the STRONGEST tier's build still fails the objective
// gate, the orchestrator delivers it anyway as a best-effort backstop (so a build never "breaks" — the
// one absolute rule). But "delivered" must not read as "verified": the user has to be told the final
// review still flagged issues, and it must land in the build-health card + report — not just a server log.
//
// PURE + tiny. The route calls this when esc.gatePassed === false to get the honest note, then records it
// as a build-diagnostics warning (so buildHealthFromDiagnostics surfaces it on the card) and narrates it.

/**
 * The honest note for a backstop delivery, or null when the build genuinely passed its gate.
 * Pure — no formatting side effects beyond the returned string.
 */
export function backstopHonestyNote(gatePassed: boolean, gateReason?: string): string | null {
  if (gatePassed) return null;
  const reason = gateReason && gateReason.trim() ? gateReason.trim() : 'the final quality review still flagged issues';
  return `Delivered on the strongest tier as a best-effort backstop, but the final review did not fully pass: ${reason}`;
}

/** A short, user-facing live narration for a backstop delivery (or null when the gate passed). Pure. */
export function backstopNarration(gatePassed: boolean): string | null {
  if (gatePassed) return null;
  return '⚠️ Delivered your app, but the final quality review still flagged issues — check the build-health card before you ship.';
}
