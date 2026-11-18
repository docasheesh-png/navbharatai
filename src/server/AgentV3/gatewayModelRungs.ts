/**
 * A MULTI-MODEL GATEWAY'S MODELS FAIL ALONE (owner 2026-11-18, verbatim: "discountedtoken me andar ek fallback system
 * banao, sabse pahle sasta aur accha call ho, response na ho to 2nd, 2nd fail hone par 3rd (last try), 3rd bhi fail
 * to discounted token chhor ke aage badho").
 *
 * 🔴 WHAT WAS WRONG (found 2026-11-18 by driving the real chain). Every gateway rung was built with ONE bench name per
 * key — `openAiCompatRunners(label, key, url, [m1, m2, m3])` gave all three models the name `ENGINE_DT`. The chain's
 * transient memory (429 streak, shared cooldown, timeout streak, pool cooldown) is keyed on that name, so ONE timeout
 * or ONE 429 on the first model sidelined the other two in the same turn: the build fell straight through to Sonnet,
 * the dearest rung, and the "2nd, then 3rd" fallback the owner asked for never ran. The same shape sat in Router One,
 * Qubax, BluesMinds and Moyi, which all route each model to a different upstream.
 *
 * THE RULE THIS ENCODES. On a gateway, a model is its own upstream:
 *   • bench name — unique per model and key (`LABEL`, `LABEL#2`, …; the `#n` form every name-stripper already reads),
 *     with `reportAs: LABEL`, so reports, prices and the white-label scrub still see one label;
 *   • `familyKey` — `LABEL::model`, so a timeout or overload benches that model, never its siblings;
 *   • `accountKey` — the key's own name, so an ACCOUNT fact (empty balance, revoked key, spend lock) still retires
 *     every model on that key at once instead of being re-proved per model.
 * The fixed provider ladders (GLM, KIMI, …) are not gateways and keep their family-wide semantics. PURE.
 */
import type { NamedRunner } from './providers/MultiProviderTurnRunner';

export function independentModelRungs(
  label: string,
  models: readonly string[],
  perModel: (model: string) => NamedRunner[],
): NamedRunner[] {
  const out: NamedRunner[] = [];
  let n = 0;
  for (const model of models) {
    for (const rung of perModel(model)) {
      n += 1;
      out.push({
        ...rung,
        name: n === 1 ? label : `${label}#${n}`,
        reportAs: label,
        familyKey: `${label}::${model}`,
        accountKey: `account:${rung.name}`,
      });
    }
  }
  return out;
}
