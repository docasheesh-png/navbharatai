// A STATUS NOTICE IS NOT AN ERROR — the sentences the platform writes when it does NOT start a build.
//
// 🔴 THE DEFECT (failedbr #2497 → #2498, 2026-11-22). A game build was running in a workspace. The user's next
// message was refused with our own admission notice:
//
//     "Your earlier build for this app is still running — it keeps going even when the connection drops.
//      Reopen this chat in a moment to see it, or press ⏹ Stop and then send your message again."
//
// The refusal waited for the earlier build's hold to clear (up to 12 s), so the preflight stream had already
// opened and the notice arrived IN THE STREAM as an `error` event. The client's only "no build ran" marker was
// set on the HTTP-status path, so the notice was shown as a build error with "Fix with AI" under it. Pressing it
// sent "Fix this error and continue building the app:\n\n<the notice>" — and a second build ran on our own
// sentence for more than 15 minutes, without the game request, so it never got the game kit's API either.
//
// 🔑 THE CLASS. Every sentence the platform writes to say "I did not start (or could not admit) your build"
// is a STATUS NOTICE. No edit to the app answers it, so it must never be wrapped in fix-error UI, and a prompt
// that IS one (bare or wrapped in our own fix template) must never be run as a build. Three nets read this one
// list: the client (`errorCanBeFixedByEditingTheApp`), the stream (`beforeBuildStarted` on an in-stream
// refusal, BuildRequestCoordination.ts) and the server (`platformNoticeAsBuildRequest`, refused before any
// work). `tests/aPlatformNoticeIsNotAnError.test.ts` walks every refusal sentence the route can write.
//
// ⚠️ OPENINGS, NOT SUBSTRINGS: a user who QUOTES one of these mid-message is talking about it. PURE.

/**
 * The cross-instance "one build per workspace" refusal (workspaceBuildLease.ts re-exports it). States the two
 * facts the user needs: the earlier build is still working, and how to get their message through.
 */
export const BUILD_RUNNING_ELSEWHERE_MESSAGE =
  'Your earlier build for this app is still running — it keeps going even when the connection drops. ' +
  'Reopen this chat in a moment to see it, or press ⏹ Stop and then send your message again.';

/** The refusal for a platform notice sent back as a build request (`platformNoticeAsBuildRequest`). Nothing was spent. */
export const PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE =
  'That message is a NavBharatAI status notice, not a change to your app, so no build was started and nothing was charged. '
  + 'If an earlier build is still running, wait for it or press ⏹ Stop; then tell me what you want changed.';
export const PLATFORM_NOTICE_NOT_A_REQUEST_CODE = 'PLATFORM_NOTICE_NOT_A_REQUEST';

/** How every platform-written admission notice opens. */
export const PLATFORM_ADMISSION_NOTICE_OPENINGS: readonly string[] = [
  // a build already holds this workspace or this account (routes/agentv3.ts, workspaceBuildLease.ts, stoppingBuild.ts)
  'Your earlier build for this app is still running',
  'Your previous build is still stopping',
  'This app is already building in another chat',
  'A build is already running for this account',
  // the client's own wording for the same refusals (useAgentV3Build.ts)
  'A build is still running on your account',
  'Your build from before the reload was still running',
  'This build is still running — re-attached',
  // identity and transport, never the app
  'Please sign in to build with NavBharatAI Pro',
  'AgentV3 request failed (',
  'This request was blocked.',
  // the server's refusal of a notice sent back as a request (platformNoticeAsBuildRequest)
  'That message is a NavBharatAI status notice',
];

/** The account concurrency cap ("You have 3 builds running (max 3 at once)…") carries numbers, so it is a pattern. */
const ACCOUNT_CAP_NOTICE = /^You have \d+ builds? running \(max \d+ at once\)/;

/** Is this message one of the platform's own admission notices? PURE. */
export function isPlatformAdmissionNotice(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;
  return ACCOUNT_CAP_NOTICE.test(text) || PLATFORM_ADMISSION_NOTICE_OPENINGS.some((opening) => text.startsWith(opening));
}
