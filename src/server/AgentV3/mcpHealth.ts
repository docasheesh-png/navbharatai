/**
 * IS THIS CONNECTED SERVICE STILL WORKING? — the honest answer, in the user's words.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * A connection is proven once, when it is made, and then trusted forever. But an API key expires, a
 * service moves, a company rotates a token — and until now the FIRST place that showed up was in the
 * middle of a build, as a service that quietly contributed nothing. The screen still said "connected"
 * the whole time, because "connected" only ever meant "we saved it".
 *
 * That is the same gap `credentialProbe.ts` closed for saved keys: storage succeeded, so we said
 * "Saved", which is true about the storage and silent about the credential. The answer is the same
 * one — ask, and report what came back.
 *
 * ═══ WHAT THIS FILE IS, AND IS NOT ═══
 *
 * PURE. It turns a probe result into a verdict and a sentence. The probing itself is `listRemoteTools`
 * in the route — so the decision, which is the part that must be right, is tested without a network.
 *
 * 🔒 THERE IS NO "PROBABLY FINE". A service that answered with tools is working; anything else is
 * reported as not working, with the reason. A check that guessed would be worse than no check, because
 * the user would stop looking.
 */

/** What a probe of one connected service came back with. */
export interface ServiceProbe {
  id: string;
  /** How many usable tools it offered. 0 means none — see `error` for whether it answered at all. */
  toolCount: number;
  /** Why it failed, when it did. Absent on success. */
  error?: string;
}

export interface ServiceHealth {
  id: string;
  state: 'working' | 'failing';
  toolCount: number;
  /** One sentence for the user. Never a stack trace, never a bare status code. */
  message: string;
}

/**
 * The verdict for one service.
 *
 * Three outcomes collapse into two states on purpose — a service that answered nothing and a service
 * that answered with an empty tool list are equally unusable to a build, and telling them apart would
 * only help someone debugging their own server, who has better tools than this screen.
 */
export function serviceHealth(probe: ServiceProbe): ServiceHealth {
  const id = String(probe?.id ?? '');
  const toolCount = Number.isFinite(probe?.toolCount) ? Math.max(0, Math.trunc(probe.toolCount)) : 0;
  if (toolCount > 0) {
    return { id, state: 'working', toolCount, message: `Working — ${toolCount} tool(s) available.` };
  }
  const reason = String(probe?.error ?? '').trim();
  return {
    id,
    state: 'failing',
    toolCount: 0,
    message: reason || 'It answered, but offered no tools. Its key may have expired.',
  };
}

/**
 * One line above the list, so the user does not have to read every row to know where they stand.
 *
 * `checked` is what was actually probed. When it is smaller than the number of connected services —
 * because the check ran out of its budget — the headline SAYS SO rather than describing the whole set
 * from a sample. "All your services are working" derived from two of five is exactly the nearly-true
 * claim this codebase keeps rooting out.
 */
export function healthHeadline(results: readonly ServiceHealth[], connectedCount?: number): string {
  const checked = results?.length ?? 0;
  if (checked === 0) return 'Nothing to check.';
  const failing = results.filter((r) => r.state === 'failing').length;
  const total = Number.isFinite(connectedCount) ? Math.max(checked, Number(connectedCount)) : checked;
  const unchecked = total - checked;
  const tail = unchecked > 0 ? ` ${unchecked} could not be checked just now.` : '';
  if (failing === 0) {
    return unchecked > 0
      ? `${checked} of your services answered and are working.${tail}`
      : checked === 1 ? 'Your connected service is working.' : `All ${checked} of your services are working.`;
  }
  return `${failing} of ${checked} are not working right now.${tail}`;
}
