/**
 * THE RULES THE USER NAMED, AS PROVED BY PLAYING — reported once, from the route's playtest (admin 2026-11-24: "enemy add
 * karo, jisko kill karne se score bade, par navbharatai yeh nahi kar pata"). One call; the route's handler only shrinks.
 *
 * - Every probed rule that worked → GAME_RULES_CHECKED (info): the user is told which rules were really seen working.
 * - Any rule that did NOT work → GAME_RULE_BROKEN (warning), with a one-tap fix (buildFindingSuggestions) that hands the
 *   builder the exact rule and the kit's own events to wire it to.
 * - A rule that could not be checked is said as such inside the same line, never counted as working or broken.
 * Evidence only: it never gates, charges, edits or undoes anything. Never throws.
 */
import { ruleProbeMessage, type RuleProbe } from '../gamePlaytest';

export interface RuleProbePorts {
  record: (issue: { phase: 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }) => void;
  say: (text: string) => void;
}

export function reportRuleProbes(probes: readonly RuleProbe[] | null | undefined, ports: RuleProbePorts): string | null {
  try {
    const list = Array.isArray(probes) ? probes : [];
    const message = ruleProbeMessage(list);
    if (!message) return null;
    const broken = list.some((p) => p.verdict === 'not-held');
    const code = broken ? 'GAME_RULE_BROKEN' : 'GAME_RULES_CHECKED';
    ports.record({ phase: 'preview', severity: broken ? 'warning' : 'info', code, message, autoResolved: !broken });
    ports.say(`🎮 ${message}`);
    return code;
  } catch { return null; }
}
