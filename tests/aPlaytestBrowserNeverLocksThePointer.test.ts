// NO POINTER LOCK UNDER AUTOMATION (Q-3380, 2026-11-26). Measured on #4552: the playtest clicked the game canvas, the
// game asked for pointer lock, and in the automated headless browser that flooded the page with synthetic input
// (108,052 messages in 3 s) — the game drew 1–4 fps because of our browser, not its own code (4 → 15 fps with the lock
// stubbed). #4552 makes the kit shell skip the lock under navigator.webdriver; #4553 stubbed it in two lanes with two
// hand-written copies. The CLASS: a platform browser that sends input to an app behaves unlike a person's browser, and
// the app is judged on it. So the stub is ONE source (sandboxBrowserScript.ts) and this file is the census: every
// platform browser under src/server that opens a page AND clicks, taps or types installs it on every page or context it
// opens, before any app code runs — the journey, sign-in and Engineer AI browsers and the playtest's phone had none.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import { NO_POINTER_LOCK_INIT, noPointerLockInstall } from '../src/server/AgentV3/sandboxBrowserScript';
import { gamePlaytestScript } from '../src/server/AgentV3/gamePlaytest';
import { clickExplorerScript } from '../src/server/AgentV3/clickExplorer';
import { journeyScript } from '../src/server/AgentV3/journeyDerivation';
import { signInScript } from '../src/server/AgentV3/signInExplore';
import { BROWSER_ACTION_SCRIPT, SCREENSHOT_CDP_SCRIPT, uiScanScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const ROOT = join(__dirname, '..');
const OPENS_A_PAGE = /\.newPage\(|\.newContext\(|connectOverCDP\(/;
// Input that gives a page user activation — the only thing that lets a page lock the pointer at all.
const SENDS_INPUT = /\.(?:click|dblclick|tap|press)\(|\.mouse\.|\.keyboard\.|\.touchscreen\./;
// A page opened and assigned: `const page = await browser.newPage(…)`, `const ctx=browser.contexts()[0]||await browser.newContext(…)`.
const OPENER = /(?:const|let|var)\s+(\w+)\s*=\s*(?:[^;\n]*\|\|\s*)?await\s+(\w+)\.(newPage|newContext)\(/g;

/** Browsers that open an app page but never send it input: Chromium refuses pointer lock without user activation. */
const VISIT_ONLY: Record<string, string> = {
  'src/server/AgentV3/PageRouteCheck.ts': 'loads each route and reads it; never clicks',
  'src/server/AgentV3/mobileLayoutCheck.ts': 'loads the app at phone size and measures the layout; never taps',
  'src/server/AgentV3/gameAssets/assetBrowserProof.ts': 'renders a model on its own blank page; no app code, no input',
};

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : serverFiles(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

/** Every opener in the source either opens a page on an already-stubbed context or installs the stub right after it. */
function unstubbedOpeners(src: string): string[] {
  const contexts = new Set([...src.matchAll(OPENER)].filter((m) => m[3] === 'newContext').map((m) => m[1]));
  const lines = src.split('\n');
  const bad: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(OPENER)) {
      const [, v, receiver, kind] = m;
      if (kind === 'newPage' && contexts.has(receiver)) continue;
      const next = lines.slice(i + 1, i + 5).join('\n');
      if (!next.includes(`\${noPointerLockInstall('${v}')}`)) bad.push(`line ${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  return bad;
}

/** The same rule on a GENERATED script: the install comes after the opener and before the first navigation. */
function scriptUnstubbed(script: string): string[] {
  const install = (v: string) => `await ${v}.addInitScript(${NO_POINTER_LOCK_INIT});`;
  const stubbed = new Set<string>();
  const bad: string[] = [];
  const openers = [...script.matchAll(OPENER)];
  expect(openers.length).toBeGreaterThan(0);
  for (const m of openers) {
    const [, v, receiver, kind] = m;
    if (kind === 'newPage' && stubbed.has(receiver)) continue;
    const at = m.index! + m[0].length;
    const goto = script.indexOf('.goto(', at);
    const window = script.slice(at, goto < 0 ? script.length : goto);
    if (window.includes(install(v))) { if (kind === 'newContext') stubbed.add(v); } else bad.push(m[0]);
  }
  return bad;
}

describe('🖱️ a platform browser never lets an app lock the pointer', () => {
  it('census: every src/server browser that opens a page and sends it input installs the ONE shared stub', () => {
    const openers = serverFiles(join(ROOT, 'src/server')).filter((f) => OPENS_A_PAGE.test(readFileSync(f, 'utf8')));
    const interactive: string[] = [];
    const visitOnly: string[] = [];
    for (const f of openers) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const src = readFileSync(f, 'utf8');
      if (!SENDS_INPUT.test(src)) { visitOnly.push(rel); continue; }
      interactive.push(rel);
      expect(src, `${rel} must import the shared stub`).toMatch(/\bnoPointerLockInstall\b[^;]*from '[./]*sandboxBrowserScript'/);
      expect(src.includes('requestPointerLock = function'), `${rel} keeps its own copy of the stub`).toBe(false);
      expect(unstubbedOpeners(src), `${rel} opens a page without the stub`).toEqual([]);
    }
    // A NEW visit-only browser is seen here too: it is listed with its reason, or it sends input and is checked above.
    expect(visitOnly.sort()).toEqual(Object.keys(VISIT_ONLY).sort());
    expect(interactive.length).toBeGreaterThanOrEqual(5);
  });

  it('every interactive script installs it on every page or context before the app loads', () => {
    const scripts: Record<string, string> = {
      'game playtest (desktop + phone)': gamePlaytestScript('http://127.0.0.1:5173/'),
      'click explorer': clickExplorerScript('http://127.0.0.1:5173/', { blockWrites: true }),
      'journeys': journeyScript('http://127.0.0.1:5173/', [], 'NBAI_J '),
      'sign-in explorer': signInScript('http://127.0.0.1:5173/', []),
      'Engineer AI browser action': BROWSER_ACTION_SCRIPT,
      'Engineer AI screenshot': SCREENSHOT_CDP_SCRIPT,
      'Engineer AI UI scan': uiScanScript('http://127.0.0.1:5173/'),
    };
    for (const [name, s] of Object.entries(scripts)) expect(scriptUnstubbed(s), name).toEqual([]);
    // The playtest stubs BOTH its contexts — the phone taps the canvas too.
    expect(scripts['game playtest (desktop + phone)'].split(noPointerLockInstall('ctx')).length - 1).toBe(1);
    expect(scripts['game playtest (desktop + phone)']).toContain(noPointerLockInstall('m'));
  });

  it('the shared Engineer AI browser also stubs the document that is ALREADY open (a CDP context outlives this script)', () => {
    for (const s of [BROWSER_ACTION_SCRIPT, SCREENSHOT_CDP_SCRIPT, uiScanScript('http://127.0.0.1:5173/')]) {
      const at = s.indexOf(`await page.evaluate(${NO_POINTER_LOCK_INIT})`);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(s.indexOf('page.goto('));
    }
  });

  it('only a variable name can be the install target', () => {
    expect(() => noPointerLockInstall('page); evil(')).toThrow();
    expect(noPointerLockInstall('page')).toBe(`await page.addInitScript(${NO_POINTER_LOCK_INIT});`);
  });

  it('the stub really replaces the lock and keeps a game that awaits it working', async () => {
    let locked = false;
    class Element { requestPointerLock() { locked = true; return Promise.resolve(); } }
    const sandbox: Record<string, unknown> = { Element, Promise };
    runInNewContext(`(${NO_POINTER_LOCK_INIT})();`, sandbox);
    const canvas = new Element();
    await expect(canvas.requestPointerLock()).resolves.toBeUndefined();
    expect(locked).toBe(false);
  });

  it('a read-only prototype does not throw into the page', () => {
    const Element = function () { /* frozen */ } as unknown as { prototype: object };
    Object.defineProperty(Element.prototype, 'requestPointerLock', { value: () => 'real', writable: false });
    expect(() => runInNewContext(`'use strict'; (${NO_POINTER_LOCK_INIT})();`, { Element, Promise })).not.toThrow();
  });
});
