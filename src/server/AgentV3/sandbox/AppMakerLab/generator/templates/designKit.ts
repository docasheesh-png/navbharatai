// THE DESIGN KIT — one stylesheet, one source of truth, every scaffold.
//
// WHY THIS FILE EXISTS (admin report 2026-08-11: "1st page beautiful, andar ke page bas HTML feel
// dete hai"). Investigating that turned up something bigger than the reported symptom: this kit — the
// palette tokens, the component classes and the screen recipes the architect prompt tells every build
// to reuse — existed in exactly ONE of the 24 scaffold providers. A Vue, Svelte, Preact or Solid app
// was told to reach for `.card` and `.nb-empty` and had nothing behind them, so its pages had no
// design language to be consistent WITH. Those builds start from zero every time, which is precisely
// where quality varies most.
//
// It lives here, alone, because the alternative is the failure mode rule 4 warns about: four copies
// that drift. A change to the palette must reach every scaffold at once or the kit is worthless as a
// standard.
//
// Consumed by ViteReactProviderContents (as `indexCss`) and by every other frontend provider.

export const DESIGN_KIT_CSS = `:root {
  color-scheme: light dark;
  --bg: #f6f7fb;
  --fg: #17171c;
  --muted: #6b7280;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-fg: #ffffff;
  --accent-soft: #eef0ff;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #d97706;
  --card: #ffffff;
  --border: #e5e7eb;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(16, 17, 28, 0.06), 0 8px 24px rgba(16, 17, 28, 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d12;
    --fg: #ececf1;
    --muted: #9ca3af;
    --accent: #7c74ff;
    --accent-hover: #948dff;
    --accent-soft: #1c1b2e;
    --card: #17171f;
    --border: #2a2a35;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

::selection { background: var(--accent); color: var(--accent-fg); }

/* Buttons: the default is a subtle secondary; submit / .primary / .btn-primary get the SATURATED
   brand colour so every form and CTA has visible colour out of the box — never a grey-on-grey button. */
button, .btn {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 16px;
  background: var(--card);
  color: var(--fg);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
button:hover, .btn:hover { border-color: var(--accent); }

button[type="submit"], .btn-primary, .primary, button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
button[type="submit"]:hover, .btn-primary:hover, .primary:hover, button.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--accent-fg);
}

input, textarea, select {
  font: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 12px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* A styled card surface so panels never look like raw HTML even before the generator styles them. */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
}

/* PREMIUM DEFAULTS (M2-S2.1 design system): a small, tasteful component kit so every app looks
   designed out of the box — a floor, not a ceiling (generators override freely). Theme-aware. */

/* Typographic scale — clear hierarchy instead of raw browser <h1..h6>/<p> sizing. */
h1 { font-size: 2rem;    line-height: 1.2;  font-weight: 800; letter-spacing: -0.02em; margin: 0 0 0.5em; }
h2 { font-size: 1.5rem;  line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 0.5em; }
h3 { font-size: 1.25rem; line-height: 1.3;  font-weight: 700; margin: 0 0 0.4em; }
h4 { font-size: 1.05rem; line-height: 1.35; font-weight: 600; margin: 0 0 0.4em; }
p  { margin: 0 0 1em; }
small, .muted { color: var(--muted); }

/* Ghost button — a third, quieter action next to the primary/secondary. */
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--accent);
}
.btn-ghost:hover { background: var(--accent-soft); border-color: transparent; }

/* Badges — small status pills using the semantic colours. */
.badge {
  display: inline-flex; align-items: center; gap: 0.35em;
  font-size: 0.75rem; font-weight: 700; line-height: 1;
  padding: 0.3em 0.6em; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
}
.badge-success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.badge-danger  { background: color-mix(in srgb, var(--danger) 15%, transparent);  color: var(--danger); }
.badge-warning { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }

/* Alerts — a tinted, bordered message block for info/success/error/warning states. */
.alert {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  background: var(--card);
}
.alert-success { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--card)); }
.alert-danger  { border-color: var(--danger);  background: color-mix(in srgb, var(--danger) 8%, var(--card)); }
.alert-warning { border-color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, var(--card)); }

/* Layout helpers — a centred page container and tiny flex utilities so structure is easy and consistent. */
.container { width: 100%; max-width: 1080px; margin-inline: auto; padding-inline: 16px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.row   { display: flex; align-items: center; gap: 12px; }

/* Labelled field — vertical label + input spacing so forms read cleanly. */
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.field > label { font-size: 0.85rem; font-weight: 600; color: var(--muted); }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   COMPONENT RECIPES (ROADMAP #1 Phase 3.2)
   ══════════════════════════════════════════════════════════════════════════════════════════════
   The screens every app needs and every model re-invents badly: a data table, an empty state, a
   dashboard shell, a hero, pricing, an auth card, loading skeletons and a dialog. Written once,
   here, so the FIRST build already looks designed instead of the model producing a fresh mediocre
   version of each per app — which also costs fewer tokens than describing them every time.

   NAMES ARE PREFIXED ON PURPOSE. Tailwind ships "table", "hidden", "hero"-adjacent and other bare
   utility names; a plain ".table" here would silently fight "class="table"" in any app that also
   uses Tailwind. Every recipe below is ".nb-*" so the two can coexist in the same project without
   either one quietly losing. */

/* Data table — sticky header, zebra rows, hover, and a horizontal scroll that keeps the PAGE from
   scrolling sideways on a phone (the usual mobile-table defect). Wrap: <div class="nb-table-wrap">. */
.nb-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.nb-table { width: 100%; border-collapse: collapse; font-size: 0.925rem; }
.nb-table th, .nb-table td { padding: 10px 14px; text-align: left; white-space: nowrap; }
.nb-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--card); color: var(--muted);
  font-weight: 600; font-size: 0.8rem; letter-spacing: 0.02em; text-transform: uppercase;
  border-bottom: 1px solid var(--border);
}
.nb-table tbody tr { border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.nb-table tbody tr:last-child { border-bottom: 0; }
.nb-table tbody tr:hover { background: var(--accent-soft); }
.nb-table td.nb-num { text-align: right; font-variant-numeric: tabular-nums; }

/* Empty state — what a new user sees FIRST, before any data exists. A blank panel reads as broken,
   so this always carries an explanation and room for the action that fills it. */
.nb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 48px 24px; text-align: center; color: var(--muted); }
.nb-empty-icon { font-size: 2.5rem; line-height: 1; opacity: 0.5; }
.nb-empty-title { font-size: 1.05rem; font-weight: 700; color: var(--fg); }
.nb-empty-text { max-width: 40ch; font-size: 0.9rem; }

/* Dashboard shell — sidebar + topbar + content. Collapses to a single column on a phone, because a
   fixed sidebar on a 390px screen leaves no room for the app itself. */
.nb-shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.nb-sidebar { border-right: 1px solid var(--border); background: var(--card); padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.nb-sidebar a, .nb-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 10px;
  color: var(--muted); font-size: 0.925rem; font-weight: 500; text-decoration: none;
}
.nb-sidebar a:hover, .nb-nav-item:hover { background: var(--accent-soft); color: var(--fg); text-decoration: none; }
.nb-sidebar a.active, .nb-nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); }
.nb-main { padding: 24px 20px; min-width: 0; }
@media (max-width: 820px) {
  .nb-shell { grid-template-columns: 1fr; }
  .nb-sidebar { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  .nb-main { padding: 16px; }
}

/* Hero — the first screen of a landing page. The gradient uses the app's own accent, so it is
   branded rather than a stock purple that belongs to no product. */
.nb-hero { padding: 72px 20px; text-align: center; background: linear-gradient(160deg, var(--accent-soft), transparent 70%); border-bottom: 1px solid var(--border); }
.nb-hero h1 { font-size: clamp(2rem, 5vw, 3.25rem); max-width: 22ch; margin-inline: auto; }
.nb-hero-sub { max-width: 56ch; margin: 0 auto 24px; color: var(--muted); font-size: clamp(1rem, 2.2vw, 1.15rem); }
.nb-hero-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

/* Pricing — equal-height cards with one highlighted plan, which is what makes a pricing page read. */
.nb-pricing { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); align-items: stretch; }
.nb-plan { display: flex; flex-direction: column; gap: 12px; padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.nb-plan-featured { border-color: var(--accent); box-shadow: var(--shadow); position: relative; }
.nb-plan-price { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.02em; }
.nb-plan-price small { font-size: 0.9rem; font-weight: 500; color: var(--muted); }
.nb-plan ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 0.925rem; color: var(--muted); }
.nb-plan .nb-plan-cta { margin-top: auto; }

/* Auth card — a centred sign-in/sign-up panel. Narrow on purpose: a full-width login form on a
   desktop looks unfinished. */
.nb-auth { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.nb-auth-card { width: 100%; max-width: 380px; padding: 28px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.nb-auth-card h1 { font-size: 1.4rem; margin-bottom: 4px; }
.nb-auth-sub { color: var(--muted); font-size: 0.9rem; margin: 0 0 20px; }

/* Loading skeleton — shown while data is on its way. A spinner says "something is happening"; a
   skeleton says WHAT is coming, so the layout does not jump when it arrives. */
.nb-skeleton { background: linear-gradient(90deg, var(--border) 25%, color-mix(in srgb, var(--border) 40%, transparent) 50%, var(--border) 75%); background-size: 200% 100%; animation: nb-shimmer 1.4s ease-in-out infinite; border-radius: 8px; min-height: 14px; }
@keyframes nb-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
/* Honour a reader who asked the system for less motion — the shimmer is decoration, not information. */
@media (prefers-reduced-motion: reduce) { .nb-skeleton { animation: none; } }

/* Dialog — a modal over a dimmed page. */
.nb-modal-backdrop { position: fixed; inset: 0; background: rgba(9, 9, 14, 0.55); display: grid; place-items: center; padding: 20px; z-index: 50; }
.nb-modal { width: 100%; max-width: 460px; max-height: 85vh; overflow-y: auto; padding: 22px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.nb-modal-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 6px; }
.nb-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

/* Toolbar — the row above a table or list: title on the left, actions pushed right, wrapping on
   a phone instead of overflowing. */
.nb-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.nb-toolbar .nb-spacer { margin-left: auto; }

/* Stat tile — the numbers across the top of a dashboard. */
.nb-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.nb-stat { padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.nb-stat-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); font-weight: 600; }
.nb-stat-value { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   MOTION (ROADMAP #1 Phase 3.3)
   ══════════════════════════════════════════════════════════════════════════════════════════════
   The difference between an app that feels built and one that feels generated is usually motion:
   a button that responds, a panel that arrives instead of appearing. But bad motion is worse than
   none, so three rules are enforced by what is written here rather than left to the model:

   1. ONLY transform AND opacity ARE ANIMATED. Animating width/height/top/margin makes the browser
      re-layout the page on every frame, which is what produces the janky, cheap-feeling animation
      people associate with generated apps. transform and opacity are composited and stay smooth.

   2. FAST, OR IT IS IN THE WAY. 120-220ms. Anything slower stops being feedback and becomes a
      delay the user waits out on every single interaction, dozens of times an hour.

   3. NOTHING MOVES FOR SOMEONE WHO ASKED IT NOT TO. The reduced-motion block at the end turns ALL
      of it off — for many people this is a vestibular-illness accommodation, not a preference, and
      an app that honours it only for the decorative shimmer has not honoured it at all. */

:root {
  --ease: cubic-bezier(0.2, 0, 0.2, 1);   /* quick out, gentle in — reads as responsive, not floaty */
  --dur-fast: 120ms;
  --dur: 180ms;
}

/* Interactive elements acknowledge a press. The lift is 1px: enough to feel, too small to nudge
   the layout or distract. */
button, .btn, .nb-nav-item, .nb-plan, .card {
  transition: transform var(--dur-fast) var(--ease), background-color var(--dur) var(--ease),
              border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), color var(--dur) var(--ease);
}
button:active, .btn:active { transform: translateY(1px); }
/* Cards lift only when they are actually clickable — a static panel that moves under the cursor is
   noise pretending to be feedback. */
a > .card:hover, .card[role="button"]:hover, .card.nb-clickable:hover { transform: translateY(-2px); box-shadow: var(--shadow); }

/* Entrances. Content that fades AND rises slightly reads as "arrived"; content that only appears
   reads as a page glitch. Applied by the app to panels and list items, never to the whole page —
   an app whose every screen animates in feels slow. */
@keyframes nb-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes nb-rise    { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes nb-pop     { from { opacity: 0; transform: scale(0.97); }     to { opacity: 1; transform: none; } }
.nb-fade { animation: nb-fade-in var(--dur) var(--ease) both; }
.nb-rise { animation: nb-rise var(--dur) var(--ease) both; }

/* A dialog arrives; it does not blink into existence. */
.nb-modal-backdrop { animation: nb-fade-in var(--dur-fast) var(--ease) both; }
.nb-modal { animation: nb-pop var(--dur) var(--ease) both; }

/* Spinner — for the cases a skeleton cannot cover (a button mid-submit). */
@keyframes nb-spin { to { transform: rotate(360deg); } }
.nb-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  animation: nb-spin 700ms linear infinite;
  display: inline-block; vertical-align: -3px;
}

/* THE ACCOMMODATION. Everything above goes quiet — but the app stays fully usable, so states still
   CHANGE, they just stop moving. A spinner is kept visible (removing it would hide that something is
   loading); it simply stops rotating. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  button:active, .btn:active,
  a > .card:hover, .card[role="button"]:hover, .card.nb-clickable:hover { transform: none; }
}
`;
