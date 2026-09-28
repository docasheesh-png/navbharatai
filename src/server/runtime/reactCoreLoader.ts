// REACT'S CORE LOADS AS ONE UNIT, AND THE PAGE PROVES IT HAS ONE REACT BEFORE THE APP RUNS
// (autopsy "Lekhan Sahyak", 2026-09-27).
//
// 🔴 THE DEFECT. The in-browser preview loaded every package on its own three-rung CDN ladder — the
// same-origin mirror, then jsdelivr's ESM, then plain esm.sh — and it treated `react`, `react-dom`,
// `react-dom/client` and `react/jsx-runtime` as four independent packages. In that report `react` fell
// to the SECOND rung (`https://cdn.jsdelivr.net/npm/react@18.3.1/+esm`) while `react-dom/client` loaded
// from the first. `react-dom` installs the hook dispatcher on the React copy IT imported; the app's
// `useState` went through the OTHER copy, found no dispatcher, and every render crashed with
// `Cannot read properties of null (reading 'useState')`.
//
// The app was fine. The live preview — a real Vite dev server with one node_modules — rendered it, and
// the build's own browser check saw it render. But the in-browser preview offered "Fix with AI" under
// the crash, the user pressed it five times, and the engine spent five builds (₹208 billed) editing
// `vite.config.ts` to cure a fault that lived in our loader, never in their files. Two of those builds
// honestly concluded "nothing needed changing", which was true and helped nobody.
//
// 🔑 TWO LAYERS, because either alone leaves the class open:
//   1. THE GROUP. The core specs are loaded together from ONE rung. If any of them fails on a rung, the
//      whole group moves to the next rung — never a mix. On jsdelivr, `react-dom@x/+esm` imports
//      `/npm/react@x/+esm`, the same URL `react@x/+esm` is served from, so a group that lands on one
//      rung shares one React by construction.
//   2. THE PROOF. "Same rung" is an argument; the probe is a measurement. Before the app runs, a
//      throwaway component calls a hook through the app's React while the app's react-dom renders it.
//      A dispatcher that is null is two Reacts, and the group moves to the next rung. It costs one
//      synchronous render of a component that returns nothing.
//
// 🔴 THE PROBE ITSELF LIED ONCE (autopsy 1a32248f, 2026-09-28). It flushed the probe's render with the
// flushSync exported by `react-dom` and read "no verdict" as "two Reacts". On React 18 a CDN can give
// `react-dom/client` its own copy of react-dom (it `require`s its own package); that flushSync then flushes
// the OTHER reconciler, the probe never renders in time, and ONE React was refused — so a working app got
// the platform-fault screen on every rung. Measured against real react@18.3.1 before the fix. The probe
// now awaits the render (bounded) and only a hook that really failed is two Reacts.
//
// 🔒 THE PROBE NEVER SPEAKS. React's development build prints "Invalid hook call" before throwing, and
// the preview's console mirror would forward that to the parent as an APP error row carrying a
// "Fix with AI" button — the exact button this module exists to take away. So `console.error` is muted
// for the probe's duration and restored in a `finally`.
//
// 🔒 WHEN NO RUNG YIELDS ONE REACT, the page says so as a PLATFORM fault (see previewPlatformFault.ts)
// and does not mount the app. Mounting it would reproduce the crash under the user's name.
//
// ⚠️ RESIDUAL, said plainly: a THIRD-PARTY React library whose own import fails on the mirror falls to
// its own jsdelivr rung, which resolves `react` from the library's peer range rather than from
// package.json. That can still yield a second React for that library alone. The probe covers the core;
// it cannot see inside a library's graph.
//
// This file exports browser JavaScript as a STRING (it runs inside the preview page, not on the server),
// written so a test can evaluate it in Node against real React copies.

/** The specifiers that must come from one React. `react/jsx-dev-runtime` is OUR facade, not a CDN module. */
export const REACT_CORE_SPECS: readonly string[] = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];

/**
 * Browser source defining `nbaiReactIsSingle(mods, makeContainer, waitMs?)` (async), `nbaiRungSummary(errors)` and
 * `nbaiLoadReactCore(specs, rungs, importFn, deadlineFn, interopFn, makeContainer)`.
 *
 * - `rungs` is an array of functions spec → URL, tried in order.
 * - `importFn(url)` loads a module (the page passes `function (u) { return import(u); }`).
 * - `deadlineFn(spec)` returns a promise that rejects when that spec's shared budget is spent.
 * - `makeContainer()` returns the element the probe renders into (the page passes a detached div).
 *
 * Resolves to `{ mods, single, rung, errors }`: `single` is false only when the probe MEASURED two Reacts (a
 * hook that found no dispatcher) or no rung loaded; a render that could not be observed is trusted, because
 * the group came from one rung. `mods` is null when no rung loaded the whole group.
 */
export const REACT_CORE_LOADER_SOURCE = `
async function nbaiReactIsSingle(mods, makeContainer, waitMs) {
  var R = mods && mods['react'];
  var C = mods && mods['react-dom/client'];
  var D = mods && mods['react-dom'];
  if (!R || !C || typeof R.useState !== 'function' || typeof R.createElement !== 'function' || typeof C.createRoot !== 'function') return false;
  // flushSync is only a SHORTCUT to a synchronous render. It belongs to the react-dom instance that
  // exported it, and a CDN may hand \`react-dom/client\` its own inlined react-dom — then this flushSync
  // runs the callback but flushes a DIFFERENT reconciler, the probe's render stays scheduled, and the
  // verdict is still unknown when flushSync returns. That is "not measured yet", never "two copies":
  // the render is awaited below instead of being read as a failure (autopsy 1a32248f, 2026-09-28).
  var flush = D && typeof D.flushSync === 'function' ? D.flushSync : null;
  var limit = typeof waitMs === 'number' ? waitMs : 1500;
  var ok = null;
  var root = null;
  var muted = console.error;
  console.error = function () {};
  try {
    root = C.createRoot(makeContainer());
    function NbaiReactProbe() {
      try { R.useState(0); ok = true; } catch (e) { ok = false; }
      return null;
    }
    var el = R.createElement(NbaiReactProbe);
    // The verdict is taken DURING render; a commit-phase failure after it does not change what the
    // render measured.
    if (flush) { try { flush(function () { root.render(el); }); } catch (e) {} }
    else root.render(el);
    for (var waited = 0; ok === null && waited < limit; waited += 25) {
      await new Promise(function (r) { setTimeout(r, 25); });
    }
  } catch (e) {
    if (ok === null) ok = false;
  } finally {
    try { if (root) root.unmount(); } catch (e) {}
    console.error = muted;
  }
  // A render that never ran inside the wait could not be measured. The group still came from ONE rung,
  // so it is trusted — only a hook that actually found no dispatcher is two Reacts.
  return ok !== false;
}

/** A vendor-free line naming what each rung did, for the platform-fault message the admin reads. */
function nbaiRungSummary(errors) {
  return (errors || []).map(function (e) {
    var m = /^rung (\\d+): (.*)$/.exec(String(e));
    if (!m) return 'did not load';
    var why = /two copies/.test(m[2]) ? 'two copies' : /timed out|deadline/i.test(m[2]) ? 'timed out' : 'did not load';
    return 'r' + m[1] + ' ' + why;
  }).join(' · ');
}

async function nbaiLoadReactCore(specs, rungs, importFn, deadlineFn, interopFn, makeContainer) {
  var errors = [];
  var firstLoaded = null;
  for (var ri = 0; ri < rungs.length; ri++) {
    var rung = rungs[ri];
    var mods = {};
    try {
      await Promise.all(specs.map(function (s) {
        var url = rung(s);
        return Promise.race([importFn(url), deadlineFn(s)]).then(function (ns) { mods[s] = interopFn(ns); });
      }));
    } catch (e) {
      errors.push('rung ' + (ri + 1) + ': ' + ((e && e.message) ? e.message : String(e)));
      continue;
    }
    if (!firstLoaded) firstLoaded = mods;
    if (await nbaiReactIsSingle(mods, makeContainer)) return { mods: mods, single: true, rung: ri, errors: errors };
    errors.push('rung ' + (ri + 1) + ': two copies of React');
  }
  return { mods: firstLoaded, single: false, rung: -1, errors: errors };
}
`;
