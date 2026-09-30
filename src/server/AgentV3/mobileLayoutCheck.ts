// THE APP IS OPENED ON A PHONE, NOT ONLY ON A DESKTOP.
//
// Admin 2026-09-30, verbatim: "mobile friendly game/app bane — mobile first!!!!!!". Every browser check
// this platform runs — the render proof, the verify loop, GreenGuard, the page check, the journey, the
// click explorer — opened the app at a DESKTOP viewport (1280×720 by default). So we proved an app
// works on the screen the fewest of our users hold, and never once looked at it on a phone. The
// architect prompt has long described the phone layout in words ("phone = ONE column", "never a fixed
// width wider than ~320px", tap targets of 44px on a coarse pointer); nothing measured whether it was
// done.
//
// This opens the running app ONCE at a phone viewport (390×844, touch, mobile user agent) and measures
// the two things a person on a phone meets in their first second:
//   • DOES THE PAGE SCROLL SIDEWAYS? (the document is wider than the screen) — and which element makes it.
//   • CAN A THUMB HIT THE CONTROLS? (visible buttons, links outside running text, inputs and selects
//     smaller than 32px on a side). 32 sits between WCAG 2.2's 24px minimum and the 44px the prompt asks
//     for, so a finding means genuinely hard to tap, not merely below a guideline.
//
// EVIDENCE, NEVER A GATE, and three outcomes, never two: a runner that could not reach the app is
// MOBILE_LAYOUT_NOT_RUN, never a pass. No model call. When it finds something, the user is offered a
// one-tap fix (buildFindingSuggestions.ts); nothing is changed behind their back. Kill switch
// AGENTV3_MOBILE_LAYOUT=off.

import { browserScriptRunLine, parseScriptDiagnostic, playwrightImport } from './sandboxBrowserScript';

export const MOBILE_RESULT_MARKER = 'NBAI_MOBILE:';
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
/** Smaller than this on either side is hard to hit with a thumb. */
export const MIN_TAP_PX = 32;
/** Sideways scroll smaller than this is sub-pixel rounding, not a layout. */
export const OVERFLOW_TOLERANCE_PX = 4;
/** This many tiny targets before it is a finding — one icon button is a nit, not a phone layout. */
export const SMALL_TARGET_FINDING = 3;
export const MOBILE_CHECK_BUDGET_MS = 30_000;
const LOAD_MS = 15_000;
const TOOLS_DIR = '/home/user/.e-tools';

export function mobileLayoutCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_MOBILE_LAYOUT ?? '').trim().toLowerCase() !== 'off';
}

/**
 * The in-sandbox shell command. PURE. `storageState` is the session the sign-in check saved
 * (signInExplore.ts): with it the phone opens the app signed in, like every other browser check, so an
 * app behind a login is measured on its own screens and not on the sign-in page.
 */
export function mobileLayoutScript(previewUrl: string, opts: { storageState?: string | null } = {}): string {
  const cfg = { base: String(previewUrl ?? '').trim(), marker: MOBILE_RESULT_MARKER, w: MOBILE_VIEWPORT.width, h: MOBILE_VIEWPORT.height, minTap: MIN_TAP_PX, loadMs: LOAD_MS, storageState: opts.storageState ?? null };
  return `cat > /tmp/nbai-mobile.mjs <<'NBAI_EOF'
${mobileLayoutModule(cfg)}
NBAI_EOF
${browserScriptRunLine({ toolsDir: TOOLS_DIR, scriptPath: '/tmp/nbai-mobile.mjs', marker: MOBILE_RESULT_MARKER })}`;
}

/** The ES module the runner executes — split so a test can run it as-is in a real browser. */
export function mobileLayoutModule(cfg: Record<string, unknown>, importLine: string = playwrightImport(TOOLS_DIR)): string {
  return `${importLine}
const cfg = ${JSON.stringify(cfg)};
const say = (o) => console.log(cfg.marker + JSON.stringify(o));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...(cfg.storageState ? { storageState: cfg.storageState } : {}) });
  const page = await ctx.newPage();
  await page.goto(cfg.base, { waitUntil: 'load', timeout: cfg.loadMs });
  await page.waitForTimeout(1500);
  const r = await page.evaluate((minTap) => {
    // The LAYOUT viewport. On a phone, innerWidth grows to fit content that overflows (measured: 708 on
    // a 390px screen with a 700px box), which would hide exactly the sideways scroll this looks for.
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const doc = document.scrollingElement || document.documentElement;
    const overflow = Math.max(0, doc.scrollWidth - vw);
    const root = document.getElementById('root') || document.getElementById('app') || document.body;
    const painted = ((root.innerText || '').trim().length > 0) || !!root.querySelector('canvas,img,svg,video');
    const shown = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return null;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 ? b : null;
    };
    const name = (el) => String(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.tagName)
      .trim().replace(/\\s+/g, ' ').slice(0, 40);
    const wide = [];
    if (overflow > 0) {
      for (const el of document.body.querySelectorAll('*')) {
        const b = shown(el);
        if (!b || b.right <= vw + 2 || b.width < vw * 0.25) continue;
        if (wide.some((w) => w.el.contains(el))) continue;
        wide.push({ el, tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 40), width: Math.round(b.width) });
        if (wide.length >= 4) break;
      }
    }
    const small = [];
    let smallCount = 0;
    const targets = document.querySelectorAll('button, a[href], select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=button]');
    for (const el of targets) {
      if (el.tagName === 'A' && el.closest('p, li')) continue; // a link inside running text is not a control
      const b = shown(el);
      if (!b) continue;
      if (b.width < minTap || b.height < minTap) {
        smallCount++;
        if (small.length < 5) small.push({ name: name(el), w: Math.round(b.width), h: Math.round(b.height) });
      }
    }
    return { vw, overflow, painted, wide: wide.map((w) => ({ tag: w.tag, cls: w.cls, width: w.width })), smallCount, small };
  }, cfg.minTap);
  say({ ok: true, ...r });
} catch (e) {
  say({ ok: false, error: String(e && e.message || e).slice(0, 200) });
} finally {
  await browser.close();
}
`;
}

export interface MobileLayoutRun {
  ok: boolean;
  error?: string;
  vw?: number;
  overflow?: number;
  painted?: boolean;
  wide?: Array<{ tag: string; cls: string; width: number }>;
  smallCount?: number;
  small?: Array<{ name: string; w: number; h: number }>;
  /** What the script said instead, when it produced no result. */
  diagnostic?: string | null;
}

/** Read the runner's stdout. A run with no result line is `ok: false`, never a pass. PURE. */
export function parseMobileLayout(stdout: string | null | undefined): MobileLayoutRun {
  const text = String(stdout ?? '');
  for (const line of text.split('\n').reverse()) {
    const at = line.indexOf(MOBILE_RESULT_MARKER);
    if (at < 0) continue;
    try { return JSON.parse(line.slice(at + MOBILE_RESULT_MARKER.length)) as MobileLayoutRun; } catch { break; }
  }
  return { ok: false, diagnostic: parseScriptDiagnostic(text) };
}

export interface MobileLayoutVerdict {
  code: 'MOBILE_LAYOUT_OK' | 'MOBILE_LAYOUT_ISSUES' | 'MOBILE_LAYOUT_NOT_RUN';
  severity: 'info' | 'warning';
  message: string;
  autoResolved: boolean;
}

/** The report line. PURE. */
export function mobileLayoutVerdict(run: MobileLayoutRun): MobileLayoutVerdict {
  const size = `${MOBILE_VIEWPORT.width}×${MOBILE_VIEWPORT.height}`;
  if (!run.ok || run.painted === false) {
    const why = !run.ok
      ? (run.error || run.diagnostic || 'the phone-size browser produced no result')
      : 'the app showed nothing at phone size within the wait';
    return { code: 'MOBILE_LAYOUT_NOT_RUN', severity: 'info', autoResolved: true, message: `The phone-size check (${size}) did not measure the app: ${why}.` };
  }
  const parts: string[] = [];
  const overflow = run.overflow ?? 0;
  if (overflow > OVERFLOW_TOLERANCE_PX) {
    const w = (run.wide ?? [])[0];
    const culprit = w ? ` — widest: <${w.tag}${w.cls ? ` class="${w.cls}"` : ''}> at ${w.width}px` : '';
    parts.push(`the page scrolls SIDEWAYS by ${overflow}px on a ${run.vw ?? MOBILE_VIEWPORT.width}px screen${culprit}`);
  }
  const small = run.smallCount ?? 0;
  if (small >= SMALL_TARGET_FINDING) {
    const names = (run.small ?? []).map((s) => `"${s.name}" ${s.w}×${s.h}`).join(', ');
    parts.push(`${small} control(s) are smaller than ${MIN_TAP_PX}px to tap (${names})`);
  }
  if (parts.length === 0) {
    return { code: 'MOBILE_LAYOUT_OK', severity: 'info', autoResolved: true, message: `Opened at phone size (${size}, touch): the page fits the screen and its controls are big enough to tap.` };
  }
  return { code: 'MOBILE_LAYOUT_ISSUES', severity: 'warning', autoResolved: false, message: `Opened at phone size (${size}, touch): ${parts.join('; ')}.` };
}
