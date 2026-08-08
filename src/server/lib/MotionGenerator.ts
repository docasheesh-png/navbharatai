// Frontend MOTION generator — the last ❌ in the audit's frontend cluster.
//
// Micro-interactions are most of what makes a built app feel alive rather than assembled, and until now
// they were LLM-authored ad hoc: a different hand-rolled transition every build, often none at all.
// This is the recipe, in the same shape as `UiStatesGenerator` — a small, real, DEPENDENCY-FREE pack the
// generated app reuses everywhere.
//
// NO ANIMATION LIBRARY, DELIBERATELY. framer-motion is excellent and costs ~40 KB gzipped plus a React
// version constraint, for effects that CSS does natively and the GPU does better. An app builder that
// silently adds 40 KB to every app it makes to fade a card in has spent the user's load budget on our
// convenience. Everything here is `transform`/`opacity` — the two properties a browser can animate off
// the main thread — so it stays smooth on the low-end Android phones most Indian users actually hold.
//
// ACCESSIBILITY IS NOT OPTIONAL HERE. Motion is the one visual flourish that can make real people
// physically ill: vestibular disorders turn parallax and large slides into nausea and vertigo. So
// `prefers-reduced-motion` is honoured in BOTH directions — the CSS disables every animation under the
// media query, and `useReducedMotion` gives the same answer to JS so a scroll reveal does not fade
// something in that CSS has already decided to show instantly. A pack that respected only the CSS half
// would leave JS-gated content invisible for exactly the users who asked for less motion, which is
// worse than having no reduced-motion support at all.
//
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface MotionResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const MOTION_CSS = `/* Motion primitives — transform/opacity only, so the compositor can run them off the
   main thread. Imported once (see instructions); every class below is safe to add to any element. */

@keyframes nb-fade-in     { from { opacity: 0; }                              to { opacity: 1; } }
@keyframes nb-slide-up    { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes nb-slide-down  { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
@keyframes nb-scale-in    { from { opacity: 0; transform: scale(.96); }       to { opacity: 1; transform: none; } }

.nb-fade-in    { animation: nb-fade-in    .28s ease-out both; }
.nb-slide-up   { animation: nb-slide-up   .32s cubic-bezier(.22,.61,.36,1) both; }
.nb-slide-down { animation: nb-slide-down .32s cubic-bezier(.22,.61,.36,1) both; }
.nb-scale-in   { animation: nb-scale-in   .24s cubic-bezier(.22,.61,.36,1) both; }

/* Stagger a list without writing a delay per item: <li class="nb-slide-up" style="--nb-i:3"> */
[style*="--nb-i"] { animation-delay: calc(var(--nb-i) * 60ms); }

/* Interaction feedback. Kept small on purpose — a button that leaps is a button that feels broken. */
.nb-press      { transition: transform .12s ease, box-shadow .12s ease; }
.nb-press:active         { transform: scale(.97); }
.nb-lift       { transition: transform .18s ease, box-shadow .18s ease; }
.nb-lift:hover           { transform: translateY(-2px); }

/* Focus must never be animated away — keyboard users need it instantly visible. */
.nb-press:focus-visible,
.nb-lift:focus-visible   { outline: 2px solid currentColor; outline-offset: 2px; }

/* THE ACCESSIBILITY CONTRACT. Motion can cause real nausea and vertigo for people with vestibular
   disorders, so a user who asked their OS for less motion gets none of it — and still sees everything,
   because each animation resolves to its final state rather than being removed. */
@media (prefers-reduced-motion: reduce) {
  .nb-fade-in, .nb-slide-up, .nb-slide-down, .nb-scale-in {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .nb-press, .nb-lift { transition: none !important; }
  .nb-press:active, .nb-lift:hover { transform: none !important; }
}
`;

const USE_REDUCED_MOTION = `import { useEffect, useState } from 'react';

/**
 * Does this user want less motion? Mirrors the CSS \`prefers-reduced-motion\` query so JS-driven
 * animation makes the SAME decision the stylesheet already made.
 *
 * Without this, a scroll reveal would keep its content hidden until an animation that CSS has disabled
 * "finishes" — leaving the page blank for exactly the people who asked for less movement.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
`;

const USE_IN_VIEW = `import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled into view. For reveal-on-scroll, without a library.
 *
 * It stops observing after the first hit: a reveal that re-runs every time you scroll past is a
 * distraction, and an observer left attached to an unmounted node is a leak. Falls back to "visible"
 * wherever IntersectionObserver does not exist (older browsers, SSR, jsdom) — content must never be
 * hidden by a missing API.
 */
export function useInView<T extends Element = HTMLDivElement>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
`;

const REVEAL = `import React from 'react';
import { useInView } from '../hooks/useInView';
import { useReducedMotion } from '../hooks/useReducedMotion';

type Animation = 'fade-in' | 'slide-up' | 'slide-down' | 'scale-in';

interface RevealProps {
  children: React.ReactNode;
  /** Which entrance to play. Default: slide-up. */
  animation?: Animation;
  /** Position in a staggered list — drives the CSS delay. */
  index?: number;
  className?: string;
}

/**
 * Animate children in the first time they scroll into view.
 *
 * The content is ALWAYS rendered — only the animation class is conditional. Gating the children
 * themselves would hide them from search engines and from anyone whose JS failed, to save a fade.
 */
export function Reveal({ children, animation = 'slide-up', index, className = '' }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const animate = inView && !reduced;
  return (
    <div
      ref={ref}
      className={[animate ? \`nb-\${animation}\` : '', className].filter(Boolean).join(' ')}
      style={animate && typeof index === 'number' ? ({ ['--nb-i' as string]: index } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
`;

const FILES: Record<string, string> = {
  'src/styles/motion.css': MOTION_CSS,
  'src/hooks/useReducedMotion.ts': USE_REDUCED_MOTION,
  'src/hooks/useInView.ts': USE_IN_VIEW,
  'src/components/Reveal.tsx': REVEAL,
};

/** Every helper this pack can emit, by the name callers pass to `include`. PURE. */
export const MOTION_HELPERS: readonly string[] = ['motion', 'useReducedMotion', 'useInView', 'Reveal'];

/**
 * Generate the motion pack. `include` optionally filters by helper name (e.g. ["Reveal"]); default =
 * all. Dependencies that a chosen helper cannot work without are pulled in automatically — asking for
 * `Reveal` alone and getting a file that imports two hooks it did not emit would be a broken app, not a
 * smaller one. Pure — returns the files. Never throws.
 */
export function generateMotion(include?: string[]): MotionResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.(tsx?|css)$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    // Reveal imports both hooks; emitting it without them ships an app that does not compile.
    if (files['src/components/Reveal.tsx']) {
      files['src/hooks/useInView.ts'] = FILES['src/hooks/useInView.ts'];
      files['src/hooks/useReducedMotion.ts'] = FILES['src/hooks/useReducedMotion.ts'];
    }
    // Every animation class lives in the stylesheet — without it the classes are no-ops.
    if (Object.keys(files).length > 0) files['src/styles/motion.css'] = FILES['src/styles/motion.css'];
    if (Object.keys(files).length === 0) files = { ...FILES }; // nothing matched → the full pack
  }

  return {
    files,
    dependencies: [], // CSS + React only; no animation library, no bundle cost
    instructions:
      `Added a dependency-free motion pack (${Object.keys(files).length} files). Import the stylesheet ONCE ` +
      "(e.g. `import './styles/motion.css'` in main.tsx), then:\n" +
      '- Entrances: add `nb-fade-in`, `nb-slide-up`, `nb-slide-down` or `nb-scale-in` to any element.\n' +
      '- Stagger a list: same class plus `style={{ ["--nb-i"]: i }}` on each item.\n' +
      '- Interaction: `nb-press` on buttons, `nb-lift` on cards.\n' +
      '- On scroll: wrap in `<Reveal>` (or `<Reveal animation="scale-in" index={i}>` inside a list).\n' +
      'Everything animates transform/opacity only, so it stays smooth on low-end phones, and every effect ' +
      'switches itself off under `prefers-reduced-motion` — motion can cause real nausea, and the content ' +
      'still shows instantly either way.',
  };
}
