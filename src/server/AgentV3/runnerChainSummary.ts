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
  const groups: Array<{ label: string; count: number; names: Set<string> }> = [];
  for (const r of rungs) {
    const family = (r.reportAs || r.name).trim();
    const label = r.modelId ? `${family}(${r.modelId})` : family;
    const last = groups[groups.length - 1];
    if (last && last.label === label) { last.count += 1; last.names.add(r.name.trim()); }
    else groups.push({ label, count: 1, names: new Set([r.name.trim()]) });
  }

  const shown = groups.slice(0, Math.max(1, maxRungs));
  // 🔴 SAY WHAT THE NUMBER COUNTS. `×51` alone reads as fifty-one ATTEMPTS, and a careful reader drew
  // exactly that conclusion: autopsy `d6d664e6` (#3039) recorded an open root cause titled *"a bench
  // that does not bench"* because `PROVIDER_BENCHED` said "benched for the rest of this build" while
  // this line showed `GLM(glm-4.7-flashx) ×51`. The bench was working; the label was ambiguous — those
  // 51 are KEY-POOL RUNGS STANDING THERE, not 51 tries, and the count has always meant that (see the
  // note above: *"the count still says how many keys stood there"*).
  //
  // 🔑 THE DISCRIMINATOR IS REAL, NOT A GUESS. A pool rung carries its own `name` (`GLM#2`) under a
  // shared `reportAs` (`GLM`) — that is what `isPoolMember` keys off in `MultiProviderTurnRunner`. So
  // a collapsed group whose rungs had DISTINCT names is a key pool and says so; a group of genuinely
  // identical rungs keeps today's bare `×N`.
  const parts = shown.map((g) => {
    if (g.count <= 1) return g.label;
    return g.names.size > 1 ? `${g.label} ×${g.count} keys` : `${g.label} ×${g.count}`;
  });
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
  const first = firstRung(chain);
  if (!first) return undefined;
  return first.rung.modelId ? `${first.family}(${first.rung.modelId})` : first.family;
}

/** The first rung that names a provider, with its family resolved — the one walk both readers share. */
function firstRung(chain: readonly ChainRung[]): { rung: ChainRung; family: string } | undefined {
  for (const r of chain ?? []) {
    const family = (r?.reportAs || r?.name || '').trim();
    if (family) return { rung: r, family };
  }
  return undefined;
}

/**
 * The MODEL ID a record should name when it means "the engine this chain was built to call first" —
 * `glm-4.7-flashx` on Weak, `glm-5.3` on Strong. The first rung's pinned model id, else its family
 * (`reportAs || name`), else undefined for an empty chain.
 *
 * 🔴 WHY IT EXISTS (Q-970, autopsy 303e8a6f, 2026-10-13). A Weak build whose prompt scored in the old
 * "sonnet" band recorded `claude-sonnet-4-6` — a model that build can never call — on every failed and
 * stopped model call, in its prompt audit, in its decision trace and in its debug tag. They all read one
 * variable, `selectBuildModel`'s answer, which was written before the three-ladder rewrite (2026-09-14)
 * and still speaks the old Haiku/Sonnet vocabulary. Since that rewrite every rung pins its own model,
 * so that value routes nothing (see `firstRungLabel` above: "a LABEL, not a routing decision").
 * Earlier autopsies fixed ONE reader of it at a time — six times — and the source survived. This is
 * the source: the chain itself says what it plans to call, and the chain is the only thing that knows.
 *
 * ⚠️ Still a LABEL. It names the PLAN, never a delivery: a record that knows what actually answered
 * (`TurnResult.model`, the ledger) must prefer that. PURE.
 */
export function plannedModelOf(chain: readonly ChainRung[]): string | undefined {
  const first = firstRung(chain);
  if (!first) return undefined;
  const id = typeof first.rung.modelId === 'string' ? first.rung.modelId.trim() : '';
  return id || first.family;
}

/** What a chain with no runnable rung plans to call: nothing, and it says so rather than naming a model. */
export const NO_ENGINE_CONFIGURED = 'none (no engine configured)';

/** What a build record says when no model call completed. The words the signed manifest has used since 120eb52f. */
export const NO_MODEL_CALL_MADE = 'none (no model call was made)';

/**
 * THE ONE MODEL NAME a build-level record carries (prompt audit, signed manifest, decision trace, debug
 * tag) — so the four can never disagree, and none of them can fall back to a Claude id the tier never ran.
 *
 * Order, most specific truth first:
 *   1. `delivered`        — the model id that delivered most of the build (the ledger's answer);
 *   2. `deliveredFamily`  — the provider that delivered, when no entry carried a model id;
 *   3. no call completed  — `NO_MODEL_CALL_MADE`. A build no model touched does not name one, not even
 *                           the one it planned (autopsy 120eb52f: a 9-second stopped build read Haiku);
 *   4. `planned`          — the chain's own first rung (`TurnRunner.plannedModel`);
 *   5. `'unknown'`        — never an invented id.
 *
 * It takes no Claude helper and never will: `sonnetModel()` & co. answer "which Claude id would a Claude
 * rung pin", which is not a question about this build. PURE.
 */
export function buildRecordModel(i: {
  delivered?: string | null;
  deliveredFamily?: string | null;
  planned?: string | null;
  anyCallMade: boolean;
}): string {
  const clean = (v: string | null | undefined): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || undefined;
  };
  return clean(i.delivered)
    ?? clean(i.deliveredFamily)
    ?? (i.anyCallMade ? (clean(i.planned) ?? 'unknown') : NO_MODEL_CALL_MADE);
}
