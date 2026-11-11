# BR1975 — a Satyam Engineering Works website whose header nav overflowed a phone

Scope: BR1975 only, inside the frozen audit boundary 1951..2105. Branched from `7a06f2ee561e51e91b40a125727c9419f71d6d39` (the #4165 squash-merge of exact BR1974 head `685b1efb0`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1976 is not started. Nothing was replayed, deployed or reconfigured; no provider was called. `get_failed_build_autopsy` is a failed-build endpoint and returned "Failed report not found" for this succeeded report — read only, no remote autopsy write.

## What the user asked

"Give me one one website code for name satyam engineering works" (62 characters / 11 words). A new one-shot company website for that name. Full text is in the evidence file.

## What happened (IST, 2026-11-08)

1. **09:41:57.** FREE_BUILD_TIME_CAP 25 min. APP_SCOPE ordinary one-shot (not a mega-project). TIER_LADDER Weak default. COMPLEXITY_ROUTING simple score 15 (source=model) — opens on the first rung. Surplus admitted (qwen3-coder). ETA ~4–10 min (midpoint ~6, blended, confidence 0.86, evidenced from 28 recent unsized-app builds). PROJECT_MODE is ON for the account, but the prompt is not a mega-project — normal path. REQUEST_SCOPE_NOTE: no sign-in words, so no login/accounts were added.
2. **09:43:35.** Fast lane 91.6 s (generate 72.9 s). WRITE REJECTED on `src/components/Footer.tsx` (line 15:0, Unexpected `<<`) — not saved. PLATFORM_WRITE_REFUSED (unresolved warning). SIMPLE_BUILD_VERIFY_ERROR: `src/components/Footer` imported by `src/App.tsx` was missing. SIMPLE_BUILD_FALLBACK / TYPECHECK_FAILED; 11 files salvaged (no Footer). Repair ran 4.1 s over 1 round and did not recreate Footer. ONESHOT_SKIPPED (already 11 files).
3. **09:44:19.** EXPLORATION_WITHOUT_CHANGE: 8 read-only turns after hand-back.
4. **09:45:46.** First real-browser render at 229 s (22 files last-known-good).
5. **09:46:12.** Architect `edit_file` on `index.html` missed (`old_string` not found; auto-resolved). Production-defaults later rewrote `index.html`.
6. **09:48:04–09:49:53.** DESIGN_KIT_KEPT (stylesheet rewrite dropped kit rules; they were restored). READY_BEFORE_END at step 20 (92/100), then 6 more steps / 101 s. Journey passed (contact form submitted; nothing was saved and reloaded — no backend was requested). MOBILE_LAYOUT_ISSUES: at 390×844 the page scrolled SIDEWAYS by 260 px — `<nav> "Home Services About Contact"` was 296 px wide, reaching 650 px; Services/About/Contact were 24 px tall. RELEASE_GATE YELLOW for that phone-size finding. BUG_HUNT_NOT_RUN (offer unanswered — the 30 s userWait). Ended 09:49:53 (476181 ms / 7.94 min, 446181 ms not counting the wait). ETA ratio 1.26, INSIDE the band.

Charged false (weak / free tier; billedUsd 0). Sandbox cost $0.021844. Outcome **succeeded** (`ok=true`). Truncation complete. counts.unresolved is 3 (PLATFORM_WRITE_REFUSED, MOBILE_LAYOUT_ISSUES, RELEASE_GATE). Accessibility 100/100; design consistency 100/100. Manifest 22 files including `src/components/Header.tsx`, `src/components/Footer.tsx` (recreated by the full builder), `src/components/Hero.tsx`, `src/components/Services.tsx`, `src/components/About.tsx`, `src/components/Contact.tsx`.

The user-facing summary called the site "responsive" and "works on all device sizes". The phone check measured 260 px of sideways scroll.

## Root cause (F1)

The delivered `Header.tsx` was `<header className="nb-header"><div className="container row justify-between items-center"><div className="nb-brand"><h1/></div><nav><ul className="row gap-24"><li><a/>…`. Brand and nav sit inside an inner nowrap `.row`, and the links sit in a nowrap `ul.row` (296 px wide, reaching x=650 on a 390 px phone — 260 px of sideways scroll). The kit already wraps `.nb-header` itself (and `.nb-header-actions` / `.nb-topbar`), but that does not wrap those inner flex boxes. Three links were also 24 px tall.

Independent review of #4168 at `c201c6e6b` showed the first head missed this tree: it wrapped `<header>` and `<nav>` (so the inner `.row` still overflowed), used `:where(header) nav` / `:where(header) nav a` (not zero specificity), set `display:flex` / `inline-flex` on every header nav and its links, and applied to every `<header>` (game HUDs, card/article headers). The comment also said the nav reached 650 px; it was 296 px wide, reaching x=650.

## Prevention classes in this PR

| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | On phone widths only, a site header's inner `.row` (brand beside nav) and its nav list wrap and shrink. True zero specificity; no `display` change; desktop, game HUDs, and card/article headers unchanged. | `@media (max-width: 640px) { :where(.nb-header .row), :where(.nb-header nav ul) { flex-wrap: wrap; min-width: 0; max-width: 100%; } }` in `DESIGN_KIT_CSS` | `tests/theMarketingNavFitsAPhone.test.ts` (real Header.tsx tree: old CSS and header/nav-only wrap still overflow 260 px; new CSS is 0 at 390 px and unchanged at 1024 px; game HUD, card header, desktop, stacked mobile-menu links, dark `.nb-header`; previous kit class rules unchanged; older starter still recognised) |

## Side-effect review (owner rule t311u)

| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 phone-only wrap/shrink on `:where(.nb-header .row)` and `:where(.nb-header nav ul)` | The real Header.tsx tree (inner `.container.row` + `ul.row`) is what overflows; wrapping `<header>`/`<nav>` does not. Specificity is truly zero (everything inside `:where()`). `display` is unchanged, so stacked `a { display: block }` mobile-menu links still win and `.row` whitespace/`gap` is kept. The rule lives only inside `@media (max-width: 640px)` (the kit's existing phone split, matching `.nb-grid`). `.nb-game-hud` and a card/article `<header>` (or `.row` inside one) do not match. `.nb-header` colours still come from `var(--card)` / `KIT_DARK_SWITCH`. BR1959 / BR1972 class rules are unchanged. overflow is left visible (BR1972). Existing copied kits are not rewritten; seed history is add-only. | A `.row` inside `.nb-header` that should stay nowrap on a phone will wrap (logo+name stacking is acceptable). Viewports 641–649 px with this 650 px row can still overflow a few pixels (this report is 390 px). 24 px nav links are not raised to 32 px: `min-height` does nothing on inline `a`, and changing `display` was rejected. | Ship the wrap. Do not ship a display change for tap targets. Mutations: drop `flex-wrap` (390 px overflow returns); broaden `.nb-header` to `header` (game HUD / card header neighbours fail); apply the wrap outside the media query (desktop fails). |
| Retry a syntax-refused fast-lane file so Footer is created without falling back | SIMPLE_BUILD_FALLBACK already handed 11 salvaged files to the full builder; Footer was delivered in the final manifest. The reject path did its job (broken `<<` was not saved). | A blind retry loop, or a stub Footer that shadows a later good write. | Do not ship. The refuse + fallback recovered the file. |
| Teach the vocabulary to prefer `.nb-header` + `.nb-header-actions` for company sites | Prompt-only; models can ignore it. The `:where(header)` layer does not depend on class names. | The shop `.nb-header` recipe also mentions search chips; a company site might grow a false search box. | Do not ship. |
| Raise or lower the free cap; change the yellow release gate; run the unanswered bug-hunt | Gate went yellow *because* of the phone overflow F1 addresses. The 30 s wait was BUG_HUNT_NOT_RUN, not a requirements question. | Billing / changing a measured verdict. | Do not ship. |
| Q-2649..Q-2652 and earlier carried rows | None of them appear in this report (no store-open language; not a path-only game prompt; not an unexplained asked-user empty build; not a project-mode game module). | Out of scope. | Carry unchanged. Do not implement. |

## Queue

This commit closes no earlier row and opens no new row. Q-2649, Q-2650, Q-2651, Q-2652, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. Q-2238 stays open as the parent of Q-2651.
