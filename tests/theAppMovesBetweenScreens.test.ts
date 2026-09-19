import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldAnimateViewChange,
  restartScreenEnter,
  SCREEN_ENTER_CLASS,
  type AnimatableElement,
} from '../src/lib/screenTransition';

/**
 * 🎬 THE APP MOVES BETWEEN SCREENS (admin 2026-09-19, item B of five: "mujhe sabse acchi native app
 * banani hai").
 *
 * Switching tabs replaced the content instantly — what a web page does when you click a link, and the
 * second-loudest "this is a website" signal after the scrollbar the same admin photographed.
 *
 * Three things are locked, and each of them is a way this feature could be "finished" and still wrong:
 *   1. it must not REMOUNT (the obvious `key={activeView}` throws away scroll and typed input);
 *   2. it must run in the LAYOUT phase (one frame late means the new screen flashes at full opacity
 *      before fading in — worse than no animation);
 *   3. it must be OFF for the website and for anyone who asked their device for less motion.
 */

const root = process.cwd();
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
/**
 * App.tsx with its comments removed.
 *
 * ⚠️ NEEDED, not tidiness: the first draft of the `key={activeView}` guard below matched the JSDoc
 * that EXPLAINS why there is no such key — a test that fails on its own prose and can never fail for
 * the reason it was written. CLAUDE.md records this exact trap.
 */
const appCode = app
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join('\n');
const css = readFileSync(join(root, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** A DOM double that records the order of class operations and the reflow read. */
function fakeElement() {
  const calls: string[] = [];
  const el: AnimatableElement = {
    classList: {
      add: (t: string) => { calls.push(`add:${t}`); },
      remove: (t: string) => { calls.push(`remove:${t}`); },
    },
    get offsetWidth() { calls.push('reflow'); return 0; },
  };
  return { el, calls };
}

describe('shouldAnimateViewChange — the two cases that would look like a bug', () => {
  it('animates a real change', () => {
    expect(shouldAnimateViewChange('home', 'studio')).toBe(true);
  });

  it('does NOT animate the first render', () => {
    // There is no previous screen on launch, and fading the app in here would be a second hand-off
    // immediately after the splash has already faded out.
    expect(shouldAnimateViewChange(null, 'home')).toBe(false);
    expect(shouldAnimateViewChange(undefined, 'home')).toBe(false);
  });

  it('does NOT animate a re-render that did not change the view', () => {
    // An unrelated state change re-runs the effect; replaying the animation would make the screen
    // flicker for no reason the user can see.
    expect(shouldAnimateViewChange('studio', 'studio')).toBe(false);
  });
});

describe('restartScreenEnter — replaying an animation without a remount', () => {
  it('removes, forces a reflow, then adds — in that order', () => {
    // ⚠️ THE REFLOW IS LOAD-BEARING. Remove-then-add inside one frame is coalesced into no change at
    // all, so the animation silently never restarts and the second tab tap does nothing.
    const { el, calls } = fakeElement();
    restartScreenEnter(el);
    expect(calls).toEqual([`remove:${SCREEN_ENTER_CLASS}`, 'reflow', `add:${SCREEN_ENTER_CLASS}`]);
  });

  it('is safe on a missing node and on a node that throws', () => {
    expect(() => restartScreenEnter(null)).not.toThrow();
    expect(() => restartScreenEnter(undefined)).not.toThrow();
    const hostile = {
      classList: { add() { throw new Error('detached'); }, remove() { throw new Error('detached'); } },
    } as unknown as AnimatableElement;
    // A navigation must never fail because a decoration could not play.
    expect(() => restartScreenEnter(hostile)).not.toThrow();
  });
});

describe('the CSS is gated, and gated in CSS', () => {
  it('animates only inside the native shell', () => {
    expect(css).toMatch(/html\.nb-native-shell\s+\.nb-screen-enter\s*\{[^}]*animation:\s*nb-screen-in/);
    // EVERY rule that mentions the class must be gated — an ungated one would animate the website,
    // which nobody asked for. Asserted by reading each selector rather than by a negative regex: the
    // first draft used one and it matched the GOOD rule, because `html.nb-native-shell .nb-screen-enter`
    // contains a space before the class.
    const selectors = [...css.matchAll(/([^{}]*\.nb-screen-enter[^{}]*)\{/g)].map((m) => m[1].trim());
    expect(selectors.length, 'the rule must exist to be judged').toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel, `"${sel}" animates outside the native shell`).toContain('nb-native-shell');
    }
  });

  it('is switched off under prefers-reduced-motion', () => {
    const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced, 'a decorative animation is exactly what that setting exists to switch off').toBeTruthy();
    expect(reduced![1]).toMatch(/\.nb-screen-enter/);
    expect(reduced![1]).toMatch(/animation:\s*none/);
  });

  it('is a fade-through, not a slide, and short', () => {
    const frames = css.match(/@keyframes nb-screen-in \{([\s\S]*?)\n\}/);
    expect(frames, 'the keyframes must exist').toBeTruthy();
    // A slide says "forward"/"back"; a tab change is neither, so there is no translate here.
    expect(frames![1]).not.toMatch(/translate/);
    expect(frames![1]).toMatch(/opacity:\s*0/);
    expect(frames![1]).toMatch(/scale\(0\.9\d\)/);
    const duration = css.match(/animation:\s*nb-screen-in\s+(\d+)ms/);
    expect(Number(duration![1])).toBeGreaterThanOrEqual(150);
    expect(Number(duration![1]), 'past ~250ms a screen change feels slow rather than smooth').toBeLessThanOrEqual(250);
  });
});

describe('the wiring keeps the screen alive', () => {
  it('runs in the LAYOUT phase, not after paint', () => {
    expect(appCode).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(shouldAnimateViewChange/);
  });

  it('🔒 does NOT key the screen container on the view', () => {
    // `key={activeView}` restarts the animation by remounting — taking scroll positions, half-typed
    // messages and open panels with it. That is a regression wearing a polish's clothes.
    const at = appCode.indexOf('<div ref={screenRef}');
    expect(at, 'the screen container must carry the ref').toBeGreaterThan(-1);
    expect(appCode.slice(at, at + 400)).not.toMatch(/key=\{activeView\}/);
    expect(appCode, 'nothing in App.tsx may remount on a view change').not.toMatch(/key=\{activeView\}/);
  });

  it('remembers the previous view in a ref, so a re-render cannot replay it', () => {
    expect(appCode).toContain('previousViewRef.current = activeView;');
  });
});
