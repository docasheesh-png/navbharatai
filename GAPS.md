# NavBharatAI v2.0 vs Claude Code — Gap Tracker

> **Purpose:** Every gap between NavBharatAI v2.0 and Claude Code standard.
> Each item has a status: `[ ]` = open, `[x]` = fixed, `[~]` = partial/infra-blocked.
> Fix one group at a time. Never delete a row — only update status + add PR link.
>
> Last audited: 2026-06-22

---

## How to read this

| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not fixed yet |
| `[x]` | Fixed (PR link in column) |
| `[~]` | Blocked (needs infra / E2B / LSP) |
| `[s]` | Skipped — by design |

---

## GROUP A — Editor Quality (Monaco) — 30 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| A1 | Placeholder "Ask navBharatAI" — lowercase n (not a brand name) | `[x]` | #165 |
| A2 | No word wrap toggle button in editor toolbar | `[x]` | #166 |
| A3 | No minimap toggle in editor toolbar | `[x]` | #166 |
| A4 | No font size control in editor | `[x]` | #166 |
| A5 | No tab size / indentation selector | `[x]` | #166 |
| A6 | No "Format Document" button in toolbar | `[x]` | #166 |
| A7 | Bracket pair colorization not enabled (Monaco supports it natively) | `[x]` | #166 |
| A8 | Sticky scroll not enabled (function signature context line) | `[x]` | #166 |
| A9 | Code folding buttons (Fold All / Unfold All) missing from toolbar | `[x]` | #166 |
| A10 | Unsaved-changes dot not shown on file tab when content differs from saved | `[ ]` | |
| A11 | File extension icons missing from editor tabs (all show same icon) | `[ ]` | |
| A12 | No "Format on Save" toggle in settings | `[ ]` | |
| A13 | No "Trim trailing whitespace" setting | `[ ]` | |
| A14 | No "Insert final newline" setting | `[ ]` | |
| A15 | Ctrl+G (Go to Line) not wired as keyboard shortcut | `[ ]` | |
| A16 | Ctrl+F (Find) not visually highlighted as shortcut hint | `[ ]` | |
| A17 | Editor theme is always dark — no light theme option | `[ ]` | |
| A18 | No "Select all occurrences" keyboard shortcut hint | `[ ]` | |
| A19 | Monaco language not auto-detected for .mjs / .cjs / .mts / .cts | `[x]` | #166 |
| A20 | Read-only file indicator missing (no lock icon on non-editable files) | `[ ]` | |
| A21 | No snippet library / custom snippets | `[ ]` | |
| A22 | No "Compare File" (diff against saved) option in file tree | `[ ]` | |
| A23 | No "Open in Split" option for files | `[ ]` | |
| A24 | Cursor position (line:col) not shown in status bar | `[x]` | #166 |
| A25 | No "Jump to Definition" (even heuristic navigation to file) | `[~]` | needs LSP |
| A26 | No "Find All References" refactor command | `[~]` | needs LSP |
| A27 | No "Rename Symbol" command | `[~]` | needs LSP |
| A28 | No "Extract Function/Component" refactor | `[~]` | needs LSP |
| A29 | No inline error markers from TypeScript / ESLint | `[~]` | needs LSP |
| A30 | No autocomplete for project-internal symbols | `[~]` | needs LSP |

---

## GROUP B — Chat & AI Interaction Quality — 30 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| B1 | No message timestamps visible in chat | `[x]` | #165 |
| B2 | No "Copy message" button on AI messages | `[x]` | #165 |
| B3 | No "Regenerate response" button on last AI message | `[x]` | #165 |
| B4 | No character count / token estimate shown as input grows | `[x]` | #165 |
| B5 | No "Clear conversation" button | `[x]` | #165 |
| B6 | Starter suggestions not visible when chat is empty | `[ ]` | |
| B7 | No model name badge showing which AI answered | `[x]` | #166 |
| B8 | No typing indicator (three-dots animation) during generation | `[x]` | #166 |
| B9 | No "Edit prompt" option on user messages | `[x]` | #167 |
| B10 | Code blocks in chat have no file name header | `[ ]` | |
| B11 | Code blocks in chat have no line numbers | `[ ]` | |
| B12 | Code blocks in chat not syntax-highlighted in all languages | `[ ]` | |
| B13 | Long AI messages have no "Collapse" toggle | `[x]` | existing |
| B14 | No keyboard shortcut to focus input (Ctrl+K or /) | `[x]` | #166 |
| B15 | Chat history scroll position lost when switching tabs | `[ ]` | |
| B16 | No "Export chat" to markdown/PDF | `[ ]` | |
| B17 | No search within chat history | `[ ]` | |
| B18 | No @-mention to reference a file in the prompt | `[ ]` | |
| B19 | Markdown rendering missing: tables look unstyled | `[ ]` | |
| B20 | Markdown rendering missing: task lists (- [ ]) not rendered | `[ ]` | |
| B21 | No LaTeX / math rendering support | `[ ]` | |
| B22 | No inline image rendering for AI-returned image URLs | `[ ]` | |
| B23 | No "thumbs up / thumbs down" feedback per message | `[ ]` | |
| B24 | Chat session name is always "Untitled" — no auto-naming | `[ ]` | |
| B25 | Session list shows raw UCI code, not human readable title | `[ ]` | |
| B26 | No "pin to top" for important messages | `[ ]` | |
| B27 | Paste image into chat not supported (clipboard paste) | `[ ]` | |
| B28 | Voice input icon has no accessibility label | `[x]` | #166 |
| B29 | No multiline paste indicator (large pastes not warned) | `[ ]` | |
| B30 | No "Send on Enter / Shift+Enter" preference toggle | `[x]` | #166 |

---

## GROUP C — File Management — 25 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| C1 | No rename file option in Files panel | `[x]` | #165 |
| C2 | No delete file option in Files panel | `[x]` | #165 |
| C3 | No "New File" button in Files panel | `[x]` | #165 |
| C4 | No "New Folder" button in Files panel | `[s]` | VFS flat namespace |
| C5 | File list not sortable (by name, type, size, modified) | `[ ]` | |
| C6 | No search / filter input in Files panel | `[x]` | #165 |
| C7 | No file size shown in file list | `[x]` | #166 |
| C8 | No "Copy file path" button | `[x]` | #166 |
| C9 | No multi-file selection for bulk delete/download | `[ ]` | |
| C10 | No image preview for .png/.jpg/.svg files | `[ ]` | |
| C11 | No binary file warning (tries to show binary as text) | `[ ]` | |
| C12 | Nested folder structure collapsed by default with no expand-all | `[ ]` | |
| C13 | No recently-opened files section | `[ ]` | |
| C14 | No file pinning (mark important files) | `[ ]` | |
| C15 | ZIP download does not include .env.example | `[ ]` | |
| C16 | ZIP download includes __pycache__, node_modules stubs if present | `[ ]` | |
| C17 | No duplicate file option | `[x]` | #166 |
| C18 | File name with spaces causes preview issues | `[ ]` | |
| C19 | No drag-and-drop to reorder files | `[s]` | VFS has no order |
| C20 | No "Move file" option (cut/paste across folders) | `[ ]` | |
| C21 | File open does not scroll editor to top | `[ ]` | |
| C22 | Files panel does not show which files have unsaved changes | `[ ]` | |
| C23 | No "Reveal in file tree" from open editor tab | `[ ]` | |
| C24 | File tree does not auto-expand to show active file | `[ ]` | |
| C25 | Uploaded files via upload button not announced as added | `[ ]` | |

---

## GROUP D — Build & Generation Quality — 30 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| D1 | Build progress percent bar does not animate smoothly | `[ ]` | |
| D2 | No "What changed?" diff view after an edit build | `[ ]` | |
| D3 | Success notification disappears before user reads | `[ ]` | |
| D4 | Failure messages mix Hindi/English inconsistently | `[ ]` | |
| D5 | No total lines-of-code counter in success state | `[ ]` | |
| D6 | No file count breakdown by language in success | `[ ]` | |
| D7 | No estimated build time shown before starting | `[ ]` | |
| D8 | Build cancellation has no confirm dialog | `[ ]` | |
| D9 | Repair attempt failure shows generic "Please try again" | `[ ]` | |
| D10 | Code review panel UI collapses too easily (accordion UX) | `[ ]` | |
| D11 | Security findings in code review not linked to file/line | `[ ]` | |
| D12 | No "Dismiss finding" option in code review panel | `[ ]` | |
| D13 | No overall quality grade badge visible in header after build | `[ ]` | |
| D14 | Code review does not include accessibility (a11y) checks | `[ ]` | |
| D15 | Generated comments sometimes in Hindi (violates CLAUDE.md) | `[ ]` | |
| D16 | No "Export build report" (files + review + tests) as PDF/MD | `[ ]` | |
| D17 | Build steps list does not show actual file being generated | `[ ]` | |
| D18 | No "Continue partial build" option on timeout | `[ ]` | |
| D19 | Provider used for build not shown in completion badge | `[ ]` | |
| D20 | Build steps collapse after build — no way to re-expand | `[ ]` | |
| D21 | Generated app name defaults to "App" — no smart naming | `[ ]` | |
| D22 | No copy-to-clipboard button on generated code blocks | `[ ]` | |
| D23 | No build history count shown in UI (e.g. "Build #7") | `[ ]` | |
| D24 | No diff between current build and last build (file-level diff) | `[ ]` | |
| D25 | Build stops on first error without reporting all errors | `[ ]` | |
| D26 | No option to re-run code review separately (post-build) | `[ ]` | |
| D27 | AI model fallback not shown to user ("using Grok instead of Claude") | `[ ]` | |
| D28 | Guider plan card does not allow editing the plan text | `[ ]` | |
| D29 | No "Save this build as template" option | `[ ]` | |
| D30 | No size warning for very large generated apps (>100 files) | `[ ]` | |

---

## GROUP E — Mobile UX — 25 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| E1 | Bottom nav labels cut off on very small screens (<360px) | `[ ]` | |
| E2 | Touch targets below 44px in several places | `[ ]` | |
| E3 | No haptic feedback on key actions (vibration API) | `[ ]` | |
| E4 | Code blocks in chat overflow horizontally (no scroll) | `[ ]` | |
| E5 | Long filenames in Files panel overflow without ellipsis | `[ ]` | |
| E6 | Pinch-to-zoom on preview iframe (should allow) | `[ ]` | |
| E7 | No landscape orientation optimization | `[ ]` | |
| E8 | Sidebar animation not smooth on low-end devices | `[ ]` | |
| E9 | No dark/light toggle in mobile header | `[ ]` | |
| E10 | Virtual keyboard causes layout jumps on some Android | `[ ]` | |
| E11 | iOS bottom safe area not always respected in chat input | `[ ]` | |
| E12 | Scrolling inside a modal on iOS causes page scroll (body lock) | `[ ]` | |
| E13 | No PWA install prompt shown to eligible users | `[ ]` | |
| E14 | Back gesture (iOS swipe-from-left) conflicts with sidebar | `[ ]` | |
| E15 | Deploy modal not scrollable on small screens | `[ ]` | |
| E16 | Settings panel overflow on screens <375px | `[ ]` | |
| E17 | No mobile-specific keyboard shortcut hints | `[ ]` | |
| E18 | File upload on mobile requires tapping hidden input | `[ ]` | |
| E19 | Preview "tap to expand" animation missing | `[ ]` | |
| E20 | Code Studio editor unusably small on mobile (<600px) | `[ ]` | |
| E21 | No font size adjustment for readability on mobile | `[ ]` | |
| E22 | Network status toast covers bottom nav on mobile | `[ ]` | |
| E23 | Session switcher not reachable from mobile without sidebar | `[ ]` | |
| E24 | Long press on message shows no context menu | `[ ]` | |
| E25 | No "Request desktop site" shortcut | `[s]` | OS feature |

---

## GROUP F — Error Handling & Feedback — 20 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| F1 | Error toasts disappear too quickly (3s on errors) | `[ ]` | |
| F2 | Network errors and AI errors look identical in the UI | `[ ]` | |
| F3 | No offline banner in the app header | `[x]` | #166 |
| F4 | Session restore failures are silent | `[ ]` | |
| F5 | Preview runtime errors don't highlight the failing file in Files panel | `[ ]` | |
| F6 | No error log / history panel (only see last error) | `[ ]` | |
| F7 | API key missing gives cryptic "401 Unauthorized" to user | `[ ]` | |
| F8 | Payment failures show raw Cashfree error codes | `[ ]` | |
| F9 | Build timed out error has no "try again" button in the UI | `[ ]` | |
| F10 | Large file upload failure gives no size feedback | `[ ]` | |
| F11 | Session sync failure is not communicated to user | `[ ]` | |
| F12 | Rate-limit error (429) shows "Please try again" — no countdown | `[ ]` | |
| F13 | Preview errors show URL instead of readable component name | `[ ]` | |
| F14 | Build error: "Cannot find module X" doesn't suggest installing it | `[ ]` | |
| F15 | Git push failure message is raw git error string | `[ ]` | |
| F16 | No "Help" link on common error messages | `[ ]` | |
| F17 | Admin errors leak internal field names (partially fixed, verify) | `[ ]` | |
| F18 | Empty state for "no sessions" not helpful (no CTA) | `[ ]` | |
| F19 | Wallet insufficient funds doesn't show required vs. available | `[ ]` | |
| F20 | Build log not exportable (can't copy full error log) | `[ ]` | |

---

## GROUP G — Settings & Personalization — 20 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| G1 | No dark/light theme toggle in main header (quick access) | `[ ]` | |
| G2 | User profile photo not shown anywhere in the UI | `[ ]` | |
| G3 | No app version number shown in settings | `[ ]` | |
| G4 | No "Reset all settings" button | `[ ]` | |
| G5 | No keyboard shortcuts reference panel | `[ ]` | |
| G6 | No "What's new" / changelog panel | `[ ]` | |
| G7 | No onboarding tour for first-time users | `[ ]` | |
| G8 | Language preference not persisted across devices | `[ ]` | |
| G9 | No notification preferences panel | `[ ]` | |
| G10 | Editor preferences (font size, wrap, theme) not synced to Firestore | `[ ]` | |
| G11 | No "Export all my data" option (GDPR) | `[ ]` | |
| G12 | No "Delete my account" option | `[ ]` | |
| G13 | No API key health check (validate key before saving) | `[ ]` | |
| G14 | API key fields don't show masked last 4 chars after save | `[ ]` | |
| G15 | No "Copy session ID" for support purposes | `[ ]` | |
| G16 | No referral code generator | `[ ]` | |
| G17 | Wallet top-up amounts are fixed — no custom amount | `[ ]` | |
| G18 | No usage breakdown (tokens by feature: chat, build, engineer) | `[ ]` | |
| G19 | No session count shown in settings | `[ ]` | |
| G20 | No "Preferred AI model" selector for Pro builds | `[ ]` | |

---

## GROUP H — Preview Quality — 20 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| H1 | Preview shows blank white flash before app loads | `[ ]` | |
| H2 | No reload button visible in WorkspacePane preview header | `[x]` | #165 |
| H3 | No zoom in/out controls for preview | `[x]` | #166 |
| H4 | No device frame simulation (iPhone/Android frame toggle) | `[ ]` | |
| H5 | Preview URL not shown / copyable | `[ ]` | |
| H6 | Preview does not persist after page reload | `[ ]` | |
| H7 | No "Open in new tab" button for preview | `[x]` | #165 |
| H8 | Preview doesn't respect system dark/light preference | `[ ]` | |
| H9 | Console errors from preview not surfaced in chat | `[ ]` | |
| H10 | No preview screenshot download | `[ ]` | |
| H11 | Preview iframe has no title (accessibility) | `[x]` | existing |
| H12 | Preview doesn't show dimensions (width x height) | `[x]` | #166 |
| H13 | Preview refresh animation is abrupt (no fade) | `[ ]` | |
| H14 | No "responsive" breakpoint preview (mobile/tablet/desktop) | `[x]` | #166 |
| H15 | Preview panel header takes too much vertical space on mobile | `[ ]` | |
| H16 | Preview error overlay doesn't show which file caused the error | `[ ]` | |
| H17 | Preview doesn't handle loading fonts (flash of unstyled text) | `[ ]` | |
| H18 | No "Rotate device" button (landscape/portrait simulation) | `[ ]` | |
| H19 | Preview doesn't scroll to top after rebuild | `[ ]` | |
| H20 | "Fix Bug" in preview overlay sends wrong context sometimes | `[ ]` | |

---

## GROUP I — Deployment — 15 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| I1 | Deploy success URL not clickable / no copy button | `[ ]` | |
| I2 | No redeploy button after first deployment | `[ ]` | |
| I3 | No deployment history panel | `[ ]` | |
| I4 | Deploy modal does not show step-by-step progress | `[ ]` | |
| I5 | Deploy error messages show raw API errors | `[ ]` | |
| I6 | No .env variable injection for deployed app | `[ ]` | |
| I7 | Custom domain explanation is text-only, no visual | `[ ]` | |
| I8 | No Railway / Render / Fly.io platform support | `[ ]` | |
| I9 | Deploy does not generate a GitHub Actions workflow | `[ ]` | |
| I10 | No post-deploy health check (is the site actually up?) | `[ ]` | |
| I11 | No deploy preview for PRs (branch preview URLs) | `[ ]` | |
| I12 | Deployed app not listed anywhere after closing modal | `[ ]` | |
| I13 | No SSR/full-stack deploy support (only static) | `[~]` | needs infra |
| I14 | No Docker image build and push to registry | `[~]` | needs infra |
| I15 | No Kubernetes / Helm deploy | `[~]` | needs infra |

---

## GROUP J — Git Panel — 20 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| J1 | No AI-suggested commit messages | `[ ]` | |
| J2 | No git log / commit history view | `[ ]` | |
| J3 | Staged vs unstaged files not visually distinct | `[ ]` | |
| J4 | No create-branch button in Git panel | `[ ]` | |
| J5 | No "Ahead / behind remote" indicator | `[ ]` | |
| J6 | Empty commit message gives no error before submit | `[x]` | #167 |
| J7 | No .gitignore file editor | `[ ]` | |
| J8 | No stash push/pop | `[ ]` | |
| J9 | No cherry-pick | `[~]` | complex git |
| J10 | No rebase interactive | `[~]` | complex git |
| J11 | Branch switcher does not show remote branches | `[ ]` | |
| J12 | No merge conflict resolution UI | `[~]` | complex git |
| J13 | No tag creation | `[ ]` | |
| J14 | No git blame view | `[ ]` | |
| J15 | Commit message has no character limit warning (50/72 chars) | `[x]` | #167 |
| J16 | No "Sync with remote" (pull + push in one click) | `[ ]` | |
| J17 | PR creation link not shown after push | `[ ]` | |
| J18 | No GitHub PR list view in Git panel | `[ ]` | |
| J19 | No "Open file in GitHub" link | `[ ]` | |
| J20 | No SSH key setup guide | `[ ]` | |

---

## GROUP K — Performance — 15 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| K1 | First contentful paint >3s (app boot) | `[ ]` | |
| K2 | App.tsx is 5,661 lines — single bundle bottleneck | `[ ]` | |
| K3 | Chat messages list renders all messages (no virtualization) | `[ ]` | |
| K4 | Preview rebuild triggered without debounce | `[ ]` | |
| K5 | Monaco editor instantiates even when not visible | `[ ]` | |
| K6 | File tree re-renders on every file change | `[ ]` | |
| K7 | Large file (>500 lines) Monaco render is noticeably slow | `[ ]` | |
| K8 | ZIP download blocks main thread (no worker) | `[ ]` | |
| K9 | No request deduplication for repeated API calls | `[ ]` | |
| K10 | Images loaded without lazy loading (layout shifts) | `[ ]` | |
| K11 | CSS animations not GPU-composited on mobile | `[ ]` | |
| K12 | Firestore listeners not cleaned up on component unmount | `[ ]` | |
| K13 | No service worker for offline caching | `[ ]` | |
| K14 | No code splitting for large settings panels | `[ ]` | |
| K15 | API calls not cached (same endpoint called multiple times) | `[ ]` | |

---

## GROUP L — Accessibility (a11y) — 20 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| L1 | Icon-only buttons missing aria-label (Upload, Download, etc.) | `[ ]` | |
| L2 | Modal dialogs do not trap focus | `[ ]` | |
| L3 | No skip-to-main-content link | `[ ]` | |
| L4 | Color contrast <4.5:1 in several dark-mode text areas | `[ ]` | |
| L5 | Toasts not announced via aria-live region | `[ ]` | |
| L6 | Tab order broken in sidebar navigation | `[ ]` | |
| L7 | No keyboard shortcut to close modals (Escape should work everywhere) | `[ ]` | |
| L8 | No high-contrast mode | `[ ]` | |
| L9 | Animated elements not paused with prefers-reduced-motion | `[ ]` | |
| L10 | Input placeholder text contrast insufficient | `[ ]` | |
| L11 | File upload button not keyboard accessible | `[ ]` | |
| L12 | Code editor not announced to screen readers | `[~]` | Monaco limit |
| L13 | No alt text generation for uploaded images | `[ ]` | |
| L14 | Form labels not associated with inputs via htmlFor | `[ ]` | |
| L15 | Dropdowns (theme, mode selectors) have no keyboard navigation | `[ ]` | |
| L16 | "Loading..." states have no aria-busy | `[ ]` | |
| L17 | Error messages not associated with their input fields | `[ ]` | |
| L18 | No focus-visible outline on interactive elements | `[ ]` | |
| L19 | Session list has no accessible name | `[ ]` | |
| L20 | Progress bars have no aria-valuenow/valuemin/valuemax | `[ ]` | |

---

## GROUP M — Security — 15 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| M1 | No Content Security Policy (CSP) header defined | `[ ]` | |
| M2 | No Subresource Integrity (SRI) for CDN-loaded scripts | `[ ]` | |
| M3 | CORS policy allows dev origin in non-production (verify) | `[ ]` | |
| M4 | Generated code secrets (API keys) not flagged/blocked | `[ ]` | |
| M5 | No secrets scan in code review (regex for keys/tokens) | `[ ]` | |
| M6 | Rate limiting per-user not enforced (only per-IP) | `[ ]` | |
| M7 | No CSRF tokens on state-changing POST requests | `[ ]` | |
| M8 | Admin panel has no audit log for actions taken | `[ ]` | |
| M9 | File upload MIME type not validated server-side | `[ ]` | |
| M10 | Zip upload not scanned for malicious files | `[ ]` | |
| M11 | No maximum request body size for file upload endpoints | `[ ]` | |
| M12 | XSS possible via markdown rendering (verify sanitization) | `[ ]` | |
| M13 | iframe preview runs with same origin as app (sandbox attr) | `[ ]` | |
| M14 | No logout-on-inactivity timeout | `[ ]` | |
| M15 | API keys stored in localStorage unencrypted | `[ ]` | |

---

## GROUP N — Feature Completeness (vs Claude Code) — 30 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| N1 | No "Explain this code" right-click action in editor | `[x]` | #167 |
| N2 | No "Improve this code" inline suggestion | `[x]` | #167 |
| N3 | No inline comment/explain on selected text | `[x]` | #167 |
| N4 | No "Write tests for this function" button | `[x]` | #167 |
| N5 | No "Add JSDoc / docstring" generator | `[x]` | #167 |
| N6 | No "Convert to TypeScript" action | `[ ]` | |
| N7 | No "Simplify this function" action | `[ ]` | |
| N8 | No "Find bugs in this file" action | `[x]` | #167 |
| N9 | No "Security scan this file" button | `[x]` | #167 |
| N10 | No "Generate README" from project structure | `[ ]` | |
| N11 | No "Generate .env.example" from code | `[ ]` | |
| N12 | No "Generate API documentation" | `[ ]` | |
| N13 | No "Generate data model diagram" | `[ ]` | |
| N14 | No "Convert to dark mode" one-click action | `[ ]` | |
| N15 | No "Add i18n / translations" action | `[ ]` | |
| N16 | No "Make accessible" auto-fix action | `[ ]` | |
| N17 | No "Optimize for mobile" auto-fix | `[ ]` | |
| N18 | No "Add loading states" to async operations | `[ ]` | |
| N19 | No "Add error boundaries" action | `[ ]` | |
| N20 | No "Add authentication guard" to routes | `[ ]` | |
| N21 | No "Migrate to latest React 19 patterns" | `[ ]` | |
| N22 | No "Replace useState with Zustand" action | `[ ]` | |
| N23 | No "Add Tailwind to existing app" migration | `[ ]` | |
| N24 | No "Convert class component to functional" | `[ ]` | |
| N25 | No "Generate mock data" for components | `[ ]` | |
| N26 | No "Write Storybook stories" action | `[ ]` | |
| N27 | No "Generate Cypress E2E tests" | `[~]` | needs E2B |
| N28 | No "Add Lighthouse CI" to project | `[ ]` | |
| N29 | No "Bundle size analysis" report | `[ ]` | |
| N30 | No "Dependency audit" (npm outdated / security) | `[ ]` | |

---

## GROUP O — Collaboration & Sharing — 10 gaps

| # | Gap | Status | PR |
|---|-----|--------|----|
| O1 | No shareable read-only preview link | `[ ]` | |
| O2 | No "Share project" with another user | `[ ]` | |
| O3 | No real-time co-editing | `[~]` | needs CRDT |
| O4 | No comments on specific lines of code | `[ ]` | |
| O5 | No project export as importable NavBharatAI template | `[ ]` | |
| O6 | No "Fork this project" from another user's shared app | `[ ]` | |
| O7 | No team workspace | `[~]` | needs backend |
| O8 | Session UCI code hard to share (no QR code) | `[ ]` | |
| O9 | No embed code generator for deployed apps | `[ ]` | |
| O10 | No social sharing of built apps (Twitter card) | `[ ]` | |

---

## Summary

| Group | Total | Open | Fixed | Blocked |
|-------|-------|------|-------|---------|
| A — Editor Quality | 30 | 26 | 0 | 4 |
| B — Chat Quality | 30 | 30 | 0 | 0 |
| C — File Management | 25 | 24 | 0 | 1 |
| D — Build Quality | 30 | 30 | 0 | 0 |
| E — Mobile UX | 25 | 24 | 0 | 1 |
| F — Error Handling | 20 | 20 | 0 | 0 |
| G — Settings | 20 | 20 | 0 | 0 |
| H — Preview Quality | 20 | 20 | 0 | 0 |
| I — Deployment | 15 | 12 | 0 | 3 |
| J — Git Panel | 20 | 16 | 0 | 4 |
| K — Performance | 15 | 15 | 0 | 0 |
| L — Accessibility | 20 | 19 | 0 | 1 |
| M — Security | 15 | 15 | 0 | 0 |
| N — Feature Completeness | 30 | 29 | 0 | 1 |
| O — Collaboration | 10 | 7 | 0 | 3 |
| **TOTAL** | **325** | **307** | **0** | **18** |

---

*Each fix goes on its own commit. Once a full group is done, mark the group header ✅ in this table.*
