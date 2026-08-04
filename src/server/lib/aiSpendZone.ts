// Collect what an AI-backed request COST, wherever inside it the model was actually called.
//
// THE PROBLEM THIS SOLVES. Charging the wallet needs the cost of the turn, and the cost is known deep
// inside `callProfessionalAIWithUsage` — while the user, the pass status and the wallet are known up in
// the route. Threading the cost back out means changing the return type of every function between the
// two, and the Other-AI tools do not share one shape: the App Debugger fans out over BATCHES of files
// (many model calls for one request), the design routes call it once, the investigate route calls it
// again inside another handler. Six call sites, six different plumbing jobs, and a seventh tool added
// later silently bills nothing.
//
// That is the same fragility `noClaudeZone` was built to remove — "threading a boolean through N call
// sites is fragile by design: one missed site = one silent leak" — so this uses the same mechanism. The
// route opens a zone; every model call in any awaited descendant records its own cost into it; the
// route charges ONCE for the total. A tool that does nothing but call the shared chain is billed
// correctly without a line of its own, and a multi-call tool is billed for all its calls rather than
// the last one.
//
// Nothing here decides WHETHER to charge — aiTurnCharge.ts owns that, including the rule that an
// unmeasured turn is never billed. This only gathers the evidence.
//
// Pure Node built-in; no dependencies.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatTurnUsage } from './chatSpend';

interface SpendZoneState {
  turns: ChatTurnUsage[];
}

const storage = new AsyncLocalStorage<SpendZoneState>();

/**
 * Record one model call's usage into the surrounding zone, if there is one.
 *
 * Called from the shared routing layer, so a tool inherits billing simply by using it. A no-op outside
 * a zone — a background job or an internal call that nobody is billing must not fail because of it.
 */
export function recordAiSpend(usage: ChatTurnUsage | null | undefined): void {
  if (!usage) return;
  const state = storage.getStore();
  if (!state) return;
  state.turns.push(usage);
}

/**
 * Run `fn` inside a spend zone and hand back its result together with every model call it made,
 * in order.
 *
 * The zone is per-request: two concurrent requests each get their own store, so one user's tokens can
 * never be attributed to another. Costs are returned even when `fn` THROWS — a tool that made three
 * expensive calls and then failed on the fourth really did spend that money, and pretending otherwise
 * would quietly under-report our own cost. The caller decides what to do with a failed request's spend
 * (today: the tool routes charge only on success, matching "a build that fails is never charged").
 */
export async function runInAiSpendZone<T>(fn: () => Promise<T>): Promise<{ result: T; spend: ChatTurnUsage[] }> {
  const state: SpendZoneState = { turns: [] };
  const result = await storage.run(state, fn);
  return { result, spend: state.turns };
}

/**
 * Everything the surrounding zone has recorded so far, or an empty list outside one.
 *
 * This is what lets a route charge at exactly the point it already decided the action SUCCEEDED —
 * beside the existing `burnToolAction` call — instead of restructuring its handler. The two answer the
 * same question ("did this really work?"), so they belong together.
 */
export function currentAiSpend(): ChatTurnUsage[] {
  return storage.getStore()?.turns.slice() ?? [];
}

/**
 * Wrap an Express handler so everything it does runs inside a fresh spend zone.
 *
 * Applied at registration, so a route opts into billing with one word and cannot forget to close the
 * zone. Per-request by construction: concurrent requests never share a store, so one user's tokens can
 * never be attributed to another.
 */
export function inAiSpendZone<Req, Res>(
  handler: (req: Req, res: Res) => Promise<unknown> | unknown,
): (req: Req, res: Res) => Promise<void> {
  return async (req: Req, res: Res): Promise<void> => {
    await runInAiSpendZone(async () => { await handler(req, res); });
  };
}

/** As above, but reports the spend even on failure — see the note about a tool that fails part-way. */
export async function collectAiSpend<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T; spend: ChatTurnUsage[] } | { ok: false; error: unknown; spend: ChatTurnUsage[] }> {
  const state: SpendZoneState = { turns: [] };
  try {
    const result = await storage.run(state, fn);
    return { ok: true, result, spend: state.turns };
  } catch (error) {
    return { ok: false, error, spend: state.turns };
  }
}
