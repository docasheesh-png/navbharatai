// The routes App Check guards — ONE list, read by BOTH sides.
//
// The server refuses (in `enforce`) exactly these; the browser attaches its token to exactly these. Two
// copies would agree on the day they were written and not afterwards — and a route the server guards
// but the client forgets would be refused for every real user the moment enforcement is switched on.
//
// Every entry spends money and is called only by our own app. POST only: a GET here would be a
// navigation, which cannot carry a header. The Developer API (`/api/chat/completions`, API-key auth)
// and every webhook are deliberately absent — outside servers call those by design.

const PROTECTED: RegExp[] = [
  /^\/api\/agentv3\/chat\/?$/,                          // a build: model calls + a VM
  /^\/api\/chat\/navbharat(ai)?\/?$/,                   // free and paid chat
  /^\/api\/image\/generate\/?$/,                        // image generation (paid rungs)
  /^\/api\/professionals?\/[^/]+\/(chat|exam)\/?$/,    // Professionals, Doctor AI, Exam mode
  /^\/api\/repo-analyst\/chat\/?$/,                   // the Repo Analyst professional
  /^\/api\/auth\/send-otp\/?$/,                         // an SMS we pay for
];

/** Does App Check guard this request? PURE. `path` may carry a query string. */
export function isAppCheckProtected(method: string, path: string): boolean {
  if (String(method || 'GET').toUpperCase() !== 'POST') return false;
  const p = String(path || '').split('?')[0].split('#')[0];
  return PROTECTED.some((re) => re.test(p));
}
