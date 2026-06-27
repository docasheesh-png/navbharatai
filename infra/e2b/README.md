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
| `e2b.Dockerfile` | The sandbox image: Node 22 (pinned) + git, netcat, python3, build tools + pre-warmed `create-vite` / `create-next-app` |
| `e2b.toml` | E2B template config (name, dockerfile, CPU/RAM) |
| `README.md` | This guide |

---

## Build & publish

### Recommended: one-click via GitHub Actions (no terminal needed)

A workflow at `.github/workflows/e2b-template.yml` builds + publishes the
template on GitHub's runners (which have Docker + Docker Hub egress):

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `E2B_API_KEY`  · Value: your e2b.dev API key
2. Repo → **Actions → "Build E2B Builder Template" → Run workflow**
3. Open the finished run → the **job summary prints the Template ID** (and the
   updated `e2b.toml` is attached as an artifact).
4. Set Cloud Run env `E2B_TEMPLATE_ID=<that id>`, then run the code-wiring PR.

> The build **cannot** run in the Claude Code web sandbox — Docker Hub image
> blobs and `api.e2b.dev` are both blocked by egress policy there, and no E2B
> key is mounted. The GitHub Actions runner (or your own machine, below) is the
> place it runs.

### Alternative: from your own machine

> **Requires:** an E2B account, `E2B_API_KEY`, Docker installed, and outbound
> access to Docker Hub.

```bash
# 1. Install the E2B CLI
npm install -g @e2b/cli            # or: npx @e2b/cli@latest <cmd>

# 2. Authenticate (either works)
export E2B_API_KEY=e2b_xxx          # from https://e2b.dev/dashboard
#   or:  e2b auth login

# 3. Build + publish the template from this directory
cd infra/e2b
e2b template build --name navbharat-builder

# 4. Note the template id printed at the end (also written into e2b.toml),
#    e.g.  "navbharat-builder" / "abc123def456".
```

---

## Verify the published template (proof, not assumption)

```bash
# Spawn a one-off sandbox from the new template and check Node + MODE A:
e2b sandbox spawn navbharat-builder
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
