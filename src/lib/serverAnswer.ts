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

// A READ IS DATA ONLY WHEN IT IS 2xx AND HAS THE SHAPE THE SCREEN NEEDS (Q-680, 2026-10-05).
//
// The read-side sibling of the rule above. `setData(await r.json())` stored a 403 or a 500 body as if it
// were the answer: the OTP card printed "Could not read the OTP tally: undefined", the wallet statement
// drew a refusal as an empty history, and the update-broadcast preview offered to "Send an update
// notification to undefined device(s)" over a failed cohort read. So a read goes through here and the
// screen stores either the checked value or the sentence — never a body it has not looked at.

export type ReadAnswer<T> = { ok: true; value: T } | { ok: false; sentence: string };

/** The body when the response is 2xx and `isShape` accepts it; otherwise the sentence to show. */
export async function readAnswer<T>(res: Response, isShape: (body: unknown) => body is T): Promise<ReadAnswer<T>> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON — judged below */ }
  if (!res.ok) {
    const text = typeof (body as { error?: unknown } | null)?.error === 'string' ? String((body as { error: string }).error).trim() : '';
    return { ok: false, sentence: text ? text.slice(0, 300) : `The server refused the request (HTTP ${res.status}).` };
  }
  if (!isShape(body)) return { ok: false, sentence: 'The server answered in a shape this screen does not know.' };
  return { ok: true, value: body };
}

/** A plain-object check for shape guards. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
