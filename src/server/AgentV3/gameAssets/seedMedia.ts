/**
 * THE 3D ASSETS AND THE SOUNDS ARE PREPARED SIDE BY SIDE (Q-3471, failedbr #2523, admin option A 2026-11-27).
 *
 * #2523's new-game seed ran the recipes (30.5 s), then the 3D assets (21.4 s), then the sounds (13.8 s): 74 s before the
 * builder's first call. Neither preparer can start beside the RECIPES — the assets need the recipes' 3D layer and starter
 * player file, the sound files import the kit's audio module — so that order stays. But the two preparers do not need each
 * other: they only shared a download origin, through a permit that refused the second waiter. The permit now queues a
 * request for its turn (assetProviderBudget.ts, one request a second per origin unchanged), and the durable asset index
 * they both write is updated one save at a time (WorkspaceAssetStore.ts), so they run together here.
 *
 * Each part keeps its OWN measured duration, and the report says they overlapped and how long the pair took together —
 * never a sum, as if they still ran one after the other, and never one figure standing for both.
 */

export interface SeedMediaPart<T> {
  /** The preparer's result; absent when it threw. */
  value?: T;
  /** Wall time from this part's start to its own end. */
  ms: number;
  failed: boolean;
}

export interface SeedMediaResult<A, S> {
  assets?: SeedMediaPart<A>;
  sounds?: SeedMediaPart<S>;
  /** Wall time from the first start to the last end. */
  wallMs: number;
}

async function timed<T>(run: () => Promise<T>, now: () => number): Promise<SeedMediaPart<T>> {
  const startedAt = now();
  try {
    const value = await run();
    return { value, ms: now() - startedAt, failed: false };
  } catch {
    return { ms: now() - startedAt, failed: true }; // each preparer's floor (procedural kit, built-in voices) stays
  }
}

/** Run whichever preparers apply, at the same time. Never throws: a part that throws is reported as failed. */
export async function prepareSeedMediaSideBySide<A, S>(
  parts: { assets?: () => Promise<A>; sounds?: () => Promise<S> },
  now: () => number = Date.now,
): Promise<SeedMediaResult<A, S>> {
  const startedAt = now();
  const [assets, sounds] = await Promise.all([
    parts.assets ? timed(parts.assets, now) : Promise.resolve(undefined),
    parts.sounds ? timed(parts.sounds, now) : Promise.resolve(undefined),
  ]);
  return { ...(assets ? { assets } : {}), ...(sounds ? { sounds } : {}), wallMs: now() - startedAt };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * The seed timing after the recipes, for GAME_KIT_SEEDED's detail. `assetsStatus` / `soundsSummary` describe what each
 * produced (e.g. "prepared", "prepared, 18 ready, 2 kept built-in").
 */
export function seedMediaTimingDetail(media: SeedMediaResult<unknown, unknown>, describe: { assetsStatus?: string; soundsSummary?: string }): string {
  let out = media.assets
    ? ` · 3D assets ${seconds(media.assets.ms)} (${media.assets.failed ? 'failed' : describe.assetsStatus || 'unknown'})`
    : ' · 3D assets not prepared';
  if (media.sounds) out += ` · sounds ${seconds(media.sounds.ms)} (${media.sounds.failed ? 'failed' : describe.soundsSummary || 'unknown'})`;
  if (media.assets && media.sounds) out += ` — side by side, ${seconds(media.wallMs)} together`;
  return out;
}
