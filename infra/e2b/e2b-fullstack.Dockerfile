# NavBharatAI Pro v3.0 — POLYGLOT / MULTI-SERVICE builder sandbox (AB-1 / AB-2)
# ---------------------------------------------------------------------------
# WHY A SEPARATE TEMPLATE (not added to e2b.Dockerfile)
#   The default builder template (e2b.Dockerfile) runs for EVERY v3.0 build.
#   Bloating it with a JDK + Go + MongoDB + Redis would slow every ordinary
#   React/Vite build's cold-start and raise E2B cost for capability only
#   polyglot / multi-service apps ever use. So — exactly like the on-demand
#   Android template (e2b-android.Dockerfile) — this is a SEPARATE image. A
#   sandbox is created from it ONLY when a build actually needs a backend
#   language runtime or a local database, selected per-build via a new
#   FULLSTACK_E2B_TEMPLATE_ID env var. The actuator ROUTING is the follow-up
#   code-wiring step; this image is built, published and verified FIRST so the
#   feature is never pointed at a half-built image (same discipline the default
#   and Android templates already follow).
#
# WHAT THIS UNLOCKS (real, not fake)
#   - AB-1 multi-language runtime : Java (OpenJDK 17 + Maven) and Go, alongside
#                                   the Node 22 base and Python 3 (both below).
#   - AB-2 multi-database         : MongoDB and Redis, run as NATIVE PROCESSES
#                                   inside the sandbox (`mongod` / `redis-server`
#                                   on localhost). This is the honest, working
#                                   alternative to docker-compose (AB-3), which
#                                   needs Docker-in-Docker that an E2B microVM
#                                   does not reliably permit — so it is NOT used.
#
# SUPERSET OF THE DEFAULT IMAGE
#   Everything the default builder bakes (pnpm/yarn, pre-warmed generators,
#   Playwright + Chromium, the warm vite-react node_modules) is ALSO baked here,
#   so a build routed to this template behaves EXACTLY like a normal build, just
#   with the extra runtimes/DBs. Those blocks are mirrored from e2b.Dockerfile
#   and must stay in sync with it; a drift only makes the primer less optimal
#   (the runtime guards reconcile it), never incorrect.
#
# COST (honest — see README.md "Cost note"): with a JDK + Go + MongoDB + Redis +
# Chromium + the warm node_modules this image is multi-GB and its cloud build
# takes real minutes. That is an infra cost decision for the account owner, the
# same as the Android template's own cost note.
# ---------------------------------------------------------------------------

FROM node:22-bookworm

# --- OS tooling (default set) + gnupg for the MongoDB apt repo key ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      netcat-openbsd \
      python3 python3-pip python3-venv \
      build-essential \
      ca-certificates \
      curl \
      gnupg \
      unzip \
  && rm -rf /var/lib/apt/lists/*

# --- AB-1: Java (OpenJDK 17 + Maven) ----------------------------------------
# OpenJDK 17 is the current mainstream LTS for Spring Boot 3.x / modern Java
# backends; Maven is the most common build tool (Gradle apps ship a ./gradlew
# wrapper that only needs the JDK, so Maven covers the gap).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless \
      maven \
  && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# --- AB-1: Go ---------------------------------------------------------------
# Debian's apt Go is often several minor versions behind; install the official
# pinned toolchain tarball so `go build` / `go mod` match a modern Go app. Pin
# the version so the image never drifts under us (bump deliberately).
ENV GO_VERSION=1.23.5
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz \
  && tar -C /usr/local -xzf /tmp/go.tgz \
  && rm /tmp/go.tgz \
  && /usr/local/go/bin/go version
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH=/home/user/go
ENV PATH="${GOPATH}/bin:${PATH}"

# --- AB-2: Redis (native process) -------------------------------------------
# Installed from Debian; started per-build by the agent as `redis-server`
# (default :6379). No systemd in the sandbox — it runs as a plain process.
RUN apt-get update && apt-get install -y --no-install-recommends \
      redis-server \
  && rm -rf /var/lib/apt/lists/*

# --- AB-2: MongoDB (native process, official 7.0 repo for Debian bookworm) ---
# Debian's own mongodb package is ancient / absent; use MongoDB's official apt
# repo (7.0, current stable for Debian 12). Started per-build by the agent as
# `mongod --dbpath <dir>` (default :27017). Pin the major (7.0) deliberately.
RUN curl -fsSL https://pgp.mongodb.com/server-7.0.asc \
      | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
  && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-org \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /home/user/.mongo-data \
  && mongod --version

# --- JS package managers (pnpm / yarn) via corepack — mirrors e2b.Dockerfile -
RUN corepack enable \
  && corepack prepare pnpm@9.12.0 --activate \
  && corepack prepare yarn@4.5.1 --activate

# --- Pre-warm the project generators (MODE A) — mirrors e2b.Dockerfile -------
RUN npm install -g create-vite@latest create-next-app@latest \
  && npm cache verify

# --- Pre-bake Playwright + Chromium — mirrors e2b.Dockerfile ----------------
RUN mkdir -p /home/user/.e-tools \
  && npm install playwright@1.49.1 --prefix /home/user/.e-tools --no-save \
  && PLAYWRIGHT_BROWSERS_PATH=/home/user/.e-tools/.browsers \
     /home/user/.e-tools/node_modules/.bin/playwright install --with-deps chromium \
  && npm cache clean --force

# --- Pre-bake the vite-react baseline node_modules — mirrors e2b.Dockerfile --
# package.json shipped as a single BASE64 token (only [A-Za-z0-9+/=]) and decoded
# with `base64 -d` — the exact same bytes as e2b.Dockerfile. Keep in sync.
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

# --- Build-time sanity gate — every runtime must be present -----------------
# Fail the IMAGE build (not a user build) if any promised runtime is missing, so
# a published fullstack template can ALWAYS run every language/DB it claims.
RUN node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<20){console.error('FATAL: Node too old:',process.version);process.exit(1)} console.log('Node OK:',process.version)" \
  && java -version \
  && mvn -version \
  && go version \
  && redis-server --version \
  && mongod --version \
  && python3 --version \
  && echo "=== fullstack template: all runtimes present ==="
