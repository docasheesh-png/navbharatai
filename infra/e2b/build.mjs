// E2B build system v2 — build & publish an NavBharatAI Pro v3.0 sandbox template.
//
// WHY THIS REPLACED `e2b template build`:
//   E2B deprecated the v1 build system (e2b.toml + `e2b template build`); the CLI
//   now exits non-zero on v1. Build system v2 builds from CODE. We reuse the
//   committed Dockerfile via fromDockerfile() so the image recipe stays the
//   single source of truth (no second, divergent definition).
//
//   The actual image build runs on E2B's cloud build infra — the runner only
//   needs the `e2b` SDK + network to E2B + the E2B_API_KEY (read from env).
//
// Builds the DEFAULT builder template (e2b.Dockerfile) unless overridden — this
// script is now ALSO reused for the Android/APK builder template
// (e2b-android.Dockerfile, see PROGRESS.md 2026-07-01) via env vars, so there is
// still only ONE build script, not a diverging copy per template. Every new env
// var below defaults to the ORIGINAL hardcoded values — an unmodified invocation
// (as CI has always called it) builds EXACTLY the same image as before.
//
// Run by .github/workflows/e2b-template.yml. Locally:
//   cd infra/e2b && npm install && E2B_API_KEY=... node build.mjs
//   # Android template:
//   cd infra/e2b && npm install && E2B_API_KEY=... DOCKERFILE=e2b-android.Dockerfile \
//     TEMPLATE_NAME=navbharat-android-builder CPU_COUNT=4 MEMORY_MB=8192 node build.mjs

import { readFileSync } from 'node:fs';
import { Template, defaultBuildLogger } from 'e2b';

const name = process.env.TEMPLATE_NAME || 'navbharat-builder';
const dockerfileName = process.env.DOCKERFILE || 'e2b.Dockerfile';
const cpuCount = Number(process.env.CPU_COUNT) || 2;
const memoryMB = Number(process.env.MEMORY_MB) || 2048;

// Reuse the committed Dockerfile (FROM/RUN/WORKDIR only — all v2-supported).
const dockerfile = readFileSync(new URL(`./${dockerfileName}`, import.meta.url), 'utf8');

const template = Template().fromDockerfile(dockerfile);

console.log(`Building E2B template "${name}" (build system v2, from ${dockerfileName}, ${cpuCount} vCPU / ${memoryMB}MB)…`);

const info = await Template.build(template, name, {
  cpuCount,
  memoryMB,
  onBuildLogs: defaultBuildLogger(),
});

console.log('\n=== E2B TEMPLATE BUILD COMPLETE ===');
console.log(JSON.stringify(info, null, 2));
console.log(`\nUsable template alias for Sandbox.create({ template }): ${name}`);
