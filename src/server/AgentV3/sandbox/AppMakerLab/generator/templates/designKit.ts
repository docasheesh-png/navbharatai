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
//
// 🎨 2026-09-30 (admin: "app/game ek dam simple se html bante hai — na koi design, na sundarta, na
// animations"). Rendered in a real browser, the kit told the truth only when the MODEL USED ITS CLASS
// NAMES. Markup that used the model's own names — `<div class="app">`, `<ul class="todo-list">`,
// `<button>Add</button>` — got the bare element layer: a white button with a grey hairline, a bulleted
// list, and nothing else. That is the "plain HTML" the admin sees, because that is what most generated
// markup looks like. Three changes, all here:
//   1. A ZERO-SPECIFICITY ELEMENT LAYER. Every rule for a bare element sits inside :where(), so it
//      styles markup nobody styled and can never beat a rule the app writes — a model's own
//      `.delete-btn { background: … }` always wins, where the old `button[type="submit"]` (0,1,1)
//      silently beat it. Buttons, fields, lists with a class, bare tables and form controls now look
//      designed with no class at all.
//   2. FILL AND INK ARE SEPARATE TOKENS. `--accent` stays the colour for links and accent text (light
//      enough to read on a dark page); `--accent-strong`/`--accent-deep` fill buttons (dark enough for
//      white text), `--accent-ink` is accent text on a tinted surface. One token cannot do both in
//      dark mode: white on the dark theme's #7c74ff is 3.4:1. Every pair is contrast-tested.
//   3. RECIPES FOR WHAT PEOPLE ACTUALLY BUILD and the kit did not cover: GAMES (a stage, a title, a
//      glowing start button, a HUD, touch keys), CHAT (bubbles and a composer), TABS and a TOAST.

export const DESIGN_KIT_CSS = `:root {
  color-scheme: light dark;
  --bg: #f6f7fb;
  --fg: #17171c;
  --muted: #6b7280;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-fg: #ffffff;
  --accent-soft: #eef0ff;
  --accent-ink: #4338ca;
  --accent-strong: #4f46e5;
  --accent-deep: #4338ca;
  --accent-2: #be185d;
  --success: #16a34a;
  --success-ink: #166534;
  --danger: #dc2626;
  --danger-ink: #b91c1c;
  --warning: #d97706;
  --card: #ffffff;
  --border: #e5e7eb;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(16, 17, 28, 0.06), 0 8px 24px rgba(16, 17, 28, 0.06);
  --shadow-lg: 0 24px 48px -20px rgba(16, 17, 28, 0.28);
  --ring: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
  --game-bg: #0b0a1a;
  --game-fg: #f5f5ff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d12;
    --fg: #ececf1;
    --muted: #9ca3af;
    --accent: #7c74ff;
    --accent-hover: #948dff;
    --accent-soft: #1c1b2e;
    --accent-ink: #c4c0ff;
    --accent-strong: #5b52e0;
    --accent-deep: #4a3fd6;
    --danger-ink: #fca5a5;
    --success-ink: #86efac;
    --card: #17171f;
    --border: #2a2a35;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
    --shadow-lg: 0 24px 48px -20px rgba(0, 0, 0, 0.7);
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  /* Two faint glows of the app's own accent over the page colour: a page that is one flat grey reads
     as unstyled before a single component has loaded. Scrolls with the page (a fixed background
     judders on phones). An app's own body background replaces it outright. */
  background:
    radial-gradient(960px 480px at 0% -8%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%),
    radial-gradient(720px 400px at 108% 0%, color-mix(in srgb, var(--accent-2) 7%, transparent), transparent 70%),
    var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

::selection { background: var(--accent); color: var(--accent-fg); }

/* Buttons. A bare <button> is a soft TINTED button in the app's accent — never the browser's grey box,
   never white-on-white. Submit / .primary / .btn-primary are FILLED with a brand gradient and a glow, so
   every form and CTA has real colour out of the box. The element rules are :where() — zero specificity —
   so any rule the app writes for its own button class wins outright. */
/* The geometry below is shared by every button CLASS, whatever element carries it: a "Start shopping"
   written as <a class="btn-primary"> used to get the fill and none of the shape — a square, underlined
   box (autopsy "Nemi Mart", 2026-09-30). */
:where(button), .btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-danger, :where(a.primary) {
  font: inherit;
  text-decoration: none;
  line-height: 1.2;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 8px 16px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
:where(button:hover), .btn:hover, .btn-secondary:hover { background: color-mix(in srgb, var(--accent) 18%, var(--card)); }
/* A link styled as a button keeps its button face on hover — no underline. */
.btn:hover, .btn-primary:hover, .btn-secondary:hover, .btn-ghost:hover, .btn-danger:hover { text-decoration: none; }
.btn-sm { min-height: 32px; padding: 4px 12px; font-size: 0.875rem; }
.btn-lg { min-height: 48px; padding: 12px 24px; font-size: 1.05rem; }
.btn-block { display: flex; width: 100%; }

/* A button whose own class says it destroys something reads as dangerous before anyone presses it. */
:where(button[class*="delete" i], button[class*="danger" i], button[class*="remove" i]), .btn-danger {
  background: color-mix(in srgb, var(--danger) 12%, var(--card));
  color: var(--danger-ink);
}

:where(button[type="submit"]), .btn-primary, .primary, :where(button.primary) {
  background: linear-gradient(135deg, var(--accent-strong), var(--accent-deep));
  border-color: transparent;
  color: var(--accent-fg);
  font-weight: 600;
  box-shadow: 0 8px 20px -8px color-mix(in srgb, var(--accent-strong) 70%, transparent);
}
:where(button[type="submit"]:hover), .btn-primary:hover, .primary:hover, :where(button.primary:hover) {
  background: linear-gradient(135deg, var(--accent-deep), var(--accent-deep));
  color: var(--accent-fg);
  transform: translateY(-1px);
  box-shadow: 0 12px 24px -8px color-mix(in srgb, var(--accent-strong) 75%, transparent);
}

:where(button:disabled), .btn:disabled, .btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* Fields. Checkboxes, radios, sliders and colour/file pickers are left to the browser (drawn in the
   accent below) — padding and a border would deform them. */
:where(input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"]), textarea, select) {
  font: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  min-height: 40px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
:where(input:focus-visible, textarea:focus-visible, select:focus-visible) {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--ring);
}
:where(button:focus-visible, a:focus-visible), .btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
:where(input[type="checkbox"], input[type="radio"], input[type="range"], progress, meter) { accent-color: var(--accent-strong); }
:where(input[type="checkbox"], input[type="radio"]) { width: 16px; height: 16px; }

/* A list the app gave a class to is a UI list (tasks, items, results), not prose: no bullets, no
   indent. A bare <ul> inside text keeps its bullets. */
:where(ul[class], ol[class]) { list-style: none; padding-left: 0; }

/* A bare <table> gets the data-table look (the full recipe is .nb-table below). */
:where(table) { width: 100%; border-collapse: collapse; font-size: 0.925rem; }
:where(th, td) { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
:where(th) { color: var(--muted); font-weight: 600; font-size: 0.8rem; letter-spacing: 0.02em; text-transform: uppercase; }
:where(hr) { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
:where(code, kbd) { font-size: 0.9em; padding: 0 4px; border-radius: 4px; background: var(--accent-soft); }

/* A styled card surface so panels never look like raw HTML even before the generator styles them. */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
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
  padding: 12px 16px;
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
.field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
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
.nb-table th, .nb-table td { padding: 12px 16px; text-align: left; white-space: nowrap; }
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

/* Picture placeholder — a DRAWN image for a spot that wants a photo nobody supplied. A guessed photo
   URL often fails to load (the browser blocks the error page it returns), leaving an empty frame on
   the first screen; this always renders. Put an emoji or icon inside; add .nb-img-square for a tile. */
.nb-img { display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--radius); background: linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent) 28%, var(--card))); color: var(--accent); font-size: 2.5rem; line-height: 1; }
.nb-img-square { aspect-ratio: 1 / 1; }

/* Dashboard shell — sidebar + topbar + content. Collapses to a single column on a phone, because a
   fixed sidebar on a 390px screen leaves no room for the app itself. */
.nb-shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.nb-sidebar { border-right: 1px solid var(--border); background: var(--card); padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.nb-sidebar a, .nb-nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; border-radius: 10px;
  color: var(--muted); font-size: 0.925rem; font-weight: 500; text-decoration: none;
}
.nb-sidebar a:hover, .nb-nav-item:hover { background: var(--accent-soft); color: var(--fg); text-decoration: none; }
.nb-sidebar a.active, .nb-nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.nb-nav { display: flex; flex-direction: column; gap: 4px; }
.nb-brand-icon { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 8px; object-fit: contain; }
.nb-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--card); }
.nb-main { padding: 24px 20px; min-width: 0; }
@media (max-width: 820px) {
  .nb-shell { grid-template-columns: 1fr; }
  .nb-sidebar { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  .nb-nav { flex-direction: row; }
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
.nb-modal { width: 100%; max-width: 460px; max-height: 85vh; overflow-y: auto; padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.nb-modal-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 8px; }
.nb-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

/* Toolbar — the row above a table or list: title on the left, actions pushed right, wrapping on
   a phone instead of overflowing. */
.nb-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.nb-toolbar .nb-spacer { margin-left: auto; }

/* Stat tile — the numbers across the top of a dashboard. */
.nb-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.nb-stat { padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.nb-stat-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); font-weight: 600; }
.nb-stat-value { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

/* Tabs / segmented control — "All · Active · Done", a view switcher, a filter row. The selected tab is
   marked with aria-selected="true" (or .active), which is also what a screen reader announces. */
.nb-tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: var(--radius); background: color-mix(in srgb, var(--fg) 6%, transparent); }
/* An unselected tab is NOT --muted: on the strip's own tint that is 3.9:1, below AA. */
.nb-tab { min-height: 36px; padding: 4px 16px; border: 0; border-radius: 8px; background: transparent; color: color-mix(in srgb, var(--fg) 78%, var(--bg)); font-weight: 600; }
.nb-tab:hover { background: transparent; color: var(--fg); }
.nb-tab.active, .nb-tab[aria-selected="true"] { background: var(--card); color: var(--fg); box-shadow: 0 1px 4px rgba(16, 17, 28, 0.14); }

/* Toast — a short confirmation ("Saved", "Copied") that appears and goes, never a blocking alert(). */
.nb-toast { position: fixed; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); z-index: 60; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); padding: 12px 16px; border-radius: var(--radius); background: var(--fg); color: var(--bg); box-shadow: var(--shadow-lg); font-weight: 600; animation: nb-toast-in var(--dur) var(--ease) both; }

/* Gradient text — for a hero or app title. Decoration only: keep it for large display text. */
.nb-gradient-text { background: linear-gradient(135deg, var(--accent-strong), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }

/* Chat — an assistant, a support chat, messages. Bubbles, not a list of paragraphs: the user's own
   messages on the right in the accent, the other side on the left on a card. The composer stays at the
   bottom above the phone's home bar. */
.nb-chat { display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow-y: auto; }
.nb-msg { max-width: min(80%, 560px); padding: 8px 16px; border-radius: 20px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; animation: nb-rise var(--dur) var(--ease) both; }
.nb-msg-user { align-self: flex-end; background: linear-gradient(135deg, var(--accent-strong), var(--accent-deep)); color: var(--accent-fg); border-bottom-right-radius: 8px; }
.nb-msg-bot { align-self: flex-start; background: var(--card); color: var(--fg); border: 1px solid var(--border); border-bottom-left-radius: 8px; }
.nb-composer { position: sticky; bottom: 0; display: flex; align-items: flex-end; gap: 8px; padding: 12px; padding-bottom: max(12px, env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-top: 1px solid var(--border); }
.nb-composer > input, .nb-composer > textarea { flex: 1; }
.nb-typing { display: inline-flex; gap: 4px; }
.nb-typing > span { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); animation: nb-blink 1.2s ease-in-out infinite; }
.nb-typing > span:nth-child(2) { animation-delay: 0.15s; }
.nb-typing > span:nth-child(3) { animation-delay: 0.3s; }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   SHOP — a store, a menu, a catalogue (autopsy "Nemi Mart", 2026-09-30)
   ══════════════════════════════════════════════════════════════════════════════════════════════
   What made a grocery app look like a plain web page was not its colours: it was a header that
   stacked, products in one long column, and an MRP that was not struck through. These are the shapes
   every Indian shopping app shares — Blinkit, Zepto, BigBasket — so they are drawn here once. */
.nb-header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 16px; background: color-mix(in srgb, var(--card) 90%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
.nb-brand { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 1.2rem; font-weight: 800; letter-spacing: -0.01em; color: var(--fg); text-decoration: none; }
.nb-brand:hover { text-decoration: none; }
.nb-header-actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.nb-search { flex: 1 1 220px; min-width: 0; border-radius: 999px; padding-left: 16px; background: color-mix(in srgb, var(--fg) 5%, var(--card)); }
/* Horizontal category chips — they scroll sideways on a phone instead of wrapping into a wall. */
.nb-chips { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; scrollbar-width: none; }
.nb-chips::-webkit-scrollbar { display: none; }
.nb-chip { flex: none; min-height: 36px; padding: 4px 16px; border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--fg); font-weight: 600; white-space: nowrap; }
.nb-chip:hover { background: var(--accent-soft); color: var(--accent-ink); }
.nb-chip.active, .nb-chip[aria-pressed="true"], .nb-chip[aria-selected="true"] { background: var(--accent-strong); border-color: transparent; color: var(--accent-fg); }
/* Two products side by side on a phone, more as the screen widens. */
.nb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 12px; }
@media (min-width: 640px) { .nb-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; } }
.nb-product { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.nb-product:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
/* The picture: a real <img>, or a big emoji in a tinted square when there is no photo. */
.nb-product-img { display: grid; place-items: center; width: 100%; aspect-ratio: 1; border-radius: 8px; background: var(--accent-soft); font-size: 2.75rem; object-fit: cover; }
.nb-product-title { margin: 0; font-size: 0.95rem; font-weight: 600; line-height: 1.3; }
.nb-product-meta { color: var(--muted); font-size: 0.8rem; }
.nb-product-cta { width: 100%; margin-top: auto; }
/* Price: the selling price bold, the MRP struck through beside it, the saving as a green pill. */
.nb-price-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.nb-price { font-size: 1.1rem; font-weight: 800; color: var(--fg); font-variant-numeric: tabular-nums; }
.nb-mrp { color: var(--muted); font-size: 0.85rem; text-decoration: line-through; font-variant-numeric: tabular-nums; }
.nb-discount { display: inline-flex; align-items: center; min-height: 20px; padding: 0 8px; border-radius: 999px; background: color-mix(in srgb, var(--success) 14%, var(--card)); color: var(--success-ink); font-size: 0.75rem; font-weight: 800; }
/* The discount on the picture's corner. */
.nb-product > .nb-discount { position: absolute; top: 8px; left: 8px; z-index: 1; }
/* Quantity stepper: − 1 + in one pill, replacing "Add" once the item is in the cart. */
.nb-qty { display: inline-flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 40px; padding: 0 4px; border-radius: var(--radius); background: var(--accent-strong); color: var(--accent-fg); font-weight: 800; font-variant-numeric: tabular-nums; }
.nb-qty button { min-width: 32px; min-height: 32px; padding: 0; border: 0; background: transparent; color: var(--accent-fg); font-size: 1.1rem; box-shadow: none; }
.nb-qty button:hover { background: rgba(255, 255, 255, 0.16); }
/* The cart bar: fixed to the bottom on a phone, above the home indicator. */
.nb-cart-bar { position: fixed; left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: var(--radius); background: var(--accent-strong); color: var(--accent-fg); font-weight: 700; box-shadow: var(--shadow-lg); animation: nb-rise var(--dur) var(--ease) both; }
.nb-cart-bar button, .nb-cart-bar a { background: rgba(255, 255, 255, 0.16); color: var(--accent-fg); }
.nb-footer { margin-top: 40px; padding: 24px 16px 88px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; text-align: center; }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   GAMES
   ══════════════════════════════════════════════════════════════════════════════════════════════
   A game's canvas is drawn by the game; everything AROUND it — the title screen, the start button, the
   score, the pause and game-over screens, the on-screen keys on a phone — is ordinary UI, and it is what
   a player sees first. Written as plain divs it reads as a web page with a picture in it. Every control
   here is a real <button>: a clickable div cannot be reached by keyboard or screen reader, and
   NavBharatAI's own check cannot press it to prove the game starts. */
.nb-game { position: relative; min-height: 100dvh; overflow: hidden; background: radial-gradient(circle at 50% 28%, color-mix(in srgb, var(--accent-strong) 38%, var(--game-bg)), var(--game-bg) 72%); color: var(--game-fg); touch-action: manipulation; }
.nb-game canvas { display: block; width: 100%; height: 100%; }
.nb-game-screen { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; align-content: center; gap: 16px; padding: 24px; text-align: center; background: rgba(8, 7, 20, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: nb-fade-in var(--dur) var(--ease) both; }
.nb-game-title { margin: 0; font-size: clamp(2.25rem, 9vw, 4.5rem); font-weight: 900; line-height: 1; letter-spacing: -0.03em; background: linear-gradient(135deg, var(--game-fg), color-mix(in srgb, var(--accent) 80%, var(--game-fg)) 55%, color-mix(in srgb, var(--accent-2) 70%, var(--game-fg))); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 8px 24px color-mix(in srgb, var(--accent) 55%, transparent)); }
.nb-game-sub { color: color-mix(in srgb, var(--game-fg) 72%, transparent); font-size: 1rem; }
.nb-game-btn { min-width: 200px; min-height: 52px; padding: 12px 32px; border: 0; border-radius: 999px; background: linear-gradient(135deg, var(--accent-strong), var(--accent-2)); color: var(--accent-fg); font-size: 1.1rem; font-weight: 800; letter-spacing: 0.02em; box-shadow: 0 12px 32px -8px color-mix(in srgb, var(--accent-strong) 80%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.25); animation: nb-pulse 1.8s var(--ease) infinite; }
.nb-game-btn:hover { background: linear-gradient(135deg, var(--accent-deep), var(--accent-2)); color: var(--accent-fg); animation-play-state: paused; transform: translateY(-2px) scale(1.02); }
.nb-game-btn-secondary { background: rgba(255, 255, 255, 0.1); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22); animation: none; }
.nb-game-btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }
.nb-game-hud { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 12px; right: 12px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 8px; pointer-events: none; }
.nb-game-hud button { pointer-events: auto; }
.nb-game-stat { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14); color: var(--game-fg); font-weight: 800; font-variant-numeric: tabular-nums; }
/* A health/energy bar. Set its fill with a 0–1 number: style="--value: 0.6". The fill scales (transform),
   it does not resize, so it stays smooth. */
.nb-game-bar { width: 140px; height: 12px; border-radius: 999px; overflow: hidden; background: rgba(255, 255, 255, 0.18); }
.nb-game-bar-fill { height: 100%; transform-origin: left center; transform: scaleX(var(--value, 1)); background: linear-gradient(90deg, var(--success), color-mix(in srgb, var(--success) 50%, var(--game-fg))); transition: transform var(--dur) var(--ease); }
/* On-screen keys for a phone. Round, thumb-sized, and they do not scroll or zoom the page when held. */
.nb-game-pad { position: absolute; left: 16px; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 5; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; pointer-events: none; }
.nb-game-pad > * { pointer-events: auto; }
.nb-game-keys { display: flex; gap: 12px; }
.nb-game-key { width: 64px; height: 64px; min-height: 64px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24); color: var(--game-fg); font-size: 1.4rem; font-weight: 800; touch-action: none; user-select: none; -webkit-user-select: none; }
.nb-game-key:hover { background: rgba(255, 255, 255, 0.2); }
.nb-game-key:active { transform: scale(0.94); background: rgba(255, 255, 255, 0.3); }
@media (hover: hover) and (pointer: fine) { .nb-game-pad { display: none; } }

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
:where(button), .btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-danger, .nb-nav-item, .nb-plan, .card, .nb-product {
  transition: transform var(--dur-fast) var(--ease), background-color var(--dur) var(--ease),
              border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), color var(--dur) var(--ease);
}
:where(button:active), .btn:active, .btn-primary:active, .btn-secondary:active, .btn-danger:active { transform: translateY(1px); }
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

/* A list whose items arrive one after another reads as alive rather than pasted in. Put .nb-stagger on
   the LIST, never on the page; the delay stops growing after the eighth item so a long list is not a
   slow one. */
.nb-stagger > * { animation: nb-rise var(--dur) var(--ease) both; }
.nb-stagger > :nth-child(2) { animation-delay: 40ms; }
.nb-stagger > :nth-child(3) { animation-delay: 80ms; }
.nb-stagger > :nth-child(4) { animation-delay: 120ms; }
.nb-stagger > :nth-child(5) { animation-delay: 160ms; }
.nb-stagger > :nth-child(6) { animation-delay: 200ms; }
.nb-stagger > :nth-child(7) { animation-delay: 240ms; }
.nb-stagger > :nth-child(n + 8) { animation-delay: 280ms; }

@keyframes nb-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes nb-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
@keyframes nb-toast-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

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
  :where(button:active), .btn:active, .btn-primary:active, .btn-secondary:active, .btn-danger:active,
  .btn-primary:hover, .primary:hover, .nb-game-btn:hover, .nb-product:hover,
  a > .card:hover, .card[role="button"]:hover, .card.nb-clickable:hover { transform: none; }
}
`;
