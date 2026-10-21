// WHERE A BUILD'S FILES ARE PUSHED (admin 2026-10-11, Q-745 (c): "a failed build's files go to a separate
// `wip/` branch; the user's branch only receives work that ran").
//
// The end-of-turn push was gated on "files were written", never on the build having worked, while the
// comment beside it said "GitHub push still happens only after 100% completion" — so a failed turn's
// half-done edits went straight onto the user's own branch (their repo's working branch, or the default
// branch of the per-project copy). THE CLASS: a write to the user's real branch decided by activity rather
// than by outcome. One decision now covers every storage mode; nothing is lost on failure, and the user's
// branch only ever holds work that ran. PURE.

export interface PushTarget {
  /** The branch the files are pushed to. */
  branch: string;
  /** True when the files go to a `wip/` branch because the build did not work — and so the user's branch,
   *  the work→base pull request and the build-branch merge are all left alone. */
  wip: boolean;
}

/** The `wip/` branch a failed build is kept on — one per attempt, so two failures never overwrite each other. */
export function wipBranchName(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `wip/build-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function gitPushTarget(input: {
  buildOk: boolean;
  /** Where a build that worked goes: the own-repo working branch, the per-build PR branch, or the copy's default branch. */
  successBranch: string;
  nowMs: number;
}): PushTarget {
  if (!input.buildOk) return { branch: wipBranchName(input.nowMs), wip: true };
  return { branch: input.successBranch, wip: false };
}

/** What the user reads when a build's files were kept on a `wip/` branch. */
export function wipPushNote(branch: string, userBranch: string): string {
  return `This build did not finish working, so its files were saved to the ‘${branch}’ branch instead — your ‘${userBranch}’ only receives work that ran. Nothing was lost.`;
}

/**
 * True when a build that did not work produced nothing but the platform's own template — there is nothing of the
 * build's to keep, so no `wip/` branch is pushed for it (autopsy b001fd78, Q5). A build that worked always pushes. PURE.
 */
export function keepsNothingOfItsOwn(input: { buildOk: boolean; seed: 'platform-template' | 'kept-seed' | null }): boolean {
  return !input.buildOk && input.seed === 'platform-template';
}

/**
 * Times the step that connects a build to the user's GitHub storage (repo create/find + first sync). It ran 7s with
 * no SETUP_TIMING line in autopsy b001fd78 (Q2), so TIME_TO_FIRST_CALL could not say where the wait went. Observation
 * only — never throws into a build. Kept out of the route, whose body is at the compiler's control-flow limit.
 */
export function recordGitConnectTiming(
  diag: { recordSetupTiming(t: { startMs: number; message: string; detail: string }): void },
  startMs: number,
  userAccount: boolean,
  connected: boolean,
  now: number = Date.now(),
): void {
  try {
    diag.recordSetupTiming({
      startMs,
      message: `GitHub storage ready in ${Math.round((now - startMs) / 1000)}s`,
      detail: `${userAccount ? 'user account' : 'platform store'} · ${connected ? 'connected' : 'not connected (fell back to the durable store)'} · repo create/find + first sync`,
    });
  } catch { /* timing is observation only — it must never affect a build */ }
}
