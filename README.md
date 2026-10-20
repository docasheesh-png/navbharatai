# NavBharatAI

AI app builder with a React/Vite frontend and an Express server. Use Node.js 22
(the CI runtime) and the committed npm lockfile.

## Local setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Edit `.env` with the integrations you actually use; remove unused placeholder
values. The server imports `dotenv/config`, which reads `.env` by default.
Vite also supports `.env.local`, but that file alone does not configure the
Express process. Never commit credentials. Only public frontend configuration
belongs in `VITE_*` variables.

A running UI is not a configured builder. Authenticated builds also need Firebase
Auth verification and server database access, an enabled/allowlisted builder
(`AGENTV3_ENABLED`, `AGENTV3_ALLOWLIST`), configured build engines and sandbox
access. Use a dedicated staging project/account for paid evaluations. Follow the
existing deployment's credential bindings; do not point a local drill at production.

## Checks

```bash
npm run typecheck
npm run typecheck:server
npm run typecheck:benchmark
npm test
npm run build
npm run boot:check
npm run test:bundle
npm run audit:gate
```

The full regression suite is large. `npm run boot:check` verifies process startup;
it does not prove provider access, persistence or a working generated app.

## Reliability evidence

`npm run bench:reliability` defaults to a dry run of 15 smoke prompts; use
`BENCH_SET=full` for the existing 50-prompt corpus. A live run requires a current
Firebase ID token in the `BENCH_AUTH_TOKEN` environment secret, a configured
staging server in `BENCH_BASE_URL`, and `BENCH_CONFIRM=yes`. It spends real money.

The runner uses independent sessions and replay-safe request IDs, checkpoints
partial results under `scripts/bench-results/`, and stops on authorization failure.
It records runner commit, dirty state, fixture hash and planned/completed counts.
Those fields do not attest the remote server's deployed commit or feature flags.
An interrupted request may keep building remotely: reconcile its request/session
IDs before starting a replacement. Missing cost is unknown, never zero.

```bash
npm run bench:compare -- path/to/baseline.json path/to/candidate.json
```

Rendering plus a release gate is narrower evidence than passing every requested
critical flow. First-attempt success, edit preservation and full critical-journey
success need additional observations; repeated fresh builds are not repair attempts.
See [the quality roadmap](docs/QUALITY_ROADMAP_2026-10-20.md) and
[the release scorecard](docs/RELEASE_QUALITY_SCORECARD_2026-10-20.md) for limits and
remaining release blockers.
