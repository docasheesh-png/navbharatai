// AgentV3 — IN-BROWSER PREVIEW NAVIGATION GUARD (preview-takeover autopsy 2026-07-21).
//
// ROOT CAUSE it closes: the in-browser preview renders the generated app in a SAME-ORIGIN `<iframe srcDoc>`
// (allow-same-origin is required so the app's dynamic `import()` of the CDN React build works). A srcdoc
// document inherits the PARENT (platform) document's URL as its base — so an ABSOLUTE navigation inside the
// generated app (`location.assign('/')`, an auth redirect, `<a href="/login">`, a GET form to '/') resolves
// to the NavBharatAI platform origin and LOADS THE PLATFORM APP ITSELF into the preview. The user then sees
// "NavBharatAI Pro v5.0" inside the preview instead of their app — intermittently, only for apps that
// redirect (login/auth/role-gated dashboards).
//
// The guard, injected into every preview document, neutralizes exactly those cross-document navigations to
// the platform origin (never touching in-page hash navigation, client-side routing via history.pushState,
// or links to external sites). Best-effort and wrapped so it can NEVER break the previewed app.
//
// It ALSO normalizes the initial path to '/' (blank-body autopsy 2026-07-21): the same srcdoc-inherits-the-
// platform-URL root cause means a client router (BrowserRouter) reads the platform path (/build/xyz), matches
// none of the app's routes, and renders a BLANK body under a rendered navbar. Resetting to '/' before the app
// mounts makes the index route match, so the app's home content renders.
//
// NOTE (rule 6 — honest bound): it cannot intercept a DIRECT `window.location.href = '/'` setter assignment
// (the `location` object is not reconfigurable), which is the one residual escape. The complete isolation is
// the cross-origin preview (VITE_PREVIEW_ORIGIN), where '/' resolves to the empty preview origin, not the
// platform. This guard is the same-origin mitigation that covers the common redirect mechanisms.

export const NAV_GUARD_MARKER = 'nbai-nav-guard';

/**
 * PURE decision mirrored by the injected runtime script: should a navigation to `target` (resolved against
 * the srcdoc's `baseUri`, whose origin is `origin`) be BLOCKED because it would leave the preview document
 * for another page on the PLATFORM origin? Blocks a same-origin, cross-DOCUMENT navigation (different path,
 * ignoring the hash); allows in-page hash changes, same-document navigations, and any external origin.
 */
export function shouldBlockPreviewNav(target: string, baseUri: string, origin: string): boolean {
  try {
    const t = new URL(target, baseUri);
    if (t.origin !== origin) return false;            // external site → allow (app opens it normally)
    const base = (baseUri || '').split('#')[0];
    return t.href.split('#')[0] !== base;             // different document on the platform origin → the escape
  } catch {
    return false;                                     // unparseable → never block
  }
}

/** The runtime `<script>` — a hand-mirror of shouldBlockPreviewNav that runs INSIDE the preview iframe. */
export function previewNavGuardScript(): string {
  return (
    `<script>/*${NAV_GUARD_MARKER}*/(function(){try{` +
    // PREVIEW ROUTE NORMALIZE (blank-body autopsy 2026-07-21): a srcdoc inherits the PLATFORM path
    // (e.g. /build/xyz). A client router (react-router BrowserRouter) reads that path, matches NONE of the
    // app's routes ('/', '/about', …) and renders NOTHING — a blank body under a rendered navbar. Reset the
    // path to '/' BEFORE the app mounts so the index route matches. history.replaceState = no reload.
    `try{if(location.pathname&&location.pathname!=="/"){history.replaceState(null,"","/"+location.search+location.hash);}}catch(e){}` +
    `var H=location.origin;` +
    `function L(u){try{var t=new URL(u,document.baseURI);if(t.origin!==H)return false;` +
    `var b=(document.baseURI||"").split("#")[0];return t.href.split("#")[0]!==b;}catch(e){return false}}` +
    `["assign","replace"].forEach(function(m){try{var o=location[m].bind(location);` +
    `location[m]=function(u){if(L(String(u)))return;return o(u)};}catch(e){}});` +
    `document.addEventListener("click",function(e){try{var a=e.target&&e.target.closest&&e.target.closest("a[href]");` +
    `if(a&&!a.target&&L(a.href))e.preventDefault();}catch(_){}} ,true);` +
    `document.addEventListener("submit",function(e){try{var f=e.target;` +
    `if(f&&f.action&&L(f.action)&&(!f.method||/get/i.test(f.method)))e.preventDefault();}catch(_){}} ,true);` +
    `}catch(e){}})();</` + `script>`
  );
}

/**
 * Inject the navigation guard as early as possible in a preview HTML document (right after <head>, else
 * after <html>, else prepended). Idempotent (the marker prevents a second copy). No-op on empty input. Pure.
 */
export function injectPreviewNavGuard(html: string): string {
  if (typeof html !== 'string' || html === '' || html.includes(NAV_GUARD_MARKER)) return html;
  const g = previewNavGuardScript();
  if (/<head[^>]*>/i.test(html)) return html.replace(/(<head[^>]*>)/i, `$1${g}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/(<html[^>]*>)/i, `$1${g}`);
  return g + html;
}
