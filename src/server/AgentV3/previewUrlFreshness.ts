// THE URL THE USER IS LOOKING AT vs THE MACHINE WE MEASURED (admin report 2026-08-22).
//
// THE SCREENSHOT THAT PRODUCED THIS. The preview frame showed the sandbox provider's own page —
// "Sandbox Not Found. The sandbox ibhrxjts… wasn't found." — while our banner above it said:
//
//     "Dev server is up on port 3000, but NavBharatAI could not open the preview to check it, so this
//      is not a verdict about your app. Open the Preview tab and reload: whatever that page shows —
//      your app, or an error from it — is the real answer."
//
// Three failures in one frame, and the third is the worst:
//   1. A vendor's page rendered as if it were the user's app — which the white-label law forbids
//      outright, and which is frightening and meaningless to the person reading it.
//   2. "Dev server is up on port 3000" — while the machine in the URL did not exist at all.
//   3. "Whatever that page shows is the real answer" — pointing the user AT the vendor's page and
//      telling them to trust it.
//
// ROOT CAUSE, and it is this codebase's recurring one. The health probe runs INSIDE the sandbox
// (`curl 127.0.0.1:PORT`), and `getSandbox()` transparently creates a new sandbox when the old one is
// gone. So the probe genuinely succeeded — on a BRAND NEW machine — while the browser was still
// pointed at the OLD sandbox's hostname. Both statements were true about different machines, and the
// combination was a lie. The stale URL stood in for the live preview, one more time.
//
// So the health answer now carries the CURRENT url, and refuses to describe an app the user is not
// actually looking at. PURE — the comparison is the part worth being certain about.

/** Which machine is the user's frame pointed at, relative to the one we just measured? */
export type PreviewUrlVerdict =
  /** Same host — the measurement describes what they see. */
  | 'same'
  /** Different host: the sandbox was replaced. What they see is a dead machine; the fresh url is live. */
  | 'stale'
  /** One of the two is missing or unparseable — say nothing rather than guess. */
  | 'unknown';

/** The hostname, lowercased, or '' when there is nothing usable. Never throws. */
export function previewHost(url: string | null | undefined): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Is the url the client is displaying still the live one?
 *
 * Compared by HOST, not by whole string: a port path, a query or a trailing slash differ constantly
 * and mean nothing, while the host is exactly what identifies the machine.
 */
export function comparePreviewUrl(displayed: string | null | undefined, current: string | null | undefined): PreviewUrlVerdict {
  const a = previewHost(displayed);
  const b = previewHost(current);
  if (!a || !b) return 'unknown';
  return a === b ? 'same' : 'stale';
}

/**
 * May a health measurement be reported as a verdict about what the user can see?
 *
 * NO when the url is stale — we measured a different machine, so "up" would be a true sentence about
 * something the user is not looking at. That is precisely the shape of the reported bug, and it is
 * worth a named function because the temptation is always to report the reading you have.
 */
export function measurementDescribesUserView(verdict: PreviewUrlVerdict): boolean {
  return verdict !== 'stale';
}

/**
 * What to tell the user when their frame is pointed at a machine that no longer exists.
 *
 * 🔒 NAMES NO VENDOR. The user never learns that a "sandbox" exists, let alone whose — they asked for
 * a preview, and the honest sentence is about their app and what happens next. It also never blames
 * them, because nothing here was their doing: the machine expired, which is normal and ours to handle.
 */
export function stalePreviewMessage(): string {
  return 'Your preview moved to a new server — reconnecting you to it now.';
}
