// AgentV3 — LIVE FILE SYNC: the Files tab and Code Studio show the app as it is being written.
//
// 🔴 WHAT WAS WRONG (admin 2026-09-20: "file and code studio runtime par live sync hona chahiye").
// The engine already streams a `file_changed` event on every write, and three surfaces listen to it.
// Two of them are live because the event carries everything they need: the PREVIEW reloads, and the
// Files tab's LIST grows. The third needs something the event does not carry — the file's CONTENT —
// so the client has to go and fetch it, and the only fetch it had read the WHOLE workspace. That is
// expensive enough that the client was written to do it at three safe moments only: when the tab is
// opened, when the build finishes, and on a cold reopen. None of those is "while the build runs".
//
// So a file created mid-build showed a name with no content until the build ended, a file EDITED
// mid-build showed its content from BEFORE the build, and Code Studio (fed from the same cache, on
// `done` alone) showed the old project for the entire run.
//
// 🔑 THE FIX IS A SECOND QUESTION, NOT A SECOND SOURCE. "Which files changed?" is already answered,
// live, by the stream. "What is in them?" is answered by a READ — and a read of the four paths that
// just changed costs four reads, not a workspace scan. The client knows exactly which paths those
// are, because it received the events. Nothing new has to be measured, persisted or invented; the
// existing route is asked a narrower question.
//
// ⚠️ WHY THE CONTENT IS NOT PUT ON THE EVENT INSTEAD, which was the obvious first idea and is wrong.
// `AgentEventStream` keeps a 500-event replay buffer IN MEMORY per live build, so a late-mounting
// surface can catch up. Attaching file bodies to `file_changed` would put megabytes of source into
// that buffer for every concurrent build, to serve a surface that is usually not even open. A
// notification belongs on the stream; a payload belongs behind a request the client makes when it
// actually wants it.
//
// 🔒 WHY A TARGETED READ IS SAFER THAN THE FULL ONE HERE, not merely cheaper. The client's
// whole-workspace load REPLACES its file map. Mid-build the sandbox is being written to, so a full
// read can legitimately come back with a partial or half-landed set — which is precisely why the
// rehydrate path refuses to run during a build and says so in its own comment. A named read can only
// ever UPSERT the paths it was asked for, so the surfaces cannot lose a file to a badly-timed read.
//
// Kill switch: AGENTV3_LIVE_FILE_SYNC=off → the route answers `liveSync: false`, the client stops
// asking for the rest of the build, and every surface behaves exactly as it did before this existed.

import { envFlag } from '../lib/envFlag';

/**
 * Is live file sync on? Default ON — the surfaces being stale during a build is the defect, so the
 * env is a kill switch rather than an opt-in. Read at call time so a toggle needs no redeploy.
 */
export function liveFileSyncEnabled(): boolean {
  return envFlag('AGENTV3_LIVE_FILE_SYNC', true);
}

/**
 * The paths a client asked to be re-read, as a validated list — or `null` when the request named no
 * paths at all.
 *
 * `null` and `[]` are deliberately DIFFERENT answers, and the whole route branch turns on it: a
 * request with no `paths` key is the original whole-workspace read and must stay byte-identical,
 * while a request that named paths and had every one of them rejected is a targeted read that
 * legitimately returns nothing. Collapsing the two would make a client that asked for one malformed
 * path receive the entire workspace instead — the opposite of what it asked for, on the exact path
 * this module exists to keep cheap.
 *
 * Eligibility (excluded directories, secrets, binaries, size) is NOT decided here: it belongs to
 * `collectNamedWorkspaceFiles`, which owns that rule for the whole-workspace read too. This function
 * only answers "did the caller name paths, and which of them are strings?". Pure.
 */
export function requestedSyncPaths(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string') continue;
    const trimmed = p.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
