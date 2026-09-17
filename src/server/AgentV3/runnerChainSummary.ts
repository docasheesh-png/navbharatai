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
 *   `GLM(glm-5.2) ×104 → KIMI(kimi-k3) → CLAUDE → CLAUDE_HAIKU`
 *
 * 🔴 A KEY POOL USED TO EAT THE WHOLE LINE, AND IT ATE THE ANSWER WITH IT (open root cause from
 * autopsy fdd59ef8, recurring in 2b0a3ed5, 2026-09-17). This function listed each pool key as its own
 * rung — `GLM → GLM#2 → … → GLM#24 … and 80 more` — so with ~104 keys configured, a real report's
 * chain line ENDED inside the GLM pool. KIMI and CLAUDE_HAIKU were in the chain and invisible.
 *
 * ⚠️ THAT IS THIS MODULE'S OWN QUESTION, FAILING ON ITS OWN LINE. Its header exists to separate "the
 * rung was there and never reached" from "the rung was never there at all"; a line truncated before
 * the second family can no longer answer it, and a reader is back to guessing.
 *
 * The original reasoning — *"a key-pool rung is a genuinely separate attempt and collapsing it would
 * hide that three keys were tried"* — is kept, not discarded: a run of identical rungs collapses to
 * `NAME(model) ×N`, so the count still says how many keys stood there. Only CONSECUTIVE rungs of the
 * same family AND model collapse, so a ladder that legitimately returns to a provider later
 * (`GLM(flashx) → KIMI → GLM(glm-5.3)`) still shows both visits.
 *
 * `maxRungs` now counts COLLAPSED entries, which is what makes the budget reach the end of a real
 * ladder. Pure.
 */
export function describeRunnerChain(chain: readonly ChainRung[], maxRungs = 24): string {
  const rungs = (chain ?? []).filter((r) => r && typeof r.name === 'string' && r.name.trim());
  if (rungs.length === 0) return 'no providers in the chain';

  // Collapse consecutive same-family, same-model rungs. The FAMILY is `reportAs` where the rung has
  // one ('GLM#17' reports as 'GLM') — that field exists precisely to say "these are one engine".
  const groups: Array<{ label: string; count: number }> = [];
  for (const r of rungs) {
    const family = (r.reportAs || r.name).trim();
    const label = r.modelId ? `${family}(${r.modelId})` : family;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count += 1;
    else groups.push({ label, count: 1 });
  }

  const shown = groups.slice(0, Math.max(1, maxRungs));
  const parts = shown.map((g) => (g.count > 1 ? `${g.label} ×${g.count}` : g.label));
  const rest = groups.length - shown.length;
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

/**
 * The engine this build actually PLANS to call first — `GLM(glm-4.7-flashx)`, or the bare name when
 * the rung pins no model. `undefined` for an empty chain.
 *
 * 🔴 WHY THE REPORT NEEDS THIS (autopsy 2b0a3ed5, 2026-09-17). A weak-tier build reported
 * `plannedModel: "claude-haiku-4-5-20251001"` while delivering on `glm-4.7-flashx`. Haiku is the LAST
 * rung of the weak ladder — the backstop — so the field named the engine we hoped never to reach as
 * the one we intended to use. `selectBuildModel` predates the three-ladder rewrite (2026-09-14) and
 * still answers in the old Haiku/Sonnet vocabulary; the LADDER is what decides now.
 *
 * ⚠️ This is a LABEL, not a routing decision. Nothing about which engine runs changes — the same
 * mislabelling already cost one autopsy a wrong lead, when a turn timeout was filed against
 * `claude-sonnet-4-6` on a weak build that never called Claude (4efab9d7).
 */
export function firstRungLabel(chain: readonly ChainRung[]): string | undefined {
  for (const r of chain ?? []) {
    const family = (r?.reportAs || r?.name || '').trim();
    if (!family) continue;
    return r.modelId ? `${family}(${r.modelId})` : family;
  }
  return undefined;
}
