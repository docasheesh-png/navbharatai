# NavBharatAI production image.
#
# WHY THIS IS A MULTI-STAGE BUILD (2026-08-04). It used to be a single `FROM node:22` stage, so the
# image we shipped to Cloud Run contained the ENTIRE Debian build environment — compilers, git, python,
# the Go toolchain, every devDependency, and the whole source tree — none of which runs in production.
# The first Trivy scan that actually executed (the scanner had been silently dead for months; see
# PROGRESS 2026-08-04) failed on a CRITICAL CVE, with a long tail of HIGH ones almost entirely in Go
# stdlib and build tooling that our server never invokes.
#
# Patching individual CVEs would be a treadmill. The root-cause fix is to stop shipping the build
# environment at all: build in the full image, RUN in `node:22-slim`. That deletes the whole class of
# findings (they are not present to be found), shrinks the image substantially — faster Cloud Run cold
# starts and less Artifact Registry storage, which the cost-cut campaign cares about — and reduces the
# real attack surface, because a compiler that is not in the image cannot be used by an attacker.
#
# node_modules is COPIED from the builder rather than reinstalled. `node:22-slim` has no build
# toolchain, so `npm ci` there would fail on the native modules (ssh2, cpu-features) that node-gyp
# compiles. Both stages are Debian bookworm with the same glibc, so the binaries built in the builder
# run correctly in the runtime stage.

# ---------- Stage 1: build ----------
FROM node:22 AS builder

WORKDIR /app

COPY package*.json ./

# P-BRE.13 — `npm ci` (not `npm install`) for a reproducible, lockfile-exact install:
# installs strictly from package-lock.json and fails fast if the lock is out of sync.
RUN npm ci

COPY . .

# SECURITY Phase 4 — cross-origin preview origin, baked into the client bundle at build time (Vite
# reads import.meta.env.VITE_PREVIEW_ORIGIN). Default EMPTY = today's exact same-origin preview
# behaviour (zero change). Set via the Cloud Build substitution _VITE_PREVIEW_ORIGIN once the preview
# subdomain (mitrify.xyz) is live — see preview-host/README.md. Passed through as a build ARG.
ARG VITE_PREVIEW_ORIGIN=""
ENV VITE_PREVIEW_ORIGIN=$VITE_PREVIEW_ORIGIN

RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Exactly what the server needs at runtime and nothing else:
#   package.json  — `npm start` reads it (`node dist/server.cjs`)
#   node_modules  — the server bundle is built with esbuild `--packages=external`, so real modules
#                   must be present; copied WITH their compiled native binaries (see header)
#   dist/         — the server bundle plus every static asset Vite emitted (client build, monaco, …)
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV PORT=8080

EXPOSE 8080

CMD ["npm","start"]
