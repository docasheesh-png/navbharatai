// AgentV3 — REAL provider rate cards + tiered-markup billing (admin model, 2026-07-14).
//
// WHY THIS EXISTS: the original billing (pricing.ts) prices EVERY non-Opus build against Sonnet
// rates × a small multiplier ("Sonnet-equivalent × 1.2"). But the work is actually done by
// ultra-cheap providers (GLM/Kimi ≈ 1/20th of Sonnet), so that "×1.2 markup" was really ~21× the
// real cost on a cheap-led build — and it billed a FAILED build ₹811. The admin verified the real
// provider deductions on the GLM (Z.ai) + Kimi (Moonshot) dashboards and redefined billing:
//
//   bill = tieredMarkup( REAL provider cost )        // real cost = exact per-provider/model tokens
//                                                    //             × each provider's own rate card
//   tieredMarkup(C):  C ≤ $1  → C × 4                // small builds: 4×
//                     C  > $1 → $4 + (C − $1) × 3    // first $1 at 4×, the excess at 3× (big builds
//                                                    //   don't run away — marginal markup eases to 3×)
//
// SCOPE (admin 2026-07-14): this real-cost + tiered-markup model applies to EVERY tier where Opus
// does NOT run — Weak, Normal, Strong. The two Opus tiers (Powerful = medium, Full Team = max) keep
// the existing "real Opus × 2" model untouched (see pricing.ts / billedForTier 'opus').
//
// HONESTY (rule 5): cache-hit input tokens are NOT tracked separately (the ledger only sees
// input/output), so cached input is priced at the full cache-MISS rate → the real cost is a slight
// OVER-estimate. That is deliberately margin-safe (we can only ever over-state our own cost, never
// under-state it) and honest-conservative; a later slice can capture `cache_read` usage to bill even
// lower. Unknown models fall back to a conservative rate (Sonnet) so an untracked model never
// under-bills. All rates are USD per 1,000,000 tokens and env-overridable (track live prices without
// a deploy).

import { sonnetRate, type TokenRate, type BilledUsage } from './pricing';

function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  // 0 is a VALID rate here (GLM/Kimi flash rungs are genuinely free), so accept >= 0.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The real provider rate cards (USD per 1M tokens, input/output). Confirmed against the official
 * July-2026 price pages (Z.ai / Moonshot / Anthropic / Google) and the admin's live dashboard
 * deductions. Keyed by a normalized model-id matcher so the ACTUAL model that ran is priced (a GLM
 * turn on glm-4.7-flash is free; on glm-5.2 it is the flagship rate) — not one blended provider rate.
 */
export function realRateCard(): Record<string, TokenRate> {
  return {
    // ── GLM (Z.ai) ──────────────────────────────────────────────────────────────────────────────
    //
    // 📋 THE OFFICIAL Z.AI PRICE PAGE, COPIED HERE ON 2026-09-16 (admin sent docs.z.ai/pricing,
    // verbatim). Recorded in the module that OWNS prices, dated and sourced, so the next routing
    // change argues from quoted numbers instead of remembered ones. USD per 1M tokens, in / out.
    //
    //   LATEST      GLM-5.3-Flash  0.15 / 0.50   cached-in 0.03
    //               GLM-5.3        1.40 / 4.40   cached-in 0.26
    //               GLM-5.2        1.40 / 4.40   cached-in 0.26
    //   TEXT        GLM-5.1        1.40 / 4.40   cached-in 0.26
    //               GLM-5          1.00 / 3.20   cached-in 0.20   ⚠️ CHEAPER than 5.1/5.2/5.3
    //               GLM-4.7        0.60 / 2.20   cached-in 0.11
    //               GLM-4.7-FlashX 0.07 / 0.40   cached-in 0.01
    //               GLM-4.6        0.60 / 2.20   cached-in 0.11
    //               GLM-4.5        0.60 / 2.20   cached-in 0.11
    //               GLM-4.5-X      2.20 / 8.90   cached-in 0.45
    //               GLM-4.5-Air    0.20 / 1.10   cached-in 0.03
    //               GLM-4.5-AirX   1.10 / 4.50   cached-in 0.22
    //               GLM-4-32B-128K 0.10 / 0.10
    //               GLM-4.7-Flash  FREE · GLM-4.5-Flash FREE
    //   VISION      GLM-4.6V       0.30 / 0.90   cached-in 0.05
    //               GLM-4.6V-Flash FREE          ← what visionModels.ts already leads with
    //               GLM-4.5V       0.60 / 1.80   cached-in 0.11
    //               GLM-OCR        0.03 / 0.03
    //   TOOLS       Web Search     $0.01 per use  ⚠️ TWICE Brave's $0.005 — do not switch to it
    //   IMAGE       GLM-Image      $0.015/image · CogView-4 $0.01/image
    //   VIDEO       CogVideoX-3    $0.20/video
    //   AUDIO       GLM-ASR-2512   0.03 / MTok (~$0.0024 per minute)
    //   AGENTS      Slide/Poster 0.70/MTok · Translation 3.00/MTok · FX video $0.20/video
    //
    // ⚠️ "Cached Input Storage" is **Limited-time Free** on every line above. That is a promotion, not
    // a price — when it ends, storage becomes a separate charge nothing here models. Re-read the page
    // before leaning on cache economics in any later plan.
    //
    // cacheReadPerMTok: these rows now carry Z.ai's OWN published cache-hit numbers. They used to carry
    // a ≈25%-of-input CONVENTION, and all three moved DOWN (0.0375→0.03, 0.35→0.26, 0.15→0.11) — so the
    // convention had been over-stating our cost, and a bill is the real cost × markup, so it had been
    // over-stating the USER's bill too. Env-tunable like every rate; providers WITHOUT a cache line
    // (Gemini/Grok/Claude rows below) omit it → full input rate (no discount) by construction, so
    // nothing can be under-billed.
    'glm-flash': { inputPerMTok: envRate('RATE_GLM_FLASH_IN', 0), outputPerMTok: envRate('RATE_GLM_FLASH_OUT', 0) },
    // glm-4.7-flashx — the LEAD rung of Weak and Normal since 2026-09-17. $0.07 in / $0.40 out,
    // cache-hit $0.01, read off Z.ai's own pricing page (docs.z.ai → Pricing, admin screenshot), not
    // derived from anything.
    //
    // 🔴 IT NEEDED ITS OWN ROW BEFORE IT COULD JOIN A LADDER, and this is the THIRD time this exact
    // trap has been walked into: `kimi-k2.7-code-highspeed` (2026-09-16) would have billed at HALF
    // its price through the plain k2.7 fallback, and `glm-5.3-flash` (2026-09-16) would have billed
    // at ZERO through the row directly above this one. `glm-4.7-flashx` contains "flash", so without
    // this line and the matcher branch that precedes the generic rule, every FlashX turn would price
    // at the FREE `glm-flash` line — and a bill is the real cost × markup, so a $0 real cost bills
    // the user ₹0 while we pay Z.ai. A model may not go on a ladder until its price is on this card.
    'glm-4.7-flashx': { inputPerMTok: envRate('RATE_GLM47_FLASHX_IN', 0.07), outputPerMTok: envRate('RATE_GLM47_FLASHX_OUT', 0.4), cacheReadPerMTok: envRate('RATE_GLM47_FLASHX_CACHE', 0.01) },
    // glm-5.3-flash (on the WEAK and NORMAL ladders). $0.15 in / $0.50 out, cache-hit $0.03 — all three
    // quoted from Z.ai's published page (2026-09-16), not derived.
    // ⚠️ It must NOT fall into the 'glm-flash' $0 line — a "flash" in the NAME is not a price, and this
    // one benchmarks beside the flagship. Matched BEFORE the generic flash rule in realRateFor.
    'glm-5.3-flash': { inputPerMTok: envRate('RATE_GLM53_FLASH_IN', 0.15), outputPerMTok: envRate('RATE_GLM53_FLASH_OUT', 0.5), cacheReadPerMTok: envRate('RATE_GLM53_FLASH_CACHE', 0.03) },
    // glm-5.3 (non-flash, Z.ai): $1.40 / $4.40 — the same figures as the glm-5 row below, which the
    // /glm-?5/ family rule already returns for it. No separate line: one price, one row.
    // ⚠️ THE ROW IS NAMED 'glm-5' BUT HOLDS THE 5.1/5.2/5.3 PRICE, and that is deliberate rather than a
    // slip: it is the FAMILY CEILING (see the NEWER-MODEL SAFETY note in realRateFor), so an id we do
    // not recognise bills at the dearest 5-series rate we know instead of the cheapest. Z.ai's own page
    // puts real GLM-5 at $1.00 / $3.20 — cheaper — so a literal `glm-5` turn would be OVER-stated here.
    // Nothing runs it (no ladder names it), and the ceiling is the safe direction for an unknown id;
    // give it its own row the day something real routes to it.
    'glm-5': { inputPerMTok: envRate('RATE_GLM5_IN', 1.4), outputPerMTok: envRate('RATE_GLM5_OUT', 4.4), cacheReadPerMTok: envRate('RATE_GLM5_CACHE', 0.26) },
    'glm': { inputPerMTok: envRate('RATE_GLM_IN', 0.6), outputPerMTok: envRate('RATE_GLM_OUT', 2.2), cacheReadPerMTok: envRate('RATE_GLM_CACHE', 0.11) }, // glm-4.x coder
    // ── Kimi (Moonshot) ─────────────────────────────────────────────────────────────────────────
    //
    // 📋 MOONSHOT'S OWN PRICE TABLE, COPIED HERE ON 2026-09-16 (admin sent it verbatim). USD per 1M
    // tokens — note the column order on their page is cache-HIT first, then cache-MISS (= fresh input):
    //
    //   kimi-k3                   cache-hit 0.30 · input 3.00 · output 15.00 · context 1,048,576
    //   kimi-k2.7-code            cache-hit 0.19 · input 0.95 · output  4.00 · context 262,144
    //   kimi-k2.7-code-highspeed  cache-hit 0.38 · input 1.90 · output  8.00 · context 262,144
    //   kimi-k2.6                 cache-hit 0.16 · input 0.95 · output  4.00 · context 262,144
    //   kimi-k2.5                 DISCONTINUED 2026-08-31 — no longer maintained or supported
    //
    // 🔴 TWO LIVE ROWS WERE WRONG, BOTH UNDER-STATING OUR COST — the direction that quietly eats the
    // admin's own margin rather than over-charging a user, which is why neither had ever failed a test:
    //   • k3 was a PLACEHOLDER at the k2.7 rate. Real k3 is $3.00 / $15.00 — **the same price as
    //     Sonnet**, 3.2× the input and 3.75× the output we were counting. It is on no ladder today
    //     (2026-09-14 removed it), but this row is the family CEILING for any unrecognised Kimi id.
    //   • k2.6 was priced on the cheap `kimi` row ($0.60 / $2.50). Real k2.6 is $0.95 / $4.00 — the
    //     SAME as k2.7-code. And k2.6 is the second rung of the WEAK ladder, which NavBharatAI pays for
    //     itself, so every weak build has been costing ~58% more input and 60% more output than the
    //     dashboard showed. That matters directly to "how much am I spending" — it is not cosmetic.
    'kimi-k2.7': { inputPerMTok: envRate('RATE_KIMI27_IN', 0.95), outputPerMTok: envRate('RATE_KIMI27_OUT', 4.0), cacheReadPerMTok: envRate('RATE_KIMI27_CACHE', 0.19) },
    // kimi-k2.7-code-highspeed — its OWN row, added 2026-09-16 when the model first reached a ladder
    // (Normal tier). Before this it had NO row and NO matcher branch, so `realRateFor` fell through to
    // the plain k2.7-code line above — silently billing HALF the real price for a model Moonshot prices
    // at exactly 2x k2.7-code across every column (same coding quality, faster tokens/sec).
    'kimi-k2.7-highspeed': { inputPerMTok: envRate('RATE_KIMI27HS_IN', 1.9), outputPerMTok: envRate('RATE_KIMI27HS_OUT', 8.0), cacheReadPerMTok: envRate('RATE_KIMI27HS_CACHE', 0.38) },
    // kimi-k3 — now the PUBLISHED price, not the k2.7 placeholder it carried from 2026-07-28.
    'kimi-k3': { inputPerMTok: envRate('RATE_KIMI3_IN', 3.0), outputPerMTok: envRate('RATE_KIMI3_OUT', 15.0), cacheReadPerMTok: envRate('RATE_KIMI3_CACHE', 0.3) },
    // kimi-k2.6 — its OWN row now. It used to share the cheap `kimi` line with k2.5 on the assumption
    // that "older = cheaper"; Moonshot prices it exactly like k2.7-code.
    'kimi-k2.6': { inputPerMTok: envRate('RATE_KIMI26_IN', 0.95), outputPerMTok: envRate('RATE_KIMI26_OUT', 4.0), cacheReadPerMTok: envRate('RATE_KIMI26_CACHE', 0.16) },
    // The legacy cheap line. ⚠️ Now k2.5 ONLY, and k2.5 was DISCONTINUED on 2026-08-31 — it is already
    // off every ladder (removed 2026-09-04 after two build reports showed "404 Not found the model
    // kimi-k2.5 or Permission denied" on this account). The row stays because old telemetry still names
    // it and a report must be able to price what it recorded; these figures are HISTORICAL, and
    // Moonshot no longer publishes a price to check them against.
    'kimi': { inputPerMTok: envRate('RATE_KIMI_IN', 0.6), outputPerMTok: envRate('RATE_KIMI_OUT', 2.5), cacheReadPerMTok: envRate('RATE_KIMI_CACHE', 0.15) }, // k2.5 (retired)
    // ── Google (Vertex / Gemini) ──────────────────────────────────────────────────────────────────
    'gemini-pro': { inputPerMTok: envRate('RATE_GEMINI_PRO_IN', 1.25), outputPerMTok: envRate('RATE_GEMINI_PRO_OUT', 10) },
    'gemini': { inputPerMTok: envRate('RATE_GEMINI_IN', 0.3), outputPerMTok: envRate('RATE_GEMINI_OUT', 2.5) }, // flash-class
    // ── Gemini FLASH-LITE — a separate line, because it is NOT the same price as flash ────────────
    // 🔴 FOUND IN THE ADMIN'S OWN INVOICE (2026-09-15). Both flash-lite and flash used to resolve to
    // the 'gemini' line above, so every flash-lite turn was reported at 3x its real cost. That is the
    // margin-SAFE direction (we over-state our own spend, never a user's bill) — but the screen the
    // admin judges Google spend on was wrong, which is exactly how E2B_USD_PER_HOUR went unnoticed
    // for a month.
    // THE INPUT HALF IS INVOICE-VERIFIED, not taken from a price page: that month's SKUs read
    // "Flash GA Text Input 6,116,640 -> Rs 175.32" and "Flash Lite Text Input 5,237,016 -> Rs 50.04",
    // i.e. Rs 2.866e-5 vs Rs 9.555e-6 per unit = EXACTLY 3.0x, which reproduces $0.30 -> $0.10.
    // ⚠️ The OUTPUT half is NOT invoice-verified — no flash-lite OUTPUT SKU appeared in that report.
    // $0.40 is Google's published pair-mate for the $0.10 input that the invoice just confirmed, so
    // it is corroborated rather than guessed; `RATE_GEMINI_LITE_OUT` corrects it the day a real
    // output SKU shows a different number.
    'gemini-lite': { inputPerMTok: envRate('RATE_GEMINI_LITE_IN', 0.1), outputPerMTok: envRate('RATE_GEMINI_LITE_OUT', 0.4) },
    // ── xAI (Grok) ────────────────────────────────────────────────────────────────────────────────
    'grok': { inputPerMTok: envRate('RATE_GROK_IN', 3), outputPerMTok: envRate('RATE_GROK_OUT', 15) },
    // ── Anthropic (Claude) ────────────────────────────────────────────────────────────────────────
    'haiku': { inputPerMTok: envRate('RATE_HAIKU_IN', 1), outputPerMTok: envRate('RATE_HAIKU_OUT', 5) },
    'sonnet': sonnetRate(),
    // ── OpenAI (GPT) ──────────────────────────────────────────────────────────────────────────────
    // ⚠️ THIS COMMENT USED TO PLACE GPT ON THE WEAK TIER, AND THAT WAS STALE FOR A DAY, in the most
    // misleading way available: it was true of the admin's FIRST list
    // that morning, and the plan was revised the SAME DAY once the real GLM prices were known — GPT
    // came off every ladder. The table never had an OPENAI rung; only this sentence said otherwise,
    // and a reader who trusted it concluded weak builds were running GPT. tsc and vitest cannot see
    // a wrong comment, so nothing failed for a day.
    // THE RULE THAT REPLACES IT: do not restate another module's fact — point at the module that owns
    // it. `tierLadder.ts`'s TIER_LADDERS is the only place a rung exists, and a sentence that asserts
    // nothing can never go stale. What belongs HERE is the PRICE, which is this file's own business.
    // The price is not known, so the default is this function's "conservative upper bound" for an
    // unknown model: the Sonnet rate. ⚠️ SET `RATE_GPT_IN`/`_OUT` (and `_CACHE` if the plan has a
    // cache line) to the real published rate before GPT is ever put on a ladder. An over-stated rate
    // inflates OUR OWN cost report, never a user's bill — the safe direction, but wrong all the same.
    'gpt': { inputPerMTok: envRate('RATE_GPT_IN', sonnetRate().inputPerMTok), outputPerMTok: envRate('RATE_GPT_OUT', sonnetRate().outputPerMTok), cacheReadPerMTok: envRate('RATE_GPT_CACHE', sonnetRate().inputPerMTok) },
    // gpt-*-nano (admin 2026-09-14): GPT-5.4 Nano $0.20 / $1.25 per MTok. NOT on any ladder today —
    // the admin's own brief says Nano is for classification/extraction, never an app-generation
    // engine — but if a helper role ever uses it, it must not be billed at the full-GPT bound above.
    'gpt-nano': { inputPerMTok: envRate('RATE_GPT_NANO_IN', 0.2), outputPerMTok: envRate('RATE_GPT_NANO_OUT', 1.25) },
  };
}

/**
 * Resolve the real rate for a turn, by the ACTUAL model id when known (most exact), falling back to
 * the provider label, then to a conservative Sonnet default (never under-bill an unknown model).
 * `provider` is the ledger's normalized label ('GLM'|'KIMI'|'CLAUDE'|'CLAUDE_HAIKU'|'VERTEX'|
 * 'GEMINI'|'GROK'|'other'); `model` is TurnResult.model (may be undefined for aux calls).
 */
export function realRateFor(provider: string, model?: string): TokenRate {
  const card = realRateCard();
  const m = (model ?? '').toLowerCase();
  const p = (provider ?? '').toUpperCase();

  // Model-id first — the exact rung that ran.
  if (m) {
    if (m.includes('opus')) return { inputPerMTok: 15, outputPerMTok: 75 }; // completeness; opus tiers bill elsewhere
    if (m.includes('sonnet')) return card.sonnet;
    if (m.includes('haiku')) return card.haiku;
    // NEWER-MODEL SAFETY (autopsy 2026-07-28): these branches used to send ANY unrecognized id in the
    // family to the CHEAPEST rung — so the moment a newer flagship shipped (kimi-k3, a future glm-6) we
    // would pay flagship price and bill the k2.5/glm-4.x price, losing money on every build, silently.
    // That directly contradicted this function's own stated contract ("never under-bill an unknown
    // model"). Now: known-cheap ids are matched EXPLICITLY, and anything else in the family bills at the
    // most expensive rate we know — so an unrecognized model can only ever over-state cost, never
    // under-state it. Adding a real rate line for a new id (see 'kimi-k3') makes it exact.
    if (m.includes('glm')) {
      // 5.3-flash BEFORE the generic flash rule: the generic rule is the 4.7-flash $0 line, and a
      // "flash" in the name is not a price (see the rate line's own note).
      if (/glm-?5[.\-]?3.*flash/.test(m)) return card['glm-5.3-flash'];
      // ⚠️ flashX BEFORE the generic flash rule too, and before the /glm-?4/ coder rule — it is a
      // 4.x id containing "flash", so BOTH of the rules below would price it wrongly: the generic
      // flash line at $0 (free), the 4.x coder line at $0.60/$2.20 (8.6× its real input price).
      if (/flash-?x/.test(m)) return card['glm-4.7-flashx'];
      if (m.includes('flash')) return card['glm-flash'];
      if (/glm-?4/.test(m)) return card.glm;              // the known cheap 4.x coder
      return card['glm-5'];                                // 5.x and anything newer/unknown
    }
    if (m.includes('kimi')) {
      if (m.includes('k3')) return card['kimi-k3'];
      // highspeed BEFORE the plain k2.7 fallback: it is a distinct, dearer SKU (2x k2.7-code across
      // every column), not a suffix on the regular model, and matching it late would silently bill it
      // at half its real price — the exact defect found when this rung joined the Normal ladder.
      if (m.includes('highspeed')) return card['kimi-k2.7-highspeed'];
      // k2.6 has its OWN row since 2026-09-16: Moonshot prices it exactly like k2.7-code ($0.95/$4.00),
      // not like the retired k2.5 it used to share the cheap line with. It is the WEAK ladder's second
      // rung, so the old lumping under-stated what every free build really costs us.
      if (/k2[.\-]?6/.test(m)) return card['kimi-k2.6'];
      if (/k2[.\-]?5/.test(m)) return card.kimi;           // k2.5 — retired 2026-08-31, telemetry only
      return card['kimi-k2.7'];                            // k2.7 and anything newer/unknown
    }
    if (m.includes('gemini')) {
      if (m.includes('pro')) return card['gemini-pro'];
      // 'lite' BEFORE the generic flash rule — flash-lite is a THIRD of flash, and resolving it to
      // the flash line is the bug this entry was added to fix. Same precedence shape as glm-5.3-flash.
      if (m.includes('lite')) return card['gemini-lite'];
      return card.gemini;
    }
    if (m.includes('grok')) return card.grok;
    if (m.startsWith('gpt') && m.includes('nano')) return card['gpt-nano'];
    if (m.startsWith('gpt') || /^o\d/.test(m)) return card.gpt; // gpt-5.4 and the o-series reasoning ids
  }

  // Provider label fallback (aux calls without a model id, or unrecognized model strings).
  switch (p) {
    case 'GLM': return card.glm;
    case 'KIMI': return card.kimi;
    case 'CLAUDE_HAIKU': return card.haiku;
    case 'CLAUDE': return card.sonnet;
    case 'VERTEX':
    case 'GEMINI': return card.gemini;
    case 'GROK': return card.grok;
    case 'OPENAI': return card.gpt;
    default: return card.sonnet; // 'other'/unknown → conservative upper bound (never under-bill)
  }
}

/** The real USD cost of one usage bucket at a given rate. Pure; negatives clamp to 0. */
export function usageCostUsd(usage: BilledUsage & { cacheReadInputTokens?: number }, rate: TokenRate): number {
  const input = Math.max(0, usage.inputTokens);
  // Fix 66 billing slice — price the CACHE-HIT share of the input at the provider's (far cheaper)
  // cache-read rate. cacheRead is clamped to the input total (a provider can never cache-serve more
  // than it received), and when the rate card has no cache line the cache rate DEFAULTS to the full
  // input rate — i.e. exactly the old formula, so unknown providers/models keep the margin-safe price.
  const cacheRead = Math.min(input, Math.max(0, usage.cacheReadInputTokens ?? 0));
  const cacheRate = rate.cacheReadPerMTok ?? rate.inputPerMTok;
  return (
    ((input - cacheRead) / 1_000_000) * rate.inputPerMTok +
    (cacheRead / 1_000_000) * cacheRate +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputPerMTok
  );
}

/** One attributed slice of a build's token spend: which provider/model, and how many tokens. */
export interface ProviderCostEntry {
  provider: string;
  model?: string;
  usage: BilledUsage;
}

/**
 * The REAL provider cost (USD) of a build = Σ (each attributed slice's tokens × its real rate)
 * + the unattributed remainder priced conservatively at Sonnet rates. The remainder is the aux
 * calls (blueprint/plan/judge) the ledger never saw; pricing it at the highest cheap-fleet rate
 * keeps the total a safe upper bound so we never under-bill. Pure.
 */
export function realProviderCostUsd(entries: ProviderCostEntry[], remainder: BilledUsage = { inputTokens: 0, outputTokens: 0 }): number {
  let total = 0;
  for (const e of entries) total += usageCostUsd(e.usage, realRateFor(e.provider, e.model));
  total += usageCostUsd(remainder, sonnetRate()); // conservative: aux calls at Sonnet rate
  return total;
}

/** Small-build markup (real cost ≤ threshold). Admin default 4×. Env-tunable. */
export function markupSmall(): number {
  const n = Number(process.env.AGENTV3_MARKUP_SMALL);
  return Number.isFinite(n) && n > 0 ? n : 4;
}
/** Large-build marginal markup (on the real-cost portion ABOVE the threshold). Admin default 3×. */
export function markupLarge(): number {
  const n = Number(process.env.AGENTV3_MARKUP_LARGE);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
/** The real-cost threshold (USD) where the markup steps down from `markupSmall` to `markupLarge`. */
export function markupThresholdUsd(): number {
  const n = Number(process.env.AGENTV3_MARKUP_THRESHOLD_USD);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The admin's tiered markup applied to a REAL provider cost (USD):
 *   realCost ≤ threshold  → realCost × small           (default: ≤ $1 → × 4)
 *   realCost > threshold   → threshold × small + (realCost − threshold) × large
 *                            (default: first $1 × 4, the excess × 3)
 * Monotonic and continuous at the threshold. Pure; negative input clamps to 0.
 */
export function tieredMarkupUsd(realCostUsd: number): number {
  const c = Math.max(0, realCostUsd);
  const t = markupThresholdUsd();
  const small = markupSmall();
  const large = markupLarge();
  if (c <= t) return c * small;
  return t * small + (c - t) * large;
}

/**
 * The full, honest breakdown behind a real-cost + tiered-markup build charge (the transparency the
 * admin's cost card shows). billedUsd here EQUALS tieredMarkupUsd(realCostUsd), so the explanation can
 * never diverge from the amount charged. Pure.
 */
export interface RealCostBreakdown {
  realCostUsd: number;
  markupSmall: number;
  markupLarge: number;
  thresholdUsd: number;
  billedUsd: number;
  billedInr: number;
  usdInrRate: number;
  perProvider: { provider: string; costUsd: number }[];
}

export function explainRealCostBuild(
  entries: ProviderCostEntry[],
  remainder: BilledUsage,
  usdInrRate: number,
): RealCostBreakdown {
  const perProviderMap = new Map<string, number>();
  for (const e of entries) {
    const cost = usageCostUsd(e.usage, realRateFor(e.provider, e.model));
    perProviderMap.set(e.provider, (perProviderMap.get(e.provider) ?? 0) + cost);
  }
  const remCost = usageCostUsd(remainder, sonnetRate());
  if (remCost > 0) perProviderMap.set('other', (perProviderMap.get('other') ?? 0) + remCost);
  const realCostUsd = realProviderCostUsd(entries, remainder);
  const billedUsd = tieredMarkupUsd(realCostUsd);
  const rate = Math.max(0, usdInrRate);
  return {
    realCostUsd,
    markupSmall: markupSmall(),
    markupLarge: markupLarge(),
    thresholdUsd: markupThresholdUsd(),
    billedUsd,
    billedInr: billedUsd * rate,
    usdInrRate: rate,
    perProvider: [...perProviderMap.entries()].map(([provider, costUsd]) => ({ provider, costUsd })),
  };
}
