# L3 asset engine — implementation checkpoint, 2026-11-01

**Default off; no reviewed production models yet; not end-to-end delivered.**
Base: `504b79298739d142117a31cc934fa6b65595f5fa` (billing PR #4063).
Branch: `feat/universal-3d-assets`. Existing L1/L2 generation remains available.

## Architecture and implementation

`routes/agentv3.ts` prepares optional external assets after a successful 3D kit recipe,
inside the existing new-build/non-import/untouched-starter guard. The exact opt-in flag is
`AGENTV3_EXTERNAL_GAME_ASSETS=on`. The production reviewed catalogue is deliberately empty;
therefore neither the default nor an empty-catalogue opt-in makes provider requests.

`gameAssets/assetPlan.ts` extracts bounded deterministic English subject/animation requirements.
This is inexpensive alias matching, not a universal multilingual semantic research model.
The engine checks reviewed cache entries first, then bounded provider candidates, validates hashes,
license metadata, budgets and actual browser rendering before acknowledging a usable model.
Failures retain the existing procedural fallback. Animation role mappings are curated per asset.

The provider registry accepts reviewed exact assets with source/license evidence, immutable hashes,
commercial and redistribution permissions, approved origins, animation names and orientation.
Poly Haven's adapter rechecks known reviewed IDs with `/info/{id}` and `/files/{id}`; it does not
perform unrestricted whole-catalog discovery. Curated pack adapters share the reviewed contract.
Sketchfab is disabled pending verified authorized API access and terms. No provider has a live
verified production catalogue entry yet. Never infer asset rights from a GitHub code license.

Transport uses existing socket-level SSRF protection, exact HTTPS origins, no redirects/credentials,
bounded streaming, timeouts, per-origin metadata rate limits and bounded shared in-flight downloads.
GLB validation rejects external references, unsupported extensions, malformed ranges, cyclic nodes,
unsafe numbers and excess geometry/texture budgets. Supported formats are self-contained GLB 2 and
reviewed relative-resource glTF + BIN + PNG deterministically bundled into GLB. Initial policy:
5 MiB, 60,000 triangles, 512 nodes, 128 meshes/animations, 2048-square textures with aggregate cap.
JPEG, archives, FBX/OBJ, compression codecs, geometry simplification, texture resizing and generated
LODs are not implemented. Budget rejection is not optimization.

The durable content cache stores only reviewed public assets under content hashes in the existing
private bucket. Cache hits are rehashed and revalidated. At most 64 entries can be admitted in one
catalogue; historical-object garbage collection is not implemented, so this is not a lifetime
storage cap. `downloadedBytes` currently reports final acquired GLB bytes, not total HTTP traffic
for multi-resource glTF. No external paid service or AI inference was used by these checks.

Project persistence uses existing workspace binary storage with exact hash read-back before
materialization. The source manifest, attribution file and runtime wrapper require durable text-save
acknowledgement. Existing restore and publish paths now recognize GLB and correct MIME types.
The existing binary limit is preserved; decoded-base64 accounting now handles padding exactly.

The generated Three.js runtime fetches same-origin hashed assets, verifies integrity, normalizes
height/ground/center/yaw, connects named animation clips and disposes resources. Required attribution
and live API service credit get a visible link to local attribution text. A bounded sandbox Chromium
proof verifies nonempty rendering and observable requested animation before seed delivery. This
per-asset proof does not replace testing the completed user's game.

## Sources and access requirements

| Source | Official evidence | Current state |
|---|---|---|
| Poly Haven | https://polyhaven.com/license ; https://github.com/Poly-Haven/Public-API/blob/master/ToS.md ; https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml | CC0 assets. Free commercial API requires identifying User-Agent and visible provider credit when surfacing live API content. Reviewed-ID adapter implemented; API denied by environment. |
| Kenney | https://kenney.nl/assets | Curated adapter contract; exact packs and downloadable asset provenance pending. |
| Quaternius | https://quaternius.com/faq.html | FAQ states CC0; exact selected pack review still required. Curated adapter contract only. |
| KayKit | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | Official free animated pack documents CC0. Paid EXTRA excluded. Immutable asset selection/download inspection pending. |
| GitHub | Publisher repositories with asset-level license evidence | Curated adapter contract; no blanket repository-license inference. Tree API denied. |
| Sketchfab | https://sketchfab.com/developers/download-api | Research fetch returned 403; authorized interface and terms unverified; disabled. |

The environment denied API requests to `api.polyhaven.com` and `api.github.com` with proxy 403.
These operations did not download assets. No alternate-host or proxy bypass was attempted.
Minimal currently evidenced API hosts are those two. Asset-download hosts must be determined from
verified official metadata before approval; they are not guessed here. Environment owners must
approve access; this implementation does not change network/security settings.

## Verification and release boundary

Evidence logs reside in `/workspace/navbharat-asset-verification` in the working environment.
Checks use CI's Node 22.23.4/npm 11.18.0 except the explicitly documented browser harness.
Affected-suite run: 37 files, 657 tests passed. A subsequent four-file asset run passed 35 tests;
these overlap and must not be summed. Full coverage is separately tracked in PROGRESS.md.

Real system Chromium with Playwright 1.49.1 and Three.js rendered a synthetic textured animated GLB:
SHA-256 `59838f141dcb34473eb380f97b4935545d26e036ceaf38dead0e710f54862d25`,
4 triangles, 1,856 changed pixels, observable animation. The generated loader passed normalization,
credits/cleanup, missing-file fallback and reload using owned local URLs. This is a synthetic fixture,
not a downloaded train/bird/ship/human/car/animal or a published user game. Six subject-selection
scenarios also use explicitly synthetic fixtures, not six realistic game builds.

Local CI-equivalent audit, license, SBOM, frontend/server/benchmark typechecks, unused/native guards,
OAuth check, build, bundle, boot and production dependency gate passed. All four existing Firestore
emulator drills passed. Required `npm audit signatures` failed on HTTP 403 from the Sigstore TUF
service (`tuf-repo-cdn.sigstore.dev`); the gate was not skipped or weakened. This is an additional
minimal access requirement for completing CI, separate from model-provider access.

Not yet proven: real provider downloads/licensing admission, six actual game builds, physical mobile
performance, private-bucket spill/restart in deployment, live publication and complete required CI.
No production feature activation, deployment or merge is authorized by these synthetic results alone.

### Reproducing explicit acceptance harnesses

- Policy/security smoke: `node --experimental-strip-types scripts/checks/gameAssetPolicy.check.mjs`.
- Browser: `node_modules/.bin/tsx scripts/checks/gameAssetBrowser.check.ts <existing-playwright-index.mjs> <existing-chromium-executable>`.
  Missing browser tooling is an error, not a skipped pass. This run used system Chromium and the
  sandbox's existing Playwright version, installed only in `/tmp`, with no repository dependency change.
- Persistence: start the verified Firestore emulator as in `.github/workflows/ci.yml`, then run
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:18781 node scripts/checks/gameAssetPersistence.check.mjs`.
  The harness asserts loopback and a synthetic demo project, generates a throwaway local-only test
  credential, bundles the worker to the server's CJS format, saves, then restores in a separate process.
  It deletes synthetic documents. It cannot run against a production database. This proves the inline
  workspace asset path and provenance persistence, not Cloud Storage spill or deployment publishing.
- Production artifact/browser: `node_modules/.bin/tsx scripts/checks/gameAssetBuild.check.ts <existing-playwright-index.mjs> <existing-chromium-executable>`.
  Passed using the actual Vite production build at a nested `/published/` base: model hash and
  manifest preserved, rendering/animation/reload pass, only owned URLs requested. Synthetic fixture
  only. Browser and build harnesses also passed under CI-matching Node 22.23.4.
