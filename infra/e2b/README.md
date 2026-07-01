# NavBharatAI Pro v3.0 — Custom E2B Builder Template

This directory contains the **infrastructure** that makes **MODE A**
(`npm create vite`, `create-next-app`, …) work reliably in the Pro v3.0 build
sandbox, while keeping **MODE B** (NavBharatAI's internal `TemplateRegistry`
scaffolds) working exactly as before.

> **TL;DR** — Build the image once, publish it to E2B, set one env var. After
> that the sandbox runs a modern pinned Node and both scaffolding modes are
> rock-solid.

---

## Why this is needed (root cause)

`src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts` creates sandboxes
with **no template id**:

```ts
sandbox = await Sandbox.create(this._opts());   // ← uses E2B's DEFAULT base image
```

The default base ships an **older Node.js**. Modern generators require a newer
Node, so inside the sandbox:

```
npm create vite@latest   →  FAILS (Node too old)
```

That is why `ScaffoldGuard.ts` currently **blocks** those commands and redirects
to MODE B. The fix is not code — it is giving the sandbox a **modern, pinned
Node**, which is what the custom template in this directory does.

**Verified premise:** `npm create vite@latest -- --template react-ts` was run
live on **Node v22.22** and succeeded (scaffolded React 19 + Vite 8). The image
here pins Node 22, so MODE A will run the same way in the sandbox.

---

## What's here

| File | Purpose |
|------|---------|
| `e2b.Dockerfile` | The DEFAULT sandbox image recipe (used by every v3.0 build): Node 22 (pinned) + git, netcat, python3, build tools + pre-warmed `create-vite` / `create-next-app` |
| `e2b-android.Dockerfile` | A SEPARATE, on-demand template for the Android APK builder (JDK 17 + Android SDK + Bubblewrap CLI) — see "Android APK builder template" below |
| `build.mjs` | **Build system v2** script — builds EITHER template (env-var selected) via `fromDockerfile()` + `Template.build()`. Defaults to the original `e2b.Dockerfile` behavior unchanged. |
| `package.json` | Declares the `e2b` SDK dependency for `build.mjs` |
| `e2b.toml` | Legacy v1 config — **not used by the v2 build** (CPU/RAM now live in `build.mjs`). Kept for reference only. |
| `README.md` | This guide |

> **Build system v1 vs v2:** E2B deprecated the v1 `e2b template build` CLI path
> (it now exits non-zero). This directory uses **build system v2**: the template
> is defined in code (`build.mjs`) and built via the `e2b` SDK. The Dockerfile is
> reused as the single source of truth via `fromDockerfile()`.

---

## Build & publish

### Recommended: one-click via GitHub Actions (no terminal needed)

A workflow at `.github/workflows/e2b-template.yml` builds + publishes the
template on GitHub's runners (which have Docker + Docker Hub egress):

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `E2B_API_KEY`  · Value: your e2b.dev API key
2. Repo → **Actions → "Build E2B Builder Template" → Run workflow**
3. Open the finished run → the **job summary shows the usable template alias**
   (`navbharat-builder`).
4. Set Cloud Run env `E2B_TEMPLATE_ID=navbharat-builder`, then run the
   code-wiring PR.

> The build **cannot** run in the Claude Code web sandbox — `api.e2b.dev` is
> egress-blocked there and no E2B key is mounted. The GitHub Actions runner (or
> your own machine, below) is where it runs.

### Alternative: from your own machine

> **Requires:** an E2B account and `E2B_API_KEY`. (No local Docker needed — the
> v2 build runs on E2B's cloud build infra.)

```bash
export E2B_API_KEY=e2b_xxx          # from https://e2b.dev/dashboard
cd infra/e2b
npm install                          # installs the e2b SDK
node build.mjs                       # builds + publishes via build system v2
```

The template is published under the alias `navbharat-builder` (override with
`TEMPLATE_NAME=...`). That alias is what `Sandbox.create({ template })` uses.

---

## Verify the published template (proof, not assumption)

```bash
# Spawn a one-off sandbox from the new template and check Node + MODE A:
e2b sandbox spawn navbharat-builder    # (needs @e2b/cli: npm i -g @e2b/cli)
#   inside the sandbox shell:
node -v                                   # must be >= v22
npm create vite@latest smoke -- --template react-ts
ls smoke && cat smoke/package.json        # confirms scaffold succeeded
nc -h 2>&1 | head -1                       # confirms netcat present (health-check)
python3 --version                          # confirms python templates can run
exit
```

If `node -v` is ≥ 22 and `npm create vite` scaffolds, the template is good.

---

## Code wiring (NEXT PR — intentionally NOT done yet)

Wiring is deliberately deferred until a real `E2B_TEMPLATE_ID` exists, so we
never re-introduce the old "create-vite fails → broken build" bug by pointing at
a half-built template. Once the template is published and verified, a follow-up
PR will:

1. **Point sandboxes at the template** — `E2BActuator.ts`:
   ```ts
   const TEMPLATE = process.env.E2B_TEMPLATE_ID;   // undefined → default base (back-compat)
   sandbox = await Sandbox.create(this._opts(TEMPLATE ? { template: TEMPLATE } : {}));
   ```
   Falling back to the default base when the env var is unset keeps existing
   behavior intact until the template is rolled out.

2. **Upgrade `ScaffoldGuard`** from "always block" to **template-aware**:
   - On the custom template (modern Node) → **ALLOW** MODE A generators.
   - On the default base (old Node) → keep blocking + MODE B redirect.

3. **MODE A → MODE B fallback (the rock-solid part)** in the build flow:
   ```
   try MODE A (npm create vite on modern template)
     ├─ success → continue
     └─ fail/timeout → automatic MODE B (internal template) → build never breaks
   ```

4. **Post-scaffold E2B-proxy patch for MODE A output.** `create-vite`'s generated
   `vite.config.ts` does **not** include `server: { host: true, allowedHosts: true }`,
   which the E2B preview proxy requires (this was the original "Closed Port Error"
   class). The MODE A path must patch the generated config to add it — the same
   server block MODE B templates already ship with.

5. **Config:** set `E2B_TEMPLATE_ID` in Cloud Run env to the published id.

6. **AppKnowledgeBase entry** for the new "MODE A / official scaffolds" capability.

---

## Android APK builder template (2026-07-01 — infra only, NOT wired to any feature yet)

Admin request: a "100% real, working" Download APK feature. Researched honestly before building
anything (see PROGRESS.md 2026-07-01): a real, automatic APK build needs a JDK + Android SDK + Gradle
somewhere, which the DEFAULT builder template deliberately does not have (would slow every ordinary
build's cold-start for a feature most builds never use). This is a SEPARATE, on-demand template:
`e2b-android.Dockerfile` — JDK 17, Android SDK cmdline-tools (`platform-tools`, `platforms;android-34`,
`build-tools;34.0.0`), and Google's own **Bubblewrap CLI** (the official TWA — Trusted Web Activity —
generator). A TWA is the lightest real path to an installable APK: it wraps an ALREADY-HOSTED web app
(a real, durable public HTTPS URL — which NavBharatAI's existing per-workspace Firebase Hosting deploy,
`src/server/EngineerAI/DeploymentService.ts`, already provides) in a thin native Android shell, backed
by a real Gradle build and a real signing keystore.

**What THIS template provides:** the build environment only. **What's still missing (deliberately NOT
built yet — see "two valid states: fully working, or not built yet"):** the actual orchestration code
that invokes `bubblewrap init`/`build` inside a sandbox from this template, generates/manages a signing
keystore server-side, and streams the resulting `.apk` back to the user. That is separate, larger
follow-up work, matching the SAME "infra template published + verified FIRST, code wiring SECOND"
sequencing this directory already used for the default template's own MODE A rollout above — so the
feature can never be pointed at a half-built image.

### Build & publish (same GitHub Actions workflow, different input)

1. Repo → **Settings → Secrets and variables → Actions** → confirm `E2B_API_KEY` is set (same secret
   the default template uses).
2. Repo → **Actions → "Build E2B Builder Template" → Run workflow** → set **template_kind: `android`**
   (leave `template_name` blank to use the default alias `navbharat-android-builder`).
3. Open the finished run → the job summary shows the usable template alias.
4. Set Cloud Run env `ANDROID_E2B_TEMPLATE_ID=navbharat-android-builder` (a NEW, separate env var from
   `E2B_TEMPLATE_ID` — this template is never used for ordinary builds).

### Cost note (honest — bigger than the default template)

This image is substantially larger than the default builder template (JDK + Android SDK + Gradle
caches run into several GB, versus the default's lean Node-only image) and building/publishing it will
take noticeably longer and cost more E2B build/storage time. An on-demand Android/Gradle build from
this template (once the orchestration code exists) will also take real minutes, not seconds — this is
an infra/product decision for the account owner, flagged here honestly, not hidden, same as the default
template's own cost note below.

### Verify the published template (once built)

```bash
e2b sandbox spawn navbharat-android-builder    # needs @e2b/cli: npm i -g @e2b/cli
#   inside the sandbox shell:
java -version                                   # must show 17.x
sdkmanager --list_installed                     # must list platform-tools, platforms;android-34, build-tools;34.0.0
bubblewrap --version                            # must print a version, not "command not found"
exit
```

---

## Rollback / safety

- Unset `E2B_TEMPLATE_ID` → sandboxes revert to the default base image instantly
  (no redeploy of the template needed). The wiring is designed so the custom
  template is **opt-in via env var**, never a hard dependency.
- MODE B remains the always-available safety net; MODE A is additive.

---

## Cost note (honest)

A custom E2B template uses E2B build/storage and generally a paid/team plan
(the default base is free). This is an infra cost decision for the account
owner — flagged here, not hidden.
