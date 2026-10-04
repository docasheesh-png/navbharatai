// A WRITE IS DONE ONLY WHEN THE SERVER SAYS SO (2026-10-04).
//
// `fetch` resolves for every answer the server gives — a 401, a 403, a 500 all arrive as a normal
// Response. Code that wrote `await fetch(url, { method: 'POST' }); showToast('Member removed')` told the
// user a member was removed when the server had refused, and that member kept their access. The same
// shape cleared a share link from the screen while the link stayed live, closed the budget editor over
// a save that never happened, and dropped admin inbox rows the server still held.
//
// So a client write reads the answer through here: `null` means the server accepted it, anything
// else is the sentence to show. PURE apart from reading the body once.

/** `null` when the response is 2xx; otherwise the server's own `error` text, or the fallback. */
export async function writeFailure(res: Response, fallback: string): Promise<string | null> {
  if (res.ok) return null;
  try {
    const body = await res.json();
    const text = typeof body?.error === 'string' ? body.error.trim() : '';
    if (text) return text.slice(0, 300);
  } catch { /* a body that is not JSON carries no sentence of its own */ }
  return fallback;
}
