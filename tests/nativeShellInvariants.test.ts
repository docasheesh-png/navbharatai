import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE NATIVE-SHELL SETTINGS THAT WERE PAID FOR IN BUGS.
 *
 * Every value asserted here was arrived at by something breaking in a real build, on a real device or
 * in TestFlight, and each is documented with its autopsy in capacitor.config.ts / index.css. They share
 * one dangerous property: **each looks like an obvious thing to "optimise"**, and none of them fails
 * loudly when changed — the app still compiles, still builds, still passes every other test, and then
 * misbehaves on a phone nobody is holding at the time.
 *
 * The immediate trigger for writing this (2026-08-11): a generic "make it feel native" checklist was
 * proposed that, followed literally, would have set `launchAutoHide: false` — the exact change whose
 * comment reads "This bricked the app once — do not 'optimise' it back". A comment is advice. A test is
 * a gate. These are now gates.
 *
 * ADDITIVE ONLY — this file asserts existing behaviour and changes nothing. If a value here genuinely
 * needs to change, change it deliberately and update the reason beside it; do not delete the case.
 */
const root = join(__dirname, '..');
const capacitorConfig = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
const indexCss = readFileSync(join(root, 'src/index.css'), 'utf8');

/**
 * Comments stripped. These files are heavily annotated with the very mistakes being guarded against —
 * `launchAutoHide: false` appears in prose explaining the incident — so a negative assertion against
 * the raw text matches the WARNING and fails on a correct config.
 */
const code = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const capacitorCode = code(capacitorConfig);

describe('splash — the setting that bricked the app once', () => {
  it('launchAutoHide stays TRUE', () => {
    // With false, the native side waits forever for a JS hide() call. That call sat behind an awaited
    // status-bar call which can hang in a WKWebView, so one hang anywhere = a permanently frozen app
    // with no fallback. Observed in TestFlight, 2026-07-26.
    expect(capacitorCode).toMatch(/launchAutoHide:\s*true/);
    expect(capacitorCode).not.toMatch(/launchAutoHide:\s*false/);
  });

  it('the splash background matches the app surface, or dark-mode launch flashes white', () => {
    // Left unset it defaults to WHITE — a white sheet between the splash and the dark UI, which is the
    // single most obvious "this is a web page loading" moment in the whole launch.
    expect(capacitorConfig).toMatch(/backgroundColor:\s*'#0d1117'/);
  });

  it('keeps a fade-out rather than a hard cut', () => {
    expect(capacitorConfig).toMatch(/launchFadeOutDuration:\s*\d+/);
  });
});

describe('keyboard — the loudest WebView giveaway in a chat app', () => {
  it("resize stays 'native', so the WEBVIEW shrinks instead of the document scrolling", () => {
    // The web default scrolls the document to reveal the focused input, which jerks the whole page and
    // slides the header away — the moment everyone recognises as "this is a web page".
    expect(capacitorConfig).toMatch(/resize:\s*'native'/);
  });

  it('there is exactly ONE keyboard-height source of truth', () => {
    // Two independent keyboard calculations is how a composer ends up double-padded, with a dead gap
    // above the keyboard.
    const shell = readFileSync(join(root, 'src/lib/nativeShell.ts'), 'utf8');
    expect(shell).toContain('KEYBOARD_HEIGHT_VAR');
    expect(shell).toContain("'--nb-keyboard-height'");
  });
});

describe('safe area — one inset, never two', () => {
  it("iOS contentInset stays 'never' so WKWebView does not inset on top of our CSS", () => {
    // 'automatic' made the WebView ALSO inset, so the notch and home-indicator areas were padded
    // TWICE — a wasted black strip above the header and below the composer.
    expect(capacitorConfig).toMatch(/contentInset:\s*'never'/);
  });

  it('the app owns its insets through the --nb-safe-* variables', () => {
    for (const v of ['--nb-safe-top', '--nb-safe-bottom', '--nb-safe-left', '--nb-safe-right']) {
      expect(indexCss, `${v} missing`).toContain(v);
    }
    expect(indexCss).toContain('env(safe-area-inset-top');
  });
});

describe('viewport height — the fallback pair is deliberate, not a leftover', () => {
  it('body/#root declare 100vh AND then 100dvh', () => {
    // A raw grep for "100vh" reads this as a bug and it is the opposite: the first line is the fallback
    // for engines without dvh, the second overrides it everywhere else. Deleting either one breaks a
    // real set of devices — dropping 100vh breaks old WebViews, dropping 100dvh brings back the
    // keyboard-resize jump. (I nearly "fixed" this myself on 2026-08-11 off a checklist.)
    const block = indexCss.slice(indexCss.indexOf('body, #root'), indexCss.indexOf('body, #root') + 200);
    expect(block).toContain('height: 100vh');
    expect(block).toContain('height: 100dvh');
    expect(block.indexOf('100vh')).toBeLessThan(block.indexOf('100dvh')); // order IS the mechanism
  });

  it('the app shell uses the supports() guard rather than assuming dvh', () => {
    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
    expect(app).toContain('supports-[height:100dvh]');
  });
});

describe('tap-to-zoom — the other thing that instantly reads as a website', () => {
  it('inputs are 16px on touch devices, so focusing one does not zoom the page', () => {
    expect(indexCss).toContain('@media (hover: none) and (pointer: coarse)');
    expect(indexCss).toMatch(/font-size:\s*16px\s*!important/);
  });
});

describe('the store identity and delivery mode', () => {
  it('the published bundle id is unchanged — it is PERMANENT once shipped', () => {
    // Changing this after publication does not update the app; it creates a different one.
    expect(capacitorConfig).toContain("appId: 'com.navbharat.ai'");
  });

  it('BUNDLED mode: no server.url, so the app boots from its own dist/', () => {
    // If this ever gains a server.url the app becomes a remote-site wrapper: offline launch dies, and
    // a bad deploy takes every installed app down with it. It is also the reason frontend changes need
    // a new .aab/.ipa to reach store users — see the note in CLAUDE.md.
    expect(capacitorCode).toContain("webDir: 'dist'");
    expect(capacitorCode).not.toMatch(/server:\s*\{[^}]*url:/);
  });

  it('all three published sign-in providers stay wired', () => {
    // Apple is not optional: guideline 4.8 requires it wherever a third-party login is offered, and
    // dropping it is an App Store rejection rather than a bug report.
    for (const p of ['google.com', 'apple.com', 'github.com']) {
      expect(capacitorConfig, `${p} missing`).toContain(`'${p}'`);
    }
  });
});
