// What the Live preview's toolbar is allowed to SAY about where the app is running.
//
// WHY THIS EXISTS (admin 2026-09-10, the preview gap analysis). The toolbar used to print
// `effectiveUrl` verbatim — i.e. `https://3000-<sandboxId>.e2b.app`. That is the exact string the
// admin had already ordered out of the chat ("yah link dena band karo! … mera kharcha badta hai"),
// because a forwarded preview link puts other people's traffic on a machine billed BY THE MINUTE.
// Removing it from the AI's replies (PR #2739) closed one mouth; this closes the sibling one, which
// was arguably worse: the chat mentions the link in passing, but the toolbar displayed it
// permanently, selectable, on every single Live preview.
//
// It is ALSO the white-label law: `e2b.app` names a vendor, and no user-facing surface may name the
// providers behind a build. So this label is required twice over.
//
// WHAT IT IS NOT: this is not the lock. The url still reaches the iframe's `src`, so anyone who
// opens developer tools can read it — deliberately, because the real refusal lives in the door
// route, which rejects a top-level navigation before it touches a machine. This stops NavBharatAI
// OFFERING the address; the door is what makes an outside open worthless.

/**
 * A branded, honest one-line description of the running preview — never the host.
 *
 * Keeps the PORT, which is real, useful ("my app serves on 3000") and leaks nothing: it identifies
 * a process, not a machine. Everything that identifies the machine is dropped.
 *
 * PURE. Returns a usable label for every input, including junk — a toolbar that renders blank
 * because a url failed to parse would read as a broken preview.
 */
export function previewAddressLabel(url: string | null | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return 'Live server';
  const port = previewPortOf(raw);
  return port ? `Live server · port ${port}` : 'Live server';
}

/**
 * The port a preview url serves on, or '' when it cannot be read.
 *
 * Sandbox hosts encode the port as the FIRST dash-separated hostname label (`3000-<id>.e2b.app`),
 * which is why the hostname is read before `u.port` — the latter is empty on exactly those urls.
 */
export function previewPortOf(url: string | null | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const m = /^(\d{1,5})-/.exec(u.hostname);
    if (m) return m[1];
    if (u.port) return u.port;
    return '';
  } catch {
    // Not a parseable url (an older server could hand back a bare host). Read the same shape by hand
    // rather than giving up — the label is cosmetic, so a best-effort port is strictly better than
    // none, and an unreadable one simply falls through to the plain label.
    const m = /(?:^|\/\/)(\d{1,5})-/.exec(raw);
    return m ? m[1] : '';
  }
}
