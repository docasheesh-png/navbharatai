# NavBharatAI Pro v3.0 — custom E2B sandbox template (MODE A enabler)
# ---------------------------------------------------------------------------
# WHY THIS EXISTS
#   The build sandbox currently runs E2B's DEFAULT base image, whose Node.js is
#   older than modern project generators require. As a result `npm create vite`,
#   `create-next-app`, etc. FAIL inside the sandbox (MODE A is blocked today).
#   This image pins a modern, controlled Node so those generators run reliably.
#
#   MODE B (NavBharatAI's internal TemplateRegistry scaffolds) keeps working
#   unchanged on this same image — this ONLY ADDS MODE A capability. Both modes
#   share one rock-solid runtime.
#
# VERIFIED PREMISE
#   `npm create vite@latest -- --template react-ts` was run live on Node v22.22
#   and succeeded (React 19 + Vite 8 scaffold). The only thing missing in prod
#   is this Node version inside the sandbox — which this image provides.
# ---------------------------------------------------------------------------

# Pinned LTS — covers create-vite v6 (needs Node ^20.19 || >=22) AND
# create-next-app latest. Do NOT use a floating tag; pin so the image never
# drifts under us. Debian bookworm gives us apt for the system tools below.
FROM node:22-bookworm

# --- OS tooling the builders rely on ---------------------------------------
#   git             : clone / checkpoint operations
#   netcat-openbsd  : provides `nc` — used by update_preview's port health-check
#                     (`nc -z localhost <port>`) before publishing a preview URL
#   python3 + venv  : FastAPI / Flask / Django internal templates
#   build-essential : native npm deps (esbuild, sharp, better-sqlite3, …)
#   ca-certificates : TLS for npm / git over HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      netcat-openbsd \
      python3 python3-pip python3-venv \
      build-essential \
      ca-certificates \
      curl \
  && rm -rf /var/lib/apt/lists/*

# --- JS package managers (pnpm / yarn) via corepack, pinned ----------------
# Some generated apps prefer pnpm/yarn; having them pre-installed avoids a
# cold network fetch mid-build.
RUN corepack enable \
  && corepack prepare pnpm@9.12.0 --activate \
  && corepack prepare yarn@4.5.1 --activate

# --- Pre-warm the project generators (MODE A speed + resilience) -----------
# Baking create-vite / create-next-app into the image layer means the first
# MODE A build does NOT pay a cold `npm exec` download — it resolves from the
# image's global install + npm cache. Faster cold-start, resilient to a flaky
# npm registry mid-build.
RUN npm install -g create-vite@latest create-next-app@latest \
  && npm cache verify

# --- Pre-bake Playwright + Chromium into the tools dir (SPEED) -------------
# WHY: _kickoffPlaywright() in E2BActuator installs playwright (~120s cap) and
# `playwright install chromium` (~180s cap) into /home/user/.e-tools on EVERY
# new sandbox — competing for the 2 vCPU with the app's npm install, and the
# first screenshot/browser_action blocks up to 90-120s waiting for it. Baking
# it here makes _kickoffPlaywright's `files.exists` guards short-circuit to
# instant-ready; the runtime install stays as the fallback for any drift.
# The path + browsers dir MUST match TOOLS_DIR ('/home/user/.e-tools') and the
# PLAYWRIGHT_BROWSERS_PATH the daemon/screenshot scripts use.
# Pin the version so the baked scripts stay API-compatible with the binary.
RUN mkdir -p /home/user/.e-tools \
  && npm install playwright@1.49.1 --prefix /home/user/.e-tools --no-save \
  && PLAYWRIGHT_BROWSERS_PATH=/home/user/.e-tools/.browsers \
     /home/user/.e-tools/node_modules/.bin/playwright install --with-deps chromium \
  && npm cache clean --force

# --- Pre-bake the vite-react baseline node_modules (BIGGEST SPEED WIN) ------
# WHY: ~5-7 min of EVERY build today is a cold `npm install` on a fresh sandbox
# (BuildTimeEstimator BASE_MS = 420_000). This bakes a fully-installed vite-react
# baseline at /home/user/.warm/vite-react. E2BActuator._npmInstall (Step 0)
# copies that tree into a fresh React workspace as a LOCAL fs copy (~1-3s) so the
# real install runs only as a fast DELTA for generator-added deps. The
# package.json here MUST stay in sync with ViteReactProviderContents.ts — if it
# drifts, the copy is still just a primer that `npm install` reconciles (correct,
# only less optimal), and _npmInstall's `files.exists` guard makes the whole
# feature a no-op on any image where this dir is absent.
#
# ROOT-CAUSE FIX (build kept failing at THIS step in ~1s — the package.json was never
# validly written). The content used to be produced INLINE — first a multi-line
# `printf '%s\n' '{' \ …`, then a single-line `node -e "JSON.stringify(…)"`. Both pack the
# JSON with characters E2B build-system v2's Dockerfile parser mishandles — QUOTES, spaces
# and the `&&` inside `"tsc && vite build"` — so the generator command itself is mangled and
# the file is never written, and `npm install` then dies instantly on a missing/broken
# package.json (exactly the sub-second failure seen). The fix removes ALL such characters from
# the Dockerfile: the package.json is shipped as a single BASE64 token (only [A-Za-z0-9+/=],
# nothing the parser or shell can touch) and decoded with `base64 -d`. The decoded bytes are
# the exact JSON verified locally (react/react-dom/vite/@vitejs/plugin-react/typescript). A
# `test -d` assertion fails the build loudly if the install produced nothing; diagnostics
# print to the build log. No error suppression, no retries.
RUN mkdir -p /home/user/.warm/vite-react \
  && echo ewogICJuYW1lIjogInByb2plY3QiLAogICJ2ZXJzaW9uIjogIjAuMS4wIiwKICAicHJpdmF0ZSI6IHRydWUsCiAgInNjcmlwdHMiOiB7CiAgICAiZGV2IjogInZpdGUiLAogICAgImJ1aWxkIjogInRzYyAmJiB2aXRlIGJ1aWxkIiwKICAgICJwcmV2aWV3IjogInZpdGUgcHJldmlldyIKICB9LAogICJkZXBlbmRlbmNpZXMiOiB7CiAgICAicmVhY3QiOiAiXjE4LjMuMSIsCiAgICAicmVhY3QtZG9tIjogIl4xOC4zLjEiCiAgfSwKICAiZGV2RGVwZW5kZW5jaWVzIjogewogICAgIkB2aXRlanMvcGx1Z2luLXJlYWN0IjogIl40LjMuMSIsCiAgICAidHlwZXNjcmlwdCI6ICJeNS41LjMiLAogICAgInZpdGUiOiAiXjUuNC4xIgogIH0KfQo= | base64 -d > /home/user/.warm/vite-react/package.json \
  && echo === warm vite-react: environment === && node -v && npm -v && df -h \
  && echo === warm vite-react: generated package.json === && cat /home/user/.warm/vite-react/package.json \
  && echo === warm vite-react: npm install === \
  && cd /home/user/.warm/vite-react \
  && npm install --no-audit --no-fund --loglevel=info \
  && test -d node_modules/react -a -d node_modules/vite \
  && npm cache clean --force \
  && echo === warm vite-react: done === && df -h

# Workspace root the actuator writes to — must match WORKSPACE_ROOT in
# E2BActuator.ts ('/home/user/workspace').
WORKDIR /home/user/workspace

# --- Build-time sanity gate ------------------------------------------------
# Fail the IMAGE build (not a user build) if Node is somehow too old for the
# generators. This guarantees a published template can always run MODE A.
RUN node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<20||(v[0]===20&&v[1]<19)){console.error('FATAL: Node too old for create-vite:',process.version);process.exit(1)} console.log('Node OK for MODE A:',process.version)"
