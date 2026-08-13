# In-browser preview — the hardening plan

**Admin ask (2026-08-13):** *"in browser preview ko harden banane ka plan karo! sath me un logo ka
bhi dhyan rakhna jo, apni already bani hui app (github/zip) navbharatai par layenge!"*

This document is the plan. It is written after reading the actual runtime
(`src/server/runtime/*`, `src/server/routes/esmMirror.ts`, `src/components/agentv3/PreviewSurface.tsx`,
`src/lib/folderImport.ts`, `src/server/AgentV3/BackendPresence.ts`) rather than from memory, because the
last two times this project acted on a remembered number instead of a read one it was wrong both times.

---

## 0. A correction, before the plan

My first framing of this work was **"the in-browser preview will kill most of the E2B bill."** I checked
the arithmetic against the measured numbers already recorded in `CLAUDE.md`, and **that framing is wrong.
It is recorded here rather than quietly dropped, because it is the exact mistake this plan must not repeat.**

The measured E2B window (Jul 14 – Aug 13 2026): **1,260 sandboxes · 2,078 vCPU-hours · $172.08**, i.e.
**1.65 hours of billed life per sandbox**. The tempting inference is "a build takes 5 minutes, so 95% of
that is idle waste the in-browser preview can absorb."

It does not hold:

- `AGENTV3_SANDBOX_IDLE_MINUTES` is already **15**. At 1,260 sandboxes that is **315 billed hours ≈ $26/month**
  of idle in total. Even pausing *instantly* — a physically impossible best case — cannot save more than that.
- `CLAUDE.md` states the remaining idle lever explicitly: 15 → 5 minutes saves **~$17/month (~₹1,500)**.
  **The idle lever is nearly exhausted.** It was the big win once (45 → 15 saved ~₹4,500/month); it is not
  the big win still available.
- Which means the other ~1,760 hours are **real build activity** — install, build, tests, the repair loop.
  A frontend preview in a browser cannot absorb any of that.

**So: hardening the in-browser preview is NOT primarily a cost project, and it must not be sold as one.**

There *is* real money in it, but in two specific places (imports and reopens, §3 and §4), and the honest
size of it is unknown until Phase 0 measures it.

### The real reasons to do this, in honest order

1. **Speed the user feels.** The in-browser preview is already the DEFAULT tab (`PreviewSurface.tsx:755`)
   and renders in ~2 seconds from a cached compile. The Live-server path costs a sandbox boot plus
   `npm install` plus a dev-server start. Trust is the product, and the user judges by what they see.
2. **Reliability.** A preview with no sandbox behind it cannot be broken by an E2B outage, a cold start, a
   Cloud Run instance recycle orphaning the VM, or a region hiccup. Today those all become "preview toota hai".
3. **Imported apps** — the admin's second ask, and the one place with *unambiguous* waste: an import that
   only needs to be LOOKED AT currently boots a full sandbox and installs node_modules.
4. **Cost.** Real but modest, and unmeasured. Phase 0 measures it. It is fourth on this list on purpose.

---

## 1. What the in-browser preview already does (so no one rebuilds it)

Far more than "render some HTML". Reading the code, today it already handles:

| Capability | Where |
|---|---|
| React + JSX/TSX compiled in the browser (Babel-standalone), or **server-precompiled** | `ReactPreview.ts`, `PreviewPrecompile.ts` |
| Vue, and plain static sites | `VuePreview.ts`, `StaticPreview.ts` |
| npm dependencies through a **same-origin esm.sh mirror** with an LRU + `immutable` browser cache | `routes/esmMirror.ts` |
| Dependency **warmup** so a preview's modules are hot before it opens | `PreviewDepWarmup.ts` |
| A **single shared React** (`?external=react,react-dom`) — the fix for "Invalid hook call" | `ReactPreview.ts:1266` |
| Tailwind Play CDN + a **shadcn token shim** so `bg-background` / `@apply` do not throw | `SHADCN_TW_CONFIG` |
| `@/…` **path aliases** read from tsconfig / vite.config, with a heuristic fallback | `buildAliasMap` |
| A **dangling-import stub** so one missing file does not blank the whole app | `ReactPreview.ts:692` |
| Local **image imports** → placeholder instead of a dead CDN fetch | `IMG_RE` branch |
| A **navigation guard** so the app cannot load the NavBharatAI platform into its own iframe | `previewNavGuard.ts` |
| **Visual-editor source stamping** (`data-nbai-src`) for click-to-edit | `nbaiSrcPlugin` |
| An **honest backend banner** when the app has an API the preview cannot run | `BackendPresence.ts` |

**This is a strong foundation, not a toy.** The plan below extends it; it does not restart it.

---

## 2. The four real gaps

Everything that sends an app to the sandbox instead falls into exactly four buckets.

### Gap A — there is no backend (the big one)
Any `fetch('/api/...')` in the previewed app fails. `detectBackendPresence` correctly *detects* this and shows
an honest banner, but detection is not capability. This is the single reason the dukaan-stock app —
login / list / search / photo / total, all ordinary features — needed a whole VM.

### Gap B — there is no database
Postgres / Prisma / mysql / sqlite route straight to `server-container` (`RuntimeRouter.ts:98`).

### Gap C — two compilers are missing
`.svelte` and `.astro` return an honest `{ok:false}` (`PreviewService.ts:24`). Honest, but a dead end.

### Gap D — imported projects have shapes the generator never produces
Monorepos and pnpm workspaces, CRA and Next, `.env` files, `import.meta.env`, Vite's `?raw` / `?url` /
`import.meta.glob` suffixes, aliases beyond `@`, web workers, WASM. The generator emits one predictable
shape; the world does not.

### An existing debt this plan must also fix
`ReactPreview.ts:671` stubs every `node:` builtin to a proxy that **returns `''` for everything**. That was a
reasonable narrow guard against a stray `import path from 'node:path'` in a config file. If Gap A is built on
top of it, it becomes exactly the "built but not really working" state the second absolute rule forbids: a
`node:crypto` call would silently return `''` and the app would produce wrong data while looking fine.
**Phase 2 replaces it with a real implementation or an honest refusal — never a silent empty string.**

---

## 3. The plan

### Phase 0 — Measure the handover point (no runtime risk)

**Before building anything**, record per build: when real build work ended, how long the sandbox stayed
alive after that, whether the user touched the preview afterwards, and whether they were on the In-browser
or Live tab. Surface it as an admin card exactly like Server-necessity.

This exists because §0 happened: an unmeasured estimate nearly set the direction of a large change. It also
tells us the honest size of §4's saving instead of guessing it.

**Ships as:** one new deterministic recorder + one admin card. No behaviour change.

---

### Phase 1 — Imported apps preview with NO sandbox (the admin's second ask)

**Today:** import (GitHub / zip / folder) → `shouldBootImportedProject` sees a sandbox → boot → `npm install`
→ dev server. For a plain React app the user only wants to LOOK at, that is a VM and a full install for
nothing.

**Change:** run a **capability prover** (below) over the imported tree first.
- Frontend-only + every dependency supported ⇒ render in-browser **immediately, no sandbox at all**.
- Anything else ⇒ boot the sandbox exactly as today.

This is the cheapest real win in the plan: no new runtime capability is required, the preview already exists,
and it is the case with genuinely zero build to run.

**Needs, to make imports actually land:**
- **Root detection** — monorepo / workspace: find the app, not the repo root.
- **CRA and Next-static** entry conventions (today only Vite-shaped entries are searched confidently).
- **`.env` → `import.meta.env` / `process.env`** injection, so an imported app does not white-screen on
  `import.meta.env.VITE_API_URL` being `undefined`.
- **Vite suffixes**: `?raw`, `?url`, `import.meta.glob`.
- **Honest refusal screen** when the prover says no — naming the exact blocker ("this app needs a Python
  server"), never a blank page and never a fake success.

---

### Phase 2 — A real backend in the browser

The big engineering piece, and the one that turns Gaps A + B from "needs a VM" into "runs here".

**2a — `/api` interception.** ⚠️ **CORRECTED WHILE BUILDING IT (2026-08-13).** This said "a Service
Worker". It cannot be one: the preview is an `<iframe srcDoc>`, which has an **opaque origin**, and
`navigator.serviceWorker.register()` requires a secure same-origin scope — it would throw there every
time. The mechanism is `fetch` patched inside the preview document, which is better here anyway (no
registration lifecycle, no scope rules, no cached worker to invalidate, nothing outliving the iframe).
The plan is corrected rather than the mechanism forced; the record of the wrong version stays, for the
same reason §0's does.

Either way the substance is unchanged: the interceptor dispatches into **the app's real Express route
handlers**. The user's own code executes. This is not a mock server and must never become one.

**2b — A Node-compat layer** for the subset Express apps genuinely use: `http`, `path`, `fs` (over OPFS /
in-memory), `crypto`, `buffer`, `stream`, `events`. Much of the ecosystem above it is already pure JS and
runs in a browser unchanged — `bcryptjs`, `jsonwebtoken`, `zod`, `uuid`, `dayjs`. `multer` becomes an
in-memory upload store. **This layer replaces the `''`-returning stub described in §2.**

**2c — Real Postgres via PGlite** (ElectricSQL — Postgres compiled to WASM, Apache-2.0, so commercially
usable, unlike WebContainer). It is a genuine Postgres: SQL runs, constraints bite, transactions roll
back, and IndexedDB persistence means the data is still there after a reload.

⚠️ **SCOPED DOWN WHILE BUILDING IT (2026-08-13).** This said "`pg`, Prisma and Drizzle point at it".
Only **`pg`** does. Prisma, Drizzle, TypeORM, Sequelize and Knex generate SQL through their own engines
and run migrations through their own CLIs, and half-supporting a migration tool produces a schema that
is subtly not the user's — the exact "built but not really working" state rule 2 forbids. Those apps
keep the sandbox until each one is genuinely implemented and tested.

**The gate that makes this legal under the second absolute rule — the capability prover.**
Before in-browser is *chosen*, statically resolve every backend import against a registry of modules we
genuinely implement. **One unknown import ⇒ the sandbox, no negotiation.** The prover's default answer is
"no". A stub that pretends to work is worse than a VM that does.

---

### Phase 3 — Handover: pause the sandbox once the build is done

For a frontend-only app, once the build settles the sandbox is only holding a preview the browser can serve
itself. Pause it after a short grace (not instantly — a user who edits immediately would feel the resume),
and switch the surface to the in-browser render. `AGENTV3_SANDBOX_RESUME` already exists for the way back.

Deliberately **third, not first**: §0 shows the money here is small. It is worth doing for reliability and
because it makes the reopen path (an old app opened weeks later) cost nothing at all — but it is not the
headline, and Phase 0's measurement decides how far to push it.

---

### Phase 4 — The missing compilers

`svelte/compiler` is pure JS and runs in a browser; Astro is harder. Do this **only after** measuring how
many real imports are actually Svelte or Astro — the same discipline as Phase 0. Guessing here would build a
compiler for zero users.

---

## 4. How much E2B dependency actually goes away — honest ranges

**It does not go to zero, and anyone who says otherwise has not read the build loop.** E2B runs `npm install`,
the real build, the test suite and the repair loop. Without a WebContainer licence (held by design —
`ROADMAP.md:308`) none of that moves to a browser.

| Path | Today | After this plan | Confidence |
|---|---|---|---|
| Imported app, frontend-only | full sandbox + install | **no sandbox at all** | **High** — no build to run |
| Reopening an old app to look at it | sandbox resume | **no sandbox** | **High** |
| Generated build, frontend-only | sandbox for the whole session | sandbox for the build only | Medium — Phase 0 sizes it |
| Generated build with an API/DB | sandbox throughout | sandbox for the build; preview served locally | Medium-low — Phase 2 must land first |
| Python / Go / Java backend, Redis, native binaries, heavy image work | sandbox | **sandbox, forever** | Certain |

**Bill:** I will not put a rupee figure on this until Phase 0 measures it. What §0 already establishes is that
the idle lever is nearly spent, so the honest expectation is *modest* cost movement and *large* speed and
reliability movement. The 88% server-necessity figure is an **upper bound on what could ever skip the
sandbox**, not a forecast of what will — it reads the request's wording, so an unstated requirement counts
as "not needed".

---

## 5. Order of work

**Phase 0 → Phase 1 → Phase 3 → Phase 2 → Phase 4.**

**ACTUAL ORDER TAKEN (2026-08-13):** 0 → 1 → 1b → **2** → 3 → 4. Phase 2 was pulled ahead of Phase 3 at
the admin's direction. It turned out to be the right call for a reason the plan had not anticipated:
Phase 1b found three REAL bugs in the import path (`import.meta` as a SyntaxError, `process` as a
ReferenceError, and a monorepo's dependencies invisible to the importmap), all of which affected
imported apps constantly and generated apps never — so the phase that looked like polish was the one
carrying the outstanding defects. Phase 3 still waits on Phase 0's measurement, as §0 requires.

Phase 1 before Phase 2 because the frontend-only import needs no backend runtime and is the clearest win.
Phase 3 before Phase 2 because it is small and mostly reuses existing machinery. Phase 2 is the largest and
riskiest, so it ships last among the load-bearing phases, behind a flag and behind a prover whose default
answer is "use the sandbox".

Every phase ships the normal way: branch → verification gate → PR → CI green → merge, with the capability
prover and the honest-refusal path test-locked before any of it is switched on.

---

## 6. What this plan deliberately does NOT claim

- **Not** "every app will run in the browser." Some never will, and they will be told so honestly.
- **Not** "E2B goes away." It stops holding the *preview*; it keeps doing the *build*.
- **Not** a cost project. See §0.
- **Not** WebContainer. That is a commercial StackBlitz licence, held by design.
