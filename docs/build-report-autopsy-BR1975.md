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

The design kit already wraps `.nb-header`, `.nb-header-actions` (BR1959) and `.nb-topbar` (BR1972). This build used a bare `<header>` with a long company name beside a `<nav>` of section links, so those class rules never applied. A flex row's default `nowrap` plus a flex item's `min-width: auto` (content size) put the 296 px nav at x=354 and its right edge at 650 px on a 390 px phone. The same header's nav links were 24 px tall (below the 32 px tap-target floor).

This is the same overflow class as BR1959 / BR1972, on markup that does not use the kit class names. The kit's existing zero-specificity element layer (`:where(button)`, …) is the matching tool: style the bare `<header>` / `<nav>` without beating a rule the app writes.

## Prevention classes in this PR

| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | A company-site `<header>` that sits a long brand name beside a `<nav>` of section links must wrap on a phone, and those links must meet the 32 px tap-target floor. Kit classes `.nb-header` / `.nb-topbar` stay as origin/main left them. | `:where(header)`, `:where(header) nav`, `:where(header) nav a` in `DESIGN_KIT_CSS` | `tests/theMarketingNavFitsAPhone.test.ts` (declarations, 390×844 geometry of this report vs origin/main, hero `display` left unset, overflow visible, previous kit class rules unchanged, older starter still recognised) |

## Side-effect review (owner rule t311u)

| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 zero-specificity wrap/shrink on `header` and wrap + 32 px min-height on `header nav a` | BR1959 `.nb-header-actions` and BR1972 `.nb-topbar` / `.nb-topbar h1` declarations are unchanged. A block hero `<header>` is not given `display: flex` (`flex-wrap` is ignored on a non-flex box). overflow is left visible so dropdowns are not clipped (the first BR1972 head's `overflow-x: auto` lesson). overflow-wrap is not set on the container (the second BR1972 head's `anywhere` lesson). A later `header { flex-wrap: nowrap }` still wins (`:where` is specificity zero). `header nav ul` is not styled, so a dropdown list inside the nav stays a stacked list. Existing apps that already copied a previous rule are not rewritten; `kitRestore` keeps a dropped *current* rule; `platformSeedHistory` records the new kit hash add-only. | A header that deliberately wants a single nowrap row can set `flex-wrap: nowrap` and keep it. A `<nav>` wider than the phone whose only child is a nowrap `<ul>` of many links can still overflow (not this report: the nav was 296 px and fitted once it wrapped below the brand). | Ship. Opposite-class locked before the edit. Mutations: dropping `flex-wrap` from `:where(header)` turns red; giving `:where(header)` `display: flex` turns red. |
| Retry a syntax-refused fast-lane file so Footer is created without falling back | SIMPLE_BUILD_FALLBACK already handed 11 salvaged files to the full builder; Footer was delivered in the final manifest. The reject path did its job (broken `<<` was not saved). | A blind retry loop, or a stub Footer that shadows a later good write. | Do not ship. The refuse + fallback recovered the file. |
| Teach the vocabulary to prefer `.nb-header` + `.nb-header-actions` for company sites | Prompt-only; models can ignore it. The `:where(header)` layer does not depend on class names. | The shop `.nb-header` recipe also mentions search chips; a company site might grow a false search box. | Do not ship. |
| Raise or lower the free cap; change the yellow release gate; run the unanswered bug-hunt | Gate went yellow *because* of the phone overflow F1 addresses. The 30 s wait was BUG_HUNT_NOT_RUN, not a requirements question. | Billing / changing a measured verdict. | Do not ship. |
| Q-2649..Q-2652 and earlier carried rows | None of them appear in this report (no store-open language; not a path-only game prompt; not an unexplained asked-user empty build; not a project-mode game module). | Out of scope. | Carry unchanged. Do not implement. |

## Queue

This commit closes no earlier row and opens no new row. Q-2649, Q-2650, Q-2651, Q-2652, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. Q-2238 stays open as the parent of Q-2651.
