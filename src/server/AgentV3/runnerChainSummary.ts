// AgentV3 — WRITE DOWN THE CHAIN THAT WAS ACTUALLY BUILT.
//
// THE DEFECT (autopsy f04421ef). The report showed `providerDelivery: { KIMI: 54 }` and no GLM entry
// at all — not one turn, not one failure. Two completely different worlds produce that same report:
//
//   (a) GLM was IN the chain and simply never reached, because the rung above it answered every time.
//       Nothing is wrong; this is the ladder working exactly as designed.
//   (b) GLM was NEVER IN the chain — no key, a pinned `AGENTV3_CHEAP_FLOOR=kimi`, or a rung that threw
//       while being constructed and was skipped. A provider we believe is leading our builds is not
//       running at all, and the bill and the quality both reflect that silently.
//
// The existing `CHEAP_FLOOR_DECISION` line cannot tell them apart: with the floor set to `on` it says
// "ACTIVE — ON leads" whenever EITHER key is present, because its key check is an OR. So a report can
// honestly say the floor is active while half of it does not exist.
//
// This module records the ordered rungs, so the question is answered by looking rather than guessing.
// It is the same discipline as every other honesty fix in this engine: an absence must be legible AS an
// absence. PURE — no env, no clock, no I/O.

/** The shape `buildTurnRunner` assembles. Only the identifying fields matter here. */
export interface ChainRung {
  name: string;
  /** Set for the cheap-floor rungs, where one provider appears several times on different models. */
  modelId?: string;
  /** Pool rungs report under the base provider name ('GLM#2' reports as 'GLM'). */
  reportAs?: string;
}

/**
 * One line naming every rung in order, e.g.
 *   `GLM(glm-5.2) → GLM#2(glm-5.2) → KIMI(kimi-k3) → CLAUDE → CLAUDE_HAIKU`
 *
 * The rung's OWN name is used, not `reportAs`: a key-pool rung is a genuinely separate attempt and
 * collapsing it would hide that three keys were tried. Truncated at a sane width — a 40-rung pool is
 * still readable as "…and N more" and an unbounded line would be dropped by the timeline's cap.
 */
export function describeRunnerChain(chain: readonly ChainRung[], maxRungs = 24): string {
  const rungs = (chain ?? []).filter((r) => r && typeof r.name === 'string' && r.name.trim());
  if (rungs.length === 0) return 'no providers in the chain';
  const shown = rungs.slice(0, Math.max(1, maxRungs));
  const parts = shown.map((r) => (r.modelId ? `${r.name}(${r.modelId})` : r.name));
  const rest = rungs.length - shown.length;
  return rest > 0 ? `${parts.join(' → ')} … and ${rest} more` : parts.join(' → ');
}

/**
 * The distinct provider FAMILIES in the chain, in first-appearance order — `reportAs` applied, because
 * this is the list that lines up against `providerDelivery`'s keys.
 */
export function chainProviders(chain: readonly ChainRung[]): string[] {
  const seen: string[] = [];
  for (const r of chain ?? []) {
    const name = (r?.reportAs || r?.name || '').trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

/**
 * The sentence that makes a zero readable. Given the chain and who actually delivered turns, say which
 * configured providers were never reached — and, crucially, distinguish that from never being present.
 *
 * Takes the provider NAMES (from `chainProviders`), not the rungs, because that is what a stored
 * report carries and what lines up against `providerDelivery`'s keys.
 *
 * Returns null when there is nothing worth saying (no chain, or every provider delivered).
 */
export function unreachedProvidersNote(providers: readonly string[], delivered: Readonly<Record<string, number>>): string | null {
  if (!Array.isArray(providers) || providers.length === 0) return null;
  const ran = new Set(Object.keys(delivered ?? {}).filter((k) => (delivered as Record<string, number>)[k] > 0));
  const idle = providers.filter((p) => !ran.has(p));
  if (idle.length === 0) return null;
  return `In the chain but never reached this build: ${idle.join(', ')}. `
    + `A provider ABSENT from the chain above was never configured for this build — that is a different thing from one that sat idle.`;
}
