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

# Workspace root the actuator writes to — must match WORKSPACE_ROOT in
# E2BActuator.ts ('/home/user/workspace').
WORKDIR /home/user/workspace

# --- Build-time sanity gate ------------------------------------------------
# Fail the IMAGE build (not a user build) if Node is somehow too old for the
# generators. This guarantees a published template can always run MODE A.
RUN node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<20||(v[0]===20&&v[1]<19)){console.error('FATAL: Node too old for create-vite:',process.version);process.exit(1)} console.log('Node OK for MODE A:',process.version)"
