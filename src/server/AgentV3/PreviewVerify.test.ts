import { describe, it, expect } from 'vitest';
import { analyzePreviewHtml, buildPreviewRepairPrompt, splitPaintMarker } from './PreviewVerify';

describe('analyzePreviewHtml — v5.0 sees whether its preview really rendered', () => {
  it('accepts a real rendered app (visible content, no error surface)', () => {
    const html = '<html><body><div id="root"><h1>My Todo App</h1><ul><li>Buy milk</li></ul></div></body></html>';
    const v = analyzePreviewHtml(html);
    expect(v.rendered).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it('flags an EMPTY mount root (React crashed before render)', () => {
    const html = '<html><body><div id="root"></div><script src="/main.js"></script></body></html>';
    const v = analyzePreviewHtml(html);
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toMatch(/root element is empty|never rendered/i);
  });

  it('flags a Vite build-error overlay', () => {
    const html = '<html><body><vite-error-overlay></vite-error-overlay><div id="root"></div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(false);
    expect(analyzePreviewHtml(html).problems.join(' ')).toMatch(/build-error overlay/i);
  });

  it('T0-5: flags React / webpack / Next / Parcel overlays too (not just Vite)', () => {
    for (const host of [
      '<react-error-overlay></react-error-overlay>',
      '<div id="webpack-dev-server-client-overlay"></div>',
      '<nextjs-portal></nextjs-portal>',
      '<parcel-error-overlay></parcel-error-overlay>',
    ]) {
      const html = `<html><body>${host}<div id="root">something</div></body></html>`;
      expect(analyzePreviewHtml(html).rendered).toBe(false);
      expect(analyzePreviewHtml(html).problems.join(' ')).toMatch(/build-error overlay/i);
    }
  });

  it('T0-5: flags a bundler resolve/compile error surfaced on the page', () => {
    for (const err of ['Could not resolve "./Missing"', 'Module not found: Error', 'Build failed with 1 error']) {
      const html = `<html><body><pre>${err}</pre></body></html>`;
      expect(analyzePreviewHtml(html).rendered).toBe(false);
    }
  });

  it('T0-5 non-regression: a real app is NOT falsely failed by the broader check', () => {
    const html = '<html><body><div id="root"><h1>My Todo App</h1><button>Add task</button><ul><li>Buy milk</li></ul></div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(true);
    expect(analyzePreviewHtml(html).problems).toHaveLength(0);
  });

  it('flags a dev-server 404 / "Cannot GET"', () => {
    expect(analyzePreviewHtml('<pre>Cannot GET /</pre>').rendered).toBe(false);
    expect(analyzePreviewHtml('<pre>Cannot GET /</pre>').problems.join(' ')).toMatch(/404|Cannot GET/i);
  });

  it('flags an uncaught runtime error printed on the page', () => {
    const html = '<html><body><div id="root">Uncaught TypeError: cannot read properties of undefined</div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(false);
    expect(analyzePreviewHtml(html).problems.join(' ')).toMatch(/runtime error/i);
  });

  it('flags an empty/blank page', () => {
    expect(analyzePreviewHtml('').rendered).toBe(false);
    expect(analyzePreviewHtml('   ').rendered).toBe(false);
    const blank = analyzePreviewHtml('<html><head></head><body></body></html>');
    expect(blank.rendered).toBe(false);
    expect(blank.problems.join(' ')).toMatch(/blank|no visible content/i);
  });
});

describe('buildPreviewRepairPrompt', () => {
  it('lists the observed problems + console errors and instructs a real fix', () => {
    const p = buildPreviewRepairPrompt(["the app's root element is empty"], ['TypeError: x is undefined']);
    expect(p).toContain("the app's root element is empty");
    expect(p).toContain('TypeError: x is undefined');
    expect(p).toContain('actually render');
  });
  it('works with no console errors', () => {
    expect(buildPreviewRepairPrompt(['blank page'])).toContain('blank page');
  });
});

/**
 * THE 34-MINUTE BUILD (admin field report, 2026-08-12).
 *
 * The app was finished and rendering at minute 7. The build ran for 34. What happened in between was a
 * cycle: the preview was snapshotted, the snapshot showed an empty `<div id="root"></div>`, this module
 * declared "a runtime error likely crashed it before render", a repair pass edited working code, the
 * repair restarted the dev server, the preview genuinely went down, and the next snapshot could be
 * early again.
 *
 * The whole loop rests on one confusion: for ANY single-page app, the un-hydrated shell is
 * byte-identical to an app that crashed on mount. Judged by the html alone the two cannot be told
 * apart — so the html alone must not be allowed to convict.
 */
describe('an un-painted snapshot is ignorance, not a defect', () => {
  const SHELL = '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

  it('curl can never convict a single-page app', () => {
    // curl does not execute JavaScript. This html is what a PERFECTLY HEALTHY React app serves.
    const v = analyzePreviewHtml(SHELL, { source: 'curl' });
    expect(v.inconclusive).toBe(true);
    expect(v.problems.join(' ')).toContain('NOT evidence the app is broken');
    expect(v.problems.join(' ')).not.toContain('crashed');
  });

  it('a browser snapshot taken before the app painted does not convict either', () => {
    const v = analyzePreviewHtml(SHELL, { source: 'browser', painted: false });
    expect(v.inconclusive).toBe(true);
    expect(v.problems.join(' ')).toContain('nothing had painted yet');
  });

  it('but it still does NOT pass — a preview is EARNED, and we did not see one', () => {
    // The opposite error would be just as bad: rubber-stamping an app nobody saw.
    expect(analyzePreviewHtml(SHELL, { source: 'curl' }).rendered).toBe(false);
  });

  it('a PAINTED browser snapshot that is still empty IS a real defect', () => {
    // We watched for ten seconds in a real browser and the app never painted. That is the app's
    // problem, and the old confident wording is correct here.
    const v = analyzePreviewHtml(SHELL, { source: 'browser', painted: true });
    expect(v.inconclusive).toBeFalsy();
    expect(v.problems.join(' ')).toContain('never rendered');
  });

  it('with NO capture context it behaves exactly as before — no caller is silently changed', () => {
    const v = analyzePreviewHtml(SHELL);
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBeFalsy();
  });

  it('a REAL error signal still convicts, whatever the capture says', () => {
    // An error overlay in the html is positive evidence. Blindness about painting does not excuse it.
    const overlay = '<html><body><vite-error-overlay></vite-error-overlay><div id="root"></div></body></html>';
    const v = analyzePreviewHtml(overlay, { source: 'curl' });
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toContain('build-error overlay');
  });

  it('the host\'s own closed-port page still convicts from a curl capture', () => {
    // This one is ABOUT the transport, not the app — curl sees it perfectly well.
    const closed = '<html><body><h1>Closed Port Error</h1><p>The sandbox is running but there is no service running on port 5173.</p></body></html>';
    expect(analyzePreviewHtml(closed, { source: 'curl' }).rendered).toBe(false);
  });

  it('a working app is unaffected by any of this', () => {
    const real = '<html><body><div id="root"><h1>Jungle Adventure</h1><p>Health 100/100</p></div></body></html>';
    for (const ctx of [{}, { source: 'curl' as const }, { source: 'browser' as const, painted: true }]) {
      expect(analyzePreviewHtml(real, ctx).rendered, JSON.stringify(ctx)).toBe(true);
    }
  });
});

describe('the capture itself waits for the app, not for a clock', () => {
  const actuator = require('fs').readFileSync(
    require('path').join(__dirname, 'sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8',
  ) as string;
  // Comments EXPLAIN the old timings by name, so a raw search finds them and reports a fix that
  // shipped as a fix that did not. Assert against code only — the same trap this file has hit before.
  const code = actuator.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the fixed sleeps are GONE from EVERY capture path — they took the photograph too early', () => {
    // Three paths had one: browseUrl (1800ms), the DOM scan (1800ms) and the SCREENSHOT (800ms after a
    // networkidle that can never fire on a Vite dev server). The screenshot one is the admin's own
    // report — "screenshot loading time par liya jata hai, aur AI ko lagta hai app bani nahi hai".
    expect(code).not.toContain('waitForTimeout(1800)');
    expect(code).not.toContain('setTimeout(r,800)');
    expect(code).not.toContain('setTimeout(r,600)');
  });

  it('ONE shared rule drives EVERY capture path — copies are chances to keep the old bug', () => {
    expect(actuator).toContain('const paintWaitJs =');
    // browseUrl, the DOM scan, the fresh-browser screenshot, and the CDP screenshot — which is the
    // one actually preferred at runtime, and had the same bug in its own copy.
    const uses = (actuator.match(/\$\{paintWaitJs\('(?:p|page)'\)\}/g) || []).length;
    expect(uses).toBe(4);
  });

  it('no capture path waits on networkidle, which a dev server never reaches', () => {
    // Its HMR socket stays open forever, so the goto always timed out at 15s and the wait bought
    // nothing. (browser_action's navigate/click still use it — those are user interactions on a
    // settled page, a different question from "has this app finished loading".)
    for (const script of ['SCREENSHOT_SCRIPT', 'SCREENSHOT_CDP_SCRIPT']) {
      const at = actuator.indexOf(`const ${script} = \``);
      expect(at, script).toBeGreaterThan(-1);
      const body = actuator.slice(at, actuator.indexOf('`.trim();', at));
      expect(body, script).not.toContain("waitUntil:'networkidle'");
    }
  });

  it('it polls for real content in the mount root', () => {
    expect(actuator).toContain("document.getElementById('root')");
    expect(actuator).toContain('painted=1');
  });

  it('it reports whether the app had painted, so the verdict does not have to guess', () => {
    expect(actuator).toContain("console.log('NBAI_PAINTED:'+painted)");
    expect(actuator).toContain("source: 'browser'");
    expect(actuator).toContain("source: 'curl'");
  });
});

describe('splitPaintMarker', () => {
  it('reads the flag and keeps the html', () => {
    expect(splitPaintMarker('NBAI_PAINTED:1\n<html>hi</html>')).toEqual({ painted: true, html: '<html>hi</html>' });
    expect(splitPaintMarker('NBAI_PAINTED:0\n<html></html>')).toEqual({ painted: false, html: '<html></html>' });
  });

  it('NO marker means UNKNOWN, never false', () => {
    // "Unknown" and "it did not paint" lead to opposite decisions, and collapsing them is how the
    // whole false-accusation class started.
    expect(splitPaintMarker('<html>hi</html>').painted).toBeUndefined();
  });

  it('survives junk', () => {
    expect(splitPaintMarker('')).toEqual({ html: '' });
  });
});

/**
 * THE 44-MINUTE HOME PAGE (admin build transcript, 2026-08-12 — 44m50s, ₹42.16, 178.4k tokens).
 *
 * The user asked for one home page with four corner buttons. Three separate times the preview came
 * back "nothing is listening on that port". Three times the platform ran a full LLM repair pass on it.
 * All three times the model read the files, typechecked, found nothing, restarted the dev server and
 * wrote some version of "No code changes were needed — the app itself is fine."
 *
 * The detection was never wrong. The RESPONSE was: a code repair cannot fix a dead process, and while
 * the model was in there looking for a bug that did not exist, it edited working code.
 */
describe('a dead dev server is a process problem, not an app problem', () => {
  const CLOSED_PORT = '<html><body><h1>Closed Port Error</h1>'
    + '<p>The sandbox is running but there is no service running on port 5173. Connection refused.</p></body></html>';

  it('is reported as serverDown, not as a broken app', () => {
    const v = analyzePreviewHtml(CLOSED_PORT);
    expect(v.serverDown).toBe(true);
    expect(v.rendered).toBe(false);
  });

  it('says plainly that this is not the user\'s app', () => {
    expect(analyzePreviewHtml(CLOSED_PORT).problems[0]).toContain('this is not your app');
  });

  it('is NOT confused with an inconclusive snapshot — they need opposite handling', () => {
    // Unpainted means do nothing. Dead server means do one specific, free, deterministic thing.
    expect(analyzePreviewHtml(CLOSED_PORT).inconclusive).toBeFalsy();
  });

  it('short-circuits — nothing else in the html can testify about an app we never reached', () => {
    // The closed-port page is the HOST talking, so its content must not be mined for app defects.
    const v = analyzePreviewHtml(CLOSED_PORT);
    expect(v.problems).toHaveLength(1);
  });

  it('a real app is never mistaken for a dead server', () => {
    const real = '<html><body><div id="root"><h1>Jungle Adventure</h1><button>Play</button></div></body></html>';
    expect(analyzePreviewHtml(real).serverDown).toBeFalsy();
    expect(analyzePreviewHtml(real).rendered).toBe(true);
  });

  it('an app that merely MENTIONS a closed port is not a dead server', () => {
    // A devops dashboard is allowed to contain these words. Two independent signals are required.
    const dashboard = '<html><body><div id="root"><h2>Connection refused on port 8080</h2><p>Retry</p></div></body></html>';
    expect(analyzePreviewHtml(dashboard).serverDown).toBeFalsy();
  });
});

describe('the build restarts the server instead of hiring a model to do it', () => {
  const routes = require('fs').readFileSync(
    require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
  ) as string;

  it('a serverDown verdict takes the deterministic path', () => {
    expect(routes).toContain('if (verdict.serverDown)');
    expect(routes).toContain('preview-server-revive');
    expect(routes).toContain('PREVIEW_SERVER_RESTARTED');
  });

  it('the restart happens BEFORE the repair prompt is ever built', () => {
    // If it landed after, the model call would already have been made and the money already spent.
    const at = routes.indexOf('if (verdict.serverDown)');
    const repairAt = routes.indexOf('buildPreviewRepairPrompt(verdict.problems');
    expect(at).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(at);
  });

  it('a restart does NOT spend the repair budget', () => {
    // Otherwise one crashed dev server silently costs the app its only chance at a real fix.
    expect(routes).toContain('attempt -= 1; // a process restart is not a repair attempt');
  });

  it('it is bounded — a server that will not stay up cannot loop', () => {
    expect(routes).toContain('const MAX_SERVER_REVIVALS = 2');
    expect(routes).toContain('serverRevivals >= MAX_SERVER_REVIVALS');
  });

  it('giving up is reported as OUR infrastructure failing, not as the user\'s bad code', () => {
    expect(routes).toContain("The app's code was never the problem here");
  });
});
