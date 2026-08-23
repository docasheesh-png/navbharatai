// AgentV3 — THE PREVIEW STAYS ALIVE WHILE SOMEONE IS ACTUALLY USING THE APP.
//
// THE REPORTED FAILURE (admin 2026-08-23): "app ban kar ready thi, user bani huyi app chala raha tha…
// lagbhag 5-6 min… fir baad me apne aap break ho gayi." A finished, working app died under its user
// after roughly five minutes. The admin called it life-threatening for NavBharatAI, and it is.
//
// THE ARITHMETIC IS THE WHOLE STORY. The idle sweep pauses a sandbox after 300s of no SANDBOX
// operation, and a person using their app performs none — their browser talks to the sandbox host, not
// to us. The Live tab's watchdog (previewKeepAlive.ts, client side) covers that by probing every 150s,
// and its own comment says plainly that this is what keeps the VM alive. But that watchdog only runs
// while SIX client-side conditions hold: autoResume, mode === 'live', a workspace, the URL, the
// sandbox flag, and — added 2026-08-17 to stop a left-behind preview burning ~₹7/hour — the preview
// pane being the visible surface INSIDE our app.
//
// AND THE "OPEN IN NEW TAB" LINK POINTED AT THE RAW SANDBOX URL. So the moment a user popped their app
// out to look at it properly, the tab they were using had none of our JavaScript, our own tab was
// backgrounded, every one of those six conditions stopped holding, and the sweep paused the machine
// out from under an app someone was actively using. Because the popout bypassed the preview door, they
// did not even get our branded retry page — they got the vendor's "Sandbox not found", which is the
// exact screenshot this codebase has been chasing all week.
//
// THE CLASS, ONE LEVEL UP: "our pane is in the foreground" was standing in for "someone is using this
// app". Those two are not the same fact, and they come apart in precisely the case where the user is
// most engaged. So the fix does not add a seventh condition to that chain — it takes the signal from
// where the app is actually being looked at.
//
// HOW: the popout now goes through the door, and for a TOP-LEVEL navigation the door serves a tiny
// shell page — our origin, one full-bleed iframe holding the app, and a heartbeat that pings us while
// that tab is visible. The in-app iframe path is deliberately UNTOUCHED (it still gets today's 302 and
// is already covered by the pane watchdog), so nothing about the preview surface that has been
// stabilised this week changes shape.
//
// THE MONEY INVARIANT, same one the door's retry cap encodes: a heartbeat resumes and holds a real
// billed VM, so it must be able to stop. It pauses when the tab is hidden and gives up entirely after
// an absolute ceiling, after which an abandoned open tab costs nothing and the next interaction goes
// back through the door.
//
// PURE — no clock, no I/O. Every input is passed in.

/** Kill switch. Default ON. `off` restores the raw-URL popout and the unconditional 302. */
export function previewKeepAliveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_PREVIEW_KEEPALIVE !== 'off';
}

/**
 * How often the shell pings. Half the 300s idle limit, for the same reason the pane watchdog's 150s
 * is: a keep-alive that fires slower than the thing it is holding off cannot win. 60s leaves room for
 * a missed ping, a slow network and a suspended timer without ever reaching the cut-off.
 */
export const KEEPALIVE_INTERVAL_MS = 60_000;

/**
 * The ceiling. After this much continuous viewing the shell stops pinging and the sandbox is allowed
 * to pause exactly as it would today.
 *
 * A heartbeat with no ceiling is an open-ended bill: a tab left on a second monitor for a weekend is
 * "visible" the whole time and would hold a VM at ~₹7/hour with nobody in the room. An hour is far
 * longer than any real session with a preview and far shorter than a bill worth worrying about, and
 * when it lapses nothing is lost — the next click goes through the door, which resumes the sandbox.
 */
export const KEEPALIVE_MAX_MS = 60 * 60_000;

/**
 * Is this request a TOP-LEVEL navigation (a popped-out tab) rather than our own iframe?
 *
 * Read from `Sec-Fetch-Dest`, which browsers send as `iframe` for a nested navigation and `document`
 * for a top-level one. A MISSING header is treated as an iframe — i.e. today's exact behaviour — so a
 * browser that does not send it can only ever get the path that already works, never a new one.
 */
export function isTopLevelNavigation(secFetchDest: string | string[] | undefined | null): boolean {
  const raw = Array.isArray(secFetchDest) ? secFetchDest[0] : secFetchDest;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  return raw.toLowerCase().trim() !== 'iframe';
}

/**
 * Should the door answer with the keep-alive shell instead of a redirect?
 *
 * Only for a real top-level navigation, only with the feature on, and only when we have somewhere to
 * point the shell. Anything else keeps the 302 the in-app preview already relies on.
 */
export function shouldServeKeepAliveShell(o: {
  enabled: boolean;
  topLevel: boolean;
  targetUrl: string | null | undefined;
}): boolean {
  return !!o.enabled && !!o.topLevel && typeof o.targetUrl === 'string' && o.targetUrl.length > 0;
}

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
function attr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value for safe interpolation into a JS string literal inside a <script> block. */
function js(value: string): string {
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
}

/**
 * The shell page: the app, full-bleed, plus a heartbeat.
 *
 * Everything here is deliberately boring. No framework, no external request, no styling beyond making
 * the iframe fill the window — this page's only jobs are to show the app exactly as the raw URL would
 * and to tell us the app is being watched. A failed ping is swallowed: a keep-alive that could break
 * the page it is keeping alive would be worse than no keep-alive at all.
 */
export function keepAliveShellPage(o: {
  targetUrl: string;
  /** The path (on our origin) the heartbeat POSTs to, token included. */
  keepAlivePath: string;
  intervalMs?: number;
  maxMs?: number;
}): string {
  const interval = Number.isFinite(o.intervalMs) && (o.intervalMs as number) > 0 ? Math.floor(o.intervalMs as number) : KEEPALIVE_INTERVAL_MS;
  const max = Number.isFinite(o.maxMs) && (o.maxMs as number) > 0 ? Math.floor(o.maxMs as number) : KEEPALIVE_MAX_MS;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Preview</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#09090b;overflow:hidden}
  iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:block}
</style>
</head><body>
<iframe src="${attr(o.targetUrl)}" allow="clipboard-write; fullscreen; geolocation; microphone; camera" allowfullscreen></iframe>
<script>
(function(){
  var PING = ${js(o.keepAlivePath)}, EVERY = ${interval}, LIMIT = ${max};
  var startedAt = Date.now(), timer = null;
  function expired(){ return Date.now() - startedAt > LIMIT; }
  function ping(){
    // Only while someone is genuinely looking, and only inside the ceiling. Both are the money
    // invariant: this call resumes and holds a real billed machine.
    if (document.visibilityState === 'hidden' || expired()) return;
    try {
      fetch(PING, { method: 'POST', keepalive: true, cache: 'no-store' }).catch(function(){});
    } catch (e) { /* a keep-alive must never be able to break the page it is keeping alive */ }
  }
  function start(){ if (timer || expired()) return; ping(); timer = setInterval(ping, EVERY); }
  function stop(){ if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') stop(); else start();
  });
  window.addEventListener('pagehide', stop);
  start();
})();
</script>
</body></html>`;
}
