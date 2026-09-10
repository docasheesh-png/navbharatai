// THE PREVIEW BRIDGE — the one script that makes a running app talk back to NavBharatAI.
//
// WHY THIS MODULE EXISTS (gap analysis 2026-09-10). The console mirror was written INLINE inside
// ReactPreview.ts, so it existed only for the IN-BROWSER preview. The Live preview — the mode where
// the app is most real, running its actual dependencies on an actual machine, and therefore the mode
// where a runtime error matters MOST — had no console at all. A user watching their live app throw
// saw nothing: no rows, no error badge, and no "Fix with AI". They had to open devtools, which is
// exactly the thing this product exists not to require.
//
// Writing a SECOND copy for the live path is how this repo has been burned before (four drifted
// copies of safeRelPath; retired model ids in five files). So the mirror moved HERE, once, and both
// previews interpolate the same constant. A fix to the mirror is now a fix to both by construction.
//
// 🔒 THREE RULES THIS SCRIPT MAY NEVER BREAK, because it runs inside somebody else's app:
//   1. It must never break the app. Every hook is wrapped, every failure is swallowed, and the app's
//      own console/fetch keep working untouched — this MIRRORS, it never replaces.
//   2. It must never flood. Messages are capped per line, and only FAILED network calls are reported
//      (a chatty app doing 60 requests a second must not become 60 messages a second).
//   3. It must never leak. It posts to its own parent frame and nowhere else.

/**
 * Marker used to make injection idempotent. Present in the document ⇒ the bridge is already there,
 * so a re-boot, a restart or a second update_preview never installs it twice (double-wrapping the
 * console would double every line the app prints).
 */
export const PREVIEW_BRIDGE_MARKER = '__nbaiPreviewBridgeInstalled';

/**
 * The bridge's JavaScript, as source.
 *
 * `source` labels where the rows came from ('in-browser' | 'live'), which is what lets the panel's
 * failover logic tell a broken in-browser render from a broken live server rather than guessing.
 *
 * Deliberately ES5-shaped and dependency-free: it runs before the app's own bundle, inside apps we
 * did not write, on whatever the sandbox's browser is.
 */
export function previewBridgeSource(source: 'in-browser' | 'live'): string {
  const tag = source === 'live' ? 'live' : 'in-browser';
  return `
(function () {
  if (window.${PREVIEW_BRIDGE_MARKER}) return;   // idempotent — never wrap the console twice
  window.${PREVIEW_BRIDGE_MARKER} = true;
  var SOURCE = '${tag}';
  function post(msg) {
    try { (window.parent || window.top).postMessage(msg, '*'); } catch (e) { /* never break the app */ }
  }
  function describe(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message + (a.stack ? '\\n' + String(a.stack).split('\\n').slice(0, 4).join('\\n') : '');
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  function mirror(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) parts.push(describe(args[i]));
      post({ __nbaiPreviewConsole: true, source: SOURCE, level: level, text: parts.join(' ').slice(0, 600) });
    } catch (e) { /* mirroring must never break the app */ }
  }
  // ANNOUNCE THAT THE BRIDGE IS ACTUALLY HERE.
  // Without this the panel cannot tell "your app has printed nothing" from "nothing is reporting to
  // me" — and it used to show the first sentence in both cases, which is a false statement to the
  // user in the second. Frameworks with no entry document (Next, Nuxt) get no bridge at all, so this
  // is the difference between an honest "not available for this app" and a quiet lie.
  post({ __nbaiPreviewBridgeReady: true, source: SOURCE });
  var orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    console[level] = function () { mirror(level, arguments); return orig[level].apply(console, arguments); };
  });
  window.addEventListener('error', function (e) {
    mirror('error', [String(e.message || 'Script error') + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    mirror('error', ['Unhandled promise rejection: ' + (r instanceof Error ? r.message : String(r))]);
  });
  // ── WHICH PAGE AM I ON, AND TAKE ME TO ANOTHER ONE (gap analysis 2026-09-10) ────────────────
  // The preview had no address bar and no back/forward, in either mode. A multi-page app could be
  // navigated only by clicking inside it, and there was no way to jump straight to /checkout to look
  // at it — VS Code and Cursor both have this, and NavBharatAI did not.
  //
  // It could not be done from the panel: the live app is cross-origin, so the parent is forbidden to
  // read or step its history (contentWindow.history throws — which is exactly why the old
  // back/forward chevrons in the Code Studio panel were removed as fake). It CAN be done from in
  // here, because this script runs inside the app itself. So the app reports where it is, and obeys
  // real history calls; nothing is simulated and nothing is faked.
  function currentPath() {
    try { return location.pathname + location.search + location.hash; } catch (e) { return '/'; }
  }
  function reportRoute() { post({ __nbaiPreviewRoute: true, source: SOURCE, path: currentPath() }); }
  // A SPA changes route WITHOUT firing popstate — pushState is a silent history mutation, which is
  // how a React Router navigation would have gone unreported. Wrapping both keeps the address honest
  // on every kind of navigation; the original is always called and always returns its own value.
  ['pushState', 'replaceState'].forEach(function (m) {
    try {
      var origFn = history[m];
      if (typeof origFn !== 'function') return;
      history[m] = function () {
        var out = origFn.apply(this, arguments);
        try { setTimeout(reportRoute, 0); } catch (e) { /* ignore */ }
        return out;
      };
    } catch (e) { /* a locked-down history is not worth failing over */ }
  });
  window.addEventListener('popstate', reportRoute);
  window.addEventListener('hashchange', reportRoute);
  try { if (document.readyState === 'complete') reportRoute(); } catch (e) { /* ignore */ }
  window.addEventListener('load', reportRoute);
  window.addEventListener('message', function (e) {
    // ONLY THE PANEL MAY DRIVE THE APP. Anything else embedding this page could otherwise navigate it.
    if (e.source !== window.parent && e.source !== window.top) return;
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    try {
      if (d.__nbaiHistory === 'back') { history.back(); return; }
      if (d.__nbaiHistory === 'forward') { history.forward(); return; }
      if (typeof d.__nbaiNavigate === 'string' && d.__nbaiNavigate) {
        var to = d.__nbaiNavigate;
        if (to.charAt(0) !== '/' && to.indexOf('://') < 0) to = '/' + to;
        // A HASH-ROUTED APP MUST BE MOVED BY ITS HASH, not by a document navigation: the in-browser
        // preview rewrites BrowserRouter to HashRouter (it has no real History to route against), and
        // a srcdoc document cannot be navigated at all. Setting the hash routes it for real.
        var hashRouted = SOURCE === 'in-browser' || String(location.hash || '').indexOf('#/') === 0;
        if (hashRouted) { location.hash = '#' + (to.charAt(0) === '/' ? to : '/' + to); reportRoute(); return; }
        // Everything else gets a REAL navigation — the same thing a browser address bar does. It
        // reloads, which is honest: guessing that an app is a SPA and faking a pushState would leave
        // a multi-page app showing the old page under a new address.
        location.assign(to);
      }
    } catch (err) { /* a refused navigation must never break the app */ }
  });
  // ── FAILED NETWORK CALLS (gap analysis 2026-09-10) ──────────────────────────────────────────
  // A user whose app's API call 404s or CORS-fails saw an app that silently did nothing: the browser
  // reports those in the Network tab, not the console, so the mirror above never carried them and
  // there was nothing to hand the AI. Only FAILURES are reported — a successful request is not news,
  // and mirroring every one of them would flood the drawer and drown the line that matters.
  function reportHttp(method, url, status, note) {
    try {
      var where = String(url || '');
      if (where.length > 160) where = where.slice(0, 160) + '…';
      mirror('error', ['Network: ' + String(method || 'GET').toUpperCase() + ' ' + where + ' — ' + note]);
    } catch (e) { /* ignore */ }
  }
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = (input && input.url) || input;
      var p;
      // A THROW FROM THE ORIGINAL CALL MUST STILL REACH THE APP UNCHANGED. Calling it inside the
      // try means a synchronous throw becomes our rejection rather than its own.
      try { p = nativeFetch.apply(this, arguments); }
      catch (e) { reportHttp(method, url, 0, 'request could not be sent (' + (e && e.message ? e.message : 'error') + ')'); throw e; }
      try {
        return p.then(function (res) {
          if (res && typeof res.status === 'number' && res.status >= 400) {
            reportHttp(method, url, res.status, 'HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : ''));
          }
          return res;
        }, function (err) {
          // The classic silent failure: a wrong host, a CORS refusal or an offline device all land
          // here as an opaque TypeError with no status at all.
          reportHttp(method, url, 0, 'request failed (' + (err && err.message ? err.message : 'network error') + ')');
          throw err;
        });
      } catch (e) { return p; }
    };
  }
  if (typeof window.XMLHttpRequest === 'function') {
    var XHR = window.XMLHttpRequest;
    var openOrig = XHR.prototype.open;
    var sendOrig = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__nbaiMethod = method; this.__nbaiUrl = url; } catch (e) { /* ignore */ }
      return openOrig.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var self = this;
      try {
        self.addEventListener('load', function () {
          if (self.status >= 400) reportHttp(self.__nbaiMethod, self.__nbaiUrl, self.status, 'HTTP ' + self.status);
        });
        self.addEventListener('error', function () {
          reportHttp(self.__nbaiMethod, self.__nbaiUrl, 0, 'request failed (network error)');
        });
      } catch (e) { /* ignore */ }
      return sendOrig.apply(this, arguments);
    };
  }
})();`;
}

/**
 * Insert the bridge into a document's `<head>`, idempotently.
 *
 * Returns the html UNCHANGED when the bridge is already present or when there is no place to put it
 * — this is a best-effort enhancement to somebody's running app, so "leave it exactly as it was" is
 * always an acceptable outcome and a mangled document never is.
 */
export function injectPreviewBridge(html: string, source: 'in-browser' | 'live' = 'live'): string {
  if (typeof html !== 'string' || !html) return html;
  if (html.includes(PREVIEW_BRIDGE_MARKER)) return html;
  const tag = `<script>${previewBridgeSource(source)}</script>`;
  // FIRST thing in <head>, so the console is already wrapped before the app's own bundle runs and a
  // boot-time error is captured rather than missed.
  if (/<head[^>]*>/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1${tag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/(<html[^>]*>)/i, `$1${tag}`);
  return html;
}

/** Does this document already carry the bridge? Pure; used by the sandbox patch to skip a write. */
export function hasPreviewBridge(html: string): boolean {
  return typeof html === 'string' && html.includes(PREVIEW_BRIDGE_MARKER);
}

/**
 * Remove the bridge from a document — the guard that keeps it OUT of the user's real code.
 *
 * 🔴 WHY THIS IS NOT OPTIONAL. The bridge is written into the SANDBOX's index.html, and the sandbox
 * is what the builder's `read_file` reads. So the model can see a script it did not write, sitting in
 * the user's entry document. Models preserve the script tags they find when they rewrite an HTML
 * file — which is exactly how a development-only bridge would have been copied into the DURABLE file
 * and then published inside the user's finished app, phoning a parent frame that does not exist.
 *
 * Making that branch UNLIKELY is not enough (the 50/50 law): it is closed at both ends. The file the
 * model reads never contains the bridge, and a write that somehow carries the marker anyway has it
 * stripped before it is stored. Neither guard alone would be sufficient; together the bridge cannot
 * reach a user's shipped app.
 *
 * Idempotent, and a no-op for a document that never had one. PURE.
 */
export function stripPreviewBridge(html: string): string {
  if (typeof html !== 'string' || !html || !html.includes(PREVIEW_BRIDGE_MARKER)) return html;
  return html.replace(
    new RegExp(`<script\\b[^>]*>(?:(?!<\\/script>)[\\s\\S])*?${PREVIEW_BRIDGE_MARKER}(?:(?!<\\/script>)[\\s\\S])*?<\\/script>[ \\t]*\\n?`, 'gi'),
    '',
  );
}

/** Is this a document the bridge could live in? Cheap gate so non-HTML paths skip the work entirely. */
export function isHtmlDocumentPath(path: string): boolean {
  return /\.html?$/i.test((path || '').trim());
}
