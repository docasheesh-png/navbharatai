/**
 * 🔴 A REPAIR THE PLATFORM ASKED FOR IS NOT A REQUEST THE USER MADE (autopsy 1be16985, 2026-10-01).
 *
 * After the biology app was built, the end-of-build design check sent a repair pass in. Its
 * instruction arrives as the model's USER message, so the model answered the user: *"I have completed
 * the specific fixes you requested"* — and every turn's text is narrated into the user's chat. The
 * user, who asked for a biology app and nothing else, was thanked for requesting fixes they never saw.
 *
 * The class: every one of the platform's repair passes (design, compile, hooks, stubs, boot-killers,
 * feature presence, the vaccine, red-team, runtime errors, the reviewer's repairs) speaks to the model
 * in the user's seat. This line, placed in front of the instruction by AgentRunner when its caller
 * marks the run `platformRequest`, tells the model who is asking and who will read its reply. PURE.
 */
export const PLATFORM_REQUEST_PREFIX =
  '[This instruction comes from NavBharatAI\'s own checks, not from the user — the user only asked for the app, '
  + 'and will read your reply. Do the work. In your reply, say plainly what you changed in the app; never say '
  + 'the user asked for it or requested it, and do not ask the user anything.]\n\n';

export function asPlatformRequest(prompt: string): string {
  const text = String(prompt ?? '');
  return text.startsWith(PLATFORM_REQUEST_PREFIX) ? text : PLATFORM_REQUEST_PREFIX + text;
}
