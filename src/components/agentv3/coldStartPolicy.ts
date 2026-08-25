// Should the v5 chat show its cold-start surface? PURE, so the rule is testable and cannot drift
// into a second copy inside the 5,000-line panel.
//
// 🔒 ROOT CAUSE THIS EXISTS TO KILL (admin report 2026-08-25, screenshot). "Make it yours" on a store
// app lands the user on the v5 chat, and they were shown the whole cold-start surface — "describe an
// app to build", the Event platform / Notes / Portfolio starter cards, "Screenshot → App" — directly
// above the green "<app> is yours now" banner. Offering a blank-slate template picker in the same
// breath as handing someone an app is the product contradicting itself.
//
// The block was gated on `convo.length === 0`, which asks "is the chat empty?". After a remix the
// chat IS empty — the user never typed anything — while the workspace already holds every copied
// file. AN EMPTY CHAT AND NOTHING TO WORK ON ARE NOT THE SAME THING, and this is the case that proves
// it. The question is "does this session already have an app?".

export interface ColdStartInput {
  /** Messages in the visible thread. */
  convoLength: number;
  /** Which lane the chat is in. Starters and the "describe an app" line are Build-only. */
  chatMode: 'build' | 'planner' | 'advisor';
  /**
   * A store remix handed this session a workspace. Known SYNCHRONOUSLY on the very first render,
   * which is what closes the first-paint window: the arrival message that would otherwise hide the
   * block only appears once the durable file fetch resolves, and the starters sat on screen until
   * then — the exact frame the admin screenshotted.
   */
  arrivedViaRemix: boolean;
  /**
   * How many durable files the rehydrate has loaded FOR THIS WORKSPACE (null = not loaded yet).
   * The reload-proof half: the handoff is consumed from sessionStorage once and the arrival message
   * is local UI state, so after a refresh this is the only thing that still knows an app is here.
   */
  workspaceFileCount: number | null;
}

/**
 * True when this session already has an app to work on.
 *
 * Two signals, each covering the other's blind spot — the handoff knows immediately but not after a
 * reload; the file list knows on every mount but not on the first paint. Either one is sufficient.
 */
export function sessionHasApp(input: Pick<ColdStartInput, 'arrivedViaRemix' | 'workspaceFileCount'>): boolean {
  if (input.arrivedViaRemix) return true;
  return (input.workspaceFileCount ?? 0) > 0;
}

/**
 * Whether to render the cold-start surface (the "describe an app" line, saved templates, starter
 * cards and Screenshot → App).
 *
 * Suppressed in BUILD when the session already has an app — the arrival card carries the next step
 * ("tell me what to change") and a template picker would contradict it. Plan and Advise keep their
 * one-line explainer: after a remix, "describe a goal and I'll plan it with you (aware of your
 * build)" is still exactly right, and blanking it would leave a bare screen.
 */
export function showColdStart(input: ColdStartInput): boolean {
  if (input.convoLength > 0) return false;
  if (input.chatMode !== 'build') return true;
  return !sessionHasApp(input);
}
