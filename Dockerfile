FROM node:22

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

ENV PORT=8080

EXPOSE 8080

CMD ["npm","start"]
