// AgentV3 — system-prompt cache-prefix optimization (pure, flag-gated).
//
// COST ROOT CAUSE (perf/cost audit 2026-07-18): the ~46KB STATIC architect build-prompt is an ideal
// Anthropic prompt-cache target — but the route PREPENDS ~12 per-request/per-day context blocks (today's
// date, user prefs, ADRs, grounding, …) to its HEAD. The cache breakpoint sits on the whole system text
// block, and cache matching is PREFIX-based up to that breakpoint — so a head that changes every request
// (the date alone changes daily) busts the cache for the ENTIRE 46KB static body, every build. The static
// body ends up as a SUFFIX behind volatile prepends instead of a stable cache PREFIX.
//
// THE FIX (opt-in AGENTV3_CACHE_PREFIX=on): move the accumulated volatile prefix OUT of the cached system
// block and into the per-turn USER message, leaving the large static body as a stable cache prefix that
// hits cache on every build (cache reads are ~0.1× the input rate). The model still sees identical content
// — only its placement (system head → user turn) changes — so quality is unaffected; and it ships DORMANT
// (default off) so the live build path is byte-for-byte unchanged until the admin flips it and A/B-watches.
//
// This module is PURE + framework-free so the split is fully unit-testable without the route.

/** The separator the route uses between prepended context blocks and the static architect prompt. */
export const SYSTEM_BLOCK_SEPARATOR = '\n\n---\n\n';

/**
 * Split a fully-assembled system prompt (volatile prefix + separator + static body) back into its stable
 * static body and the volatile prefix, so the caller can cache the static body and relocate the prefix.
 *
 * `finalSystem` is what the route built by prepending context blocks to `staticSystem`; because prepends
 * only ever add to the FRONT, `finalSystem` always ENDS WITH `staticSystem`. Returns:
 *   - system:   the pure static body (the stable cache prefix)
 *   - preamble: the volatile prefix that was in front of it (trailing separator trimmed), or '' if none
 *
 * Safety: if `finalSystem` does not end with `staticSystem` (an unrecognized shape — e.g. a future code
 * path that also mutates the tail), it is a NO-OP that returns the input unchanged, so the split can only
 * ever preserve content, never corrupt the prompt. Pure + deterministic.
 */
export function splitCachedSystem(
  finalSystem: string,
  staticSystem: string,
): { system: string; preamble: string } {
  if (finalSystem === staticSystem) return { system: staticSystem, preamble: '' };
  if (!staticSystem || !finalSystem.endsWith(staticSystem)) {
    return { system: finalSystem, preamble: '' }; // unrecognized shape → no-op (never corrupt the prompt)
  }
  let preamble = finalSystem.slice(0, finalSystem.length - staticSystem.length);
  if (preamble.endsWith(SYSTEM_BLOCK_SEPARATOR)) {
    preamble = preamble.slice(0, preamble.length - SYSTEM_BLOCK_SEPARATOR.length);
  }
  return { system: staticSystem, preamble };
}
