# Theme and colour rules

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read it before writing or migrating any client colour, theme or inline style. Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

## 🎨 COLOUR COMES FROM TOKENS, NEVER FROM A LITERAL (admin-mandated 2026-09-18: "pura theme system badlo")

The audit that day (72 screens × 5 themes, 420 screenshots, every text node measured) found 236 invisible
and 1,557 near-invisible text nodes, and ONE cause: the UI was written in hardcoded GitHub-dark classes
(`text-white` ×1,852, `bg-[#0d1117]`, `text-[#8b949e]` … 14,620 usages) and `theme-compat.css` re-mapped an
allowlist of them. That allowlist was patched three times for "a category I missed" and the audit found
the next 1,347. **An allowlist can never be complete against an open-ended set of class names — so the rule
is now enforced at the source, by CI.**

- **Colour is named by ROLE, through the tokens in `index.css` `@theme inline`:** `bg-surface / bg-card /
  bg-raised`, `text-ink / text-body / text-muted / text-faint`, `border-line`, `text-accent-text`,
  `text-success / text-warn / text-danger / text-info`, `text-on-accent` (white on a solid accent).
  `text-white`, `text-gray-400`, `bg-[#161b22]`, `text-indigo-300`, `style={{ color: '#…' }}` are all
  FORBIDDEN in client code. Solid brand fills (`bg-indigo-600`) are tolerated for now — they are the
  same in every theme — but prefer `bg-accent`.
- **🔒 `tests/themeTokensOnly.test.ts` is the ratchet.** `tests/fixtures/themeColourBaseline.json` records
  today's literal count PER FILE; CI fails if any file goes ABOVE its number (a new literal) or BELOW it
  without the baseline being regenerated (`node scripts/themeColourBaseline.mjs --write`, commit the
  smaller file). A file not in the baseline has a baseline of ZERO. The number only goes down.
- **A faded label is `text-muted`, not `text-ink/40`.** The old `text-white/20`–`/40` idiom is 1.9–2.2:1 on
  every theme; the same test holds every theme's palette at ≥ 4.5:1, and a 40% ink does not clear it.
- **Every theme's palette must pass WCAG AA on all 10 text × 3 surface pairs** — the test reads the blocks
  out of `index.css`. Do not add a theme, or "tune" one, that fails it (Comfort's Solarized values did).
- **Do NOT add selectors to `theme-compat.css`.** It is the thing being retired: it shrinks as files
  migrate, and is deleted when the baseline reaches zero.
- **THREE themes — Light, Dark, High contrast — and no more (PR B, 2026-09-18).** Dim and Comfort are
  RETIRED: the audit found Comfort failing on 84 of 84 screens and Dim adding nothing Dark did not.
  `src/lib/theme.ts` is the one vocabulary (`ThemeMode`, `THEME_MODES`, `normalizeThemeMode`); a saved
  `dim` is carried to `dark` and `comfort` to `light` where the value is READ (`useSettings` writes the
  successor back; the pre-paint script in `index.html` maps the same two names, so the first frame is
  right too). `tests/themeSystem.test.ts` fails if either retired palette reappears in `index.css`.
  ⚠️ Do not add a fourth theme without adding its palette to the AA lock, `THEMES` in
  `themeTokensOnly.test.ts`, the pre-paint script, and the status-bar mapping in `nativeShell.ts`.
- **`getThemeClasses` is GONE — do not bring it back in any form.** It was a per-theme bag of colour
  literals handed through props (`themeClasses`, `bgClass`); every consumer now uses the tokens
  directly (`bg-surface text-body` on the root, `bg-card border-line` on bars) and needs no JavaScript
  to know which theme it is in. `tests/theme.test.ts` asserts the export does not exist.
- **High contrast's brand hues are DISTINCT by test** (success / warn / danger / info each ≥ 7:1 on
  black and no two the same): the first version painted all four #ffff00, so a red "failed" and a
  green "saved" were the same colour to the one audience that chose this theme to read better.
- **A swatch is the one legitimate fixed colour in the picker** (the Light swatch is white even on
  Dark) and it lives in CSS as `.theme-swatch[data-swatch]`, not as a class literal in TSX.
- **Migrate a file with the codemod, not by hand (PR C, 2026-09-18):**
  `node scripts/themeMigrate.mjs <file> [--dry]` then `node scripts/themeColourBaseline.mjs --write`.
  One explicit table, two kinds of row: **EXACT** (the literal is one `theme-compat.css` already remaps,
  and the token emits the SAME variable — `tests/themeMigrate.test.ts` proves it against the compat
  file, so it is pixel-identical on every theme by construction) and **FIX** (the audit's unreadable
  idioms — `text-white/40`, a light brand shade as text, `bg-black/30` as a well — moved to the
  readable token, on purpose). Anything else is left and listed; nothing is guessed. `text-white` on
  a SOLID brand fill in the same string becomes `text-on-accent` (the compat exception, mirrored); a
  fill chosen by a ternary inside a template literal is handled only when every branch is a fill,
  otherwise it is left for a hand split. Verified on AdminDashboard: 1,073 → 1 literals, and the
  audit crawler's numbers and screenshots on the admin view are IDENTICAL before and after on all
  three themes. ⚠️ Do not extend the table with a row you cannot classify as EXACT or FIX. Since PR D
  it also knows a gradient stop into the chrome (`to-[#161b22]` → `to-card`), a hex brand fill
  (`bg-[#24292e]`), and a label directly inside a filled box (the line above opens a solid-fill
  element) — each learned from a real miss in a real file, never from a guess.
- **🔴 A TEMPLATE LITERAL THAT CONTAINS MARKUP IS SOMEBODY ELSE'S APP — never counted, never
  rewritten (PR F, 2026-09-18).** `ComponentLibrary.tsx` holds 19 copyable HTML snippets and
  `SyncedTemplates.ts` whole starter projects as backtick strings; PR D's codemod rewrote the snippets'
  classes to our tokens (`bg-gray-900` → `bg-card`), which would have handed a user a component with no
  background in THEIR plain-Tailwind app, and the census counted 219 starter-project literals as our UI.
  Caught before it reached `main`. `maskEmbeddedSources` (`themeColourBaseline.mjs`) blanks every
  template literal whose body carries `className=`, `class=` or an HTML tag — NavBharatAI's own UI never
  puts JSX in a backtick string — and BOTH the census and the codemod read through that one function. A
  class-list template (`` `px-2 ${x} text-white` ``) has no markup and is still migrated.
- **A grey label under a solid fill becomes `text-on-accent`, wherever it sits (PR F).** The codemod
  treats any non-chrome `bg-[#hex]` as a fixed brand fill (`hasHexBrandFill`) and tracks "inside a fill"
  by indentation across lines (`fillScopes`), so "UTF-8" three lines under Code Studio's `#007acc` status
  bar no longer lands on `text-muted` (1.47:1). When migrating by hand, the same rule: on `bg-indigo-600`
  or a hex fill, text is `text-on-accent`, never `text-ink`/`text-muted`.
- **A filled element names its own label colour (PR G, 2026-09-18).** A button on `bg-violet-600` with
  no `text-` class was white only because the old dark root was `text-white`; on tokens the root is
  `text-body` and the label went near-black on violet. The codemod now adds `text-on-accent` to any
  RESTING solid fill without a text colour (never to a `hover:`-only fill, never to `bg-clip-text`), and
  an inline `style={{ backgroundColor: … }}` that is not a `var(--…)` counts as a fixed fill. By hand:
  never rely on inheritance for text on a fill.
- **🔴 A FIXED box fixes everything inside it, and its LUMINANCE picks the label (PR H, 2026-09-18).**
  `bg-black`, `bg-white` and any non-chrome `bg-[#hex]` are colours the theme can never repaint, so
  every colour nested in that subtree is fixed too — a `text-white` four levels under `bg-black` must
  stay white, not become `text-ink` and vanish on Light. And white is only a legitimate label where it
  clears 4.5:1: `fixedFill()` measures it, and on a LIGHT fixed fill (Facebook's `bg-[#f0f2f5]`) the
  codemod leaves the labels exactly as written rather than guessing inside somebody else's mockup.
  **A third-party preview — a Google result, a Facebook card, a Twitter card — is that case**, and its
  literals stay counted by the ratchet rather than migrated.
  Five further distinctions the same PR had to draw, each from a real miss: a **wash** gradient (a
  translucent or themed stop, a 1px gradient border round a themed card) is NOT a fill; an element
  declaring its **own themed surface** ends any fixed subtree it sits in; a **hover** background is
  not the element's own background (`hover:bg-…` paints nothing at rest); an **inline**
  `style={{ background: '#…' }}` opens a fixed subtree and is measured like any other fill; and a
  background is **never themed while a fixed hex ink sits on the same element**. And on a fixed fill a
  **brand-coloured label keeps its literal** — `text-amber-400` stays, because `text-warn` is dark
  amber on Light and the panel under it is near-black on every theme (2.59:1); same for a hex brand
  ink such as Figma's `#a259ff` on its own dark chip.
  A **translucent tint** (`bg-amber-500/10`) is not a surface either — the fixed box shows through it,
  so "does this element have its own background?" means a resting, OPAQUE one (`hasOwnOpaqueBackground`).
  ⚠️ **While `theme-compat.css` still exists, a GitHub-dark literal is NOT self-coherent** — compat
  repaints `bg-[#0d1117]` per theme, so a fixed ink left on it goes invisible on Light. A code block
  whose background compat owns must have its ink themed too (`bg-surface text-info`), not frozen.
- **A dark tint is a Light defect; a dark shade as text is a Dark defect.** `bg-emerald-900/30` →
  `bg-emerald-500/10` (≤ 60% only — above that it is an opaque panel, by hand) and `text-emerald-600` →
  `text-success`. Both are counted by the census since PR G, so the ratchet sees them.
- **A panel must not carry a PRIVATE theme.** SecurityScan had its own `useState<'dark' | 'light'>`
  and a "Light Mode" button with 23 ternaries; removed in PR G. One theme, the app's — a local toggle is
  a second theme system and is deleted, not migrated.
- **Two more tokens exist since PR C:** `bg-well` (an inset panel inside a card — the old
  `bg-black/20–40` on dark; a 6% ink wash on light) and `bg-scrim` (the modal backdrop, deliberately
  the same dark on every theme because it dims what is behind it).
- **AN INLINE STYLE IS A COLOUR LITERAL TOO, and the codemod could not see one until PR L
  (2026-09-20).** The class table had `theme-compat.css` remapping it per theme; an inline style was
  remapped by NOTHING — `style={{ color: 'rgba(255,255,255,0.4)' }}` is white-at-40% on Light exactly
  as on Dark, 1.1:1, one of the audit's 236 invisible nodes. The codemod could not see a single one.
  `themeMigrate.mjs` now carries an inline table (`INLINE_TEXT` / `INLINE_LINE` / `INLINE_BG`):
  **inline literals 296 → 206** across 15 files (37 exact, 57 readability fixes).
  ⚠️ **The ratchet's 991 is 695 CLASS literals and 296 inline ones — MEASURED, after an earlier draft
  of this bullet asserted the tail was "almost entirely" inline from reading the top three files.** The
  class sweep is its own later slice. ⚠️ **`exact` is MEASURED here too, never claimed**: there
  is no compat layer to be identical to, so a row is `exact` only when the literal IS that role's
  value in `DARK_VALUE` — which `tests/themeMigrate.test.ts` asserts against `index.css`'s own dark
  block. Inheriting `exact` from the class rows (where it means "compat remaps it") would have
  labelled `#e6edf3 → --text-body` as no change when Dark's `--text-body` is `#c9d1d9`.
  🔴 **A DECLARATION'S CONTEXT IS ITS ELEMENT, NEVER ITS LINE**, and this is the one rule not to
  simplify: the first version asked what the background on that LINE was, and a style object is
  routinely written over several — so `color: 'white'` under `background: '#4f46e5'` saw no fill and
  became `--text-primary`, near-black on indigo at ~2.2:1. **The tool that removes invisible labels
  created one**, caught in its own diff before it left the branch. And the object was not enough
  either: `AuthComponent`'s Apple button sets its fill in `className` (`bg-black text-on-accent`) with
  a forced `color: '#ffffff'` beside it whose own comment says it exists to be unthemeable — that one
  broke TRAP 3 and needed `elementAt` + `elementFixesItsLabel`. **A fill is a fill whether it is
  written as a style or as a class.** Eight cases in `tests/themeMigrate.test.ts` lock both halves,
  proven by reversion.
- **🔴 `@theme inline` EMITS NO CUSTOM PROPERTY — so `var(--color-…)` names NOTHING in an inline style
  (verified 2026-09-20).** That is what `inline` means: the utility (`text-on-accent`) gets the value
  baked in, and no `--color-*` variable ever reaches the stylesheet. Checked against the built CSS, not
  reasoned about: `--color-surface`, `--color-ink`, `--color-well`, `--color-scrim` and
  `--color-on-accent` are **all absent**, while `--text-muted`, `--surface-well`, `--scrim` and
  `--accent` — declared in `@layer base` — are present. So `style={{ color: 'var(--color-on-accent)' }}`
  would resolve to nothing, `color` would fall back to the inherited `--text-body`, and a label on a
  solid indigo button would render near-black on Light. **Nothing would fail**: not tsc, not a test, not
  the ratchet, which counts literals and has no opinion about a var that does not exist. The CLASSES are
  fine and widely used; it is only the raw `var(--color-…)` form that is a silent no-op.
  ⚠️ **No shipped component had this bug** — it was found because the inline codemod emitted exactly
  that shape and its own diff was read. **In an inline style use the `@layer base` names**: `--accent`,
  `--on-accent`, `--text-*`, `--surface-*`, `--border-soft`, `--scrim`, `--brand-*`.
  🔒 `--on-accent` is now declared in all three palette blocks and `@theme inline` points
  `--color-on-accent` at it, so the utility and the raw var are one value rather than two.
  `tests/everyTokenAStyleUsesIsDeclared.test.ts` fails CI on any `var(--x)` in client code that nothing
  anywhere declares — reversion-proven. It knows the three ways this app really declares one (a CSS
  declaration, a style-object key, `setProperty`), because `--nbai-pane` is written by `splitPane.ts`
  and read by `AgentV3Panel.tsx`, and `--nb-font-scale` is set imperatively in `a11y.ts`; a narrower
  scan would report half the app as broken and be switched off within a week.
- **⚠️ `tests/inlineThemeColours.test.ts` ALREADY GOVERNED INLINE COLOURS since 2026-08-16 — read it
  before touching them.** Its three traps are binding: **1** a library config is not a DOM style
  (`ShellTerminal`'s xterm theme parses colours itself and cannot read `var()`); **2** the user's
  colours are not ours (`MultiPageBuilder`, `DarkModeGenerator`, `WhitelabelBranding` export colours
  into the USER'S app, where our variables do not exist); **3** a label on a brand fill keeps its white.
  The codemod now names those files in `INLINE_SKIP` and treats a brand fill as FIXED — theming it is
  not even an improvement, since white on Dark's `--accent` (#818cf8) is 3.0:1 against 5.6:1 on #4f46e5.
  🔴 **I did not find that suite before writing the pass, and it cost a full red gate** — safeguard #6's
  vocabulary failure exactly: I searched the codemod and the ratchet, never `find tests -iname "*inline*"`.
- **The class sweep and the inline sweep are SEPARATE runs (`--inline-only`), on purpose.** They touch
  different literals and collide with different pinned tests, so mixing them makes the diff
  unreviewable and the failures indistinguishable. A file whose class literals an earlier PR
  deliberately left — a status dot whose `bg-emerald-500` a test names, an exit dialog's `bg-white/10` —
  must not be migrated as a side effect of fixing its inline styles.
