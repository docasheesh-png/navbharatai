// AgentV3 — WHEN A FINISHED APP NO LONGER NEEDS ITS MACHINE.
//
// THE BIGGEST REMAINING COST LEVER, and the numbers say so. Measured over 30 days (admin's own E2B
// dashboard): 1,257 sandboxes, 1,498 vCPU-hours — an average of **1.19 hours billed per sandbox**. The
// builds those sandboxes exist for take 3-18 minutes. So roughly SIX SEVENTHS of every rupee we pay
// E2B is for a machine that is not building anything.
//
// The idle sweep already pauses an unused sandbox in 5 minutes, and the orphan window is now 20. What
// keeps the remaining hour alive is US: the Live tab's health watchdog probes every 150 seconds by
// RUNNING A COMMAND INSIDE THE SANDBOX, and any sandbox command refreshes the idle clock. The watchdog
// exists for a good reason — it is what notices a dead preview and heals it — but while it runs, the
// 5-minute sweep can never win. A preview left open therefore bills for as long as the tab is open.
//
// THE OBSERVATION THAT MAKES THIS FIXABLE: once a build is FINISHED and a VM-free snapshot of it
// exists (#2613), the machine is no longer the only place the user's app lives. We can show them the
// app without touching the sandbox at all — and the moment we stop touching it, the sweep it was
// beating pauses it, at no loss to the user.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It never applies while a build is running (the machine IS the
// work), never to a full-stack app (its server lives inside the sandbox — see previewSnapshot.ts), and
// never without a snapshot that actually exists. In every one of those cases the watchdog behaves
// exactly as it does today. It is a way to stop paying for a machine nobody needs, not a way to stop
// watching one somebody does.
//
// AND IT COSTS THE USER NOTHING TO BE WRONG: if they edit the app, the next build resumes the sandbox
// by id with its files; if they interact with a paused preview, the door resumes it. The worst case is
// a resume they would have paid for anyway.
//
// PURE — no I/O, no clock.

export interface SnapshotServeInput {
  /** Is a build running for this workspace right now? The machine IS the work — never interfere. */
  buildRunning: boolean;
  /** A permanent VM-free copy of this app, from its last successful build. */
  snapshotUrl: string | null | undefined;
  /** When that snapshot was taken (epoch ms), and `now`, so staleness is a fact rather than a guess. */
  snapshotAt: number | null | undefined;
  now: number;
  /**
   * Has anything changed since the snapshot was taken? Epoch ms of the last durable file write.
   * A snapshot older than the user's latest edit is the WRONG app to show, however cheap it is.
   */
  lastChangeAt?: number | null;
}

/**
 * How long a snapshot may be trusted as "this is the app".
 *
 * Not a correctness bound — a snapshot does not rot — but a HONESTY bound. Past a day the odds that the
 * workspace moved on in some way we did not record grow faster than the saving is worth, and falling
 * back to the live machine is always safe. Cheap insurance against a stale copy being shown as current.
 */
export const SNAPSHOT_TRUST_MS = 24 * 60 * 60_000;

/**
 * May the health check stop touching the sandbox and let the snapshot answer for the app?
 *
 * Every condition is a reason NOT to, which is the right shape: the default is today's behaviour, and
 * this only ever turns the probe OFF where keeping it on buys nothing.
 */
export function canServeFromSnapshot(i: SnapshotServeInput): boolean {
  if (i?.buildRunning) return false;
  const url = i?.snapshotUrl;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  const at = Number(i?.snapshotAt);
  const now = Number(i?.now);
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) return false;
  if (now - at > SNAPSHOT_TRUST_MS) return false;      // too old to speak for the app
  if (now < at) return false;                          // clock went backwards — trust nothing
  // A change AFTER the snapshot means the snapshot is not this app any more.
  const changed = Number(i?.lastChangeAt);
  if (Number.isFinite(changed) && changed > at) return false;
  return true;
}

/**
 * The line the surface shows while the machine is deliberately left asleep.
 *
 * It must not read as a fault or as a downgrade — nothing is wrong and nothing is missing. It says the
 * one thing the user could otherwise be surprised by: edits will bring the live server back.
 */
export const SNAPSHOT_IDLE_NOTE =
  'Showing your finished app from its saved copy, so no server is left running for it. Send any change and the live server comes straight back.';
