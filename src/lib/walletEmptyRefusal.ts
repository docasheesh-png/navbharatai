// "YOUR BALANCE IS EMPTY" IS AN ACTION, NOT AN ERROR — the client half (admin 2026-09-22).
//
// Admin: *"agar user ke pas balance khatam hai, to proper likh kar ana chahiye. this is paid
// service!!"* The server already sends an honest sentence and a machine-readable code
// (`walletEmptyNotice.ts`). What several screens then did with it was show it as a red failure
// beside a **Try again** button — and retrying an empty wallet cannot work, so the one control on
// offer was the one guaranteed to fail. The build panel and the Professional chat had already
// solved this properly; the image studio and the AI tools had not.
//
// 🔒 SWITCH ON THE CODE, NEVER ON THE PROSE. The sentence is written for a person and will be
// reworded; `wallet_empty` is written for this function and will not. A `.includes('balance')`
// check is how a copy edit silently turns the card back into a red error.
//
// ⚠️ A 402 ALONE IS NOT ENOUGH. Other gates in this app answer 402 for a hosting plan and a custom
// domain, and those are different offers with different buttons — so the status is necessary and
// the code is what decides.

/** The one navigation channel the app already uses to open Wallet & Billing (AgentV3Panel's own). */
export function openAddCredit(): void {
  window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }));
}

/**
 * Is this response the empty-balance refusal? Takes the parsed body, which may be anything at all —
 * a failed `res.json()` yields `null` and a proxy can return HTML, so every field is checked rather
 * than assumed.
 */
export function isWalletEmptyRefusal(status: number, body: unknown): boolean {
  if (status !== 402) return false;
  if (!body || typeof body !== 'object') return false;
  return (body as { code?: unknown }).code === 'wallet_empty';
}

/**
 * The sentence to show. The server's own text is preferred ALWAYS — it is the only one that knows
 * the real balance and whether the wallet is empty or in debt. The fallback exists for the case
 * where the body arrived without it, and deliberately states no number.
 */
export function walletEmptyMessage(body: unknown): string {
  const fromServer = body && typeof body === 'object' ? (body as { error?: unknown }).error : null;
  if (typeof fromServer === 'string' && fromServer.trim()) return fromServer.trim();
  return 'Your balance is empty. NavBharatAI is pay-as-you-go — add credit to carry on, and you only pay for what you actually use.';
}

/**
 * The one call a screen makes: the sentence to show when this response IS the empty-balance
 * refusal, or `null` when it is an ordinary failure that a **Try again** can still fix.
 *
 * 🔒 It exists so a screen cannot recognise the refusal and then forget to take the server's
 * wording — the two halves were separate calls at the first call site, and five more were about to
 * copy that shape. One call, one decision, no way to do half of it.
 */
export function walletEmptyRefusalMessage(status: number, body: unknown): string | null {
  return isWalletEmptyRefusal(status, body) ? walletEmptyMessage(body) : null;
}
