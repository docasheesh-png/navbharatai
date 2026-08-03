// AgentV3 — REPEATED-PROBE LOOP BREAKER (SaaS/restaurant "continue" autopsy 2026-07-21).
//
// ROOT CAUSE it closes: a weak model (Haiku, after a GLM fallback) chased a type-import problem that did
// NOT exist — it ran the SAME `grep "from '../types'"` ~6 times (every run returned no match) plus `tsc`
// repeatedly, never learning that the search was empty, and the build ended ok:None (never converged). A
// model that re-issues the EXACT same non-progressing call again and again is stuck in a loop; the engine
// should notice and steer it to change approach instead of letting it burn the step budget.
//
// This is a PURE, deterministic detector: it counts identical tool calls (tool name + normalized input) and,
// when the same call crosses a threshold, returns ONE corrective steer for that signature (never repeated,
// never blocking — it only advises). Flag-gated (AGENTV3_LOOP_GUARD, default ON; =off disables). Best-effort:
// a bad signature never throws.

export interface RepeatProbeState {
  /** signature → how many times this exact call has been seen. */
  counts: Map<string, number>;
  /**
   * signature → the call-count at which this signature must be steered NEXT. Starts at the threshold and
   * DOUBLES after each steer, so the guard advises at 3, 6, 12, 24… identical calls: firm enough to break a
   * real loop, sparse enough never to spam a turn.
   */
  steerAt: Map<string, number>;
}

export function newRepeatProbeState(): RepeatProbeState {
  return { counts: new Map(), steerAt: new Map() };
}

export function loopGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_LOOP_GUARD ?? '').trim().toLowerCase() !== 'off';
}

/** How many identical calls before the guard steers (the 3rd identical call trips it). Env-tunable. */
export function loopGuardThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AGENTV3_LOOP_GUARD_THRESHOLD);
  return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : 3;
}

/**
 * A STABLE signature for a tool call: the tool name + a canonical JSON of its input (keys sorted, so key
 * order never changes the signature). Long string values are hashed-by-length-capped so a giant write_file
 * body doesn't bloat memory while still distinguishing different bodies. Pure; never throws.
 */
export function probeSignature(toolName: string, input: unknown): string {
  let inputKey: string;
  try {
    inputKey = canonical(input);
  } catch {
    inputKey = '<unserializable>';
  }
  return `${toolName}::${inputKey}`;
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    // Cap very long scalars so a huge file body stays bounded but still distinct (length + head).
    return s.length > 200 ? `${s.length}:${s.slice(0, 120)}` : s;
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${k}:${canonical(obj[k])}`).join(',')}}`;
}

/**
 * Record one tool call and return a corrective steer IF this exact call has now repeated to the threshold
 * (and has not already been steered). Returns null otherwise. Pure over the injected state (mutates the
 * counts/steered maps by design — one state object per build run).
 */
export function recordAndCheckRepeat(
  state: RepeatProbeState,
  toolName: string,
  input: unknown,
  threshold = 3,
): string | null {
  const sig = probeSignature(toolName, input);
  const n = (state.counts.get(sig) ?? 0) + 1;
  state.counts.set(sig, n);
  const due = state.steerAt.get(sig) ?? threshold;
  if (n < due) return null;
  // ESCALATE (autopsy 2026-08-02): the guard used to steer ONCE per signature and then stay silent
  // forever. A build that ignored the single nudge at minute 13 churned on to minute 30+ with the engine
  // saying nothing more. Now the next steer is scheduled at double the current count, so a model that
  // keeps repeating the same dead call is told again — louder each time — instead of silently looping.
  state.steerAt.set(sig, n * 2);
  return repeatProbeSteer(toolName, n, threshold);
}

/**
 * The model-facing advice for a detected loop. ESCALATES with how far past the threshold the repeat has
 * gone: the first nudge advises a change of approach; a repeat that survived an earlier nudge is told
 * plainly that the call is now BANNED for the rest of the build and that it must finish with what it has.
 * Pure.
 */
export function repeatProbeSteer(toolName: string, times: number, threshold = 3): string {
  const escalated = times >= threshold * 2;
  const head = escalated
    ? `[LOOP GUARD — FINAL] You have now issued the SAME \`${toolName}\` call ${times} times, INCLUDING after ` +
      `being told to stop. This call is banned for the rest of this build — issuing it again wastes the ` +
      `remaining budget and the app will ship unfinished.`
    : `[LOOP GUARD] You have issued the SAME \`${toolName}\` call ${times} times and it keeps returning the ` +
      `same result — repeating it will not make progress. STOP and change approach:`;
  const body = escalated
    ? `\n• Accept the current result as final and DO NOT verify it again.\n` +
      `• Move straight to the next unfinished item and complete the app with what you already know.\n` +
      `• If you believe you are blocked, write what is missing into the summary and finish — do not loop.`
    : `\n• If a search (grep/read) keeps finding nothing, what you're looking for does NOT exist there — accept ` +
      `that and move on, or search differently.\n` +
      `• If an edit keeps failing, read_file the target FIRST and copy the exact current text before editing.\n` +
      `• Do not re-issue this identical call again. Take the next concrete step toward finishing the app.`;
  return head + body;
}

/**
 * Given the tool calls of ONE turn, record them all and return a SINGLE combined steer for any that tripped
 * the loop threshold (deduped), or null. The one entry point AgentRunner calls. Best-effort; never throws.
 */
export function collectRepeatProbeSteer(
  state: RepeatProbeState,
  toolUses: ReadonlyArray<{ name?: unknown; input?: unknown }>,
  threshold = 3,
): string | null {
  const steers: string[] = [];
  for (const tu of toolUses) {
    try {
      const name = typeof tu?.name === 'string' ? tu.name : 'tool';
      const s = recordAndCheckRepeat(state, name, tu?.input, threshold);
      if (s) steers.push(s);
    } catch { /* never let the guard break a build */ }
  }
  if (steers.length === 0) return null;
  // De-dupe identical steer bodies (two loops of the same tool) and bound the message.
  return [...new Set(steers)].slice(0, 3).join('\n\n');
}
