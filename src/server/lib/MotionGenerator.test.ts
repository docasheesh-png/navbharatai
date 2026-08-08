import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateMotion, MOTION_HELPERS } from './MotionGenerator';

/**
 * The motion recipe — the audit's last frontend ❌.
 *
 * Two properties matter more than "does it emit files": it must not silently spend the user's load
 * budget on an animation library, and it must not make people ill. Both are asserted, not assumed.
 */

describe('generateMotion — the full pack', () => {
  const all = generateMotion();

  it('emits the stylesheet, both hooks and the Reveal component', () => {
    expect(Object.keys(all.files).sort()).toEqual([
      'src/components/Reveal.tsx',
      'src/hooks/useInView.ts',
      'src/hooks/useReducedMotion.ts',
      'src/styles/motion.css',
    ]);
  });

  it('adds NO dependency — an app builder must not spend 40 KB to fade a card in', () => {
    // framer-motion is excellent and costs ~40 KB gzipped plus a React version constraint, for effects
    // CSS does natively. Charging every generated app for our convenience is not a trade we get to make.
    expect(all.dependencies).toEqual([]);
    const source = Object.values(all.files).join('\n');
    for (const lib of ['framer-motion', 'react-spring', 'gsap', 'animejs', 'motion/react']) {
      expect(source).not.toContain(lib);
    }
  });

  it('animates ONLY transform and opacity — the two a browser runs off the main thread', () => {
    // This is what keeps it smooth on the low-end Android phones most Indian users actually hold.
    const css = all.files['src/styles/motion.css'];
    // Scope to the @keyframes bodies only — the media query legitimately resets other properties.
    const keyframeBodies = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n?\}/g)].map((m) => m[1]);
    expect(keyframeBodies.length).toBe(4);
    const animatedProps = keyframeBodies
      .flatMap((body) => [...body.matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
    expect(animatedProps.length).toBeGreaterThan(0);
    for (const prop of animatedProps) {
      expect(['opacity', 'transform']).toContain(prop);
    }
  });
});

describe('THE ACCESSIBILITY CONTRACT — motion can cause real nausea', () => {
  const all = generateMotion();
  const css = all.files['src/styles/motion.css'];

  it('every entrance and interaction is switched off under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toBeTruthy();
    for (const cls of ['nb-fade-in', 'nb-slide-up', 'nb-slide-down', 'nb-scale-in', 'nb-press', 'nb-lift']) {
      expect(block).toContain(cls);
    }
  });

  it('content stays VISIBLE when motion is off — disabled, not deleted', () => {
    // Removing the animation without resetting opacity would leave the element at its `from` state,
    // i.e. invisible, for exactly the users who asked for less movement.
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('opacity: 1 !important');
    expect(block).toContain('transform: none !important');
  });

  it('JS makes the SAME decision as the CSS, or scroll-revealed content never appears', () => {
    // The half-implemented version of this feature honours the media query in CSS only, so a JS-gated
    // reveal waits forever for an animation the stylesheet already cancelled.
    expect(all.files['src/hooks/useReducedMotion.ts']).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(all.files['src/components/Reveal.tsx']).toContain('const reduced = useReducedMotion()');
    expect(all.files['src/components/Reveal.tsx']).toContain('inView && !reduced');
  });

  it('focus is never animated away — keyboard users need it instantly', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline:');
  });

  it('Reveal always RENDERS its children — never gates content behind an animation', () => {
    // Gating the children would hide them from search engines and from anyone whose JS failed.
    const reveal = all.files['src/components/Reveal.tsx'];
    expect(reveal).toContain('{children}');
    expect(reveal).not.toMatch(/\{\s*(?:inView|animate)\s*&&\s*children\s*\}/);
  });
});

describe('useInView — an observer that cleans up and never hides content', () => {
  const hook = generateMotion(['useInView']).files['src/hooks/useInView.ts'];

  it('disconnects on unmount AND after the first hit', () => {
    expect(hook).toContain('return () => observer.disconnect()');
    expect(hook).toContain('setInView(true); observer.disconnect();');
  });

  it('falls back to VISIBLE where IntersectionObserver does not exist', () => {
    // SSR, jsdom and older browsers. Content must never be hidden by a missing API.
    expect(hook).toContain("typeof IntersectionObserver === 'undefined'");
    expect(hook).toContain('setInView(true); return;');
  });
});

describe('include — a subset must still be a working app', () => {
  it('asking for Reveal alone pulls in the hooks it imports', () => {
    // Emitting a component whose imports do not exist is a smaller pack and a broken build.
    const files = Object.keys(generateMotion(['Reveal']).files).sort();
    expect(files).toContain('src/hooks/useInView.ts');
    expect(files).toContain('src/hooks/useReducedMotion.ts');
  });

  it('any subset still ships the stylesheet — the classes are no-ops without it', () => {
    expect(Object.keys(generateMotion(['useInView']).files)).toContain('src/styles/motion.css');
  });

  it('an unmatched or empty filter falls back to the full pack rather than emitting nothing', () => {
    expect(Object.keys(generateMotion(['nonsense']).files)).toHaveLength(4);
    expect(Object.keys(generateMotion([]).files)).toHaveLength(4);
  });

  it('junk input never throws', () => {
    for (const bad of [undefined, [], ['', '   '], [null as unknown as string]]) {
      expect(() => generateMotion(bad)).not.toThrow();
    }
  });

  it('every advertised helper name really selects something', () => {
    for (const name of MOTION_HELPERS) {
      expect(Object.keys(generateMotion([name]).files).length).toBeGreaterThan(0);
    }
  });
});

describe('the instructions tell the truth about what was added', () => {
  it('names the one-time import, the classes, and the reduced-motion behaviour', () => {
    const { instructions } = generateMotion();
    expect(instructions).toContain('motion.css');
    expect(instructions).toContain('nb-slide-up');
    expect(instructions).toContain('prefers-reduced-motion');
  });

  it('never claims a dependency was installed', () => {
    expect(generateMotion().instructions.toLowerCase()).toContain('dependency-free');
  });
});

/**
 * THE WIRING. A generator nothing can call is dead code — the exact defect this session spent the day
 * removing (a real Render deploy engine with no caller; a route nobody could reach). A recipe is only
 * real when the builder can actually invoke it.
 */
describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is a registered tool, present in BOTH the definition and the exposed catalog list', () => {
    // Two separate places; a tool defined but absent from the list is invisible to the agent.
    expect(catalog).toContain("name: 'generate_animation'");
    expect(catalog).toContain("  'generate_animation',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_animation': {");
    expect(dispatcher).toContain('const motion = generateMotion(motionInclude)');
    expect(dispatcher).toContain('motionWritten.push');
  });

  it('the tool description does not promise a library it never installs', () => {
    const at = catalog.indexOf("name: 'generate_animation'");
    const def = catalog.slice(at, at + 1600);
    expect(def).toContain('NO animation library');
    expect(def).toContain('prefers-reduced-motion');
    expect(def).not.toContain('framer-motion');
  });
});
