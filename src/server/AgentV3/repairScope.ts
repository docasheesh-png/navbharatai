// AgentV3 — A REPAIR THE PLATFORM CHECKS ITSELF DOES NOT SPEND ITS BUDGET CHECKING ITSELF (autopsy 6cd698cc,
// 2026-10-01).
//
// The click explorer found that pressing "☀️ light" threw `Cannot read properties of undefined (reading
// 'state')`. The repair pass found the cause (a `this`-using method handed out unbound), rewrote
// `useTheme.ts` correctly and typechecked it — 61 seconds into a 150-second budget. It then restyled the
// stylesheet, ran the production build, started a dev server, published the preview, opened a browser, found
// the button, pressed it, read the console and pressed it again. The budget ran out mid-press, the platform
// undid the whole pass (its rule: a repair that does not finish is undone), the working fix went with it, and
// the user's app shipped with the broken button. ₹20.69 of engine work was absorbed for nothing.
//
// It did that because it was TOLD to: the explorer repair was handed the code reviewer's prompt
// (`judgeRepairPrompt`), whose last instruction is "After fixing, verify the app builds and the requested
// feature genuinely works". For a code review that is right — nobody else checks. For a repair the PLATFORM
// re-checks in a real browser (the explorer repair re-presses every button; the green repair re-renders) it
// spends the very budget the platform's own check needs, and it widens the job.
//
// THE CLASS: a repair whose result the platform verifies must (1) be told so and told to stop, (2) be given no
// browser of its own — by construction, not by request — and (3) not be handed extra jobs at the end of its
// turn (the style hand-back) that its budget was not sized for. PURE.

/** Said to every repair the platform re-checks in a real browser. */
export const PLATFORM_CHECKS_THE_FIX = [
  'NavBharatAI checks your fix itself the moment you stop: it opens the app in a real browser and tries it again.',
  'So do NOT start the app, a dev server or the preview, do NOT open a browser, and do NOT run the production',
  'build — that time is the check\'s, and a repair that has not finished when the time runs out is thrown away.',
  'If you changed TypeScript, run the typecheck once. Change only what the problem(s) above need — do not restyle,',
  'tidy or fix anything else. Stop as soon as the fix is written.',
].join(' ');

/** The tools a platform-checked repair does not get: the platform's check is the browser, not the model's. */
export const PLATFORM_CHECK_TOOLS: ReadonlySet<string> = new Set([
  'browser_action', 'update_preview', 'find_ui_element', 'console_errors', 'screenshot',
]);

/** The repair's tool list: everything the build had, minus a browser of its own. PURE. */
export function withoutPlatformCheckTools<T extends { name: string }>(tools: readonly T[]): T[] {
  return tools.filter((t) => !PLATFORM_CHECK_TOOLS.has(t.name));
}
