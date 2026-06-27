// E2B build system v2 — build & publish the NavBharatAI Pro v3.0 builder template.
//
// WHY THIS REPLACED `e2b template build`:
//   E2B deprecated the v1 build system (e2b.toml + `e2b template build`); the CLI
//   now exits non-zero on v1. Build system v2 builds from CODE. We reuse the
//   existing `e2b.Dockerfile` via fromDockerfile() so the image recipe stays the
//   single source of truth (no second, divergent definition).
//
//   The actual image build runs on E2B's cloud build infra — the runner only
//   needs the `e2b` SDK + network to E2B + the E2B_API_KEY (read from env).
//
// Run by .github/workflows/e2b-template.yml. Locally:
//   cd infra/e2b && npm install && E2B_API_KEY=... node build.mjs

import { readFileSync } from 'node:fs';
import { Template, defaultBuildLogger } from 'e2b';

const name = process.env.TEMPLATE_NAME || 'navbharat-builder';

// Reuse the committed Dockerfile (FROM/RUN/WORKDIR only — all v2-supported).
const dockerfile = readFileSync(new URL('./e2b.Dockerfile', import.meta.url), 'utf8');

const template = Template().fromDockerfile(dockerfile);

console.log(`Building E2B template "${name}" (build system v2, from e2b.Dockerfile)…`);

const info = await Template.build(template, name, {
  cpuCount: 2,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger(),
});

console.log('\n=== E2B TEMPLATE BUILD COMPLETE ===');
console.log(JSON.stringify(info, null, 2));
console.log(`\nUsable template alias for Sandbox.create({ template }): ${name}`);
