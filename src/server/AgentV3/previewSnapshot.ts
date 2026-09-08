// AgentV3 — A FINISHED APP SHOULD NOT NEED A RENTED COMPUTER TO STAY ALIVE.
//
// THE LAST PIECE OF THE ADMIN'S "app tute na" (2026-08-23). The others kept the sandbox alive longer
// (#2597), stopped the build churning the running app (#2599), and stopped repairs making it worse
// (#2594, #2602). All of them still assume the app lives on a machine we rent by the hour — and that
// machine is mortal by design: it pauses after five idle minutes and expires entirely soon after.
//
// When it is finally gone, the door today shows a branded "waking your preview" page that retries and
// retries against a machine that is never coming back. Honest, but the user's app is simply GONE, and
// nothing about their app was wrong.
//
// THE OBSERVATION THIS RESTS ON: by the time a build is green we HAVE the app's built output — the
// production build gate (#2604) just produced `dist/` to prove the app packages. Those bytes are the
// app. They need no VM, no port, no dev server and no wake-up: they are files, and this codebase
// already has a tested pipeline that puts files on a permanent public host (the same one Publish
// uses). So the last-known-good app is kept there, and the door hands the user THAT when the machine
// is gone.
//
// WHAT IT IS AND IS NOT, stated plainly because a snapshot that pretends to be the live app would be
// its own dishonesty:
//   • It is the app AS OF THE LAST GREEN BUILD. Edits made since are not in it.
//   • It is STATIC. A separately-deployed backend keeps working; an app whose server ran inside the
//     sandbox will not have one. That is why a full-stack app is skipped rather than half-served.
//   • It is a FALLBACK, never a replacement. While the sandbox lives, nothing here runs at all.
//
// SEPARATE CHANNEL, AND THAT IS THE LOAD-BEARING DECISION. `deployStatic` publishes to
// `makeChannelId(workspaceId)` — the very channel the user's own Publish button uses. Writing a
// snapshot there would mean an edit that broke the app silently REPLACED the working version the user
// had deliberately published. A snapshot must never be able to touch what somebody chose to ship, so
// it gets a channel of its own.
//
// PURE — no I/O, no clock.

import crypto from 'crypto';

/** Kill switch. Default ON. `off` restores the retry page for a dead sandbox. */
export function previewSnapshotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_PREVIEW_SNAPSHOT !== 'off';
}

/**
 * The Hosting channel a workspace's snapshot lives on — deliberately NOT `makeChannelId`.
 *
 * Same shape and the same length discipline (Firebase channel ids are limited), different prefix, so
 * the two can never collide however the workspace id is formed. Changing this prefix orphans existing
 * snapshots rather than corrupting anything, which is the safe direction.
 */
export function snapshotChannelId(workspaceId: string): string {
  const safe = String(workspaceId ?? '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 17);
  const hash = crypto.createHash('sha256').update(String(workspaceId ?? '')).digest('hex').slice(0, 12);
  return `sn-${safe}-${hash}`; // ≤ 3 + 17 + 1 + 12 = 33 chars, same budget as the publish channel
}

/**
 * Is this app one a static snapshot can honestly represent?
 *
 * A full-stack app's server runs INSIDE the sandbox, so a static copy would render the shell and fail
 * every request behind it — an app that looks alive and does nothing, which is worse than an honest
 * "this preview has expired". Detected from the app's own package.json rather than from the framework
 * label the client sent, because the label is a request and the scripts are a fact.
 */
export function snapshotSuitable(packageJsonRaw: string | null | undefined): boolean {
  if (!packageJsonRaw) return false;
  try {
    const pkg = JSON.parse(String(packageJsonRaw));
    const scripts = pkg?.scripts ?? {};
    if (typeof scripts.build !== 'string' || !scripts.build.trim()) return false;
    // A start script that boots a server (rather than a static preview) means the running app is more
    // than its files.
    const start = `${scripts.start ?? ''} ${scripts.serve ?? ''}`.toLowerCase();
    if (/\b(node|nodemon|ts-node|tsx|express|fastify|nest|next start|uvicorn|gunicorn|flask|django)\b/.test(start)) return false;
    const deps = { ...(pkg?.dependencies ?? {}) };
    for (const server of ['express', 'fastify', '@nestjs/core', 'koa', 'hapi', 'socket.io']) {
      if (deps[server]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the snapshot still describe the app that is in this workspace RIGHT NOW?
 *
 * True only when we can PROVE nothing has been written since it was taken: both stamps must be real
 * numbers and the last durable file write must not be newer than the snapshot. An unknown stamp is
 * NOT proof and answers false — the whole point is to replace a blanket guess with evidence, and an
 * unreadable store is exactly when a guess would be worst. PURE.
 */
export function snapshotStillCurrent(
  snapshotAt: number | null | undefined,
  lastChangeAt: number | null | undefined,
): boolean {
  const at = Number(snapshotAt);
  if (!Number.isFinite(at) || at <= 0) return false;
  const changed = Number(lastChangeAt);
  if (!Number.isFinite(changed) || changed <= 0) return false; // unknown is not proof
  return changed <= at;
}

/**
 * Should the door hand back the snapshot instead of the waiting page?
 *
 * TWO STATES, TWO DIFFERENT REASONS.
 *
 * **'asleep' — the machine is gone.** Retrying against it can never succeed, so any snapshot beats a
 * spinner. Unchanged since #2613.
 *
 * **'starting' — a machine exists but nothing is answering yet.** This used to be a flat refusal, and
 * the reason written here was sound at the time: *"a sandbox that exists but whose port has not come
 * up yet is usually seconds from serving, and replacing a live app that is still starting with a
 * STALE copy of itself would be a regression dressed as a feature — the user would silently lose the
 * edits they were waiting to see."*
 *
 * 🔒 TWO THINGS CHANGED, AND BOTH ARE WHY THIS IS NOW ALLOWED — narrowly.
 *
 * 1. **"Usually seconds" stopped being true, and our own fix is what changed it.** A cold wake meets
 *    a machine that has to install before anything can listen, and the wake budget was raised from 90
 *    seconds to ten minutes to let that finish (previewWake.ts). Ten minutes of spinner over an app
 *    we are holding a perfectly good copy of is not caution, it is a worse experience than the one
 *    the fallback was built for.
 * 2. **The fear is answerable with evidence rather than by refusing.** What the old rule actually
 *    protected against is a snapshot that is NOT this app any more. That is a fact we can check:
 *    `snapshotStillCurrent` compares the snapshot's timestamp against the last durable file write.
 *    When nothing has been written since, there are no edits to lose — the copy IS the current app —
 *    and the objection does not apply. When anything has been written, or either stamp is unknown,
 *    the refusal stands exactly as before.
 *
 * The sibling `canServeFromSnapshot` has encoded this same `lastChangeAt` reasoning since it was
 * written; it was simply never wired to anything. This is that idea reaching the door.
 *
 * 🔒 IT IS ONLY HONEST IF THE USER IS TOLD. A snapshot served here is the CURRENT app, so it cannot
 * mislead about content — but it is static, and the live server is still coming. `preview-health`
 * must report the same decision so the panel shows SNAPSHOT_WAKING_NOTE, and the frame must return to
 * the live app by itself when it is ready. Serving this without those two is the regression the old
 * rule was right to fear.
 */
export function shouldServeSnapshot(o: {
  enabled: boolean;
  /** 'asleep' = no sandbox at all. 'starting' = one exists, its port is not answering yet. */
  doorState: 'asleep' | 'starting';
  snapshotUrl: string | null | undefined;
  /** When the snapshot was taken — required for 'starting', ignored for 'asleep'. */
  snapshotAt?: number | null;
  /** The workspace's last durable file write — required for 'starting', ignored for 'asleep'. */
  lastChangeAt?: number | null;
}): boolean {
  if (!o.enabled) return false;
  if (typeof o.snapshotUrl !== 'string' || !/^https?:\/\//i.test(o.snapshotUrl)) return false;
  if (o.doorState === 'asleep') return true;
  return snapshotStillCurrent(o.snapshotAt, o.lastChangeAt);
}

/**
 * The line the surface shows while a snapshot is being served.
 *
 * The user is looking at their app, so nothing here may imply it is broken — but they MUST know it is
 * the last built version rather than the live one, or they will report a bug about an edit that simply
 * is not in this copy. Names no vendor and no machine.
 */
export const SNAPSHOT_NOTE =
  'Showing the last built version of your app — the live server for this preview has expired. Send a message and NavBharatAI will bring the live one back.';

/**
 * The line shown while the saved copy stands in for a preview that is STARTING UP.
 *
 * Deliberately different from SNAPSHOT_NOTE, because the situation is different in the two ways the
 * user cares about: nothing has expired, and they do not need to do anything. It must also not imply
 * the copy is out of date — it is only ever served when nothing has changed since it was taken
 * (snapshotStillCurrent), so calling it "the last built version" here would be a needless worry.
 * Names no vendor and no machine.
 */
export const SNAPSHOT_WAKING_NOTE =
  'Showing your saved copy while the live preview starts up. Nothing has changed since it was saved, so this is your current app — the live version takes over by itself the moment it is ready.';
