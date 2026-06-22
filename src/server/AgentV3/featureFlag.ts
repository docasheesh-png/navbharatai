// AgentV3 feature flag (strangler-fig, D1).
//
// Default OFF: the live app is never affected by v3.0 until explicitly enabled,
// and even then can be limited to an allowlist of users while the engine is
// under construction. This is the single gate that keeps v3.0 inert in
// production until it is proven (NAVBHARATAI_PRO_V3_DESIGN.md §6).

/** True when v3.0 is globally enabled via AGENTV3_ENABLED=true. */
export function isAgentV3GloballyEnabled(): boolean {
  return process.env.AGENTV3_ENABLED === 'true';
}

/** Parsed allowlist of userIds from AGENTV3_ALLOWLIST (comma-separated). */
export function agentV3Allowlist(): string[] {
  return (process.env.AGENTV3_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether v3.0 is available for a given user. Enabled when the global flag is on
 * AND (the allowlist is empty → all users, OR the user is on the allowlist).
 */
export function isAgentV3Enabled(userId?: string | null): boolean {
  if (!isAgentV3GloballyEnabled()) return false;
  const allow = agentV3Allowlist();
  if (allow.length === 0) return true;
  return !!userId && allow.includes(userId);
}
