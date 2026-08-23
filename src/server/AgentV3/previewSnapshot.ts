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
 * Should the door hand back the snapshot instead of the waiting page?
 *
 * ONLY when the machine is genuinely gone. A sandbox that exists but whose port has not come up yet is
 * usually seconds from serving, and replacing a live app that is still starting with a STALE copy of
 * itself would be a regression dressed as a feature — the user would silently lose the edits they were
 * waiting to see.
 */
export function shouldServeSnapshot(o: {
  enabled: boolean;
  /** 'asleep' = no sandbox at all. 'starting' = one exists, its port is not answering yet. */
  doorState: 'asleep' | 'starting';
  snapshotUrl: string | null | undefined;
}): boolean {
  if (!o.enabled) return false;
  if (o.doorState !== 'asleep') return false;
  return typeof o.snapshotUrl === 'string' && /^https?:\/\//i.test(o.snapshotUrl);
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
