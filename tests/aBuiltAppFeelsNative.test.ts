/**
 * 📱 A BUILT APP MUST FEEL LIKE AN APP, NOT A WEBSITE IN A FRAME.
 *
 * Admin, 2026-10-11, verbatim: *"navbharatai jo app banaye aur navbharatai khud dono ko real netiv app
 * feel aye aisa banao! aur bhi jyada micro polish karo!!"*
 *
 * 🔴 MEASURED BEFORE WRITING ANYTHING, and the split was lopsided. NavBharatAI's OWN shell has had
 * native polish since 2026-07-08 (`src/lib/nativeShell.ts`, 444 lines: splash, status bar, haptics with
 * a tap tone and user prefs, back button, keyboard inset) and its `index.html` already carried
 * `viewport-fit=cover` and the Apple meta tags. **The apps it BUILDS had none of it** — `appDefaults.ts`
 * gave a generated app exactly `width=device-width, initial-scale=1.0` and a `theme-color`.
 *
 * 🔑 AND THE WORST PART WAS INVISIBLE TO AN `ensure`-STYLE PATCHER. `appDefaults`'s viewport rule is
 * guarded by `name=["']viewport["']`, and **Vite's own template always ships a viewport** — so the rule
 * never fired, and `viewport-fit=cover` never arrived. Without that one token
 * **`env(safe-area-inset-*)` resolves to 0px on every device**: a fixed header sits under the notch, a
 * bottom bar sits under the home indicator, and any safe-area CSS the app writes does nothing at all.
 * A patcher that only ADDS missing tags cannot fix a wrong ATTRIBUTE on a tag that is already there,
 * which is why the viewport is now upgraded in place.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  withViewportFitCover,
  nativeFeelHeadTags,
  nativeFeelLinkTag,
  nativeFeelStylesheet,
  NATIVE_FEEL_HREF,
  hasNativeFeel,
  nativeFeelBuildRule,
  nativeFeelEnabled,
  NATIVE_FEEL_CSS,
} from '../src/server/AgentV3/nativeFeel';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';

/** Exactly what Vite scaffolds — the case the old presence test could never fix. */
const VITE_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

describe('📱 the viewport token everything else depends on', () => {
  it('upgrades the viewport Vite already wrote — the case an ensure cannot reach', () => {
    const out = withViewportFitCover(VITE_INDEX);
    expect(out.changed).toBe(true);
    expect(out.html).toMatch(/content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
    // One viewport, not two.
    expect(out.html.match(/name="viewport"/g) ?? []).toHaveLength(1);
  });

  it('is idempotent — a rebuild never stacks the token', () => {
    const once = withViewportFitCover(VITE_INDEX).html;
    const twice = withViewportFitCover(once);
    expect(twice.changed).toBe(false);
    expect(twice.html).toBe(once);
    expect(once.match(/viewport-fit=cover/g) ?? []).toHaveLength(1);
  });

  it('keeps an app\'s own viewport choices and only appends', () => {
    const custom = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />';
    const out = withViewportFitCover(custom);
    expect(out.html).toMatch(/user-scalable=no, viewport-fit=cover/);
  });

  it('touches nothing when there is no viewport, or nothing to work with', () => {
    expect(withViewportFitCover('<html><head></head></html>').changed).toBe(false);
    expect(withViewportFitCover('<meta name="viewport">').changed).toBe(false); // no content attribute
    expect(withViewportFitCover('').changed).toBe(false);
    expect(() => withViewportFitCover(undefined as unknown as string)).not.toThrow();
  });
});

describe('📱 what a generated app actually receives', () => {
  const result = planAppDefaults(VITE_INDEX, 'Chai Wala', { description: 'Order chai' });
  const html = String(result.indexHtml ?? '');

  it('gets the safe-area token, so its safe-area CSS can resolve at all', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it('gets the phone meta tags, so an installed app is not a browser tab', () => {
    expect(html).toMatch(/name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style"/);
    expect(html).toMatch(/name="mobile-web-app-capable" content="yes"/);
  });

  it('gets the behaviour baseline as a FILE, linked once — not inlined into the user\'s document', () => {
    // ⚠️ THE SHAPE HERE IS A CORRECTION. The first version inlined ~2.5 KB of CSS as a <style>, and
    // `theBootGuardRanOnOneLaneOfTwo` failed: it caps what WE persist into a user's index.html at 2,000
    // bytes, because an 18 KB preview shim once got saved into a user's source. The guard was right.
    expect(hasNativeFeel(html)).toBe(true);
    expect(html).toMatch(/<link rel="stylesheet" href="\/nbai-native\.css"/);
    expect(result.files['nbai-native.css']).toBe(nativeFeelStylesheet());
    expect(html).not.toMatch(/-webkit-tap-highlight-color/);  // the CSS lives in the file, not the page
    expect(html.match(/data-nbai-native-feel/g) ?? []).toHaveLength(1);
    // Re-running the whole patcher is a no-op, which is this module's stated contract.
    const again = String(planAppDefaults(html, 'Chai Wala', { description: 'Order chai' }).indexHtml ?? html);
    expect(again.match(/data-nbai-native-feel/g) ?? []).toHaveLength(1);
    // ⚠️ COUNT THE ATTRIBUTE, NOT THE WORD. A loose /viewport-fit/ also matches the baseline CSS's own
    // comment explaining why the token matters — my first assertion counted 2 and read it as a duplicate
    // tag. The invariant is that the META TAG carries it exactly once.
    expect(again.match(/<meta\b[^>]*viewport-fit=cover[^>]*>/gi) ?? []).toHaveLength(1);
  });

  it('still has one head, one title, and valid structure', () => {
    expect(html.match(/<\/head>/gi) ?? []).toHaveLength(1);
    expect(html.match(/<title>/gi) ?? []).toHaveLength(1);
    expect(html.indexOf('data-nbai-native-feel')).toBeLessThan(html.indexOf('</head>'));
  });
});

describe('📱 the baseline fixes the specific tells, and paints nothing', () => {
  it('names each tell', () => {
    // Each of these is here because its ABSENCE is a visible "this is a web page" signal.
    expect(NATIVE_FEEL_CSS).toMatch(/-webkit-tap-highlight-color:\s*transparent/);  // the tap flash
    expect(NATIVE_FEEL_CSS).toMatch(/overscroll-behavior-y:\s*contain/);            // pull-to-refresh
    expect(NATIVE_FEEL_CSS).toMatch(/touch-action:\s*manipulation/);                // the 300ms tap delay
    expect(NATIVE_FEEL_CSS).toMatch(/font-size:\s*max\(16px/);                      // iOS input zoom
    expect(NATIVE_FEEL_CSS).toMatch(/-webkit-overflow-scrolling:\s*touch/);         // momentum
    expect(NATIVE_FEEL_CSS).toMatch(/text-size-adjust:\s*100%/);                    // rotate re-flow
    expect(NATIVE_FEEL_CSS).toMatch(/transform:\s*scale\(0\.97\)/);                 // a tap is answered
    expect(NATIVE_FEEL_CSS).toMatch(/--safe-top:\s*env\(safe-area-inset-top/);      // the notch
  });

  it('🎨 PAINTS NOTHING — colour belongs to the app and to THEME_RULES, never to a baseline', () => {
    // A baseline that set a colour would fight every generated app's own theme.
    expect(NATIVE_FEEL_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(NATIVE_FEEL_CSS).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    expect(NATIVE_FEEL_CSS).not.toMatch(/(?:^|[\s;{])(?:background|color)\s*:/m);
  });

  it('never fights the app: touch rules are scoped to touch, and motion respects the preference', () => {
    expect(NATIVE_FEEL_CSS).toMatch(/@media \(pointer: coarse\)/);
    expect(NATIVE_FEEL_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // The selectors name CONTROLS, so a paragraph keeps its text selection.
    const selectUse = NATIVE_FEEL_CSS.slice(NATIVE_FEEL_CSS.indexOf('user-select') - 400, NATIVE_FEEL_CSS.indexOf('user-select'));
    expect(selectUse).toMatch(/button|role="button"/);
    expect(NATIVE_FEEL_CSS).not.toMatch(/^\s*\*\s*\{/m); // never a bare universal selector
  });

  it('the prompt rule asks only for what CSS cannot decide', () => {
    const rule = nativeFeelBuildRule().join('\n');
    expect(rule).toMatch(/inputMode="numeric"/);
    expect(rule).toMatch(/enterKeyHint/);
    expect(rule).toMatch(/44x44px/);
    expect(rule).toMatch(/var\(--safe-bottom\)/);
    // It must NOT re-state what the baseline already guarantees, or the model wastes tokens undoing it.
    expect(rule).toMatch(/do NOT re-declare those/);
    expect(rule).not.toMatch(/tap-highlight/);
  });

  it('the kill switch turns all of it off', () => {
    const off = { AGENTV3_NATIVE_FEEL: 'off' } as NodeJS.ProcessEnv;
    expect(nativeFeelEnabled(off)).toBe(false);
    expect(nativeFeelBuildRule(off)).toEqual([]);
    expect(nativeFeelEnabled({ } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('keeps the user\'s own index.html small — the 2,000-byte guard that caught the first design', () => {
    // One link tag, not a stylesheet's worth of bytes.
    expect(nativeFeelLinkTag().length).toBeLessThan(120);
    expect(NATIVE_FEEL_HREF).toBe('/nbai-native.css');
    // ⚠️ Assert OUR contribution, not a total borrowed from another test's fixture — my first version
    // reused the 2,000-byte figure from `theBootGuardRanOnOneLaneOfTwo`, whose document is a different
    // one, so the number meant nothing here. Measured: the baseline costs 75 bytes in the document.
    const doc = String(planAppDefaults(VITE_INDEX, 'Chai Wala').indexHtml ?? '');
    const withoutLink = doc.replace(/\s*<link[^>]*nbai-native[^>]*>/, '');
    expect(doc.length - withoutLink.length).toBeLessThan(120);
    expect(nativeFeelStylesheet().length).toBeGreaterThan(1_000);   // the CSS is real…
    expect(withoutLink).not.toMatch(/tap-highlight|touch-action/);  // …and entirely outside the document
  });

  it('every head tag is presence-tested, so it is added once and never duplicated', () => {
    const doc = nativeFeelHeadTags().map((t) => t.tag).join('\n');
    for (const t of nativeFeelHeadTags()) expect(t.test.test(doc), t.label).toBe(true);
  });
});

describe('📱 NavBharatAI\'s own app gets the same two fixes', () => {
  const CSS = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

  it('answers a tap, and stops hover sticking after one', () => {
    // Removing the tap highlight in 2026-07-26 took away the browser's feedback and put nothing back.
    const touch = CSS.slice(CSS.indexOf('NATIVE-FEEL FIX, round 2'));
    expect(touch).toMatch(/@media \(pointer: coarse\)/);
    expect(touch).toMatch(/button:active[\s\S]{0,200}transform: scale\(0\.97\)/);
    expect(touch).toMatch(/transition: transform 90ms/);
  });

  it('gives its own nested scrollers momentum, not just the document', () => {
    const touch = CSS.slice(CSS.indexOf('NATIVE-FEEL FIX, round 2'));
    expect(touch).toMatch(/overflow-y[\s\S]{0,300}-webkit-overflow-scrolling: touch/);
  });

  it('and gives none of it to someone who asked for less motion', () => {
    expect(CSS).toMatch(/@media \(pointer: coarse\) and \(prefers-reduced-motion: reduce\)/);
  });

  it('already had the loud tells covered — this did not re-do them', () => {
    // Guarded so a later session does not "add" what the 2026-07-26 audit already fixed.
    expect(CSS).toMatch(/-webkit-tap-highlight-color: transparent/);
    expect(CSS).toMatch(/overscroll-behavior-y/);
    expect(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')).toMatch(/viewport-fit=cover/);
  });
});
